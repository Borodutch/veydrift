package preparation

import (
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"testing"
)

type linkCircuit struct {
	First, Last Statement
	State       State
	Input, RF   frontend.Variable
	Seed        [32]frontend.Variable
	Snapshot    [4]frontend.Variable
}

func (c *linkCircuit) Define(api frontend.API) error {
	AssertComplete(api, c.First, c.Last)
	AssertCombatInput(api, c.Last, c.State, c.Input, c.RF, c.Seed, c.Snapshot)
	return nil
}
func TestCombatLinkage(t *testing.T) {
	m, _ := New(identity(), []Row{row(1, 1, 1)}, base())
	ws, _ := m.Chunk(100)
	bc := mb.Context{Roster: scalar(m.State.UnitRoot), RF: mb.NewMemory().Root(), N: mb.W(1), Snapshot: [4]uint64(mb.Big(m.C.Commitment()))}
	w := linkCircuit{First: ws[0].Statement(), Last: ws[len(ws)-1].Statement(), State: m.State, Input: bc.Commitment(), RF: bc.RF}
	for i := range w.Seed {
		w.Seed[i] = 0
	}
	for i := range w.Snapshot {
		w.Snapshot[i] = bc.Snapshot[i]
	}
	c, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &linkCircuit{})
	if e != nil {
		t.Fatal(e)
	}
	test := func(w *linkCircuit, ok bool) {
		v, e := frontend.NewWitness(w, ecc.BN254.ScalarField())
		if e != nil {
			t.Fatal(e)
		}
		e = c.IsSolved(v)
		if (e == nil) != ok {
			t.Fatalf("link valid=%v err=%v", ok, e)
		}
	}
	test(&w, true)
	for _, mutate := range []func(*linkCircuit){func(x *linkCircuit) { x.State.UnitRoot = 1 }, func(x *linkCircuit) { x.First[1] = x.Last[1] }, func(x *linkCircuit) { x.Last[0] = 1 }, func(x *linkCircuit) { x.Input = 1 }, func(x *linkCircuit) { x.Seed[31] = 1 }} {
		bad := w
		mutate(&bad)
		test(&bad, false)
	}
}
