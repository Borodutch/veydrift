package memorybattle

import (
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"testing"
)

type linkedStatements struct{ First, Last Statement }

func (c *linkedStatements) Define(api frontend.API) error {
	AssertLinked(api, c.First, c.Last)
	AssertComplete(api, c.First, c.Last)
	return nil
}
func TestConstrainedLinkage(t *testing.T) {
	cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &linkedStatements{})
	if err != nil {
		t.Fatal(err)
	}
	original := linkedStatements{First: Statement{123, 1, 2, 0, 1, 0, 0, 0}, Last: Statement{123, 2, 3, 1, 2, 0, 1, 456}}
	check := func(w *linkedStatements, valid bool) {
		fw, err := frontend.NewWitness(w, ecc.BN254.ScalarField())
		if err != nil {
			t.Fatal(err)
		}
		if err = cc.IsSolved(fw); (err == nil) != valid {
			t.Fatalf("valid=%v err=%v", valid, err)
		}
	}
	check(&original, true)
	for _, tc := range []struct {
		field int
		value int
	}{{ContextField, 12}, {BeforeField, 1}, {StartField, 0}, {BeforeDoneField, 1}, {AfterDoneField, 0}} {
		w := original
		w.Last[tc.field] = tc.value
		check(&w, false)
	}
	w := original
	w.First[StartField] = 1
	check(&w, false)
	w = original
	w.First[AfterDoneField] = 1
	check(&w, false)
	w = original
	w.First[ResultField] = 42
	check(&w, false)
}
