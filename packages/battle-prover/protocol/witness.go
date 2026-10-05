package protocol

import (
	"fmt"
	"math/big"
)

// EffectiveAdvice refuses the same checked numerator overflow as Solidity.
func EffectiveAdvice(base *big.Int, tech uint16) (Uint256, uint64, error) {
	if _, e := Value(base); e != nil {
		return Uint256{}, 0, e
	}
	numerator := new(big.Int).Mul(base, new(big.Int).SetUint64(10+uint64(tech)))
	if numerator.BitLen() > 256 {
		return Uint256{}, 0, fmt.Errorf("stat multiplication overflow")
	}
	q, r := new(big.Int), new(big.Int)
	q.QuoRem(numerator, big.NewInt(10), r)
	return MustValue(q), r.Uint64(), nil
}

// NewSampleWitness creates advice for one attempt, not a random-word source.
func NewSampleWitness(word, bound *big.Int) (*SampleCircuit, error) {
	q, r, e := DivisionAdvice(word, bound)
	if e != nil {
		return nil, e
	}
	top := new(big.Int).Lsh(big.NewInt(1), 256)
	max := new(big.Int).Sub(top, big.NewInt(1))
	mq, mr, e := DivisionAdvice(max, bound)
	if e != nil {
		return nil, e
	}
	limit := new(big.Int).Sub(top, new(big.Int).Mod(top, bound))
	accepted := 0
	if word.Cmp(limit) < 0 {
		accepted = 1
	}
	return &SampleCircuit{Word: MustValue(word), Bound: MustValue(bound), Value: r, Quotient: q, MaxQuotient: mq, MaxRemainder: mr, Accepted: accepted}, nil
}

// MulDivisionAdvice supports a full 512-bit product but requires uint256 q/r.
func MulDivisionAdvice(x, y, d *big.Int) (Uint256, Uint256, error) {
	for _, n := range []*big.Int{x, y, d} {
		if _, e := Value(n); e != nil {
			return Uint256{}, Uint256{}, e
		}
	}
	if d.Sign() == 0 {
		return Uint256{}, Uint256{}, fmt.Errorf("zero divisor")
	}
	q, r := new(big.Int), new(big.Int)
	q.QuoRem(new(big.Int).Mul(x, y), d, r)
	quotient, e := Value(q)
	if e != nil {
		return Uint256{}, Uint256{}, e
	}
	return quotient, MustValue(r), nil
}
