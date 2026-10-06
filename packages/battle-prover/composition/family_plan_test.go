package composition

import (
	"math/big"
	"testing"
)

func TestProtocolWorkPlan(t *testing.T) {
	max := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
	for _, n := range []*big.Int{big.NewInt(1), big.NewInt(3), big.NewInt(24), new(big.Int).Lsh(big.NewInt(1), 200), max} {
		plan, e := CountPlan(n, ProtocolRootHeight)
		check(t, e)
		if len(plan) != 256 || plan[255].Outputs.Cmp(big.NewInt(1)) != 0 {
			t.Fatal("root")
		}
		prev := new(big.Int).Set(n)
		for _, l := range plan {
			covered := new(big.Int).Add(new(big.Int).Lsh(new(big.Int).Set(l.Pairs), 1), l.Unary)
			if covered.Cmp(prev) != 0 || l.Unary.Cmp(big.NewInt(1)) > 0 {
				t.Fatal("coverage")
			}
			prev = l.Outputs
		}
		t.Logf("uint256 work bits=%d level256 root=1", n.BitLen())
	}
	if _, e := CountPlan(new(big.Int).Add(max, big.NewInt(1)), 256); e == nil {
		t.Fatal("overflow")
	}
	if _, e := CountPlan(big.NewInt(3), 1); e == nil {
		t.Fatal("premature height")
	}
	for _, n := range []int{1, 2, 3, 24} {
		plan, e := ScheduleTo(n, 8)
		check(t, e)
		if len(plan) != 8 || len(plan[7]) != 1 || plan[7][0].End != n {
			t.Fatal("promoted scheduler")
		}
	}
}
