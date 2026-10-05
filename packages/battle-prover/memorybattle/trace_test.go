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
		panic(fmt.Sprintf("unexpected %T", v))
	}
}
func scalarEqual(a, b frontend.Variable) bool { return integer(a).Cmp(integer(b)) == 0 }
func word(v U) Word {
	var w Word
	for i, x := range v {
		w[i] = integer(x).Uint64()
	}
	return w
}
func clone(w *Step) *Step { c := *w; c.Openings = append([]Opening(nil), w.Openings...); return &c }
func states(w *Step) (State, State) {
	a := State{Memory: integer(w.BeforeMemory), Report: integer(w.BeforeReport)}
	b := State{Memory: integer(w.AfterMemory), Report: integer(w.AfterReport)}
	for i := range a.V {
		a.V[i] = word(w.Before[i])
		b.V[i] = word(w.After[i])
	}
	return a, b
}
func recommit(w *Step) {
	a, b := states(w)
	w.BeforeRoot = a.Commitment()
	w.AfterRoot = b.Commitment()
	w.Start = position(a.V[step])
	w.End = position(b.V[step])
}
func solve(t *testing.T, cc constraint.ConstraintSystem, w *Step, valid bool) {
	t.Helper()
	fw, e := frontend.NewWitness(w, ecc.BN254.ScalarField())
	if e != nil {
		t.Fatal(e)
	}
	e = cc.IsSolved(fw)
	if (e == nil) != valid {
		t.Fatalf("kind=%d valid=%v err=%v", w.Kind, valid, e)
	}
}
func compile(t *testing.T, k int) constraint.ConstraintSystem {
	t.Helper()
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, Shape(k))
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("kind=%d constraints=%d", k, cc.GetNbConstraints())
	return cc
}
func linked(ws []*Step) bool {
	if len(ws) == 0 || !scalarEqual(ws[0].Start, 0) || !scalarEqual(ws[len(ws)-1].AfterDone, 1) {
		return false
	}
	for i, w := range ws {
		if !scalarEqual(w.BeforeDone, 0) {
			return false
		}
		if i > 0 {
			p := ws[i-1]
			if !scalarEqual(w.Input, p.Input) || !scalarEqual(w.BeforeRoot, p.AfterRoot) || !scalarEqual(w.Start, p.End) || !scalarEqual(p.AfterDone, 0) {
				return false
			}
		}
	}
	return true
}
