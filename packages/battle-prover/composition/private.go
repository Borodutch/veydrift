// Private wrappers delegate constraints to existing protocol circuits.
package composition

import (
	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark/frontend"
)

type prepStep struct {
	ContextHash, BeforeHash, AfterHash, Result frontend.Variable
	C                                          prep.Context
	Before, After                              prep.State
	Row, Other                                 prep.Row
	Index                                      p.Uint256
	Effective                                  p.Stats
	Base                                       p.Stats
	Remainders                                 [3]frontend.Variable
	Paths                                      []prep.Path
	UnitPath                                   prep.UnitPath
	Kind                                       int `gnark:"-"`
}

func (s prepStep) native() *prep.Step {
	return &prep.Step{ContextHash: s.ContextHash, BeforeHash: s.BeforeHash, AfterHash: s.AfterHash, Result: s.Result, C: s.C, Before: s.Before, After: s.After, Row: s.Row, Other: s.Other, Index: s.Index, Effective: s.Effective, Base: s.Base, Remainders: s.Remainders, Paths: s.Paths, UnitPath: s.UnitPath, Kind: s.Kind}
}
func (s prepStep) Define(api frontend.API) error { return s.native().Define(api) }
func (s prepStep) Statement() prep.Statement     { return s.native().Statement() }
func privateprepStep(s *prep.Step) prepStep {
	return prepStep{ContextHash: s.ContextHash, BeforeHash: s.BeforeHash, AfterHash: s.AfterHash, Result: s.Result, C: s.C, Before: s.Before, After: s.After, Row: s.Row, Other: s.Other, Index: s.Index, Effective: s.Effective, Base: s.Base, Remainders: s.Remainders, Paths: s.Paths, UnitPath: s.UnitPath, Kind: s.Kind}
}

type combatStep struct {
	Input, BeforeRoot, AfterRoot, Start, End, BeforeDone, AfterDone, Result frontend.Variable
	Roster, RF                                                              frontend.Variable
	N                                                                       mb.U
	Seed                                                                    [32]frontend.Variable
	Snapshot                                                                [4]frontend.Variable
	Before, After                                                           [mb.StateSize]mb.U
	BeforeMemory, AfterMemory, BeforeReport, AfterReport                    frontend.Variable
	Sample                                                                  p.SampleCircuit
	Openings                                                                []mb.Opening
	Kind                                                                    int `gnark:"-"`
}

func (s combatStep) native() *mb.Step {
	return &mb.Step{Input: s.Input, BeforeRoot: s.BeforeRoot, AfterRoot: s.AfterRoot, Start: s.Start, End: s.End, BeforeDone: s.BeforeDone, AfterDone: s.AfterDone, Result: s.Result, Roster: s.Roster, RF: s.RF, N: s.N, Seed: s.Seed, Snapshot: s.Snapshot, Before: s.Before, After: s.After, BeforeMemory: s.BeforeMemory, AfterMemory: s.AfterMemory, BeforeReport: s.BeforeReport, AfterReport: s.AfterReport, Sample: s.Sample, Openings: s.Openings, Kind: s.Kind}
}
func (s combatStep) Define(api frontend.API) error { return s.native().Define(api) }
func (s combatStep) Statement() mb.Statement       { return s.native().Statement() }
func privatecombatStep(s *mb.Step) combatStep {
	return combatStep{Input: s.Input, BeforeRoot: s.BeforeRoot, AfterRoot: s.AfterRoot, Start: s.Start, End: s.End, BeforeDone: s.BeforeDone, AfterDone: s.AfterDone, Result: s.Result, Roster: s.Roster, RF: s.RF, N: s.N, Seed: s.Seed, Snapshot: s.Snapshot, Before: s.Before, After: s.After, BeforeMemory: s.BeforeMemory, AfterMemory: s.AfterMemory, BeforeReport: s.BeforeReport, AfterReport: s.AfterReport, Sample: s.Sample, Openings: s.Openings, Kind: s.Kind}
}

type attrStep struct {
	ContextRoot, BeforeRoot, AfterRoot, Finished, Result frontend.Variable
	Context                                              attr.Context
	Before, After                                        attr.State
	Member, Target                                       attr.Member
	Dead, Quotient, TargetQuotient                       frontend.Variable
	Remainder, TargetRemainder                           attr.Uint256
	Kind                                                 int `gnark:"-"`
}

func (s attrStep) native() *attr.Step {
	return &attr.Step{ContextRoot: s.ContextRoot, BeforeRoot: s.BeforeRoot, AfterRoot: s.AfterRoot, Finished: s.Finished, Result: s.Result, Context: s.Context, Before: s.Before, After: s.After, Member: s.Member, Target: s.Target, Dead: s.Dead, Quotient: s.Quotient, TargetQuotient: s.TargetQuotient, Remainder: s.Remainder, TargetRemainder: s.TargetRemainder, Kind: s.Kind}
}
func (s attrStep) Define(api frontend.API) error { return s.native().Define(api) }
func (s attrStep) Statement() attr.Statement     { return s.native().Statement() }
func privateattrStep(s *attr.Step) attrStep {
	return attrStep{ContextRoot: s.ContextRoot, BeforeRoot: s.BeforeRoot, AfterRoot: s.AfterRoot, Finished: s.Finished, Result: s.Result, Context: s.Context, Before: s.Before, After: s.After, Member: s.Member, Target: s.Target, Dead: s.Dead, Quotient: s.Quotient, TargetQuotient: s.TargetQuotient, Remainder: s.Remainder, TargetRemainder: s.TargetRemainder, Kind: s.Kind}
}

type bridgeStep struct {
	ContextRoot, PreparedRoot, Input, CombatResult, BeforeRoot, AfterRoot, Finished, Result, AttributionContext, AttributionResult frontend.Variable
	Context                                                                                                                        rb.Context
	Before, After                                                                                                                  rb.State
	Cohort                                                                                                                         rb.Cohort
	Member                                                                                                                         rb.Member
	Unit                                                                                                                           rb.Opening
	AttributionOutput                                                                                                              frontend.Variable
	Kind                                                                                                                           int `gnark:"-"`
}

func (s bridgeStep) native() *rb.Step {
	return &rb.Step{ContextRoot: s.ContextRoot, PreparedRoot: s.PreparedRoot, Input: s.Input, CombatResult: s.CombatResult, BeforeRoot: s.BeforeRoot, AfterRoot: s.AfterRoot, Finished: s.Finished, Result: s.Result, AttributionContext: s.AttributionContext, AttributionResult: s.AttributionResult, Context: s.Context, Before: s.Before, After: s.After, Cohort: s.Cohort, Member: s.Member, Unit: s.Unit, AttributionOutput: s.AttributionOutput, Kind: s.Kind}
}
func (s bridgeStep) Define(api frontend.API) error { return s.native().Define(api) }
func (s bridgeStep) Statement() rb.Statement       { return s.native().Statement() }
func privatebridgeStep(s *rb.Step) bridgeStep {
	return bridgeStep{ContextRoot: s.ContextRoot, PreparedRoot: s.PreparedRoot, Input: s.Input, CombatResult: s.CombatResult, BeforeRoot: s.BeforeRoot, AfterRoot: s.AfterRoot, Finished: s.Finished, Result: s.Result, AttributionContext: s.AttributionContext, AttributionResult: s.AttributionResult, Context: s.Context, Before: s.Before, After: s.After, Cohort: s.Cohort, Member: s.Member, Unit: s.Unit, AttributionOutput: s.AttributionOutput, Kind: s.Kind}
}

type reportStep struct {
	ContextRoot, Input, CombatResult, BeforeRoot, AfterRoot, Finished, Result frontend.Variable
	Context                                                                   rb.Context
	Before, After                                                             rb.ReportState
	Unit                                                                      rb.Opening
	Alive                                                                     frontend.Variable
	Shots0, Shots1                                                            rb.U
	Kind                                                                      int `gnark:"-"`
}

func (s reportStep) native() *rb.ReportStep {
	return &rb.ReportStep{ContextRoot: s.ContextRoot, Input: s.Input, CombatResult: s.CombatResult, BeforeRoot: s.BeforeRoot, AfterRoot: s.AfterRoot, Finished: s.Finished, Result: s.Result, Context: s.Context, Before: s.Before, After: s.After, Unit: s.Unit, Alive: s.Alive, Shots0: s.Shots0, Shots1: s.Shots1, Kind: s.Kind}
}
func (s reportStep) Define(api frontend.API) error { return s.native().Define(api) }
func (s reportStep) Statement() rb.ReportStatement { return s.native().Statement() }
func privatereportStep(s *rb.ReportStep) reportStep {
	return reportStep{ContextRoot: s.ContextRoot, Input: s.Input, CombatResult: s.CombatResult, BeforeRoot: s.BeforeRoot, AfterRoot: s.AfterRoot, Finished: s.Finished, Result: s.Result, Context: s.Context, Before: s.Before, After: s.After, Unit: s.Unit, Alive: s.Alive, Shots0: s.Shots0, Shots1: s.Shots1, Kind: s.Kind}
}
