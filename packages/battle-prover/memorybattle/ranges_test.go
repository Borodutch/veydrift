package memorybattle

import (
	"github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"testing"
)

type memoryRead struct {
	Root    frontend.Variable
	Index   U
	Opening Opening
	Domain  uint64 `gnark:"-"`
}

func (c *memoryRead) Define(api frontend.API) error {
	c.Opening.Verify(api, c.Root, c.Domain, c.Index)
	return nil
}
func TestFullAddressWidth(t *testing.T) {
	m := NewMemory()
	i := Big(new(big.Int).Add(new(big.Int).Lsh(big.NewInt(1), 255), num(17)))
	k := key(UnitDomain, i)
	m.Write(k, Cell{W(1), W(65535), i, W(45), W(67), i, W(60), W(40), W(1)})
	m.Write(key(UnitDomain, W(17)), Cell{W(1)})
	m.Write(key(RosterDomain, i), Cell{W(2)})
	w := memoryRead{Root: m.Root(), Index: i.Circuit(), Opening: m.Open(k)}
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &memoryRead{})
	if e != nil {
		t.Fatal(e)
	}
	check := func(valid bool) {
		fw, e := frontend.NewWitness(&w, ecc.BN254.ScalarField())
		if e != nil {
			t.Fatal(e)
		}
		if e = cc.IsSolved(fw); (e == nil) != valid {
			t.Fatalf("valid=%v err=%v", valid, e)
		}
	}
	check(true)
	w.Index = W(17).Circuit()
	check(false)
	w.Index = i.Circuit()
	w.Opening = m.Open(key(RosterDomain, i))
	check(false)
	w.Opening = m.Open(k)
	w.Opening.Cell[Attack][3] = 0
	check(false)
}
func TestCounterCarryAndRefusal(t *testing.T) {
	m, e := New(fixture(2))
	if e != nil {
		t.Fatal(e)
	}
	m.State.V[phase] = W(DrawTarget)
	m.State.V[step] = W(100)
	m.State.V[count0] = W(1)
	m.State.V[count1] = W(1)
	m.State.V[counter] = Word{^uint64(0), 123}
	w, e := m.Next()
	if e != nil {
		t.Fatal(e)
	}
	if m.State.V[counter] != (Word{0, 124}) {
		t.Fatal("carry lost")
	}
	cc := compile(t, DrawTarget)
	solve(t, cc, w, true)
	for _, field := range []int{counter, step} {
		m.State.V[phase] = W(DrawTarget)
		m.State.V[field] = Word{^uint64(0), ^uint64(0), ^uint64(0), ^uint64(0)}
		before := m.State
		if _, e = m.Next(); e == nil {
			t.Fatal("wrapped")
		}
		if m.State.V != before.V {
			t.Fatal("failure changed state")
		}
		bad := clone(w)
		bad.Before[field] = m.State.V[field].Circuit()
		bad.After[field] = protocol.Const(0)
		recommit(bad)
		solve(t, cc, bad, false)
		m.State.V[field] = W(100)
	}
}
func TestEmptyAndSixRoundTerminal(t *testing.T) {
	cc := compile(t, Ready)
	for _, n := range []int{0, 1, 2} {
		in := fixture(n)
		for i := range in.Units {
			in.Units[i][Attack] = W(0)
		}
		m, e := New(in)
		if e != nil {
			t.Fatal(e)
		}
		var last *Step
		for i := 0; m.State.V[phase] != W(Done) && i < 1000; i++ {
			last, e = m.Next()
			if e != nil {
				t.Fatal(e)
			}
		}
		if m.State.V[phase] != W(Done) {
			t.Fatal("not terminal")
		}
		solve(t, cc, last, true)
		if n == 2 && m.State.V[round] != W(6) {
			t.Fatal("wrong round")
		}
		if _, e = m.Next(); e == nil {
			t.Fatal("postterminal")
		}
	}
}
