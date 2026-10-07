package preparation

import (
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"math/big"
	"testing"
)

func TestUint256ExpansionAndOverflow(t *testing.T) {
	c := compile(t, Expand)
	for _, bit := range []uint{64, 128, 255} {
		m, _ := New(identity(), []Row{row(1, 1, 2)}, base())
		ws, _ := m.Chunk(3)
		_ = ws
		b := m.State
		b.Unit = p.MustValue(new(big.Int).Lsh(big.NewInt(1), bit))
		b.Total = add(b.Unit, 2)
		b.Step = b.Unit
		b.Cohort = b.Unit
		m.State = b
		w, _ := m.Next()
		solve(t, c, w, true)
		bad := *w
		bad.After.Unit = p.Const(1)
		bad.AfterHash = bad.After.Commitment()
		solve(t, c, &bad, false)
	}
	m, _ := New(identity(), []Row{row(1, 1, 1)}, base())
	m.Chunk(3)
	b := m.State
	max := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
	b.Unit = p.MustValue(max)
	w := blank(Expand)
	w.C = m.C
	w.Before = b
	w.After = b
	w.After.Step = add(b.Step, 1)
	w.After.Unit = p.Const(0)
	w.After.Offset = p.Const(0)
	w.After.Phase = Finish
	w.UnitPath = m.Units.Open(max)
	m.Units.Write(max, b.Key, b.Cohort)
	w.After.UnitRoot = m.Units.Root()
	w.ContextHash = m.C.Commitment()
	w.BeforeHash = b.Commitment()
	w.AfterHash = w.After.Commitment()
	w.Result = 0
	solve(t, c, w, false)
}
func TestCoverageAndZeroRows(t *testing.T) {
	m, _ := New(identity(), []Row{row(1, 1, 0), row(2, 2, 1)}, base())
	ws, _ := m.Chunk(100)
	var member, finish *Step
	for _, w := range ws {
		if w.Kind == Member {
			member = w
		}
		if w.Kind == Finish {
			finish = w
		}
	}
	c := compile(t, Member)
	bad := *member
	bad.Paths = append([]Path{}, member.Paths...)
	bad.Paths[1] = m.Visited.Open(integer(member.Index))
	bad.Before.Visited = m.Visited.Root()
	bad.BeforeHash = bad.Before.Commitment()
	solve(t, c, &bad, false)
	c = compile(t, Finish)
	for _, mutate := range []func(*Step){func(x *Step) { x.Before.Processed = p.Const(1) }, func(x *Step) { x.Before.Unit = p.Const(0) }, func(x *Step) { x.After.Cohorts = 0 }, func(x *Step) { x.After.Members = 0 }} {
		bad = *finish
		mutate(&bad)
		bad.BeforeHash = bad.Before.Commitment()
		bad.AfterHash = bad.After.Commitment()
		bad.Result = ResultHash(bad.ContextHash, bad.After)
		solve(t, c, &bad, false)
	}
}
func TestAuthenticatedSourceOwnerConflicts(t *testing.T) {
	c := compile(t, Pair)
	for _, other := range []Row{row(2, 1, 1), func() Row { r := row(1, 1, 1); r.Side = 1; r.Type = 1; return r }()} {
		bases := base()
		bases[1] = bases[0]
		m, e := New(identity(), []Row{row(1, 1, 1), other}, bases)
		if e != nil {
			t.Fatal(e)
		}
		m.Next()
		m.Next()
		w, _ := m.Next()
		solve(t, c, w, false)
	}
}
