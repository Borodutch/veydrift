package composition

import (
	"fmt"
	out "github.com/Borodutch/veydrift/packages/battle-prover/outputbridge"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/consensys/gnark/frontend"
	"math/big"
	"reflect"
	"runtime"
	"testing"
)

// Supplemental linkage test ONLY, never exposed as a verifier. Production
// SettlementFinal verifies both cryptographic bundles before these relations.
type settlementBindings struct {
	Public   out.Settlement `gnark:",public"`
	Raw      RawQualifiedClaims
	Output   OutputPipelineClaims
	Manifest out.Manifest
}

func (c *settlementBindings) Define(api frontend.API) error {
	out.AssertAuthenticated(api, c.Output.First, c.Output.Last, c.Manifest, c.Output.Pipeline, c.Raw.Qualified, c.Raw.RawFirst, c.Raw.RawLast, c.Public)
	return nil
}
func claims(f settlementFixture) (RawQualifiedClaims, OutputPipelineClaims) {
	return RawQualifiedClaims{f.raw[0].Statement(), f.raw[len(f.raw)-1].Statement(), f.qualified.Statement()}, OutputPipelineClaims{f.steps[0].Statement(), f.steps[len(f.steps)-1].Statement(), f.m.Manifest.Pipeline}
}
func TestSettlementBindings(t *testing.T) {
	f := buildSettlement(t, false)
	a, b := claims(f)
	c := &settlementBindings{f.m.Manifest.Settlement(), a, b, f.m.Manifest}
	cc := compile(t, "settlement22-bindings", c)
	if cc.GetNbPublicVariables() != 23 {
		t.Fatal("22-public ABI")
	}
	check(t, cc.IsSolved(wit(t, c)))
	for _, name := range []string{"raw-genesis", "raw-premature", "raw-result", "old-SHA-layout", "context", "combat-input", "output-premature", "output-root", "report", "allocation", "settlement-root", "settlement-chain", "limb-alias", "member-omission"} {
		d := clone(reflect.ValueOf(c)).Interface().(*settlementBindings)
		switch name {
		case "raw-genesis":
			d.Raw.RawFirst[1] = 1
		case "raw-premature":
			d.Raw.RawLast[4] = raw.Row
		case "raw-result":
			d.Raw.RawLast[3] = 1
		case "old-SHA-layout":
			d.Raw.Qualified = [7]frontend.Variable{a.Qualified[0], a.Qualified[1], a.Qualified[3], a.Qualified[4], a.Qualified[5], a.Qualified[6], 1}
		case "context":
			d.Raw.Qualified[0] = 1
		case "combat-input":
			d.Raw.Qualified[1] = 1
		case "output-premature":
			d.Output.Last[3] = 0
		case "output-root":
			d.Manifest.Root = p.Const(1)
		case "report":
			d.Output.Pipeline[6] = 1
		case "allocation":
			d.Output.Pipeline[5] = 1
		case "settlement-root":
			d.Public[4] = 1
		case "settlement-chain":
			d.Public[0] = 1
		case "limb-alias":
			d.Public[0] = new(big.Int).Lsh(big.NewInt(1), 64)
		case "member-omission":
			d.Public[8] = 2
		}
		if cc.IsSolved(wit(t, d)) == nil {
			t.Fatalf("accepted %s", name)
		}
		t.Logf("REJECTED binding %s (supplemental solver, not proof)", name)
	}
	t.Logf("REAL FIXTURE raw=%d prep=%d combat=%d bridge=%d attributionGroups=%d report=%d output=%d completeSettlement=%v", len(f.raw), len(f.prep), len(f.combat), len(f.bridgeSteps), len(f.bridge.AttrSteps), len(f.reports), len(f.steps), c.Public)
}
func TestRawOutputFixedFamilies(t *testing.T) {
	f := buildSettlement(t, false)
	for _, phase := range []int{RawJournal, SettlementOutput} {
		kinds := 4
		if phase == SettlementOutput {
			kinds = 5
		}
		for kind := 0; kind < kinds; kind++ {
			shape, e := LeafShape(phase, kind)
			check(t, e)
			cc := compile(t, fmt.Sprintf("journal-phase%d-kind%d", phase, kind), shape)
			if cc.GetNbPublicVariables() != 4 {
				t.Fatal("normalized3 ABI")
			}
			if phase == RawJournal {
				for _, s := range f.raw {
					if s.Kind != kind {
						continue
					}
					st := s.Statement()
					c := &Chunk{Phase: phase, PublicRange: PublicRange{st[:], st[:]}, Raw: []rawStep{privateRaw(s)}}
					check(t, cc.IsSolved(wit(t, NewFamilyLeaf(c))))
				}
			} else {
				for _, s := range f.steps {
					if s.Kind != kind {
						continue
					}
					st := s.Statement()
					c := &Chunk{Phase: phase, PublicRange: PublicRange{st[:], st[:]}, Output: []outputStep{privateOutput(s)}}
					check(t, cc.IsSolved(wit(t, NewFamilyLeaf(c))))
				}
			}
			cc = nil
			runtime.GC()
		}
	}
	cc := compile(t, "actual-linked-qualification", f.qualified)
	check(t, cc.IsSolved(wit(t, f.qualified)))
}
