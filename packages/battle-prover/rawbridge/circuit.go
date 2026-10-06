package rawbridge

import (
	"fmt"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/frontend"
)

type Step struct {
	Binding, BeforeHash, AfterHash, Result, KindPublic frontend.Variable `gnark:",public"`
	Meta                                               Metadata
	Before, After                                      State
	Header                                             Header
	Mission                                            Mission
	SourceID                                           U
	Row                                                prep.Row
	OldTech                                            frontend.Variable
	Paths                                              []prep.Path
	Kind                                               int `gnark:"-"`
}
type Statement [5]frontend.Variable

func (s *Step) Statement() Statement {
	return Statement{s.Binding, s.BeforeHash, s.AfterHash, s.Result, s.KindPublic}
}
func Shape(kind int) *Step {
	if kind < Begin || kind > Seal {
		panic("kind")
	}
	n := 0
	if kind == Source {
		n = 1
	}
	if kind == Row {
		n = 2
	}
	return &Step{Kind: kind, Paths: make([]prep.Path, n)}
}
func (s *Step) Define(api frontend.API) error {
	if s.Kind < Begin || s.Kind > Seal || len(s.Paths) != len(Shape(s.Kind).Paths) {
		return fmt.Errorf("shape")
	}
	a := p.New(api)
	validateMeta(api, s.Meta)
	validateState(api, s.Before)
	validateState(api, s.After)
	api.AssertIsEqual(s.KindPublic, s.Kind)
	api.AssertIsEqual(s.Binding, Binding(api, s.Meta))
	api.AssertIsEqual(s.BeforeHash, Hash(api, StateDomain, s.Before.values()...))
	api.AssertIsEqual(s.AfterHash, Hash(api, StateDomain, s.After.values()...))
	b := s.Before
	o := b
	api.AssertIsEqual(b.Done, 0)
	if s.Kind != Seal {
		api.AssertIsEqual(s.Result, 0)
	}
	if s.Kind != Begin {
		api.AssertIsEqual(b.Started, 1)
	}
	switch s.Kind {
	case Begin:
		z := Initial()
		for i, v := range z.values() {
			api.AssertIsEqual(b.values()[i], v)
		}
		widths := []int{256, 1, 64, 1, 64, 160, 1, 256, 256, 128, 128, 128, 128, 128, 128, 16}
		for i, w := range s.Header {
			Narrow(api, w, widths[i])
		}
		id := s.Meta.Preparation.Identity
		a.AssertEqual(s.Header[0], id.Body)
		a.AssertEqual(s.Header[1], U{id.TargetIsMoon, 0, 0, 0})
		a.AssertEqual(s.Header[2], id.Incarnation)
		a.AssertEqual(s.Header[4], id.Impact)
		a.AssertEqual(s.Header[6], p.Const(0))
		// Recorded generation is mandatory for moon snapshots; no planet alias.
		api.AssertIsEqual(api.Mul(id.TargetIsMoon, api.Sub(1, s.Header[3][0])), 0)
		o.Started = 1
		o.Owner = s.Header[5]
		o.Journal = Keccak(api, HeaderWords(s.Meta, s.Header)...)
	case Source:
		api.AssertIsEqual(b.Remaining, 0)
		Narrow(api, s.SourceID, 256)
		api.AssertIsEqual(a.Equal(s.SourceID, p.Const(0)), 0)
		s.Paths[0].Verify(api, b.Sources, s.SourceID, 0)
		s.Paths[0].Verify(api, s.After.Sources, s.SourceID, 1)
		o.Sources = s.After.Sources
		widths := []int{8, 8, 160, 256, 256, 64, 64, 64, 128, 128, 128, 128, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 256, 16, 16, 16, 1, 1}
		for i, w := range s.Mission {
			Narrow(api, w, widths[i])
		}
		api.AssertIsLessOrEqual(s.Mission[0][0], 5)
		api.AssertIsLessOrEqual(s.Mission[1][0], 9)
		o.Journal = Keccak(api, SourceWords(b.Journal, s.SourceID, s.Mission)...)
		o.SourceID = s.SourceID
		o.Owner = s.Mission[2]
		o.LastType = 0
		o.Remaining = 0
		// MissionShips omits satellite9 and crawler15. Source rows must consume
		// every positive lane exactly once; absent lanes cannot be manufactured.
		j := 12
		for typ := 0; typ < 16; typ++ {
			o.Counts[typ] = 0
			if typ != 9 && typ != 15 {
				o.Counts[typ] = s.Mission[j][0]
				j++
			}
			o.Remaining = api.Add(o.Remaining, o.Counts[typ])
		}
		// Authenticated journal determines eligibility; type selects attack/defense side.
		attack := api.Or(api.IsZero(api.Sub(s.Mission[1][0], 3)), api.IsZero(api.Sub(s.Mission[1][0], 8)))
		o.Side = api.Sub(1, attack)
	case Row:
		r := s.Row
		Narrow(api, r.Source, 256)
		Narrow(api, r.Owner, 160)
		Narrow(api, r.Count, 32)
		api.AssertIsDifferent(r.Count[0], 0)
		api.AssertIsBoolean(r.Side)
		api.ToBinary(r.Type, 5)
		api.AssertIsLessOrEqual(r.Type, 23)
		for _, v := range []frontend.Variable{r.Tech.Weapons, r.Tech.Shielding, r.Tech.Armor} {
			api.ToBinary(v, 16)
		}
		a.AssertEqual(r.Source, b.SourceID)
		a.AssertEqual(r.Owner, b.Owner)
		api.AssertIsEqual(r.Side, b.Side)
		api.AssertIsLessOrEqual(b.LastType, r.Type)
		o.LastType = api.Add(r.Type, 1)
		resident := a.Equal(b.SourceID, p.Const(0))
		var count frontend.Variable = 0
		for typ, v := range b.Counts {
			count = api.Add(count, api.Mul(api.IsZero(api.Sub(r.Type, typ)), v))
		}
		api.AssertIsEqual(api.Mul(api.Sub(1, resident), api.Sub(r.Count[0], count)), 0)
		o.Remaining = api.Sub(b.Remaining, api.Mul(api.Sub(1, resident), r.Count[0]))
		leaf := Hash(api, prep.RawDomain, r.Values()...)
		s.Paths[0].Verify(api, b.Raw, b.Rows, 0)
		s.Paths[0].Verify(api, s.After.Raw, b.Rows, leaf)
		o.Raw = s.After.Raw
		tech := Hash(api, prep.TechDomain, append(fields(r.Owner), r.Tech.Weapons, r.Tech.Shielding, r.Tech.Armor)...)
		api.AssertIsEqual(api.Mul(s.OldTech, api.Sub(s.OldTech, tech)), 0)
		s.Paths[1].Verify(api, b.Tech, r.Owner, s.OldTech)
		s.Paths[1].Verify(api, s.After.Tech, r.Owner, tech)
		o.Tech = s.After.Tech
		o.Journal = Keccak(api, RowWords(b.Journal, b.Rows, r)...)
		o.Rows = a.AddChecked(b.Rows, p.Const(1))
	case Seal:
		api.AssertIsEqual(b.Remaining, 0)
		api.AssertIsEqual(b.Raw, s.Meta.Preparation.Raw)
		api.AssertIsEqual(b.Tech, s.Meta.Preparation.Tech)
		a.AssertEqual(b.Rows, s.Meta.Preparation.Rows)
		o.Journal = Keccak(api, b.Journal, p.Const(3), b.Rows)
		o.Done = 1
		api.AssertIsEqual(s.Result, Result(api, s.Binding, o.Journal))
	}
	for i, v := range o.values() {
		api.AssertIsEqual(s.After.values()[i], v)
	}
	return nil
}
func AssertLinked(api frontend.API, l, r Statement) {
	api.AssertIsEqual(l[0], r[0])
	api.AssertIsEqual(l[2], r[1])
	api.AssertIsEqual(l[3], 0)
}
func AssertComplete(api frontend.API, first, last Statement) {
	api.AssertIsEqual(first[0], last[0])
	api.AssertIsEqual(first[1], Initial().Commitment())
	api.AssertIsEqual(first[4], Begin)
	api.AssertIsEqual(last[4], Seal)
	api.AssertIsDifferent(last[3], 0)
}

// Verified terminal relation is the only permitted link to a chain snapshot.
func AssertSealed(api frontend.API, terminal Statement, meta Metadata, snapshot U) {
	api.AssertIsEqual(terminal[4], Seal)
	api.AssertIsEqual(terminal[0], Binding(api, meta))
	api.AssertIsEqual(terminal[3], Result(api, terminal[0], snapshot))
	Narrow(api, snapshot, 256)
}
