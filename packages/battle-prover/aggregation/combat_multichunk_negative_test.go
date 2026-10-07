//go:build !plonk_experiment

package aggregation

import (
	battle "github.com/Borodutch/veydrift/packages/battle-prover/battle"
	"testing"
)

func TestCombatChunkRejectsConsistentResultForgery(t *testing.T) {
	if testing.Short() {
		t.Skip("actual combat chunk compile")
	}
	c, ss := combatTrace(t)
	good := combatAssignment(c, ss[15:])
	l := level{cc: compiled(t, combatTemplate(good))}
	check(t, l.cc.IsSolved(wit(t, good)))
	for _, name := range []string{"outcome", "survivor", "shot accounting"} {
		forged := append([]battle.State(nil), ss[15:]...)
		last := &forged[len(forged)-1]
		switch name {
		case "outcome":
			last.Outcome = 2
		case "survivor":
			last.Hull[0] = 0
		case "shot accounting":
			last.Shots[0]++
		}
		// Recompute every commitment and public endpoint consistently. Rejection
		// must come from executed battle semantics, not an inconsistent hash opening.
		bad := combatAssignment(c, forged)
		rejectCombat(t, l, "consistently committed terminal "+name, bad)
	}
}
