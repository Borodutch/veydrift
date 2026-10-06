package composition

import (
	"fmt"
	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
)

// LeafShape constructs only the audited elementary relations, without a roster
// or witness. Setup builders can compile these once and reuse them for any input
// accepted by the corresponding phase instruction. Raw bridge Close is refused.
func LeafShape(phase, kind int) (*FamilyLeaf, error) {
	id := FamilyID{Phase: phase, Kind: kind}
	if !id.Valid() {
		return nil, fmt.Errorf("invalid leaf family")
	}
	c := &FamilyLeaf{Phase: phase}
	switch phase {
	case Preparation:
		c.Preparation = []prepStep{privateprepStep(prep.Shape(kind))}
	case Combat:
		c.Combat = []combatStep{privatecombatStep(mb.Shape(kind))}
	case Attribution:
		c.Attribution = []attrStep{privateattrStep(attr.Shape(kind))}
	case Bridge:
		if kind == rb.Close {
			return nil, fmt.Errorf("Close requires CompleteClose and approved attribution catalog")
		}
		c.Bridge = []bridgeStep{privatebridgeStep(rb.Shape(kind))}
	case Report:
		c.Reports = []reportStep{privatereportStep(rb.ReportShape(kind))}
	}
	return c, nil
}
