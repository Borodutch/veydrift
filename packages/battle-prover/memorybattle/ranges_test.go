package memorybattle

import (
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"testing"
)

type memoryRead struct {
	Root, Index frontend.Variable
	Opening     Opening
}

func (c *memoryRead) Define(api frontend.API) error {
	c.Opening.constrain(api, c.Root, c.Index)
	return nil
}
func TestFullAddressWidth(t *testing.T) {
	m := NewMemory()
	i := uint64(1)<<63 | 17
	m.Write(i, Cell{1, 65535, 23, 45, 67, 89, 60, 40, 1})
	m.Write(17, Cell{1})
	w := memoryRead{Root: m.Root(), Index: i, Opening: m.Open(i)}
	cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &memoryRead{})
	if err != nil {
		t.Fatal(err)
	}
	check := func(w *memoryRead, valid bool) {
		fw, err := frontend.NewWitness(w, ecc.BN254.ScalarField())
		if err != nil {
			t.Fatal(err)
		}
		if err = cc.IsSolved(fw); (err == nil) != valid {
			t.Fatalf("valid=%v err=%v", valid, err)
		}
	}
	check(&w, true)
	w.Index = 17
	check(&w, false)
	w.Index = new(big.Int).Add(num(i), new(big.Int).Lsh(big.NewInt(1), 64))
	check(&w, false)
}

type sampler struct {
	Bits                   [256]frontend.Variable
	Bound, Value, Accepted frontend.Variable
}

func (c *sampler) Define(api frontend.API) error {
	v, ok := uniform(api, c.Bits[:], c.Bound)
	api.AssertIsEqual(v, c.Value)
	api.AssertIsEqual(ok, c.Accepted)
	return nil
}
func TestUniformFullWidthRejection(t *testing.T) {
	cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &sampler{})
	if err != nil {
		t.Fatal(err)
	}
	top := new(big.Int).Lsh(big.NewInt(1), 256)
	for _, bound := range []uint64{1, 3, 1<<40 + 123, ^uint64(0)} {
		for _, word := range []*big.Int{num(0), new(big.Int).Sub(top, big.NewInt(1)), new(big.Int).Sub(top, num(bound))} {
			w := sampler{Bound: bound, Value: new(big.Int).Mod(word, num(bound)), Accepted: 1}
			limit := new(big.Int).Sub(top, new(big.Int).Mod(top, num(bound)))
			if word.Cmp(limit) >= 0 {
				w.Accepted = 0
			}
			for i := range w.Bits {
				w.Bits[i] = word.Bit(i)
			}
			fw, err := frontend.NewWitness(&w, ecc.BN254.ScalarField())
			if err != nil {
				t.Fatal(err)
			}
			if err = cc.IsSolved(fw); err != nil {
				t.Fatalf("bound=%d word=%s err=%v", bound, word, err)
			}
		}
	}
}
func TestCounterCarryAndRefusal(t *testing.T) {
	m, err := New(fixture(2))
	if err != nil {
		t.Fatal(err)
	}
	m.State.V[phase] = DrawTarget
	m.State.V[step] = 100
	m.State.V[count0] = 1
	m.State.V[count1] = 1
	m.State.V[counter0] = ^uint64(0)
	m.State.V[counter1] = 123
	w, err := m.Next()
	if err != nil {
		t.Fatal(err)
	}
	if m.State.V[counter0] != 0 || m.State.V[counter1] != 124 {
		t.Fatal("counter carry lost")
	}
	solve(t, compile(t, DrawTarget), w, true)
	for j := counter0; j <= counter3; j++ {
		m.State.V[j] = ^uint64(0)
	}
	m.State.V[phase] = DrawTarget
	before := m.State
	if _, err = m.Next(); err == nil {
		t.Fatal("counter wrapped")
	}
	if m.State.V != before.V {
		t.Fatal("failed draw changed state")
	}
}
func TestEmptyAndSixRoundTerminal(t *testing.T) {
	cc := compile(t, Ready)
	for _, n := range []int{0, 1, 2} {
		in := fixture(n)
		for i := range in.Units {
			in.Units[i][Attack] = 0
		}
		m, err := New(in)
		if err != nil {
			t.Fatal(err)
		}
		var last *Step
		for i := 0; m.State.V[phase] != Done && i < 1000; i++ {
			last, err = m.Next()
			if err != nil {
				t.Fatal(err)
			}
		}
		if m.State.V[phase] != Done {
			t.Fatal("did not terminate")
		}
		solve(t, cc, last, true)
		if n == 2 && m.State.V[round] != 6 {
			t.Fatal("wrong round limit")
		}
		if _, err = m.Next(); err == nil {
			t.Fatal("allowed post-terminal step")
		}
	}
}
