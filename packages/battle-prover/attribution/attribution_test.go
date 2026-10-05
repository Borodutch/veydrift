package attribution

import (
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"reflect"
	"testing"
)

func context() Context {
	return Context{Snapshot: U(44), Cohort: U(0), Side: 0, Type: 7, Stats: [3]Uint256{U(100), U(20), U(300)}, Members: U(0), Total: U(0), Loss: U(0), Roster: 0, Units: 0}
}
func member(owner, source, q uint64) Member { return Member{U(owner), U(source), q} }
func fixture(t *testing.T, loss int) *Machine {
	t.Helper()
	ds := make([]bool, 5)
	for i := 0; i < loss; i++ {
		ds[i] = true
	}
	m, e := Prepare(context(), []Member{member(1, 10, 2), member(1, 2, 2), member(1, 20, 1)}, ds)
	if e != nil {
		t.Fatal(e)
	}
	return m
}
func compile(t *testing.T, kind int) constraint.ConstraintSystem {
	t.Helper()
	c, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, Shape(kind))
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("kind=%d constraints=%d", kind, c.GetNbConstraints())
	return c
}
func solve(t *testing.T, c constraint.ConstraintSystem, w frontend.Circuit, ok bool) {
	t.Helper()
	v, e := frontend.NewWitness(w, ecc.BN254.ScalarField())
	if e != nil {
		t.Fatal(e)
	}
	e = c.IsSolved(v)
	if (e == nil) != ok {
		t.Fatalf("solve wanted=%v error=%v", ok, e)
	}
}
func run(t *testing.T, m *Machine, systems map[int]constraint.ConstraintSystem) []*Step {
	t.Helper()
	var ws []*Step
	for integer(m.State.Phase).Int64() != Done {
		w, e := m.Next()
		if e != nil {
			t.Fatal(e)
		}
		if systems != nil {
			if systems[w.Kind] == nil {
				systems[w.Kind] = compile(t, w.Kind)
			}
			solve(t, systems[w.Kind], w, true)
		}
		ws = append(ws, w)
		if len(ws) > 10000 {
			t.Fatal("host work budget")
		}
	}
	return ws
}
func TestCompileAndSingleCohort(t *testing.T) {
	systems := map[int]constraint.ConstraintSystem{}
	m := fixture(t, 2)
	ws := run(t, m, systems)
	if len(ws) != 20 {
		t.Fatalf("steps %d", len(ws))
	}
	if m.Rows[0].Lost != 1 || m.Rows[1].Lost != 1 || m.Rows[2].Lost != 0 {
		t.Fatal(m.Rows)
	}
	expected, e := NativeLargestRemainder(m.Members, number(m.Context.Loss))
	if e != nil || !reflect.DeepEqual(expected, m.Rows) {
		t.Fatal("oracle mismatch", e)
	}
	for _, loss := range []int{0, 1, 3, 4, 5} {
		m := fixture(t, loss)
		run(t, m, systems)
		expected, _ := NativeLargestRemainder(m.Members, number(m.Context.Loss))
		if !reflect.DeepEqual(expected, m.Rows) {
			t.Fatalf("loss=%d", loss)
		}
	}
	if _, e := m.Next(); e == nil {
		t.Fatal("terminal next")
	}
}
func TestWitnessAttacks(t *testing.T) {
	systems := map[int]constraint.ConstraintSystem{}
	m := fixture(t, 2)
	ws := run(t, m, systems)
	tests := []struct {
		name   string
		i      int
		mutate func(*Step)
	}{
		{"member-source", 0, func(w *Step) { w.Member.Source = U(999) }},
		{"member-owner", 0, func(w *Step) { w.Member.Owner = U(99) }},
		{"member-quantity", 0, func(w *Step) { w.Member.Quantity = 3 }},
		{"owner160", 0, func(w *Step) { w.Member.Owner[2] = uint64(1) << 32 }},
		{"source-limb64", 0, func(w *Step) { w.Member.Source[3] = new(big.Int).Lsh(big.NewInt(1), 64) }},
		{"quantity32", 0, func(w *Step) { w.Member.Quantity = uint64(1) << 32 }},
		{"duplicate", 1, func(w *Step) { w.Member = ws[0].Member }},
		{"reordered", 0, func(w *Step) { w.Member = ws[1].Member }},
		{"claimed-total", 2, func(w *Step) { w.Context.Total = U(6) }},
		{"claimed-loss", 7, func(w *Step) { w.Context.Loss = U(3) }},
		{"casualty-bit", 3, func(w *Step) { w.Dead = 0 }},
		{"nonboolean-dead", 3, func(w *Step) { w.Dead = 2 }},
		{"casualty-root", 7, func(w *Step) { w.Context.Units = 1 }},
		{"floor-quotient", 8, func(w *Step) { w.Quotient = 1 }},
		{"floor-remainder", 8, func(w *Step) { w.Remainder = U(0) }},
		{"q32", 8, func(w *Step) { w.Quotient = uint64(1) << 32 }},
		{"remainder-equal-divisor", 8, func(w *Step) { w.Remainder = w.Context.Total }},
		{"rank-quotient", 11, func(w *Step) { w.TargetQuotient = 1 }},
		{"rank-increment", 11, func(w *Step) { w.After.Rank = U(1) }},
		{"target-changes-midscan", 12, func(w *Step) { w.Target = ws[14].Target }},
		{"wrong-output", 19, func(w *Step) { w.After.Output = 1 }},
		{"wrong-lost-sum", 19, func(w *Step) { w.After.LostSum = U(1) }},
		{"skipped-inner-member", 12, func(w *Step) { w.After.Index = U(0) }},
		{"skipped-outer-member", 13, func(w *Step) { w.After.Outer = U(2) }},
		{"premature-done", 11, func(w *Step) { w.After.Phase = Done }},
		{"sum-overflow", 0, func(w *Step) {
			w.Before.Sum = Big(new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)))
			w.After.Sum = U(1)
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) { w := *ws[tc.i]; tc.mutate(&w); w.commit(); solve(t, systems[w.Kind], &w, false) })
	}
	t.Run("public-result", func(t *testing.T) { w := *ws[19]; w.Result = 1; solve(t, systems[Rank], &w, false) })
	t.Run("public-context", func(t *testing.T) { w := *ws[0]; w.ContextRoot = 1; solve(t, systems[Collect], &w, false) })
}
func TestInputOrderAndMemberIdentity(t *testing.T) {
	ms := []Member{member(2, 2, 1), member(1, 100, 1), member(1, 10, 1)}
	ds := []bool{true, false, false}
	a, e := Prepare(context(), ms, ds)
	if e != nil {
		t.Fatal(e)
	}
	ms[0], ms[2] = ms[2], ms[0]
	b, e := Prepare(context(), ms, ds)
	if e != nil {
		t.Fatal(e)
	}
	if a.Context.Commitment().Cmp(b.Context.Commitment()) != 0 {
		t.Fatal("order changed context")
	}
	run(t, a, nil)
	run(t, b, nil)
	if !reflect.DeepEqual(a.Rows, b.Rows) || number(a.Rows[0].Member.Source).Uint64() != 10 || a.Rows[0].Lost != 1 {
		t.Fatal("tie order")
	}
	for _, bad := range [][]Member{{member(1, 2, 1), member(1, 2, 1)}, {member(1, 2, 1), member(2, 2, 1)}, {member(1, 2, 0)}} {
		if _, e := Prepare(context(), bad, []bool{true, false}); e == nil {
			t.Fatal("accepted malformed roster")
		}
	}
	if _, e := Prepare(context(), []Member{member(1, 2, 2)}, []bool{true}); e == nil {
		t.Fatal("missing unit")
	}
	changed := append([]Member(nil), ms...)
	changed[0].Source = U(5)
	c, _ := Prepare(context(), changed, ds)
	if c.Context.Commitment().Cmp(b.Context.Commitment()) == 0 {
		t.Fatal("changed source unbound")
	}
}
