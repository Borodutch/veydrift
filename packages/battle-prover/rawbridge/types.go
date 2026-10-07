package rawbridge

import (
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/hash/mimc"
	"github.com/consensys/gnark/std/hash/sha3"
	"github.com/consensys/gnark/std/math/uints"
	native "golang.org/x/crypto/sha3"
	"math/big"
)

const (
	Begin = iota
	Source
	Row
	Seal
)
const (
	BindingDomain = 441001
	StateDomain   = 441002
	ResultDomain  = 441003
)
const RawDomain = "veydrift.qualified-raw-battle.v1"

type U = p.Uint256
type Header [16]U
type Mission [32]U
type Metadata struct {
	Preparation                                   prep.Context
	Version, Codehash, Engine, RequestID, Purpose U
}
type State struct {
	Started, Done                  frontend.Variable
	Journal, Rows, SourceID, Owner U
	Raw, Tech, Sources             frontend.Variable
	LastType, Remaining, Side      frontend.Variable
	Counts                         [16]frontend.Variable
}

func fields(ws ...U) []frontend.Variable {
	var v []frontend.Variable
	for _, w := range ws {
		v = append(v, w[:]...)
	}
	return v
}
func identity(i prep.Identity) []U {
	return []U{i.Chain, i.Game, i.Battle, i.Body, i.Incarnation, i.Impact, i.Rules, i.Verifier, i.Catalog, i.SeedPolicy}
}
func ContextValues(c prep.Context) []frontend.Variable {
	v := fields(identity(c.Identity)...)
	v = append(v, c.Identity.TargetIsMoon, c.Raw, c.Catalog, c.Tech)
	return append(v, c.Rows[:]...)
}
func (m Metadata) values() []frontend.Variable {
	return append(ContextValues(m.Preparation), fields(m.Version, m.Codehash, m.Engine, m.RequestID, m.Purpose)...)
}
func (s State) values() []frontend.Variable {
	v := []frontend.Variable{s.Started, s.Done, s.Raw, s.Tech, s.Sources, s.LastType, s.Remaining, s.Side}
	v = append(v, fields(s.Journal, s.Rows, s.SourceID, s.Owner)...)
	return append(v, s.Counts[:]...)
}
func Hash(api frontend.API, d int, v ...frontend.Variable) frontend.Variable {
	h, _ := mimc.NewMiMC(api)
	h.Write(d, len(v))
	h.Write(v...)
	return h.Sum()
}
func (m Metadata) Commitment() *big.Int { return prep.Hash(BindingDomain, m.values()...) }
func (s State) Commitment() *big.Int    { return prep.Hash(StateDomain, s.values()...) }
func ContextHash(api frontend.API, c prep.Context) frontend.Variable {
	return Hash(api, prep.ContextDomain, ContextValues(c)...)
}
func Binding(api frontend.API, m Metadata) frontend.Variable {
	return Hash(api, BindingDomain, m.values()...)
}
func Result(api frontend.API, binding frontend.Variable, snapshot U) frontend.Variable {
	return Hash(api, ResultDomain, append([]frontend.Variable{binding}, snapshot[:]...)...)
}
func Initial() State {
	z := prep.NewTree(big.NewInt(0)).Root()
	s := State{Started: 0, Done: 0, Journal: p.Const(0), Rows: p.Const(0), SourceID: p.Const(0), Owner: p.Const(0), Raw: z, Tech: z, Sources: z, LastType: 0, Remaining: 0, Side: 1}
	for i := range s.Counts {
		s.Counts[i] = 0
	}
	return s
}
func Domain(s string) U {
	h := native.NewLegacyKeccak256()
	h.Write([]byte(s))
	return p.MustValue(new(big.Int).SetBytes(h.Sum(nil)))
}
func Bytes(api frontend.API, w U) []uints.U8 {
	b, _ := uints.NewBytes(api)
	var v []uints.U8
	for j := 3; j >= 0; j-- {
		bits := api.ToBinary(w[j], 64)
		for k := 7; k >= 0; k-- {
			v = append(v, b.ValueOf(api.FromBinary(bits[k*8:(k+1)*8]...)))
		}
	}
	return v
}
func Keccak(api frontend.API, ws ...U) U {
	h, _ := sha3.NewLegacyKeccak256(api)
	var data []uints.U8
	for _, w := range ws {
		data = append(data, Bytes(api, w)...)
	}
	h.Write(data)
	d := h.Sum()
	b, _ := uints.NewBytes(api)
	var out U
	for j := 0; j < 4; j++ {
		var bits []frontend.Variable
		for k := 0; k < 8; k++ {
			bits = append(bits, api.ToBinary(b.Value(d[31-j*8-k]), 8)...)
		}
		out[j] = api.FromBinary(bits...)
	}
	return out
}
func Narrow(api frontend.API, w U, bits int) {
	for _, v := range w {
		api.ToBinary(v, 64)
	}
	for i := 0; i < 4; i++ {
		n := bits - i*64
		if n <= 0 {
			api.AssertIsEqual(w[i], 0)
		} else if n < 64 {
			api.ToBinary(w[i], n)
		}
	}
}
func validateMeta(api frontend.API, m Metadata) {
	for _, w := range append(identity(m.Preparation.Identity), m.Preparation.Rows, m.Version, m.Codehash, m.Engine, m.RequestID, m.Purpose) {
		Narrow(api, w, 256)
	}
	Narrow(api, m.Preparation.Identity.Game, 160)
	Narrow(api, m.Preparation.Identity.Verifier, 160)
	Narrow(api, m.Engine, 160)
	Narrow(api, m.Version, 32)
	api.AssertIsBoolean(m.Preparation.Identity.TargetIsMoon)
}
func validateState(api frontend.API, s State) {
	api.AssertIsBoolean(s.Started)
	api.AssertIsBoolean(s.Done)
	for _, w := range []U{s.Journal, s.Rows, s.SourceID, s.Owner} {
		Narrow(api, w, 256)
	}
	api.ToBinary(s.LastType, 5)
	api.ToBinary(s.Remaining, 36)
	api.AssertIsBoolean(s.Side)
	for _, v := range s.Counts {
		api.ToBinary(v, 32)
	}
}
func HeaderWords(m Metadata, h Header) []U {
	i := m.Preparation.Identity
	v := []U{Domain(RawDomain), i.Chain, i.Game, i.Battle, m.Version, i.Rules, i.Catalog, i.Verifier, m.Codehash, m.Engine, m.RequestID, m.Purpose, p.Const(13 * 32), p.Const(16 * 32)}
	return append(v, h[:]...)
}
func SourceWords(previous, id U, mission Mission) []U {
	v := []U{previous, p.Const(1), id, p.Const(4 * 32), p.Const(32 * 32)}
	return append(v, mission[:]...)
}
func RowWords(previous, index U, r prep.Row) []U {
	return []U{previous, p.Const(2), index, r.Source, r.Owner, r.Count, {r.Side, 0, 0, 0}, {r.Type, 0, 0, 0}, {r.Tech.Weapons, 0, 0, 0}, {r.Tech.Shielding, 0, 0, 0}, {r.Tech.Armor, 0, 0, 0}}
}
