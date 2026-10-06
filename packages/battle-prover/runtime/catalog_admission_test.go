package runtime

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

func TestCatalogHostAdmissionDoesNotHashProvingAssets(t *testing.T) {
	cfg, m := catalogFixture(t)
	c := catalogOpen(t, cfg)
	id := service.Identity{ChainID: "8453", Game: "0x1111111111111111111111111111111111111111", BattleID: "2", InputHash: m.SourceSHA256, Rules: m.RulesSHA256, Verifier: cfg.TrustedManifestSHA256}
	gate := catalogAdmissionGate{c}
	if err := c.CheckArtifactPresence(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := gate.Ready(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	// Same-size corruption is intentionally not loaded into host admission memory;
	// the mandatory child-use validation must and does reject it.
	path := filepath.Join(cfg.Root, "artifact.bin")
	if err := os.WriteFile(path, bytes.Repeat([]byte{9}, int(m.Entries[0].Approval.PK.Bytes)), 0600); err != nil {
		t.Fatal(err)
	}
	if err := c.CheckArtifactPresence(context.Background()); err != nil {
		t.Fatal("metadata-only check read content", err)
	}
	if err := gate.Ready(context.Background(), id); err != nil {
		t.Fatal("host identity gate read content", err)
	}
	if err := c.Validate(context.Background(), m.Entries[0].Node.ID); err == nil {
		t.Fatal("child-use hash check accepted corruption")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := c.CheckArtifactPresence(context.Background()); err == nil {
		t.Fatal("missing public proving assets admitted")
	}
	// Once admitted, the cheap gate stays identity-only; use-time load detects any
	// deletion/change. This avoids multiplying whole-catalog reads at every stage.
	if err := gate.Ready(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	bad := id
	bad.Verifier = m.SourceSHA256
	if err := gate.Ready(context.Background(), bad); err == nil {
		t.Fatal("wrong approval accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := gate.Ready(ctx, id); err == nil {
		t.Fatal("cancellation ignored")
	}
}
