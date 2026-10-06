package composition

import (
	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	out "github.com/Borodutch/veydrift/packages/battle-prover/outputbridge"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/consensys/gnark/frontend"
)

type rawStep struct {
	Binding, BeforeHash, AfterHash, Result, KindPublic frontend.Variable
	Meta                                               raw.Metadata
	Before, After                                      raw.State
	Header                                             raw.Header
	Mission                                            raw.Mission
	SourceID                                           raw.U
	Row                                                prep.Row
	OldTech                                            frontend.Variable
	Paths                                              []prep.Path
	Kind                                               int `gnark:"-"`
}

func (s rawStep) native() *raw.Step {
	return &raw.Step{Binding: s.Binding, BeforeHash: s.BeforeHash, AfterHash: s.AfterHash, Result: s.Result, KindPublic: s.KindPublic, Meta: s.Meta, Before: s.Before, After: s.After, Header: s.Header, Mission: s.Mission, SourceID: s.SourceID, Row: s.Row, OldTech: s.OldTech, Paths: s.Paths, Kind: s.Kind}
}
func (s rawStep) Define(api frontend.API) error { return s.native().Define(api) }
func (s rawStep) Statement() raw.Statement      { return s.native().Statement() }
func privateRaw(s *raw.Step) rawStep {
	return rawStep{s.Binding, s.BeforeHash, s.AfterHash, s.Result, s.KindPublic, s.Meta, s.Before, s.After, s.Header, s.Mission, s.SourceID, s.Row, s.OldTech, s.Paths, s.Kind}
}

type outputStep struct {
	Binding, BeforeHash, AfterHash, Finished, Result frontend.Variable
	Manifest                                         out.Manifest
	Before, After                                    out.State
	Allocation                                       attr.Context
	Leaf                                             out.Leaf
	Kind                                             int `gnark:"-"`
}

func (s outputStep) native() *out.Step {
	return &out.Step{Binding: s.Binding, BeforeHash: s.BeforeHash, AfterHash: s.AfterHash, Finished: s.Finished, Result: s.Result, Manifest: s.Manifest, Before: s.Before, After: s.After, Allocation: s.Allocation, Leaf: s.Leaf, Kind: s.Kind}
}
func (s outputStep) Define(api frontend.API) error { return s.native().Define(api) }
func (s outputStep) Statement() out.Statement      { return s.native().Statement() }
func privateOutput(s *out.Step) outputStep {
	return outputStep{s.Binding, s.BeforeHash, s.AfterHash, s.Finished, s.Result, s.Manifest, s.Before, s.After, s.Allocation, s.Leaf, s.Kind}
}
