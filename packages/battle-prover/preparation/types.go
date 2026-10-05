package preparation

import (
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/frontend"
	"math/big"
)

type Row struct {
	Owner, Source, Count p.Uint256
	Side, Type           frontend.Variable
	Tech                 p.Technology
}

func (r Row) Values() []frontend.Variable {
	return append(fields(r.Owner, r.Source, r.Count), r.Side, r.Type, r.Tech.Weapons, r.Tech.Shielding, r.Tech.Armor)
}
func (r Row) validate(api frontend.API) {
	check(api, r.Owner)
	api.ToBinary(r.Owner[2], 32)
	api.AssertIsEqual(r.Owner[3], 0)
	check(api, r.Source)
	check(api, r.Count)
	api.ToBinary(r.Count[0], 32)
	for _, v := range r.Count[1:] {
		api.AssertIsEqual(v, 0)
	}
	api.AssertIsBoolean(r.Side)
	api.ToBinary(r.Type, 16)
	for _, v := range []frontend.Variable{r.Tech.Weapons, r.Tech.Shielding, r.Tech.Armor} {
		api.ToBinary(v, 16)
	}
}
func KeyValues(k p.Key) []frontend.Variable {
	return append([]frontend.Variable{k.Side, k.Type}, fields(k.Stats.Attack, k.Stats.Shield, k.Stats.Hull)...)
}
func rowKey(r Row, s p.Stats) p.Key { return p.Key{Side: r.Side, Type: r.Type, Stats: s} }

type Identity struct {
	Chain, Game, Battle, Body, Incarnation, Impact, Rules, Verifier, Catalog, SeedPolicy p.Uint256
	TargetIsMoon                                                                         frontend.Variable
}

func (i Identity) values() []frontend.Variable {
	return append(fields(i.Chain, i.Game, i.Battle, i.Body, i.Incarnation, i.Impact, i.Rules, i.Verifier, i.Catalog, i.SeedPolicy), i.TargetIsMoon)
}

type Context struct {
	Identity           Identity
	Raw, Catalog, Tech frontend.Variable
	Rows               p.Uint256
}

func (c Context) values() []frontend.Variable {
	return append(append(c.Identity.values(), c.Raw, c.Catalog, c.Tech), c.Rows[:]...)
}
func (c Context) Commitment() *big.Int { return Hash(ContextDomain, c.values()...) }

const (
	Boot = iota
	Pair
	Member
	Expand
	Finish
	Done
)

type State struct {
	Phase                                                     frontend.Variable
	Step, I, J, Processed, Total, Unit, Cohort, Offset, Count p.Uint256
	Visited, Members, Cohorts, UnitRoot                       frontend.Variable
	Previous                                                  Row
	Key                                                       p.Key
}

func (s State) values() []frontend.Variable {
	v := []frontend.Variable{s.Phase, s.Visited, s.Members, s.Cohorts, s.UnitRoot}
	v = append(v, fields(s.Step, s.I, s.J, s.Processed, s.Total, s.Unit, s.Cohort, s.Offset, s.Count)...)
	v = append(v, s.Previous.Values()...)
	return append(v, KeyValues(s.Key)...)
}
func (s State) Commitment() *big.Int { return Hash(StateDomain, s.values()...) }
func zeroRow() Row {
	return Row{p.Const(0), p.Const(0), p.Const(0), 0, 0, p.Technology{Weapons: 0, Shielding: 0, Armor: 0}}
}
func zeroKey() p.Key {
	return p.Key{Side: 0, Type: 0, Stats: p.Stats{Attack: p.Const(0), Shield: p.Const(0), Hull: p.Const(0)}}
}
func Initial() State {
	return State{Phase: Boot, Step: p.Const(0), I: p.Const(0), J: p.Const(0), Processed: p.Const(0), Total: p.Const(0), Unit: p.Const(0), Cohort: p.Const(0), Offset: p.Const(0), Count: p.Const(0), Visited: NewTree(big.NewInt(0)).Root(), Members: 0, Cohorts: 0, UnitRoot: NewUnitTree().Root(), Previous: zeroRow(), Key: zeroKey()}
}
func keyTuple(k p.Key) []p.Uint256 {
	return []p.Uint256{{k.Side, 0, 0, 0}, {k.Type, 0, 0, 0}, k.Stats.Attack, k.Stats.Shield, k.Stats.Hull}
}

// Canonical rolling manifests are independently reconstructible by downstream
// verified scans. Each positive member includes its effective key and cohort.
func MemberValues(previous frontend.Variable, r Row, k p.Key, cohort p.Uint256) []frontend.Variable {
	return append(append(append([]frontend.Variable{previous}, r.Values()...), KeyValues(k)...), cohort[:]...)
}
func CohortValues(previous frontend.Variable, k p.Key, id, count p.Uint256) []frontend.Variable {
	return append(append([]frontend.Variable{previous}, KeyValues(k)...), fields(id, count)...)
}
func MemberHash(previous frontend.Variable, r Row, k p.Key, id p.Uint256) *big.Int {
	return Hash(MemberDomain, MemberValues(previous, r, k, id)...)
}
func CohortHash(previous frontend.Variable, k p.Key, id, count p.Uint256) *big.Int {
	return Hash(CohortDomain, CohortValues(previous, k, id, count)...)
}
func MemberHashCircuit(api frontend.API, previous frontend.Variable, r Row, k p.Key, id p.Uint256) frontend.Variable {
	return hash(api, MemberDomain, MemberValues(previous, r, k, id)...)
}
func CohortHashCircuit(api frontend.API, previous frontend.Variable, k p.Key, id, count p.Uint256) frontend.Variable {
	return hash(api, CohortDomain, CohortValues(previous, k, id, count)...)
}
