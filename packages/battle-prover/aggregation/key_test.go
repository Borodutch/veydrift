//go:build !plonk_experiment

package aggregation

import (
	"testing"
)

// Real leaf proofs, actual compiled recursive verifier, constraint solving only.
// The opt-in tree test separately generates genuine outer proofs.
func TestUnapprovedKeyRejected(t *testing.T) {
	if testing.Short() {
		t.Skip("large recursive verifier compilation; run without -short")
	}
	cc := compiled(t, &Step{})
	makeLevel := func() level { return setup(t, cc) }
	approved, other := makeLevel(), makeLevel()
	a := prove(t, approved, &Step{span(2, 0, 1)}, span(2, 0, 1))
	b := prove(t, approved, &Step{span(2, 1, 2)}, span(2, 1, 2))
	template := nodeTemplate(t, approved)
	outer := compiled(t, template)
	check(t, outer.IsSolved(wit(t, node(a, b))))
	b = prove(t, other, &Step{span(2, 1, 2)}, span(2, 1, 2))
	if outer.IsSolved(wit(t, node(a, b))) == nil {
		t.Fatal("proof under unapproved SRS/key accepted")
	}
}
