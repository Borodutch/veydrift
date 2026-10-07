package battle

import (
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"testing"
)

type drawCircuit struct {
	Bits                       [256]frontend.Variable
	Bound, Remainder, Accepted frontend.Variable
}

func (c *drawCircuit) Define(api frontend.API) error {
	r, a := uniformWord(api, c.Bits[:], c.Bound)
	api.AssertIsEqual(c.Remainder, r)
	api.AssertIsEqual(c.Accepted, a)
	return nil
}
func TestRejectionBoundaries(t *testing.T) {
	cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &drawCircuit{})
	if err != nil {
		t.Fatal(err)
	}
	top := new(big.Int).Lsh(big.NewInt(1), 256)
	for _, bound := range []int64{1, 2, 3, 100, 65535, 4294967295} {
		n := big.NewInt(bound)
		limit := new(big.Int).Sub(top, new(big.Int).Mod(new(big.Int).Set(top), n))
		words := []*big.Int{big.NewInt(0), new(big.Int).Sub(limit, big.NewInt(1)), new(big.Int).Sub(top, big.NewInt(1))}
		if limit.Cmp(top) < 0 {
			words = append(words, new(big.Int).Set(limit))
		}
		for _, word := range words {
			w := &drawCircuit{Bound: bound, Remainder: new(big.Int).Mod(word, n), Accepted: 0}
			if word.Cmp(limit) < 0 {
				w.Accepted = 1
			}
			for i := range w.Bits {
				w.Bits[i] = word.Bit(i)
			}
			full, err := frontend.NewWitness(w, ecc.BN254.ScalarField())
			if err != nil {
				t.Fatal(err)
			}
			if err = cc.IsSolved(full); err != nil {
				t.Fatalf("bound=%d word=%x: %v", bound, word, err)
			}
			w.Accepted = 1 - w.Accepted.(int)
			full, err = frontend.NewWitness(w, ecc.BN254.ScalarField())
			if err != nil {
				t.Fatal(err)
			}
			if cc.IsSolved(full) == nil {
				t.Fatal("flipped rejection accepted")
			}
		}
	}
}
