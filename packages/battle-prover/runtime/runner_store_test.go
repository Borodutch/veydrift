package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/Borodutch/veydrift/packages/battle-prover/processrunner"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

type bridgeStoreSource struct {
	snapshots map[string]service.Snapshot
	head      service.Anchor
}

func (s bridgeStoreSource) Finalized(context.Context) (service.Anchor, error) { return s.head, nil }
func (s bridgeStoreSource) Pending(context.Context, service.Anchor, int) ([]service.Identity, error) {
	var out []service.Identity
	for _, snap := range s.snapshots {
		out = append(out, snap.Identity)
	}
	return out, nil
}
func (s bridgeStoreSource) Snapshot(_ context.Context, id service.Identity, _ service.Anchor) (service.Snapshot, error) {
	snap, ok := s.snapshots[id.Key()]
	if !ok {
		return snap, errors.New("unknown snapshot")
	}
	return snap, nil
}
func (s bridgeStoreSource) Canonical(_ context.Context, a, b service.Anchor) (bool, error) {
	return a == s.head && b == s.head, nil
}

// Real service.RunOne + real Store.CheckpointContext and POSIX flock. Transport
// and artifact checker are isolated doubles: this is not Linux/proof evidence.
func TestProcessBridgeActualStoreChildDeadlineRestart(t *testing.T) {
	r, first, _ := bridgeFixture()
	r.cfg.WallLimit = 700 * time.Millisecond
	second := first
	second.Identity.BattleID = "2"
	source := bridgeStoreSource{map[string]service.Snapshot{first.Identity.Key(): first, second.Identity.Key(): second}, first.Anchor}
	root := t.TempDir()
	cfg := service.Config{MaxJobs: 4, MaxInputBytes: 1024, MaxArtifactBytes: 16384, MaxBlobBytes: 1 << 20, Workers: 1, CPUs: 2, MemoryBytes: 2 << 30, JobCPUs: 2, JobMemoryBytes: 2 << 30, Lease: 3 * time.Second, StuckAfter: time.Minute, LagAfter: time.Minute}
	store, err := service.Open(root, cfg)
	if err != nil {
		t.Fatal(err)
	}
	svc, err := service.New(store, source, r)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []service.Identity{first.Identity, second.Identity} {
		if _, err = svc.Discover(context.Background(), id); err != nil {
			t.Fatal(err)
		}
	}
	saved := make(chan struct{})
	proceed := make(chan struct{})
	attempted := make(chan struct{})
	joined := make(chan struct{})
	r.run = func(ctx context.Context, req processrunner.Request, events chan<- processrunner.CheckpointEvent) (processrunner.Result, error) {
		defer close(joined)
		ack := make(chan error, 1)
		events <- processrunner.CheckpointEvent{Checkpoint: processrunner.Checkpoint{Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256, Data: []byte("durable-first")}, Ack: ack}
		if e := <-ack; e != nil {
			return processrunner.Result{}, e
		}
		close(saved)
		select {
		case <-proceed:
		case <-ctx.Done():
			return processrunner.Result{}, ctx.Err()
		}
		ack = make(chan error, 1)
		events <- processrunner.CheckpointEvent{Checkpoint: processrunner.Checkpoint{Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256, Data: []byte("must-not-persist")}, Ack: ack}
		close(attempted)
		<-ctx.Done()
		return processrunner.Result{}, ctx.Err()
	}
	parent := context.Background() // Must remain alive; only child WallLimit expires.
	done := make(chan error, 1)
	go func() { done <- svc.RunOne(parent, first.Identity.Key()) }()
	select {
	case <-saved:
	case err := <-done:
		t.Fatalf("ended before first save: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("no first checkpoint")
	}
	lock, err := os.OpenFile(filepath.Join(root, "locks", "blob-budget.lock"), os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	close(proceed)
	select {
	case <-attempted:
	case <-time.After(time.Second):
		t.Fatal("checkpoint not attempted")
	}
	select {
	case err = <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("want independent child deadline, got %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("child deadline failed to release blocked real-store checkpoint")
	}
	if parent.Err() != nil {
		t.Fatal("test canceled parent")
	}
	select {
	case <-joined:
	default:
		t.Fatal("supervisor not joined")
	}
	job, err := store.Get(first.Identity.Key())
	if err != nil {
		t.Fatal(err)
	}
	if job.State != service.Failed || job.Proof != "" || job.Checkpoint == "" {
		t.Fatalf("bad durable state: %+v", job)
	}
	cp, err := store.Blob(job.Checkpoint)
	if err != nil {
		t.Fatal(err)
	}
	var envelope processCheckpoint
	if err = json.Unmarshal(cp, &envelope); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(envelope.Data, []byte("durable-first")) {
		t.Fatal("canceled checkpoint replaced durable prefix")
	}
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_UN); err != nil {
		t.Fatal(err)
	}
	// New store/runner instance proves released capacity and real persisted resume.
	reopened, err := service.Open(root, cfg)
	if err != nil {
		t.Fatal(err)
	}
	next, _, _ := bridgeFixture()
	next.cfg.WallLimit = time.Second
	next.run = func(_ context.Context, req processrunner.Request, _ chan<- processrunner.CheckpointEvent) (processrunner.Result, error) {
		if req.Identity == first.Identity.Key() && (req.Checkpoint == nil || !bytes.Equal(req.Checkpoint.Data, []byte("durable-first"))) {
			return processrunner.Result{}, errors.New("durable prefix was not restored")
		}
		return processrunner.Result{Identity: req.Identity, ManifestSHA256: next.cfg.ManifestSHA256, Proof: []byte("candidate")}, nil
	}
	fresh, err := service.New(reopened, source, next)
	if err != nil {
		t.Fatal(err)
	}
	if err = fresh.RunOne(context.Background(), second.Identity.Key()); err != nil {
		t.Fatalf("capacity retained after cancellation: %v", err)
	}
	if err = reopened.Retry(first.Identity.Key()); err != nil {
		t.Fatal(err)
	}
	if err = fresh.RunOne(context.Background(), first.Identity.Key()); err != nil {
		t.Fatalf("restart failed: %v", err)
	}
	after, err := reopened.Get(first.Identity.Key())
	if err != nil || after.State != service.Complete {
		t.Fatal(after, err)
	}
	if after.Checkpoint != job.Checkpoint {
		t.Fatal("late canceled checkpoint write")
	}
}
