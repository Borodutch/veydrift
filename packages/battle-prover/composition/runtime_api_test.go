package composition

import (
	"math/big"
	"testing"

	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	out "github.com/Borodutch/veydrift/packages/battle-prover/outputbridge"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
)

func TestRuntimeLeafWitnessActualInputs(t *testing.T) {
	// Two actual native traces, distinct snapshot/cohort/roster sizes and losses.
	// Reuse each compiled kind across both inputs, with no setup/proof generation.
	compiled := map[int]constraint.ConstraintSystem{}
	var firstDigest string
	for input := 1; input <= 2; input++ {
		members := []attr.Member{{Owner: attr.U(11), Source: attr.U(21), Quantity: 1}}
		dead := []bool{false}
		if input == 2 {
			members = append(members, attr.Member{Owner: attr.U(12), Source: attr.U(22), Quantity: 1})
			dead = append(dead, true)
		}
		m, err := attr.Prepare(attr.Context{Snapshot: attr.U(uint64(input)), Cohort: attr.U(uint64(input)), Side: 0, Type: 1, Stats: [3]attr.Uint256{attr.U(2), attr.U(3), attr.U(4)}}, members, dead)
		if err != nil {
			t.Fatal(err)
		}
		kinds := map[int]bool{}
		count := 0
		for count < 40 {
			step, err := m.Next()
			if err != nil {
				t.Fatal(err)
			}
			leaf, err := NewLeafWitness(step)
			if err != nil {
				t.Fatal(err)
			}
			kinds[step.Kind] = true
			cc := compiled[step.Kind]
			if cc == nil {
				shape, err := LeafShape(Attribution, step.Kind)
				if err != nil {
					t.Fatal(err)
				}
				cc, err = frontend.Compile(fr.Modulus(), r1cs.NewBuilder, shape)
				if err != nil {
					t.Fatal(err)
				}
				if cc.GetNbConstraints() > 4_000_000 || cc.GetNbPublicVariables() != 4 {
					t.Fatal("budget or public schema", cc.GetNbConstraints(), cc.GetNbPublicVariables())
				}
				compiled[step.Kind] = cc
			}
			w, err := frontend.NewWitness(leaf, fr.Modulus())
			if err != nil {
				t.Fatal(err)
			}
			public, err := w.Public()
			if err != nil {
				t.Fatal(err)
			}
			if len(public.Vector().(fr.Vector)) != 3 {
				t.Fatal("not exactly three public scalars")
			}
			if err := cc.IsSolved(w); err != nil {
				t.Fatal(err)
			}
			values, err := CanonicalRange(Attribution, leaf.Range)
			if err != nil {
				t.Fatal(err)
			}
			if values[20] != "1" {
				t.Fatal("leaf work")
			}
			if count == 0 {
				digest := leaf.Digests[0].(*big.Int).String()
				if input == 1 {
					firstDigest = digest
				} else if firstDigest == digest {
					t.Fatal("different input commitment aliased")
				}
				bad := *leaf
				bad.Range.Count = p.Const(2)
				bad.FamilyPublic = bad.Range.Public(Attribution)
				bw, err := frontend.NewWitness(&bad, fr.Modulus())
				if err != nil {
					t.Fatal(err)
				}
				if cc.IsSolved(bw) == nil {
					t.Fatal("accepted forged work")
				}
			}
			count++
			finished, err := runtimeScalar(step.Finished)
			if err != nil {
				t.Fatal(err)
			}
			if finished.Sign() != 0 {
				break
			}
		}
		if len(kinds) != 4 || count >= 40 {
			t.Fatal("missing mixed-kind chunks", kinds, count)
		}
		t.Logf("input=%d instructions=%d kinds=%d; identical CCS reused", input, count, len(kinds))
	}
}

func TestRuntimeLeafTypedDispatch(t *testing.T) {
	// Statement-only host mapping test; these are not claimed as valid proofs.
	steps := []frontend.Circuit{
		&prep.Step{ContextHash: 1, BeforeHash: 2, AfterHash: 3, Result: 0},
		&mb.Step{Input: 1, BeforeRoot: 2, AfterRoot: 3, Start: 0, End: 1, BeforeDone: 0, AfterDone: 0, Result: 0},
		&attr.Step{ContextRoot: 1, BeforeRoot: 2, AfterRoot: 3, Finished: 0, Result: 0},
		&rb.Step{ContextRoot: 1, PreparedRoot: 2, Input: 3, CombatResult: 4, BeforeRoot: 5, AfterRoot: 6, Finished: 0, Result: 0, AttributionContext: 0, AttributionResult: 0},
		&rb.ReportStep{ContextRoot: 1, Input: 2, CombatResult: 3, BeforeRoot: 4, AfterRoot: 5, Finished: 0, Result: 0},
		&raw.Step{Binding: 1, BeforeHash: 2, AfterHash: 3, Result: 0, KindPublic: 0},
		&out.Step{Binding: 1, BeforeHash: 2, AfterHash: 3, Finished: 0, Result: 0},
	}
	for phase, step := range steps {
		leaf, err := NewLeafWitness(step)
		if err != nil {
			t.Fatalf("phase%d: %v", phase, err)
		}
		if leaf.Phase != phase {
			t.Fatal("wrong phase")
		}
		for i := range leaf.Range.First {
			a, _ := runtimeScalar(leaf.Range.First[i])
			b, _ := runtimeScalar(leaf.Range.Last[i])
			if a.Cmp(b) != 0 {
				t.Fatal("endpoint mismatch")
			}
		}
	}
	for _, step := range []frontend.Circuit{nil, (*prep.Step)(nil), &FamilyLeaf{}, &rb.Step{Kind: rb.Close}, &prep.Step{Kind: 99}, &prep.Step{ContextHash: fr.Modulus(), BeforeHash: 0, AfterHash: 0, Result: 0}} {
		if _, err := NewLeafWitness(step); err == nil {
			t.Fatalf("accepted %T", step)
		}
	}
}

func TestRuntimeCanonicalRange(t *testing.T) {
	r := Normalize(Preparation, Range{[]frontend.Variable{1, 2, 3, 0}, []frontend.Variable{1, 3, 4, 0}}, p.MustValue(new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))))
	values, err := CanonicalRange(Preparation, r)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := RangeFromCanonical(Preparation, values)
	if err != nil {
		t.Fatal(err)
	}
	again, err := CanonicalRange(Preparation, restored)
	if err != nil || again != values {
		t.Fatal("round trip", err)
	}
	for _, bad := range []string{"", "01", "+1", "-1", "0x01", "1.5", fr.Modulus().String()} {
		v := values
		v[0] = bad
		if _, err := RangeFromCanonical(Preparation, v); err == nil {
			t.Fatal("accepted malformed scalar", bad)
		}
	}
	for _, bad := range []frontend.Variable{nil, (*big.Int)(nil), -1, fr.Modulus(), 1.5, struct{}{}} {
		v := r
		v.First[0] = bad
		if _, err := CanonicalRange(Preparation, v); err == nil {
			t.Fatal("accepted malformed native scalar")
		}
	}
	for _, index := range []int{4, 14, 20} {
		v := values
		v[index] = "1"
		if index == 20 {
			v[index] = new(big.Int).Lsh(big.NewInt(1), 64).String()
		}
		if _, err := RangeFromCanonical(Preparation, v); err == nil {
			t.Fatal("accepted padding/limb", index)
		}
	}
	r.Count = p.Const(0)
	if _, err := CanonicalRange(Preparation, r); err == nil {
		t.Fatal("zero work")
	}
	if _, err := CanonicalRange(99, r); err == nil {
		t.Fatal("invalid phase")
	}
}

// These zero-point auth objects test native schema guards only. They are NEVER
// submitted as recursive proof evidence or used to claim cryptographic validity.
func runtimeTestAuth() CatalogAuth {
	key := Key{}
	key.G1.K = make([]sw_bn254.G1Affine, 4)
	return CatalogAuth{Keys: []Key{key}, Selector: 0, Witness: Witness{Public: make([]emulated.Element[sw_bn254.ScalarField], 3)}}
}
func TestRuntimeNodeGuards(t *testing.T) {
	auth := runtimeTestAuth()
	r := Normalize(Attribution, Range{[]frontend.Variable{1, 2, 3, 0, 0}, []frontend.Variable{1, 2, 3, 0, 0}}, p.Const(1))
	child := FamilyEnvelope{Range: r, Auth: auth, Kind: 2}
	keys := []Key{auth.Keys[0], auth.Keys[0], auth.Keys[0], auth.Keys[0]}
	id := FamilyID{Phase: Attribution, Arity: 1}
	n, err := NewNodeWitness(id, []FamilyEnvelope{child}, keys, []int{2})
	if err != nil {
		t.Fatal(err)
	}
	if n.Level != 1 || n.Children[0].Selector != 2 || len(n.Children[0].Keys) != 4 {
		t.Fatal("dispatch assignment")
	}
	for _, bad := range []FamilyID{{Phase: 99, Arity: 1}, {Phase: Attribution}, {Phase: Attribution, Arity: 2}, {Phase: Attribution, Level: 257, Arity: 1}, {Phase: Attribution, Kind: 1, Arity: 1}} {
		if _, err := NewNodeWitness(bad, []FamilyEnvelope{child}, keys, []int{2}); err == nil {
			t.Fatal("accepted role", bad)
		}
	}
	for _, selectors := range [][]int{nil, {-1}, {4}, {1}} {
		if _, err := NewNodeWitness(id, []FamilyEnvelope{child}, keys, selectors); err == nil {
			t.Fatal("accepted selectors", selectors)
		}
	}
	if _, err := NewNodeWitness(id, nil, keys, nil); err == nil {
		t.Fatal("accepted arity")
	}
	if _, err := NewNodeWitness(id, []FamilyEnvelope{child}, keys[:1], []int{2}); err == nil {
		t.Fatal("accepted catalog")
	}
	child.Range.Count = p.Const(2)
	if _, err := NewNodeWitness(id, []FamilyEnvelope{child}, keys, []int{2}); err == nil {
		t.Fatal("leaf work >1")
	}
	child.Range.Count = p.Const(1)
	binary := FamilyID{Phase: Attribution, Level: 1, Arity: 2}
	n, err = NewNodeWitness(binary, []FamilyEnvelope{child, child}, keys[:1], []int{0, 0})
	if err != nil {
		t.Fatal(err)
	}
	values, err := CanonicalRange(Attribution, n.Range)
	if err != nil || values[20] != "2" {
		t.Fatal("binary count", err)
	}
	child.Auth.Witness.Public = nil
	if _, err := NewNodeWitness(binary, []FamilyEnvelope{child, child}, keys[:1], []int{0, 0}); err == nil {
		t.Fatal("auth schema")
	}
}

func TestRuntimeCloseGuards(t *testing.T) {
	a := runtimeTestAuth()
	r := Normalize(Attribution, Range{[]frontend.Variable{7, 2, 3, 0, 0}, []frontend.Variable{7, 3, 4, 1, 8}}, p.Const(4))
	s := &rb.Step{Kind: rb.Close, ContextRoot: 1, PreparedRoot: 2, Input: 3, CombatResult: 4, BeforeRoot: 5, AfterRoot: 6, Finished: 0, Result: 0, AttributionContext: 7, AttributionResult: 8}
	close, err := NewCloseWitness(s, r, a)
	if err != nil {
		t.Fatal(err)
	}
	if close.Step.Kind != rb.Close {
		t.Fatal("lost kind")
	}
	for _, bad := range []*rb.Step{nil, {Kind: rb.Finish}} {
		if _, err := NewCloseWitness(bad, r, a); err == nil {
			t.Fatal("accepted non-Close")
		}
	}
	for _, index := range []int{0, 3, 4} {
		bad := r
		bad.Last[index] = 0
		if _, err := NewCloseWitness(s, bad, a); err == nil {
			t.Fatal("accepted mismatch", index)
		}
	}
	a.Selector = 1
	if _, err := NewCloseWitness(s, r, a); err == nil {
		t.Fatal("selector")
	}
	a = runtimeTestAuth()
	a.Keys = nil
	if _, err := NewCloseWitness(s, r, a); err == nil {
		t.Fatal("missing key")
	}
	a = runtimeTestAuth()
	a.Witness.Public = nil
	if _, err := NewCloseWitness(s, r, a); err == nil {
		t.Fatal("missing witness")
	}
}

func TestRuntimeAdapterDigests(t *testing.T) {
	rawClaims := RawQualifiedClaims{}
	for i := range rawClaims.RawFirst {
		rawClaims.RawFirst[i] = i
		rawClaims.RawLast[i] = i + 5
	}
	for i := range rawClaims.Qualified {
		rawClaims.Qualified[i] = i + 10
	}
	got, err := RawQualifiedDigest(rawClaims)
	if err != nil {
		t.Fatal(err)
	}
	if got.Cmp(rb.Hash(rawQualifiedDomain, rawClaims.values()...)) != 0 {
		t.Fatal("raw digest relation")
	}
	claims := OutputPipelineClaims{}
	for i := range claims.First {
		claims.First[i] = i
		claims.Last[i] = i + 5
	}
	for i := range claims.Pipeline {
		claims.Pipeline[i] = i + 10
	}
	got, err = OutputPipelineDigest(claims)
	if err != nil {
		t.Fatal(err)
	}
	if got.Cmp(rb.Hash(outputPipelineDomain, claims.values()...)) != 0 {
		t.Fatal("output digest relation")
	}
	claims.Pipeline[0] = fr.Modulus()
	if _, err := OutputPipelineDigest(claims); err == nil {
		t.Fatal("noncanonical claim")
	}
}
