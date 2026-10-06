package runtime

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/Borodutch/veydrift/packages/battle-prover/processrunner"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

// These doubles exercise orchestration boundaries only, NOT cryptographic or
// Linux execution evidence. Public construction cannot substitute the transport.
type bridgeGate struct{ err error }

func (g bridgeGate) Ready(context.Context, service.Identity) error { return g.err }

type bridgeChecker struct {
	err   error
	calls int
}

func (v *bridgeChecker) Verify(context.Context, service.Snapshot, []byte) error {
	v.calls++
	return v.err
}
func bridgeFixture() (*ProcessRunner, service.Snapshot, *bridgeChecker) {
	h := strings.Repeat("a", 64)
	s := service.Snapshot{Identity: service.Identity{ChainID: "8453", Game: "0x" + strings.Repeat("1", 40), BattleID: "999999999999999999999", InputHash: service.Hash([]byte("canonical")), Rules: h, Verifier: h}, Anchor: service.Anchor{Number: 20, Hash: h}, Input: []byte("canonical")}
	c := &bridgeChecker{}
	r := &ProcessRunner{cfg: processrunner.Config{Manifest: processrunner.Manifest{RulesSHA256: h, VerifierSHA256: h}, ManifestSHA256: strings.Repeat("b", 64), MaxInputBytes: 1024, MaxCheckpointBytes: 4096, MaxProofBytes: 1024}, gate: bridgeGate{}, checker: c}
	return r, s, c
}
func TestProcessBridgeResumeAndFencing(t *testing.T) {
	r, s, v := bridgeFixture()
	var saved []byte
	crash := errors.New("simulated engine crash after durable checkpoint")
	r.run = func(ctx context.Context, req processrunner.Request, ch chan<- processrunner.CheckpointEvent) (processrunner.Result, error) {
		ack := make(chan error, 1)
		ch <- processrunner.CheckpointEvent{Checkpoint: processrunner.Checkpoint{Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256, Data: []byte("verified cursor")}, Ack: ack}
		if err := <-ack; err != nil {
			return processrunner.Result{}, err
		}
		return processrunner.Result{}, crash
	}
	if _, err := r.Prove(context.Background(), s, nil, func(b []byte) error { saved = append([]byte{}, b...); return nil }); !errors.Is(err, crash) {
		t.Fatal(err)
	}
	if len(saved) == 0 || v.calls != 0 {
		t.Fatal("missing checkpoint or premature verifier")
	}
	calls := 0
	r.run = func(ctx context.Context, req processrunner.Request, _ chan<- processrunner.CheckpointEvent) (processrunner.Result, error) {
		calls++
		if req.Checkpoint == nil || !bytes.Equal(req.Checkpoint.Data, []byte("verified cursor")) {
			t.Fatal("checkpoint not restored")
		}
		return processrunner.Result{Proof: []byte("untrusted candidate"), Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256}, nil
	}
	if _, err := r.Prove(context.Background(), s, saved, func([]byte) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if calls != 1 || v.calls != 1 {
		t.Fatal("missing result verification")
	}
	changed := s
	changed.Anchor.Number++
	if _, err := r.Prove(context.Background(), changed, saved, func([]byte) error { return nil }); err == nil {
		t.Fatal("accepted reanchored checkpoint")
	}
	if _, err := r.Prove(context.Background(), s, append(saved, byte(32)), func([]byte) error { return nil }); err == nil {
		t.Fatal("accepted noncanonical checkpoint")
	}
	if calls != 1 {
		t.Fatal("executed stale checkpoint")
	}
}
func TestProcessBridgeRejectsUnverifiedAndUnpersisted(t *testing.T) {
	r, s, v := bridgeFixture()
	r.run = func(ctx context.Context, req processrunner.Request, ch chan<- processrunner.CheckpointEvent) (processrunner.Result, error) {
		ack := make(chan error, 1)
		ch <- processrunner.CheckpointEvent{Checkpoint: processrunner.Checkpoint{Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256, Data: []byte("cursor")}, Ack: ack}
		err := <-ack
		return processrunner.Result{}, err
	}
	fenced := errors.New("fenced lease")
	if _, err := r.Prove(context.Background(), s, nil, func([]byte) error { return fenced }); !errors.Is(err, fenced) {
		t.Fatal(err)
	}
	if v.calls != 0 {
		t.Fatal("verified after failed persistence")
	}
	r.run = func(ctx context.Context, req processrunner.Request, _ chan<- processrunner.CheckpointEvent) (processrunner.Result, error) {
		return processrunner.Result{Proof: []byte("bad proof"), Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256}, nil
	}
	v.err = errors.New("cryptographic rejection")
	if _, err := r.Prove(context.Background(), s, nil, func([]byte) error { return nil }); !errors.Is(err, v.err) {
		t.Fatal(err)
	}
	r.gate = bridgeGate{errors.New("missing ceremony")}
	v.calls = 0
	if _, err := r.Prove(context.Background(), s, nil, func([]byte) error { return nil }); err == nil {
		t.Fatal("missing approval accepted")
	}
	if v.calls != 0 {
		t.Fatal("ran despite missing approval")
	}
}
func TestProcessBridgeCancellationAndInputBinding(t *testing.T) {
	r, s, _ := bridgeFixture()
	calls := 0
	r.run = func(ctx context.Context, req processrunner.Request, _ chan<- processrunner.CheckpointEvent) (processrunner.Result, error) {
		calls++
		<-ctx.Done()
		return processrunner.Result{}, ctx.Err()
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := r.Prove(ctx, s, nil, func([]byte) error { return nil }); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	s.Input = []byte("replaced")
	if _, err := r.Prove(context.Background(), s, nil, func([]byte) error { return nil }); err == nil {
		t.Fatal("input tamper accepted")
	}
	if calls != 0 {
		t.Fatal("executed invalid input")
	}
	if _, err := NewProcessRunner(r.cfg, nil, nil); err == nil {
		t.Fatal("missing dependencies accepted")
	}
}

func TestProcessBridgeFullRawCheckpointBudget(t *testing.T) {
	r, s, _ := bridgeFixture()
	r.cfg.MaxCheckpointBytes = 1024
	var saved []byte
	raw := bytes.Repeat([]byte{7}, r.cfg.MaxCheckpointBytes)
	r.run = func(ctx context.Context, req processrunner.Request, ch chan<- processrunner.CheckpointEvent) (processrunner.Result, error) {
		ack := make(chan error, 1)
		ch <- processrunner.CheckpointEvent{Checkpoint: processrunner.Checkpoint{Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256, Data: raw}, Ack: ack}
		if err := <-ack; err != nil {
			return processrunner.Result{}, err
		}
		return processrunner.Result{Proof: []byte("candidate"), Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256}, nil
	}
	if _, err := r.Prove(context.Background(), s, nil, func(b []byte) error { saved = b; return nil }); err != nil {
		t.Fatal(err)
	}
	if len(saved) <= r.cfg.MaxCheckpointBytes || len(saved) > DurableCheckpointLimit(r.cfg.MaxCheckpointBytes) {
		t.Fatal("wrong envelope budget")
	}
	r.run = func(ctx context.Context, req processrunner.Request, ch chan<- processrunner.CheckpointEvent) (processrunner.Result, error) {
		if req.Checkpoint == nil || !bytes.Equal(req.Checkpoint.Data, raw) {
			t.Error("raw checkpoint changed")
		}
		return processrunner.Result{Proof: []byte("candidate"), Identity: req.Identity, ManifestSHA256: r.cfg.ManifestSHA256}, nil
	}
	if _, err := r.Prove(context.Background(), s, saved, func([]byte) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if DurableCheckpointLimit(0) != 0 || DurableCheckpointLimit(1<<30) != 0 {
		t.Fatal("invalid raw limits accepted")
	}
}
