package composition

import (
	"bytes"
	"encoding/json"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/frontend"
	"io"
	"math/big"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"runtime/debug"
	"strconv"
	"testing"
	"time"
)

type adapterManifest struct {
	Role                  string
	Sources, Dependencies map[string]string
	ReceiptHash           string
}

func adapterDir(base, role string) string { return filepath.Join(base, "adapters", role) }
func adapterApproval(base, role string) string {
	return filepath.Join("stage-approvals", filepath.Base(base), "adapters", role+".json")
}
func adapterValues(f settlementFixture, role string) []frontend.Variable {
	a, b := claims(f)
	p := f.m.Manifest.Pipeline
	switch role {
	case "qualification":
		s := f.qualified.Statement()
		return s[:]
	case "prepared-combat":
		return []frontend.Variable{p[0], p[1], p[2], p[3], 0, 0, 0, 0}
	case "bridge-report":
		return []frontend.Variable{0, p[1], p[2], p[3], p[4], p[5], p[6], p[7]}
	case "pipeline":
		return p[:]
	case "raw-qualified":
		return []frontend.Variable{prep.Hash(rawQualifiedDomain, a.values()...)}
	case "output-pipeline":
		return []frontend.Variable{prep.Hash(outputPipelineDomain, b.values()...)}
	case "final":
		s := f.m.Manifest.Settlement()
		return s[:]
	default:
		panic("unknown adapter")
	}
}
func adapterDependencyNames(role string) ([]int, []string) {
	switch role {
	case "qualification":
		return nil, nil
	case "prepared-combat":
		return []int{Preparation, Combat}, nil
	case "bridge-report":
		return []int{Bridge, Report}, nil
	case "pipeline":
		return nil, []string{"prepared-combat", "bridge-report"}
	case "raw-qualified":
		return []int{RawJournal}, []string{"qualification"}
	case "output-pipeline":
		return []int{SettlementOutput}, []string{"pipeline"}
	case "final":
		return nil, []string{"raw-qualified", "output-pipeline"}
	default:
		panic("unknown adapter")
	}
}
func adapterDependencies(t *testing.T, base, role string, sources map[string]string, f settlementFixture) map[string]string {
	phases, adapters := adapterDependencyNames(role)
	deps := map[string]string{}
	for _, p := range phases {
		pipelineReadManifest(t, base, p, pipelineHeights[p], sources)
		path := filepath.Join(pipelineStageDir(base, p, pipelineHeights[p]), "manifest.json")
		rel, e := filepath.Rel(base, path)
		check(t, e)
		deps[filepath.ToSlash(rel)] = pipelineHash(t, path)
	}
	for _, r := range adapters {
		readAdapterManifest(t, base, r, sources, f)
		path := filepath.Join(adapterDir(base, r), "manifest.json")
		rel, e := filepath.Rel(base, path)
		check(t, e)
		deps[filepath.ToSlash(rel)] = pipelineHash(t, path)
	}
	return deps
}

type adapterApprovalRecord struct {
	ManifestHash string
	Manifest     adapterManifest
}

func approveAdapter(t *testing.T, base, role string, m adapterManifest) {
	p := filepath.Join(adapterDir(base, role), "manifest.json")
	data, e := json.MarshalIndent(adapterApprovalRecord{ManifestHash: pipelineHash(t, p), Manifest: m}, "", "  ")
	check(t, e)
	writeExclusive(t, adapterApproval(base, role), data)
}
func readAdapterManifest(t *testing.T, base, role string, sources map[string]string, f settlementFixture) adapterManifest {
	t.Helper()
	path := filepath.Join(adapterDir(base, role), "manifest.json")
	var pinned adapterApprovalRecord
	pipelineReadJSON(t, adapterApproval(base, role), &pinned)
	var m adapterManifest
	pipelineReadJSON(t, path, &m)
	if pinned.ManifestHash != pipelineHash(t, path) || !reflect.DeepEqual(m, pinned.Manifest) || m.Role != role || !reflect.DeepEqual(m.Sources, sources) {
		t.Fatal("adapter not independently pinned to current source/role")
	}
	if !reflect.DeepEqual(m.Dependencies, adapterDependencies(t, base, role, sources, f)) {
		t.Fatal("adapter dependency lineage mismatch")
	}
	if m.ReceiptHash != pipelineHash(t, filepath.Join(adapterDir(base, role), "receipt.json")) {
		t.Fatal("adapter coherent receipt substitution")
	}
	return m
}
func loadAdapter(t *testing.T, base, role string, sources map[string]string, f settlementFixture) Auth {
	readAdapterManifest(t, base, role, sources, f)
	return loadPublic(t, filepath.Join(adapterDir(base, role), "receipt"), role, adapterValues(f, role))
}
func writeExclusive(t *testing.T, path string, data []byte) {
	check(t, os.MkdirAll(filepath.Dir(path), 0700))
	file, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	check(t, e)
	_, e = file.Write(data)
	closeErr := file.Close()
	check(t, e)
	check(t, closeErr)
}
func TestSettlementAdapterStage(t *testing.T) {
	role := os.Getenv("PIPELINE_ADAPTER")
	if role == "" {
		t.Skip("explicit authenticated adapter stage")
	}
	adapterDependencyNames(role)
	if runtime.GOMAXPROCS(0) > 2 || debug.SetMemoryLimit(-1) <= 0 || debug.SetMemoryLimit(-1) > 6<<30 {
		t.Fatal("resource envelope")
	}
	deadline, ok := t.Deadline()
	if !ok || time.Until(deadline) > 60*time.Minute {
		t.Fatal("60min maximum")
	}
	run := os.Getenv("PIPELINE_RUN")
	if run == "" || run == "." || run == ".." || filepath.Base(run) != run {
		t.Fatal("run namespace")
	}
	base := filepath.Join("staged-public", pipelineVersion, run)
	sources := pipelineSources(t)
	f := buildSettlement(t, false)
	deps := adapterDependencies(t, base, role, sources, f)
	dir := adapterDir(base, role)
	check(t, os.MkdirAll(filepath.Dir(dir), 0700))
	check(t, os.Mkdir(dir, 0700))
	root := func(p int) familyReceipt {
		xs := pipelineLoadLevel(t, base, p, pipelineHeights[p], sources)
		if len(xs) != 1 || len(xs[0]) != 1 {
			t.Fatal("phase root multiplicity")
		}
		return xs[0][0]
	}
	asAuth := func(r familyReceipt) Auth {
		return Auth{Proof: r.auth.Proof, Witness: r.auth.Witness, Key: r.auth.Keys[0]}
	}
	values := adapterValues(f, role)
	a, b := claims(f)
	var circuit frontend.Circuit
	switch role {
	case "qualification":
		circuit = f.qualified
	case "prepared-combat", "bridge-report":
		phases, _ := adapterDependencyNames(role)
		left, right := root(phases[0]), root(phases[1])
		c := &FamilyPhaseJoin{Children: [2]CatalogAuth{left.auth, right.auth}, Ranges: [2]FamilyRange{left.rangeValue, right.rangeValue}}
		if role == "bridge-report" {
			c.Mode = 1
		}
		copy(c.Public[:], values)
		circuit = c
	case "pipeline":
		pc, br := loadAdapter(t, base, "prepared-combat", sources, f), loadAdapter(t, base, "bridge-report", sources, f)
		var x, y [8]frontend.Variable
		copy(x[:], adapterValues(f, "prepared-combat"))
		copy(y[:], adapterValues(f, "bridge-report"))
		circuit = join(2, receipt{auth: pc, public: x}, receipt{auth: br, public: y})
	case "raw-qualified":
		r := root(RawJournal)
		circuit = &RawQualified{Digest: values[0], Claims: a, Raw: asAuth(r), RawRange: r.rangeValue, Qualification: loadAdapter(t, base, "qualification", sources, f)}
	case "output-pipeline":
		r := root(SettlementOutput)
		circuit = &OutputPipeline{Digest: values[0], Claims: b, Output: asAuth(r), OutputRange: r.rangeValue, Pipeline: loadAdapter(t, base, "pipeline", sources, f)}
	case "final":
		circuit = &SettlementFinal{Public: f.m.Manifest.Settlement(), Provenance: loadAdapter(t, base, "raw-qualified", sources, f), Results: loadAdapter(t, base, "output-pipeline", sources, f), RawQualified: a, OutputPipeline: b, Manifest: f.m.Manifest}
	}
	depNames := []string{}
	for path := range deps {
		depNames = append(depNames, path)
	}
	provePublic(t, filepath.Join(dir, "receipt"), role, circuit, values, depNames)
	if !reflect.DeepEqual(sources, pipelineSources(t)) {
		t.Fatal("source changed during adapter proof stage")
	}
	m := adapterManifest{Role: role, Sources: sources, Dependencies: deps, ReceiptHash: pipelineHash(t, filepath.Join(dir, "receipt.json"))}
	data, e := json.MarshalIndent(m, "", "  ")
	check(t, e)
	writeExclusive(t, filepath.Join(dir, "manifest.json"), data)
	approveAdapter(t, base, role, m)
	loadAdapter(t, base, role, sources, f)
	t.Logf("AUTHENTICATED ADAPTER STAGE VERIFIED role=%s public=%d sources=%d dependencies=%d", role, len(values), len(sources), len(deps))
}
func testFinalPublicAttacks(t *testing.T, dir string, c *SettlementFinal) {
	pr, vk := groth16.NewProof(ecc.BN254), groth16.NewVerifyingKey(ecc.BN254)
	for ext, obj := range map[string]io.ReaderFrom{"proof": pr, "vk": vk} {
		b, e := os.ReadFile(filepath.Join(dir, "receipt."+ext))
		check(t, e)
		_, e = obj.ReadFrom(bytes.NewReader(b))
		check(t, e)
	}
	for i := range c.Public {
		bad := *c
		bad.Public[i] = new(big.Int).Mod(new(big.Int).Add(integer(c.Public[i]), big.NewInt(1)), ecc.BN254.ScalarField())
		pub, e := wit(t, &bad).Public()
		check(t, e)
		if groth16.Verify(pr, vk, pub, nativeStageVerifierOption("final")) == nil {
			t.Fatalf("accepted mutated final public %d", i)
		}
		t.Logf("REJECTED actual final proof public[%d] mutation", i)
	}
	cc := compile(t, "actual-final-bundle-attacks", c)
	for _, name := range []string{"swap-bundles", "omit-raw-result", "omit-output-result", "wrong-chain"} {
		bad := clone(reflect.ValueOf(c)).Interface().(*SettlementFinal)
		switch name {
		case "swap-bundles":
			bad.Provenance, bad.Results = bad.Results, bad.Provenance
		case "omit-raw-result":
			bad.RawQualified.RawLast[3] = 0
		case "omit-output-result":
			bad.OutputPipeline.Last[4] = 0
		case "wrong-chain":
			bad.Manifest.ChainRecord[0] = 1
		}
		if cc.IsSolved(wit(t, bad)) == nil {
			t.Fatalf("accepted %s", name)
		}
		t.Logf("REJECTED final genuine-bundle %s", name)
	}
}

func TestCompletedPipelineFinal(t *testing.T) {
	if os.Getenv("PIPELINE_VERIFY_FINAL") != "1" {
		t.Skip("explicit final checkpoint verification")
	}
	run := os.Getenv("PIPELINE_RUN")
	if run == "" || run == "." || run == ".." || filepath.Base(run) != run {
		t.Fatal("run namespace")
	}
	base := filepath.Join("staged-public", pipelineVersion, run)
	f := buildSettlement(t, false)
	sources := pipelineSources(t)
	loadAdapter(t, base, "final", sources, f)
	var attacks finalAttackReceipt
	pipelineReadJSON(t, filepath.Join(adapterDir(base, "final"), "attacks.json"), &attacks)
	if attacks.ManifestHash != pipelineHash(t, filepath.Join(adapterDir(base, "final"), "manifest.json")) || !reflect.DeepEqual(attacks.Sources, sources) {
		t.Fatal("final attack completion does not match proof/source")
	}
	t.Logf("COMPLETE22-PUBLIC SETTLEMENT RECEIPT REVERIFIED run=%s public=%v", run, f.m.Manifest.Settlement())
}

func TestVerifyPipelineCheckpoint(t *testing.T) {
	if os.Getenv("PIPELINE_VERIFY_CHECKPOINT") != "1" {
		t.Skip("explicit checkpoint verification")
	}
	run := os.Getenv("PIPELINE_RUN")
	if run == "" || run == "." || run == ".." || filepath.Base(run) != run {
		t.Fatal("run namespace")
	}
	base := filepath.Join("staged-public", pipelineVersion, run)
	sources := pipelineSources(t)
	if role := os.Getenv("PIPELINE_ADAPTER"); role != "" {
		loadAdapter(t, base, role, sources, buildSettlement(t, false))
		t.Logf("REVERIFIED adapter=%s", role)
		return
	}
	phase := -1
	for i, n := range pipelineNames {
		if n == os.Getenv("PIPELINE_PHASE") {
			phase = i
		}
	}
	if phase < 0 {
		t.Fatal("phase")
	}
	stage := -1
	var e error
	if os.Getenv("PIPELINE_STAGE") != "leaf" {
		stage, e = strconv.Atoi(os.Getenv("PIPELINE_STAGE"))
		check(t, e)
		if stage < 0 || stage > pipelineHeights[phase] {
			t.Fatal("stage")
		}
	}
	if stage < 0 {
		pipelineLoadLeaves(t, base, phase, sources)
	} else {
		pipelineLoadLevel(t, base, phase, stage, sources)
	}
	t.Logf("REVERIFIED phase=%d stage=%d", phase, stage)
}

type finalAttackReceipt struct {
	ManifestHash string
	Sources      map[string]string
}

func TestFinalSettlementAttacks(t *testing.T) {
	if os.Getenv("PIPELINE_ATTACK_FINAL") != "1" {
		t.Skip("explicit final proof attack gate")
	}
	run := os.Getenv("PIPELINE_RUN")
	if run == "" || run == "." || run == ".." || filepath.Base(run) != run {
		t.Fatal("run namespace")
	}
	base := filepath.Join("staged-public", pipelineVersion, run)
	sources := pipelineSources(t)
	f := buildSettlement(t, false)
	loadAdapter(t, base, "final", sources, f)
	a, b := claims(f)
	c := &SettlementFinal{Public: f.m.Manifest.Settlement(), Provenance: loadAdapter(t, base, "raw-qualified", sources, f), Results: loadAdapter(t, base, "output-pipeline", sources, f), RawQualified: a, OutputPipeline: b, Manifest: f.m.Manifest}
	dir := adapterDir(base, "final")
	testFinalPublicAttacks(t, dir, c)
	if !reflect.DeepEqual(sources, pipelineSources(t)) {
		t.Fatal("source changed during final attack gate")
	}
	pipelineWriteExclusive(t, filepath.Join(dir, "attacks.json"), finalAttackReceipt{ManifestHash: pipelineHash(t, filepath.Join(dir, "manifest.json")), Sources: sources})
	t.Log("FINAL ATTACK GATE COMPLETE; proof checkpoint preserved independently")
}
