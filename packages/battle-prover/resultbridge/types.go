// Package resultbridge constrains complete final-memory to cohort-attribution
// projection. Elementary statements still require verified proof composition.
package resultbridge

import (
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	native "github.com/consensys/gnark-crypto/ecc/bn254/fr/mimc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/hash/mimc"
	"math/big"
)

const (
	ContextDomain = 440701
	StateDomain   = 440702
	CohortDomain  = 440703
	OutputDomain  = 440707
	ResultDomain  = 440708
)
const (
	Begin = iota
	Members
	Units
	Close
	Finish
	Done
)

type U = p.Uint256

var Z = p.Const

func scalar(v frontend.Variable) *big.Int {
	switch x := v.(type) {
	case int:
		return big.NewInt(int64(x))
	case uint64:
		return new(big.Int).SetUint64(x)
	case uint32:
		return new(big.Int).SetUint64(uint64(x))
	case *big.Int:
		return new(big.Int).Set(x)
	default:
		panic("invalid scalar")
	}
}
func number(x U) *big.Int {
	n := new(big.Int)
	for i := 3; i >= 0; i-- {
		n.Lsh(n, 64)
		n.Add(n, scalar(x[i]))
	}
	return n
}
func fields(xs ...U) []frontend.Variable {
	v := []frontend.Variable{}
	for _, x := range xs {
		v = append(v, x[:]...)
	}
	return v
}
func raw(v ...frontend.Variable) *big.Int {
	h := native.NewFieldHasher()
	for _, x := range v {
		var e fr.Element
		e.SetBigInt(scalar(x))
		h.WriteElement(e)
	}
	e := h.SumElement()
	return e.BigInt(new(big.Int))
}
func Hash(d int, v ...frontend.Variable) *big.Int {
	return raw(append([]frontend.Variable{d, len(v)}, v...)...)
}
func hc(api frontend.API, d int, v ...frontend.Variable) frontend.Variable {
	h, _ := mimc.NewMiMC(api)
	h.Write(d, len(v))
	h.Write(v...)
	return h.Sum()
}
func stream(d int, r frontend.Variable, i U, leaf frontend.Variable) *big.Int {
	return Hash(d, append(append([]frontend.Variable{r}, i[:]...), leaf)...)
}
func sc(api frontend.API, d int, r frontend.Variable, i U, leaf frontend.Variable) frontend.Variable {
	return hc(api, d, append(append([]frontend.Variable{r}, i[:]...), leaf)...)
}
func check(api frontend.API, x U) {
	for _, v := range x {
		api.ToBinary(v, 64)
	}
}

// Prepared roots commit ALL canonical positive member/cohort rows. Their
// producer must be authenticated; a supplied root is not a preparation proof.
type Prepared struct {
	PreparationContext     frontend.Variable
	Snapshot               U
	Roster, RF             frontend.Variable
	N, Cohorts, Members    U
	CohortRoot, MemberRoot frontend.Variable
}

func (c Prepared) values() []frontend.Variable {
	v := append([]frontend.Variable{c.PreparationContext}, fields(c.Snapshot)...)
	v = append(v, c.Roster, c.RF)
	v = append(v, fields(c.N, c.Cohorts, c.Members)...)
	return append(v, c.CohortRoot, c.MemberRoot)
}

type Combat struct {
	Seed                           [32]frontend.Variable
	Memory, Report                 frontend.Variable
	Round, Count0, Count1, Outcome U
}

// Context opens full-width memorybattle Input and terminal Result exactly.
type Context struct {
	Prepared Prepared
	Combat   Combat
}

func (c Context) values() []frontend.Variable {
	v := c.Prepared.values()
	v = append(v, c.Combat.Seed[:]...)
	v = append(v, c.Combat.Memory, c.Combat.Report)
	return append(v, fields(c.Combat.Round, c.Combat.Count0, c.Combat.Count1, c.Combat.Outcome)...)
}
func (c Context) Commitment() *big.Int { return Hash(ContextDomain, c.values()...) }
func (c Prepared) ResultValues() []frontend.Variable {
	return append([]frontend.Variable{c.PreparationContext, c.MemberRoot, c.CohortRoot, c.Roster}, c.N[:]...)
}
func (c Prepared) Commitment() *big.Int { return prep.Hash(prep.ResultDomain, c.ResultValues()...) }
func (c Context) InputValues() []frontend.Variable {
	v := []frontend.Variable{c.Prepared.Roster, c.Prepared.RF}
	v = append(v, c.Prepared.N[:]...)
	v = append(v, 3)
	v = append(v, c.Combat.Seed[:]...)
	return append(v, c.Prepared.Snapshot[:]...)
}
func (c Context) Input() *big.Int { return Hash(440403, c.InputValues()...) }
func (c Context) ResultValues(input frontend.Variable) []frontend.Variable {
	v := []frontend.Variable{input, c.Combat.Memory, c.Combat.Report}
	return append(v, fields(c.Combat.Round, c.Combat.Count0, c.Combat.Count1, c.Combat.Outcome)...)
}
func (c Context) CombatResult() *big.Int { return Hash(440405, c.ResultValues(c.Input())...) }

type Cohort struct {
	ID             U
	Key            p.Key
	Members, Total U
}

func (c Cohort) values() []frontend.Variable {
	v := fields(c.ID)
	v = append(v, c.Key.Side, c.Key.Type)
	return append(v, fields(c.Key.Stats.Attack, c.Key.Stats.Shield, c.Key.Stats.Hull, c.Members, c.Total)...)
}
func (c Cohort) Hash() *big.Int { return Hash(CohortDomain, c.values()...) }

type Member struct {
	Owner, Source U
	Quantity      frontend.Variable
	Tech          p.Technology
}

func (m Member) Row(k p.Key) prep.Row {
	return prep.Row{Owner: m.Owner, Source: m.Source, Count: U{m.Quantity, 0, 0, 0}, Side: k.Side, Type: k.Type, Tech: m.Tech}
}
func (m Member) values() []frontend.Variable { return append(fields(m.Owner, m.Source), m.Quantity) }

type State struct {
	Phase                                                          frontend.Variable
	Cohort, Member, Unit, Local, Sum, Loss, Survivors0, Survivors1 U
	Active, CohortScan, MemberScan, Roster, Dead, Output           frontend.Variable
}

func Zero() State {
	return State{Begin, Z(0), Z(0), Z(0), Z(0), Z(0), Z(0), Z(0), Z(0), 0, 0, 0, 0, 0, 0}
}
func (s State) values() []frontend.Variable {
	v := []frontend.Variable{s.Phase}
	v = append(v, fields(s.Cohort, s.Member, s.Unit, s.Local, s.Sum, s.Loss, s.Survivors0, s.Survivors1)...)
	return append(v, s.Active, s.CohortScan, s.MemberScan, s.Roster, s.Dead, s.Output)
}
func (s State) Commitment() *big.Int { return Hash(StateDomain, s.values()...) }

// Cell matches memorybattle LAYOUT.md: nine full-width values, depth258.
type Cell [9]U
type Opening struct {
	Cell     Cell
	Siblings [258]frontend.Variable
}

func (o Opening) Verify(api frontend.API, root frontend.Variable, index U) {
	v := []frontend.Variable{}
	for _, x := range o.Cell {
		check(api, x)
		v = append(v, x[:]...)
	}
	h, _ := mimc.NewMiMC(api)
	h.Write(hc(api, 440401, v...))
	r := h.Sum()
	bits := []frontend.Variable{}
	for _, x := range index {
		bits = append(bits, api.ToBinary(x, 64)...)
	}
	bits = append(bits, 0, 0)
	for i, b := range bits {
		h.Reset()
		h.Write(api.Select(b, o.Siblings[i], r), api.Select(b, r, o.Siblings[i]))
		r = h.Sum()
	}
	api.AssertIsEqual(r, root)
}
