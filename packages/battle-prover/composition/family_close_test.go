package composition

import (
	"fmt"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark/frontend"
	"os"
	"reflect"
	"testing"
)

// Test-only fixed4-instruction attribution program. Real sibling constraints,
// not public claims. Key reused for BOTH actual cohorts (loss0 and loss1).
// This is a bounded adapter test, NOT the production level256 root key.
type attributionProgram struct {
	FamilyPublic
	Range FamilyRange
	Steps [4]attrStep
}

func (c *attributionProgram) Define(api frontend.API) error {
	c.Range.bind(api, Attribution, c.FamilyPublic)
	p.New(api).AssertEqual(c.Range.Count, p.Const(4))
	inner := Chunk{Phase: Attribution, Complete: true, Attribution: c.Steps[:], PublicRange: PublicRange{c.Range.First[:5], c.Range.Last[:5]}}
	return inner.Define(api)
}
func TestFamilyCloseAuthentication(t *testing.T) {
	if os.Getenv("RUN_FAMILY_CLOSE") != "1" {
		t.Skip("opt-in real complete attribution proofs")
	}
	_, allocs, bridge, _ := buildTwoSided(t)
	assignments := []*attributionProgram{}
	for _, xs := range allocs {
		a := xs[0]
		if len(a.Attribution) != 4 {
			t.Fatal("fixed attr fixture")
		}
		r := Normalize(Attribution, Range{a.First, a.Last}, p.Const(4))
		c := &attributionProgram{FamilyPublic: r.Public(Attribution), Range: r}
		copy(c.Steps[:], a.Attribution)
		assignments = append(assignments, c)
	}
	l := setupFamily(t, "normalized-attribution4", assignments[0])
	rs := []familyReceipt{}
	for i, c := range assignments {
		rs = append(rs, proveFamily(t, fmt.Sprintf("complete-attr-cohort%d", i), l, c, c.Range))
	}
	closes := []*CompleteClose{}
	i := 0
	for _, s := range bridge {
		if s.Kind != rb.Close {
			continue
		}
		st := s.Statement()
		r := Normalize(Bridge, Range{st[:], st[:]}, p.Const(1))
		c := &CompleteClose{FamilyPublic: r.Public(Bridge), Range: r, Step: privatebridgeStep(s), Allocation: rs[i].rangeValue, Auth: rs[i].auth}
		closes = append(closes, c)
		i++
	}
	cc := compile(t, "complete-close-catalog", closes[0])
	for _, c := range closes {
		check(t, cc.IsSolved(wit(t, c)))
	}
	for _, name := range []string{"context", "result", "omitted", "replay-cohort", "premature", "wrong-selector"} {
		b := clone(reflect.ValueOf(closes[0])).Interface().(*CompleteClose)
		switch name {
		case "context":
			b.Allocation.First[0] = 1
		case "result":
			b.Allocation.Last[4] = 1
		case "omitted":
			b.Auth.Proof = Proof{}
		case "replay-cohort":
			b.Auth = rs[1].auth
			b.Allocation = rs[1].rangeValue
		case "premature":
			b.Allocation.Last[3] = 0
		case "wrong-selector":
			b.Auth.Selector = 1
		}
		w, e := frontend.NewWitness(b, l.cc.Field())
		if e == nil && cc.IsSolved(w) == nil {
			t.Fatalf("accepted %s", name)
		}
		t.Logf("REJECTED normalized Close %s genuine complete attribution", name)
	}
	t.Log("BOTH NONZERO-BATTLE CLOSES AUTHENTICATED same compiled circuit; genuine inner proofs, outer solver only")
}
