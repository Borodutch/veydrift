package publisher

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"golang.org/x/sys/unix"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	rt "github.com/Borodutch/veydrift/packages/battle-prover/runtime"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

type localSource struct {
	snap    service.Snapshot
	invalid bool
}

func (s *localSource) Finalized(context.Context) (service.Anchor, error) { return s.snap.Anchor, nil }
func (s *localSource) Canonical(context.Context, service.Anchor, service.Anchor) (bool, error) {
	return !s.invalid, nil
}
func (s *localSource) Pending(context.Context, service.Anchor, int) ([]service.Identity, error) {
	return nil, errors.New("publisher must not discover jobs")
}
func (s *localSource) Snapshot(context.Context, service.Identity, service.Anchor) (service.Snapshot, error) {
	out := s.snap
	out.Input = append([]byte(nil), s.snap.Input...)
	return out, nil
}

type fixture struct {
	approved *ApprovedConfig
	src      *localSource
	job      service.Job
	blob     []byte
}

func put(t *testing.T, path string, b []byte) {
	t.Helper()
	if e := os.WriteFile(path, b, 0600); e != nil {
		t.Fatal(e)
	}
}
func (f fixture) putJob(t *testing.T) {
	put(t, filepath.Join(f.approved.config.StoreRoot, "jobs", f.job.Identity.Key()+".json"), artifactEncode(t, f.job))
}
func newFixture(t *testing.T) fixture {
	t.Helper()
	_, snap, artifact := artifactTestData(t)
	root, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	for _, d := range []string{"store/jobs", "store/blobs", "catalog", "artifacts", "authority"} {
		if e = os.MkdirAll(filepath.Join(root, d), 0700); e != nil {
			t.Fatal(e)
		}
	}
	vk := artifactRead(t, artifactFixture+".vk")
	// Local synthetic graph approvals satisfy catalog parsing only. No PK/CCS
	// exists, and no fake approval escapes this temporary test directory.
	graph, e := rt.BuildCatalogGraph([7]int{})
	if e != nil {
		t.Fatal(e)
	}
	h := strings.Repeat("a", 64)
	manifest := rt.CatalogManifest{Protocol: rt.CatalogProtocol, GnarkVersion: rt.CatalogGnarkVersion, Curve: "BN254", SourceSHA256: h, RulesSHA256: snap.Identity.Rules, SchemaSHA256: h, RootHeights: [7]int{}}
	known := map[string]string{}
	for i, node := range graph {
		key := rt.Artifact{Path: "unused-" + anchorNumber(uint64(i)) + ".vk", SHA256: h, Bytes: 1}
		if node.ID == rt.AdapterKeyID("final") {
			key = rt.Artifact{Path: "final.vk", SHA256: service.Hash(vk), Bytes: int64(len(vk))}
		}
		approval := rt.KeyApproval{SourceSHA256: h, CircuitSHA256: h, SchemaSHA256: h, ProvenanceSHA256: h, ApprovalSHA256: h, CCS: rt.Artifact{Path: "absent.ccs", SHA256: h, Bytes: 1}, PK: rt.Artifact{Path: "absent.pk", SHA256: h, Bytes: 1}, VK: key, Dependencies: []rt.DependencyApproval{}}
		for _, dependency := range node.Dependencies {
			approval.Dependencies = append(approval.Dependencies, rt.DependencyApproval{ID: dependency, VKSHA256: known[dependency]})
		}
		known[node.ID] = key.SHA256
		manifest.Entries = append(manifest.Entries, rt.CatalogEntry{Node: node, Approval: approval})
	}
	mb := artifactEncode(t, manifest)
	catalogHash := service.Hash(mb)
	put(t, filepath.Join(root, "catalog", "manifest.json"), mb)
	put(t, filepath.Join(root, "catalog", "final.vk"), vk)
	var doc chainsource.Document
	if e = json.Unmarshal(snap.Input, &doc); e != nil {
		t.Fatal(e)
	}
	doc.Release.VerifierManifest = catalogHash
	snap.Input = artifactEncode(t, doc)
	snap.Identity.InputHash = service.Hash(snap.Input)
	snap.Identity.Verifier = catalogHash
	artifact.Manifest.InputHash = snap.Identity.InputHash
	blob := artifactEncode(t, artifact)
	cfg := Config{Schema: ConfigSchema, StoreRoot: filepath.Join(root, "store"), ArtifactRoot: filepath.Join(root, "artifacts"), AuthorityRoot: filepath.Join(root, "authority"), Catalog: rt.CatalogConfig{Root: filepath.Join(root, "catalog"), ManifestPath: "manifest.json", TrustedManifestSHA256: catalogHash, MaxManifestBytes: 4 << 20, MaxArtifactBytes: 16 << 20}, Source: chainsource.Config{URL: "http://127.0.0.1:1", ChainID: doc.ChainID, Game: doc.Game, Release: doc.Release, BlockPage: 1, FleetPage: 1, MaxPages: 1, MaxFleetReads: 1, MaxLogs: 10, MaxRows: 100, MaxInputBytes: 1 << 20, MaxResponseBytes: 1 << 20}, Limits: rt.ArtifactLimits{MaxVKBytes: 1 << 20, MaxInputBytes: 1 << 20, MaxArtifactBytes: 1 << 20, MaxProofBytes: 4096, MaxLeaves: 100}, MaxJobBytes: 1 << 16, MaxExportBytes: 1 << 20}
	cb := artifactEncode(t, cfg)
	configPath := filepath.Join(root, "publisher.json")
	put(t, configPath, cb)
	approved, e := LoadConfig(context.Background(), configPath, service.Hash(cb))
	if e != nil {
		t.Fatal(e)
	}
	j := service.Job{Generation: strings.Repeat("c", 64), Identity: snap.Identity, Anchor: snap.Anchor, State: service.Complete, Slot: -1, Proof: service.Hash(blob)}
	f := fixture{approved, &localSource{snap: snap}, j, blob}
	f.putJob(t)
	put(t, filepath.Join(cfg.StoreRoot, "blobs", j.Identity.InputHash), snap.Input)
	put(t, filepath.Join(cfg.StoreRoot, "blobs", j.Proof), blob)
	return f
}
func (f fixture) publish(h faultHook) (*Result, error) {
	return publishWithSource(context.Background(), f.approved, f.job.Identity.Key(), f.src, h)
}
func TestHistoricalProofPublicationAndRetry(t *testing.T) {
	f := newFixture(t)
	got, e := f.publish(nil)
	if e != nil {
		t.Fatal(e)
	}
	wire := artifactRead(t, filepath.Join(f.approved.config.ArtifactRoot, got.ArtifactName))
	meta := artifactRead(t, filepath.Join(f.approved.config.AuthorityRoot, got.AuthorityName))
	var a Authority
	if e = canonical(meta, &a); e != nil {
		t.Fatal(e)
	}
	if e = a.Validate(); e != nil {
		t.Fatal(e)
	}
	if a.ExportSHA256 != service.Hash(wire) || a.ArtifactBlobSHA256 != service.Hash(f.blob) || a.PublisherConfigSHA256 != f.approved.SHA256() {
		t.Fatal("independent output hashes")
	}
	var compressed rt.FinalArtifact
	if e = json.Unmarshal(f.blob, &compressed); e != nil {
		t.Fatal(e)
	}
	if a.CompressedProofHash != service.Hash(compressed.Proof) {
		t.Fatal("compressed proof hash")
	}
	var historical struct {
		Proof  string
		Public [22]string
	}
	if e = json.Unmarshal(artifactRead(t, artifactFixture+".evm.json"), &historical); e != nil {
		t.Fatal(e)
	}
	var evm rt.EVMArtifact
	if e = canonical(wire, &evm); e != nil {
		t.Fatal(e)
	}
	if evm.Proof != historical.Proof || evm.Public != historical.Public {
		t.Fatal("not complete historical export")
	}
	again, e := f.publish(nil)
	if e != nil || *again != *got {
		t.Fatalf("retry: %v", e)
	}
	for _, path := range []string{filepath.Join(f.approved.config.ArtifactRoot, got.ArtifactName), filepath.Join(f.approved.config.AuthorityRoot, got.AuthorityName)} {
		st, e := os.Stat(path)
		if e != nil || st.Mode().Perm() != 0444 {
			t.Fatalf("published mode: %v", e)
		}
	}
}
func TestConcurrentPublishers(t *testing.T) {
	f := newFixture(t)
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := f.publish(nil); errs <- e }()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
}
func TestCrashGapsAndRecovery(t *testing.T) {
	for _, stage := range []string{"artifact.write", "artifact.sync", "artifact.rename", "artifact.dirsync", "metadata", "authority.write", "authority.sync", "authority.rename", "authority.dirsync"} {
		t.Run(stage, func(t *testing.T) {
			f := newFixture(t)
			injected := errors.New("crash")
			_, e := f.publish(func(s string) error {
				if s == stage {
					return injected
				}
				return nil
			})
			if !errors.Is(e, injected) {
				t.Fatalf("fault not reached: %v", e)
			}
			result, e := f.publish(nil)
			if e != nil {
				t.Fatal(e)
			}
			if _, e = os.Stat(filepath.Join(f.approved.config.AuthorityRoot, result.AuthorityName)); e != nil {
				t.Fatal(e)
			}
		})
	}
}
func TestChangedAdmissionAndAuthority(t *testing.T) {
	for _, kind := range []string{"generation", "state", "anchor", "proof", "checkpoint", "source"} {
		t.Run(kind, func(t *testing.T) {
			f := newFixture(t)
			changed := false
			_, e := f.publish(func(stage string) error {
				if stage != "metadata" || changed {
					return nil
				}
				changed = true
				switch kind {
				case "generation":
					f.job.Generation = strings.Repeat("d", 64)
				case "state":
					f.job.State = service.Invalid
				case "anchor":
					f.job.Anchor.Number++
				case "proof":
					f.job.Proof = strings.Repeat("d", 64)
				case "checkpoint":
					f.job.Checkpoint = strings.Repeat("d", 64)
				case "source":
					f.src.invalid = true
				}
				f.putJob(t)
				return nil
			})
			if e == nil {
				t.Fatal("published changed admission")
			}
			entries, _ := os.ReadDir(f.approved.config.AuthorityRoot)
			for _, entry := range entries {
				if strings.HasSuffix(entry.Name(), ".authority.json") {
					t.Fatal("authority committed")
				}
			}
		})
	}
}
func TestBadProofAndJSONNeverPublish(t *testing.T) {
	for _, kind := range []string{"proof", "unknown", "trailing", "leaf", "not-complete", "oversize"} {
		t.Run(kind, func(t *testing.T) {
			f := newFixture(t)
			switch kind {
			case "not-complete":
				f.job.State = service.Running
			case "oversize":
				f.approved.config.Limits.MaxArtifactBytes = 1
			default:
				var a rt.FinalArtifact
				if e := json.Unmarshal(f.blob, &a); e != nil {
					t.Fatal(e)
				}
				switch kind {
				case "proof":
					a.Proof[1] ^= 1
					a.Manifest.ProofHash = service.Hash(a.Proof)
					f.blob = artifactEncode(t, a)
				case "leaf":
					a.Leaves[0].Owner = "4"
					f.blob = artifactEncode(t, a)
				case "unknown":
					f.blob = append([]byte(`{"unknown":0,`), f.blob[1:]...)
				case "trailing":
					f.blob = append(f.blob, 10)
				}
				f.job.Proof = service.Hash(f.blob)
				put(t, filepath.Join(f.approved.config.StoreRoot, "blobs", f.job.Proof), f.blob)
			}
			f.putJob(t)
			if _, e := f.publish(nil); e == nil {
				t.Fatal("invalid proof admitted")
			}
			entries, _ := os.ReadDir(f.approved.config.ArtifactRoot)
			if len(entries) != 0 {
				t.Fatal("failed proof left output")
			}
		})
	}
}
func TestExistingConflictsAndMissingArtifact(t *testing.T) {
	for _, kind := range []string{"metadata", "artifact", "missing-artifact"} {
		t.Run(kind, func(t *testing.T) {
			f := newFixture(t)
			got, e := f.publish(nil)
			if e != nil {
				t.Fatal(e)
			}
			path := filepath.Join(f.approved.config.ArtifactRoot, got.ArtifactName)
			if kind == "metadata" {
				path = filepath.Join(f.approved.config.AuthorityRoot, got.AuthorityName)
			}
			if e = os.Remove(path); e != nil {
				t.Fatal(e)
			}
			if kind != "missing-artifact" {
				put(t, path, []byte("{}"))
			}
			if _, e = f.publish(nil); e == nil {
				t.Fatal("conflict silently repaired")
			}
		})
	}
}
func TestReadersRejectLinksPathsBoundsAndJSON(t *testing.T) {
	root, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	put(t, filepath.Join(root, "file"), []byte("{}"))
	if e = os.Link(filepath.Join(root, "file"), filepath.Join(root, "hard")); e != nil {
		t.Fatal(e)
	}
	if e = os.Symlink("file", filepath.Join(root, "sym")); e != nil {
		t.Fatal(e)
	}
	if e = os.Mkdir(filepath.Join(root, "dir"), 0700); e != nil {
		t.Fatal(e)
	}
	if e = os.Symlink("dir", filepath.Join(root, "symdir")); e != nil {
		t.Fatal(e)
	}
	put(t, filepath.Join(root, "dir", "file"), []byte("{}"))
	d, e := openDirectory(root)
	if e != nil {
		t.Fatal(e)
	}
	defer d.close()
	for _, name := range []string{"file", "hard", "sym", "../file", "/file", "symdir/file", "dir/../file", "dir//file"} {
		if _, e = d.read(context.Background(), name, 1024, 0, ""); e == nil {
			t.Fatalf("accepted %s", name)
		}
	}
	for _, cap := range []int64{-1, 0, 1} {
		if _, e = d.read(context.Background(), "dir/file", cap, 0, ""); e == nil {
			t.Fatal("invalid bound")
		}
	}
	for _, b := range [][]byte{[]byte(`{"extra":0}`), append([]byte("{}"), 10), []byte(`{"a":1,"a":1}`)} {
		var out struct{}
		if canonical(b, &out) == nil {
			t.Fatal("invalid JSON")
		}
	}
	good, e := d.read(context.Background(), "dir/file", 2, 2, service.Hash([]byte("{}")))
	if e != nil || !bytes.Equal(good, []byte("{}")) {
		t.Fatalf("bounded read: %v", e)
	}
}

func TestWrongAuthorityAndApproval(t *testing.T) {
	for _, kind := range []string{"release", "snapshot", "vk", "catalog", "config-pin"} {
		t.Run(kind, func(t *testing.T) {
			f := newFixture(t)
			switch kind {
			case "release":
				f.approved.config.Source.Release.VerifierCodehash = strings.Repeat("d", 64)
			case "snapshot":
				f.src.snap.Identity.BattleID = "101"
			case "vk":
				put(t, filepath.Join(f.approved.config.Catalog.Root, "final.vk"), []byte("wrong"))
			case "catalog":
				put(t, filepath.Join(f.approved.config.Catalog.Root, "manifest.json"), []byte("{}"))
			case "config-pin":
				path := filepath.Join(filepath.Dir(f.approved.config.StoreRoot), "publisher.json")
				if _, e := LoadConfig(context.Background(), path, strings.Repeat("d", 64)); e == nil {
					t.Fatal("wrong pin admitted")
				}
				return
			}
			if _, e := f.publish(nil); e == nil {
				t.Fatal("wrong authority admitted")
			}
		})
	}
}
func TestPinnedConfigRejectsNoncanonicalAndLinks(t *testing.T) {
	for _, kind := range []string{"newline", "unknown", "hardlink", "symlink", "oversize", "zero-cap", "export-ceiling"} {
		t.Run(kind, func(t *testing.T) {
			f := newFixture(t)
			root := filepath.Dir(f.approved.config.StoreRoot)
			path := filepath.Join(root, "bad.json")
			b := artifactEncode(t, f.approved.config)
			switch kind {
			case "newline":
				b = append(b, 10)
			case "unknown":
				b = append([]byte(`{"unknown":0,`), b[1:]...)
			case "oversize":
				b = bytes.Repeat([]byte("x"), MaxConfigBytes+1)
			case "zero-cap":
				f.approved.config.MaxJobBytes = 0
				b = artifactEncode(t, f.approved.config)
			case "export-ceiling":
				f.approved.config.MaxExportBytes = MaxEVMBytes
				b = artifactEncode(t, f.approved.config)
			}
			put(t, path, b)
			if kind == "hardlink" {
				if e := os.Link(path, path+".link"); e != nil {
					t.Fatal(e)
				}
			}
			if kind == "symlink" {
				if e := os.Symlink(path, path+".link"); e != nil {
					t.Fatal(e)
				}
				path += ".link"
			}
			if _, e := LoadConfig(context.Background(), path, service.Hash(b)); e == nil {
				t.Fatal("unsafe config admitted")
			}
		})
	}
}
func TestJobJSONAndLinkRejection(t *testing.T) {
	for _, kind := range []string{"unknown", "duplicate", "newline", "hardlink", "symlink", "oversize"} {
		t.Run(kind, func(t *testing.T) {
			f := newFixture(t)
			path := filepath.Join(f.approved.config.StoreRoot, "jobs", f.job.Identity.Key()+".json")
			b := artifactRead(t, path)
			switch kind {
			case "unknown":
				b = append([]byte(`{"unknown":0,`), b[1:]...)
			case "duplicate":
				b = append([]byte(`{"Generation":"`+f.job.Generation+`",`), b[1:]...)
			case "newline":
				b = append(b, 10)
			case "oversize":
				b = bytes.Repeat([]byte("x"), f.approved.config.MaxJobBytes+1)
			}
			put(t, path, b)
			if kind == "hardlink" {
				if e := os.Link(path, path+".link"); e != nil {
					t.Fatal(e)
				}
			}
			if kind == "symlink" {
				if e := os.Rename(path, path+".real"); e != nil {
					t.Fatal(e)
				}
				if e := os.Symlink(path+".real", path); e != nil {
					t.Fatal(e)
				}
			}
			if _, e := f.publish(nil); e == nil {
				t.Fatal("unsafe job admitted")
			}
		})
	}
}

func TestSpecialFilesAndExactReadContract(t *testing.T) {
	root, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	d, e := openDirectory(root)
	if e != nil {
		t.Fatal(e)
	}
	defer d.close()
	put(t, filepath.Join(root, "ok"), []byte("abc"))
	if e = unix.Mkfifo(filepath.Join(root, "fifo"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e = d.read(context.Background(), "fifo", 8, 0, ""); e == nil {
		t.Fatal("FIFO accepted")
	}
	if _, e = d.read(context.Background(), "ok", 8, 2, ""); e == nil {
		t.Fatal("wrong exact length accepted")
	}
	if _, e = d.read(context.Background(), "ok", 8, 3, strings.Repeat("a", 64)); e == nil {
		t.Fatal("wrong SHA256 accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = d.read(ctx, "ok", 8, 3, ""); !errors.Is(e, context.Canceled) {
		t.Fatal("canceled read")
	}
	if e = os.Symlink(root, filepath.Join(root, "root-link")); e != nil {
		t.Fatal(e)
	}
	if linked, e := openDirectory(filepath.Join(root, "root-link")); e == nil {
		linked.close()
		t.Fatal("symlink root accepted")
	}
}
func TestPublisherLockCancellationAndNoReplace(t *testing.T) {
	root, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	d, e := openDirectory(root)
	if e != nil {
		t.Fatal(e)
	}
	defer d.close()
	held, e := d.lock(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	defer held.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if f, e := d.lock(ctx); e == nil {
		f.Close()
		t.Fatal("canceled lock acquired")
	}
	if e = d.publish(context.Background(), "proof", []byte("one"), 3, "test", nil); e != nil {
		t.Fatal(e)
	}
	if e = d.publish(context.Background(), "proof", []byte("two"), 3, "test", nil); e == nil {
		t.Fatal("replaced existing file")
	}
	if got := artifactRead(t, filepath.Join(root, "proof")); string(got) != "one" {
		t.Fatal("no-replace violated")
	}
}

// Exercise initial stable-inode creation separately from Groth16 verification.
func TestConcurrentInitialLockCreation(t *testing.T) {
	for attempt := 0; attempt < 30; attempt++ {
		root, e := filepath.EvalSymlinks(t.TempDir())
		if e != nil {
			t.Fatal(e)
		}
		d, e := openDirectory(root)
		if e != nil {
			t.Fatal(e)
		}
		start := make(chan struct{})
		errs := make(chan error, 8)
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				f, e := d.lock(context.Background())
				if e == nil {
					e = f.Close()
				}
				errs <- e
			}()
		}
		close(start)
		wg.Wait()
		close(errs)
		d.close()
		for e := range errs {
			if e != nil {
				t.Fatal(e)
			}
		}
	}
}
