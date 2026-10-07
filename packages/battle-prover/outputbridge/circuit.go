package outputbridge

import (
	"fmt"
	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark/frontend"
)

type Statement [5]frontend.Variable
type Step struct {
	Binding, BeforeHash, AfterHash, Finished, Result frontend.Variable `gnark:",public"`
	Manifest                                         Manifest
	Before, After                                    State
	Allocation                                       attr.Context
	Leaf                                             Leaf
	Kind                                             int `gnark:"-"`
}

func Shape(kind int) *Step { return &Step{Kind: kind} }
func (s *Step) Statement() Statement {
	return Statement{s.Binding, s.BeforeHash, s.AfterHash, s.Finished, s.Result}
}
func equal(api frontend.API, x, y []frontend.Variable) {
	if len(x) != len(y) {
		panic("schema")
	}
	for i := range x {
		api.AssertIsEqual(x[i], y[i])
	}
}
func validateManifest(api frontend.API, m Manifest) {
	c := m.Context
	for _, w := range []U{m.ChainRecord, m.Root, c.Prepared.Snapshot, c.Prepared.N, c.Prepared.Cohorts, c.Prepared.Members, c.Combat.Round, c.Combat.Count0, c.Combat.Count1, c.Combat.Outcome} {
		raw.Narrow(api, w, 256)
	}
	raw.Narrow(api, c.Combat.Round, 8)
	raw.Narrow(api, c.Combat.Outcome, 8)
	api.AssertIsLessOrEqual(c.Combat.Outcome[0], 2)
	for _, b := range c.Combat.Seed {
		api.ToBinary(b, 8)
	}
	api.AssertIsEqual(m.Pipeline[0], c.Prepared.PreparationContext)
	api.AssertIsEqual(m.Pipeline[1], raw.Hash(api, prep.ResultDomain, c.Prepared.ResultValues()...))
	api.AssertIsEqual(m.Pipeline[2], raw.Hash(api, 440403, c.InputValues()...))
	api.AssertIsEqual(m.Pipeline[3], raw.Hash(api, 440405, c.ResultValues(m.Pipeline[2])...))
	api.AssertIsEqual(m.Pipeline[4], raw.Hash(api, rb.ContextDomain, contextValues(c)...))
	api.AssertIsEqual(m.Pipeline[7], raw.Hash(api, rb.CompleteResultDomain, m.Pipeline[4], m.Pipeline[5], m.Pipeline[6]))
}
func validState(api frontend.API, s State) {
	api.ToBinary(s.Phase, 3)
	for _, w := range []U{s.Cohort, s.Index, s.Local, s.Sum, s.Loss, s.Total, s.Survivors0, s.Survivors1, s.PrevOwner, s.PrevSource, s.Expected} {
		raw.Narrow(api, w, 256)
	}
	raw.Narrow(api, s.PrevOwner, 160)
}
func (s *Step) Define(api frontend.API) error {
	if s.Kind < Begin || s.Kind > Finish {
		return fmt.Errorf("invalid output phase")
	}
	a := p.New(api)
	m := s.Manifest
	b := s.Before
	o := b
	c := s.Allocation
	validateManifest(api, m)
	validState(api, b)
	validState(api, s.After)
	api.AssertIsEqual(s.Binding, raw.Hash(api, BindingDomain, m.Values()...))
	api.AssertIsEqual(s.BeforeHash, raw.Hash(api, StateDomain, b.Values()...))
	api.AssertIsEqual(s.AfterHash, raw.Hash(api, StateDomain, s.After.Values()...))
	api.AssertIsEqual(b.Phase, s.Kind)
	if s.Kind == Open || s.Kind == Member || s.Kind == Close {
		for _, w := range []U{c.Snapshot, c.Cohort, c.Members, c.Total, c.Loss, c.Stats[0], c.Stats[1], c.Stats[2]} {
			raw.Narrow(api, w, 256)
		}
		api.AssertIsBoolean(c.Side)
		api.ToBinary(c.Type, 8)
		api.AssertIsLessOrEqual(c.Type, 23)
		api.AssertIsEqual(a.Equal(c.Members, Z(0)), 0)
		api.AssertIsEqual(a.Equal(c.Total, Z(0)), 0)
		api.AssertIsEqual(a.Less(c.Total, c.Loss), 0)
		a.AssertEqual(c.Snapshot, m.Context.Prepared.Snapshot)
		a.AssertEqual(c.Cohort, b.Cohort)
		if s.Kind != Open {
			api.AssertIsEqual(b.Active, raw.Hash(api, 440604, allocationValues(c)...))
		}
	}
	switch s.Kind {
	case Begin:
		equal(api, b.Values(), Initial().Values())
		o.Expected = m.Root
		o.Phase = api.Select(a.Equal(m.Context.Prepared.Cohorts, Z(0)), Finish, Open)
	case Open:
		api.AssertIsEqual(a.Less(b.Cohort, m.Context.Prepared.Cohorts), 1)
		o.Active = raw.Hash(api, 440604, allocationValues(c)...)
		o.Phase = Member
	case Member:
		l := s.Leaf
		api.AssertIsEqual(a.Less(b.Local, c.Members), 1)
		api.AssertIsEqual(a.Less(b.Index, m.Context.Prepared.Members), 1)
		a.AssertEqual(l.Index, b.Index)
		a.AssertEqual(l.Cohort, b.Cohort)
		raw.Narrow(api, l.Owner, 160)
		raw.Narrow(api, l.Source, 256)
		raw.Narrow(api, l.Next, 256)
		api.AssertIsEqual(l.Side, c.Side)
		api.AssertIsEqual(l.Unit, c.Type)
		for _, v := range []frontend.Variable{l.Count, l.Lost, l.Survivors} {
			api.ToBinary(v, 32)
		}
		api.AssertIsDifferent(l.Count, 0)
		api.AssertIsEqual(api.Add(l.Lost, l.Survivors), l.Count)
		first := a.Equal(b.Local, Z(0))
		ordered := api.Or(a.Less(b.PrevOwner, l.Owner), api.And(a.Equal(b.PrevOwner, l.Owner), a.Less(b.PrevSource, l.Source)))
		api.AssertIsEqual(api.Mul(api.Sub(1, first), api.Sub(1, ordered)), 0)
		a.AssertEqual(b.Expected, raw.Keccak(api, l.Words(m.ChainRecord)...))
		o.Expected = l.Next
		mh := raw.Hash(api, 440601, memberValues(attr.Member{Owner: l.Owner, Source: l.Source, Quantity: l.Count})...)
		o.Roster = raw.Hash(api, 440602, streamValues(b.Roster, b.Local, mh)...)
		row := raw.Hash(api, 440606, mh, l.Lost, l.Survivors)
		o.Allocation = raw.Hash(api, 440606, streamValues(b.Allocation, b.Local, row)...)
		o.Sum = a.AddChecked(b.Sum, word(l.Count))
		o.Loss = a.AddChecked(b.Loss, word(l.Lost))
		o.Total = a.AddChecked(b.Total, word(l.Count))
		o.Survivors0 = a.AddChecked(b.Survivors0, word(api.Mul(api.Sub(1, c.Side), l.Survivors)))
		o.Survivors1 = a.AddChecked(b.Survivors1, word(api.Mul(c.Side, l.Survivors)))
		o.PrevOwner = l.Owner
		o.PrevSource = l.Source
		o.Index = a.AddChecked(b.Index, Z(1))
		o.Local = a.AddChecked(b.Local, Z(1))
		o.Phase = api.Select(a.Equal(o.Local, c.Members), Close, Member)
	case Close:
		a.AssertEqual(b.Local, c.Members)
		a.AssertEqual(b.Sum, c.Total)
		a.AssertEqual(b.Loss, c.Loss)
		api.AssertIsEqual(b.Roster, c.Roster)
		ar := raw.Hash(api, 440607, b.Active, b.Allocation)
		row := raw.Hash(api, rb.OutputDomain, append(fields(b.Cohort), b.Active, ar)...)
		o.Output = raw.Hash(api, rb.OutputDomain, streamValues(b.Output, b.Cohort, row)...)
		o.Cohort = a.AddChecked(b.Cohort, Z(1))
		o.Local = Z(0)
		o.Sum = Z(0)
		o.Loss = Z(0)
		o.PrevOwner = Z(0)
		o.PrevSource = Z(0)
		o.Active = 0
		o.Roster = 0
		o.Allocation = 0
		o.Phase = api.Select(a.Equal(o.Cohort, m.Context.Prepared.Cohorts), Finish, Open)
	case Finish:
		a.AssertEqual(b.Cohort, m.Context.Prepared.Cohorts)
		a.AssertEqual(b.Index, m.Context.Prepared.Members)
		a.AssertEqual(b.Total, m.Context.Prepared.N)
		a.AssertEqual(b.Survivors0, m.Context.Combat.Count0)
		a.AssertEqual(b.Survivors1, m.Context.Combat.Count1)
		a.AssertEqual(b.Expected, raw.Keccak(api, raw.Domain(TailDomain), m.ChainRecord, m.Context.Prepared.Members))
		api.AssertIsEqual(m.Pipeline[5], raw.Hash(api, rb.ResultDomain, m.Pipeline[4], m.Pipeline[1], m.Pipeline[2], m.Pipeline[3], b.Output))
		o.Phase = Done
	}
	equal(api, s.After.Values(), o.Values())
	done := api.IsZero(api.Sub(o.Phase, Done))
	api.AssertIsEqual(s.Finished, done)
	api.AssertIsEqual(s.Result, api.Mul(done, raw.Hash(api, ResultDomain, s.Binding)))
	return nil
}

// These functions constrain VERIFIED statements. They do not verify proofs.
func AssertLinked(api frontend.API, l, r Statement) {
	api.AssertIsEqual(l[0], r[0])
	api.AssertIsEqual(l[2], r[1])
	api.AssertIsEqual(l[3], 0)
	api.AssertIsEqual(l[4], 0)
}
func AssertComplete(api frontend.API, first, last Statement) {
	api.AssertIsEqual(first[0], last[0])
	api.AssertIsEqual(first[1], Initial().Commitment())
	api.AssertIsEqual(last[3], 1)
	api.AssertIsEqual(last[4], raw.Hash(api, ResultDomain, last[0]))
}

// AssertAuthenticated MUST follow verification of the complete output range,
// complete pipeline, LinkedQualification and COMPLETE raw prefix under fixed keys.
// It cannot be safely exposed as a circuit accepting unverified private advice.
func AssertAuthenticated(api frontend.API, first, last Statement, m Manifest, pipeline [8]frontend.Variable, qualified q.LinkedStatement, rawFirst, rawLast raw.Statement, public Settlement) {
	AssertComplete(api, first, last)
	validateManifest(api, m)
	api.AssertIsEqual(last[0], raw.Hash(api, BindingDomain, m.Values()...))
	equal(api, m.Pipeline[:], pipeline[:])
	raw.AssertComplete(api, rawFirst, rawLast)
	api.AssertIsEqual(qualified[0], pipeline[0])
	api.AssertIsEqual(qualified[1], pipeline[2])
	api.AssertIsEqual(qualified[2], rawLast[3])
	api.AssertIsEqual(m.RawResult, qualified[2])
	equal(api, m.ChainRecord[:], qualified[3:7])
	expected := m.Settlement()
	equal(api, public[:], expected[:])
}
