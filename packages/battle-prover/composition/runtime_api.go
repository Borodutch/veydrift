package composition

import (
	"fmt"
	"math/big"

	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	out "github.com/Borodutch/veydrift/packages/battle-prover/outputbridge"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/frontend"
)

// NewLeafWitness wraps one native instruction without changing its relation.
// Close has an additional proof obligation and must use NewCloseWitness.
func NewLeafWitness(step frontend.Circuit) (*FamilyLeaf, error) {
	c := &Chunk{}
	var statement []frontend.Variable
	kind := -1
	switch s := step.(type) {
	case *prep.Step:
		if s == nil {
			return nil, fmt.Errorf("nil preparation step")
		}
		c.Phase = Preparation
		kind = s.Kind
		c.Preparation = []prepStep{privateprepStep(s)}
		v := s.Statement()
		statement = v[:]
	case *mb.Step:
		if s == nil {
			return nil, fmt.Errorf("nil combat step")
		}
		c.Phase = Combat
		kind = s.Kind
		c.Combat = []combatStep{privatecombatStep(s)}
		v := s.Statement()
		statement = v[:]
	case *attr.Step:
		if s == nil {
			return nil, fmt.Errorf("nil attribution step")
		}
		c.Phase = Attribution
		kind = s.Kind
		c.Attribution = []attrStep{privateattrStep(s)}
		v := s.Statement()
		statement = v[:]
	case *rb.Step:
		if s == nil {
			return nil, fmt.Errorf("nil bridge step")
		}
		if s.Kind == rb.Close {
			return nil, fmt.Errorf("Close requires NewCloseWitness and approved attribution root")
		}
		c.Phase = Bridge
		kind = s.Kind
		c.Bridge = []bridgeStep{privatebridgeStep(s)}
		v := s.Statement()
		statement = v[:]
	case *rb.ReportStep:
		if s == nil {
			return nil, fmt.Errorf("nil report step")
		}
		c.Phase = Report
		kind = s.Kind
		c.Reports = []reportStep{privatereportStep(s)}
		v := s.Statement()
		statement = v[:]
	case *raw.Step:
		if s == nil {
			return nil, fmt.Errorf("nil raw step")
		}
		c.Phase = RawJournal
		kind = s.Kind
		c.Raw = []rawStep{privateRaw(s)}
		v := s.Statement()
		statement = v[:]
	case *out.Step:
		if s == nil {
			return nil, fmt.Errorf("nil output step")
		}
		c.Phase = SettlementOutput
		kind = s.Kind
		c.Output = []outputStep{privateOutput(s)}
		v := s.Statement()
		statement = v[:]
	default:
		return nil, fmt.Errorf("unsupported leaf instruction %T", step)
	}
	if !(FamilyID{Phase: c.Phase, Kind: kind}).Valid() {
		return nil, fmt.Errorf("invalid leaf kind")
	}
	r, err := runtimeRange(c.Phase, Normalize(c.Phase, Range{statement, statement}, p.Const(1)))
	if err != nil {
		return nil, err
	}
	c.PublicRange = PublicRange{r.First[:Width(c.Phase)], r.Last[:Width(c.Phase)]}
	return NewFamilyLeaf(c), nil
}

// NewCloseWitness retains the existing CompleteClose proof/completion relation.
// attributionAuth.Keys must be approved complete-attribution-root constants.
func NewCloseWitness(step *rb.Step, attributionRange FamilyRange, attributionAuth CatalogAuth) (*CompleteClose, error) {
	if step == nil || step.Kind != rb.Close {
		return nil, fmt.Errorf("expected bridge Close")
	}
	ar, err := runtimeRange(Attribution, attributionRange)
	if err != nil {
		return nil, err
	}
	if err = runtimeAuth(attributionAuth); err != nil {
		return nil, err
	}
	st := step.Statement()
	r, err := runtimeRange(Bridge, Normalize(Bridge, Range{st[:], st[:]}, p.Const(1)))
	if err != nil {
		return nil, err
	}
	// These cheap consistency checks do not replace recursive proof verification.
	if ar.First[0].(*big.Int).Cmp(ar.Last[0].(*big.Int)) != 0 || ar.Last[3].(*big.Int).Cmp(big.NewInt(1)) != 0 || r.First[8].(*big.Int).Cmp(ar.First[0].(*big.Int)) != 0 || r.First[9].(*big.Int).Cmp(ar.Last[4].(*big.Int)) != 0 {
		return nil, fmt.Errorf("Close attribution context/result/completion mismatch")
	}
	return &CompleteClose{FamilyPublic: r.Public(Bridge), Range: r, Step: privatebridgeStep(step), Allocation: ar, Auth: attributionAuth}, nil
}

// NewNodeWitness constructs only the dispatch-first family DAG. keys are trusted
// setup constants in Dependencies(id) order, never arbitrary witness VKs.
// Envelopes carry no phase/level provenance: approved keys and the existing
// recursive relation authenticate that provenance and endpoint adjacency.
func NewNodeWitness(id FamilyID, children []FamilyEnvelope, keys []Key, selectors []int) (*FamilyNode, error) {
	deps, err := Dependencies(id)
	if err != nil {
		return nil, err
	}
	if len(children) != id.Arity || len(selectors) != len(children) || len(keys) != len(deps) {
		return nil, fmt.Errorf("node arity/catalog mismatch")
	}
	entries := make(map[FamilyID]Key, len(deps))
	for i, dep := range deps {
		entries[dep] = keys[i]
	}
	catalog, err := NewKeyCatalog(entries)
	if err != nil {
		return nil, err
	}
	approved, err := catalog.ForFamily(id)
	if err != nil {
		return nil, err
	}
	n := &FamilyNode{Phase: id.Phase, Level: id.Level}
	if n.Level == 0 {
		n.Level = 1
	}
	total := new(big.Int)
	for i, child := range children {
		sel := selectors[i]
		if sel < 0 || sel >= len(deps) {
			return nil, fmt.Errorf("invalid child selector")
		}
		if id.Level == 0 && child.Kind != sel {
			return nil, fmt.Errorf("leaf kind/selector mismatch")
		}
		r, err := runtimeRange(id.Phase, child.Range)
		if err != nil {
			return nil, fmt.Errorf("child %d: %w", i, err)
		}
		count := runtimeCount(r)
		dep := deps[sel]
		max := new(big.Int).Lsh(big.NewInt(1), uint(dep.Level))
		if count.Cmp(max) > 0 || (dep.Arity == 2 && count.Cmp(big.NewInt(2)) < 0) {
			return nil, fmt.Errorf("child count exceeds dependency height/arity")
		}
		a := child.Auth
		a.Keys = approved
		a.Selector = sel
		if err := runtimeAuth(a); err != nil {
			return nil, err
		}
		n.Children = append(n.Children, a)
		n.ChildRanges = append(n.ChildRanges, r)
		total.Add(total, count)
	}
	if total.BitLen() > 256 {
		return nil, fmt.Errorf("uint256 work overflow")
	}
	n.Range = n.ChildRanges[0]
	n.Range.Last = n.ChildRanges[len(children)-1].Last
	n.Range.Count = p.MustValue(total)
	n.FamilyPublic = n.Range.Public(id.Phase)
	return n, nil
}

func runtimeAuth(a CatalogAuth) error {
	if len(a.Witness.Public) != 3 || len(a.Keys) == 0 {
		return fmt.Errorf("normalized auth schema")
	}
	sel, err := runtimeScalar(a.Selector)
	if err != nil || !sel.IsInt64() || sel.Int64() >= int64(len(a.Keys)) {
		return fmt.Errorf("invalid catalog selector")
	}
	// Schema validation only: the caller, not this constructor, approves keys.
	for _, key := range a.Keys {
		if len(key.G1.K) != 4+len(key.CommitmentKeys) {
			return fmt.Errorf("normalized VK schema")
		}
	}
	// SwitchVerificationKey requires every selected catalog key to share layout.
	first := a.Keys[0]
	for _, key := range a.Keys[1:] {
		if len(key.G1.K) != len(first.G1.K) || len(key.CommitmentKeys) != len(first.CommitmentKeys) || len(key.PublicAndCommitmentCommitted) != len(first.PublicAndCommitmentCommitted) {
			return fmt.Errorf("incompatible key schemas")
		}
		for i, row := range key.PublicAndCommitmentCommitted {
			if len(row) != len(first.PublicAndCommitmentCommitted[i]) {
				return fmt.Errorf("incompatible commitment metadata")
			}
			for j, v := range row {
				if v != first.PublicAndCommitmentCommitted[i][j] {
					return fmt.Errorf("incompatible committed public layout")
				}
			}
		}
	}
	return nil
}

// CanonicalRange serializes endpoints followed by four little-endian uint64 work
// limbs as canonical decimal strings. It never reduces malformed field values.
func CanonicalRange(phase int, r FamilyRange) ([24]string, error) {
	var values [24]string
	n, err := runtimeRange(phase, r)
	if err != nil {
		return values, err
	}
	for i := 0; i < 10; i++ {
		values[i] = n.First[i].(*big.Int).String()
		values[10+i] = n.Last[i].(*big.Int).String()
	}
	for i := range n.Count {
		values[20+i] = n.Count[i].(*big.Int).String()
	}
	return values, nil
}

// RangeFromCanonical is the inverse of CanonicalRange, with identical checks.
func RangeFromCanonical(phase int, values [24]string) (FamilyRange, error) {
	var r FamilyRange
	for i, s := range values {
		v, ok := new(big.Int).SetString(s, 10)
		if !ok || v.String() != s {
			return FamilyRange{}, fmt.Errorf("noncanonical range scalar %d", i)
		}
		switch {
		case i < 10:
			r.First[i] = v
		case i < 20:
			r.Last[i-10] = v
		default:
			r.Count[i-20] = v
		}
	}
	return runtimeRange(phase, r)
}

func runtimeRange(phase int, r FamilyRange) (FamilyRange, error) {
	if phase < Preparation || phase > SettlementOutput {
		return FamilyRange{}, fmt.Errorf("invalid range phase")
	}
	for i := 0; i < 10; i++ {
		a, err := runtimeScalar(r.First[i])
		if err != nil {
			return FamilyRange{}, fmt.Errorf("first[%d]: %w", i, err)
		}
		b, err := runtimeScalar(r.Last[i])
		if err != nil {
			return FamilyRange{}, fmt.Errorf("last[%d]: %w", i, err)
		}
		if i >= Width(phase) && (a.Sign() != 0 || b.Sign() != 0) {
			return FamilyRange{}, fmt.Errorf("nonzero range padding")
		}
		r.First[i] = a
		r.Last[i] = b
	}
	for i, x := range r.Count {
		v, err := runtimeScalar(x)
		if err != nil || v.BitLen() > 64 {
			return FamilyRange{}, fmt.Errorf("invalid count limb %d", i)
		}
		r.Count[i] = v
	}
	if runtimeCount(r).Sign() == 0 {
		return FamilyRange{}, fmt.Errorf("zero work")
	}
	return r, nil
}

func runtimeCount(r FamilyRange) *big.Int {
	n := new(big.Int)
	for i := 3; i >= 0; i-- {
		n.Lsh(n, 64)
		n.Add(n, r.Count[i].(*big.Int))
	}
	return n
}

func runtimeScalar(v frontend.Variable) (*big.Int, error) {
	var n *big.Int
	switch x := v.(type) {
	case *big.Int:
		if x != nil {
			n = new(big.Int).Set(x)
		}
	case big.Int:
		n = new(big.Int).Set(&x)
	case int:
		n = big.NewInt(int64(x))
	case int8:
		n = big.NewInt(int64(x))
	case int16:
		n = big.NewInt(int64(x))
	case int32:
		n = big.NewInt(int64(x))
	case int64:
		n = big.NewInt(x)
	case uint:
		n = new(big.Int).SetUint64(uint64(x))
	case uint8:
		n = new(big.Int).SetUint64(uint64(x))
	case uint16:
		n = new(big.Int).SetUint64(uint64(x))
	case uint32:
		n = new(big.Int).SetUint64(uint64(x))
	case uint64:
		n = new(big.Int).SetUint64(x)
	case string:
		var ok bool
		n, ok = new(big.Int).SetString(x, 10)
		if !ok || n.String() != x {
			return nil, fmt.Errorf("noncanonical scalar")
		}
	default:
		return nil, fmt.Errorf("unsupported scalar %T", v)
	}
	if n == nil || n.Sign() < 0 || n.Cmp(fr.Modulus()) >= 0 {
		return nil, fmt.Errorf("scalar outside BN254 field")
	}
	return n, nil
}

// RawQualifiedDigest and OutputPipelineDigest expose the exact existing adapter
// hash preimages without requiring runtime callers to duplicate private layouts.
func RawQualifiedDigest(c RawQualifiedClaims) (*big.Int, error) {
	return runtimeDigest(rawQualifiedDomain, c.values())
}
func OutputPipelineDigest(c OutputPipelineClaims) (*big.Int, error) {
	return runtimeDigest(outputPipelineDomain, c.values())
}
func runtimeDigest(domain int, values []frontend.Variable) (*big.Int, error) {
	canonical := make([]frontend.Variable, len(values))
	for i, v := range values {
		n, err := runtimeScalar(v)
		if err != nil {
			return nil, fmt.Errorf("claim %d: %w", i, err)
		}
		canonical[i] = n
	}
	return rb.Hash(domain, canonical...), nil
}
