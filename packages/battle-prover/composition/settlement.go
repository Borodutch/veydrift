package composition

import (
	out "github.com/Borodutch/veydrift/packages/battle-prover/outputbridge"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/consensys/gnark/frontend"
)

const rawQualifiedDomain = 440910
const outputPipelineDomain = 440911

// These are NEW raw-linked adapters. QualifiedFinal's legacy SHA schema is
// intentionally untouched. Different circuits, public layouts and approved keys.
type RawQualifiedClaims struct {
	RawFirst, RawLast raw.Statement
	Qualified         q.LinkedStatement
}

func (c RawQualifiedClaims) values() []frontend.Variable {
	v := append([]frontend.Variable{}, c.RawFirst[:]...)
	v = append(v, c.RawLast[:]...)
	return append(v, c.Qualified[:]...)
}

type OutputPipelineClaims struct {
	First, Last out.Statement
	Pipeline    [8]frontend.Variable
}

func (c OutputPipelineClaims) values() []frontend.Variable {
	v := append([]frontend.Variable{}, c.First[:]...)
	v = append(v, c.Last[:]...)
	return append(v, c.Pipeline[:]...)
}

// RawQualified verifies a COMPLETE raw prefix and actual LinkedCircuit proof.
// Normalized raw root keys must recursively authenticate every Source/Row edge.
type RawQualified struct {
	Digest        frontend.Variable `gnark:",public"`
	Claims        RawQualifiedClaims
	Raw           Auth
	RawRange      FamilyRange
	Qualification Auth
}

func (c *RawQualified) Define(api frontend.API) error {
	r := c.RawRange
	pub := FamilyPublic{[3]frontend.Variable{digest(api, RawJournal, 0, r.First[:]...), digest(api, RawJournal, 0, r.Last[:]...), digest(api, RawJournal, 1, r.Count[:]...)}}
	r.bind(api, RawJournal, pub)
	if e := c.Raw.Verify(api, pub.Digests[:]); e != nil {
		return e
	}
	if e := c.Qualification.Verify(api, c.Claims.Qualified[:]); e != nil {
		return e
	}
	eq(api, c.Claims.RawFirst[:], r.First[:5])
	eq(api, c.Claims.RawLast[:], r.Last[:5])
	raw.AssertComplete(api, c.Claims.RawFirst, c.Claims.RawLast)
	api.AssertIsEqual(c.Claims.Qualified[2], c.Claims.RawLast[3])
	api.AssertIsEqual(c.Digest, raw.Hash(api, rawQualifiedDomain, c.Claims.values()...))
	return nil
}

// OutputPipeline verifies a complete normalized output range and complete
// eight-public upstream pipeline under approved keys, retaining all endpoints.
type OutputPipeline struct {
	Digest      frontend.Variable `gnark:",public"`
	Claims      OutputPipelineClaims
	Output      Auth
	OutputRange FamilyRange
	Pipeline    Auth
}

func (c *OutputPipeline) Define(api frontend.API) error {
	r := c.OutputRange
	pub := FamilyPublic{[3]frontend.Variable{digest(api, SettlementOutput, 0, r.First[:]...), digest(api, SettlementOutput, 0, r.Last[:]...), digest(api, SettlementOutput, 1, r.Count[:]...)}}
	r.bind(api, SettlementOutput, pub)
	if e := c.Output.Verify(api, pub.Digests[:]); e != nil {
		return e
	}
	if e := c.Pipeline.Verify(api, c.Claims.Pipeline[:]); e != nil {
		return e
	}
	eq(api, c.Claims.First[:], r.First[:5])
	eq(api, c.Claims.Last[:], r.Last[:5])
	out.AssertComplete(api, c.Claims.First, c.Claims.Last)
	api.AssertIsEqual(c.Digest, raw.Hash(api, outputPipelineDomain, c.Claims.values()...))
	return nil
}

// SettlementFinal emits EXACTLY outputbridge's22 Solidity fields. Both bundle
// proofs are verified before invoking any equality helper. No proof obligation
// is accepted as native FromBridge advice. Manifest is authenticated by the
// verified output binding and checked against every verified dependency.
type SettlementFinal struct {
	Public         out.Settlement `gnark:",public"`
	Provenance     Auth
	Results        Auth
	RawQualified   RawQualifiedClaims
	OutputPipeline OutputPipelineClaims
	Manifest       out.Manifest
}

func (c *SettlementFinal) Define(api frontend.API) error {
	a := raw.Hash(api, rawQualifiedDomain, c.RawQualified.values()...)
	b := raw.Hash(api, outputPipelineDomain, c.OutputPipeline.values()...)
	if e := c.Provenance.Verify(api, []frontend.Variable{a}); e != nil {
		return e
	}
	if e := c.Results.Verify(api, []frontend.Variable{b}); e != nil {
		return e
	}
	out.AssertAuthenticated(api, c.OutputPipeline.First, c.OutputPipeline.Last, c.Manifest, c.OutputPipeline.Pipeline, c.RawQualified.Qualified, c.RawQualified.RawFirst, c.RawQualified.RawLast, c.Public)
	return nil
}
