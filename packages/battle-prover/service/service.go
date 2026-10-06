package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Source is a public read-only chain adapter. All methods are pinned to the
// supplied finalized head, never latest. Pending must include every unresolved
// battle (paged, limit enforced); omission on a partial page is NOT finalization.
// Canonical checks the historical anchor against head. Snapshot must return the
// original battle anchor (not the changing observation head).
type Source interface {
	Finalized(context.Context) (Anchor, error)
	Pending(context.Context, Anchor, int) ([]Identity, error)
	Snapshot(context.Context, Identity, Anchor) (Snapshot, error)
	Canonical(context.Context, Anchor, Anchor) (bool, error)
}

// Runner is deliberately mandatory and has no mock/default implementation.
// Ready checks pinned proving/verifying keys and supported manifest identities.
// Verify must cryptographically verify the ENTIRE battle and exact public
// statement for snap.Identity, not a result hash or a partial trace.
// Prove must honor cancellation and configured resource reservations. Production
// adapters should isolate heavy proving in a killable process with OS limits.
type Runner interface {
	Ready(context.Context, Identity) error
	Prove(context.Context, Snapshot, []byte, func([]byte) error) ([]byte, error)
	Verify(context.Context, Snapshot, []byte) error
}

// ContextRunner propagates a runner's narrower deadline into synchronous saves.
// Existing Runner implementations retain parent and lease cancellation.
type ContextRunner interface {
	ProveContext(context.Context, Snapshot, []byte, func(context.Context, []byte) error) ([]byte, error)
}

type Service struct {
	Store       *Store
	Source      Source
	Runner      Runner
	mu          sync.Mutex
	lastSync    time.Time
	sourceError string
}

func New(s *Store, src Source, r Runner) (*Service, error) {
	if s == nil || src == nil || r == nil {
		return nil, errors.New("store, finalized source and real runner required")
	}
	return &Service{Store: s, Source: src, Runner: r}, nil
}
func (s *Service) sourceStatus(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		s.sourceError = err.Error()
	} else {
		s.sourceError = ""
		s.lastSync = time.Now()
	}
}

// Discover handles duplicate/replayed event hints idempotently. No event-provided
// payload enters the queue; the source fetches authoritative finalized bytes.
func (s *Service) Discover(ctx context.Context, id Identity) (string, error) {
	if err := id.Validate(); err != nil {
		return "", err
	}
	head, err := s.Source.Finalized(ctx)
	if err != nil {
		return "", err
	}
	if err = head.validate(); err != nil {
		return "", err
	}
	snap, err := s.Source.Snapshot(ctx, id, head)
	if err != nil {
		return "", err
	}
	if snap.Identity != id {
		return "", errors.New("source identity mismatch")
	}
	if err = s.checkSnapshot(ctx, snap, head); err != nil {
		return "", err
	}
	return s.Store.admit(snap)
}
func (s *Service) checkSnapshot(ctx context.Context, snap Snapshot, head Anchor) error {
	if err := snap.validate(s.Store.cfg.MaxInputBytes); err != nil {
		return err
	}
	if snap.Anchor.Number > head.Number {
		return errors.New("snapshot is not finalized")
	}
	ok, err := s.Source.Canonical(ctx, snap.Anchor, head)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("snapshot anchor not canonical")
	}
	return s.Runner.Ready(ctx, snap.Identity)
}

// Reconcile runs at startup and periodically in the host. Scan public pending
// state even when events were missed. Source errors fail closed, never invalidate
// jobs by absence, and leave the previous durable cursor untouched.
func (s *Service) Reconcile(ctx context.Context) (err error) {
	defer func() { s.sourceStatus(err) }()
	// Serialize only reconciliation passes, never worker execution.
	return s.Store.lock("reconciliation", func() error { return s.reconcile(ctx) })
}
func (s *Service) reconcile(ctx context.Context) error {
	head, err := s.Source.Finalized(ctx)
	if err != nil {
		return err
	}
	if err = head.validate(); err != nil {
		return err
	}
	jobs, err := s.Store.List()
	if err != nil {
		return err
	}
	for _, j := range jobs {
		if j.State == Invalid {
			continue
		}
		ok, e := s.Source.Canonical(ctx, j.Anchor, head)
		if e != nil {
			return e
		}
		if !ok || j.Anchor.Number > head.Number {
			if e = s.Store.invalidateContext(ctx, j, "finalized anchor reorganized"); e != nil {
				return e
			}
		}
	}
	ids, err := s.Source.Pending(ctx, head, s.Store.cfg.MaxJobs+1)
	if err != nil {
		return err
	}
	if len(ids) > s.Store.cfg.MaxJobs {
		return ErrBackpressure
	}
	for _, id := range ids {
		if err = id.Validate(); err != nil {
			return err
		}
		snap, e := s.Source.Snapshot(ctx, id, head)
		if e != nil {
			return e
		}
		if snap.Identity != id {
			return errors.New("pending identity mismatch")
		}
		if e = s.checkSnapshot(ctx, snap, head); e != nil {
			return e
		}
		// A reorg may reanchor identical input. An invalid record has no cached proof
		// or checkpoint; safely replace only after authoritative revalidation.
		e = s.Store.lock(id.Key(), func() error {
			j, e := s.Store.get(id.Key())
			if errors.Is(e, os.ErrNotExist) {
				return nil
			}
			if e != nil {
				return e
			}
			if j.State != Invalid {
				return nil
			}
			generation, e := token()
			if e != nil {
				return e
			}
			j.Generation = generation
			j.Anchor = snap.Anchor
			j.State = Queued
			j.Token = ""
			j.Slot = -1
			j.Expires = time.Time{}
			j.Failure = ""
			j.Updated = time.Now()
			return s.Store.put(j)
		})
		if e != nil {
			return e
		}
		if _, e = s.Store.admit(snap); e != nil {
			return e
		}
	}
	return atomicJSON(filepath.Join(s.Store.root, "reconciled.json"), struct {
		Head Anchor
		At   time.Time
	}{head, time.Now()})
}
func (s *Service) snapshot(ctx context.Context, j Job) (Snapshot, error) {
	head, err := s.Source.Finalized(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	if err = head.validate(); err != nil {
		return Snapshot{}, err
	}
	canonical, err := s.Source.Canonical(ctx, j.Anchor, head)
	if err != nil {
		return Snapshot{}, err
	}
	if !canonical || j.Anchor.Number > head.Number {
		if err = s.Store.invalidateContext(ctx, j, "finalized anchor reorganized"); err != nil {
			return Snapshot{}, err
		}
		return Snapshot{}, errors.New("finalized anchor reorganized")
	}
	snap, err := s.Source.Snapshot(ctx, j.Identity, head)
	if err != nil {
		return snap, err
	}
	if snap.Identity != j.Identity || snap.Anchor != j.Anchor {
		return snap, errors.New("authoritative snapshot changed")
	}
	return snap, s.checkSnapshot(ctx, snap, head)
}

// RunOne processes one claimed job. A heartbeat renews ownership, not progress;
// only a persisted checkpoint advances Updated. Every failure remains failure.
func (s *Service) RunOne(ctx context.Context, k string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	jobExecution, err := s.Store.holdJobExecution(k)
	if err != nil {
		return err
	}
	defer releaseExecution(jobExecution)
	l, err := s.Store.claimContext(ctx, k)
	if err != nil {
		return err
	}
	execution, err := s.Store.holdExecution(l.Slot)
	if err != nil {
		return err
	}
	defer releaseExecution(execution)
	if err = s.Store.RenewContext(ctx, l); err != nil {
		return err
	}
	work, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := make(chan struct{})
	done := make(chan struct{})
	leaseErr := make(chan error, 1)
	go func() {
		defer close(done)
		ticker := time.NewTicker(s.Store.cfg.Lease / 3)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-work.Done():
				return
			case <-ticker.C:
				if e := s.Store.RenewContext(work, l); e != nil {
					leaseErr <- e
					cancel()
					return
				}
			}
		}
	}()
	defer func() { close(stop); cancel(); <-done }()
	fail := func(e error) error {
		// A canceled context cannot clean up; an unbounded finish retains execution
		// locks. Try synchronously with a short independent bound, then let the durable
		// reservation expire if contended. No writer survives RunOne.
		cleanup, stopCleanup := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer stopCleanup()
		_ = s.Store.finishContext(cleanup, l, Failed, "", e.Error())
		return e
	}
	j, err := s.Store.Get(k)
	if err != nil {
		return fail(err)
	}
	snap, err := s.snapshot(work, j)
	if err != nil {
		return fail(err)
	}
	var checkpoint []byte
	if j.Checkpoint != "" {
		checkpoint, err = s.Store.Blob(j.Checkpoint)
		if err != nil {
			return fail(err)
		}
	}
	var proof []byte
	if runner, ok := s.Runner.(ContextRunner); ok {
		proof, err = runner.ProveContext(work, snap, checkpoint, func(checkpointCtx context.Context, b []byte) error {
			saveCtx, stopSave := context.WithCancel(checkpointCtx)
			stopWork := context.AfterFunc(work, stopSave)
			defer func() { stopWork(); stopSave() }()
			if err := work.Err(); err != nil {
				return err
			}
			return s.Store.CheckpointContext(saveCtx, l, b)
		})
	} else {
		proof, err = s.Runner.Prove(work, snap, checkpoint, func(b []byte) error { return s.Store.CheckpointContext(work, l, b) })
	}
	if err != nil {
		return fail(err)
	}
	if err = work.Err(); err != nil {
		return fail(err)
	}
	if len(proof) == 0 || len(proof) > s.Store.cfg.MaxArtifactBytes {
		return fail(errors.New("empty or oversized proof"))
	}
	if err = s.Runner.Verify(work, snap, proof); err != nil {
		return fail(fmt.Errorf("complete proof verification: %w", err))
	}
	// Re-read finalized authority after the expensive computation. No changed
	// seed/input/rules/verifier may silently reuse the result.
	if _, err = s.snapshot(work, j); err != nil {
		return fail(err)
	}
	if err = work.Err(); err != nil {
		return fail(err)
	}
	select {
	case err = <-leaseErr:
		return err
	default:
	}
	// Write only after fencing check; finish performs another fencing check.
	var hash string
	err = s.Store.withLeaseContext(work, l, func(ctx context.Context, _ *Job, _ *slot) error {
		var e error
		hash, e = s.Store.blobContext(ctx, proof)
		return e
	})
	if err != nil {
		return fail(err)
	}
	return s.Store.finishContext(work, l, Complete, hash, "")
}

// Proof returns only a still-canonical, cryptographically reverified complete
// artifact. Consumers must independently preflight authority before submission.
func (s *Service) Proof(ctx context.Context, k string) ([]byte, error) {
	j, err := s.Store.Get(k)
	if err != nil {
		return nil, err
	}
	if j.State != Complete || j.Proof == "" {
		return nil, errors.New("no complete proof")
	}
	snap, err := s.snapshot(ctx, j)
	if err != nil {
		return nil, err
	}
	b, err := s.Store.Blob(j.Proof)
	if err != nil {
		return nil, err
	}
	if err = s.Runner.Verify(ctx, snap, b); err != nil {
		return nil, err
	}
	current, err := s.Store.Get(k)
	if err != nil {
		return nil, err
	}
	if current.State != Complete || current.Proof != j.Proof || current.Anchor != j.Anchor || current.Generation != j.Generation {
		return nil, ErrStale
	}
	return b, nil
}

type Health struct {
	Live                bool
	Ready               bool
	SourceLag           bool
	Queued              int
	Running             int
	Failed              int
	Invalid             int
	Complete            int
	Stuck               int
	Expired             int
	OldestQueuedSeconds int64
	Error               string
}

func (s *Service) Health(ctx context.Context) Health {
	h := Health{Live: true}
	jobs, err := s.Store.List()
	if err != nil {
		h.Error = err.Error()
		return h
	}
	now := time.Now()
	s.mu.Lock()
	last := s.lastSync
	sourceError := s.sourceError
	s.mu.Unlock()
	h.SourceLag = last.IsZero() || now.Sub(last) > s.Store.cfg.LagAfter
	h.Error = sourceError
	keysOK := s.Runner != nil
	for _, j := range jobs {
		switch j.State {
		case Queued:
			h.Queued++
			age := int64(now.Sub(j.Created).Seconds())
			if age > h.OldestQueuedSeconds {
				h.OldestQueuedSeconds = age
			}
		case Running:
			h.Running++
			if !now.Before(j.Expires) {
				h.Expired++
			}
			if now.Sub(j.Updated) > s.Store.cfg.StuckAfter {
				h.Stuck++
			}
		case Complete:
			h.Complete++
		case Failed:
			h.Failed++
		case Invalid:
			h.Invalid++
		}
		if j.State != Invalid && keysOK {
			if e := s.Runner.Ready(ctx, j.Identity); e != nil {
				keysOK = false
				h.Error = e.Error()
			}
		}
	}
	// No empty-store READY: no pinned identity/key has actually been validated.
	h.Ready = keysOK && len(jobs) > h.Invalid && !h.SourceLag && h.Error == "" && h.Stuck == 0 && h.Expired == 0
	return h
}
func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet || (r.URL.Path != "/health" && r.URL.Path != "/ready") {
		http.NotFound(w, r)
		return
	}
	h := s.Health(r.Context())
	w.Header().Set("Content-Type", "application/json")
	if r.URL.Path == "/ready" && !h.Ready {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	_ = json.NewEncoder(w).Encode(h)
}
