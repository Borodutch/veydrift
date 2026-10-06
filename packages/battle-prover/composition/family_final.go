package composition

import (
	"fmt"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark/frontend"
)

// FamilyPhaseJoin verifies fixed-height normalized roots. Mode0 opens complete
// preparation/combat; Mode1 opens complete bridge/report. Their eight-scalar
// outputs feed the already implemented Join Mode2 and then QualifiedFinal.
// The caller must compile with APPROVED level256 catalogs (or explicitly label
// a smaller test height). No phase completion is delegated to host scheduling.
type FamilyPhaseJoin struct {
	Public   [8]frontend.Variable `gnark:",public"`
	Children [2]CatalogAuth
	Ranges   [2]FamilyRange
	Mode     int `gnark:"-"`
}

func (c *FamilyPhaseJoin) Define(api frontend.API) error {
	if c.Mode != 0 && c.Mode != 1 {
		return fmt.Errorf("invalid phase join")
	}
	phases := [2]int{Preparation, Combat}
	if c.Mode == 1 {
		phases = [2]int{Bridge, Report}
	}
	for i, phase := range phases {
		r := c.Ranges[i]
		pub := FamilyPublic{[3]frontend.Variable{digest(api, phase, 0, r.First[:]...), digest(api, phase, 0, r.Last[:]...), digest(api, phase, 1, r.Count[:]...)}}
		r.bind(api, phase, pub)
		if e := c.Children[i].Verify(api, pub); e != nil {
			return e
		}
		complete(api, phase, r.First[:Width(phase)], r.Last[:Width(phase)])
	}
	a, b := c.Ranges[0], c.Ranges[1]
	if c.Mode == 0 {
		eq(api, c.Public[:4], []frontend.Variable{a.First[0], a.Last[3], b.First[0], b.Last[7]})
		for _, v := range c.Public[4:] {
			api.AssertIsEqual(v, 0)
		}
	} else {
		rb.AssertCombinedResult(api, rb.Statement(a.Last[:]), rb.ReportStatement(b.Last[:7]), c.Public[7])
		api.AssertIsEqual(c.Public[0], 0)
		eq(api, c.Public[1:7], []frontend.Variable{a.Last[1], a.Last[2], a.Last[3], a.Last[0], a.Last[7], b.Last[6]})
	}
	return nil
}
