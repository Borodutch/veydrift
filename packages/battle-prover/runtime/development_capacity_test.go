package runtime

import (
	"context"
	comp "github.com/Borodutch/veydrift/packages/battle-prover/composition"
	"io"
	"math/big"
	"testing"
)

// This native-only inventory selects finite catalog capacity, not deployment
// identity, a frozen job, cryptographic setup, or fresh proof evidence.
func TestDevelopmentFiniteCapacity(t *testing.T) {
	heights := [7]int{5, 8, 2, 4, 5, 3, 4}
	graph, err := BuildCatalogGraph(heights)
	if err != nil || len(graph) != 112 {
		t.Fatalf("finite graph: nodes=%d err=%v", len(graph), err)
	}
	for _, variant := range []int{2, 3} {
		s, d := witnessTestDocument(t, variant, 1)
		trace, err := NewTrace(s, d.Release, witnessTestLimits)
		if err != nil {
			t.Fatal(err)
		}
		counts := map[engineGroup]int{}
		for {
			ev, err := trace.Next(context.Background())
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatal(err)
			}
			if ev.Phase == TraceQualification {
				continue
			}
			group := ev.Group
			if ev.Phase != comp.Attribution {
				group = "0"
			} // only attribution has independent frontiers
			counts[engineGroup{ev.Phase, group}]++
		}
		for phase := range heights {
			if counts[engineGroup{phase, "0"}] == 0 {
				t.Fatalf("variant%d missing phase%d", variant, phase)
			}
		}
		if _, err := trace.Result(); err != nil {
			t.Fatal(err)
		}
		for group, n := range counts {
			capacity := new(big.Int).Lsh(big.NewInt(1), uint(heights[group.Phase]))
			if capacity.Cmp(big.NewInt(int64(n))) < 0 {
				t.Errorf("variant%d phase%d group%s: %d exceeds capacity%s", variant, group.Phase, group.Group, n, capacity)
			}
			t.Logf("variant%d phase%d group%s events=%d capacity=%s", variant, group.Phase, group.Group, n, capacity)
		}
	}
}
