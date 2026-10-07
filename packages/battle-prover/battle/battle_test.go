package battle

import (
	"encoding/json"
	"fmt"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"os/exec"
	"testing"
)

func fixture() Config {
	var c Config
	for i := range c.Units {
		c.Units[i] = UnitSpec{Side: uint64(i / 2), Type: uint64(i), Base: [3]uint64{45, 5, 100}}
		c.Units[i].Owner[19] = byte(i + 1)
		c.Units[i].Source[31] = byte(i + 1)
		for j := range c.RF[i] {
			c.RF[i][j] = 1
		}
	}
	c.Units[0].Tech = [3]uint64{1, 2, 3}
	c.RF[0][2] = 2
	c.RF[0][3] = 2
	return c
}
func trace(t *testing.T, c Config, seed [32]byte) []State {
	t.Helper()
	states := []State{{}}
	for len(states) < 2000 {
		s, err := c.Next(seed, states[len(states)-1])
		if err != nil {
			t.Fatal(err)
		}
		states = append(states, s)
		if s.Phase == Done {
			return states
		}
	}
	t.Fatal("host work budget exhausted; no result")
	return nil
}
func TestAllTransitions(t *testing.T) {
	c := fixture()
	seed := [32]byte{}
	ss := trace(t, c, seed)
	for _, rng := range []bool{false, true} {
		cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &Step{Config: c, RNG: rng})
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("rng=%v constraints=%d", rng, cc.GetNbConstraints())
		phases := map[uint64]bool{}
		for i := 0; i < len(ss)-1; i++ {
			if IsRandom(c, ss[i]) != rng {
				continue
			}
			w := Assignment(c, seed, ss[i], ss[i+1], rng)
			full, err := frontend.NewWitness(w, ecc.BN254.ScalarField())
			if err != nil {
				t.Fatal(err)
			}
			if err = cc.IsSolved(full); err != nil {
				t.Fatalf("step %d phase %d: %v", i, ss[i].Phase, err)
			}
			if !phases[ss[i].Phase] {
				phases[ss[i].Phase] = true
				for _, index := range []int{0, 3, 4, 6, 8, 12, 16, 20, 22, 34, 58} {
					bad := *w
					bad.After[index] = ss[i+1].Values()[index] + 1
					full, err = frontend.NewWitness(&bad, ecc.BN254.ScalarField())
					if err != nil {
						t.Fatal(err)
					}
					if cc.IsSolved(full) == nil {
						t.Fatalf("forged field %d phase %d accepted", index, ss[i].Phase)
					}
				}
			}
		}
	}
	t.Logf("terminal steps=%d counter=%d rounds=%d outcome=%d hull=%v shots=%v", len(ss)-1, ss[len(ss)-1].Counter, ss[len(ss)-1].Round, ss[len(ss)-1].Outcome, ss[len(ss)-1].Hull, ss[len(ss)-1].RoundShots)
}
func TestIndependentOracle(t *testing.T) {
	for _, n := range []byte{0, 1, 2, 3, 7, 31, 127, 255} {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			seed := [32]byte{}
			seed[31] = n
			raw, err := exec.Command("bun", "oracle-fixture.ts", fmt.Sprintf("%x", n)).Output()
			if err != nil {
				t.Fatalf("independent oracle: %v", err)
			}
			var expected struct {
				Counter        uint64
				Hull, Shield   [Slots]uint64
				Round          uint64
				Outcome        uint64
				RoundShots     [6][2]uint64
				RoundSurvivors [6][Slots]uint64
			}
			if err = json.Unmarshal(raw, &expected); err != nil {
				t.Fatal(err)
			}
			ss := trace(t, fixture(), seed)
			s := ss[len(ss)-1]
			if s.Counter != expected.Counter || s.Hull != expected.Hull || s.Shield != expected.Shield || s.Round != expected.Round || s.Outcome != expected.Outcome || s.RoundShots != expected.RoundShots || s.RoundSurvivors != expected.RoundSurvivors {
				t.Fatalf("oracle mismatch: got %+v expected %+v", s, expected)
			}
		})
	}
}
