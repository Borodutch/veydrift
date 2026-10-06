package main

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	"os"
	"path/filepath"
	"testing"
)

func TestConfigResourceAndApprovalGates(t *testing.T) {
	var c config
	c.Store = "/unused"
	c.IntervalSeconds = 1
	c.Queue.Workers = 1
	c.Queue.JobCPUs = 2
	c.Queue.JobMemoryBytes = 2 << 30
	c.Queue.MaxInputBytes = 100
	c.Queue.MaxArtifactBytes = 5000
	c.Process.CPUs = 2
	c.Process.AddressSpaceBytes = 2 << 30
	c.Process.MaxInputBytes = 100
	c.Process.MaxProofBytes = 100
	c.Process.MaxCheckpointBytes = 100
	c.Source.Release.VerifierManifest = "pinned"
	c.Catalog.TrustedManifestSHA256 = "pinned"
	c.Source.Release.Rules = "rules"
	c.Process.Manifest.RulesSHA256 = "rules"
	// This tests cross-configuration limits only; downstream constructors enforce
	// actual digest/address/key/provenance requirements before network or work.
	path := filepath.Join(t.TempDir(), "config.json")
	check := func(x config, want bool) {
		t.Helper()
		b, e := json.Marshal(x)
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(path, b, 0600); e != nil {
			t.Fatal(e)
		}
		_, e = load(path)
		if (e == nil) != want {
			t.Fatalf("accepted=%v want=%v err=%v", e == nil, want, e)
		}
	}
	check(c, true)
	x := c
	x.Process.CPUs = 3
	check(x, false)
	x = c
	x.Process.AddressSpaceBytes++
	check(x, false)
	x = c
	x.Source.Release.VerifierManifest = "wrong"
	check(x, false)
	x = c
	x.Queue.MaxArtifactBytes = 99
	check(x, false)
	x = c
	x.Queue.Workers = 2
	check(x, false)
	x = c
	x.IntervalSeconds = 0
	check(x, false)
	if e := os.WriteFile(path, []byte(`{"Unknown":1}`), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e := load(path); e == nil {
		t.Fatal("unknown field accepted")
	}
}

func TestOrdinaryJobFailureDoesNotStopContinuousWorker(t *testing.T) {
	ctx := context.Background()
	failed := service.Job{State: service.Failed}
	if !canContinueJobFailure(ctx, false, failed, nil) {
		t.Fatal("ordinary job failure halted continuous worker")
	}
	for _, s := range []service.State{service.Running, service.Queued, service.Complete, service.Invalid} {
		if canContinueJobFailure(ctx, false, service.Job{State: s}, nil) {
			t.Fatal("masked nonterminal/storage state", s)
		}
	}
	if canContinueJobFailure(ctx, true, failed, nil) || canContinueJobFailure(ctx, false, failed, errors.New("storage")) {
		t.Fatal("masked one-shot or storage error")
	}
	stopped, cancel := context.WithCancel(ctx)
	cancel()
	if canContinueJobFailure(stopped, false, failed, nil) {
		t.Fatal("ignored cancellation")
	}
}
