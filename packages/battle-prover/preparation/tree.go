package preparation

import (
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	native "github.com/consensys/gnark-crypto/ecc/bn254/fr/mimc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/hash/mimc"
	"math/big"
)

const Depth = 256
const (
	RawDomain     = 440801
	CatalogDomain = 440802
	TechDomain    = 440803
	MemberDomain  = 440804
	CohortDomain  = 440805
	ContextDomain = 440806
	StateDomain   = 440807
	ResultDomain  = 440808
)

func scalar(x frontend.Variable) *big.Int {
	switch v := x.(type) {
	case *big.Int:
		return new(big.Int).Set(v)
	case int:
		return big.NewInt(int64(v))
	case uint64:
		return new(big.Int).SetUint64(v)
	default:
		panic("unsupported witness scalar")
	}
}
func integer(x p.Uint256) *big.Int {
	v := new(big.Int)
	for i := 3; i >= 0; i-- {
		v.Lsh(v, 64)
		v.Add(v, scalar(x[i]))
	}
	return v
}
func raw(v ...frontend.Variable) *big.Int {
	h := native.NewFieldHasher()
	for _, x := range v {
		var e fr.Element
		n := scalar(x)
		if n.Sign() < 0 || n.Cmp(fr.Modulus()) >= 0 {
			panic("noncanonical hash scalar")
		}
		e.SetBigInt(n)
		h.WriteElement(e)
	}
	s := h.SumElement()
	return s.BigInt(new(big.Int))
}
func Hash(d int, v ...frontend.Variable) *big.Int {
	return raw(append([]frontend.Variable{d, len(v)}, v...)...)
}
func hash(api frontend.API, d int, v ...frontend.Variable) frontend.Variable {
	h, _ := mimc.NewMiMC(api)
	h.Write(d, len(v))
	h.Write(v...)
	return h.Sum()
}
func fields(xs ...p.Uint256) []frontend.Variable {
	v := []frontend.Variable{}
	for _, x := range xs {
		v = append(v, x[:]...)
	}
	return v
}
func check(api frontend.API, x p.Uint256) {
	for _, v := range x {
		api.ToBinary(v, 64)
	}
}

// Standard MiMC leaf/node Merkle encoding, with directions from FOUR limbs.
// gnark MerkleProof.VerifyProof accepts one field index and cannot represent
// every uint256; this is its identical algorithm with explicit limb bits.
type Path [Depth]frontend.Variable

func (o Path) Verify(api frontend.API, root frontend.Variable, index p.Uint256, leaf frontend.Variable) {
	h, _ := mimc.NewMiMC(api)
	h.Write(leaf)
	s := h.Sum()
	bits := []frontend.Variable{}
	for _, limb := range index {
		bits = append(bits, api.ToBinary(limb, 64)...)
	}
	for i, b := range bits {
		h.Reset()
		h.Write(api.Select(b, o[i], s), api.Select(b, s, o[i]))
		s = h.Sum()
	}
	api.AssertIsEqual(s, root)
}

type node struct {
	Level int
	Index string
}
type Tree struct {
	nodes  map[node]*big.Int
	leaves map[string]*big.Int
	empty  [257]*big.Int
	zero   *big.Int
}

func NewTree(zero *big.Int) *Tree {
	t := &Tree{nodes: map[node]*big.Int{}, leaves: map[string]*big.Int{}, zero: zero}
	t.empty[0] = raw(zero)
	for i := 1; i <= 256; i++ {
		t.empty[i] = raw(t.empty[i-1], t.empty[i-1])
	}
	return t
}
func (t *Tree) get(l int, i *big.Int) *big.Int {
	if v, ok := t.nodes[node{l, i.String()}]; ok {
		return v
	}
	return t.empty[l]
}
func (t *Tree) Root() *big.Int { return new(big.Int).Set(t.get(256, new(big.Int))) }
func (t *Tree) Read(i *big.Int) *big.Int {
	if v, ok := t.leaves[i.String()]; ok {
		return v
	}
	return t.zero
}
func (t *Tree) Write(i *big.Int, v *big.Int) {
	if i.Sign() < 0 || i.BitLen() > 256 {
		panic("index range")
	}
	t.leaves[i.String()] = new(big.Int).Set(v)
	j := new(big.Int).Set(i)
	t.nodes[node{0, j.String()}] = raw(v)
	for l := 0; l < 256; l++ {
		left := new(big.Int).SetBit(new(big.Int).Set(j), 0, 0)
		right := new(big.Int).SetBit(new(big.Int).Set(j), 0, 1)
		a, b := t.get(l, left), t.get(l, right)
		j.Rsh(j, 1)
		t.nodes[node{l + 1, j.String()}] = raw(a, b)
	}
}
func (t *Tree) Open(i *big.Int) Path {
	var p Path
	j := new(big.Int).Set(i)
	for l := 0; l < 256; l++ {
		s := new(big.Int).Xor(j, big.NewInt(1))
		p[l] = new(big.Int).Set(t.get(l, s))
		j.Rsh(j, 1)
	}
	return p
}
