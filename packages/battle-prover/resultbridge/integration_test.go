package resultbridge

import (
	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"testing"
)

func compile(t *testing.T, c frontend.Circuit) constraint.ConstraintSystem {
	t.Helper()
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, c)
	if e != nil {
		t.Fatal(e)
	}
	return cc
}
func solve(t *testing.T, cc constraint.ConstraintSystem, w frontend.Circuit, ok bool) {
	t.Helper()
	v, e := frontend.NewWitness(w, ecc.BN254.ScalarField())
	if e != nil {
		t.Fatal(e)
	}
	e = cc.IsSolved(v)
	if (e == nil) != ok {
		t.Fatalf("expected valid=%v: %v", ok, e)
	}
}
func identity() prep.Identity {
	return prep.Identity{Chain: Z(8453), Game: Z(1), Battle: Z(2), Body: Z(3), Incarnation: Z(4), Impact: Z(5), Rules: Z(6), Verifier: Z(7), Catalog: Z(8), SeedPolicy: Z(9), TargetIsMoon: 0}
}
func group(id, side, typ, attack uint64, qs ...uint64) Group {
	g := Group{Cohort: Cohort{ID: Z(id), Key: p.Key{Side: side, Type: typ, Stats: p.Stats{Attack: Z(attack), Shield: Z(0), Hull: Z(100)}}, Members: Z(uint64(len(qs))), Total: Z(0)}}
	for i, q := range qs {
		g.Cohort.Total = add(g.Cohort.Total, q)
		g.Members = append(g.Members, Member{Z(uint64(i + 1)), Z(uint64(10*id) + uint64(i+1)), q, p.Technology{Weapons: 0, Shielding: 0, Armor: 0}})
	}
	return g
}

type fixture struct {
	m           *Machine
	prepSteps   []*prep.Step
	combatSteps []*mb.Step
	bridgeSteps []*Step
	combat      *mb.Machine
}

func build(t *testing.T, groups []Group) fixture {
	t.Helper()
	rows := []prep.Row{}
	bases := map[uint64]p.Stats{}
	units := []mb.Cell{}
	for _, g := range groups {
		bases[scalar(g.Cohort.Key.Type).Uint64()] = g.Cohort.Key.Stats
		for _, m := range g.Members {
			rows = append(rows, m.Row(g.Cohort.Key))
		}
		for j := uint64(0); j < number(g.Cohort.Total).Uint64(); j++ {
			units = append(units, mb.Cell{mb.W(scalar(g.Cohort.Key.Side).Uint64()), mb.W(scalar(g.Cohort.Key.Type).Uint64()), mb.Big(number(g.Cohort.Key.Stats.Attack)), mb.Big(number(g.Cohort.Key.Stats.Shield)), mb.Big(number(g.Cohort.Key.Stats.Hull)), mb.Big(number(g.Cohort.ID))})
		}
	}
	pm, e := prep.New(identity(), rows, bases)
	if e != nil {
		t.Fatal(e)
	}
	ps, e := pm.Chunk(10000)
	if e != nil {
		t.Fatal(e)
	}
	if scalar(pm.State.Phase).Int64() != prep.Done {
		t.Fatal("preparation budget exhausted")
	}
	snapshot := mb.Big(pm.C.Commitment())
	combat, e := mb.New(mb.PreparedInput{Units: units, Snapshot: [4]uint64(snapshot)})
	if e != nil {
		t.Fatal(e)
	}
	if combat.Context.Roster.Cmp(pm.Units.Root()) != 0 {
		t.Fatal("actual preparation/combat roster roots differ")
	}
	cs := []*mb.Step{}
	for i := 0; i < 2000 && combat.State.V[0] != mb.W(mb.Done); i++ {
		w, e := combat.Next()
		if e != nil {
			t.Fatal(e)
		}
		cs = append(cs, w)
	}
	if combat.State.V[0] != mb.W(mb.Done) {
		t.Fatal("combat budget exhausted")
	}
	cr, mr, n, nm := PreparedRoots(groups)
	if cr.Cmp(scalar(pm.State.Cohorts)) != 0 || mr.Cmp(scalar(pm.State.Members)) != 0 {
		t.Fatal("manifest mismatch")
	}
	c := Context{Prepared: Prepared{PreparationContext: pm.C.Commitment(), Snapshot: snapshot.Circuit(), Roster: pm.Units.Root(), RF: combat.Context.RF, N: n, Cohorts: Z(uint64(len(groups))), Members: nm, CohortRoot: cr, MemberRoot: mr}, Combat: Combat{Memory: combat.State.Memory, Report: combat.State.Report, Round: combat.State.V[1].Circuit(), Count0: combat.State.V[6].Circuit(), Count1: combat.State.V[7].Circuit(), Outcome: combat.State.V[11].Circuit()}}
	for i := range c.Combat.Seed {
		c.Combat.Seed[i] = 0
	}
	if c.Prepared.Commitment().Cmp(scalar(ps[len(ps)-1].Result)) != 0 {
		t.Fatal("preparation result mismatch")
	}
	if c.Input().Cmp(combat.Context.Commitment()) != 0 || c.CombatResult().Cmp(combat.Context.Result(combat.State)) != 0 {
		t.Fatal("combat commitments mismatch")
	}
	m, e := FromMachines(pm, combat, groups)
	if e != nil {
		t.Fatal(e)
	}
	if m.Context.Commitment().Cmp(c.Commitment()) != 0 {
		t.Fatal("adapter context differs")
	}
	bs := []*Step{}
	for i := 0; i < 1000 && scalar(m.State.Phase).Int64() != Done; i++ {
		w, e := m.Next()
		if e != nil {
			t.Fatal(e)
		}
		bs = append(bs, w)
	}
	if scalar(m.State.Phase).Int64() != Done {
		t.Fatal("bridge budget exhausted")
	}
	return fixture{m, ps, cs, bs, combat}
}
func TestActualPackageIntegration(t *testing.T) {
	systems := map[int]constraint.ConstraintSystem{}
	as := map[int]constraint.ConstraintSystem{}
	for _, groups := range [][]Group{{group(0, 0, 0, 200, 1, 1), group(1, 1, 1, 0, 1)}, {group(0, 0, 0, 200, 1), group(1, 1, 1, 200, 1)}, {group(0, 0, 0, 0, 1)}, {}, {group(0, 1, 0, 0, 1)}} {
		f := build(t, groups)
		for _, w := range f.bridgeSteps {
			if systems[w.Kind] == nil {
				systems[w.Kind] = compile(t, Shape(w.Kind))
				t.Logf("bridge kind=%d constraints=%d", w.Kind, systems[w.Kind].GetNbConstraints())
			}
			solve(t, systems[w.Kind], w, true)
		}
		for i, steps := range f.m.AttrSteps {
			for _, w := range steps {
				if as[w.Kind] == nil {
					as[w.Kind] = compile(t, attr.Shape(w.Kind))
				}
				solve(t, as[w.Kind], w, true)
			}
			var close *Step
			found := 0
			for _, w := range f.bridgeSteps {
				if w.Kind == Close {
					if found == i {
						close = w
						break
					}
					found++
				}
			}
			if scalar(close.AttributionContext).Cmp(scalar(steps[0].ContextRoot)) != 0 || scalar(close.AttributionResult).Cmp(scalar(steps[len(steps)-1].Result)) != 0 {
				t.Fatal("attribution linkage mismatch")
			}
		}
	}
}
func TestCrossPackageElementarySolvers(t *testing.T) {
	f := build(t, []Group{group(0, 0, 0, 0, 1)})
	ps := map[int]constraint.ConstraintSystem{}
	for _, w := range f.prepSteps {
		if ps[w.Kind] == nil {
			ps[w.Kind] = compile(t, prep.Shape(w.Kind))
		}
		solve(t, ps[w.Kind], w, true)
	}
	cs := map[int]constraint.ConstraintSystem{}
	for _, w := range f.combatSteps {
		if cs[w.Kind] == nil {
			cs[w.Kind] = compile(t, mb.Shape(w.Kind))
		}
		solve(t, cs[w.Kind], w, true)
	}
}
func TestBoundaryHighBits(t *testing.T) {
	f := build(t, []Group{group(0, 0, 0, 0, 1)})
	var unit *Step
	for _, w := range f.bridgeSteps {
		if w.Kind == Units {
			unit = w
		}
	}
	cc := compile(t, Shape(Units))
	w := *unit
	w.Unit.Cell[6] = p.MustValue(new(big.Int).Lsh(big.NewInt(1), 200))
	solve(t, cc, &w, false)
	w = *unit
	w.Before.Unit = p.MustValue(new(big.Int).Lsh(big.NewInt(1), 255))
	w.BeforeRoot = w.Before.Commitment()
	solve(t, cc, &w, false)
}
