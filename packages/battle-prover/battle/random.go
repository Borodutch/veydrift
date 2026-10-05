package battle

import (
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/math/cmp"
	"math/big"
)

// uniformWord consumes the full 256-bit little-endian digest and positive
// uint32 bound. No field reduction, bias or unconstrained division hint.
func uniformWord(api frontend.API, bits []frontend.Variable, bound frontend.Variable) (frontend.Variable, frontend.Variable) {
	if len(bits) != 256 {
		panic("digest must be 256 bits")
	}
	for _, b := range bits {
		api.AssertIsBoolean(b)
	}
	api.ToBinary(bound, 32)
	api.AssertIsDifferent(bound, 0)
	lt := cmp.NewBoundedComparator(api, new(big.Int).Lsh(big.NewInt(1), 48), false).IsLess
	mod := func(bs []frontend.Variable) frontend.Variable {
		var r frontend.Variable = 0
		for i := len(bs) - 1; i >= 0; i-- {
			v := api.Add(api.Mul(r, 2), bs[i])
			r = api.Select(lt(v, bound), v, api.Sub(v, bound))
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
	var highOnes frontend.Variable = 1
	for i := 32; i < 256; i++ {
		highOnes = api.Mul(highOnes, bits[i])
	}
	lowComplement := make([]frontend.Variable, 32)
	for i := range lowComplement {
		lowComplement[i] = api.Sub(1, bits[i])
	}
	reject := api.Mul(highOnes, lt(api.FromBinary(lowComplement...), tail))
	return remainder, api.Sub(1, reject)
}
