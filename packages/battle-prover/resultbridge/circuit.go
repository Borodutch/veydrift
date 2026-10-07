package resultbridge

import (
	"fmt"
	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/frontend"
	"math/big"
)

// Every Close emits an attribution proof obligation. Result is NOT verified
// without discharging every one, as well as preparation and combat obligations.
type Statement [10]frontend.Variable
type Step struct {
	ContextRoot, PreparedRoot, Input, CombatResult, BeforeRoot, AfterRoot, Finished, Result, AttributionContext, AttributionResult frontend.Variable `gnark:",public"`
	Context                                                                                                                        Context
	Before, After                                                                                                                  State
	Cohort                                                                                                                         Cohort
	Member                                                                                                                         Member
	Unit                                                                                                                           Opening
	AttributionOutput                                                                                                              frontend.Variable
	Kind                                                                                                                           int `gnark:"-"`
}

func Shape(k int) *Step { return &Step{Kind: k} }
func (s *Step) Statement() Statement {
	return Statement{s.ContextRoot, s.PreparedRoot, s.Input, s.CombatResult, s.BeforeRoot, s.AfterRoot, s.Finished, s.Result, s.AttributionContext, s.AttributionResult}
}
func attrValues(snapshot U, c Cohort, s State) []frontend.Variable {
	v := fields(snapshot, c.ID)
	v = append(v, c.Key.Side, c.Key.Type)
	v = append(v, fields(c.Key.Stats.Attack, c.Key.Stats.Shield, c.Key.Stats.Hull, c.Members, c.Total, s.Loss)...)
	return append(v, s.Roster, s.Dead)
}
func (s *Step) Define(api frontend.API) error {
	if s.Kind < Begin || s.Kind > Finish {
		return fmt.Errorf("invalid phase")
	}
	a := p.New(api)
	b := s.Before
	out := b
	c := s.Context
	d := s.Cohort
	api.AssertIsEqual(s.ContextRoot, hc(api, ContextDomain, c.values()...))
	api.AssertIsEqual(s.PreparedRoot, hc(api, prep.ResultDomain, c.Prepared.ResultValues()...))
	api.AssertIsEqual(s.Input, hc(api, 440403, c.InputValues()...))
	api.AssertIsEqual(s.CombatResult, hc(api, 440405, c.ResultValues(s.Input)...))
	for _, x := range []U{c.Prepared.Snapshot, c.Prepared.N, c.Prepared.Cohorts, c.Prepared.Members, c.Combat.Round, c.Combat.Count0, c.Combat.Count1, c.Combat.Outcome, b.Cohort, b.Member, b.Unit, b.Local, b.Sum, b.Loss, b.Survivors0, b.Survivors1} {
		check(api, x)
	}
	for _, x := range c.Combat.Seed {
		api.ToBinary(x, 8)
	}
	api.AssertIsEqual(a.Less(c.Prepared.Snapshot, p.MustValue(fr.Modulus())), 1)
	var snapshot frontend.Variable = 0
	for i, v := range c.Prepared.Snapshot {
		snapshot = api.Add(snapshot, api.Mul(v, new(big.Int).Lsh(big.NewInt(1), uint(64*i))))
	}
	api.AssertIsEqual(snapshot, c.Prepared.PreparationContext)
	api.AssertIsEqual(s.BeforeRoot, hc(api, StateDomain, b.values()...))
	api.AssertIsEqual(s.AfterRoot, hc(api, StateDomain, s.After.values()...))
	api.AssertIsEqual(b.Phase, s.Kind)
	if s.Kind != Begin && s.Kind != Finish {
		api.AssertIsEqual(b.Active, hc(api, CohortDomain, d.values()...))
		a.AssertEqual(d.ID, b.Cohort)
	}
	var ac, ar frontend.Variable = 0, 0
	switch s.Kind {
	case Begin:
		empty := a.Equal(c.Prepared.Cohorts, Z(0))
		api.AssertIsEqual(a.Less(b.Cohort, c.Prepared.Cohorts), api.Sub(1, empty))
		// Empty input uses a canonical all-zero dummy cohort, but never emits it.
		for _, v := range d.values() {
			api.AssertIsEqual(api.Mul(empty, v), 0)
		}
		a.AssertEqual(d.ID, b.Cohort)
		for _, x := range []U{d.ID, d.Members, d.Total, d.Key.Stats.Attack, d.Key.Stats.Shield, d.Key.Stats.Hull} {
			check(api, x)
		}
		api.AssertIsBoolean(d.Key.Side)
		api.ToBinary(d.Key.Type, 16)
		api.AssertIsEqual(a.Equal(d.Total, Z(0)), empty)
		api.AssertIsEqual(a.Equal(d.Members, Z(0)), empty)
		api.AssertIsEqual(a.Equal(d.Key.Stats.Hull, Z(0)), empty)
		out.Active = api.Select(empty, 0, hc(api, CohortDomain, d.values()...))
		out.CohortScan = api.Select(empty, b.CohortScan, prep.CohortHashCircuit(api, b.CohortScan, d.Key, d.ID, d.Total))
		out.Phase = api.Select(empty, Finish, Members)
	case Members:
		api.AssertIsEqual(a.Less(b.Local, d.Members), 1)
		api.AssertIsEqual(a.Less(b.Member, c.Prepared.Members), 1)
		m := s.Member
		check(api, m.Owner)
		check(api, m.Source)
		api.ToBinary(m.Owner[2], 32)
		api.AssertIsEqual(m.Owner[3], 0)
		api.ToBinary(m.Quantity, 32)
		api.AssertIsDifferent(m.Quantity, 0)
		for _, v := range []frontend.Variable{m.Tech.Weapons, m.Tech.Shielding, m.Tech.Armor} {
			api.ToBinary(v, 16)
		}
		out.MemberScan = prep.MemberHashCircuit(api, b.MemberScan, m.Row(d.Key), d.Key, d.ID)
		out.Member = a.AddChecked(b.Member, Z(1))
		out.Roster = sc(api, 440602, b.Roster, b.Local, hc(api, 440601, m.values()...))
		sum := a.AddChecked(b.Sum, U{m.Quantity, 0, 0, 0})
		next := a.AddChecked(b.Local, Z(1))
		last := a.Equal(next, d.Members)
		a.AssertEqual(a.Select(last, sum, d.Total), d.Total)
		out.Local = a.Select(last, Z(0), next)
		out.Sum = a.Select(last, Z(0), sum)
		out.Phase = api.Select(last, Units, Members)
	case Units:
		api.AssertIsEqual(a.Less(b.Local, d.Total), 1)
		api.AssertIsEqual(a.Less(b.Unit, c.Prepared.N), 1)
		s.Unit.Verify(api, c.Combat.Memory, b.Unit)
		u := s.Unit.Cell
		for i, x := range []U{{d.Key.Side, 0, 0, 0}, {d.Key.Type, 0, 0, 0}, d.Key.Stats.Attack, d.Key.Stats.Shield, d.Key.Stats.Hull, d.ID} {
			a.AssertEqual(u[i], x)
		}
		api.AssertIsEqual(a.Less(u[4], u[6]), 0)
		api.AssertIsEqual(a.Less(u[3], u[7]), 0)
		dead := a.Equal(u[6], Z(0))
		alive := api.Sub(1, dead)
		a.AssertEqual(u[8], U{alive, 0, 0, 0})
		out.Dead = sc(api, 440603, b.Dead, b.Local, dead)
		out.Loss = a.AddChecked(b.Loss, U{dead, 0, 0, 0})
		out.Survivors0 = a.AddChecked(b.Survivors0, U{api.Mul(alive, api.Sub(1, d.Key.Side)), 0, 0, 0})
		out.Survivors1 = a.AddChecked(b.Survivors1, U{api.Mul(alive, d.Key.Side), 0, 0, 0})
		out.Unit = a.AddChecked(b.Unit, Z(1))
		next := a.AddChecked(b.Local, Z(1))
		last := a.Equal(next, d.Total)
		out.Local = a.Select(last, Z(0), next)
		out.Phase = api.Select(last, Close, Units)
	case Close:
		ac = hc(api, 440604, attrValues(c.Prepared.Snapshot, d, b)...)
		ar = hc(api, 440607, ac, s.AttributionOutput)
		row := hc(api, OutputDomain, append(fields(d.ID), ac, ar)...)
		out.Output = sc(api, OutputDomain, b.Output, b.Cohort, row)
		out.Cohort = a.AddChecked(b.Cohort, Z(1))
		out.Phase = api.Select(a.Equal(out.Cohort, c.Prepared.Cohorts), Finish, Begin)
		out.Active = 0
		out.Roster = 0
		out.Dead = 0
		out.Loss = Z(0)
	case Finish:
		a.AssertEqual(b.Cohort, c.Prepared.Cohorts)
		a.AssertEqual(b.Member, c.Prepared.Members)
		a.AssertEqual(b.Unit, c.Prepared.N)
		a.AssertEqual(b.Survivors0, c.Combat.Count0)
		a.AssertEqual(b.Survivors1, c.Combat.Count1)
		api.AssertIsEqual(b.CohortScan, c.Prepared.CohortRoot)
		api.AssertIsEqual(b.MemberScan, c.Prepared.MemberRoot)
		out.Phase = Done
	}
	for i, v := range out.values() {
		api.AssertIsEqual(s.After.values()[i], v)
	}
	api.AssertIsEqual(s.AttributionContext, ac)
	api.AssertIsEqual(s.AttributionResult, ar)
	done := api.IsZero(api.Sub(out.Phase, Done))
	api.AssertIsEqual(s.Finished, done)
	api.AssertIsEqual(s.Result, api.Mul(done, hc(api, ResultDomain, s.ContextRoot, s.PreparedRoot, s.Input, s.CombatResult, out.Output)))
	return nil
}

// Helpers constrain public statement equality, NOT proof verification.
func AssertLinked(api frontend.API, l, r Statement) {
	for i := 0; i < 4; i++ {
		api.AssertIsEqual(l[i], r[i])
	}
	api.AssertIsEqual(l[5], r[4])
	api.AssertIsEqual(l[6], 0)
	api.AssertIsEqual(l[7], 0)
}
func AssertComplete(api frontend.API, first, last Statement) {
	for i := 0; i < 4; i++ {
		api.AssertIsEqual(first[i], last[i])
	}
	api.AssertIsEqual(first[4], Zero().Commitment())
	api.AssertIsEqual(last[6], 1)
}
func AssertInputs(api frontend.API, bridge Statement, prepared frontend.Variable, combatFirst, combatLast [8]frontend.Variable) {
	api.AssertIsEqual(bridge[1], prepared)
	api.AssertIsEqual(bridge[2], combatFirst[0])
	api.AssertIsEqual(bridge[2], combatLast[0])
	api.AssertIsEqual(combatFirst[3], 0)
	api.AssertIsEqual(combatFirst[5], 0)
	api.AssertIsEqual(combatLast[6], 1)
	api.AssertIsEqual(bridge[3], combatLast[7])
}
func AssertAttribution(api frontend.API, close Statement, first, last attr.Statement) {
	attr.AssertComplete(api, first, last)
	api.AssertIsEqual(close[8], first[0])
	api.AssertIsEqual(close[9], last[4])
}
