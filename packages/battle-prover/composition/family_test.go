package composition

import (
	"fmt"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"reflect"
	"runtime"
	"testing"
)

func leafID(c *FamilyLeaf) string {
	kind := 0
	switch c.Phase {
	case Preparation:
		kind = c.Preparation[0].Kind
	case Combat:
		kind = c.Combat[0].Kind
	case Attribution:
		kind = c.Attribution[0].Kind
	case Bridge:
		kind = c.Bridge[0].Kind
	case Report:
		kind = c.Reports[0].Kind
	}
	return fmt.Sprintf("phase%d-kind%d", c.Phase, kind)
}
func TestFamilyFixedShapes(t *testing.T) {
	one := build(t)
	two, allocs, bridge, report := buildTwoSided(t)
	all := []*FamilyLeaf{}
	for _, s := range one.prep.Preparation {
		c := &Chunk{Phase: Preparation, Preparation: []prepStep{s}}
		setRange(c)
		all = append(all, NewFamilyLeaf(c))
	}
	for _, s := range one.combat.Combat {
		c := &Chunk{Phase: Combat, Combat: []combatStep{s}}
		setRange(c)
		all = append(all, NewFamilyLeaf(c))
	}
	for _, c := range two {
		all = append(all, NewFamilyLeaf(c))
	}
	for _, a := range allocs {
		for _, s := range a[0].Attribution {
			c := &Chunk{Phase: Attribution, Attribution: []attrStep{s}}
			setRange(c)
			all = append(all, NewFamilyLeaf(c))
		}
	}
	for _, s := range bridge {
		if s.Kind == 3 {
			continue
		}
		c := &Chunk{Phase: Bridge, Bridge: []bridgeStep{privatebridgeStep(s)}}
		setRange(c)
		all = append(all, NewFamilyLeaf(c))
	}
	for _, s := range report.Reports {
		c := &Chunk{Phase: Report, Reports: []reportStep{s}}
		setRange(c)
		all = append(all, NewFamilyLeaf(c))
	}
	for _, s := range one.report.Reports {
		c := &Chunk{Phase: Report, Reports: []reportStep{s}}
		setRange(c)
		all = append(all, NewFamilyLeaf(c))
	}
	// Group by fixed phase/kind and release each CCS before the next family.
	ids := []string{}
	seen := map[string]bool{}
	for _, c := range all {
		id := leafID(c)
		if !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	for _, id := range ids {
		var cc constraint.ConstraintSystem
		n := 0
		for _, c := range all {
			if leafID(c) != id {
				continue
			}
			if cc == nil {
				var phase, kind int
				_, err := fmt.Sscanf(id, "phase%d-kind%d", &phase, &kind)
				check(t, err)
				shape, err := LeafShape(phase, kind)
				check(t, err)
				cc = compile(t, id, shape)
				if cc.GetNbPublicVariables()-1 != 3 {
					t.Fatal("normalized schema")
				}
				t.Logf("FAMILY %s commitments=%d", id, len(cc.GetCommitments().(constraint.Groth16Commitments)))
			}
			check(t, cc.IsSolved(wit(t, c)))
			n++
			bad := clone(reflect.ValueOf(c)).Interface().(*FamilyLeaf)
			bad.Range.Count = p.Const(2)
			bad.FamilyPublic = bad.Range.Public(c.Phase)
			if cc.IsSolved(wit(t, bad)) == nil {
				t.Fatal("leaf work forgery")
			}
		}
		t.Logf("REUSED identical CCS %s witnesses=%d rosterSizes=1,2 (where phase present)", id, n)
		cc = nil
		runtime.GC()
	}
	for _, n := range []int{1, 2, 3, 5, 24, 257} {
		levels, e := Schedule(n)
		check(t, e)
		previous := n
		for _, ns := range levels {
			if len(ns) != (previous+1)/2 {
				t.Fatal("arity")
			}
			cursor := 0
			for _, v := range ns {
				if v.Start != cursor || v.End <= v.Start {
					t.Fatal("coverage")
				}
				cursor = v.End
			}
			if cursor != n {
				t.Fatal("omission")
			}
			previous = len(ns)
		}
		if previous != 1 {
			t.Fatal("root")
		}
		t.Logf("SCHEDULE leaves=%d levels=%d no-padding", n, len(levels))
	}
}

// Tests the binding's full-width work limit, independent of host slice limits.
type familyBound struct {
	FamilyPublic
	Range FamilyRange
	Phase int `gnark:"-"`
}

func (c *familyBound) Define(api frontend.API) error {
	c.Range.bind(api, c.Phase, c.FamilyPublic)
	return nil
}
func TestFamilyUint256(t *testing.T) {
	f := build(t)
	r := Normalize(Preparation, Range{f.prep.First, f.prep.Last}, p.Uint256{uint64(0), uint64(0), uint64(0), uint64(1) << 63})
	c := &familyBound{r.Public(Preparation), r, Preparation}
	cc := compile(t, "uint256-count", c)
	check(t, cc.IsSolved(wit(t, c)))
	c.Range.Count = p.Const(0)
	c.FamilyPublic = c.Range.Public(Preparation)
	if cc.IsSolved(wit(t, c)) == nil {
		t.Fatal("zero work")
	}
}
