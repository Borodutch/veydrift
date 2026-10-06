package runtime

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/Borodutch/veydrift/packages/battle-prover/composition"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	"golang.org/x/sys/unix"
)

func TestCatalogProtocolGraph(t *testing.T) {
	for _, heights := range [][7]int{{}, {1, 2, 3, 4, 5, 6, 7}, {256, 256, 256, 256, 256, 256, 256}} {
		graph, err := BuildCatalogGraph(heights)
		if err != nil {
			t.Fatal(err)
		}
		want := 36 + 7 + 7
		for _, h := range heights {
			want += 2 * h
		}
		if len(graph) != want {
			t.Fatalf("nodes %d != %d", len(graph), want)
		}
		seen := map[string]bool{}
		leaves := [7]int{}
		roots := [7]bool{}
		for _, n := range graph {
			if seen[n.ID] {
				t.Fatal("duplicate", n.ID)
			}
			for _, d := range n.Dependencies {
				if !seen[d] {
					t.Fatalf("not topological: %s -> %s", n.ID, d)
				}
			}
			seen[n.ID] = true
			if n.Family != nil {
				id := *n.Family
				if !id.Valid() {
					t.Fatal(id)
				}
				if id.Arity == 0 {
					leaves[id.Phase]++
				}
				if id.Arity == 1 && id.Level == heights[id.Phase] {
					roots[id.Phase] = true
				}
				if id.Phase == composition.Bridge && id.Arity == 0 && id.Kind == rb.Close {
					want := []string{FamilyKeyID(composition.FamilyID{Phase: composition.Attribution, Level: heights[composition.Attribution], Arity: 1})}
					if !reflect.DeepEqual(n.Dependencies, want) {
						t.Fatal("Close does not pin complete attribution root")
					}
				}
			}
		}
		if leaves != [7]int{5, 11, 4, 5, 2, 4, 5} {
			t.Fatal(leaves)
		}
		for p, v := range roots {
			if !v {
				t.Fatal("missing phase root", p)
			}
		}
		if graph[len(graph)-1].ID != AdapterKeyID("final") || graph[len(graph)-1].PublicInputs != 22 {
			t.Fatal("final schema")
		}
	}
	for _, h := range []int{-1, 257} {
		if _, err := BuildCatalogGraph([7]int{h}); err == nil {
			t.Fatal("accepted bad height")
		}
	}
}

// Metadata-only fixture deliberately contains NO proving material. It exercises
// approval/file boundaries; Load must reject it. It is never a production key.
func catalogFixture(t *testing.T) (CatalogConfig, CatalogManifest) {
	t.Helper()
	dir := t.TempDir()
	b := []byte("not a gnark key")
	if err := os.WriteFile(filepath.Join(dir, "artifact.bin"), b, 0600); err != nil {
		t.Fatal(err)
	}
	hash := catalogDigest(b)
	graph, err := BuildCatalogGraph([7]int{})
	if err != nil {
		t.Fatal(err)
	}
	m := CatalogManifest{Protocol: CatalogProtocol, GnarkVersion: CatalogGnarkVersion, Curve: "BN254", SourceSHA256: hash, RulesSHA256: hash, SchemaSHA256: hash}
	for _, node := range graph {
		a := KeyApproval{SourceSHA256: hash, CircuitSHA256: hash, SchemaSHA256: hash, ProvenanceSHA256: hash, ApprovalSHA256: hash, CCS: Artifact{"artifact.bin", hash, int64(len(b))}, PK: Artifact{"artifact.bin", hash, int64(len(b))}, VK: Artifact{"artifact.bin", hash, int64(len(b))}}
		for _, d := range node.Dependencies {
			a.Dependencies = append(a.Dependencies, DependencyApproval{d, hash})
		}
		m.Entries = append(m.Entries, CatalogEntry{node, a})
	}
	cfg := CatalogConfig{Root: dir, ManifestPath: "manifest.json", MaxManifestBytes: 1 << 20, MaxArtifactBytes: 1 << 20}
	catalogWriteManifest(t, &cfg, m)
	return cfg, m
}
func catalogWriteManifest(t *testing.T, cfg *CatalogConfig, m CatalogManifest) {
	t.Helper()
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(cfg.Root, cfg.ManifestPath), b, 0600); err != nil {
		t.Fatal(err)
	}
	cfg.TrustedManifestSHA256 = catalogDigest(b)
}
func catalogOpen(t *testing.T, cfg CatalogConfig) *Catalog {
	t.Helper()
	c, err := OpenCatalog(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	return c
}

func TestCatalogPinImmutabilityAndReady(t *testing.T) {
	cfg, m := catalogFixture(t)
	c := catalogOpen(t, cfg)
	id := service.Identity{ChainID: "1", Game: "0x1111111111111111111111111111111111111111", BattleID: "1", InputHash: m.SourceSHA256, Rules: m.RulesSHA256, Verifier: cfg.TrustedManifestSHA256}
	if err := c.Ready(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	id.Verifier = strings.Repeat("0", 64)
	if err := c.Ready(context.Background(), id); err == nil {
		t.Fatal("accepted wrong identity")
	}
	detached := c.Manifest()
	detached.Entries[0].Node.Family.Phase = 99
	detached.Entries[4].Node.Dependencies[0] = "changed"
	detached.Entries[0].Approval.CCS.Path = "changed"
	if !reflect.DeepEqual(c.Manifest(), m) {
		t.Fatal("mutable catalog escaped")
	}
	if _, err := c.Load(context.Background(), m.Entries[0].Node.ID); err == nil {
		t.Fatal("metadata-only fixture became a key")
	}
	if err := c.Validate(context.Background(), "missing"); err == nil {
		t.Fatal("unknown ID")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := c.Validate(ctx, m.Entries[0].Node.ID); err == nil {
		t.Fatal("cancellation ignored")
	}
	cfg.TrustedManifestSHA256 = strings.Repeat("0", 64)
	if _, err := OpenCatalog(cfg); err == nil {
		t.Fatal("self-approved manifest accepted")
	}
}

func TestCatalogManifestRejectsSubstitution(t *testing.T) {
	cases := map[string]func(*CatalogManifest){
		"missing":       func(m *CatalogManifest) { m.Entries = m.Entries[:len(m.Entries)-1] },
		"duplicate":     func(m *CatalogManifest) { m.Entries[1] = m.Entries[0] },
		"role":          func(m *CatalogManifest) { m.Entries[0].Node.Role = "other" },
		"source":        func(m *CatalogManifest) { m.Entries[0].Approval.SourceSHA256 = strings.Repeat("0", 64) },
		"approval":      func(m *CatalogManifest) { m.Entries[0].Approval.ApprovalSHA256 = "" },
		"provenance":    func(m *CatalogManifest) { m.Entries[0].Approval.ProvenanceSHA256 = "" },
		"circuit":       func(m *CatalogManifest) { m.Entries[0].Approval.CircuitSHA256 = "" },
		"schema":        func(m *CatalogManifest) { m.Entries[0].Approval.SchemaSHA256 = "" },
		"dependency-vk": func(m *CatalogManifest) { m.Entries[4].Approval.Dependencies[0].VKSHA256 = strings.Repeat("0", 64) },
		"traversal":     func(m *CatalogManifest) { m.Entries[0].Approval.CCS.Path = "../escape" },
		"absolute":      func(m *CatalogManifest) { m.Entries[0].Approval.CCS.Path = "/tmp/escape" },
		"oversize":      func(m *CatalogManifest) { m.Entries[0].Approval.CCS.Bytes = 2 << 20 },
		"curve":         func(m *CatalogManifest) { m.Curve = "BLS12-381" },
		"version":       func(m *CatalogManifest) { m.GnarkVersion = "0.10.0" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			cfg, m := catalogFixture(t)
			mutate(&m)
			catalogWriteManifest(t, &cfg, m)
			if c, err := OpenCatalog(cfg); err == nil {
				c.Close()
				t.Fatal("accepted modified catalog")
			}
		})
	}
}

func TestCatalogArtifactFilesystemDefenses(t *testing.T) {
	for _, kind := range []string{"tamper", "truncate", "grow", "missing", "directory", "symlink", "parent-symlink", "fifo"} {
		t.Run(kind, func(t *testing.T) {
			cfg, m := catalogFixture(t)
			path := filepath.Join(cfg.Root, "artifact.bin")
			if kind == "parent-symlink" {
				if err := os.Mkdir(filepath.Join(cfg.Root, "real"), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.Rename(path, filepath.Join(cfg.Root, "real", "artifact.bin")); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink("real", filepath.Join(cfg.Root, "link")); err != nil {
					t.Fatal(err)
				}
				m.Entries[0].Approval.CCS.Path = "link/artifact.bin"
				catalogWriteManifest(t, &cfg, m)
			}
			c := catalogOpen(t, cfg)
			var err error
			switch kind {
			case "tamper":
				err = os.WriteFile(path, []byte("NOT A GNARK KEY"), 0600)
			case "truncate":
				err = os.Truncate(path, 1)
			case "grow":
				err = os.WriteFile(path, make([]byte, 100), 0600)
			case "missing":
				err = os.Remove(path)
			case "directory", "symlink", "fifo":
				if err = os.Remove(path); err != nil {
					t.Fatal(err)
				}
				switch kind {
				case "directory":
					err = os.Mkdir(path, 0700)
				case "symlink":
					err = os.Symlink("manifest.json", path)
				case "fifo":
					err = unix.Mkfifo(path, 0600)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if err = c.Validate(context.Background(), m.Entries[0].Node.ID); err == nil {
				t.Fatal("unsafe artifact accepted")
			}
		})
	}
}

func TestCatalogCanonicalManifestAndCCSHeader(t *testing.T) {
	cfg, m := catalogFixture(t)
	b, err := os.ReadFile(filepath.Join(cfg.Root, cfg.ManifestPath))
	if err != nil {
		t.Fatal(err)
	}
	b = append(b, ' ')
	if err = os.WriteFile(filepath.Join(cfg.Root, cfg.ManifestPath), b, 0600); err != nil {
		t.Fatal(err)
	}
	cfg.TrustedManifestSHA256 = catalogDigest(b)
	if c, err := OpenCatalog(cfg); err == nil {
		c.Close()
		t.Fatal("noncanonical JSON accepted")
	}
	// Hash-approved malformed header must fail before allocating totalLen.
	huge := make([]byte, 32)
	binary.LittleEndian.PutUint64(huge, ^uint64(0))
	binary.LittleEndian.PutUint64(huge[16:], 16)
	binary.LittleEndian.PutUint64(huge[24:], 3)
	if err = os.WriteFile(filepath.Join(cfg.Root, "bad.ccs"), huge, 0600); err != nil {
		t.Fatal(err)
	}
	m.Entries[0].Approval.CCS = Artifact{"bad.ccs", catalogDigest(huge), 32}
	catalogWriteManifest(t, &cfg, m)
	c := catalogOpen(t, cfg)
	if _, err = c.Load(context.Background(), m.Entries[0].Node.ID); err == nil || !strings.Contains(err.Error(), "header") {
		t.Fatalf("header check: %v", err)
	}
}
