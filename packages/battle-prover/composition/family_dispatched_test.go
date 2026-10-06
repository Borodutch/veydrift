package composition

import (
	"fmt"
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	"os"
	"reflect"
	"runtime"
	"runtime/debug"
	"testing"
	"time"
)

// Resource repair: select ONE heterogeneous VK in a unary dispatch proof;
// binary merge then verifies two children under ONE fixed dispatch VK. This
// avoids paying for dynamic G2 selection twice in the same <=4M circuit.
func TestFamilyDispatchedProof(t *testing.T) {
	if os.Getenv("RUN_FAMILY_DISPATCHED") != "1" {
		t.Skip("opt-in actual split dispatch proofs")
	}
	if runtime.GOMAXPROCS(0) > 2 || debug.SetMemoryLimit(-1) > 6<<30 || debug.SetMemoryLimit(-1) <= 0 {
		t.Fatal("resource envelope")
	}
	start := time.Now()
	chunks, _, _, _ := buildTwoSided(t)
	ws := [2][]*FamilyLeaf{}
	for _, c := range chunks {
		if c.Phase != Combat {
			continue
		}
		switch c.Combat[0].Kind {
		case mb.Damage:
			ws[0] = append(ws[0], NewFamilyLeaf(c))
		case mb.Rapidfire:
			ws[1] = append(ws[1], NewFamilyLeaf(c))
		}
	}
	if len(ws[0]) != 2 || len(ws[1]) != 2 {
		t.Fatal("two actual shots required")
	}
	leaves := [2][2]familyReceipt{}
	catalog := []Key{}
	for kind := 0; kind < 2; kind++ {
		l := setupFamily(t, fmt.Sprintf("dispatch-leaf-kind%d", kind), ws[kind][0])
		catalog = append(catalog, l.key)
		for shot, w := range ws[kind] {
			leaves[shot][kind] = proveFamily(t, fmt.Sprintf("leaf%d-shot%d", kind, shot), l, w, w.Range)
		}
		l = nil
		runtime.GC()
	}
	dispatch := familyMerge(Combat, 1, leaves[0][:1], catalog, []int{0})
	dl := setupFamily(t, "unary-catalog-dispatch", dispatch)
	dispatched := [2][2]familyReceipt{}
	for shot := 0; shot < 2; shot++ {
		for kind := 0; kind < 2; kind++ {
			a := familyMerge(Combat, 1, []familyReceipt{leaves[shot][kind]}, catalog, []int{kind})
			dispatched[shot][kind] = proveFamily(t, fmt.Sprintf("dispatch%d-shot%d", kind, shot), dl, a, a.Range)
		}
	}
	for _, name := range []string{"wrong-key", "outside-catalog", "phase"} {
		bad := clone(reflect.ValueOf(dispatch)).Interface().(*FamilyNode)
		switch name {
		case "wrong-key":
			bad.Children[0].Selector = 1
		case "outside-catalog":
			bad.Children[0].Selector = 2
		case "phase":
			bad.FamilyPublic = bad.Range.Public(Preparation)
		}
		if dl.cc.IsSolved(wit(t, bad)) == nil {
			t.Fatalf("accepted %s", name)
		}
		t.Logf("REJECTED unary dispatch %s", name)
	}
	fixed := []Key{dl.key}
	dl = nil
	leaves = [2][2]familyReceipt{}
	runtime.GC()
	pair := familyMerge(Combat, 2, dispatched[0][:], fixed, []int{0, 0})
	pl := setupFamily(t, "fixed-dispatched-pair", pair)
	for _, name := range []string{"replay", "omission", "wrong-key"} {
		bad := clone(reflect.ValueOf(pair)).Interface().(*FamilyNode)
		switch name {
		case "replay":
			bad.Children[1] = bad.Children[0]
			bad.ChildRanges[1] = bad.ChildRanges[0]
		case "omission":
			bad.ChildRanges[1] = bad.ChildRanges[0]
		case "wrong-key":
			bad.Children[0].Selector = 1
		}
		if pl.cc.IsSolved(wit(t, bad)) == nil {
			t.Fatalf("accepted %s", name)
		}
		t.Logf("REJECTED fixed pair %s", name)
	}
	for shot := 0; shot < 2; shot++ {
		a := familyMerge(Combat, 2, dispatched[shot][:], fixed, []int{0, 0})
		proveFamily(t, fmt.Sprintf("nonzero-recursive-pair-shot%d", shot), pl, a, a.Range)
	}
	t.Logf("DISPATCHED NONZERO SUBRANGES VERIFIED leafKeys=2 dispatchKeys=1 pairKeys=1 proofs=10 elapsed=%s; NOT complete battle or qualified final", time.Since(start))
}
