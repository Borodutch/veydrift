package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/Borodutch/veydrift/packages/battle-prover/processrunner"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

func TestStageRunnerPartialNeverCompletesAndDeadlinesReset(t *testing.T) {
	r, s, checker := bridgeFixture()
	r.cfg.WallLimit = 200 * time.Millisecond
	count := 0
	saves := 0
	r.run = func(ctx context.Context, req processrunner.Request, events chan<- processrunner.CheckpointEvent) (processrunner.Result, error) {
		count++
		if count == 2 && (req.Checkpoint == nil || !bytes.Equal(req.Checkpoint.Data, []byte{1})) {
			return processrunner.Result{}, errors.New("stage prefix not resumed")
		}
		if count > 2 {
			return processrunner.Result{}, errors.New("unbounded extra invocation")
		}
		select {
		case <-time.After(120 * time.Millisecond):
		case <-ctx.Done():
			return processrunner.Result{}, ctx.Err()
		}
		data := []byte{byte(count)}
		ack := make(chan error, 1)
		events <- processrunner.CheckpointEvent{Checkpoint: processrunner.Checkpoint{Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256, Data: data}, Ack: ack}
		if err := <-ack; err != nil {
			return processrunner.Result{}, err
		}
		result := EngineStageResult{Schema: EngineStageSchema, Identity: req.Identity, CatalogSHA256: s.Identity.Verifier, CheckpointSHA256: service.Hash(data), Complete: count == 2}
		if result.Complete {
			result.Artifact = []byte("actual-verifier-candidate")
		}
		b, err := json.Marshal(result)
		return processrunner.Result{Proof: b, Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256}, err
	}
	stage := &StageRunner{worker: r}
	start := time.Now()
	result, err := stage.ProveContext(context.Background(), s, nil, func(ctx context.Context, b []byte) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		saves++
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 || saves != 2 || checker.calls != 1 || !bytes.Equal(result, []byte("actual-verifier-candidate")) {
		t.Fatal("partial stage escaped or missing final verification", count, saves, checker.calls)
	}
	if time.Since(start) < r.cfg.WallLimit {
		t.Fatal("did not cross one child deadline in total")
	}
}

func TestStageRunnerRejectsFalseCompletionAndStalledProgress(t *testing.T) {
	for _, mode := range []string{"no-checkpoint", "wrong-hash", "partial-artifact", "invalid-final", "unchanged"} {
		t.Run(mode, func(t *testing.T) {
			r, s, checker := bridgeFixture()
			calls := 0
			var resume []byte
			if mode == "unchanged" {
				resume, _ = json.Marshal(processCheckpoint{1, s.Identity, s.Anchor, r.cfg.ManifestSHA256, []byte("cursor")})
			}
			if mode == "invalid-final" {
				checker.err = errors.New("real final verifier rejects")
			}
			r.run = func(ctx context.Context, req processrunner.Request, events chan<- processrunner.CheckpointEvent) (processrunner.Result, error) {
				calls++
				if calls > 1 {
					return processrunner.Result{}, errors.New("unexpected repeated invocation")
				}
				data := []byte("cursor")
				if mode != "no-checkpoint" {
					ack := make(chan error, 1)
					events <- processrunner.CheckpointEvent{Checkpoint: processrunner.Checkpoint{Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256, Data: data}, Ack: ack}
					if err := <-ack; err != nil {
						return processrunner.Result{}, err
					}
				}
				v := EngineStageResult{Schema: EngineStageSchema, Identity: req.Identity, CatalogSHA256: s.Identity.Verifier, CheckpointSHA256: service.Hash(data)}
				if mode == "wrong-hash" {
					v.CheckpointSHA256 = service.Hash([]byte("other"))
				}
				if mode == "partial-artifact" {
					v.Artifact = []byte("not proof")
				}
				if mode == "invalid-final" {
					v.Complete = true
					v.Artifact = []byte("not proof")
				}
				b, _ := json.Marshal(v)
				return processrunner.Result{Proof: b, Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256}, nil
			}
			_, err := (&StageRunner{worker: r}).ProveContext(context.Background(), s, resume, func(context.Context, []byte) error { return nil })
			if err == nil || calls != 1 {
				t.Fatal("accepted bad stage", mode, err, calls)
			}
		})
	}
}

func TestStageRunnerRejectsAlternatingCheckpointCycle(t *testing.T) {
	r, s, _ := bridgeFixture()
	calls := 0
	r.run = func(ctx context.Context, req processrunner.Request, events chan<- processrunner.CheckpointEvent) (processrunner.Result, error) {
		calls++
		if calls > 3 {
			return processrunner.Result{}, errors.New("cycle not stopped")
		}
		data := []byte{byte(calls % 2)}
		ack := make(chan error, 1)
		events <- processrunner.CheckpointEvent{Checkpoint: processrunner.Checkpoint{Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256, Data: data}, Ack: ack}
		if err := <-ack; err != nil {
			return processrunner.Result{}, err
		}
		b, _ := json.Marshal(EngineStageResult{Schema: EngineStageSchema, Identity: req.Identity, CatalogSHA256: s.Identity.Verifier, CheckpointSHA256: service.Hash(data)})
		return processrunner.Result{Proof: b, Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256}, nil
	}
	_, err := (&StageRunner{worker: r}).ProveContext(context.Background(), s, nil, func(context.Context, []byte) error { return nil })
	if err == nil || err.Error() != "cyclic partial stage progress" || calls != 3 {
		t.Fatal(calls, err)
	}
}
