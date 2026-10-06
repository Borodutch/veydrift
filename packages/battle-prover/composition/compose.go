// Package composition authenticates phase traces with pinned gnark Groth16 keys.
// The bounded example is NOT arbitrary-height production recursion.
package composition

import (
	"fmt"
	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	rec "github.com/consensys/gnark/std/recursion/groth16"
	"math/big"
)

type Proof = rec.Proof[sw_bn254.G1Affine, sw_bn254.G2Affine]
type Witness = rec.Witness[sw_bn254.ScalarField]
type Key = rec.VerifyingKey[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl]
type Range struct{ First, Last []frontend.Variable }
type PublicRange struct {
	First, Last []frontend.Variable `gnark:",public"`
}

const (
	Preparation = iota
	Combat
	Attribution
	Bridge
	Report
)

func Width(phase int) int { return []int{4, 8, 5, 10, 7}[phase] }
func eq(api frontend.API, a, b []frontend.Variable) {
	for i := range a {
		api.AssertIsEqual(a[i], b[i])
	}
}
func link(api frontend.API, phase int, a, b []frontend.Variable) {
	switch phase {
	case Preparation:
		prep.LinkStatements(api, prep.Statement(a), prep.Statement(b))
	case Combat:
		mb.AssertLinked(api, mb.Statement(a), mb.Statement(b))
	case Attribution:
		attr.AssertLinked(api, attr.Statement(a), attr.Statement(b))
	case Bridge:
		rb.AssertLinked(api, rb.Statement(a), rb.Statement(b))
	case Report:
		rb.AssertReportLinked(api, rb.ReportStatement(a), rb.ReportStatement(b))
	}
}
func complete(api frontend.API, phase int, a, b []frontend.Variable) {
	switch phase {
	case Preparation:
		prep.AssertComplete(api, prep.Statement(a), prep.Statement(b))
	case Combat:
		mb.AssertComplete(api, mb.Statement(a), mb.Statement(b))
		genesis := mb.State{Memory: mb.NewMemory().Root(), Report: big.NewInt(0)}
		api.AssertIsEqual(a[1], genesis.Commitment())
		api.AssertIsDifferent(b[4], 0)
	case Attribution:
		attr.AssertComplete(api, attr.Statement(a), attr.Statement(b))
	case Bridge:
		rb.AssertComplete(api, rb.Statement(a), rb.Statement(b))
	case Report:
		rb.AssertReportComplete(api, rb.ReportStatement(a), rb.ReportStatement(b))
	default:
		panic("unknown phase")
	}
}

// Chunk invokes real protocol circuits. Fixed schedules are approved key
// families, never witness-selected. Private wrappers remove nested public tags
// while delegating every constraint to the original protocol circuit.
type Chunk struct {
	PublicRange
	Preparation []prepStep
	Combat      []combatStep
	Attribution []attrStep
	Bridge      []bridgeStep
	Reports     []reportStep
	Phase       int  `gnark:"-"`
	Complete    bool `gnark:"-"`
}

func (c *Chunk) Define(api frontend.API) error {
	var statements [][]frontend.Variable
	add := func(s []frontend.Variable, e error) error {
		if e != nil {
			return e
		}
		statements = append(statements, s)
		return nil
	}
	switch c.Phase {
	case Preparation:
		for i := range c.Preparation {
			x := &c.Preparation[i]
			s := x.Statement()
			if e := add(s[:], x.Define(api)); e != nil {
				return e
			}
		}
	case Combat:
		for i := range c.Combat {
			x := &c.Combat[i]
			s := x.Statement()
			if e := add(s[:], x.Define(api)); e != nil {
				return e
			}
		}
	case Attribution:
		for i := range c.Attribution {
			x := &c.Attribution[i]
			s := x.Statement()
			if e := add(s[:], x.Define(api)); e != nil {
				return e
			}
		}
	case Bridge:
		for i := range c.Bridge {
			x := &c.Bridge[i]
			if x.Kind == rb.Close {
				return fmt.Errorf("Close requires attribution proof")
			}
			s := x.Statement()
			if e := add(s[:], x.Define(api)); e != nil {
				return e
			}
		}
	case Report:
		for i := range c.Reports {
			x := &c.Reports[i]
			s := x.Statement()
			if e := add(s[:], x.Define(api)); e != nil {
				return e
			}
		}
	default:
		return fmt.Errorf("unknown phase")
	}
	if len(statements) == 0 || len(c.First) != Width(c.Phase) || len(c.Last) != Width(c.Phase) {
		return fmt.Errorf("invalid chunk shape")
	}
	eq(api, c.First, statements[0])
	eq(api, c.Last, statements[len(statements)-1])
	for i := 1; i < len(statements); i++ {
		link(api, c.Phase, statements[i-1], statements[i])
	}
	if c.Complete {
		complete(api, c.Phase, c.First, c.Last)
	}
	return nil
}

// Auth uses constant VKs, complete arithmetic and subgroup checks. No claims-only
// leaf or witness-selected verification key is an approved dependency.
type Auth struct {
	Proof   Proof
	Witness Witness
	Key     Key `gnark:"-"`
}

func (a *Auth) Verify(api frontend.API, values []frontend.Variable) error {
	if len(a.Witness.Public) != len(values) {
		return fmt.Errorf("public schema mismatch: %d != %d", len(a.Witness.Public), len(values))
	}
	v, e := rec.NewVerifier[sw_bn254.ScalarField, sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](api)
	if e != nil {
		return e
	}
	if e = v.AssertProof(a.Key, a.Proof, a.Witness, rec.WithCompleteArithmetic(), rec.WithSubgroupCheck()); e != nil {
		return e
	}
	f, e := emulated.NewField[sw_bn254.ScalarField](api)
	if e != nil {
		return e
	}
	for i, x := range values {
		bits := api.ToBinary(x, 254)
		limbs := []frontend.Variable{api.FromBinary(bits[:64]...), api.FromBinary(bits[64:128]...), api.FromBinary(bits[128:192]...), api.FromBinary(bits[192:]...)}
		f.AssertIsEqual(&a.Witness.Public[i], f.NewElement(limbs))
	}
	return nil
}
func (r Range) values() []frontend.Variable {
	return append(append([]frontend.Variable{}, r.First...), r.Last...)
}

// Pair proves complete adjacency. No identity padding or ignored suffix.
type Pair struct {
	PublicRange
	Children [2]Auth
	Ranges   [2]Range
	Phase    int  `gnark:"-"`
	Complete bool `gnark:"-"`
}

func (c *Pair) Define(api frontend.API) error {
	for i := range c.Children {
		if e := c.Children[i].Verify(api, c.Ranges[i].values()); e != nil {
			return e
		}
	}
	eq(api, c.First, c.Ranges[0].First)
	eq(api, c.Last, c.Ranges[1].Last)
	link(api, c.Phase, c.Ranges[0].Last, c.Ranges[1].First)
	if c.Complete {
		complete(api, c.Phase, c.First, c.Last)
	}
	return nil
}

// AuthenticatedClose discharges a complete verified attribution obligation.
type AuthenticatedClose struct {
	PublicRange
	Step        bridgeStep
	Attribution Auth
	Allocation  Range
}

func (c *AuthenticatedClose) Define(api frontend.API) error {
	if c.Step.Kind != rb.Close {
		return fmt.Errorf("not Close")
	}
	if e := c.Step.Define(api); e != nil {
		return e
	}
	if e := c.Attribution.Verify(api, c.Allocation.values()); e != nil {
		return e
	}
	s := c.Step.Statement()
	eq(api, c.First, s[:])
	eq(api, c.Last, s[:])
	rb.AssertAttribution(api, s, attr.Statement(c.Allocation.First), attr.Statement(c.Allocation.Last))
	return nil
}

// Join has two verifications per level. Mode0=prep/combat, 1=bridge/report,
// 2=final. Public=[prepContext,prepared,input,combatResult,context,allocation,
// report,completeResult]. Root key pins the dependency DAG.
type Join struct {
	Public         [8]frontend.Variable `gnark:",public"`
	Children       [2]Auth
	Ranges         [2]Range
	ChildrenPublic [2][8]frontend.Variable
	Mode           int `gnark:"-"`
}

func (c *Join) Define(api frontend.API) error {
	if c.Mode < 0 || c.Mode > 2 {
		return fmt.Errorf("bad join")
	}
	if c.Mode < 2 {
		for i := range c.Children {
			if e := c.Children[i].Verify(api, c.Ranges[i].values()); e != nil {
				return e
			}
		}
		a, b := c.Ranges[0], c.Ranges[1]
		if c.Mode == 0 {
			complete(api, Preparation, a.First, a.Last)
			complete(api, Combat, b.First, b.Last)
			eq(api, c.Public[:4], []frontend.Variable{a.First[0], a.Last[3], b.First[0], b.Last[7]})
			for _, v := range c.Public[4:] {
				api.AssertIsEqual(v, 0)
			}
		} else {
			complete(api, Bridge, a.First, a.Last)
			complete(api, Report, b.First, b.Last)
			rb.AssertCombinedResult(api, rb.Statement(a.Last), rb.ReportStatement(b.Last), c.Public[7])
			api.AssertIsEqual(c.Public[0], 0)
			eq(api, c.Public[1:7], []frontend.Variable{a.Last[1], a.Last[2], a.Last[3], a.Last[0], a.Last[7], b.Last[6]})
		}
	} else {
		for i := range c.Children {
			if e := c.Children[i].Verify(api, c.ChildrenPublic[i][:]); e != nil {
				return e
			}
		}
		a, b := c.ChildrenPublic[0], c.ChildrenPublic[1]
		eq(api, a[1:4], b[1:4])
		eq(api, c.Public[:4], a[:4])
		eq(api, c.Public[4:], b[4:])
	}
	return nil
}
