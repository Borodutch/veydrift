package memorybattle

import (
	"github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/hash/sha2"
	"github.com/consensys/gnark/std/math/cmp"
	"github.com/consensys/gnark/std/math/emulated"
	"github.com/consensys/gnark/std/math/emulated/emparams"
	"github.com/consensys/gnark/std/math/uints"
)

func (c *Step) draw(api frontend.API, a *protocol.Arithmetic, out *[StateSize]U, bound U, enabled frontend.Variable) (U, frontend.Variable) {
	h, e := sha2.New(api)
	if e != nil {
		panic(e)
	}
	bytes, e := uints.NewBytes(api)
	if e != nil {
		panic(e)
	}
	input := uints.NewU8Array([]byte(Rules + ":random:"))
	for _, b := range c.Seed {
		input = append(input, bytes.ValueOf(b))
	}
	for j := 3; j >= 0; j-- {
		bits := api.ToBinary(c.Before[counter][j], 64)
		for i := 7; i >= 0; i-- {
			input = append(input, bytes.ValueOf(api.FromBinary(bits[i*8:(i+1)*8]...)))
		}
	}
	h.Write(input)
	digest := h.Sum()
	bits := make([]frontend.Variable, 0, 256)
	for i := 31; i >= 0; i-- {
		bits = append(bits, api.ToBinary(bytes.Value(digest[i]), 8)...)
	}
	var word U
	for j := range word {
		word[j] = api.FromBinary(bits[j*64 : (j+1)*64]...)
	}
	// Disabled factor-one RF uses canonical zero advice, no RNG consumption.
	word = a.Select(enabled, word, protocol.Const(0))
	a.AssertEqual(c.Sample.Word, word)
	a.AssertEqual(c.Sample.Bound, bound)
	ok := a.Sample(word, bound, c.Sample.Value, c.Sample.Quotient, c.Sample.MaxQuotient, c.Sample.MaxRemainder)
	api.AssertIsEqual(c.Sample.Accepted, ok)
	out[counter] = a.AddChecked(c.Before[counter], U{enabled, 0, 0, 0})
	return c.Sample.Value, ok
}

// The protocol package's standard 512-bit emulation carries the comparisons
// beyond uint256 (attack*100, missingHull*10) without checked-product narrowing.
func damage(api frontend.API, a *protocol.Arithmetic, attack U, u CircuitCell) (U, U, frontend.Variable) {
	z := protocol.Const(0)
	not := func(b frontend.Variable) frontend.Variable { return api.Sub(1, b) }
	f, e := emulated.NewField[emparams.Mod1e512](api)
	if e != nil {
		panic(e)
	}
	lift := func(w U) *emulated.Element[emparams.Mod1e512] {
		bs := make([]frontend.Variable, 512)
		for j := range bs {
			bs[j] = 0
		}
		for j, x := range w {
			copy(bs[j*64:], api.ToBinary(x, 64))
		}
		return f.FromBits(bs...)
	}
	scaledLess := func(x U, xm uint64, y U, ym uint64) frontend.Variable {
		return cmp.IsLessBinary(api, f.ToBitsCanonical(f.Mul(lift(x), f.NewElement(xm))), f.ToBitsCanonical(f.Mul(lift(y), f.NewElement(ym))))
	}
	bounce := api.Mul(not(a.Equal(u[Shield], z)), scaledLess(attack, 100, u[MaxShield], 1))
	hit := api.Mul(not(a.Equal(u[Hull], z)), not(bounce))
	absorbed := a.Select(a.Less(attack, u[Shield]), attack, u[Shield])
	d := a.SubChecked(attack, absorbed)
	lost := a.Select(a.Less(d, u[Hull]), d, u[Hull])
	hull := a.Select(hit, a.SubChecked(u[Hull], lost), u[Hull])
	shield := a.Select(hit, a.SubChecked(u[Shield], absorbed), u[Shield])
	explode := api.Mul(hit, not(a.Equal(hull, z)), not(a.Equal(attack, z)), scaledLess(u[MaxHull], 3, a.SubChecked(u[MaxHull], hull), 10))
	return hull, shield, explode
}
