package memorybattle

import (
	"github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	native "github.com/consensys/gnark-crypto/ecc/bn254/fr/mimc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/hash/mimc"
	"math/big"
)

const Depth = 258
const Width = 9
const (
	Side = iota
	Type
	Attack
	MaxShield
	MaxHull
	Cohort
	Hull
	Shield
	Pool
)
const (
	UnitDomain   uint64 = 0
	RosterDomain uint64 = 1
	RFDomain     uint64 = 2
)
const (
	leafDomain     = 440401
	stateDomain    = 440402
	contextDomain  = 440403
	reportDomain   = 440404
	resultDomain   = 440405
	positionDomain = 440406
)

// Word is a value-semantic uint256, with little-endian uint64 limbs.
// Small refuses narrowing; Big refuses out-of-range input.
type Word [4]uint64

// Cell has immutable side/type/effective stats/cohort and mutable hull/shield/pool.
type Cell [Width]Word
type CircuitCell [Width]protocol.Uint256

func W(n uint64) Word { return Word{n} }
func Big(n *big.Int) Word {
	if n == nil || n.Sign() < 0 || n.BitLen() > 256 {
		panic("not uint256")
	}
	var w Word
	t := new(big.Int).Set(n)
	for i := range w {
		w[i] = t.Uint64()
		t.Rsh(t, 64)
	}
	return w
}
func (w Word) Big() *big.Int {
	t := new(big.Int)
	for i := 3; i >= 0; i-- {
		t.Lsh(t, 64)
		t.Add(t, new(big.Int).SetUint64(w[i]))
	}
	return t
}
func (w Word) Circuit() protocol.Uint256 { return protocol.Uint256{w[0], w[1], w[2], w[3]} }
func (w Word) Cmp(v Word) int            { return w.Big().Cmp(v.Big()) }
func (w Word) Add(v Word) Word           { return Big(new(big.Int).Add(w.Big(), v.Big())) }
func (w Word) Sub(v Word) Word           { return Big(new(big.Int).Sub(w.Big(), v.Big())) }
func (w Word) IsZero() bool              { return w == Word{} }
func (w Word) Small() uint64 {
	if w[1]|w[2]|w[3] != 0 {
		panic("not small")
	}
	return w[0]
}
func num(x uint64) *big.Int { return new(big.Int).SetUint64(x) }
func raw(v ...*big.Int) *big.Int {
	h := native.NewFieldHasher()
	for _, x := range v {
		if x.Sign() < 0 || x.Cmp(fr.Modulus()) >= 0 {
			panic("noncanonical hash scalar")
		}
		var e fr.Element
		e.SetBigInt(x)
		h.WriteElement(e)
	}
	s := h.SumElement()
	return s.BigInt(new(big.Int))
}
func hash(d uint64, v ...*big.Int) *big.Int {
	return raw(append([]*big.Int{num(d), num(uint64(len(v)))}, v...)...)
}
func hashCircuit(api frontend.API, d uint64, v ...frontend.Variable) frontend.Variable {
	h, e := mimc.NewMiMC(api)
	if e != nil {
		panic(e)
	}
	h.Write(d, len(v))
	h.Write(v...)
	return h.Sum()
}
func appendWords(v []*big.Int, ws ...Word) []*big.Int {
	for _, w := range ws {
		for _, x := range w {
			v = append(v, num(x))
		}
	}
	return v
}
func flatten(ws ...protocol.Uint256) []frontend.Variable {
	var v []frontend.Variable
	for _, w := range ws {
		v = append(v, w[:]...)
	}
	return v
}
func cellHash(c Cell) *big.Int { return raw(hash(leafDomain, appendWords(nil, c[:]...)...)) }

// Key authenticates all index bits and a separate memory namespace.
type Key struct {
	Domain uint64
	Index  Word
}

func key(d uint64, i Word) Key {
	if d > 2 {
		panic("invalid domain")
	}
	return Key{d, i}
}
func (k Key) big() *big.Int {
	return new(big.Int).Or(k.Index.Big(), new(big.Int).Lsh(num(k.Domain), 256))
}

type node struct {
	Level uint16
	Index string
}
type Memory struct {
	nodes map[node]*big.Int
	cells map[Key]Cell
	empty [Depth + 1]*big.Int
}

func NewMemory() *Memory {
	m := &Memory{nodes: map[node]*big.Int{}, cells: map[Key]Cell{}}
	m.empty[0] = cellHash(Cell{})
	for l := 1; l <= Depth; l++ {
		m.empty[l] = raw(m.empty[l-1], m.empty[l-1])
	}
	return m
}
func (m *Memory) get(l int, i *big.Int) *big.Int {
	if v, ok := m.nodes[node{uint16(l), i.Text(16)}]; ok {
		return v
	}
	return m.empty[l]
}
func (m *Memory) Root() *big.Int  { return new(big.Int).Set(m.get(Depth, num(0))) }
func (m *Memory) Read(k Key) Cell { key(k.Domain, k.Index); return m.cells[k] }
func (m *Memory) Write(k Key, c Cell) {
	key(k.Domain, k.Index)
	m.cells[k] = c
	i := k.big()
	m.nodes[node{0, i.Text(16)}] = cellHash(c)
	for l := 0; l < Depth; l++ {
		left := new(big.Int).SetBit(new(big.Int).Set(i), 0, 0)
		right := new(big.Int).SetBit(new(big.Int).Set(i), 0, 1)
		p := new(big.Int).Rsh(i, 1)
		m.nodes[node{uint16(l + 1), p.Text(16)}] = raw(m.get(l, left), m.get(l, right))
		i = p
	}
}

type Opening struct {
	Cell     CircuitCell
	Siblings [Depth]frontend.Variable
}

func (m *Memory) Open(k Key) Opening {
	key(k.Domain, k.Index)
	var o Opening
	for j, x := range m.Read(k) {
		o.Cell[j] = x.Circuit()
	}
	i := k.big()
	for l := 0; l < Depth; l++ {
		s := new(big.Int).Xor(i, num(1))
		o.Siblings[l] = new(big.Int).Set(m.get(l, s))
		i.Rsh(i, 1)
	}
	return o
}
func (o *Opening) constrain(api frontend.API, root frontend.Variable, d uint64, index protocol.Uint256) {
	if d > 2 {
		panic("invalid domain")
	}
	bits := make([]frontend.Variable, 0, Depth)
	for _, x := range index {
		bits = append(bits, api.ToBinary(x, 64)...)
	}
	bits = append(bits, d&1, (d>>1)&1)
	for _, w := range o.Cell {
		for _, x := range w {
			api.ToBinary(x, 64)
		}
	}
	// Standard MiMC Merkle fold; limb bits avoid VerifyProof's native index limit.
	h, e := mimc.NewMiMC(api)
	if e != nil {
		panic(e)
	}
	h.Write(hashCircuit(api, leafDomain, flatten(o.Cell[:]...)...))
	sum := h.Sum()
	for l, s := range o.Siblings {
		h.Reset()
		h.Write(api.Select(bits[l], s, sum), api.Select(bits[l], sum, s))
		sum = h.Sum()
	}
	api.AssertIsEqual(root, sum)
}
func (o *Opening) write(api frontend.API, root frontend.Variable, d uint64, index protocol.Uint256, next CircuitCell) {
	n := *o
	n.Cell = next
	n.constrain(api, root, d, index)
}
