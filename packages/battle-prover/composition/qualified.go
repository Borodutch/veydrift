package composition

import (
	"fmt"
	"github.com/consensys/gnark/frontend"
)

// QualifiedFinal authenticates BOTH a complete pipeline root and the separate
// seven-field qualification proof under constant approved keys. Its public
// Chain commitment must be compared to the frozen on-chain record by settlement.
// This circuit is not part of the current unqualified bounded proof receipt.
type QualifiedFinal struct {
	Public         [8]frontend.Variable `gnark:",public"`
	Chain          [4]frontend.Variable `gnark:",public"`
	Version        frontend.Variable    `gnark:",public"`
	Pipeline       Auth
	Qualification  Auth
	PipelinePublic [8]frontend.Variable
	Qualified      [7]frontend.Variable
}

func (c *QualifiedFinal) Define(api frontend.API) error {
	if len(c.Pipeline.Witness.Public) != 8 || len(c.Qualification.Witness.Public) != 7 {
		return fmt.Errorf("qualification schema")
	}
	if e := c.Pipeline.Verify(api, c.PipelinePublic[:]); e != nil {
		return e
	}
	if e := c.Qualification.Verify(api, c.Qualified[:]); e != nil {
		return e
	}
	eq(api, c.Public[:], c.PipelinePublic[:])
	api.AssertIsEqual(c.Qualified[0], c.Public[0])
	api.AssertIsEqual(c.Qualified[1], c.Public[2])
	eq(api, c.Chain[:], c.Qualified[2:6])
	for _, x := range c.Chain {
		api.ToBinary(x, 64)
	}
	api.AssertIsEqual(c.Version, 1)
	api.AssertIsEqual(c.Version, c.Qualified[6])
	return nil
}
