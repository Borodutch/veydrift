// Package protocol contains unauthenticated elementary arithmetic/preparation
// relations. It is NOT a snapshot, roster-membership, or battle proof.
package protocol

import (
	"fmt"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/math/cmp"
	"github.com/consensys/gnark/std/math/emulated"
	"github.com/consensys/gnark/std/math/emulated/emparams"
	"math/big"
)

// Uint256 is four little-endian, individually constrained uint64 limbs. Never
// encode a protocol integer as one native BN254 scalar (which loses high bits).
type Uint256 [4]frontend.Variable

// Owner is the low 160 bits of a Uint256; its high 96 bits must be zero.
type Owner = Uint256

type wide = emulated.Element[emparams.Mod1e512]
type Arithmetic struct {
	api frontend.API
	f   *emulated.Field[emparams.Mod1e512]
}

func New(api frontend.API) *Arithmetic {
	if api.Compiler().FieldBitLen() < 200 {
		panic("protocol requires a large native field")
	}
	f, err := emulated.NewField[emparams.Mod1e512](api)
	if err != nil {
		panic(err)
	}
	return &Arithmetic{api, f}
}
func (a *Arithmetic) lift(x Uint256) *wide {
	bs := make([]frontend.Variable, 0, 256)
	for _, limb := range x {
		bs = append(bs, a.api.ToBinary(limb, 64)...)
	}
	// Pad to the standard eight-limb width before emulated operations.
	for len(bs) < 512 {
		bs = append(bs, 0)
	}
	return a.f.FromBits(bs...)
}
func (a *Arithmetic) narrow(x *wide) Uint256 {
	bs := a.f.ToBitsCanonical(x)
	for _, b := range bs[256:] {
		a.api.AssertIsEqual(b, 0)
	}
	var out Uint256
	for i := range out {
		out[i] = a.api.FromBinary(bs[i*64 : (i+1)*64]...)
	}
	return out
}
func (a *Arithmetic) less(x, y *wide) frontend.Variable {
	return cmp.IsLessBinary(a.api, a.f.ToBitsCanonical(x), a.f.ToBitsCanonical(y))
}
func (a *Arithmetic) AssertEqual(x, y Uint256) {
	a.lift(x)
	a.lift(y)
	for i := range x {
		a.api.AssertIsEqual(x[i], y[i])
	}
}
func (a *Arithmetic) Less(x, y Uint256) frontend.Variable { return a.less(a.lift(x), a.lift(y)) }
func (a *Arithmetic) Equal(x, y Uint256) frontend.Variable {
	return a.f.IsZero(a.f.Sub(a.lift(x), a.lift(y)))
}
func (a *Arithmetic) Select(b frontend.Variable, x, y Uint256) Uint256 {
	a.api.AssertIsBoolean(b)
	a.lift(x)
	a.lift(y)
	var z Uint256
	for i := range z {
		z[i] = a.api.Select(b, x[i], y[i])
	}
	return z
}

// AddChecked/SubChecked/MulChecked reject overflow/underflow. Products of two
// uint256 operands are < 2^512-1, the standard emulation modulus, so modular
// equality is integer equality before narrow checks the uint256 boundary.
func (a *Arithmetic) AddChecked(x, y Uint256) Uint256 { return a.narrow(a.f.Add(a.lift(x), a.lift(y))) }
func (a *Arithmetic) SubChecked(x, y Uint256) Uint256 {
	a.api.AssertIsEqual(a.Less(x, y), 0)
	return a.narrow(a.f.Sub(a.lift(x), a.lift(y)))
}
func (a *Arithmetic) MulChecked(x, y Uint256) Uint256 { return a.narrow(a.f.Mul(a.lift(x), a.lift(y))) }

// DivMod constrains ordinary unsigned Euclidean division, NOT field division.
// q and r are explicit witness advice; every bit and equation is constrained.
// q*d+r <= (2^256-1)^2+(2^256-1) < 2^512-1, excluding modular aliases.
func (a *Arithmetic) DivMod(n, d, q, r Uint256) {
	nn, dd, qq, rr := a.lift(n), a.lift(d), a.lift(q), a.lift(r)
	a.api.AssertIsEqual(a.f.IsZero(dd), 0)
	a.api.AssertIsEqual(a.less(rr, dd), 1)
	a.f.AssertIsEqual(nn, a.f.Add(a.f.Mul(qq, dd), rr))
}

// Effective matches Solidity's CHECKED numerator multiplication before /10.
// In particular base > max/(10+tech) is invalid even if the quotient fits.
func (a *Arithmetic) Effective(base Uint256, tech frontend.Variable, result Uint256, remainder frontend.Variable) {
	a.api.ToBinary(tech, 16)
	a.api.ToBinary(remainder, 4)
	numerator := a.MulChecked(base, Uint256{a.api.Add(10, tech), 0, 0, 0})
	a.DivMod(numerator, Const(10), result, Uint256{remainder, 0, 0, 0})
}

// Sample proves one rejection-sampling attempt for any nonzero uint256 bound.
// Word must be externally bound to the authenticated SHA256 stream. It does
// not advance/authenticate that stream. Rejected values must NOT be consumed.
// max = floor((2^256-1)/bound)*bound + r; (max % bound)+1 == bound
// means 2^256 % bound == 0. Otherwise tail=r+1 and limit=2^256-tail.
func (a *Arithmetic) Sample(word, bound, value, quotient, maxQuotient, maxRemainder Uint256) frontend.Variable {
	a.DivMod(word, bound, quotient, value)
	max := MustValue(new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)))
	a.DivMod(max, bound, maxQuotient, maxRemainder)
	// r < bound <= max, hence r+1 fits.
	next := a.AddChecked(maxRemainder, Const(1))
	divisible := a.Equal(next, bound)
	tail := a.Select(divisible, Const(0), next)
	// word < 2^256-tail iff max-word >= tail. No 257-bit value is narrowed.
	distance := a.SubChecked(max, word)
	return a.api.Sub(1, a.Less(distance, tail))
}

// MulDiv constrains floor(x*y/d) and its remainder without narrowing the
// numerator. All operands/results are uint256; x*y and q*d+r stay below the
// 512-bit emulation modulus. Useful for 288-bit losses*uint32 member counts.
func (a *Arithmetic) MulDiv(x, y, d, q, r Uint256) {
	xx, yy, dd, qq, rr := a.lift(x), a.lift(y), a.lift(d), a.lift(q), a.lift(r)
	a.api.AssertIsEqual(a.f.IsZero(dd), 0)
	a.api.AssertIsEqual(a.less(rr, dd), 1)
	a.f.AssertIsEqual(a.f.Mul(xx, yy), a.f.Add(a.f.Mul(qq, dd), rr))
}
func Const(n uint64) Uint256 { return Uint256{n, 0, 0, 0} }
func Value(n *big.Int) (Uint256, error) {
	if n == nil || n.Sign() < 0 || n.BitLen() > 256 {
		return Uint256{}, fmt.Errorf("not uint256")
	}
	var v Uint256
	t := new(big.Int).Set(n)
	for i := range v {
		v[i] = t.Uint64()
		t.Rsh(t, 64)
	}
	return v, nil
}
func MustValue(n *big.Int) Uint256 {
	v, e := Value(n)
	if e != nil {
		panic(e)
	}
	return v
}

// DivisionAdvice only constructs witnesses; DivMod enforces their correctness.
func DivisionAdvice(n, d *big.Int) (Uint256, Uint256, error) {
	if _, e := Value(n); e != nil {
		return Uint256{}, Uint256{}, e
	}
	if _, e := Value(d); e != nil || d.Sign() == 0 {
		return Uint256{}, Uint256{}, fmt.Errorf("invalid divisor")
	}
	q, r := new(big.Int), new(big.Int)
	q.QuoRem(n, d, r)
	return MustValue(q), MustValue(r), nil
}
