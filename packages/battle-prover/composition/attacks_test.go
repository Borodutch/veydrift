package composition

import (
	"fmt"
	"github.com/consensys/gnark/frontend"
	"reflect"
	"testing"
)

func TestMaliciousTraces(t *testing.T) {
	f := build(t)
	for _, original := range []*Chunk{f.prep, f.combat, f.allocation, f.report} {
		cc := compile(t, fmt.Sprintf("attacks-phase%d", original.Phase), original)
		for _, name := range []string{"genesis", "premature", "result", "replay", "omission"} {
			c := clone(reflect.ValueOf(original)).Interface().(*Chunk)
			switch name {
			case "genesis":
				c.First[map[int]int{Preparation: 1, Combat: 1, Attribution: 1, Report: 3}[c.Phase]] = 1
			case "premature":
				c.Last = append([]frontend.Variable{}, c.First...)
				if c.Phase == Report {
					c.Last[5] = 0
					c.Last[6] = 0
				}
			case "result":
				c.Last[len(c.Last)-1] = 1
			case "replay":
				switch c.Phase {
				case Preparation:
					c.Preparation[1] = c.Preparation[0]
				case Combat:
					c.Combat[1] = c.Combat[0]
				case Attribution:
					c.Attribution[1] = c.Attribution[0]
				case Report:
					continue
				}
			case "omission":
				switch c.Phase {
				case Preparation:
					c.Preparation[2] = c.Preparation[3]
				case Combat:
					c.Combat[1] = c.Combat[2]
				case Attribution:
					c.Attribution[1] = c.Attribution[2]
				case Report:
					continue
				}
			}
			if cc.IsSolved(wit(t, c)) == nil {
				t.Fatalf("accepted %s phase%d", name, c.Phase)
			}
			t.Logf("REJECTED %s phase%d compiled real protocol constraints", name, c.Phase)
		}
	}
}
