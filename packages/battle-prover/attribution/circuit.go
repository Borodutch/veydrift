package attribution

import (
	"fmt"
	"github.com/consensys/gnark/frontend"
)

type Step struct {
	ContextRoot, BeforeRoot, AfterRoot, Finished, Result frontend.Variable `gnark:",public"`
	Context                                              Context
	Before, After                                        State
	Member, Target                                       Member
	Dead, Quotient, TargetQuotient                       frontend.Variable
	Remainder, TargetRemainder                           Uint256
	Kind                                                 int `gnark:"-"`
}

func Shape(kind int) *Step { return &Step{Kind: kind} }
func (s *Step) Statement() Statement {
	return Statement{s.ContextRoot, s.BeforeRoot, s.AfterRoot, s.Finished, s.Result}
}
func (s *Step) Define(api frontend.API) error {
	if s.Kind < Collect || s.Kind >= Done {
		return fmt.Errorf("invalid phase")
	}
	a := mathAPI(api)
	c := s.Context
	b := s.Before
	out := b
	for _, x := range []Uint256{c.Snapshot, c.Cohort, c.Stats[0], c.Stats[1], c.Stats[2], c.Members, c.Total, c.Loss, b.Index, b.Outer, b.Sum, b.FloorSum, b.Rank, b.LostSum, b.PrevOwner, b.PrevSource} {
		for _, v := range x {
			api.ToBinary(v, 64)
		}
	}
	api.AssertIsBoolean(c.Side)
	api.ToBinary(c.Type, 16)
	api.AssertIsEqual(a.Equal(c.Total, U(0)), 0)
	api.AssertIsEqual(a.Equal(c.Members, U(0)), 0)
	api.AssertIsEqual(a.Equal(c.Stats[2], U(0)), 0)
	api.AssertIsEqual(a.Less(c.Total, c.Loss), 0)
	api.AssertIsEqual(s.ContextRoot, hc(api, contextDomain, c.values()...))
	api.AssertIsEqual(s.BeforeRoot, hc(api, stateDomain, b.values()...))
	api.AssertIsEqual(s.AfterRoot, hc(api, stateDomain, s.After.values()...))
	api.AssertIsEqual(b.Phase, s.Kind)
	limit := c.Members
	if s.Kind == Units {
		limit = c.Total
	}
	api.AssertIsEqual(a.Less(b.Index, limit), 1)
	next := a.AddChecked(b.Index, U(1))
	last := a.Equal(next, limit)
	out.Index = a.Select(last, U(0), next)
	var leaf frontend.Variable
	if s.Kind != Units {
		s.Member.valid(api)
		leaf = hc(api, memberDomain, s.Member.values()...)
	}
	root := frontend.Variable(0)
	if s.Kind == Units {
		api.AssertIsBoolean(s.Dead)
		root = chainC(api, unitsDomain, b.Scan, b.Index, s.Dead)
	} else {
		root = chainC(api, rosterDomain, b.Scan, b.Index, leaf)
	}
	expected := c.Roster
	if s.Kind == Units {
		expected = c.Units
	}
	api.AssertIsEqual(api.Mul(last, api.Sub(root, expected)), 0)
	out.Scan = api.Select(last, 0, root)
	switch s.Kind {
	case Collect:
		first := a.Equal(b.Index, U(0))
		prev := Member{b.PrevOwner, b.PrevSource, 1}
		api.AssertIsEqual(api.Mul(api.Sub(1, first), api.Sub(1, order(a, prev, s.Member))), 0)
		out.PrevOwner = s.Member.Owner
		out.PrevSource = s.Member.Source
		sum := a.AddChecked(b.Sum, Uint256{s.Member.Quantity, 0, 0, 0})
		a.conditional(last, sum, c.Total)
		out.Sum = a.Select(last, U(0), sum)
		out.Phase = api.Select(last, Units, Collect)
	case Units:
		sum := a.AddChecked(b.Sum, Uint256{s.Dead, 0, 0, 0})
		a.conditional(last, sum, c.Loss)
		out.Sum = a.Select(last, U(0), sum)
		out.Phase = api.Select(last, Floors, Units)
	case Floors:
		a.division(c.Loss, c.Total, s.Member.Quantity, s.Quotient, s.Remainder)
		sum := a.AddChecked(b.Sum, Uint256{s.Quotient, 0, 0, 0})
		api.AssertIsEqual(a.Less(c.Loss, sum), 0)
		out.Sum = a.Select(last, U(0), sum)
		out.FloorSum = a.Select(last, sum, b.FloorSum)
		out.Phase = api.Select(last, Rank, Floors)
	case Rank:
		api.AssertIsEqual(a.Less(b.Outer, c.Members), 1)
		s.Target.valid(api)
		// One source cannot be reassigned to another owner within this cohort.
		api.AssertIsEqual(api.Mul(a.Equal(s.Member.Source, s.Target.Source), api.Sub(1, a.Equal(s.Member.Owner, s.Target.Owner))), 0)
		active := hc(api, memberDomain, s.Target.values()...)
		first := a.Equal(b.Index, U(0))
		api.AssertIsEqual(api.Mul(api.Sub(1, first), api.Sub(b.Active, active)), 0)
		out.Active = api.Select(last, 0, active)
		a.division(c.Loss, c.Total, s.Member.Quantity, s.Quotient, s.Remainder)
		a.division(c.Loss, c.Total, s.Target.Quantity, s.TargetQuotient, s.TargetRemainder)
		outranks := api.Or(a.Less(s.TargetRemainder, s.Remainder), api.And(a.Equal(s.Remainder, s.TargetRemainder), order(a, s.Member, s.Target)))
		rank := a.AddChecked(b.Rank, Uint256{outranks, 0, 0, 0})
		out.Rank = a.Select(last, U(0), rank)
		extra := a.Less(rank, a.SubChecked(c.Loss, b.FloorSum))
		lost := api.Add(s.TargetQuotient, extra)
		api.ToBinary(lost, 32)
		survivors := api.Sub(s.Target.Quantity, lost)
		api.ToBinary(survivors, 32)
		sum := a.AddChecked(b.LostSum, Uint256{lost, 0, 0, 0})
		out.LostSum = a.Select(last, sum, b.LostSum)
		outerNext := a.AddChecked(b.Outer, U(1))
		out.Outer = a.Select(last, outerNext, b.Outer)
		final := api.And(last, a.Equal(outerNext, c.Members))
		outerRoot := chainC(api, rosterDomain, b.OuterScan, b.Outer, active)
		out.OuterScan = api.Select(last, outerRoot, b.OuterScan)
		api.AssertIsEqual(api.Mul(final, api.Sub(outerRoot, c.Roster)), 0)
		a.conditional(final, sum, c.Loss)
		row := hc(api, outputDomain, active, lost, survivors)
		output := chainC(api, outputDomain, b.Output, b.Outer, row)
		out.Output = api.Select(last, output, b.Output)
		out.Phase = api.Select(final, Done, Rank)
	}
	for i, v := range out.values() {
		api.AssertIsEqual(v, s.After.values()[i])
	}
	finished := api.IsZero(api.Sub(out.Phase, Done))
	api.AssertIsEqual(s.Finished, finished)
	api.AssertIsEqual(s.Result, api.Mul(finished, hc(api, resultDomain, s.ContextRoot, out.Output)))
	return nil
}
