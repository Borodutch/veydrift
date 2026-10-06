// Package runtime connects approved proving artifacts to durable chain jobs.
package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/Borodutch/veydrift/packages/battle-prover/processrunner"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

// ApprovalGate must check an independently approved immutable catalog, including
// all required proving artifacts. A circuit setup or fixture is not an approval.
type ApprovalGate interface {
	Ready(context.Context, service.Identity) error
}

// ArtifactChecker must verify the complete final proof, identity and output
// suffix. Process success alone is never an accepted proof.
type ArtifactChecker interface {
	Verify(context.Context, service.Snapshot, []byte) error
}

type ProcessRunner struct {
	cfg     processrunner.Config
	gate    ApprovalGate
	checker ArtifactChecker
	run     func(context.Context, processrunner.Request, chan<- processrunner.CheckpointEvent) (processrunner.Result, error)
}

var _ service.Runner = (*ProcessRunner)(nil)

// NewProcessRunner uses only the real pinned Linux supervisor. There is no
// command-string, fixture, development setup, or unbounded in-process fallback.
func NewProcessRunner(cfg processrunner.Config, gate ApprovalGate, checker ArtifactChecker) (*ProcessRunner, error) {
	if gate == nil || checker == nil {
		return nil, errors.New("approved catalog and final artifact verifier required")
	}
	supervisor, err := processrunner.New(cfg)
	if err != nil {
		return nil, err
	}
	return &ProcessRunner{cfg: cfg, gate: gate, checker: checker, run: supervisor.Run}, nil
}

func (r *ProcessRunner) Ready(ctx context.Context, id service.Identity) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := id.Validate(); err != nil {
		return err
	}
	if id.Rules != r.cfg.Manifest.RulesSHA256 || id.Verifier != r.cfg.Manifest.VerifierSHA256 {
		return errors.New("job outside pinned engine release")
	}
	return r.gate.Ready(ctx, id)
}

func (r *ProcessRunner) snapshot(ctx context.Context, s service.Snapshot) error {
	if err := r.Ready(ctx, s.Identity); err != nil {
		return err
	}
	if len(s.Input) == 0 || len(s.Input) > r.cfg.MaxInputBytes || service.Hash(s.Input) != s.Identity.InputHash {
		return errors.New("snapshot input identity or size mismatch")
	}
	return nil
}

// Durable process checkpoint includes the original chain anchor, even when an
// identical input is reanchored after a reorg. The engine bytes are untrusted:
// the engine must independently verify every resumed proof/cursor.
// DurableCheckpointLimit accounts for JSON/base64 plus the bounded canonical
// uint256 identity, anchor and manifest metadata. Zero means invalid raw limit.
func DurableCheckpointLimit(raw int) int {
	if raw < 1 || raw > 256<<20 {
		return 0
	}
	return 4*((raw+2)/3) + 4096
}

type processCheckpoint struct {
	Version  int
	Identity service.Identity
	Anchor   service.Anchor
	Manifest string
	Data     []byte
}

func (r *ProcessRunner) Prove(ctx context.Context, snap service.Snapshot, resume []byte, save func([]byte) error) ([]byte, error) {
	if err := r.snapshot(ctx, snap); err != nil {
		return nil, err
	}
	if save == nil {
		return nil, errors.New("durable fenced checkpoint callback required")
	}
	req := processrunner.Request{Identity: snap.Identity.Key(), RulesSHA256: snap.Identity.Rules, VerifierSHA256: snap.Identity.Verifier, Input: snap.Input}
	if len(resume) > 0 {
		if len(resume) > DurableCheckpointLimit(r.cfg.MaxCheckpointBytes) {
			return nil, errors.New("oversized resume envelope")
		}
		var c processCheckpoint
		if err := json.Unmarshal(resume, &c); err != nil {
			return nil, err
		}
		canonical, err := json.Marshal(c)
		if err != nil || !bytes.Equal(canonical, resume) {
			return nil, errors.New("noncanonical resume envelope")
		}
		if c.Version != 1 || c.Identity != snap.Identity || c.Anchor != snap.Anchor || c.Manifest != r.cfg.ManifestSHA256 || len(c.Data) == 0 || len(c.Data) > r.cfg.MaxCheckpointBytes {
			return nil, errors.New("stale resume envelope")
		}
		req.Checkpoint = &processrunner.Checkpoint{Identity: req.Identity, ManifestSHA256: c.Manifest, Data: c.Data}
	}
	work, cancel := context.WithCancel(ctx)
	defer cancel()
	events := make(chan processrunner.CheckpointEvent)
	type outcome struct {
		result processrunner.Result
		err    error
	}
	done := make(chan outcome, 1)
	go func() { result, err := r.run(work, req, events); done <- outcome{result, err} }()
	var persistenceError error
	for {
		select {
		case event := <-events:
			cp := event.Checkpoint
			err := persistenceError
			if err == nil && (cp.Identity != req.Identity || cp.ManifestSHA256 != r.cfg.ManifestSHA256 || len(cp.Data) == 0 || len(cp.Data) > r.cfg.MaxCheckpointBytes) {
				err = errors.New("process checkpoint identity mismatch")
			}
			var data []byte
			if err == nil {
				data, err = json.Marshal(processCheckpoint{1, snap.Identity, snap.Anchor, r.cfg.ManifestSHA256, cp.Data})
			}
			if err == nil && len(data) > DurableCheckpointLimit(r.cfg.MaxCheckpointBytes) {
				err = errors.New("oversized durable checkpoint envelope")
			}
			if err == nil {
				err = work.Err()
			}
			if err == nil {
				err = save(data)
			}
			// The supervisor supplies a buffered acknowledgment channel; it does not
			// advance until this durable/fenced callback has succeeded.
			event.Ack <- err
			if err != nil {
				persistenceError = err
				cancel()
			}
		case out := <-done:
			if persistenceError != nil {
				return nil, persistenceError
			}
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if out.err != nil {
				return nil, out.err
			}
			if out.result.Identity != req.Identity || out.result.ManifestSHA256 != r.cfg.ManifestSHA256 {
				return nil, errors.New("process result identity mismatch")
			}
			if len(out.result.Proof) == 0 || len(out.result.Proof) > r.cfg.MaxProofBytes {
				return nil, errors.New("empty or oversized process result")
			}
			if err := r.Verify(ctx, snap, out.result.Proof); err != nil {
				return nil, fmt.Errorf("engine final proof: %w", err)
			}
			return out.result.Proof, nil
		}
	}
}

func (r *ProcessRunner) Verify(ctx context.Context, snap service.Snapshot, artifact []byte) error {
	if err := r.snapshot(ctx, snap); err != nil {
		return err
	}
	if len(artifact) == 0 || len(artifact) > r.cfg.MaxProofBytes {
		return errors.New("empty or oversized final artifact")
	}
	return r.checker.Verify(ctx, snap, artifact)
}
