package battle

import (
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"testing"
)

func TestEmptySideInitialization(t *testing.T) {
	c := fixture()
	for i := range c.Units {
		c.Units[i].Side = 0
	}
	ss := trace(t, c, [32]byte{})
	s := ss[len(ss)-1]
	if s.Round != 0 || s.Counter != 0 || s.Outcome != 1 {
		t.Fatalf("wrong empty-side result %+v", s)
	}
	cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &Step{Config: c})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < len(ss)-1; i++ {
		w, err := frontend.NewWitness(Assignment(c, [32]byte{}, ss[i], ss[i+1], false), ecc.BN254.ScalarField())
		if err != nil {
			t.Fatal(err)
		}
		if err = cc.IsSolved(w); err != nil {
			t.Fatal(err)
		}
	}
}
func TestDeadRoundParticipantStillFires(t *testing.T) {
	c := fixture()
	s := State{Phase: Advance, Step: 50, Round: 1, Side: 0, Shooter: 1, Pool: [Slots]uint64{1, 1, 1, 1}, Hull: [Slots]uint64{130, 100, 0, 0}}
	n, err := c.Next([32]byte{}, s)
	if err != nil {
		t.Fatal(err)
	}
	if n.Phase != Target || n.Side != 1 || n.Shooter != 2 {
		t.Fatalf("dead defender lost firing eligibility %+v", n)
	}
	cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &Step{Config: c})
	if err != nil {
		t.Fatal(err)
	}
	w, err := frontend.NewWitness(Assignment(c, [32]byte{}, s, n, false), ecc.BN254.ScalarField())
	if err != nil {
		t.Fatal(err)
	}
	if err = cc.IsSolved(w); err != nil {
		t.Fatal(err)
	}
}
func TestFixedInputValidation(t *testing.T) {
	for _, name := range []string{"owner-tech", "source", "catalog", "rf", "zero-hull", "base-overflow", "cohort-order"} {
		t.Run(name, func(t *testing.T) {
			c := fixture()
			switch name {
			case "owner-tech":
				c.Units[1].Owner = c.Units[0].Owner
			case "source":
				c.Units[1].Source = c.Units[0].Source
			case "catalog":
				c.Units[2].Type = 0
				c.Units[2].Base[0]++
			case "rf":
				c.RF[0][0] = 0
			case "zero-hull":
				c.Units[0].Base[2] = 0
			case "base-overflow":
				c.Units[0].Base[0] = 65536
			case "cohort-order":
				c.Units[1].Type = 0
			}
			if c.Validate() == nil {
				t.Fatal("invalid fixed input accepted")
			}
		})
	}
}
