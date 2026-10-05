package protocol

import (
	"github.com/consensys/gnark/frontend"
	"math/big"
	"testing"
)

func group() Group {
	return Group{Owner: MustValue(sub(pow(160), big.NewInt(1))), Source: MustValue(max256()), Count: uint64(0xffffffff), Key: Key{Side: 0, Type: 65535, Stats: Stats{MustValue(pow(128)), MustValue(pow(64)), Const(100)}}, Tech: Technology{0, 0, 0}}
}
func TestPreparationRangesAndForgery(t *testing.T) {
	cc := compile(t, &PrepareCircuit{})
	g := group()
	w := PrepareCircuit{Group: g, Base: g.Key.Stats, Remainders: [3]frontend.Variable{0, 0, 0}}
	solve(t, cc, &w, true)
	mutations := []func(*PrepareCircuit){func(w *PrepareCircuit) { w.Group.Owner[2] = pow(32) }, func(w *PrepareCircuit) { w.Group.Owner[3] = 1 }, func(w *PrepareCircuit) { w.Group.Source[0] = pow(64) }, func(w *PrepareCircuit) { w.Group.Count = pow(32) }, func(w *PrepareCircuit) { w.Group.Tech.Armor = 65536 }, func(w *PrepareCircuit) { w.Group.Key.Type = 65536 }, func(w *PrepareCircuit) { w.Group.Key.Side = 2 }, func(w *PrepareCircuit) { w.Group.Key.Stats.Attack[2] = 0 }, func(w *PrepareCircuit) { w.Remainders[1] = 1 }, func(w *PrepareCircuit) { w.Base.Hull = Const(0) }, func(w *PrepareCircuit) {
		w.Base.Attack = MustValue(max256())
		w.Group.Key.Stats.Attack = MustValue(max256())
	}}
	for i, f := range mutations {
		t.Run(big.NewInt(int64(i)).String(), func(t *testing.T) { bad := w; f(&bad); solve(t, cc, &bad, false) })
	}
}
func TestCanonicalAppendCounts(t *testing.T) {
	cc := compile(t, &AppendCircuit{})
	prev, cur := group(), group()
	prev.Source = MustValue(sub(max256(), big.NewInt(1)))
	for _, n := range []*big.Int{sub(pow(64), big.NewInt(1)), sub(pow(128), big.NewInt(1)), sub(max256(), big.NewInt(0xffffffff))} {
		w := AppendCircuit{First: 0, Previous: prev, Current: cur, BeforeCount: MustValue(n), AfterCount: MustValue(add(n, big.NewInt(0xffffffff))), BeforeCohort: MustValue(pow(128)), AfterCohort: MustValue(pow(128)), NewCohort: 0}
		solve(t, cc, &w, true)
		bad := w
		bad.AfterCount[3] = 17
		solve(t, cc, &bad, false)
		bad = w
		bad.Current.Source = prev.Source
		solve(t, cc, &bad, false)
		bad = w
		bad.Current.Key.Stats.Attack = Const(1)
		solve(t, cc, &bad, false)
		bad = w
		bad.BeforeCount = MustValue(max256())
		bad.AfterCount = Const(0xfffffffe)
		solve(t, cc, &bad, false)
	}
	w := AppendCircuit{First: 1, Previous: prev, Current: cur, BeforeCount: Const(0), AfterCount: Const(0xffffffff), BeforeCohort: Const(0), AfterCohort: Const(0), NewCohort: 1}
	solve(t, cc, &w, true)
	bad := w
	bad.BeforeCohort = Const(1)
	solve(t, cc, &bad, false)
	bad = w
	bad.Current.Count = 0
	bad.AfterCount = Const(0)
	solve(t, cc, &bad, false)
	w.First = 0
	w.Current.Key.Side = 1
	w.BeforeCount = MustValue(max256())
	w.BeforeCohort = MustValue(sub(max256(), big.NewInt(1)))
	w.AfterCohort = MustValue(max256())
	solve(t, cc, &w, true)
	w.BeforeCohort = MustValue(max256())
	w.AfterCohort = Const(0)
	solve(t, cc, &w, false)
}
func TestSourceOwnerConsistency(t *testing.T) {
	cc := compile(t, &ConsistencyCircuit{})
	w := ConsistencyCircuit{A: group(), B: group(), SameSource: 1, SameOwner: 1}
	solve(t, cc, &w, true)
	bad := w
	bad.B.Owner = Const(7)
	bad.SameOwner = 0
	solve(t, cc, &bad, false)
	bad = w
	bad.B.Key.Side = 1
	solve(t, cc, &bad, false)
	bad = w
	bad.B.Tech.Weapons = 1
	solve(t, cc, &bad, false)
	bad = w
	bad.B.Source = Const(1)
	bad.SameSource = 0
	solve(t, cc, &bad, true)
	bad.B.Tech.Armor = 1
	solve(t, cc, &bad, false)
}
