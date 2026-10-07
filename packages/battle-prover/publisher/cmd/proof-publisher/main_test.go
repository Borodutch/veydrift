package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	"github.com/Borodutch/veydrift/packages/battle-prover/publisher"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	rt "github.com/Borodutch/veydrift/packages/battle-prover/runtime"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

// Only the validate branch is executed: no RPC, key loading, publication or
// source approval. Missing directories and an unreachable endpoint are deliberate.
func TestCLIValidateIsOfflineAndPinned(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("a", 64)
	cfg := publisher.Config{Schema: publisher.ConfigSchema, StoreRoot: filepath.Join(root, "store"), ArtifactRoot: filepath.Join(root, "artifacts"), AuthorityRoot: filepath.Join(root, "authority"), Catalog: rt.CatalogConfig{Root: filepath.Join(root, "catalog"), ManifestPath: "manifest.json", TrustedManifestSHA256: hash, MaxManifestBytes: 1 << 20, MaxArtifactBytes: 1 << 20}, Source: chainsource.Config{URL: "http://127.0.0.1:1", ChainID: "8453", Game: "0x0000000000000000000000000000000000000001", Release: chainsource.Release{Version: 3, Rules: hex.EncodeToString(raw.Encode(q.RulesID())), Catalog: hex.EncodeToString(raw.Encode(q.CatalogID())), Verifier: "0x0000000000000000000000000000000000000007", VerifierCodehash: hash, Engine: "0x0000000000000000000000000000000000000058", VerifierManifest: hash}, BlockPage: 1, FleetPage: 1, MaxPages: 1, MaxFleetReads: 1, MaxLogs: 1, MaxRows: 10, MaxInputBytes: 1 << 20, MaxResponseBytes: 1 << 20}, Limits: rt.ArtifactLimits{MaxVKBytes: 1 << 20, MaxInputBytes: 1 << 20, MaxArtifactBytes: 1 << 20, MaxProofBytes: 4096, MaxLeaves: 10}, MaxJobBytes: 65536, MaxExportBytes: 1 << 20}
	b, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "config.json")
	if err = os.WriteFile(path, b, 0600); err != nil {
		t.Fatal(err)
	}
	args := []string{"-action=validate", "-config=" + path, "-config-sha256=" + service.Hash(b)}
	if err = run(context.Background(), args); err != nil {
		t.Fatal(err)
	}
	for _, extra := range [][]string{{"-job-key=" + hash}, {"extra"}, {"-action=bad"}, {"-config-sha256=" + strings.Repeat("b", 64)}} {
		if run(context.Background(), append(append([]string{}, args...), extra...)) == nil {
			t.Fatal("invalid CLI accepted", extra)
		}
	}
	if run(context.Background(), []string{"-config=" + path, "-config-sha256=" + service.Hash(b)}) == nil {
		t.Fatal("publish without job accepted")
	}
	for _, p := range []string{cfg.StoreRoot, cfg.ArtifactRoot, cfg.AuthorityRoot, cfg.Catalog.Root} {
		if _, err = os.Stat(p); !os.IsNotExist(err) {
			t.Fatal("validate created or accessed configured data root", p, err)
		}
	}
}
