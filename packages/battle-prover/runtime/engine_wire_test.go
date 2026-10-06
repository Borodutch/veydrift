package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Borodutch/veydrift/packages/battle-prover/processrunner"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

func TestEngineWirePinnedConfigAndInvocation(t *testing.T) {
	snap, doc := witnessTestDocument(t, 1, 1)
	cfg := EngineConfig{Catalog: CatalogConfig{TrustedManifestSHA256: doc.Release.VerifierManifest}, Release: doc.Release, Witness: WitnessLimits{MaxInputBytes: 1 << 20}, MaxRequestBytes: 2 << 20, MaxCheckpointBytes: 1 << 20, MaxResultBytes: 1 << 20}
	req := engineWireRequest{Protocol: processrunner.Protocol, Identity: snap.Identity.Key(), Attempt: strings.Repeat("a", 64), ManifestSHA256: strings.Repeat("b", 64), Input: snap.Input}
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	_, got, err := decodeEngineRequest(bytes.NewReader(b), cfg)
	if err != nil || got.Identity != snap.Identity || got.Anchor != snap.Anchor {
		t.Fatal(got, err)
	}
	for _, mode := range []string{"identity", "attempt", "protocol", "release", "trailing", "oversized"} {
		bad := req
		c := cfg
		switch mode {
		case "identity":
			bad.Identity = strings.Repeat("f", 64)
		case "attempt":
			bad.Attempt = ""
		case "protocol":
			bad.Protocol = "other"
		case "release":
			c.Release.VerifierCodehash = strings.Repeat("f", 64)
		case "oversized":
			c.MaxRequestBytes = 1
		}
		data, _ := json.Marshal(bad)
		if mode == "trailing" {
			data = append(data, byte(32))
		}
		if _, _, e := decodeEngineRequest(bytes.NewReader(data), c); e == nil {
			t.Fatal("accepted", mode)
		}
	}
	path := filepath.Join(t.TempDir(), "engine.json")
	data, _ := json.Marshal(cfg)
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadEngineConfig(path, service.Hash(data)); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadEngineConfig(path, strings.Repeat("f", 64)); err == nil {
		t.Fatal("unapproved config")
	}
	link := filepath.Join(filepath.Dir(path), "link.json")
	if err = os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadEngineConfig(link, service.Hash(data)); err == nil {
		t.Fatal("symlink configuration accepted")
	}
	var stdout bytes.Buffer
	if err = ServeEngine(context.Background(), bytes.NewReader(b), &stdout, cfg); err == nil || stdout.Len() != 0 {
		t.Fatal("missing approved catalog produced stage output", err)
	}
}
