package protocol

import (
	"github.com/consensys/gnark/frontend"
	"math/big"
	"testing"
)

func TestRosterExpansionFullWidth(t *testing.T) {
	cc := compile(t, &ExpandCircuit{})
	k := group().Key
	for _, offset := range []*big.Int{pow(64), pow(128), sub(max256(), big.NewInt(1))} {
		last := offset.Cmp(sub(max256(), big.NewInt(1))) == 0
		next := add(offset, big.NewInt(1))
		if last {
			next = big.NewInt(0)
		}
		w := ExpandCircuit{Key: k, Cohort: MustValue(max256()), Count: MustValue(max256()), Offset: MustValue(offset), Index: MustValue(pow(128)), UnitKey: k, UnitCohort: MustValue(max256()), Hull: k.Stats.Hull, Shield: k.Stats.Shield, NextOffset: MustValue(next), NextIndex: MustValue(add(pow(128), big.NewInt(1))), Last: flag(last)}
		solve(t, cc, &w, true)
		bad := w
		bad.Offset = w.Count
		solve(t, cc, &bad, false)
		bad = w
		bad.Last = 1 - flag(last)
		solve(t, cc, &bad, false)
		bad = w
		bad.UnitKey.Stats.Attack = Const(1)
		solve(t, cc, &bad, false)
		bad = w
		bad.UnitCohort = Const(1)
		solve(t, cc, &bad, false)
		bad = w
		bad.Hull = Const(1)
		solve(t, cc, &bad, false)
		bad = w
		bad.Index = MustValue(max256())
		bad.NextIndex = Const(0)
		solve(t, cc, &bad, false)
	}
}

type comparisonCircuit struct {
	X, Y        Uint256
	Less, Equal frontend.Variable
}

func (c *comparisonCircuit) Define(api frontend.API) error {
	a := New(api)
	api.AssertIsEqual(c.Less, a.Less(c.X, c.Y))
	api.AssertIsEqual(c.Equal, a.Equal(c.X, c.Y))
	return nil
}
func TestComparisonsAllBits(t *testing.T) {
	cc := compile(t, &comparisonCircuit{})
	for _, n := range []uint{0, 63, 64, 127, 128, 159, 160, 191, 192, 253, 254, 255} {
		x := pow(n)
		y := sub(x, big.NewInt(1))
		w := comparisonCircuit{MustValue(x), MustValue(y), 0, 0}
		solve(t, cc, &w, true)
		w.Less = 1
		solve(t, cc, &w, false)
		w = comparisonCircuit{MustValue(x), MustValue(x), 0, 1}
		solve(t, cc, &w, true)
	}
}
func TestDivisionRejectsNoncanonicalAdvice(t *testing.T) {
	cc := compile(t, &mulDivCircuit{})
	w := mulDivCircuit{MustValue(max256()), Const(0xffffffff), MustValue(max256()), Const(0xffffffff), Const(0)}
	solve(t, cc, &w, true)
	w.Q = Const(0xfffffffe)
	w.R = w.D
	solve(t, cc, &w, false)
	w = mulDivCircuit{Const(0), Const(0), MustValue(max256()), MustValue(max256()), MustValue(max256())}
	solve(t, cc, &w, false)
}
func TestSamplerHighWordBitsMatter(t *testing.T) {
	cc := compile(t, &SampleCircuit{})
	bound := add(pow(255), big.NewInt(1))
	w := sampleWitness(big.NewInt(3), bound)
	solve(t, cc, w, true)
	for _, n := range []uint{64, 128, 192, 254, 255} {
		bad := *w
		bad.Word = MustValue(add(pow(n), big.NewInt(3)))
		solve(t, cc, &bad, false)
	}
}
