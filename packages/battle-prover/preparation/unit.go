package preparation

import (
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/hash/mimc"
	"math/big"
)

func UnitValues(k p.Key, id p.Uint256) []frontend.Variable {
	return fields(p.Uint256{k.Side, 0, 0, 0}, p.Uint256{k.Type, 0, 0, 0}, k.Stats.Attack, k.Stats.Shield, k.Stats.Hull, id, p.Const(0), p.Const(0), p.Const(0))
}
func UnitZero() *big.Int {
	return Hash(440401, fields(p.Const(0), p.Const(0), p.Const(0), p.Const(0), p.Const(0), p.Const(0), p.Const(0), p.Const(0), p.Const(0))...)
}
func UnitHash(k p.Key, id p.Uint256) *big.Int { return Hash(440401, UnitValues(k, id)...) }
func UnitHashCircuit(api frontend.API, k p.Key, id p.Uint256) frontend.Variable {
	return hash(api, 440401, UnitValues(k, id)...)
}

// Roster occupies domain 1 of memorybattle's 258-bit sparse address space.
// Lower tree is 256 bits; upper siblings remain the uniform empty subtree.
type UnitPath struct {
	Low Path
	Top [2]frontend.Variable
}

func (p UnitPath) Verify(api frontend.API, root frontend.Variable, index p.Uint256, leaf frontend.Variable) {
	h, _ := mimc.NewMiMC(api)
	h.Write(leaf)
	s := h.Sum()
	bits := []frontend.Variable{}
	for _, v := range index {
		bits = append(bits, api.ToBinary(v, 64)...)
	}
	bits = append(bits, 1, 0)
	siblings := append(p.Low[:], p.Top[:]...)
	for i, b := range bits {
		h.Reset()
		h.Write(api.Select(b, siblings[i], s), api.Select(b, s, siblings[i]))
		s = h.Sum()
	}
	api.AssertIsEqual(s, root)
}

type UnitTree struct {
	Low                *Tree
	empty256, empty257 *big.Int
}

func NewUnitTree() *UnitTree {
	t := NewTree(UnitZero())
	e := t.Root()
	return &UnitTree{t, e, raw(e, e)}
}
func (t *UnitTree) Root() *big.Int { return raw(raw(t.empty256, t.Low.Root()), t.empty257) }
func (t *UnitTree) Open(i *big.Int) UnitPath {
	return UnitPath{t.Low.Open(i), [2]frontend.Variable{t.empty256, t.empty257}}
}
func (t *UnitTree) Write(i *big.Int, k p.Key, id p.Uint256) { t.Low.Write(i, UnitHash(k, id)) }
