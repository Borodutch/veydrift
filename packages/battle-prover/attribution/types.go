package attribution

import (
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	native "github.com/consensys/gnark-crypto/ecc/bn254/fr/mimc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/hash/mimc"
	"math/big"
)

const (
	memberDomain  = 440601
	rosterDomain  = 440602
	unitsDomain   = 440603
	contextDomain = 440604
	stateDomain   = 440605
	outputDomain  = 440606
	resultDomain  = 440607
)
const (
	Collect = iota
	Units
	Floors
	Rank
	Done
)

type Member struct {
	Owner, Source Uint256
	Quantity      frontend.Variable
}

func (m Member) values() []frontend.Variable {
	v := append([]frontend.Variable{}, m.Owner[:]...)
	v = append(v, m.Source[:]...)
	return append(v, m.Quantity)
}

// Snapshot is an opaque bytes32 commitment to qualified chain/battle/body/rules
// data. Cohort+Side+Type+Stats describe this one cohort. NONE are chain-proven here.
type Context struct {
	Snapshot, Cohort     Uint256
	Side, Type           frontend.Variable
	Stats                [3]Uint256
	Members, Total, Loss Uint256
	Roster, Units        frontend.Variable
}

func (c Context) values() []frontend.Variable {
	v := append([]frontend.Variable{}, c.Snapshot[:]...)
	v = append(v, c.Cohort[:]...)
	v = append(v, c.Side, c.Type)
	for _, x := range c.Stats {
		v = append(v, x[:]...)
	}
	for _, x := range []Uint256{c.Members, c.Total, c.Loss} {
		v = append(v, x[:]...)
	}
	return append(v, c.Roster, c.Units)
}

// Every cursor and aggregate is uint256. Hashes are BN254 field elements.
type State struct {
	Phase                                                             frontend.Variable
	Index, Outer, Sum, FloorSum, Rank, LostSum, PrevOwner, PrevSource Uint256
	Scan, OuterScan, Output, Active                                   frontend.Variable
}

func zeroState() State {
	return State{0, U(0), U(0), U(0), U(0), U(0), U(0), U(0), U(0), 0, 0, 0, 0}
}
func (s State) values() []frontend.Variable {
	v := []frontend.Variable{s.Phase}
	for _, x := range []Uint256{s.Index, s.Outer, s.Sum, s.FloorSum, s.Rank, s.LostSum, s.PrevOwner, s.PrevSource} {
		v = append(v, x[:]...)
	}
	return append(v, s.Scan, s.OuterScan, s.Output, s.Active)
}
func hash(domain int, v ...frontend.Variable) *big.Int {
	h := native.NewFieldHasher()
	for _, x := range append([]frontend.Variable{domain, len(v)}, v...) {
		var e fr.Element
		e.SetBigInt(integer(x))
		h.WriteElement(e)
	}
	e := h.SumElement()
	return e.BigInt(new(big.Int))
}
func hc(api frontend.API, domain int, v ...frontend.Variable) frontend.Variable {
	h, e := mimc.NewMiMC(api)
	if e != nil {
		panic(e)
	}
	h.Write(domain, len(v))
	h.Write(v...)
	return h.Sum()
}
func (c Context) Commitment() *big.Int { return hash(contextDomain, c.values()...) }
func (s State) Commitment() *big.Int   { return hash(stateDomain, s.values()...) }
func memberHash(m Member) *big.Int     { return hash(memberDomain, m.values()...) }
func chain(domain int, root frontend.Variable, index Uint256, leaf frontend.Variable) *big.Int {
	v := append([]frontend.Variable{root}, index[:]...)
	return hash(domain, append(v, leaf)...)
}
func chainC(api frontend.API, domain int, root frontend.Variable, index Uint256, leaf frontend.Variable) frontend.Variable {
	v := append([]frontend.Variable{root}, index[:]...)
	return hc(api, domain, append(v, leaf)...)
}
func (m Member) valid(api frontend.API) {
	for _, v := range m.Owner {
		api.ToBinary(v, 64)
	}
	api.ToBinary(m.Owner[2], 32)
	api.AssertIsEqual(m.Owner[3], 0)
	for _, v := range m.Source {
		api.ToBinary(v, 64)
	}
	api.ToBinary(m.Quantity, 32)
	api.AssertIsDifferent(m.Quantity, 0)
}
func order(a *arithmetic, x, y Member) frontend.Variable {
	return a.api.Or(a.Less(x.Owner, y.Owner), a.api.And(a.Equal(x.Owner, y.Owner), a.Less(x.Source, y.Source)))
}

// Stable public statement: Context, Before, After, done, Result. Monotone phase
// and lexicographic (outer,index) cursors prevent replay without a global step cap.
type Statement [5]frontend.Variable

func AssertLinked(api frontend.API, l, r Statement) {
	api.AssertIsEqual(l[0], r[0])
	api.AssertIsEqual(l[2], r[1])
	api.AssertIsEqual(l[3], 0)
	api.AssertIsEqual(l[4], 0)
}

// Only use with VERIFIED elementary statements and every adjacency authenticated.
func AssertComplete(api frontend.API, first, last Statement) {
	api.AssertIsEqual(first[0], last[0])
	api.AssertIsEqual(first[1], zeroState().Commitment())
	api.AssertIsEqual(last[3], 1)
}
