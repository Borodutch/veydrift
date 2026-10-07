package battle

import (
	"encoding/json"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"testing"
)

func TestResumeEveryElementaryBoundary(t *testing.T) {
	c := fixture()
	ss := trace(t, c, [32]byte{})
	for i := 0; i < len(ss)-1; i++ {
		encoded, err := json.Marshal(ss[i])
		if err != nil {
			t.Fatal(err)
		}
		var restored State
		if err = json.Unmarshal(encoded, &restored); err != nil {
			t.Fatal(err)
		}
		next, err := c.Next([32]byte{}, restored)
		if err != nil {
			t.Fatal(err)
		}
		if next != ss[i+1] {
			t.Fatalf("resume differs at %d", i)
		}
	}
}
func TestCounterAndWorkCannotWrap(t *testing.T) {
	c := fixture()
	ss := trace(t, c, [32]byte{})
	for _, rng := range []bool{false, true} {
		cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &Step{Config: c, RNG: rng})
		if err != nil {
			t.Fatal(err)
		}
		i := 0
		for IsRandom(c, ss[i]) != rng {
			i++
		}
		before, after := ss[i], ss[i+1]
		if rng {
			before.Counter = ^uint64(0)
			after.Counter = 0
		} else {
			before.Step = ^uint64(0)
			after.Step = 0
		}
		w, err := frontend.NewWitness(Assignment(c, [32]byte{}, before, after, rng), ecc.BN254.ScalarField())
		if err != nil {
			t.Fatal(err)
		}
		if cc.IsSolved(w) == nil {
			t.Fatal("counter wrapped")
		}
		if _, err = c.Next([32]byte{}, before); err == nil {
			t.Fatal("host accepted overflow")
		}
	}
}
