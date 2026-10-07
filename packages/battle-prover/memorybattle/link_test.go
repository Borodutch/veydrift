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
	}{{InputField, 12}, {BeforeField, 1}, {StartField, 0}, {BeforeDoneField, 1}, {AfterDoneField, 0}} {
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

type terminalCheckpoint struct {
	Statement      Statement
	V              [StateSize]U
	Memory, Report frontend.Variable
}

func (c *terminalCheckpoint) Define(api frontend.API) error {
	AssertTerminal(api, c.Statement, c.V, c.Memory, c.Report)
	return nil
}
func TestTerminalCheckpointBinding(t *testing.T) {
	m, e := New(fixture(0))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = m.Next(); e != nil {
		t.Fatal(e)
	}
	last, e := m.Next()
	if e != nil {
		t.Fatal(e)
	}
	w := terminalCheckpoint{last.Statement(), last.After, last.AfterMemory, last.AfterReport}
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &terminalCheckpoint{})
	if e != nil {
		t.Fatal(e)
	}
	check := func(w terminalCheckpoint, valid bool) {
		fw, e := frontend.NewWitness(&w, ecc.BN254.ScalarField())
		if e != nil {
			t.Fatal(e)
		}
		if e = cc.IsSolved(fw); (e == nil) != valid {
			t.Fatalf("terminal valid=%v err=%v", valid, e)
		}
	}
	check(w, true)
	bad := w
	bad.V[counter][3] = 1
	check(bad, false)
	bad = w
	bad.Memory = 1
	check(bad, false)
	bad = w
	bad.Report = 1
	check(bad, false)
	bad = w
	bad.Statement[AfterDoneField] = 0
	check(bad, false)
}
