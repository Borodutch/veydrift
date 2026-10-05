package preparation

import (
	"fmt"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/frontend"
)

type Step struct {
	ContextHash, BeforeHash, AfterHash, Result frontend.Variable `gnark:",public"`
	C                                          Context
	Before, After                              State
	Row, Other                                 Row
	Index                                      p.Uint256
	Effective                                  p.Stats
	Base                                       p.Stats
	Remainders                                 [3]frontend.Variable
	Paths                                      []Path
	UnitPath                                   UnitPath
	Kind                                       int `gnark:"-"`
}

func Shape(kind int) *Step {
	counts := []int{0, 2, 4, 0, 0}
	if kind < Boot || kind > Finish {
		panic("kind")
	}
	return &Step{Kind: kind, Paths: make([]Path, counts[kind])}
}
func (c *Step) Define(api frontend.API) error {
	if c.Kind < Boot || c.Kind > Finish || len(c.Paths) != len(Shape(c.Kind).Paths) {
		return fmt.Errorf("shape")
	}
	a := p.New(api)
	b := c.Before
	out := b
	api.AssertIsBoolean(c.C.Identity.TargetIsMoon)
	for _, v := range append(c.C.Identity.values(), c.C.Rows[:]...) {
		api.ToBinary(v, 64)
	}
	for _, s := range []State{b, c.After} {
		for _, u := range []p.Uint256{s.Step, s.I, s.J, s.Processed, s.Total, s.Unit, s.Cohort, s.Offset, s.Count} {
			check(api, u)
		}
		s.Previous.validate(api)
		for _, v := range KeyValues(s.Key) {
			api.ToBinary(v, 64)
		}
	}
	api.AssertIsEqual(c.ContextHash, hash(api, ContextDomain, c.C.values()...))
	api.AssertIsEqual(c.BeforeHash, hash(api, StateDomain, b.values()...))
	api.AssertIsEqual(c.AfterHash, hash(api, StateDomain, c.After.values()...))
	api.AssertIsEqual(b.Phase, c.Kind)
	out.Step = a.AddChecked(b.Step, p.Const(1))
	if c.Kind != Finish {
		api.AssertIsEqual(c.Result, 0)
	}
	switch c.Kind {
	case Boot:
		z := Initial()
		for i, v := range z.values() {
			api.AssertIsEqual(b.values()[i], v)
		}
		out.Phase = api.Select(a.Equal(c.C.Rows, p.Const(0)), Finish, Pair)
	case Pair:
		api.AssertIsEqual(a.Less(b.I, c.C.Rows), 1)
		api.AssertIsEqual(a.Less(b.J, c.C.Rows), 1)
		c.Row.validate(api)
		c.Other.validate(api)
		c.Paths[0].Verify(api, c.C.Raw, b.I, hash(api, RawDomain, c.Row.Values()...))
		c.Paths[1].Verify(api, c.C.Raw, b.J, hash(api, RawDomain, c.Other.Values()...))
		sameS := a.Equal(c.Row.Source, c.Other.Source)
		sameO := a.Equal(c.Row.Owner, c.Other.Owner)
		sameT := api.IsZero(api.Sub(c.Row.Type, c.Other.Type))
		different := api.Sub(1, a.Equal(b.I, b.J))
		api.AssertIsEqual(api.Mul(different, sameS, sameT), 0)
		api.AssertIsEqual(api.Mul(sameS, api.Sub(1, sameO)), 0)
		api.AssertIsEqual(api.Mul(sameS, api.Sub(c.Row.Side, c.Other.Side)), 0)
		for _, v := range [][2]frontend.Variable{{c.Row.Tech.Weapons, c.Other.Tech.Weapons}, {c.Row.Tech.Shielding, c.Other.Tech.Shielding}, {c.Row.Tech.Armor, c.Other.Tech.Armor}} {
			api.AssertIsEqual(api.Mul(sameO, api.Sub(v[0], v[1])), 0)
		}
		nj := a.AddChecked(b.J, p.Const(1))
		endJ := a.Equal(nj, c.C.Rows)
		ni := a.AddChecked(b.I, p.Uint256{endJ, 0, 0, 0})
		end := api.And(endJ, a.Equal(ni, c.C.Rows))
		out.J = a.Select(endJ, p.Const(0), nj)
		out.I = a.Select(end, p.Const(0), ni)
		out.Phase = api.Select(end, Member, Pair)
	case Member:
		api.AssertIsEqual(a.Less(b.Processed, c.C.Rows), 1)
		api.AssertIsEqual(a.Less(c.Index, c.C.Rows), 1)
		c.Row.validate(api)
		c.Paths[0].Verify(api, c.C.Raw, c.Index, hash(api, RawDomain, c.Row.Values()...))
		c.Paths[1].Verify(api, b.Visited, c.Index, 0)
		c.Paths[1].Verify(api, c.After.Visited, c.Index, 1)
		out.Visited = c.After.Visited
		cv := append([]frontend.Variable{c.Row.Type}, fields(c.Base.Attack, c.Base.Shield, c.Base.Hull)...)
		c.Paths[2].Verify(api, c.C.Catalog, p.Uint256{c.Row.Type, 0, 0, 0}, hash(api, CatalogDomain, cv...))
		tv := append(fields(c.Row.Owner), c.Row.Tech.Weapons, c.Row.Tech.Shielding, c.Row.Tech.Armor)
		c.Paths[3].Verify(api, c.C.Tech, c.Row.Owner, hash(api, TechDomain, tv...))
		api.AssertIsEqual(a.Equal(c.Base.Hull, p.Const(0)), 0)
		a.Effective(c.Base.Attack, c.Row.Tech.Weapons, c.Effective.Attack, c.Remainders[0])
		a.Effective(c.Base.Shield, c.Row.Tech.Shielding, c.Effective.Shield, c.Remainders[1])
		a.Effective(c.Base.Hull, c.Row.Tech.Armor, c.Effective.Hull, c.Remainders[2])
		k := rowKey(c.Row, c.Effective)
		a.CheckKey(k)
		first := a.Equal(b.Processed, p.Const(0))
		zero := a.Equal(c.Row.Count, p.Const(0))
		prevZero := a.Equal(b.Previous.Count, p.Const(0))
		kl, ke := a.Lex(keyTuple(b.Key), keyTuple(k))
		ml, _ := a.Lex([]p.Uint256{b.Previous.Owner, b.Previous.Source}, []p.Uint256{c.Row.Owner, c.Row.Source})
		ordered := api.Add(api.Mul(prevZero, api.Sub(1, zero)), api.Mul(api.IsZero(api.Sub(prevZero, zero)), api.Add(kl, api.Mul(ke, ml))))
		api.AssertIsEqual(api.Mul(api.Sub(1, first), api.Sub(1, ordered)), 0)
		fresh := api.Or(first, api.Or(prevZero, api.Sub(1, ke)))
		positive := api.Sub(1, zero)
		flush := api.Mul(api.Sub(1, first), api.Sub(1, prevZero), fresh)
		out.Cohorts = api.Select(flush, CohortHashCircuit(api, b.Cohorts, b.Key, b.Cohort, b.Count), b.Cohorts)
		out.Cohort = a.AddChecked(b.Cohort, p.Uint256{flush, 0, 0, 0})
		out.Count = a.AddChecked(a.Select(fresh, p.Const(0), b.Count), c.Row.Count)
		out.Members = api.Select(positive, MemberHashCircuit(api, b.Members, c.Row, k, out.Cohort), b.Members)
		out.Total = a.AddChecked(b.Total, c.Row.Count)
		out.Previous = c.Row
		out.Key = k
		out.Offset = p.Const(0)
		out.Processed = a.AddChecked(b.Processed, p.Const(1))
		last := a.Equal(out.Processed, c.C.Rows)
		out.Phase = api.Select(zero, api.Select(last, Finish, Member), Expand)
	case Expand:
		ex := p.ExpandCircuit{Key: b.Key, UnitKey: b.Key, Cohort: b.Cohort, UnitCohort: b.Cohort, Count: b.Previous.Count, Offset: b.Offset, Index: b.Unit, Hull: b.Key.Stats.Hull, Shield: b.Key.Stats.Shield, NextOffset: c.After.Offset, NextIndex: c.After.Unit, Last: a.Equal(a.AddChecked(b.Offset, p.Const(1)), b.Previous.Count)}
		if err := ex.Define(api); err != nil {
			return err
		}
		out.Offset = c.After.Offset
		out.Unit = c.After.Unit
		c.UnitPath.Verify(api, b.UnitRoot, b.Unit, UnitZero())
		c.UnitPath.Verify(api, c.After.UnitRoot, b.Unit, UnitHashCircuit(api, b.Key, b.Cohort))
		out.UnitRoot = c.After.UnitRoot
		out.Phase = api.Select(ex.Last, api.Select(a.Equal(b.Processed, c.C.Rows), Finish, Member), Expand)
	case Finish:
		a.AssertEqual(b.Processed, c.C.Rows)
		a.AssertEqual(b.Unit, b.Total)
		a.AssertEqual(b.Offset, p.Const(0))
		out.Phase = Done
		positive := api.Sub(1, a.Equal(b.Count, p.Const(0)))
		out.Cohorts = api.Select(positive, CohortHashCircuit(api, b.Cohorts, b.Key, b.Cohort, b.Count), b.Cohorts)
		api.AssertIsEqual(c.Result, ResultHashCircuit(api, c.ContextHash, out))
	}
	for i, v := range out.values() {
		api.AssertIsEqual(c.After.values()[i], v)
	}
	return nil
}
func ResultHashCircuit(api frontend.API, context frontend.Variable, s State) frontend.Variable {
	return hash(api, ResultDomain, append([]frontend.Variable{context, s.Members, s.Cohorts, s.UnitRoot}, s.Total[:]...)...)
}
func AssertLinked(api frontend.API, l, r *Step) {
	api.AssertIsEqual(l.ContextHash, r.ContextHash)
	api.AssertIsEqual(l.AfterHash, r.BeforeHash)
}
