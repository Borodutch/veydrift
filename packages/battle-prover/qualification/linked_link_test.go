package qualification

import (
	m "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"testing"
)

type linkedBoundary struct {
	Q LinkedStatement
	R rb.Statement
	P prep.Statement
	B m.Statement
}

func (c *linkedBoundary) Define(api frontend.API) error {
	AssertLinkedStatements(api, c.Q, c.R, c.P, c.B)
	return nil
}
func TestLinkedBoundary(t *testing.T) {
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &linkedBoundary{})
	if e != nil {
		t.Fatal(e)
	}
	w := linkedBoundary{Q: LinkedStatement{1, 2, 3, 4, 5, 6, 7}, R: rb.Statement{8, 9, 10, 3, rb.Seal}, P: prep.Statement{1, 11, 12, 13}, B: m.Statement{2, 14, 15, 0, 1, 0, 1, 16}}
	check := func(w *linkedBoundary, ok bool) {
		v, e := frontend.NewWitness(w, ecc.BN254.ScalarField())
		if e != nil {
			t.Fatal(e)
		}
		e = cc.IsSolved(v)
		if (e == nil) != ok {
			t.Fatal(ok, e)
		}
	}
	check(&w, true)
	for _, f := range []func(*linkedBoundary){func(w *linkedBoundary) { w.R[3] = 17 }, func(w *linkedBoundary) { w.R[4] = rb.Row }, func(w *linkedBoundary) { w.P[0] = 17 }, func(w *linkedBoundary) { w.B[0] = 17 }} {
		bad := w
		f(&bad)
		check(&bad, false)
	}
}
