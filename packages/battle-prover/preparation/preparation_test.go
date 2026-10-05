package preparation

import (
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"testing"
)

func identity() Identity {
	return Identity{p.Const(8453), p.Const(1), p.Const(2), p.Const(3), p.Const(4), p.Const(5), p.Const(6), p.Const(7), p.Const(8), p.Const(9), 0}
}
func row(owner, source, count uint64) Row {
	return Row{p.Const(owner), p.Const(source), p.Const(count), 0, 0, p.Technology{0, 0, 0}}
}
func base() map[uint64]p.Stats { return map[uint64]p.Stats{0: {p.Const(20), p.Const(5), p.Const(100)}} }
func compile(t *testing.T, kind int) constraint.ConstraintSystem {
	t.Helper()
	c, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, Shape(kind))
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("kind=%d constraints=%d", kind, c.GetNbConstraints())
	return c
}
func solve(t *testing.T, c constraint.ConstraintSystem, w *Step, ok bool) {
	t.Helper()
	v, e := frontend.NewWitness(w, ecc.BN254.ScalarField())
	if e != nil {
		t.Fatal(e)
	}
	e = c.IsSolved(v)
	if (e == nil) != ok {
		t.Fatalf("kind=%d expected valid=%v error=%v", w.Kind, ok, e)
	}
}
func TestCompleteTrace(t *testing.T) {
	systems := map[int]constraint.ConstraintSystem{}
	for _, rows := range [][]Row{{row(2, 8, 1), row(1, 9, 2)}, {}, {row(1, 1, 0)}, {row(1, 1, 0), row(2, 2, 1)}, {func() Row { r := row(1, 1, 1); r.Tech = p.Technology{1, 2, 3}; return r }(), row(2, 2, 1)}} {
		m, e := New(identity(), rows, base())
		if e != nil {
			t.Fatal(e)
		}
		var previous *Step
		for scalar(m.State.Phase).Int64() != Done {
			ws, e := m.Chunk(2)
			if e != nil {
				t.Fatal(e)
			}
			for _, w := range ws {
				c := systems[w.Kind]
				if c == nil {
					c = compile(t, w.Kind)
					systems[w.Kind] = c
				}
				solve(t, c, w, true)
				if previous != nil && scalar(previous.AfterHash).Cmp(scalar(w.BeforeHash)) != 0 {
					t.Fatal("link")
				}
				previous = w
			}
		}
		if scalar(previous.Result).Sign() == 0 {
			t.Fatal("missing result")
		}
	}
}
func TestForgery(t *testing.T) {
	m, _ := New(identity(), []Row{row(1, 1, 1)}, base())
	ws, _ := m.Chunk(100)
	for _, w := range ws {
		c := compile(t, w.Kind)
		bad := *w
		bad.AfterHash = 1
		solve(t, c, &bad, false)
		bad = *w
		bad.C.Identity.Battle = p.Const(100)
		solve(t, c, &bad, false)
		if w.Kind == Member {
			for _, mutate := range []func(*Step){func(x *Step) { x.Row.Count = p.Const(2) }, func(x *Step) { x.Index = p.Const(1) }, func(x *Step) { x.Effective.Attack = p.Const(21) }, func(x *Step) { x.Base.Hull = p.Const(101) }, func(x *Step) { x.Row.Tech.Armor = 1 }, func(x *Step) { x.After.Processed = p.Const(0) }, func(x *Step) { x.After.Visited = x.Before.Visited }} {
				bad = *w
				mutate(&bad)
				bad.AfterHash = bad.After.Commitment()
				solve(t, c, &bad, false)
			}
		}
	}
}
func TestDuplicateSource(t *testing.T) {
	m, _ := New(identity(), []Row{row(1, 1, 1), row(1, 1, 1)}, base())
	m.Next()
	m.Next()
	w, _ := m.Next()
	solve(t, compile(t, Pair), w, false)
}
func TestUnitTreeHighBits(t *testing.T) {
	tree := NewUnitTree()
	k := rowKey(row(1, 1, 1), base()[0])
	low := big.NewInt(3)
	high := new(big.Int).Add(new(big.Int).Lsh(big.NewInt(1), 255), low)
	tree.Write(low, k, p.Const(0))
	a := tree.Root()
	tree.Write(high, k, p.Const(1))
	if a.Cmp(tree.Root()) == 0 {
		t.Fatal("high bits alias")
	}
}
