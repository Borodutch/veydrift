//go:build !plonk_experiment

package aggregation

import (
	battle "github.com/Borodutch/veydrift/packages/battle-prover/battle"
	"testing"
)

func TestCombatBatchRejectsForgery(t *testing.T) {
	if testing.Short() {
		t.Skip("large full combat compile")
	}
	c := combatConfig()
	ss := []battle.State{{}}
	for len(ss) < 128 {
		next, e := c.Next([32]byte{}, ss[len(ss)-1])
		check(t, e)
		ss = append(ss, next)
		if next.Phase == battle.Done {
			break
		}
	}
	if ss[len(ss)-1].Phase != battle.Done {
		t.Fatal("fixture incomplete")
	}
	a := combatAssignment(c, ss)
	template := &combatBatch{Steps: make([]combatPrivateStep, len(a.Steps))}
	for i := range template.Steps {
		template.Steps[i].Config = c
		template.Steps[i].RNG = a.Steps[i].RNG
	}
	cc := compiled(t, template)
	check(t, cc.IsSolved(wit(t, a)))
	for _, name := range []string{"output", "context", "replay", "counter", "terminal", "state"} {
		bad := *a
		bad.Steps = append([]combatPrivateStep(nil), a.Steps...)
		switch name {
		case "output":
			bad.After = 1
		case "context":
			bad.Context = 1
		case "replay":
			bad.Steps[1] = bad.Steps[0]
		case "counter":
			bad.End = 1
		case "terminal":
			bad.AfterDone = 0
		case "state":
			bad.Steps[2].Before[8] = 999
		}
		if cc.IsSolved(wit(t, &bad)) == nil {
			t.Fatalf("combat %s forgery accepted", name)
		}
		t.Logf("rejected %s", name)
	}
}
