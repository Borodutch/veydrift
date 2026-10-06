package devcatalog

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	rt "github.com/Borodutch/veydrift/packages/battle-prover/runtime"
	"golang.org/x/sys/unix"
)

func testConfig() Config {
	h := strings.Repeat("a", 64)
	return Config{Protocol: Protocol, RootHeights: [7]int{1, 2, 3, 4, 5, 6, 7}, SourceSHA256: h, RulesSHA256: h, SchemaSHA256: h, ProvenanceSHA256: h, BuilderSHA256: h, EngineeringApprovalSHA256: h, BudgetBytes: MaxBudget, StageSeconds: 3600}
}
func testDir(t *testing.T) *os.File {
	t.Helper()
	path, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	d, e := openDir(path, false)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { d.Close() })
	return d
}
func TestPlanAndCanonicalConfig(t *testing.T) {
	c := testConfig()
	p, e := MakePlan(c)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.Graph) != 106 {
		t.Fatalf("graph %d", len(p.Graph))
	}
	seen := map[string]bool{}
	for _, n := range p.Graph {
		for _, d := range n.Dependencies {
			if !seen[d] {
				t.Fatalf("dependency not prior: %s", d)
			}
		}
		seen[n.ID] = true
	}
	b, _ := canonical(c)
	var out Config
	if e = decode(b, &out); e != nil {
		t.Fatal(e)
	}
	for _, bad := range [][]byte{append(append([]byte{}, b...), 10), []byte(strings.Replace(string(b), "[1,2,3,4,5,6,7]", "[1]", 1)), []byte(strings.Replace(string(b), "[1,2,3,4,5,6,7]", "[1,2,3,4,5,6,7,8]", 1)), []byte(strings.Replace(string(b), "{", "{\"Protocol\":\"duplicate\",", 1))} {
		if decode(bad, &out) == nil {
			t.Fatal("accepted ambiguous JSON")
		}
	}
	c.RootHeights[0] = 256
	if c.Validate() == nil {
		t.Fatal("accepted D256")
	}
	c = testConfig()
	c.StageSeconds = 3601
	if c.Validate() == nil {
		t.Fatal("unbounded wall")
	}
	c = testConfig()
	c.BudgetBytes = MaxBudget + 1
	if c.Validate() == nil {
		t.Fatal("unbounded storage")
	}
}
func TestBudgetAndBoundedImmutableStorage(t *testing.T) {
	if budgetCheck(0, MaxBudget, FreeFloor+StageReserve, StageReserve) != nil {
		t.Fatal("boundary denied")
	}
	for _, x := range [][4]int64{{0, MaxBudget, FreeFloor + StageReserve - 1, StageReserve}, {MaxBudget - StageReserve + 1, MaxBudget, 2 * FreeFloor, StageReserve}, {0, MaxBudget + 1, 2 * FreeFloor, StageReserve}} {
		if budgetCheck(x[0], x[1], x[2], x[3]) == nil {
			t.Fatal("budget accepted")
		}
	}
	d := testDir(t)
	a, e := writeArtifact(d, "public.bin", bytes.NewReader([]byte("public")), 6)
	if e != nil {
		t.Fatal(e)
	}
	if a.SHA256 != digest([]byte("public")) || a.Bytes != 6 {
		t.Fatal("hash/length")
	}
	if _, e = writeArtifact(d, "public.bin", bytes.NewReader([]byte("other")), 6); e == nil {
		t.Fatal("overwrote immutable artifact")
	}
	if _, e = writeArtifact(d, "partial.bin", bytes.NewReader([]byte("too large")), 2); e == nil {
		t.Fatal("uncapped write")
	}
	if e = os.Symlink("public.bin", filepath.Join(d.Name(), "link")); e != nil {
		t.Fatal(e)
	}
	if _, e = openAt(d, "link", unix.O_RDONLY); e == nil {
		t.Fatal("symlink accepted")
	}
	if _, e = diskUsage(d); e == nil {
		t.Fatal("symlink ignored by accounting")
	}
	if _, e = openAt(d, "../escape", unix.O_CREAT|unix.O_WRONLY); e == nil {
		t.Fatal("traversal accepted")
	}
}
func TestAtomicPublishAndFlock(t *testing.T) {
	d := testDir(t)
	lock, e := acquire(d)
	if e != nil {
		t.Fatal(e)
	}
	defer lock.Close()
	if other, e := acquire(d); e == nil {
		other.Close()
		t.Fatal("parallel lock accepted")
	}
	for _, name := range []string{"pending", "committed"} {
		if e = unix.Mkdirat(int(d.Fd()), name, 0700); e != nil {
			t.Fatal(e)
		}
	}
	if e = publish(int(d.Fd()), "pending", "committed"); e == nil {
		t.Fatal("directory overwrite accepted")
	}
	if e = publish(int(d.Fd()), "pending", "new"); e != nil {
		t.Fatal(e)
	}
}
func fakeReceipt(t *testing.T, root *os.File, c Config) Receipt {
	t.Helper()
	name := stageName(0)
	if e := unix.Mkdirat(int(root.Fd()), name, 0700); e != nil {
		t.Fatal(e)
	}
	d, e := childDir(root, name)
	if e != nil {
		t.Fatal(e)
	}
	defer d.Close()
	artifacts := make([]rt.Artifact, 3)
	for i, n := range []string{"ccs.bin", "pk.bin", "vk.bin"} {
		artifacts[i], e = writeArtifact(d, n, bytes.NewReader([]byte("PUBLIC TEST BYTES NOT KEYS")), 100)
		if e != nil {
			t.Fatal(e)
		}
		artifacts[i].Path = name + "/" + n
	}
	graph, _ := rt.BuildCatalogGraph(c.RootHeights)
	cb, _ := canonical(c)
	r := Receipt{Protocol: Protocol, ConfigSHA256: digest(cb), Index: 0, Entry: rt.CatalogEntry{Node: graph[0], Approval: rt.KeyApproval{SourceSHA256: c.SourceSHA256, SchemaSHA256: c.SchemaSHA256, ProvenanceSHA256: c.ProvenanceSHA256, CircuitSHA256: artifacts[0].SHA256, CCS: artifacts[0], PK: artifacts[1], VK: artifacts[2], Dependencies: []rt.DependencyApproval{}}}, Dependencies: []DependencyPin{}, Costs: Costs{Constraints: 1, TotalNanos: 1, ArtifactBytes: 3 * artifacts[0].Bytes}}
	if e = writeJSON(d, "receipt.json", r); e != nil {
		t.Fatal(e)
	}
	return r
}
func TestResumeAndNoSelfApproval(t *testing.T) {
	d := testDir(t)
	c := testConfig()
	fakeReceipt(t, d, c)
	rs, hs, e := scan(d, c)
	if e != nil {
		t.Fatal(e)
	}
	if len(rs) != 1 || len(hs) != 1 {
		t.Fatal("resume missing")
	}
	cand := candidate(c, rs, hs)
	if cand.Complete || cand.Manifest.Entries[0].Approval.ApprovalSHA256 != "" {
		t.Fatal("self approval")
	}
	c.SourceSHA256 = strings.Repeat("b", 64)
	if _, _, e = scan(d, c); e == nil {
		t.Fatal("source conflict ignored")
	}
	// Incomplete committed directory must never count as a successful stage.
	if e = unix.Mkdirat(int(d.Fd()), stageName(1), 0700); e != nil {
		t.Fatal(e)
	}
	if _, _, e = scan(d, testConfig()); e == nil {
		t.Fatal("interrupted committed stage accepted")
	}
}
func TestCanonicalReceiptRejectsUnknownAndDuplicate(t *testing.T) {
	b, _ := json.Marshal(Receipt{})
	var r Receipt
	if decode(append(b, []byte("{}")...), &r) == nil {
		t.Fatal("trailing accepted")
	}
	bad := strings.Replace(string(b), "{", "{\"Unexpected\":true,", 1)
	if decode([]byte(bad), &r) == nil {
		t.Fatal("unknown field")
	}
}
