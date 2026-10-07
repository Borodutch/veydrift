package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"

	"github.com/Borodutch/veydrift/packages/battle-prover/processrunner"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

const EngineStageSchema = "veydrift-approved-engine-stage-v1"

// EngineStageResult is the runtime payload INSIDE processrunner's unverified
// result message. It does not change the processrunner transport or mean a
// completed battle unless Complete and the final cryptographic verifier pass.
type EngineStageResult struct {
	Schema           string
	Identity         string
	CatalogSHA256    string
	CheckpointSHA256 string
	Complete         bool
	Artifact         []byte
}

type StageRunner struct{ worker *ProcessRunner }

var _ service.Runner = (*StageRunner)(nil)
var _ service.ContextRunner = (*StageRunner)(nil)

func NewApprovedStageRunner(ctx context.Context, cfg processrunner.Config, catalog *Catalog, limits ArtifactLimits) (*StageRunner, error) {
	if DurableCheckpointLimit(limits.MaxArtifactBytes) == 0 || cfg.MaxProofBytes < DurableCheckpointLimit(limits.MaxArtifactBytes) {
		return nil, errors.New("process result budget below encoded final artifact envelope")
	}
	r, err := NewApprovedProcessRunner(ctx, cfg, catalog, limits)
	if err != nil {
		return nil, err
	}
	return &StageRunner{worker: r}, nil
}
func (r *StageRunner) Ready(ctx context.Context, id service.Identity) error {
	return r.worker.Ready(ctx, id)
}
func (r *StageRunner) Verify(ctx context.Context, s service.Snapshot, b []byte) error {
	return r.worker.Verify(ctx, s, b)
}
func (r *StageRunner) Prove(ctx context.Context, s service.Snapshot, resume []byte, save func([]byte) error) ([]byte, error) {
	if save == nil {
		return nil, errors.New("checkpoint callback required")
	}
	return r.ProveContext(ctx, s, resume, func(_ context.Context, b []byte) error { return save(b) })
}

type stageResultChecker struct {
	worker    *ProcessRunner
	persisted *[]byte
	resume    []byte
	result    EngineStageResult
}

func (c *stageResultChecker) Verify(ctx context.Context, s service.Snapshot, b []byte) error {
	var result EngineStageResult
	if err := json.Unmarshal(b, &result); err != nil {
		return err
	}
	encoded, err := json.Marshal(result)
	if err != nil || !bytes.Equal(encoded, b) {
		return errors.New("noncanonical stage result")
	}
	if result.Schema != EngineStageSchema || result.Identity != s.Identity.Key() || result.CatalogSHA256 != s.Identity.Verifier || !catalogHashValid(result.CheckpointSHA256) {
		return errors.New("stage result binding")
	}
	if len(*c.persisted) == 0 {
		return errors.New("stage result without durable checkpoint")
	}
	var cp processCheckpoint
	if err = json.Unmarshal(*c.persisted, &cp); err != nil {
		return err
	}
	if cp.Identity != s.Identity || cp.Anchor != s.Anchor || cp.Manifest != c.worker.cfg.ManifestSHA256 || service.Hash(cp.Data) != result.CheckpointSHA256 {
		return errors.New("stage checkpoint result mismatch")
	}
	if result.Complete {
		if err = c.worker.Verify(ctx, s, result.Artifact); err != nil {
			return err
		}
	} else {
		if len(result.Artifact) != 0 || bytes.Equal(c.resume, *c.persisted) {
			return errors.New("partial stage supplied artifact or made no progress")
		}
	}
	c.result = result
	return nil
}

// Every invocation gets a fresh independent child deadline, while the service's
// parent cancellation/lease continues across stages. Each checkpoint is saved
// synchronously under the current fenced lease BEFORE the next process starts.
// No partial stage can escape as a final proof or be served as a completed job.
func (r *StageRunner) ProveContext(ctx context.Context, s service.Snapshot, resume []byte, save func(context.Context, []byte) error) ([]byte, error) {
	if save == nil {
		return nil, errors.New("checkpoint callback required")
	}
	if len(resume) > DurableCheckpointLimit(r.worker.cfg.MaxCheckpointBytes) {
		return nil, errors.New("oversized stage resume envelope")
	}
	checkpoint := append([]byte{}, resume...)
	// Bound history by an explicit operational byte budget, not protocol work.
	// Retain every accepted partial hash in this job attempt, not just its tail.
	historyLimit := r.worker.cfg.MaxCheckpointBytes / 64
	if historyLimit < 1 {
		return nil, errors.New("stage history budget too small")
	}
	seen := map[string]struct{}{}
	if len(resume) > 0 {
		var cp processCheckpoint
		if err := json.Unmarshal(resume, &cp); err != nil {
			return nil, err
		}
		seen[service.Hash(cp.Data)] = struct{}{}
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		var persisted []byte
		checker := &stageResultChecker{worker: r.worker, persisted: &persisted, resume: checkpoint}
		invocation := *r.worker // Per-invocation checker; no shared mutable run state.
		invocation.checker = checker
		_, err := invocation.ProveContext(ctx, s, checkpoint, func(child context.Context, b []byte) error {
			if err := save(child, b); err != nil {
				return err
			}
			persisted = append([]byte{}, b...)
			return nil
		})
		if err != nil {
			return nil, err
		}
		if checker.result.Complete {
			return append([]byte{}, checker.result.Artifact...), nil
		}
		if _, repeated := seen[checker.result.CheckpointSHA256]; repeated {
			return nil, errors.New("cyclic partial stage progress")
		}
		if len(seen) >= historyLimit {
			return nil, errors.New("stage history operational budget exhausted")
		}
		seen[checker.result.CheckpointSHA256] = struct{}{}
		checkpoint = persisted
	}
}
