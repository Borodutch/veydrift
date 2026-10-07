package battle

import (
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"testing"
)

func TestCommittedPreimageBinding(t *testing.T) {
	c := fixture()
	seed := [32]byte{}
	ss := trace(t, c, seed)
	for _, rng := range []bool{false, true} {
		cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &CommittedStep{Config: c, RNG: rng})
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("committed rng=%v constraints=%d public=%d", rng, cc.GetNbConstraints(), cc.GetNbPublicVariables()-1)
		i := 0
		for IsRandom(c, ss[i]) != rng {
			i++
		}
		original := CommittedAssignment(c, seed, ss[i], ss[i+1], rng)
		check := func(w *CommittedStep, valid bool) {
			full, err := frontend.NewWitness(w, ecc.BN254.ScalarField())
			if err != nil {
				t.Fatal(err)
			}
			err = cc.IsSolved(full)
			if (err == nil) != valid {
				t.Fatalf("valid=%v err=%v", valid, err)
			}
		}
		check(original, true)
		for _, name := range []string{"before-root", "after-root", "context", "private-memory", "private-seed", "step", "terminal", "identity"} {
			t.Run(name, func(t *testing.T) {
				w := *original
				switch name {
				case "before-root":
					w.BeforeRoot = 1
				case "after-root":
					w.AfterRoot = 1
				case "context":
					w.Context = 1
				case "private-memory":
					w.Before[8] = 1
				case "private-seed":
					w.Seed[0] = 1
				case "step":
					w.End = ss[i+1].Step + 1
				case "terminal":
					w.AfterDone = 1
				case "identity":
					other := c
					other.Units[0].Owner[0] = 1
					w.Context = contextCommitment(other, seed)
				}
				check(&w, false)
			})
		}
		// Wrong private preimage plus matching changed root must still fail actual
		// transition execution (not just hash equality).
		bad := ss[i+1]
		bad.Hull[0]++
		w := CommittedAssignment(c, seed, ss[i], bad, rng)
		check(w, false)
	}
	if stateCommitment(State{}).Cmp(new(big.Int)) == 0 {
		t.Fatal("unexpected zero genesis commitment")
	}
}
