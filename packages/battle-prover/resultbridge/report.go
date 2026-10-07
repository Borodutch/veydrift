package resultbridge

import (
	"fmt"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/frontend"
	"math/big"
)

const (
	ReportStateDomain    = 440709
	ReportRowDomain      = 440710
	ReportOutputDomain   = 440711
	ReportResultDomain   = 440712
	CompleteResultDomain = 440713
)

// Report projection enumerates EVERY round's EVERY unit record. Original
// transcript shots/alive advice is bound by reconstructing the combat report.
// Immutable IDs/keys are read from the authenticated final memory; final-round
// alive is additionally constrained equal to final hull>0 (never a free bit).
type ReportState struct {
	Round, Index, Shots0, Shots1 U
	Scan, Output, Done           frontend.Variable
}

func ReportInitial() ReportState { return ReportState{Z(1), Z(0), Z(0), Z(0), 0, 0, 0} }
func (s ReportState) values() []frontend.Variable {
	return append(fields(s.Round, s.Index, s.Shots0, s.Shots1), s.Scan, s.Output, s.Done)
}
func (s ReportState) Commitment() *big.Int { return Hash(ReportStateDomain, s.values()...) }

type ReportStatement [7]frontend.Variable

// Kind=0 consumes one unit record; Kind=1 handles the zero-round report.
type ReportStep struct {
	ContextRoot, Input, CombatResult, BeforeRoot, AfterRoot, Finished, Result frontend.Variable `gnark:",public"`
	Context                                                                   Context
	Before, After                                                             ReportState
	Unit                                                                      Opening
	Alive                                                                     frontend.Variable
	Shots0, Shots1                                                            U
	Kind                                                                      int `gnark:"-"`
}

func ReportShape(kind int) *ReportStep { return &ReportStep{Kind: kind} }
func (s *ReportStep) Statement() ReportStatement {
	return ReportStatement{s.ContextRoot, s.Input, s.CombatResult, s.BeforeRoot, s.AfterRoot, s.Finished, s.Result}
}
func (s *ReportStep) Define(api frontend.API) error {
	if s.Kind < 0 || s.Kind > 1 {
		return fmt.Errorf("bad report kind")
	}
	a := p.New(api)
	c := s.Context
	b := s.Before
	out := b
	api.AssertIsEqual(s.ContextRoot, hc(api, ContextDomain, c.values()...))
	api.AssertIsEqual(s.Input, hc(api, 440403, c.InputValues()...))
	api.AssertIsEqual(s.CombatResult, hc(api, 440405, c.ResultValues(s.Input)...))
	api.AssertIsEqual(s.BeforeRoot, hc(api, ReportStateDomain, b.values()...))
	api.AssertIsEqual(s.AfterRoot, hc(api, ReportStateDomain, s.After.values()...))
	api.AssertIsEqual(b.Done, 0)
	for _, x := range []U{b.Round, b.Index, b.Shots0, b.Shots1, c.Prepared.N, c.Combat.Round, s.Shots0, s.Shots1} {
		check(api, x)
	}
	if s.Kind == 1 {
		a.AssertEqual(c.Combat.Round, Z(0))
		api.AssertIsEqual(c.Combat.Report, 0)
		for i, v := range ReportInitial().values() {
			api.AssertIsEqual(b.values()[i], v)
		}
		out.Done = 1
	} else {
		api.AssertIsEqual(a.Less(Z(0), b.Round), 1)
		api.AssertIsEqual(a.Less(c.Combat.Round, b.Round), 0)
		api.AssertIsEqual(a.Less(b.Index, c.Prepared.N), 1)
		s.Unit.Verify(api, c.Combat.Memory, b.Index)
		u := s.Unit.Cell
		api.AssertIsBoolean(s.Alive)
		first := a.Equal(b.Index, Z(0))
		a.AssertEqual(a.Select(first, s.Shots0, b.Shots0), s.Shots0)
		a.AssertEqual(a.Select(first, s.Shots1, b.Shots1), s.Shots1)
		finalRound := a.Equal(b.Round, c.Combat.Round)
		api.AssertIsEqual(api.Mul(finalRound, api.Sub(s.Alive, api.Sub(1, a.Equal(u[6], Z(0))))), 0)
		v := append([]frontend.Variable{b.Scan}, fields(b.Round, b.Index, u[5], U{s.Alive, 0, 0, 0}, s.Shots0, s.Shots1)...)
		out.Scan = hc(api, 440404, v...)
		// Projection explicitly retains key and cohort; exact report positions remain
		// committed even for a cohort with zero survivors.
		row := hc(api, ReportRowDomain, append(fields(b.Round, b.Index, u[0], u[1], u[2], u[3], u[4], u[5], s.Shots0, s.Shots1), s.Alive)...)
		out.Output = hc(api, ReportOutputDomain, b.Output, row)
		next := a.AddChecked(b.Index, Z(1))
		last := a.Equal(next, c.Prepared.N)
		out.Index = a.Select(last, Z(0), next)
		out.Round = a.AddChecked(b.Round, U{last, 0, 0, 0})
		out.Shots0 = a.Select(last, Z(0), s.Shots0)
		out.Shots1 = a.Select(last, Z(0), s.Shots1)
		out.Done = api.Mul(last, finalRound)
		api.AssertIsEqual(api.Mul(out.Done, api.Sub(out.Scan, c.Combat.Report)), 0)
	}
	for i, v := range out.values() {
		api.AssertIsEqual(s.After.values()[i], v)
	}
	api.AssertIsEqual(s.Finished, out.Done)
	api.AssertIsEqual(s.Result, api.Mul(out.Done, hc(api, ReportResultDomain, s.ContextRoot, s.Input, s.CombatResult, out.Output)))
	return nil
}
func AssertReportLinked(api frontend.API, l, r ReportStatement) {
	for i := 0; i < 3; i++ {
		api.AssertIsEqual(l[i], r[i])
	}
	api.AssertIsEqual(l[4], r[3])
	api.AssertIsEqual(l[5], 0)
	api.AssertIsEqual(l[6], 0)
}
func AssertReportComplete(api frontend.API, first, last ReportStatement) {
	for i := 0; i < 3; i++ {
		api.AssertIsEqual(first[i], last[i])
	}
	api.AssertIsEqual(first[3], ReportInitial().Commitment())
	api.AssertIsEqual(last[5], 1)
}

// Use only after verifying complete bridge/report traces and all dependencies.
func AssertCombinedResult(api frontend.API, bridge Statement, report ReportStatement, result frontend.Variable) {
	api.AssertIsEqual(bridge[0], report[0])
	api.AssertIsEqual(bridge[2], report[1])
	api.AssertIsEqual(bridge[3], report[2])
	api.AssertIsEqual(bridge[6], 1)
	api.AssertIsEqual(report[5], 1)
	api.AssertIsEqual(result, hc(api, CompleteResultDomain, bridge[0], bridge[7], report[6]))
}
func (s *ReportStep) commit() {
	s.ContextRoot = s.Context.Commitment()
	s.Input = s.Context.Input()
	s.CombatResult = s.Context.CombatResult()
	s.BeforeRoot = s.Before.Commitment()
	s.AfterRoot = s.After.Commitment()
	s.Finished = s.After.Done
	s.Result = 0
	if scalar(s.Finished).Sign() != 0 {
		s.Result = Hash(ReportResultDomain, s.ContextRoot, s.Input, s.CombatResult, s.After.Output)
	}
}

// ReportRecord is witness advice, authenticated only by the constrained complete
// transcript fold. Callers normally extract it from actual memorybattle Scan.
type ReportRecord struct {
	Alive          frontend.Variable
	Shots0, Shots1 U
}

func ReportWitnesses(c Context, records []ReportRecord, open func(U) Opening) ([]*ReportStep, error) {
	b := ReportInitial()
	if number(c.Combat.Round).Sign() == 0 {
		if len(records) != 0 {
			return nil, fmt.Errorf("unexpected zero-round records")
		}
		w := &ReportStep{Context: c, Before: b, After: b, Unit: blankOpening(), Alive: 0, Shots0: Z(0), Shots1: Z(0), Kind: 1}
		w.After.Done = 1
		w.commit()
		return []*ReportStep{w}, nil
	}
	expected := new(big.Int).Mul(number(c.Prepared.N), number(c.Combat.Round))
	if expected.Cmp(new(big.Int).SetUint64(uint64(len(records)))) != 0 {
		return nil, fmt.Errorf("incomplete report advice")
	}
	ws := []*ReportStep{}
	for _, r := range records {
		w := &ReportStep{Context: c, Before: b, After: b, Unit: open(b.Index), Alive: r.Alive, Shots0: r.Shots0, Shots1: r.Shots1}
		out := b
		u := w.Unit.Cell
		out.Scan = Hash(440404, append([]frontend.Variable{b.Scan}, fields(b.Round, b.Index, u[5], U{r.Alive, 0, 0, 0}, r.Shots0, r.Shots1)...)...)
		row := Hash(ReportRowDomain, append(fields(b.Round, b.Index, u[0], u[1], u[2], u[3], u[4], u[5], r.Shots0, r.Shots1), r.Alive)...)
		out.Output = Hash(ReportOutputDomain, b.Output, row)
		out.Index = add(b.Index, 1)
		out.Shots0 = r.Shots0
		out.Shots1 = r.Shots1
		if number(out.Index).Cmp(number(c.Prepared.N)) == 0 {
			out.Index = Z(0)
			out.Round = add(b.Round, 1)
			out.Shots0 = Z(0)
			out.Shots1 = Z(0)
			if number(b.Round).Cmp(number(c.Combat.Round)) == 0 {
				out.Done = 1
			}
		}
		w.After = out
		w.commit()
		ws = append(ws, w)
		b = out
	}
	return ws, nil
}
