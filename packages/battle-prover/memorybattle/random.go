package memorybattle

import (
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/hash/sha2"
	"github.com/consensys/gnark/std/math/cmp"
	"github.com/consensys/gnark/std/math/uints"
	"math/big"
)

// Uniform implements the oracle's full SHA256 rejection sampler. All 256 bits
// participate; a rejected word consumes one step, never a truncated RF chain.
func uniform(api frontend.API, bits []frontend.Variable, bound frontend.Variable) (frontend.Variable, frontend.Variable) {
	if len(bits) != 256 {
		panic("digest must have 256 bits")
	}
	for _, bit := range bits {
		api.AssertIsBoolean(bit)
	}
	api.ToBinary(bound, 64)
	api.AssertIsDifferent(bound, 0)
	lt := cmp.NewBoundedComparator(api, new(big.Int).Lsh(big.NewInt(1), 80), false).IsLess
	mod := func(bs []frontend.Variable) frontend.Variable {
		var r frontend.Variable = 0
		for i := len(bs) - 1; i >= 0; i-- {
			x := api.Add(api.Mul(r, 2), bs[i])
			r = api.Select(lt(x, bound), x, api.Sub(x, bound))
		}
		return r
	}
	remainder := mod(bits)
	top := make([]frontend.Variable, 257)
	for i := range top {
		top[i] = 0
	}
	top[256] = 1
	tail := mod(top)
	var ones frontend.Variable = 1
	for i := 64; i < 256; i++ {
		ones = api.Mul(ones, bits[i])
	}
	low := make([]frontend.Variable, 64)
	for i := range low {
		low[i] = api.Sub(1, bits[i])
	}
	return remainder, api.Sub(1, api.Mul(ones, lt(api.FromBinary(low...), tail)))
}
func (c *Step) draw(api frontend.API, out *[StateSize]frontend.Variable, bound, enabled frontend.Variable) (frontend.Variable, frontend.Variable) {
	h, err := sha2.New(api)
	if err != nil {
		panic(err)
	}
	bytes, err := uints.NewBytes(api)
	if err != nil {
		panic(err)
	}
	input := uints.NewU8Array([]byte(Rules + ":random:"))
	for _, b := range c.Seed {
		input = append(input, bytes.ValueOf(b))
	}
	for j := 3; j >= 0; j-- {
		bits := api.ToBinary(c.Before[counter0+j], 64)
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
	carry := enabled
	for j := 0; j < 4; j++ {
		bs := api.ToBinary(api.Add(c.Before[counter0+j], carry), 65)
		out[counter0+j] = api.FromBinary(bs[:64]...)
		carry = bs[64]
	}
	api.AssertIsEqual(carry, 0)
	return uniform(api, bits, bound)
}
