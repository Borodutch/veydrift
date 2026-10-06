package qualification

import (
	m "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"testing"
)

type linkCircuit struct {
	Q Statement
	P prep.Statement
	B m.Statement
}

func (c *linkCircuit) Define(api frontend.API) error { AssertLinked(api, c.Q, c.P, c.B); return nil }
func TestCompositionLink(t *testing.T) {
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &linkCircuit{})
	if e != nil {
		t.Fatal(e)
	}
	good := linkCircuit{Q: Statement{1, 2, 3, 4, 5, 6, 1}, P: prep.Statement{1, 8, 9, 10}, B: m.Statement{2, 11, 12, 0, 1, 0, 1, 13}}
	check := func(w *linkCircuit, valid bool) {
		v, e := frontend.NewWitness(w, ecc.BN254.ScalarField())
		if e != nil {
			t.Fatal(e)
		}
		e = cc.IsSolved(v)
		if (e == nil) != valid {
			t.Fatalf("valid=%v err=%v", valid, e)
		}
	}
	check(&good, true)
	for _, f := range []func(*linkCircuit){func(w *linkCircuit) { w.P[0] = 99 }, func(w *linkCircuit) { w.B[0] = 99 }, func(w *linkCircuit) { w.Q[VersionField] = 2 }} {
		bad := good
		f(&bad)
		check(&bad, false)
	}
}
func TestPinnedStatsAndHostCanonicality(t *testing.T) {
	b := Bases()
	original := CatalogRoot()
	tree := prep.NewTree(big.NewInt(0))
	for typ, s := range b {
		if typ == 0 {
			s.Attack = p.Const(6)
		}
		v := []frontend.Variable{typ}
		v = append(v, s.Attack[:]...)
		v = append(v, s.Shield[:]...)
		v = append(v, s.Hull[:]...)
		tree.Write(new(big.Int).SetUint64(typ), prep.Hash(prep.CatalogDomain, v...))
	}
	if tree.Root().Cmp(original) == 0 {
		t.Fatal("stat substitution root")
	}
	q := fixture(t)
	bts, e := RecordBytes(q.Preparation, q.Request)
	if e != nil {
		t.Fatal(e)
	}
	if len(bts) != len(RecordDomain)+32+21*32 {
		t.Fatal("serialization length")
	}
	bad := q.Preparation
	bad.Raw = new(big.Int).Lsh(big.NewInt(1), 256)
	if _, e := RecordBytes(bad, q.Request); e == nil {
		t.Fatal("noncanonical field root")
	}
	if e := Crosscheck(p.Uint256{new(big.Int).Lsh(big.NewInt(1), 64), 0, 0, 0}, p.Const(0)); e == nil {
		t.Fatal("noncanonical digest limb")
	}
	if _, ok := Bases()[24]; ok {
		t.Fatal("unlisted type")
	}
}
