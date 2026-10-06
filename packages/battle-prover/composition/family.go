package composition

import (
	"fmt"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/hash/mimc"
	rec "github.com/consensys/gnark/std/recursion/groth16"
	"math/big"
)

const familyDomain = 440901

// Every approved family exposes exactly three full field commitments. Phase,
// schema version, all endpoint fields and uint256 work are in their preimages.
// A count is never reduced to one BN254 scalar.
type FamilyPublic struct {
	Digests [3]frontend.Variable `gnark:",public"`
}
type FamilyRange struct {
	First, Last [10]frontend.Variable
	Count       p.Uint256
}

func familyNative(phase, role int, vs ...frontend.Variable) *big.Int {
	// resultbridge.Hash prepends domain,length; pass schema,phase,role as data.
	// Use the existing sibling hash with its standard domain,length convention.
	return rb.Hash(familyDomain, append([]frontend.Variable{1, phase, role, len(vs)}, vs...)...)
}
func digest(api frontend.API, phase, role int, vs ...frontend.Variable) frontend.Variable {
	h, _ := mimc.NewMiMC(api)
	h.Write(familyDomain, len(vs)+4, 1, phase, role, len(vs))
	h.Write(vs...)
	return h.Sum()
}
func (r FamilyRange) bind(api frontend.API, phase int, pub FamilyPublic) {
	if phase < Preparation || phase > SettlementOutput {
		panic("unknown phase")
	}
	for i := Width(phase); i < 10; i++ {
		api.AssertIsEqual(r.First[i], 0)
		api.AssertIsEqual(r.Last[i], 0)
	}
	for _, v := range r.Count {
		api.ToBinary(v, 64)
	}
	a := p.New(api)
	api.AssertIsEqual(a.Equal(r.Count, p.Const(0)), 0)
	api.AssertIsEqual(pub.Digests[0], digest(api, phase, 0, r.First[:]...))
	api.AssertIsEqual(pub.Digests[1], digest(api, phase, 0, r.Last[:]...))
	api.AssertIsEqual(pub.Digests[2], digest(api, phase, 1, r.Count[:]...))
}
func (r FamilyRange) Public(phase int) FamilyPublic {
	return FamilyPublic{[3]frontend.Variable{familyNative(phase, 0, r.First[:]...), familyNative(phase, 0, r.Last[:]...), familyNative(phase, 1, r.Count[:]...)}}
}
func Normalize(phase int, r Range, count p.Uint256) FamilyRange {
	var n FamilyRange
	for i := 0; i < 10; i++ {
		n.First[i] = 0
		n.Last[i] = 0
	}
	copy(n.First[:], r.First)
	copy(n.Last[:], r.Last)
	n.Count = count
	return n
}

// FamilyLeaf has ONE real elementary instruction. Its compile-time phase/kind
// is a member of the finite approved catalog, never selected by witness data.
// It is independent of roster length; work increases proof count only.
type FamilyLeaf struct {
	FamilyPublic
	Range       FamilyRange
	Preparation []prepStep
	Combat      []combatStep
	Attribution []attrStep
	Bridge      []bridgeStep
	Reports     []reportStep
	Raw         []rawStep
	Output      []outputStep
	Phase       int `gnark:"-"`
}

func (c *FamilyLeaf) Define(api frontend.API) error {
	n := len(c.Preparation) + len(c.Combat) + len(c.Attribution) + len(c.Bridge) + len(c.Reports) + len(c.Raw) + len(c.Output)
	if n != 1 {
		return fmt.Errorf("family leaf must contain one instruction")
	}
	c.Range.bind(api, c.Phase, c.FamilyPublic)
	p.New(api).AssertEqual(c.Range.Count, p.Const(1))
	inner := Chunk{PublicRange: PublicRange{First: c.Range.First[:Width(c.Phase)], Last: c.Range.Last[:Width(c.Phase)]}, Preparation: c.Preparation, Combat: c.Combat, Attribution: c.Attribution, Bridge: c.Bridge, Reports: c.Reports, Raw: c.Raw, Output: c.Output, Phase: c.Phase}
	return inner.Define(api)
}
func NewFamilyLeaf(c *Chunk) *FamilyLeaf {
	r := Normalize(c.Phase, Range{c.First, c.Last}, p.Const(1))
	return &FamilyLeaf{FamilyPublic: r.Public(c.Phase), Range: r, Preparation: c.Preparation, Combat: c.Combat, Attribution: c.Attribution, Bridge: c.Bridge, Reports: c.Reports, Raw: c.Raw, Output: c.Output, Phase: c.Phase}
}

// CatalogAuth permits only an index into a COMPILE-TIME catalog. The standard
// gnark switch authenticates every VK parameter, including commitment keys and
// metadata. No arbitrary witness VK or hand-written key hashing is used.
type CatalogAuth struct {
	Proof    Proof
	Witness  Witness
	Selector frontend.Variable
	Keys     []Key `gnark:"-"`
}

func (a *CatalogAuth) Verify(api frontend.API, pub FamilyPublic) error {
	if len(a.Witness.Public) != 3 {
		return fmt.Errorf("normalized public schema")
	}
	v, e := rec.NewVerifier[sw_bn254.ScalarField, sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](api)
	if e != nil {
		return e
	}
	key, e := v.SwitchVerificationKey(a.Selector, a.Keys)
	if e != nil {
		return e
	}
	approved := Auth{Proof: a.Proof, Witness: a.Witness, Key: key}
	return approved.Verify(api, pub.Digests[:])
}

// FamilyNode is a unary lift OR binary adjacent merge (different approved keys).
// Use the dispatch-first graph: D0 selects leaf catalog; B_h verifies two
// D_(h-1) proofs under one fixed key; D_h selects [B_h,D_(h-1)]. Level is a
// semantic work height, not a provenance check. Approved root keys pin this
// acyclic DAG; no family includes its own key.
// Unary lift proves a real child, not a terminal identity/no-op transition.
type FamilyNode struct {
	FamilyPublic
	Range       FamilyRange
	Children    []CatalogAuth
	ChildRanges []FamilyRange
	Phase       int `gnark:"-"`
	Level       int `gnark:"-"`
}

func (c *FamilyNode) Define(api frontend.API) error {
	if c.Level < 1 || c.Level > 256 || len(c.Children) < 1 || len(c.Children) > 2 || len(c.Children) != len(c.ChildRanges) {
		return fmt.Errorf("invalid fixed family node shape")
	}
	c.Range.bind(api, c.Phase, c.FamilyPublic)
	for i := range c.Children {
		r := c.ChildRanges[i]
		pub := FamilyPublic{[3]frontend.Variable{digest(api, c.Phase, 0, r.First[:]...), digest(api, c.Phase, 0, r.Last[:]...), digest(api, c.Phase, 1, r.Count[:]...)}}
		r.bind(api, c.Phase, pub)
		if e := c.Children[i].Verify(api, pub); e != nil {
			return e
		}
	}
	first, last := c.ChildRanges[0], c.ChildRanges[len(c.ChildRanges)-1]
	eq(api, c.Range.First[:], first.First[:])
	eq(api, c.Range.Last[:], last.Last[:])
	a := p.New(api)
	if len(c.Children) == 1 {
		a.AssertEqual(c.Range.Count, first.Count)
	} else {
		link(api, c.Phase, first.Last[:Width(c.Phase)], last.First[:Width(c.Phase)])
		a.AssertEqual(c.Range.Count, a.AddChecked(first.Count, last.Count))
	}
	return nil
}

// CompleteClose is the only normalized bridge Close family. Its attribution
// catalog is pinned to a designated COMPLETE-root level; completion is checked
// here as well. Both context and exact allocation result discharge the debt.
type CompleteClose struct {
	FamilyPublic
	Range      FamilyRange
	Step       bridgeStep
	Allocation FamilyRange
	Auth       CatalogAuth
}

func (c *CompleteClose) Define(api frontend.API) error {
	c.Range.bind(api, Bridge, c.FamilyPublic)
	p.New(api).AssertEqual(c.Range.Count, p.Const(1))
	if c.Step.Kind != rb.Close {
		return fmt.Errorf("expected Close")
	}
	if e := c.Step.Define(api); e != nil {
		return e
	}
	s := c.Step.Statement()
	eq(api, c.Range.First[:], s[:])
	eq(api, c.Range.Last[:], s[:])
	ar := c.Allocation
	pub := FamilyPublic{[3]frontend.Variable{digest(api, Attribution, 0, ar.First[:]...), digest(api, Attribution, 0, ar.Last[:]...), digest(api, Attribution, 1, ar.Count[:]...)}}
	ar.bind(api, Attribution, pub)
	if e := c.Auth.Verify(api, pub); e != nil {
		return e
	}
	rb.AssertAttribution(api, s, [5]frontend.Variable(ar.First[:5]), [5]frontend.Variable(ar.Last[:5]))
	return nil
}

// Schedule is a host plan, never authentication. Nodes are grouped by level,
// one or two children, without padding/replay; keys depend ONLY on phase/level/
// arity, not this plan's roster values or leaf-kind order.
type ScheduledNode struct{ Level, Start, End, Arity int }

func Schedule(leaves int) ([][]ScheduledNode, error) {
	if leaves < 1 {
		return nil, fmt.Errorf("nonempty work required")
	}
	current := make([]ScheduledNode, leaves)
	for i := range current {
		current[i] = ScheduledNode{0, i, i + 1, 0}
	}
	levels := [][]ScheduledNode{}
	for level := 1; len(current) > 1; level++ {
		if level > 256 {
			return nil, fmt.Errorf("uint256 work bound")
		}
		next := []ScheduledNode{}
		for i := 0; i < len(current); i += 2 {
			n := ScheduledNode{level, current[i].Start, current[i].End, 1}
			if i+1 < len(current) {
				n.End = current[i+1].End
				n.Arity = 2
			}
			next = append(next, n)
		}
		levels = append(levels, next)
		current = next
	}
	return levels, nil
}
