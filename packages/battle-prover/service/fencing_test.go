package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// Deliberately ignores cancellation until released, like a paused child runner.
type pausedRunner struct {
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (r *pausedRunner) Ready(context.Context, Identity) error          { return nil }
func (r *pausedRunner) Verify(context.Context, Snapshot, []byte) error { return nil }
func (r *pausedRunner) Prove(context.Context, Snapshot, []byte, func([]byte) error) ([]byte, error) {
	first := false
	r.once.Do(func() { first = true; close(r.entered) })
	if !first {
		return nil, errors.New("duplicate execution")
	}
	<-r.release
	return nil, context.Canceled
}

func TestLiveExecutionCannotMoveToSpareSlot(t *testing.T) {
	for _, replacement := range []string{"expired", "reanchor", "recreate"} {
		for _, operation := range []string{"claim", "run"} {
			t.Run(replacement+"/"+operation, func(t *testing.T) {
				c := testConfig()
				c.Lease = 200 * time.Millisecond
				s, err := Open(t.TempDir(), c)
				if err != nil {
					t.Fatal(err)
				}
				snap := fixture(1)
				src := &fakeSource{snaps: map[Identity]Snapshot{snap.Identity: snap}, canonical: true}
				runner := &pausedRunner{entered: make(chan struct{}), release: make(chan struct{})}
				svc, err := New(s, src, runner)
				if err != nil {
					t.Fatal(err)
				}
				k := admit(t, s, 1)
				ctx, cancel := context.WithCancel(context.Background())
				done := make(chan error, 1)
				go func() { done <- svc.RunOne(ctx, k) }()
				released := false
				defer func() {
					cancel()
					if !released {
						close(runner.release)
						<-done
					}
				}()
				select {
				case <-runner.entered:
				case e := <-done:
					done <- e
					t.Fatalf("runner did not enter: %v", e)
				case <-time.After(time.Second):
					t.Fatal("runner did not enter")
				}
				cancel()
				time.Sleep(300 * time.Millisecond)
				j, err := s.Get(k)
				if err != nil {
					t.Fatal(err)
				}
				if time.Now().Before(j.Expires) {
					t.Fatal("lease did not expire")
				}
				if replacement != "expired" {
					if err = s.invalidate(j, "test reorg"); err != nil {
						t.Fatal(err)
					}
					if replacement == "recreate" {
						if err = s.Prune(k); err != nil {
							t.Fatal(err)
						}
						admit(t, s, 1)
					} else {
						// The old runner has stopped reading Source while blocked in Prove.
						snap.Anchor.Hash = Hash([]byte("replacement block"))
						src.snaps[snap.Identity] = snap
						if err = svc.Reconcile(context.Background()); err != nil {
							t.Fatal(err)
						}
					}
				}
				if operation == "claim" {
					_, err = s.Claim(k)
				} else {
					err = svc.RunOne(context.Background(), k)
				}
				if !errors.Is(err, ErrBusy) {
					t.Errorf("same live job admitted to spare slot: %v", err)
				}
				other := admit(t, s, 2)
				if _, err = s.Claim(other); err != nil {
					t.Errorf("unrelated job lost spare capacity: %v", err)
				}
				close(runner.release)
				<-done
				released = true
				if _, err = s.Claim(k); err != nil {
					t.Errorf("job exclusion not released after runner return: %v", err)
				}
			})
		}
	}
}

type blockedCanonicalSource struct {
	*fakeSource
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (s *blockedCanonicalSource) Canonical(ctx context.Context, a, head Anchor) (bool, error) {
	blocked := false
	s.once.Do(func() { blocked = true; close(s.entered) })
	if blocked {
		<-s.release
		return false, nil
	}
	return s.fakeSource.Canonical(ctx, a, head)
}

func TestStaleCanonicalCannotInvalidateReplacement(t *testing.T) {
	for _, observer := range []string{"snapshot", "reconcile"} {
		for _, replacement := range []string{"reanchor", "same-anchor", "recreate"} {
			// Reconciliation serializes passes; a concurrent snapshot can still invalidate,
			// prune and recreate while a pass is waiting on chain I/O.
			if observer == "reconcile" && replacement != "recreate" {
				continue
			}
			t.Run(observer+"/"+replacement, func(t *testing.T) {
				svc, src, _ := serviceFixture(t)
				ctx := context.Background()
				if err := svc.Reconcile(ctx); err != nil {
					t.Fatal(err)
				}
				k := fixture(1).Identity.Key()
				old, err := svc.Store.Get(k)
				if err != nil {
					t.Fatal(err)
				}
				blocked := &blockedCanonicalSource{fakeSource: src, entered: make(chan struct{}), release: make(chan struct{})}
				observerSvc, err := New(svc.Store, blocked, &fakeRunner{})
				if err != nil {
					t.Fatal(err)
				}
				done := make(chan error, 1)
				go func() {
					if observer == "snapshot" {
						_, e := observerSvc.snapshot(ctx, old)
						done <- e
					} else {
						done <- observerSvc.Reconcile(ctx)
					}
				}()
				released := false
				defer func() {
					if !released {
						close(blocked.release)
						<-done
					}
				}()
				<-blocked.entered
				if err = svc.Store.invalidate(old, "newer reorg observation"); err != nil {
					t.Fatal(err)
				}
				if replacement != "recreate" {
					snap := src.snaps[old.Identity]
					if replacement == "reanchor" {
						snap.Anchor.Hash = Hash([]byte("reanchored block"))
					}
					src.snaps[old.Identity] = snap
					if err = svc.Reconcile(ctx); err != nil {
						t.Fatal(err)
					}
				} else {
					if err = svc.Store.Prune(k); err != nil {
						t.Fatal(err)
					}
					// Identical identity AND anchor: only a durable generation detects this ABA.
					if _, err = svc.Discover(ctx, old.Identity); err != nil {
						t.Fatal(err)
					}
				}
				fresh, err := svc.Store.Claim(k)
				if err != nil {
					t.Fatal(err)
				}
				if err = svc.Store.Checkpoint(fresh, []byte("new generation progress")); err != nil {
					t.Fatal(err)
				}
				reopened, err := Open(svc.Store.root, svc.Store.cfg)
				if err != nil {
					t.Fatal(err)
				}
				before, err := reopened.Get(k)
				if err != nil {
					t.Fatal(err)
				}
				if before.Generation == old.Generation || !digestRE.MatchString(before.Generation) {
					t.Fatal("replacement generation not durable/unique")
				}
				close(blocked.release)
				released = true
				if err = <-done; err == nil {
					t.Error("stale authority operation succeeded")
				}
				after, err := svc.Store.Get(k)
				if err != nil {
					t.Fatal(err)
				}
				if after != before {
					t.Errorf("stale response changed replacement: before=%+v after=%+v", before, after)
				}
			})
		}
	}
}
