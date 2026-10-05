//go:build !plonk_experiment

package aggregation

import (
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	recursive "github.com/consensys/gnark/std/recursion/groth16"
	"math/big"
	"testing"
)

// This leaf tests adapter semantics, not combat. In particular full-width
// commitment equality must not be accidentally truncated to one 64-bit limb.
type rangeFixture struct{ Range }

func (c *rangeFixture) Define(api frontend.API) error {
	c.bound(api)
	api.AssertIsEqual(c.BeforeDone, 0)
	api.AssertIsEqual(c.Context, new(big.Int).Lsh(big.NewInt(1), 200))
	api.AssertIsEqual(c.Before, api.Add(new(big.Int).Lsh(big.NewInt(1), 180), c.Start))
	api.AssertIsEqual(c.After, api.Add(new(big.Int).Lsh(big.NewInt(1), 180), c.End))
	api.AssertIsEqual(c.End, api.Add(c.Start, 1))
	api.AssertIsEqual(c.AfterDone, api.IsZero(api.Sub(c.End, 2)))
	return nil
}
func TestCommittedRangeComposition(t *testing.T) {
	if testing.Short() {
		t.Skip("large recursive verifier compilation")
	}
	leaf, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &rangeFixture{})
	check(t, e)
	l := setup(t, leaf)
	base := new(big.Int).Lsh(big.NewInt(1), 180)
	makeReceipt := func(start int) (Range, Proof, Witness) {
		terminal := 0
		if start == 1 {
			terminal = 1
		}
		r := Range{new(big.Int).Lsh(big.NewInt(1), 200), new(big.Int).Add(base, big.NewInt(int64(start))), new(big.Int).Add(base, big.NewInt(int64(start+1))), start, start + 1, 0, terminal}
		x := prove(t, l, &rangeFixture{r}, Statement{Start: start, End: start + 1, Count: 1})
		return r, x.p, x.w
	}
	a, ap, aw := makeReceipt(0)
	b, bp, bw := makeReceipt(1)
	template := &RangePair{Keys: [2]VerifyingKey{key(t, l), key(t, l)}}
	for i := range template.Proofs {
		template.Proofs[i] = recursive.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](leaf)
		template.Witnesses[i] = recursive.PlaceholderWitness[sw_bn254.ScalarField](leaf)
	}
	cc := compiled(t, template)
	r := a
	r.After = b.After
	r.End = b.End
	r.AfterDone = 1
	assignment := &RangePair{Range: r, Proofs: [2]Proof{ap, bp}, Witnesses: [2]Witness{aw, bw}}
	check(t, cc.IsSolved(wit(t, assignment)))
	bad := *assignment
	bad.Context = new(big.Int).Add(a.Context.(*big.Int), big.NewInt(1))
	if cc.IsSolved(wit(t, &bad)) == nil {
		t.Fatal("wrong full-width context accepted")
	}
	bad = *assignment
	bad.Proofs[1] = ap
	bad.Witnesses[1] = aw
	if cc.IsSolved(wit(t, &bad)) == nil {
		t.Fatal("replayed committed range accepted")
	}
	bad = *assignment
	bad.AfterDone = 0
	if cc.IsSolved(wit(t, &bad)) == nil {
		t.Fatal("altered terminal flag accepted")
	}
}
