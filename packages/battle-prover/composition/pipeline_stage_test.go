package composition

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"runtime/debug"
	"strconv"
	"testing"
	"time"

	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	rec "github.com/consensys/gnark/std/recursion/groth16"
)

const pipelineVersion = "settlement-phases-v2"

// These are explicit FIXTURE heights, not ProtocolRootHeight/D256.
var pipelineHeights = [...]int{5, 6, 4, 4, 2, 3, 4}
var pipelineNames = [...]string{"prep", "combat", "attribution", "bridge", "report", "raw", "output"}
var pipelineSizes = [][]int{{17}, {36}, {10, 4}, {11}, {3}, {7}, {9}}

type pipelineEdge struct {
	kind    int
	circuit frontend.Circuit
	r       FamilyRange
}

type pipelineManifest struct {
	Version              string
	Phase, Stage, Height int
	GroupSizes           []int
	Sources              map[string]string
	Dependencies         map[string]string
	// Receipt metadata hashes commit to the proof/VK/public hashes and endpoints.
	Receipts map[string]string
	// Includes unused leaf kinds: public VK and CCS identity, never a PK.
	Keys     map[string]pipelineKeyManifest
	Complete bool
}
type pipelineKeyManifest struct{ VKHash, CCSHash string }

// Source hashes include all local Go packages, not just the runner. A changed
// fixture/relation/helper cannot accidentally resume receipts from old source.
func pipelineSources(t *testing.T) map[string]string {
	t.Helper()
	out := map[string]string{}
	check(t, filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == "staged-public" || d.Name() == "stage-approvals" || d.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(path) != ".go" && filepath.Base(path) != "go.mod" && filepath.Base(path) != "go.sum" {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		out[filepath.ToSlash(path)] = fmt.Sprintf("%x", sha256.Sum256(b))
		return nil
	}))
	return out
}
func pipelineHash(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	check(t, err)
	return fmt.Sprintf("%x", sha256.Sum256(b))
}
func pipelineStageDir(base string, phase, stage int) string {
	if stage == -1 {
		return filepath.Join(base, pipelineNames[phase], "stage-leaf")
	}
	return filepath.Join(base, pipelineNames[phase], fmt.Sprintf("stage-%02d", stage))
}
func pipelineReceiptName(group, index int) string { return fmt.Sprintf("g%02d-D-%03d", group, index) }
func pipelineWidth(n, stage int) int              { return (n + (1 << stage) - 1) >> stage }

// Approval is written only by the owned setup/import path, never by a loader.
// Its directory is a separate trusted-local development trust boundary, not
// production key promotion. A party controlling BOTH roots defeats that trust.
type pipelineApproval struct {
	Version      string
	Run          string
	Phase, Stage int
	ManifestHash string
	Sources      map[string]string
	Keys         map[string]pipelineKeyManifest
}

func pipelineApprovalPath(base string, phase, stage int) string {
	return filepath.Join("stage-approvals", filepath.Base(base), pipelineNames[phase], filepath.Base(pipelineStageDir(base, phase, stage))+".json")
}
func pipelineWriteExclusive(t *testing.T, path string, value any) {
	t.Helper()
	data, err := json.MarshalIndent(value, "", "  ")
	check(t, err)
	check(t, os.MkdirAll(filepath.Dir(path), 0700))
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	check(t, err)
	_, err = file.Write(data)
	closeErr := file.Close()
	check(t, err)
	check(t, closeErr)
}

// Call only with the manifest assembled from owned setup outputs (or a
// separately audited pinned import), after writing its completed manifest.
// Never call this with untrusted receipt metadata to "repair" missing approval.
func pipelineApproveStage(t *testing.T, base string, m pipelineManifest) {
	t.Helper()
	if !m.Complete || m.Version != pipelineVersion || !reflect.DeepEqual(m.Sources, pipelineSources(t)) {
		t.Fatal("cannot approve incomplete or stale owned setup")
	}
	path := filepath.Join(pipelineStageDir(base, m.Phase, m.Stage), "manifest.json")
	var disk pipelineManifest
	pipelineReadJSON(t, path, &disk)
	if !reflect.DeepEqual(m, disk) {
		t.Fatal("owned setup manifest differs from disk")
	}
	pipelineWriteExclusive(t, pipelineApprovalPath(base, m.Phase, m.Stage), pipelineApproval{
		Version: pipelineVersion, Run: filepath.Base(base), Phase: m.Phase, Stage: m.Stage,
		ManifestHash: pipelineHash(t, path), Sources: m.Sources, Keys: m.Keys,
	})
}
func pipelineReadJSON(t *testing.T, path string, value any) {
	t.Helper()
	info, err := os.Lstat(path)
	check(t, err)
	if !info.Mode().IsRegular() {
		t.Fatal("nonregular JSON artifact", path)
	}
	b, err := os.ReadFile(path)
	check(t, err)
	decoder := json.NewDecoder(bytes.NewReader(b))
	decoder.DisallowUnknownFields()
	check(t, decoder.Decode(value))
	if err := decoder.Decode(new(any)); err != io.EOF {
		t.Fatal("trailing JSON", path, err)
	}
}
func pipelineCheckApproval(t *testing.T, base string, m pipelineManifest) {
	t.Helper()
	var a pipelineApproval
	pipelineReadJSON(t, pipelineApprovalPath(base, m.Phase, m.Stage), &a)
	want := pipelineApproval{Version: pipelineVersion, Run: filepath.Base(base), Phase: m.Phase, Stage: m.Stage,
		ManifestHash: pipelineHash(t, filepath.Join(pipelineStageDir(base, m.Phase, m.Stage), "manifest.json")), Sources: m.Sources, Keys: m.Keys}
	if !reflect.DeepEqual(a, want) {
		t.Fatal("independent owned-setup approval mismatch")
	}
}
func pipelineDigest(s string) bool {
	b, err := hex.DecodeString(s)
	return err == nil && len(b) == sha256.Size
}
func pipelineLeafName(group, index int) string { return fmt.Sprintf("g%02d-leaf-%03d", group, index) }
func pipelineExpectedKeys(t *testing.T, phase, stage int) map[string]string {
	t.Helper()
	keys := map[string]string{}
	if stage == -1 {
		ids, err := Dependencies(FamilyID{Phase: phase, Arity: 1})
		check(t, err)
		for _, id := range ids {
			keys[fmt.Sprintf("leaf-%02d", id.Kind)] = fmt.Sprintf("leaf-key-%02d.vk", id.Kind)
		}
	} else {
		keys["D"] = "D-key.vk"
		if stage > 0 {
			keys["B"] = "B-key.vk"
		}
	}
	return keys
}
func pipelineExpectedReceipts(phase, stage int) map[string]string {
	names := map[string]string{}
	for g, n := range pipelineSizes[phase] {
		if stage == -1 {
			for i := 0; i < n; i++ {
				names[pipelineLeafName(g, i)] = "leaf"
			}
		} else {
			for i := 0; i < pipelineWidth(n, stage); i++ {
				names[pipelineReceiptName(g, i)] = "D"
			}
			if stage > 0 {
				for i := 0; i < pipelineWidth(n, stage-1)/2; i++ {
					names[fmt.Sprintf("g%02d-B-%03d", g, i)] = "B"
				}
			}
		}
	}
	return names
}
func pipelineReadManifest(t *testing.T, base string, phase, stage int, sources map[string]string) pipelineManifest {
	t.Helper()
	if phase < 0 || phase >= len(pipelineNames) || stage < -1 || stage > pipelineHeights[phase] {
		t.Fatal("invalid pipeline stage")
	}
	dir := pipelineStageDir(base, phase, stage)
	var m pipelineManifest
	pipelineReadJSON(t, filepath.Join(dir, "manifest.json"), &m)
	if !m.Complete || m.Version != pipelineVersion || m.Phase != phase || m.Stage != stage || m.Height != pipelineHeights[phase] || !reflect.DeepEqual(m.GroupSizes, pipelineSizes[phase]) || !reflect.DeepEqual(m.Sources, sources) {
		t.Fatal("incomplete, stale, or wrong phase manifest", dir)
	}
	pipelineCheckApproval(t, base, m)
	// Dependencies are a fixed acyclic graph, not arbitrary manifest paths.
	wantDependencies := map[string]string{}
	addDependency := func(p, h int) {
		pipelineReadManifest(t, base, p, h, sources)
		path := filepath.Join(pipelineStageDir(base, p, h), "manifest.json")
		rel, err := filepath.Rel(base, path)
		check(t, err)
		wantDependencies[filepath.ToSlash(rel)] = pipelineHash(t, path)
	}
	if stage >= 0 {
		addDependency(phase, stage-1)
	} else if phase == Bridge {
		addDependency(Attribution, pipelineHeights[Attribution])
	}
	if !reflect.DeepEqual(m.Dependencies, wantDependencies) {
		t.Fatal("stage dependency lineage changed", dir)
	}
	expectedKeys := pipelineExpectedKeys(t, phase, stage)
	if len(m.Keys) != len(expectedKeys) {
		t.Fatal("incomplete approved family catalog", dir)
	}
	files := map[string]bool{"manifest.json": true}
	for key, file := range expectedKeys {
		entry := m.Keys[key]
		if !pipelineDigest(entry.CCSHash) || entry.VKHash != pipelineHash(t, filepath.Join(dir, file)) {
			t.Fatal("public key manifest mismatch", dir, key)
		}
		files[file] = true
	}
	expectedReceipts := pipelineExpectedReceipts(phase, stage)
	if len(m.Receipts) != len(expectedReceipts) {
		t.Fatal("incomplete or extra receipt set", dir)
	}
	for name, role := range expectedReceipts {
		path := filepath.Join(dir, name)
		if m.Receipts[name] != pipelineHash(t, path+".json") {
			t.Fatal("uncommitted receipt", path)
		}
		var meta publicReceipt
		pipelineReadJSON(t, path+".json", &meta)
		keyName := role
		wantID := FamilyID{Phase: phase, Level: stage, Arity: 1}
		if role == "leaf" {
			keyName = fmt.Sprintf("leaf-%02d", meta.ID.Kind)
			wantID = FamilyID{Phase: phase, Kind: meta.ID.Kind}
			if !wantID.Valid() {
				t.Fatal("invalid leaf kind", path)
			}
		} else if role == "B" {
			wantID.Arity = 2
		}
		key, ok := m.Keys[keyName]
		if !ok || meta.ID != wantID || meta.VKHash != key.VKHash || meta.CCSHash != key.CCSHash {
			t.Fatal("receipt family/key mismatch", path)
		}
		for ext, hash := range map[string]string{"proof": meta.ProofHash, "vk": meta.VKHash, "public": meta.PublicHash} {
			if hash != pipelineHash(t, path+"."+ext) {
				t.Fatal("receipt artifact hash mismatch", path, ext)
			}
			files[name+"."+ext] = true
		}
		files[name+".json"] = true
	}
	entries, err := os.ReadDir(dir)
	check(t, err)
	if len(entries) != len(files) {
		t.Fatal("unexpected stage directory contents", dir)
	}
	for _, entry := range entries {
		if !files[entry.Name()] || !entry.Type().IsRegular() {
			t.Fatal("unexpected/nonregular stage artifact", entry.Name())
		}
	}
	return m
}
func pipelineLoadLevel(t *testing.T, base string, phase, stage int, sources map[string]string) [][]familyReceipt {
	t.Helper()
	if stage < 0 {
		t.Fatal("pipelineLoadLevel accepts D stages only; use pipelineLoadLeaves")
	}
	m := pipelineReadManifest(t, base, phase, stage, sources)
	groups := make([][]familyReceipt, len(m.GroupSizes))
	for g, n := range m.GroupSizes {
		for i := 0; i < pipelineWidth(n, stage); i++ {
			groups[g] = append(groups[g], loadStage(t, filepath.Join(pipelineStageDir(base, phase, stage), pipelineReceiptName(g, i)), FamilyID{Phase: phase, Level: stage, Arity: 1}))
		}
	}
	return groups
}

// Return actual fixture receipts, the complete approved catalog in selector
// order, and per-edge selectors. No setup/solver/prover is invoked on reload.
func pipelineLoadLeaves(t *testing.T, base string, phase int, sources map[string]string) ([][]familyReceipt, []Key, [][]int) {
	t.Helper()
	m := pipelineReadManifest(t, base, phase, -1, sources)
	dir := pipelineStageDir(base, phase, -1)
	entries := map[FamilyID]Key{}
	ids, err := Dependencies(FamilyID{Phase: phase, Arity: 1})
	check(t, err)
	for _, id := range ids {
		b, err := os.ReadFile(filepath.Join(dir, fmt.Sprintf("leaf-key-%02d.vk", id.Kind)))
		check(t, err)
		vk := groth16.NewVerifyingKey(ecc.BN254)
		reader := bytes.NewReader(b)
		_, err = vk.ReadFrom(reader)
		check(t, err)
		if reader.Len() != 0 {
			t.Fatal("trailing key bytes")
		}
		entries[id], err = rec.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](vk)
		check(t, err)
	}
	var allocations [][]familyReceipt
	if phase == Bridge {
		allocations = pipelineLoadLevel(t, base, Attribution, pipelineHeights[Attribution], sources)
	}
	edges := pipelineEdges(t, buildSettlement(t, false), phase, allocations)
	groups := make([][]familyReceipt, len(m.GroupSizes))
	kinds := make([][]int, len(groups))
	for g := range edges {
		for i, edge := range edges[g] {
			r := loadStage(t, filepath.Join(dir, pipelineLeafName(g, i)), FamilyID{Phase: phase, Kind: edge.kind})
			got, want := r.rangeValue.Public(phase), edge.r.Public(phase)
			for j := range got.Digests {
				if integer(got.Digests[j]).Cmp(integer(want.Digests[j])) != 0 {
					t.Fatal("leaf differs from source-pinned fixture", g, i)
				}
			}
			groups[g] = append(groups[g], r)
			kinds[g] = append(kinds[g], edge.kind)
		}
	}
	return groups, pipelineCatalog(t, entries, FamilyID{Phase: phase, Arity: 1}), kinds
}

// Unused approved kinds have no positive fixture witness. Compile/setup the
// real fixed shape, NEVER solve/prove a fabricated transition or fake receipt.
func pipelineSetupUnused(t *testing.T, phase, kind int) *devSetup {
	t.Helper()
	shape, err := LeafShape(phase, kind)
	check(t, err)
	cc := compile(t, fmt.Sprintf("unused-phase%d-kind%d", phase, kind), shape)
	start := time.Now()
	pk, vk, err := groth16.Setup(cc)
	check(t, err)
	key, err := rec.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](vk)
	check(t, err)
	t.Logf("UNUSED KIND SETUP phase=%d kind=%d elapsed=%s; no proof", phase, kind, time.Since(start))
	return &devSetup{cc, pk, vk, key}
}
func pipelineSaveKey(t *testing.T, dir, name string, l *devSetup) pipelineKeyManifest {
	t.Helper()
	// VK is public. Hash CCS directly; neither CCS nor PK is serialized to disk.
	h := sha256.New()
	_, err := l.cc.WriteTo(h)
	check(t, err)
	m := pipelineKeyManifest{CCSHash: fmt.Sprintf("%x", h.Sum(nil))}
	file, err := os.OpenFile(filepath.Join(dir, name+".vk"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	check(t, err)
	_, err = l.vk.WriteTo(file)
	closeErr := file.Close()
	check(t, err)
	check(t, closeErr)
	m.VKHash = pipelineHash(t, filepath.Join(dir, name+".vk"))
	return m
}
func pipelineCatalog(t *testing.T, entries map[FamilyID]Key, id FamilyID) []Key {
	t.Helper()
	c, err := NewKeyCatalog(entries)
	check(t, err)
	keys, err := c.ForFamily(id)
	check(t, err)
	return keys
}

func pipelineEdges(t *testing.T, f settlementFixture, phase int, allocations [][]familyReceipt) [][]pipelineEdge {
	t.Helper()
	groups := make([][]pipelineEdge, len(pipelineSizes[phase]))
	if phase == Attribution && len(f.bridge.AttrSteps) != len(groups) {
		t.Fatal("attribution group count changed")
	}
	add := func(g, kind int, c *Chunk, statement []frontend.Variable) {
		c.Phase = phase
		c.PublicRange = PublicRange{statement, statement}
		leaf := NewFamilyLeaf(c)
		groups[g] = append(groups[g], pipelineEdge{kind, leaf, leaf.Range})
	}
	switch phase {
	case Preparation:
		for _, s := range f.prep {
			st := s.Statement()
			add(0, s.Kind, &Chunk{Preparation: []prepStep{privateprepStep(s)}}, st[:])
		}
	case Combat:
		for _, s := range f.combat {
			st := s.Statement()
			add(0, s.Kind, &Chunk{Combat: []combatStep{privatecombatStep(s)}}, st[:])
		}
	case Attribution:
		for g, steps := range f.bridge.AttrSteps {
			for _, s := range steps {
				st := s.Statement()
				add(g, s.Kind, &Chunk{Attribution: []attrStep{privateattrStep(s)}}, st[:])
			}
		}
	case Bridge:
		closeIndex := 0
		for _, s := range f.bridgeSteps {
			st := s.Statement()
			if s.Kind != rb.Close {
				add(0, s.Kind, &Chunk{Bridge: []bridgeStep{privatebridgeStep(s)}}, st[:])
				continue
			}
			if closeIndex >= len(allocations) || len(allocations[closeIndex]) != 1 {
				t.Fatal("Close requires complete normalized attribution D4 roots")
			}
			ar := allocations[closeIndex][0]
			r := Normalize(Bridge, Range{st[:], st[:]}, p.Const(1))
			c := &CompleteClose{FamilyPublic: r.Public(Bridge), Range: r, Step: privatebridgeStep(s), Allocation: ar.rangeValue, Auth: ar.auth}
			groups[0] = append(groups[0], pipelineEdge{s.Kind, c, r})
			closeIndex++
		}
		if closeIndex != 2 {
			t.Fatal("fixture must discharge both actual Close obligations")
		}
	case Report:
		for _, s := range f.reports {
			st := s.Statement()
			add(0, s.Kind, &Chunk{Reports: []reportStep{privatereportStep(s)}}, st[:])
		}
	case RawJournal:
		for _, s := range f.raw {
			st := s.Statement()
			add(0, s.Kind, &Chunk{Raw: []rawStep{privateRaw(s)}}, st[:])
		}
	case SettlementOutput:
		for _, s := range f.steps {
			st := s.Statement()
			add(0, s.Kind, &Chunk{Output: []outputStep{privateOutput(s)}}, st[:])
		}
	}
	for g, n := range pipelineSizes[phase] {
		if len(groups[g]) != n {
			t.Fatalf("fixture trace changed phase=%d group=%d got=%d want=%d", phase, g, len(groups[g]), n)
		}
	}
	return groups
}

// TestSettlementPipelineStage runs exactly ONE phase stage in a fresh process.
// Every family is compiled/setup once IN MEMORY and reused for all actual
// edges in all groups. Public receipts alone cross the process boundary.
func TestSettlementPipelineStage(t *testing.T) {
	name, stageText := os.Getenv("PIPELINE_PHASE"), os.Getenv("PIPELINE_STAGE")
	if name == "" && stageText == "" {
		t.Skip("explicit staged settlement proof run")
	}
	phase := -1
	for i, n := range pipelineNames {
		if name == n {
			phase = i
		}
	}
	stage := -1
	var err error
	if stageText != "leaf" {
		stage, err = strconv.Atoi(stageText)
		check(t, err)
		if stage < 0 {
			t.Fatal("use PIPELINE_STAGE=leaf, not a negative integer")
		}
	}
	if phase < 0 {
		t.Fatal("unknown PIPELINE_PHASE")
	}
	if stage < -1 || stage > pipelineHeights[phase] {
		t.Fatal("stage outside declared fixture height")
	}
	if runtime.GOMAXPROCS(0) > 2 || debug.SetMemoryLimit(-1) <= 0 || debug.SetMemoryLimit(-1) > 6<<30 {
		t.Fatal("require <=2CPU and positive soft memory limit <=6GiB")
	}
	deadline, ok := t.Deadline()
	if !ok || time.Until(deadline) > 60*time.Minute {
		t.Fatal("require go test -timeout=60m or less")
	}
	started := time.Now()
	run := os.Getenv("PIPELINE_RUN")
	if run == "" || run == "." || run == ".." || filepath.Base(run) != run {
		t.Fatal("PIPELINE_RUN must be a fresh single directory name")
	}
	base := filepath.Join("staged-public", pipelineVersion, run)
	sources := pipelineSources(t)
	dir := pipelineStageDir(base, phase, stage)
	if _, err := os.Lstat(pipelineApprovalPath(base, phase, stage)); !os.IsNotExist(err) {
		t.Fatal("approval already exists or cannot be inspected; refuse setup reuse", err)
	}
	check(t, os.MkdirAll(filepath.Dir(dir), 0700))
	// Refuse completed AND interrupted stage reuse: keys are ephemeral. Resume
	// only at a completed stage boundary; never mix newly setup and old keys.
	check(t, os.Mkdir(dir, 0700))
	m := pipelineManifest{Version: pipelineVersion, Phase: phase, Stage: stage, Height: pipelineHeights[phase], GroupSizes: pipelineSizes[phase], Sources: sources, Dependencies: map[string]string{}, Receipts: map[string]string{}, Keys: map[string]pipelineKeyManifest{}}
	save := func(name string, l *devSetup, a frontend.Circuit, r FamilyRange, id FamilyID) familyReceipt {
		got := saveStage(t, filepath.Join(dir, name), l, a, r, id)
		m.Receipts[name] = pipelineHash(t, filepath.Join(dir, name)+".json")
		return got
	}
	dependency := func(p, h int) [][]familyReceipt {
		groups := pipelineLoadLevel(t, base, p, h, sources)
		path := filepath.Join(pipelineStageDir(base, p, h), "manifest.json")
		rel, err := filepath.Rel(base, path)
		check(t, err)
		m.Dependencies[filepath.ToSlash(rel)] = pipelineHash(t, path)
		return groups
	}
	entries := map[FamilyID]Key{}
	if stage == -1 {
		f := buildSettlement(t, false)
		var allocations [][]familyReceipt
		if phase == Bridge {
			allocations = dependency(Attribution, pipelineHeights[Attribution])
		}
		edges := pipelineEdges(t, f, phase, allocations)
		ids, err := Dependencies(FamilyID{Phase: phase, Arity: 1})
		check(t, err)
		for _, id := range ids {
			var first *pipelineEdge
			for g := range edges {
				for i := range edges[g] {
					if edges[g][i].kind == id.Kind && first == nil {
						first = &edges[g][i]
					}
				}
			}
			var l *devSetup
			if first == nil {
				l = pipelineSetupUnused(t, phase, id.Kind)
			} else {
				l = setupFamily(t, fmt.Sprintf("%s-leaf%d", name, id.Kind), first.circuit)
			}
			entries[id] = l.key
			m.Keys[fmt.Sprintf("leaf-%02d", id.Kind)] = pipelineSaveKey(t, dir, fmt.Sprintf("leaf-key-%02d", id.Kind), l)
			for g := range edges {
				for i, edge := range edges[g] {
					if edge.kind == id.Kind {
						save(pipelineLeafName(g, i), l, edge.circuit, edge.r, id)
					}
				}
			}
			l = nil
			runtime.GC()
		}
		// Validate the complete catalog even when no dispatcher is run yet.
		pipelineCatalog(t, entries, FamilyID{Phase: phase, Arity: 1})
	} else if stage == 0 {
		leaves, keys, kinds := pipelineLoadLeaves(t, base, phase, sources)
		path := filepath.Join(pipelineStageDir(base, phase, -1), "manifest.json")
		rel, err := filepath.Rel(base, path)
		check(t, err)
		m.Dependencies[filepath.ToSlash(rel)] = pipelineHash(t, path)
		id := FamilyID{Phase: phase, Arity: 1}
		a := stageNode(phase, 1, leaves[0][:1], keys, []int{kinds[0][0]})
		l := setupFamily(t, name+"-D0", a)
		m.Keys["D"] = pipelineSaveKey(t, dir, "D-key", l)
		for g := range leaves {
			for i, leaf := range leaves[g] {
				a := stageNode(phase, 1, []familyReceipt{leaf}, keys, []int{kinds[g][i]})
				save(pipelineReceiptName(g, i), l, a, a.Range, id)
			}
		}
	} else {
		previous := dependency(phase, stage-1)
		previousID := FamilyID{Phase: phase, Level: stage - 1, Arity: 1}
		entries[previousID] = previous[0][0].auth.Keys[0]
		binaryID := FamilyID{Phase: phase, Level: stage, Arity: 2}
		binaryKeys := pipelineCatalog(t, entries, binaryID)
		// Pick one REAL adjacent pair for setup. Even when a short cohort has one
		// root left, a longer cohort supplies the B_h witness at this test height.
		var pair []familyReceipt
		for _, group := range previous {
			if len(group) >= 2 {
				pair = group[:2]
				break
			}
		}
		if pair == nil {
			t.Fatal("declared height has no actual binary pair; do not invent a proof")
		}
		a := stageNode(phase, stage, pair, binaryKeys, []int{0, 0})
		bl := setupFamily(t, fmt.Sprintf("%s-B%d", name, stage), a)
		entries[binaryID] = bl.key
		m.Keys["B"] = pipelineSaveKey(t, dir, "B-key", bl)
		binary := make([][]familyReceipt, len(previous))
		for g, group := range previous {
			for i := 0; i+1 < len(group); i += 2 {
				a := stageNode(phase, stage, group[i:i+2], binaryKeys, []int{0, 0})
				binary[g] = append(binary[g], save(fmt.Sprintf("g%02d-B-%03d", g, i/2), bl, a, a.Range, binaryID))
			}
		}
		bl = nil
		runtime.GC()
		dispatchID := FamilyID{Phase: phase, Level: stage, Arity: 1}
		dispatchKeys := pipelineCatalog(t, entries, dispatchID)
		var realBinary familyReceipt
		for _, group := range binary {
			if len(group) > 0 {
				realBinary = group[0]
				break
			}
		}
		a = stageNode(phase, stage, []familyReceipt{realBinary}, dispatchKeys, []int{0})
		dl := setupFamily(t, fmt.Sprintf("%s-D%d", name, stage), a)
		m.Keys["D"] = pipelineSaveKey(t, dir, "D-key", dl)
		for g, group := range previous {
			for i, r := range binary[g] {
				a := stageNode(phase, stage, []familyReceipt{r}, dispatchKeys, []int{0})
				save(pipelineReceiptName(g, i), dl, a, a.Range, dispatchID)
			}
			if len(group)%2 == 1 {
				a := stageNode(phase, stage, group[len(group)-1:], dispatchKeys, []int{1})
				save(pipelineReceiptName(g, len(group)/2), dl, a, a.Range, dispatchID)
			}
		}
	}
	// Source must stay frozen throughout the invocation, not only at startup.
	if !reflect.DeepEqual(sources, pipelineSources(t)) {
		t.Fatal("source changed during stage")
	}
	m.Complete = true
	pipelineWriteExclusive(t, filepath.Join(dir, "manifest.json"), m)
	pipelineApproveStage(t, base, m)
	if stage == -1 {
		pipelineLoadLeaves(t, base, phase, sources)
	} else {
		groups := pipelineLoadLevel(t, base, phase, stage, sources)
		if stage == pipelineHeights[phase] {
			for g, roots := range groups {
				if len(roots) != 1 || wordBig(roots[0].rangeValue.Count).Cmp(integer(pipelineSizes[phase][g])) != 0 {
					t.Fatal("incomplete fixture root work")
				}
			}
		}
	}
	t.Logf("PHASE STAGE VERIFIED phase=%s stage=%d testHeight=%d groups=%v elapsed=%s; not D256 or final settlement proof", name, stage, pipelineHeights[phase], pipelineSizes[phase], time.Since(started))
}

// Host-only schedule check: no circuit compilation, setup, witness or proof.
func TestPipelineSplitPlan(t *testing.T) {
	invocations, proofs, keys := 0, 0, 0
	for phase, h := range pipelineHeights {
		n := 0
		for _, count := range pipelineSizes[phase] {
			n += count
		}
		if len(pipelineExpectedReceipts(phase, -1)) != n || len(pipelineExpectedReceipts(phase, 0)) != n {
			t.Fatal("leaf/D0 split count")
		}
		for stage := -1; stage <= h; stage++ {
			invocations++
			proofs += len(pipelineExpectedReceipts(phase, stage))
			keys += len(pipelineExpectedKeys(t, phase, stage))
		}
	}
	if invocations != 42 || proofs != 390 || keys != 99 {
		t.Fatalf("unexpected plan: invocations=%d proofs=%d keys=%d", invocations, proofs, keys)
	}
	if filepath.Base(pipelineStageDir("run", Combat, -1)) != "stage-leaf" || filepath.Base(pipelineStageDir("run", Combat, 0)) != "stage-00" {
		t.Fatal("stage naming")
	}
}
