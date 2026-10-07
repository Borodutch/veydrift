package battle

import (
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"testing"
)

func TestHitBoundaries(t *testing.T) {
	// One compiled catalog covers bounce/full-shield equality, shield-only
	// explosion, zero-power, dead-target and strict thirty percent boundaries.
	c := fixture()
	c.Units[0].Base = [3]uint64{1, 100, 100}
	c.Units[0].Tech = [3]uint64{}
	c.Units[1].Base = [3]uint64{0, 101, 100}
	c.Units[2].Base = [3]uint64{30, 100, 100}
	c.Units[3].Base = [3]uint64{31, 100, 100}
	cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &Step{Config: c})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name                                                           string
		shooter, target, hull, shield, wantHull, wantShield, wantPhase uint64
	}{
		{"full-shield-bounce", 0, 1, 60, 1, 60, 1, Rapidfire},
		{"exact-one-percent-not-bounce", 0, 0, 60, 1, 60, 0, Explosion},
		{"shield-only-explosion", 0, 0, 60, 100, 60, 99, Explosion},
		{"zero-power-no-explosion", 1, 0, 60, 0, 60, 0, Rapidfire},
		{"dead-target", 3, 0, 0, 10, 0, 10, Rapidfire},
		{"exact-thirty-percent", 2, 0, 100, 0, 70, 0, Rapidfire},
		{"over-thirty-percent", 3, 0, 100, 0, 69, 0, Explosion},
		{"saturating-destruction", 3, 0, 20, 0, 0, 0, Rapidfire},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := State{Phase: Damage, Round: 1, Step: 20, Shooter: tc.shooter, Target: tc.target}
			s.Hull[tc.target] = tc.hull
			s.Shield[tc.target] = tc.shield
			n, err := c.Next([32]byte{}, s)
			if err != nil {
				t.Fatal(err)
			}
			if n.Hull[tc.target] != tc.wantHull || n.Shield[tc.target] != tc.wantShield || n.Phase != tc.wantPhase {
				t.Fatalf("wrong hit %+v", n)
			}
			w := Assignment(c, [32]byte{}, s, n, false)
			full, err := frontend.NewWitness(w, ecc.BN254.ScalarField())
			if err != nil {
				t.Fatal(err)
			}
			if err = cc.IsSolved(full); err != nil {
				t.Fatal(err)
			}
			bad := *w
			bad.After[0] = Damage
			full, err = frontend.NewWitness(&bad, ecc.BN254.ScalarField())
			if err != nil {
				t.Fatal(err)
			}
			if cc.IsSolved(full) == nil {
				t.Fatal("phase forgery accepted")
			}
		})
	}
}
func TestSixRoundDraw(t *testing.T) {
	c := fixture()
	for i := range c.Units {
		c.Units[i].Base[0] = 0
		for j := range c.RF[i] {
			c.RF[i][j] = 1
		}
	}
	ss := trace(t, c, [32]byte{})
	s := ss[len(ss)-1]
	if s.Round != 6 || s.Outcome != 0 || s.Counter != 24 {
		t.Fatalf("wrong six-round result %+v", s)
	}
	for _, rng := range []bool{false, true} {
		cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &Step{Config: c, RNG: rng})
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < len(ss)-1; i++ {
			if IsRandom(c, ss[i]) != rng {
				continue
			}
			w, err := frontend.NewWitness(Assignment(c, [32]byte{}, ss[i], ss[i+1], rng), ecc.BN254.ScalarField())
			if err != nil {
				t.Fatal(err)
			}
			if err = cc.IsSolved(w); err != nil {
				t.Fatalf("step %d: %v", i, err)
			}
		}
	}
}
