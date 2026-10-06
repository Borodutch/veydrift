package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// Acquires the real flock on a separate descriptor, just like another process.
func holdStoreLock(t *testing.T, s *Store, name string) func() {
	t.Helper()
	f, err := s.holdExecutionLock(name)
	if err != nil {
		t.Fatal(err)
	}
	var once sync.Once
	release := func() { once.Do(func() { releaseExecution(f) }) }
	t.Cleanup(release)
	return release
}
func awaitResult(t *testing.T, done <-chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(2 * time.Second):
		t.Fatal("operation retained capacity after cancellation")
		return nil
	}
}

func TestStoreCanceledLockWaitNeverPublishes(t *testing.T) {
	for _, lock := range []string{"job", "slot", "blob-budget"} {
		for _, operation := range []string{"checkpoint", "renew", "finish"} {
			if lock == "blob-budget" && operation != "checkpoint" {
				continue
			}
			t.Run(lock+"/"+operation, func(t *testing.T) {
				s := store(t)
				k := admit(t, s, 1)
				otherKey := admit(t, s, 2)
				l, err := s.Claim(k)
				if err != nil {
					t.Fatal(err)
				}
				if err = s.Checkpoint(l, []byte("previous")); err != nil {
					t.Fatal(err)
				}
				otherLease, err := s.Claim(otherKey)
				if err != nil {
					t.Fatal(err)
				}
				before, _ := s.Get(k)
				slotBefore, err := os.ReadFile(s.slotPath(l.Slot))
				if err != nil {
					t.Fatal(err)
				}
				name := lock
				if lock == "job" {
					name = k
				}
				if lock == "slot" {
					name = fmt.Sprintf("slot-%d", l.Slot)
				}
				release := holdStoreLock(t, s, name)
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				done := make(chan error, 1)
				go func() {
					switch operation {
					case "checkpoint":
						done <- s.CheckpointContext(ctx, l, []byte("must not persist"))
					case "renew":
						done <- s.RenewContext(ctx, l)
					case "finish":
						done <- s.finishContext(ctx, l, Complete, "fake", "")
					}
				}()
				select {
				case err := <-done:
					t.Fatalf("did not wait for real lock: %v", err)
				case <-time.After(30 * time.Millisecond):
				}
				if lock != "blob-budget" {
					concurrent := make(chan error, 1)
					go func() {
						concurrent <- s.CheckpointContext(context.Background(), otherLease, []byte("unrelated progress"))
					}()
					if e := awaitResult(t, concurrent); e != nil {
						t.Fatalf("unrelated checkpoint blocked: %v", e)
					}
				}
				cancel()
				if err = awaitResult(t, done); !errors.Is(err, context.Canceled) {
					t.Fatal(err)
				}
				release()
				// Cross all transition locks after return: no callback can resume on unlock.
				if err = s.lock(k, func() error {
					return s.lock(fmt.Sprintf("slot-%d", l.Slot), func() error { return s.lock("blob-budget", func() error { return nil }) })
				}); err != nil {
					t.Fatal(err)
				}
				after, _ := s.Get(k)
				slotAfter, _ := os.ReadFile(s.slotPath(l.Slot))
				if after != before || !bytes.Equal(slotBefore, slotAfter) {
					t.Fatal("canceled transaction mutated durable state")
				}
				if _, err = s.Blob(Hash([]byte("must not persist"))); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("late blob: %v", err)
				}
			})
		}
	}
}

type checkpointWaitRunner struct {
	entered chan struct{}
	proceed chan struct{}
	child   bool
}

func (*checkpointWaitRunner) Ready(context.Context, Identity) error          { return nil }
func (*checkpointWaitRunner) Verify(context.Context, Snapshot, []byte) error { return nil }
func (r *checkpointWaitRunner) Prove(ctx context.Context, s Snapshot, b []byte, save func([]byte) error) ([]byte, error) {
	return r.ProveContext(ctx, s, b, func(_ context.Context, b []byte) error { return save(b) })
}
func (r *checkpointWaitRunner) ProveContext(ctx context.Context, _ Snapshot, _ []byte, save func(context.Context, []byte) error) ([]byte, error) {
	close(r.entered)
	<-r.proceed
	if r.child {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 75*time.Millisecond)
		defer cancel()
	}
	return nil, save(ctx, []byte("canceled runner checkpoint"))
}

// Deliberately exposes only the legacy Runner interface.
type legacyCheckpointWaitRunner struct{ inner *checkpointWaitRunner }

func (r *legacyCheckpointWaitRunner) Ready(ctx context.Context, id Identity) error {
	return r.inner.Ready(ctx, id)
}
func (r *legacyCheckpointWaitRunner) Verify(ctx context.Context, s Snapshot, b []byte) error {
	return r.inner.Verify(ctx, s, b)
}
func (r *legacyCheckpointWaitRunner) Prove(ctx context.Context, s Snapshot, b []byte, save func([]byte) error) ([]byte, error) {
	return r.inner.Prove(ctx, s, b, save)
}

func TestRunOneCanceledPersistenceReleasesExecution(t *testing.T) {
	for _, lock := range []string{"job", "slot", "blob-budget"} {
		for _, mode := range []string{"legacy", "parent", "child"} {
			child := mode == "child"
			t.Run(lock+"/"+mode, func(t *testing.T) {
				c := testConfig()
				c.Lease = 300 * time.Millisecond
				s, err := Open(t.TempDir(), c)
				if err != nil {
					t.Fatal(err)
				}
				k := admit(t, s, 1)
				other := admit(t, s, 2)
				one, two := fixture(1), fixture(2)
				src := &fakeSource{snaps: map[Identity]Snapshot{one.Identity: one, two.Identity: two}, canonical: true}
				r := &checkpointWaitRunner{entered: make(chan struct{}), proceed: make(chan struct{}), child: child}
				var runner Runner = r
				if mode == "legacy" {
					runner = &legacyCheckpointWaitRunner{inner: r}
				}
				svc, _ := New(s, src, runner)
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				done := make(chan error, 1)
				go func() { done <- svc.RunOne(ctx, k) }()
				select {
				case <-r.entered:
				case <-time.After(time.Second):
					t.Fatal("runner did not start")
				}
				j, err := s.Get(k)
				if err != nil {
					t.Fatal(err)
				}
				name := lock
				if lock == "job" {
					name = k
				}
				if lock == "slot" {
					name = fmt.Sprintf("slot-%d", j.Slot)
				}
				release := holdStoreLock(t, s, name)
				close(r.proceed)
				// Give the heartbeat time to enter its own lock wait, too.
				if !child {
					time.Sleep(120 * time.Millisecond)
					cancel()
				}
				err = awaitResult(t, done)
				if !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
					t.Fatalf("cancellation lost: %v", err)
				}
				for _, n := range []string{"job-execution-" + k, fmt.Sprintf("execution-%d", j.Slot)} {
					f, e := s.holdExecutionLock(n)
					if e != nil {
						t.Fatalf("execution reservation retained: %v", e)
					}
					releaseExecution(f)
				}
				after, _ := s.Get(k)
				if after.Checkpoint != "" || after.Proof != "" {
					t.Fatal("canceled runner published")
				}
				release()
				// Failed cleanup under job/slot contention leaves only a bounded durable
				// lease, not a live execution lock. It is reusable after natural expiry.
				remaining := time.Until(after.Expires)
				if remaining > 0 {
					time.Sleep(remaining + 10*time.Millisecond)
				}
				otherSvc, _ := New(s, src, &fakeRunner{output: []byte("TEST lifecycle artifact")})
				if err = otherSvc.RunOne(context.Background(), other); err != nil {
					t.Fatalf("unrelated job cannot progress: %v", err)
				}
				completed, _ := s.Get(other)
				if completed.State != Complete || completed.Slot != j.Slot {
					t.Fatal("released slot was not reused")
				}
				final, _ := s.Get(k)
				if final != after {
					t.Fatal("late persistence after RunOne returned")
				}
			})
		}
	}
}

func TestCheckpointLeaseExpiresDuringBlobWait(t *testing.T) {
	c := testConfig()
	c.Lease = 100 * time.Millisecond
	s, err := Open(t.TempDir(), c)
	if err != nil {
		t.Fatal(err)
	}
	k := admit(t, s, 1)
	l, err := s.Claim(k)
	if err != nil {
		t.Fatal(err)
	}
	release := holdStoreLock(t, s, "blob-budget")
	done := make(chan error, 1)
	go func() { done <- s.CheckpointContext(context.Background(), l, []byte("expired")) }()
	if err = awaitResult(t, done); !errors.Is(err, ErrStale) {
		t.Fatalf("expired writer: %v", err)
	}
	release()
	fresh, err := s.Claim(k)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.CheckpointContext(context.Background(), fresh, []byte("replacement")); err != nil {
		t.Fatal(err)
	}
	if err = s.CheckpointContext(context.Background(), l, []byte("late")); !errors.Is(err, ErrStale) {
		t.Fatal(err)
	}
	j, _ := s.Get(k)
	if j.Checkpoint != Hash([]byte("replacement")) {
		t.Fatal("stale overwrite")
	}
}

// Deterministic cancellation at each actual write boundary; no production hooks
// or artificial asynchronous writer are required.
type cancelAtCheck struct {
	context.Context
	checks, at int
}

func (c *cancelAtCheck) Err() error {
	c.checks++
	if c.checks >= c.at {
		return context.Canceled
	}
	return nil
}
func TestCanceledAtomicWriteKeepsWholeOldFile(t *testing.T) {
	for at := 1; at <= 6; at++ {
		t.Run(fmt.Sprint(at), func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "record")
			old := []byte("old committed record")
			if err := atomicBytes(path, old); err != nil {
				t.Fatal(err)
			}
			ctx := &cancelAtCheck{Context: context.Background(), at: at}
			err := atomicBytesContext(ctx, path, bytes.Repeat([]byte("n"), 128<<10))
			if at <= 5 && !errors.Is(err, context.Canceled) {
				t.Fatalf("missing cancellation: %v", err)
			}
			got, e := os.ReadFile(path)
			if e != nil {
				t.Fatal(e)
			}
			if err != nil && !bytes.Equal(got, old) {
				t.Fatal("partial/canceled replacement")
			}
			if err == nil && !bytes.Equal(got, bytes.Repeat([]byte("n"), 128<<10)) {
				t.Fatal("partial committed replacement")
			}
			entries, e := os.ReadDir(dir)
			if e != nil || len(entries) != 1 {
				t.Fatalf("temporary file leak: %v %v", entries, e)
			}
		})
	}
}
