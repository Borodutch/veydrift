package memorybattle

import (
	"fmt"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"testing"
)

func integer(v frontend.Variable) *big.Int {
	switch x := v.(type) {
	case *big.Int:
		return new(big.Int).Set(x)
	case uint64:
		return num(x)
	case uint8:
		return num(uint64(x))
	case int:
		return big.NewInt(int64(x))
	default:
		panic(fmt.Sprintf("unexpected variable %T", v))
	}
}
func scalarEqual(a, b frontend.Variable) bool { return integer(a).Cmp(integer(b)) == 0 }
func clone(w *Step) *Step                     { c := *w; c.Openings = append([]Opening(nil), w.Openings...); return &c }
func states(w *Step) (State, State) {
	a := State{Memory: integer(w.BeforeMemory), Report: integer(w.BeforeReport)}
	b := State{Memory: integer(w.AfterMemory), Report: integer(w.AfterReport)}
	for i := range a.V {
		a.V[i] = integer(w.Before[i]).Uint64()
		b.V[i] = integer(w.After[i]).Uint64()
	}
	return a, b
}
func recommit(w *Step) {
	a, b := states(w)
	w.BeforeRoot = a.Commitment()
	w.AfterRoot = b.Commitment()
}
func solve(t *testing.T, cc constraint.ConstraintSystem, w *Step, valid bool) {
	t.Helper()
	fw, err := frontend.NewWitness(w, ecc.BN254.ScalarField())
	if err != nil {
		t.Fatal(err)
	}
	err = cc.IsSolved(fw)
	if (err == nil) != valid {
		t.Fatalf("kind=%d start=%v valid=%v err=%v", w.Kind, w.Start, valid, err)
	}
}
func compile(t *testing.T, kind int) constraint.ConstraintSystem {
	t.Helper()
	cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, Shape(kind))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("kind=%d constraints=%d", kind, cc.GetNbConstraints())
	return cc
}

// This is test transcript checking, not a proof verifier or recursive aggregate.
func linked(ws []*Step) bool {
	if len(ws) == 0 || !scalarEqual(ws[0].Start, 0) || !scalarEqual(ws[len(ws)-1].AfterDone, 1) {
		return false
	}
	for i, w := range ws {
		if !scalarEqual(w.BeforeDone, 0) || !scalarEqual(w.End, new(big.Int).Add(integer(w.Start), big.NewInt(1))) {
			return false
		}
		if i > 0 {
			p := ws[i-1]
			if !scalarEqual(w.Context, p.Context) || !scalarEqual(w.BeforeRoot, p.AfterRoot) || !scalarEqual(w.Start, p.End) || !scalarEqual(p.AfterDone, 0) {
				return false
			}
		}
	}
	return true
}
func run(t *testing.T, n int, systems map[int]constraint.ConstraintSystem) (*Machine, []*Step) {
	t.Helper()
	m, err := New(fixture(n))
	if err != nil {
		t.Fatal(err)
	}
	var ws []*Step
	for i := 0; m.State.V[phase] != Done && i < 4000; i++ {
		w, err := m.Next()
		if err != nil {
			t.Fatal(err)
		}
		cc := systems[w.Kind]
		if cc == nil {
			cc = compile(t, w.Kind)
			systems[w.Kind] = cc
		}
		solve(t, cc, w, true)
		ws = append(ws, w)
	}
	if !linked(ws) {
		t.Fatal("incomplete or unlinked trace")
	}
	t.Logf("units=%d constrained_steps=%d final_round=%d counter=%d", n, len(ws), m.State.V[round], m.State.V[counter0])
	return m, ws
}
