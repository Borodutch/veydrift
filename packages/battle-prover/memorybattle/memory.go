// Package memorybattle is a solver-tested, non-production variable-roster
// candidate-2 controller. See README for its admitted numeric/input domain.
package memorybattle

import (
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	native "github.com/consensys/gnark-crypto/ecc/bn254/fr/mimc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/accumulator/merkle"
	"github.com/consensys/gnark/std/hash/mimc"
	"math/big"
)

const Depth = 64
const Width = 9

// Immutable prefix: side,type,attack,maxShield,maxHull,cohort.
// Mutable suffix: hull,shield,round-start pool membership.
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

type Cell [Width]uint64

const (
	leafDomain    = 440301
	stateDomain   = 440302
	contextDomain = 440303
	reportDomain  = 440304
	resultDomain  = 440305
)

func raw(v ...*big.Int) *big.Int {
	h := native.NewFieldHasher()
	for _, x := range v {
		var e fr.Element
		e.SetBigInt(x)
		h.WriteElement(e)
	}
	s := h.SumElement()
	return s.BigInt(new(big.Int))
}
func num(x uint64) *big.Int { return new(big.Int).SetUint64(x) }
func hash(domain uint64, v ...*big.Int) *big.Int {
	return raw(append([]*big.Int{num(domain), num(uint64(len(v)))}, v...)...)
}
func hashCircuit(api frontend.API, domain uint64, v ...frontend.Variable) frontend.Variable {
	h, err := mimc.NewMiMC(api)
	if err != nil {
		panic(err)
	}
	h.Write(domain, len(v))
	h.Write(v...)
	return h.Sum()
}
func cellHash(c Cell) *big.Int {
	v := make([]*big.Int, Width)
	for i, x := range c {
		v[i] = num(x)
	}
	return raw(hash(leafDomain, v...))
}

// Sparse nodes use a uniform zero-cell leaf. Position is authenticated by the
// standard Merkle path direction bits, not an index-dependent empty leaf.
type node struct {
	Level uint8
	Index uint64
}
type Memory struct {
	nodes map[node]*big.Int
	cells map[uint64]Cell
	empty [Depth + 1]*big.Int
}

func NewMemory() *Memory {
	m := &Memory{nodes: map[node]*big.Int{}, cells: map[uint64]Cell{}}
	m.empty[0] = cellHash(Cell{})
	for l := 1; l <= Depth; l++ {
		m.empty[l] = raw(m.empty[l-1], m.empty[l-1])
	}
	return m
}
func (m *Memory) get(l int, i uint64) *big.Int {
	if v, ok := m.nodes[node{uint8(l), i}]; ok {
		return v
	}
	return m.empty[l]
}
func (m *Memory) Root() *big.Int     { return new(big.Int).Set(m.get(Depth, 0)) }
func (m *Memory) Read(i uint64) Cell { return m.cells[i] }
func (m *Memory) Write(i uint64, c Cell) {
	m.cells[i] = c
	m.nodes[node{0, i}] = cellHash(c)
	for l := 0; l < Depth; l++ {
		p := i >> 1
		m.nodes[node{uint8(l + 1), p}] = raw(m.get(l, i&^1), m.get(l, i|1))
		i = p
	}
}

type Opening struct {
	Cell     [Width]frontend.Variable
	Siblings [Depth]frontend.Variable
}

func (m *Memory) Open(i uint64) Opening {
	var o Opening
	for j, x := range m.Read(i) {
		o.Cell[j] = x
	}
	for l := 0; l < Depth; l++ {
		o.Siblings[l] = new(big.Int).Set(m.get(l, i^1))
		i >>= 1
	}
	return o
}
func (o *Opening) constrain(api frontend.API, root, index frontend.Variable) {
	api.ToBinary(index, Depth)
	for _, x := range o.Cell {
		api.ToBinary(x, 64)
	}
	leaf := hashCircuit(api, leafDomain, o.Cell[:]...)
	h, err := mimc.NewMiMC(api)
	if err != nil {
		panic(err)
	}
	p := merkle.MerkleProof{RootHash: root, Path: append([]frontend.Variable{leaf}, o.Siblings[:]...)}
	p.VerifyProof(api, &h, index)
}
func (o *Opening) write(api frontend.API, root, index frontend.Variable, next [Width]frontend.Variable) {
	n := *o
	n.Cell = next
	n.constrain(api, root, index)
}
