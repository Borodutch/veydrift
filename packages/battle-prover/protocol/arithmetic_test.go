package protocol

import (
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"testing"
)

func pow(n uint) *big.Int        { return new(big.Int).Lsh(big.NewInt(1), n) }
func add(x, y *big.Int) *big.Int { return new(big.Int).Add(x, y) }
func sub(x, y *big.Int) *big.Int { return new(big.Int).Sub(x, y) }
func mul(x, y *big.Int) *big.Int { return new(big.Int).Mul(x, y) }
func max256() *big.Int           { return sub(pow(256), big.NewInt(1)) }
func compile(t *testing.T, c frontend.Circuit) constraint.ConstraintSystem {
	t.Helper()
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, c)
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("%T constraints=%d", c, cc.GetNbConstraints())
	return cc
}
func solve(t *testing.T, cc constraint.ConstraintSystem, w frontend.Circuit, valid bool) {
	t.Helper()
	fw, e := frontend.NewWitness(w, ecc.BN254.ScalarField())
	if e != nil {
		t.Fatal(e)
	}
	e = cc.IsSolved(fw)
	if (e == nil) != valid {
		t.Fatalf("valid=%v err=%v", valid, e)
	}
}

type arithmeticCircuit struct {
	X, Y, Z Uint256
	Op      int `gnark:"-"`
}

func (c *arithmeticCircuit) Define(api frontend.API) error {
	a := New(api)
	var z Uint256
	switch c.Op {
	case 0:
		z = a.AddChecked(c.X, c.Y)
	case 1:
		z = a.SubChecked(c.X, c.Y)
	case 2:
		z = a.MulChecked(c.X, c.Y)
	}
	a.AssertEqual(z, c.Z)
	return nil
}
func TestCheckedArithmetic(t *testing.T) {
	for op := 0; op < 3; op++ {
		cc := compile(t, &arithmeticCircuit{Op: op})
		for _, x := range []*big.Int{big.NewInt(0), big.NewInt(1), pow(64), pow(128), max256()} {
			for _, y := range []*big.Int{big.NewInt(0), big.NewInt(1), pow(64), pow(128), max256()} {
				var z *big.Int
				switch op {
				case 0:
					z = add(x, y)
				case 1:
					z = sub(x, y)
				case 2:
					z = mul(x, y)
				}
				valid := z.Sign() >= 0 && z.BitLen() <= 256
				wrapped := new(big.Int).Mod(z, pow(256))
				w := arithmeticCircuit{MustValue(x), MustValue(y), MustValue(wrapped), op}
				solve(t, cc, &w, valid)
			}
		}
		w := arithmeticCircuit{Const(1), Const(1), Const(2), op}
		w.X[0] = pow(64)
		solve(t, cc, &w, false)
	}
}

type effectiveCircuit struct {
	Base, Result Uint256
	Tech, Rem    frontend.Variable
}

func (c *effectiveCircuit) Define(api frontend.API) error {
	New(api).Effective(c.Base, c.Tech, c.Result, c.Rem)
	return nil
}
func TestEffectiveBoundaries(t *testing.T) {
	cc := compile(t, &effectiveCircuit{})
	for _, tech := range []int64{0, 1, 65535} {
		factor := big.NewInt(10 + tech)
		edge := new(big.Int).Quo(max256(), factor)
		for _, base := range []*big.Int{big.NewInt(0), pow(64), pow(128), edge, add(edge, big.NewInt(1))} {
			n := mul(base, factor)
			q, r := new(big.Int), new(big.Int)
			q.QuoRem(n, big.NewInt(10), r)
			valid := n.BitLen() <= 256
			w := effectiveCircuit{MustValue(base), MustValue(q), tech, r}
			solve(t, cc, &w, valid)
			if valid {
				w.Rem = 10
				solve(t, cc, &w, false)
			}
		}
	}
	w := effectiveCircuit{Const(0), Const(0), 65536, 0}
	solve(t, cc, &w, false)
}

type mulDivCircuit struct{ X, Y, D, Q, R Uint256 }

func (c *mulDivCircuit) Define(api frontend.API) error {
	New(api).MulDiv(c.X, c.Y, c.D, c.Q, c.R)
	return nil
}
func TestMulDivFullProduct(t *testing.T) {
	cc := compile(t, &mulDivCircuit{})
	for _, y := range []*big.Int{big.NewInt(0xffffffff), max256()} {
		x, d := max256(), max256()
		q, r := new(big.Int), new(big.Int)
		q.QuoRem(mul(x, y), d, r)
		w := mulDivCircuit{MustValue(x), MustValue(y), MustValue(d), MustValue(q), MustValue(r)}
		solve(t, cc, &w, true)
		w.R = Const(1)
		solve(t, cc, &w, false)
		w.D = Const(0)
		solve(t, cc, &w, false)
	}
}
func sampleWitness(word, bound *big.Int) *SampleCircuit {
	q, r, e := DivisionAdvice(word, bound)
	if e != nil {
		panic(e)
	}
	mq, mr, e := DivisionAdvice(max256(), bound)
	if e != nil {
		panic(e)
	}
	limit := sub(pow(256), new(big.Int).Mod(pow(256), bound))
	accepted := 0
	if word.Cmp(limit) < 0 {
		accepted = 1
	}
	return &SampleCircuit{MustValue(word), MustValue(bound), r, q, mq, mr, accepted}
}
func TestFullWidthSampler(t *testing.T) {
	cc := compile(t, &SampleCircuit{})
	for _, bound := range []*big.Int{big.NewInt(1), big.NewInt(3), pow(64), add(pow(128), big.NewInt(7)), add(pow(255), big.NewInt(1)), max256()} {
		limit := sub(pow(256), new(big.Int).Mod(pow(256), bound))
		words := []*big.Int{big.NewInt(0), pow(64), pow(128), max256(), sub(limit, big.NewInt(1))}
		if limit.BitLen() <= 256 {
			words = append(words, limit)
		}
		for _, word := range words {
			w := sampleWitness(word, bound)
			solve(t, cc, w, true)
			bad := *w
			bad.Accepted = 1 - w.Accepted.(int)
			solve(t, cc, &bad, false)
		}
		w := sampleWitness(max256(), bound)
		w.Value = MustValue(bound)
		solve(t, cc, w, false)
		w = sampleWitness(max256(), bound)
		w.MaxQuotient = Const(0)
		if bound.Cmp(max256()) <= 0 {
			solve(t, cc, w, false)
		}
	}
	w := sampleWitness(big.NewInt(0), big.NewInt(1))
	w.Bound = Const(0)
	solve(t, cc, w, false)
}
func TestWitnessRefusesTruncation(t *testing.T) {
	for _, n := range []*big.Int{big.NewInt(-1), pow(256), nil} {
		if _, e := Value(n); e == nil {
			t.Fatal("accepted invalid")
		}
	}
	if _, _, e := DivisionAdvice(big.NewInt(1), big.NewInt(0)); e == nil {
		t.Fatal("zero divisor")
	}
}
