package composition

import (
	"fmt"
	"github.com/consensys/gnark/constraint"
	"reflect"
	"runtime"
	"testing"
)

func TestAllLeafCatalogSchemas(t *testing.T) {
	for phase := Preparation; phase <= Report; phase++ {
		var prior [][]int
		for kind := 0; kind < []int{5, 11, 4, 5, 2}[phase]; kind++ {
			if phase == Bridge && kind == 3 {
				if _, e := LeafShape(phase, kind); e == nil {
					t.Fatal("raw Close allowed")
				}
				continue
			}
			shape, e := LeafShape(phase, kind)
			check(t, e)
			cc := compile(t, fmt.Sprintf("catalog-schema-%d-%d", phase, kind), shape)
			if cc.GetNbPublicVariables() != 4 {
				t.Fatal("public width")
			}
			cm := cc.GetCommitments().(constraint.Groth16Commitments)
			layout := cm.GetPublicAndCommitmentCommitted(cm.CommitmentIndexes(), cc.GetNbPublicVariables())
			if prior != nil && !reflect.DeepEqual(prior, layout) {
				t.Fatalf("incompatible phase%d kind%d metadata", phase, kind)
			}
			prior = layout
			t.Logf("SCHEMA phase=%d kind=%d commitments=%d metadata=%v", phase, kind, len(cm), layout)
			cc = nil
			runtime.GC()
		}
	}
	t.Log("all26 ordinary leaf shapes compatible by phase; CompleteClose/recursive catalogs tested separately, not inferred")
}
