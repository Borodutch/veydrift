package resultbridge

import (
	"fmt"
	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"math/big"
)

type Group struct {
	Cohort  Cohort
	Members []Member
}

func PreparedRoots(groups []Group) (cohorts, members *big.Int, n, mc U) {
	cohorts = big.NewInt(0)
	members = big.NewInt(0)
	count := new(big.Int)
	memberCount := uint64(0)
	for _, g := range groups {
		cohorts = prep.CohortHash(cohorts, g.Cohort.Key, g.Cohort.ID, g.Cohort.Total)
		count.Add(count, number(g.Cohort.Total))
		for _, m := range g.Members {
			members = prep.MemberHash(members, m.Row(g.Cohort.Key), g.Cohort.Key, g.Cohort.ID)
			memberCount++
		}
	}
	return cohorts, members, p.MustValue(count), Z(memberCount)
}

type Machine struct {
	Context      Context
	State        State
	Groups       []Group
	Open         func(U) Opening
	Attributions []*attr.Machine
	AttrSteps    [][]*attr.Step
	dead         []bool
}

func New(c Context, groups []Group, open func(U) Opening) *Machine {
	return &Machine{Context: c, State: Zero(), Groups: groups, Open: open}
}
func add(x U, y uint64) U { return p.MustValue(new(big.Int).Add(number(x), new(big.Int).SetUint64(y))) }
func dummyCohort() Cohort {
	return Cohort{Z(0), p.Key{Side: 0, Type: 0, Stats: p.Stats{Attack: Z(0), Shield: Z(0), Hull: Z(0)}}, Z(0), Z(0)}
}
func blankOpening() Opening {
	var o Opening
	for i := range o.Cell {
		o.Cell[i] = Z(0)
	}
	for i := range o.Siblings {
		o.Siblings[i] = 0
	}
	return o
}
func (s *Step) commit() {
	s.ContextRoot = s.Context.Commitment()
	s.PreparedRoot = s.Context.Prepared.Commitment()
	s.Input = s.Context.Input()
	s.CombatResult = s.Context.CombatResult()
	s.BeforeRoot = s.Before.Commitment()
	s.AfterRoot = s.After.Commitment()
	s.Finished = 0
	s.Result = 0
	if scalar(s.After.Phase).Int64() == Done {
		s.Finished = 1
		s.Result = Hash(ResultDomain, s.ContextRoot, s.PreparedRoot, s.Input, s.CombatResult, s.After.Output)
	}
}
func (m *Machine) Next() (*Step, error) {
	b := m.State
	k := int(scalar(b.Phase).Int64())
	if k == Done {
		return nil, fmt.Errorf("complete")
	}
	s := &Step{Context: m.Context, Before: b, After: b, Kind: k, Cohort: dummyCohort(), Member: Member{Z(0), Z(0), 0, p.Technology{Weapons: 0, Shielding: 0, Armor: 0}}, Unit: blankOpening(), AttributionOutput: 0, AttributionContext: 0, AttributionResult: 0}
	out := b
	var g Group
	if len(m.Groups) > 0 && k != Finish {
		ci := number(b.Cohort)
		if !ci.IsUint64() || ci.Uint64() >= uint64(len(m.Groups)) {
			return nil, fmt.Errorf("cohort cursor outside host materialization")
		}
		g = m.Groups[ci.Uint64()]
		s.Cohort = g.Cohort
	}
	switch k {
	case Begin:
		if len(m.Groups) == 0 {
			out.Phase = Finish
		} else {
			out.Active = g.Cohort.Hash()
			out.CohortScan = prep.CohortHash(b.CohortScan, g.Cohort.Key, g.Cohort.ID, g.Cohort.Total)
			out.Phase = Members
			m.dead = nil
		}
	case Members:
		i := number(b.Local)
		if !i.IsUint64() || i.Uint64() >= uint64(len(g.Members)) {
			return nil, fmt.Errorf("member cursor")
		}
		s.Member = g.Members[i.Uint64()]
		out.MemberScan = prep.MemberHash(b.MemberScan, s.Member.Row(g.Cohort.Key), g.Cohort.Key, g.Cohort.ID)
		out.Member = add(b.Member, 1)
		out.Roster = stream(440602, b.Roster, b.Local, Hash(440601, s.Member.values()...))
		out.Sum = add(b.Sum, scalar(s.Member.Quantity).Uint64())
		out.Local = add(b.Local, 1)
		if number(out.Local).Cmp(number(g.Cohort.Members)) == 0 {
			out.Local = Z(0)
			out.Sum = Z(0)
			out.Phase = Units
		}
	case Units:
		s.Unit = m.Open(b.Unit)
		dead := number(s.Unit.Cell[6]).Sign() == 0
		d := uint64(0)
		if dead {
			d = 1
		}
		m.dead = append(m.dead, dead)
		out.Dead = stream(440603, b.Dead, b.Local, d)
		out.Loss = add(b.Loss, d)
		if !dead {
			if scalar(g.Cohort.Key.Side).Sign() == 0 {
				out.Survivors0 = add(b.Survivors0, 1)
			} else {
				out.Survivors1 = add(b.Survivors1, 1)
			}
		}
		out.Unit = add(b.Unit, 1)
		out.Local = add(b.Local, 1)
		if number(out.Local).Cmp(number(g.Cohort.Total)) == 0 {
			out.Local = Z(0)
			out.Phase = Close
		}
	case Close:
		c := attr.Context{Snapshot: m.Context.Prepared.Snapshot, Cohort: g.Cohort.ID, Side: g.Cohort.Key.Side, Type: g.Cohort.Key.Type, Stats: [3]U{g.Cohort.Key.Stats.Attack, g.Cohort.Key.Stats.Shield, g.Cohort.Key.Stats.Hull}}
		ms := []attr.Member{}
		for _, v := range g.Members {
			ms = append(ms, attr.Member{Owner: v.Owner, Source: v.Source, Quantity: v.Quantity})
		}
		am, e := attr.Prepare(c, ms, m.dead)
		if e != nil {
			return nil, e
		}
		steps := []*attr.Step{}
		for scalar(am.State.Phase).Int64() != attr.Done {
			as, e := am.Next()
			if e != nil {
				return nil, e
			}
			steps = append(steps, as)
		}
		m.Attributions = append(m.Attributions, am)
		m.AttrSteps = append(m.AttrSteps, steps)
		s.AttributionOutput = am.State.Output
		s.AttributionContext = Hash(440604, attrValues(m.Context.Prepared.Snapshot, g.Cohort, b)...)
		s.AttributionResult = Hash(440607, s.AttributionContext, s.AttributionOutput)
		row := Hash(OutputDomain, append(fields(g.Cohort.ID), s.AttributionContext, s.AttributionResult)...)
		out.Output = stream(OutputDomain, b.Output, b.Cohort, row)
		out.Cohort = add(b.Cohort, 1)
		out.Phase = Begin
		if number(out.Cohort).Cmp(number(m.Context.Prepared.Cohorts)) == 0 {
			out.Phase = Finish
		}
		out.Active = 0
		out.Roster = 0
		out.Dead = 0
		out.Loss = Z(0)
	case Finish:
		out.Phase = Done
	default:
		return nil, fmt.Errorf("bad phase")
	}
	s.After = out
	s.commit()
	m.State = out
	return s, nil
}
