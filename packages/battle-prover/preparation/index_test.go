package preparation

import (
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"testing"
)

type openingCircuit struct {
	Root  frontend.Variable
	Index p.Uint256
	Leaf  frontend.Variable
	Path  Path
}

func (c *openingCircuit) Define(api frontend.API) error {
	c.Path.Verify(api, c.Root, c.Index, c.Leaf)
	return nil
}
func TestRawIndexNoFieldAlias(t *testing.T) {
	c, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &openingCircuit{})
	if e != nil {
		t.Fatal(e)
	}
	tree := NewTree(big.NewInt(0))
	i := new(big.Int).Add(new(big.Int).Lsh(big.NewInt(1), 255), big.NewInt(7))
	tree.Write(i, big.NewInt(123))
	w := openingCircuit{tree.Root(), p.MustValue(i), 123, tree.Open(i)}
	v, e := frontend.NewWitness(&w, ecc.BN254.ScalarField())
	if e != nil {
		t.Fatal(e)
	}
	if e = c.IsSolved(v); e != nil {
		t.Fatal(e)
	}
	w.Index = p.Const(7)
	v, _ = frontend.NewWitness(&w, ecc.BN254.ScalarField())
	if c.IsSolved(v) == nil {
		t.Fatal("high-bit index alias")
	}
}
