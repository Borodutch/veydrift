package protocol

import "github.com/consensys/gnark/frontend"

type Stats struct{ Attack, Shield, Hull Uint256 }
type Technology struct{ Weapons, Shielding, Armor frontend.Variable }

// Key is the candidate-2 canonical cohort tuple. Attribution stays in Group.
type Key struct {
	Side, Type frontend.Variable
	Stats      Stats
}
type Group struct {
	Owner  Owner
	Source Uint256
	Count  frontend.Variable
	Key    Key
	Tech   Technology
}

func (a *Arithmetic) CheckKey(k Key) {
	a.api.AssertIsBoolean(k.Side)
	a.api.ToBinary(k.Type, 16)
	a.lift(k.Stats.Attack)
	a.lift(k.Stats.Shield)
	a.lift(k.Stats.Hull)
	a.api.AssertIsEqual(a.Equal(k.Stats.Hull, Const(0)), 0)
}
func (a *Arithmetic) CheckGroup(g Group) {
	a.CheckKey(g.Key)
	a.lift(g.Owner)
	a.lift(g.Source)
	a.api.ToBinary(g.Owner[2], 32)
	a.api.AssertIsEqual(g.Owner[3], 0)
	a.api.ToBinary(g.Count, 32)
	a.api.ToBinary(g.Tech.Weapons, 16)
	a.api.ToBinary(g.Tech.Shielding, 16)
	a.api.ToBinary(g.Tech.Armor, 16)
}
func (a *Arithmetic) keyFields(k Key) []Uint256 {
	return []Uint256{{k.Side, 0, 0, 0}, {k.Type, 0, 0, 0}, k.Stats.Attack, k.Stats.Shield, k.Stats.Hull}
}

// Lex returns less/equal for ordered tuples, using every bit of each component.
func (a *Arithmetic) Lex(x, y []Uint256) (frontend.Variable, frontend.Variable) {
	if len(x) != len(y) {
		panic("tuple size mismatch")
	}
	var less, equal frontend.Variable = 0, 1
	for i := range x {
		less = a.api.Add(less, a.api.Mul(equal, a.Less(x[i], y[i])))
		equal = a.api.Mul(equal, a.Equal(x[i], y[i]))
	}
	return less, equal
}
func (a *Arithmetic) CompareKeys(x, y Key) (frontend.Variable, frontend.Variable) {
	a.CheckKey(x)
	a.CheckKey(y)
	return a.Lex(a.keyFields(x), a.keyFields(y))
}

// PrepareCircuit checks ONE source row against supplied catalog/research
// values. None of these values are authenticated by this standalone relation.
type PrepareCircuit struct {
	Group      Group
	Base       Stats
	Remainders [3]frontend.Variable
}

func (c *PrepareCircuit) Define(api frontend.API) error {
	a := New(api)
	a.CheckGroup(c.Group)
	api.AssertIsEqual(a.Equal(c.Base.Hull, Const(0)), 0)
	a.Effective(c.Base.Attack, c.Group.Tech.Weapons, c.Group.Key.Stats.Attack, c.Remainders[0])
	a.Effective(c.Base.Shield, c.Group.Tech.Shielding, c.Group.Key.Stats.Shield, c.Remainders[1])
	a.Effective(c.Base.Hull, c.Group.Tech.Armor, c.Group.Key.Stats.Hull, c.Remainders[2])
	return nil
}

// AppendCircuit checks one adjacent canonical positive-count member row and
// updates its running merged count. First starts a new stream. Otherwise keys
// increase, or equal-key (owner,source) strictly increases. Global duplicate,
// source and owner consistency needs authenticated indexes or linked sorted
// passes; adjacency alone does not prove it.
type AppendCircuit struct {
	First                                              frontend.Variable
	Previous, Current                                  Group
	BeforeCount, AfterCount, BeforeCohort, AfterCohort Uint256
	NewCohort                                          frontend.Variable
}

func (c *AppendCircuit) Define(api frontend.API) error {
	a := New(api)
	api.AssertIsBoolean(c.First)
	a.CheckGroup(c.Previous)
	a.CheckGroup(c.Current)
	api.AssertIsDifferent(c.Current.Count, 0)
	less, equal := a.CompareKeys(c.Previous.Key, c.Current.Key)
	memberLess, _ := a.Lex([]Uint256{c.Previous.Owner, c.Previous.Source}, []Uint256{c.Current.Owner, c.Current.Source})
	ordered := api.Add(less, api.Mul(equal, memberLess))
	api.AssertIsEqual(api.Mul(api.Sub(1, c.First), api.Sub(1, ordered)), 0)
	fresh := api.Or(c.First, api.Sub(1, equal))
	api.AssertIsEqual(c.NewCohort, fresh)
	// Select BEFORE arithmetic: finished max-count cohorts do not overflow here.
	before := a.Select(fresh, Const(0), c.BeforeCount)
	a.AssertEqual(c.AfterCount, a.AddChecked(before, Uint256{c.Current.Count, 0, 0, 0}))
	priorID := a.Select(c.First, Const(0), c.BeforeCohort)
	increment := api.Mul(api.Sub(1, c.First), fresh)
	a.AssertEqual(c.AfterCohort, a.AddChecked(priorID, Uint256{increment, 0, 0, 0}))
	// Caller authenticates/chains prior row/count/ID. Explicit first anchors:
	for _, v := range []Uint256{c.BeforeCount, c.BeforeCohort} {
		a.AssertEqual(a.Select(c.First, v, Const(0)), Const(0))
	}
	return nil
}

// ConsistencyCircuit is local; it does NOT establish existence or uniqueness
// of source or owner records. The caller must authenticate complete coverage.
type ConsistencyCircuit struct {
	A, B                  Group
	SameSource, SameOwner frontend.Variable
}

func (c *ConsistencyCircuit) Define(api frontend.API) error {
	a := New(api)
	a.CheckGroup(c.A)
	a.CheckGroup(c.B)
	source := a.Equal(c.A.Source, c.B.Source)
	owner := a.Equal(c.A.Owner, c.B.Owner)
	api.AssertIsEqual(c.SameSource, source)
	api.AssertIsEqual(c.SameOwner, owner)
	api.AssertIsEqual(api.Mul(source, api.Sub(1, owner)), 0)
	api.AssertIsEqual(api.Mul(source, api.Sub(c.A.Key.Side, c.B.Key.Side)), 0)
	for _, p := range [][2]frontend.Variable{{c.A.Tech.Weapons, c.B.Tech.Weapons}, {c.A.Tech.Shielding, c.B.Tech.Shielding}, {c.A.Tech.Armor, c.B.Tech.Armor}} {
		api.AssertIsEqual(api.Mul(owner, api.Sub(p[0], p[1])), 0)
	}
	return nil
}
