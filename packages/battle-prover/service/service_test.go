package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func testConfig() Config {
	return Config{MaxJobs: 20, MaxInputBytes: 1024, MaxArtifactBytes: 4096, MaxBlobBytes: 65536, Workers: 2, CPUs: 2, MemoryBytes: 200, JobCPUs: 1, JobMemoryBytes: 100, Lease: 10 * time.Second, StuckAfter: time.Second, LagAfter: time.Minute}
}
func fixture(n int) Snapshot {
	b := []byte(fmt.Sprintf("canonical public battle %d", n))
	return Snapshot{Identity: Identity{ChainID: "8453", Game: "0x1111111111111111111111111111111111111111", BattleID: fmt.Sprint(n), InputHash: Hash(b), Rules: Hash([]byte("rules")), Verifier: Hash([]byte("keys"))}, Anchor: Anchor{Number: 10, Hash: Hash([]byte("block"))}, Input: b}
}
func store(t *testing.T) *Store {
	t.Helper()
	s, e := Open(t.TempDir(), testConfig())
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func admit(t *testing.T, s *Store, n int) string {
	t.Helper()
	k, e := s.admit(fixture(n))
	if e != nil {
		t.Fatal(e)
	}
	return k
}
func expire(t *testing.T, s *Store, l Lease) {
	t.Helper()
	e := s.withLease(l, func(j *Job, sl *slot) error {
		j.Expires = time.Now().Add(-time.Second)
		sl.Expires = j.Expires
		if e := atomicJSON(s.slotPath(l.Slot), sl); e != nil {
			return e
		}
		return s.put(*j)
	})
	if e != nil {
		t.Fatal(e)
	}
}

func TestIdentityAndBounds(t *testing.T) {
	s := store(t)
	f := fixture(1)
	for _, bad := range []string{"01", "-1", "0", "1e3", strings.Repeat("9", 79)} {
		f.Identity.BattleID = bad
		if _, e := s.admit(f); e == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
	f = fixture(1)
	f.Identity.Game = strings.ToUpper(f.Identity.Game)
	if _, e := s.admit(f); e == nil {
		t.Fatal("noncanonical address")
	}
	f = fixture(1)
	f.Input = []byte("wrong")
	if _, e := s.admit(f); e == nil {
		t.Fatal("wrong commitment")
	}
	f = fixture(1)
	f.Identity.BattleID = "115792089237316195423570985008687907853269984665640564039457584007913129639935"
	if _, e := s.admit(f); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Claim("../../escape"); e == nil {
		t.Fatal("path traversal")
	}
	c := testConfig()
	c.MaxJobs = 1
	s, e := Open(t.TempDir(), c)
	if e != nil {
		t.Fatal(e)
	}
	admit(t, s, 1)
	if _, e = s.admit(fixture(2)); !errors.Is(e, ErrBackpressure) {
		t.Fatal(e)
	}
}
func TestLeaseFencingRecoveryAndIndependentJobs(t *testing.T) {
	s := store(t)
	k := admit(t, s, 1)
	k2 := admit(t, s, 2)
	k3 := admit(t, s, 3)
	l, e := s.Claim(k)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Checkpoint(l, []byte("resume")); e != nil {
		t.Fatal(e)
	}
	other, e := Open(s.root, s.cfg)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = other.Claim(k); !errors.Is(e, ErrBusy) {
		t.Fatal(e)
	}
	l2, e := other.Claim(k2)
	if e != nil {
		t.Fatal("unrelated job blocked", e)
	}
	if _, e = other.Claim(k3); !errors.Is(e, ErrBusy) {
		t.Fatal("resource cap", e)
	}
	expire(t, s, l)
	fresh, e := other.Claim(k)
	if e != nil {
		t.Fatal(e)
	}
	if fresh.Token == l.Token {
		t.Fatal("token reused")
	}
	for _, e := range []error{s.Renew(l), s.Checkpoint(l, []byte("stale")), s.finish(l, Complete, "fake", "")} {
		if !errors.Is(e, ErrStale) {
			t.Fatal("stale writer", e)
		}
	}
	j, e := other.Get(k)
	if e != nil || j.Checkpoint != Hash([]byte("resume")) || j.Attempts != 2 {
		t.Fatal(j, e)
	}
	if e = other.finish(fresh, Failed, "", "interrupted"); e != nil {
		t.Fatal(e)
	}
	if e = other.finish(l2, Failed, "", "test"); e != nil {
		t.Fatal(e)
	}
	if e = other.Retry(k); e != nil {
		t.Fatal(e)
	}
	if e = other.GC(); !errors.Is(e, ErrBusy) {
		t.Fatal("gc removed active artifacts", e)
	}
}
func TestMultiProcessClaim(t *testing.T) {
	if root := os.Getenv("QUEUE_TEST_ROOT"); root != "" {
		s, e := Open(root, testConfig())
		if e != nil {
			os.Exit(4)
		}
		_, e = s.Claim(os.Getenv("QUEUE_TEST_KEY"))
		if errors.Is(e, ErrBusy) {
			os.Exit(3)
		}
		if e != nil {
			os.Exit(4)
		}
		os.Exit(0)
	}
	s := store(t)
	k := admit(t, s, 1)
	var wg sync.WaitGroup
	results := make(chan int, 6)
	for n := 0; n < 6; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cmd := exec.Command(os.Args[0], "-test.run=^TestMultiProcessClaim$")
			cmd.Env = append(os.Environ(), "QUEUE_TEST_ROOT="+s.root, "QUEUE_TEST_KEY="+k)
			err := cmd.Run()
			if err == nil {
				results <- 0
				return
			}
			if ex, ok := err.(*exec.ExitError); ok {
				results <- ex.ExitCode()
			} else {
				results <- 99
			}
		}()
	}
	wg.Wait()
	close(results)
	won := 0
	for code := range results {
		if code == 0 {
			won++
		} else if code != 3 {
			t.Fatalf("child failed %d", code)
		}
	}
	if won != 1 {
		t.Fatalf("winners %d", won)
	}
	// Winning process exited without release: durable lease remains until expiry.
	j, e := s.Get(k)
	if e != nil {
		t.Fatal(e)
	}
	l := Lease{k, j.Token, j.Slot}
	expire(t, s, l)
	if _, e = s.Claim(k); e != nil {
		t.Fatal("crash recovery", e)
	}
}
func TestNoGlobalWorkLock(t *testing.T) {
	s := store(t)
	k1 := admit(t, s, 1)
	k2 := admit(t, s, 2)
	held := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() { done <- s.lock(k1, func() error { close(held); <-release; return nil }) }()
	<-held
	result := make(chan error, 1)
	go func() { _, e := s.Claim(k2); result <- e }()
	select {
	case e := <-result:
		if e != nil {
			t.Error(e)
		}
	case <-time.After(time.Second):
		t.Error("unrelated claim held by job lock")
	}
	close(release)
	if e := <-done; e != nil {
		t.Fatal(e)
	}
}

type fakeSource struct {
	snaps     map[Identity]Snapshot
	canonical bool
	err       error
}

func (f *fakeSource) Finalized(context.Context) (Anchor, error) {
	return Anchor{Number: 20, Hash: Hash([]byte("head"))}, f.err
}
func (f *fakeSource) Pending(context.Context, Anchor, int) ([]Identity, error) {
	ids := []Identity{}
	for id := range f.snaps {
		ids = append(ids, id)
	}
	return ids, f.err
}
func (f *fakeSource) Snapshot(_ context.Context, id Identity, _ Anchor) (Snapshot, error) {
	s, ok := f.snaps[id]
	if !ok {
		return s, errors.New("missing snapshot")
	}
	return s, f.err
}
func (f *fakeSource) Canonical(context.Context, Anchor, Anchor) (bool, error) {
	return f.canonical, f.err
}

// A rejecting test double, never shipped as a production runner. Success bytes
// are only lifecycle fixtures, not asserted to be cryptographic proof evidence.
type fakeRunner struct {
	output   []byte
	reject   bool
	readyErr error
	proveErr error
	calls    int
}

func (f *fakeRunner) Ready(context.Context, Identity) error { return f.readyErr }
func (f *fakeRunner) Prove(ctx context.Context, _ Snapshot, _ []byte, cp func([]byte) error) ([]byte, error) {
	f.calls++
	if e := cp([]byte("validated runner checkpoint")); e != nil {
		return nil, e
	}
	return f.output, f.proveErr
}
func (f *fakeRunner) Verify(context.Context, Snapshot, []byte) error {
	if f.reject {
		return errors.New("invalid proof")
	}
	return nil
}
func serviceFixture(t *testing.T) (*Service, *fakeSource, *fakeRunner) {
	t.Helper()
	s := store(t)
	snap := fixture(1)
	src := &fakeSource{snaps: map[Identity]Snapshot{snap.Identity: snap}, canonical: true}
	r := &fakeRunner{output: []byte("TEST ONLY verified artifact")}
	svc, e := New(s, src, r)
	if e != nil {
		t.Fatal(e)
	}
	return svc, src, r
}
func TestReconcileDuplicateReorgCache(t *testing.T) {
	svc, src, r := serviceFixture(t)
	ctx := context.Background()
	id := fixture(1).Identity
	if svc.Health(ctx).Ready {
		t.Fatal("empty service ready")
	}
	if e := svc.Reconcile(ctx); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 3; i++ {
		if _, e := svc.Discover(ctx, id); e != nil {
			t.Fatal(e)
		}
	}
	jobs, e := svc.Store.List()
	if e != nil || len(jobs) != 1 {
		t.Fatal(jobs, e)
	}
	if e = svc.RunOne(ctx, id.Key()); e != nil {
		t.Fatal(e)
	}
	if _, e = svc.Proof(ctx, id.Key()); e != nil {
		t.Fatal(e)
	}
	if e = svc.RunOne(ctx, id.Key()); !errors.Is(e, ErrBusy) || r.calls != 1 {
		t.Fatal("cache duplicate proof", e)
	}
	src.canonical = false
	if e = svc.Reconcile(ctx); e == nil {
		t.Fatal("accepted reorg snapshot")
	}
	j, _ := svc.Store.Get(id.Key())
	if j.State != Invalid || j.Proof != "" {
		t.Fatal(j)
	}
	if _, e = svc.Proof(ctx, id.Key()); e == nil {
		t.Fatal("served invalidated proof")
	}
	src.canonical = true
	sn := src.snaps[id]
	sn.Anchor.Hash = Hash([]byte("new block"))
	src.snaps[id] = sn
	if e = svc.Reconcile(ctx); e != nil {
		t.Fatal(e)
	}
	j, _ = svc.Store.Get(id.Key())
	if j.State != Queued || j.Checkpoint != "" || j.Anchor != sn.Anchor {
		t.Fatal(j)
	}
	if e = svc.RunOne(ctx, id.Key()); e != nil {
		t.Fatal(e)
	}
	src.err = errors.New("RPC unavailable")
	if e = svc.Reconcile(ctx); e == nil {
		t.Fatal("source outage accepted")
	}
	j, _ = svc.Store.Get(id.Key())
	if j.State != Complete {
		t.Fatal("outage invalidated state")
	}
	if svc.Health(ctx).Ready {
		t.Fatal("outage ready")
	}
}
func TestRejectPlaceholderTimeoutAndUnready(t *testing.T) {
	for _, mode := range []string{"empty", "invalid", "timeout", "keys"} {
		t.Run(mode, func(t *testing.T) {
			svc, _, r := serviceFixture(t)
			ctx := context.Background()
			if e := svc.Reconcile(ctx); e != nil {
				t.Fatal(e)
			}
			switch mode {
			case "empty":
				r.output = nil
			case "invalid":
				r.reject = true
			case "timeout":
				r.proveErr = context.DeadlineExceeded
			case "keys":
				r.readyErr = errors.New("keys missing")
			}
			if e := svc.RunOne(ctx, fixture(1).Identity.Key()); e == nil {
				t.Fatal("accepted " + mode)
			}
			j, _ := svc.Store.Get(fixture(1).Identity.Key())
			if j.State != Failed || j.Proof != "" {
				t.Fatal(j)
			}
		})
	}
}
func TestArtifactBudgetCorruptionAndGC(t *testing.T) {
	s := store(t)
	k := admit(t, s, 1)
	l, e := s.Claim(k)
	if e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 30; i++ {
		b := []byte(strings.Repeat(fmt.Sprint(i%10), 4096))
		b[0] = byte(i)
		e = s.Checkpoint(l, b)
		if errors.Is(e, ErrBackpressure) {
			break
		}
		if e != nil {
			t.Fatal(e)
		}
	}
	if !errors.Is(e, ErrBackpressure) {
		t.Fatal("no artifact cap")
	}
	if e = s.finish(l, Failed, "", "budget"); e != nil {
		t.Fatal(e)
	}
	if e = s.GC(); e != nil {
		t.Fatal(e)
	}
	if e = s.Prune(k); e != nil {
		t.Fatal(e)
	}
	if e = s.GC(); e != nil {
		t.Fatal(e)
	}
	es, _ := os.ReadDir(filepath.Join(s.root, "blobs"))
	if len(es) != 0 {
		t.Fatal("orphan blobs remain")
	}
	h, e := s.blob([]byte("original"))
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(s.root, "blobs", h), []byte("tamper"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Blob(h); e == nil {
		t.Fatal("corruption accepted")
	}
}
func TestHealthSeparatesLeaseProgressAndLag(t *testing.T) {
	svc, _, _ := serviceFixture(t)
	ctx := context.Background()
	if e := svc.Reconcile(ctx); e != nil {
		t.Fatal(e)
	}
	k := fixture(1).Identity.Key()
	l, e := svc.Store.Claim(k)
	if e != nil {
		t.Fatal(e)
	}
	e = svc.Store.withLease(l, func(j *Job, _ *slot) error { j.Updated = time.Now().Add(-2 * time.Second); return svc.Store.put(*j) })
	if e != nil {
		t.Fatal(e)
	}
	if e = svc.Store.Renew(l); e != nil {
		t.Fatal(e)
	}
	h := svc.Health(ctx)
	if h.Stuck != 1 || h.Expired != 0 || h.SourceLag || h.Ready {
		t.Fatal(h)
	}
	expire(t, svc.Store, l)
	h = svc.Health(ctx)
	if h.Expired != 1 {
		t.Fatal(h)
	}
}

func TestExpiredRunnerKeepsResourceReservation(t *testing.T) {
	c := testConfig()
	c.Workers = 1
	s, e := Open(t.TempDir(), c)
	if e != nil {
		t.Fatal(e)
	}
	k := admit(t, s, 1)
	other := admit(t, s, 2)
	l, e := s.Claim(k)
	if e != nil {
		t.Fatal(e)
	}
	held, e := s.holdExecution(l.Slot)
	if e != nil {
		t.Fatal(e)
	}
	expire(t, s, l)
	if _, e = s.Claim(other); !errors.Is(e, ErrBusy) {
		t.Fatal("overlapping execution after expiry", e)
	}
	if _, e = s.Claim(k); !errors.Is(e, ErrBusy) {
		t.Fatal("overlapping same job", e)
	}
	releaseExecution(held)
	if _, e = s.Claim(k); e != nil {
		t.Fatal(e)
	}
}
func TestCrashBetweenSlotAndJobWrite(t *testing.T) {
	c := testConfig()
	c.Workers = 1
	s, e := Open(t.TempDir(), c)
	if e != nil {
		t.Fatal(e)
	}
	k := admit(t, s, 1)
	if e = atomicJSON(s.slotPath(0), slot{k, "orphan", time.Now().Add(time.Hour)}); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Claim(k); !errors.Is(e, ErrBusy) {
		t.Fatal("stole unexpired orphan slot", e)
	}
	if e = atomicJSON(s.slotPath(0), slot{k, "orphan", time.Now().Add(-time.Second)}); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(s.root, "jobs", ".tmp-crash"), []byte("partial JSON"), 0600); e != nil {
		t.Fatal(e)
	}
	restarted, e := Open(s.root, c)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = restarted.Claim(k); e != nil {
		t.Fatal(e)
	}
}
func TestReorgFencesActiveLease(t *testing.T) {
	svc, src, _ := serviceFixture(t)
	ctx := context.Background()
	if e := svc.Reconcile(ctx); e != nil {
		t.Fatal(e)
	}
	k := fixture(1).Identity.Key()
	l, e := svc.Store.Claim(k)
	if e != nil {
		t.Fatal(e)
	}
	src.canonical = false
	_ = svc.Reconcile(ctx)
	if e = svc.Store.Checkpoint(l, []byte("late")); !errors.Is(e, ErrStale) {
		t.Fatal(e)
	}
	if e = svc.Store.finish(l, Complete, "placeholder", ""); !errors.Is(e, ErrStale) {
		t.Fatal(e)
	}
}
