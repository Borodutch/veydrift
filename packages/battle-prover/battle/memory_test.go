package battle

import (
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	native "github.com/consensys/gnark-crypto/ecc/bn254/fr/mimc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"testing"
)

func rawHash(values ...*big.Int) *big.Int {
	h := native.NewFieldHasher()
	for _, v := range values {
		var e fr.Element
		e.SetBigInt(v)
		h.WriteElement(e)
	}
	sum := h.SumElement()
	return sum.BigInt(new(big.Int))
}
func merkleRootPath(units [][3]uint64, index int) (*big.Int, []frontend.Variable) {
	nodes := make([]*big.Int, len(units))
	for i, u := range units {
		data := hashNative(440203, []uint64{uint64(i), u[0], u[1], u[2]})
		nodes[i] = rawHash(data)
	}
	path := []frontend.Variable{}
	for len(nodes) > 1 {
		path = append(path, nodes[index^1])
		next := make([]*big.Int, len(nodes)/2)
		for i := range next {
			next[i] = rawHash(nodes[2*i], nodes[2*i+1])
		}
		index /= 2
		nodes = next
	}
	return nodes[0], path
}

type memoryPair struct{ First, Second MemoryUpdate }

func (c *memoryPair) Define(api frontend.API) error {
	if err := c.First.Constrain(api); err != nil {
		return err
	}
	if err := c.Second.Constrain(api); err != nil {
		return err
	}
	api.AssertIsEqual(c.First.AfterRoot, c.Second.BeforeRoot)
	return nil
}
func TestMemoryLatestWrite(t *testing.T) {
	units := [][3]uint64{{0, 100, 5}, {1, 100, 5}, {2, 100, 5}, {3, 100, 5}}
	oldRoot, path := merkleRootPath(units, 2)
	units[2][1] = 60
	newRoot, _ := merkleRootPath(units, 2)
	first := MemoryUpdate{BeforeRoot: oldRoot, AfterRoot: newRoot, Index: 2, Old: [3]frontend.Variable{2, 100, 5}, New: [3]frontend.Variable{2, 60, 5}, Siblings: path}
	root2, path2 := merkleRootPath(units, 2)
	units[2][1] = 20
	root3, _ := merkleRootPath(units, 2)
	second := MemoryUpdate{BeforeRoot: root2, AfterRoot: root3, Index: 2, Old: [3]frontend.Variable{2, 60, 5}, New: [3]frontend.Variable{2, 20, 5}, Siblings: path2}
	cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &memoryPair{First: MemoryUpdate{Siblings: make([]frontend.Variable, 2)}, Second: MemoryUpdate{Siblings: make([]frontend.Variable, 2)}})
	if err != nil {
		t.Fatal(err)
	}
	check := func(w *memoryPair, valid bool) {
		full, err := frontend.NewWitness(w, ecc.BN254.ScalarField())
		if err != nil {
			t.Fatal(err)
		}
		err = cc.IsSolved(full)
		if (err == nil) != valid {
			t.Fatalf("valid=%v err=%v", valid, err)
		}
	}
	original := memoryPair{first, second}
	check(&original, true)
	for _, name := range []string{"stale-read", "stale-root", "wrong-index", "wrong-sibling", "unrelated-write"} {
		t.Run(name, func(t *testing.T) {
			w := original
			w.Second.Siblings = append([]frontend.Variable(nil), w.Second.Siblings...)
			switch name {
			case "stale-read":
				w.Second.Old[1] = 100
			case "stale-root":
				w.Second.BeforeRoot = oldRoot
			case "wrong-index":
				w.Second.Index = 1
			case "wrong-sibling":
				w.Second.Siblings[0] = 1
			case "unrelated-write":
				w.Second.New[0] = 3
			}
			check(&w, false)
		})
	}
	t.Logf("two authenticated updates constraints=%d", cc.GetNbConstraints())
}
