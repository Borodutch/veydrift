// Package outputbridge converts authenticated MiMC allocation streams to a
// full-width Keccak suffix chain. Elementary witnesses are not proof receipts.
package outputbridge

import (
	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark/frontend"
	"math/big"
)

const (
	BindingDomain = 441201
	StateDomain   = 441202
	ResultDomain  = 441203
)
const (
	Begin = iota
	Open
	Member
	Close
	Finish
	Done
)
const LeafDomain = "veydrift.proof-battle.output-leaf.v1"
const TailDomain = "veydrift.proof-battle.output-tail.v1"

type U = p.Uint256

var Z = p.Const

func fields(ws ...U) []frontend.Variable {
	var v []frontend.Variable
	for _, w := range ws {
		v = append(v, w[:]...)
	}
	return v
}
func scalar(x frontend.Variable) *big.Int {
	switch v := x.(type) {
	case int:
		return big.NewInt(int64(v))
	case uint64:
		return new(big.Int).SetUint64(v)
	case uint32:
		return new(big.Int).SetUint64(uint64(v))
	case *big.Int:
		return new(big.Int).Set(v)
	default:
		panic("unsupported scalar")
	}
}
func number(w U) *big.Int {
	var n big.Int
	for i := 3; i >= 0; i-- {
		v := scalar(w[i])
		if v.Sign() < 0 || v.BitLen() > 64 {
			panic("noncanonical uint64 limb")
		}
		n.Lsh(&n, 64)
		n.Add(&n, v)
	}
	return &n
}
func word(v frontend.Variable) U     { return U{v, 0, 0, 0} }
func inc(w U) U                      { return p.MustValue(new(big.Int).Add(number(w), big.NewInt(1))) }
func add(w U, v frontend.Variable) U { return p.MustValue(new(big.Int).Add(number(w), scalar(v))) }
func contextValues(c rb.Context) []frontend.Variable {
	x := c.Prepared
	v := append([]frontend.Variable{x.PreparationContext}, fields(x.Snapshot)...)
	v = append(v, x.Roster, x.RF)
	v = append(v, fields(x.N, x.Cohorts, x.Members)...)
	v = append(v, x.CohortRoot, x.MemberRoot)
	v = append(v, c.Combat.Seed[:]...)
	v = append(v, c.Combat.Memory, c.Combat.Report)
	return append(v, fields(c.Combat.Round, c.Combat.Count0, c.Combat.Count1, c.Combat.Outcome)...)
}
func allocationValues(c attr.Context) []frontend.Variable {
	v := fields(c.Snapshot, c.Cohort)
	v = append(v, c.Side, c.Type)
	v = append(v, fields(c.Stats[:]...)...)
	v = append(v, fields(c.Members, c.Total, c.Loss)...)
	return append(v, c.Roster, c.Units)
}
func memberValues(m attr.Member) []frontend.Variable {
	return append(fields(m.Owner, m.Source), m.Quantity)
}
func streamValues(root frontend.Variable, index U, leaf frontend.Variable) []frontend.Variable {
	return append(append([]frontend.Variable{root}, index[:]...), leaf)
}

type Manifest struct {
	Context           rb.Context
	Pipeline          [8]frontend.Variable
	RawResult         frontend.Variable
	ChainRecord, Root U
}

func (m Manifest) Values() []frontend.Variable {
	v := contextValues(m.Context)
	v = append(v, m.Pipeline[:]...)
	v = append(v, m.RawResult)
	return append(v, fields(m.ChainRecord, m.Root)...)
}
func (m Manifest) Commitment() *big.Int { return prep.Hash(BindingDomain, m.Values()...) }

type State struct {
	Phase                                                                                 frontend.Variable
	Cohort, Index, Local, Sum, Loss, Total, Survivors0, Survivors1, PrevOwner, PrevSource U
	Expected                                                                              U
	Active, Roster, Allocation, Output                                                    frontend.Variable
}

func Initial() State {
	return State{Phase: Begin, Cohort: Z(0), Index: Z(0), Local: Z(0), Sum: Z(0), Loss: Z(0), Total: Z(0), Survivors0: Z(0), Survivors1: Z(0), PrevOwner: Z(0), PrevSource: Z(0), Expected: Z(0), Active: 0, Roster: 0, Allocation: 0, Output: 0}
}
func (s State) Values() []frontend.Variable {
	return append(append([]frontend.Variable{s.Phase}, fields(s.Cohort, s.Index, s.Local, s.Sum, s.Loss, s.Total, s.Survivors0, s.Survivors1, s.PrevOwner, s.PrevSource, s.Expected)...), s.Active, s.Roster, s.Allocation, s.Output)
}
func (s State) Commitment() *big.Int { return prep.Hash(StateDomain, s.Values()...) }

type Leaf struct {
	Index, Cohort, Owner, Source       U
	Side, Unit, Count, Lost, Survivors frontend.Variable
	Next                               U
}

func (l Leaf) Words(binding U) []U {
	return []U{raw.Domain(LeafDomain), binding, l.Index, l.Cohort, l.Owner, l.Source, word(l.Side), word(l.Unit), word(l.Count), word(l.Lost), word(l.Survivors), l.Next}
}
func (l Leaf) Digest(binding U) U {
	words := l.Words(binding)
	for i, w := range words {
		words[i] = p.MustValue(number(w))
	}
	return raw.Digest(words...)
}
func Tail(binding, count U) U { return raw.Digest(raw.Domain(TailDomain), binding, count) }
func (m Manifest) Settlement() Settlement {
	var out Settlement
	copy(out[0:4], m.ChainRecord[:])
	copy(out[4:8], m.Root[:])
	copy(out[8:12], m.Context.Prepared.Members[:])
	out[12] = m.Context.Combat.Round[0]
	copy(out[13:17], m.Context.Combat.Count0[:])
	copy(out[17:21], m.Context.Combat.Count1[:])
	out[21] = m.Context.Combat.Outcome[0]
	return out
}

type Settlement [22]frontend.Variable
