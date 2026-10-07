package protocol

import (
	"math/big"
	"reflect"
	"testing"
)

func TestWitnessConstructors(t *testing.T) {
	for _, base := range []*big.Int{big.NewInt(0), pow(64), pow(128), max256()} {
		v, r, e := EffectiveAdvice(base, 65535)
		n := mul(base, big.NewInt(65545))
		if n.BitLen() > 256 {
			if e == nil {
				t.Fatal("overflow accepted")
			}
			continue
		}
		if e != nil {
			t.Fatal(e)
		}
		q, rem := new(big.Int), new(big.Int)
		q.QuoRem(n, big.NewInt(10), rem)
		if !reflect.DeepEqual(v, MustValue(q)) || r != rem.Uint64() {
			t.Fatal("wrong effective advice")
		}
	}
	for _, bound := range []*big.Int{big.NewInt(1), big.NewInt(3), pow(128), max256()} {
		got, e := NewSampleWitness(max256(), bound)
		if e != nil {
			t.Fatal(e)
		}
		if !reflect.DeepEqual(got, sampleWitness(max256(), bound)) {
			t.Fatal("sample advice mismatch")
		}
	}
	q, r, e := MulDivisionAdvice(max256(), big.NewInt(0xffffffff), max256())
	if e != nil || !reflect.DeepEqual(q, MustValue(big.NewInt(0xffffffff))) || !reflect.DeepEqual(r, MustValue(big.NewInt(0))) {
		t.Fatal("muldiv advice mismatch")
	}
	if _, _, e = MulDivisionAdvice(max256(), max256(), big.NewInt(1)); e == nil {
		t.Fatal("quotient overflow")
	}
	for _, n := range []*big.Int{nil, big.NewInt(-1), pow(256)} {
		if _, _, e = EffectiveAdvice(n, 0); e == nil {
			t.Fatal("invalid base")
		}
		if _, e := NewSampleWitness(n, big.NewInt(1)); e == nil {
			t.Fatal("invalid word")
		}
		if _, _, e = MulDivisionAdvice(n, big.NewInt(1), big.NewInt(1)); e == nil {
			t.Fatal("invalid multiplicand")
		}
	}
	if _, e := NewSampleWitness(big.NewInt(0), big.NewInt(0)); e == nil {
		t.Fatal("zero bound")
	}
	if _, _, e = MulDivisionAdvice(big.NewInt(1), big.NewInt(1), big.NewInt(0)); e == nil {
		t.Fatal("zero divisor")
	}
}
