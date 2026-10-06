package runtime

import (
	"fmt"
	"github.com/consensys/gnark/frontend/schema"
	"reflect"
	"testing"

	"github.com/Borodutch/veydrift/packages/battle-prover/composition"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark-crypto/ecc"
	curve "github.com/consensys/gnark-crypto/ecc/bn254"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr/pedersen"
	"github.com/consensys/gnark/backend/groth16"
	bn "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/constraint"
	csbn "github.com/consensys/gnark/constraint/bn254"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
)

// Dimensions-only dependencies: a tiny constraint system and generator-valued
// public key, NOT setup output or approved/provable catalog artifacts. These
// allow all factory branches to be tested without recursive compilation/setup.
type templateSchemaCircuit struct {
	Public []frontend.Variable `gnark:",public"`
	Secret frontend.Variable
	Commit bool `gnark:"-"`
}

func (c *templateSchemaCircuit) Define(api frontend.API) error {
	for _, v := range c.Public {
		api.AssertIsEqual(api.Mul(c.Secret, c.Secret), v)
	}
	if c.Commit {
		_, err := api.Compiler().(frontend.Committer).Commit(c.Public[0], c.Secret)
		return err
	}
	return nil
}
func templateTestDependency(t *testing.T, public int, commit bool) TemplateDependency {
	t.Helper()
	cs, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &templateSchemaCircuit{Public: make([]frontend.Variable, public), Commit: commit})
	if err != nil {
		t.Fatal(err)
	}
	_, _, g1, g2 := curve.Generators()
	vk := &bn.VerifyingKey{}
	vk.G1.Alpha, vk.G2.Beta, vk.G2.Gamma, vk.G2.Delta = g1, g2, g2, g2
	cm := cs.GetCommitments().(constraint.Groth16Commitments)
	vk.G1.K = make([]curve.G1Affine, public+1+len(cm))
	for i := range vk.G1.K {
		vk.G1.K[i] = g1
	}
	vk.CommitmentKeys = make([]pedersen.VerifyingKey, len(cm))
	for i := range vk.CommitmentKeys {
		vk.CommitmentKeys[i] = pedersen.VerifyingKey{G: g2, GSigmaNeg: g2}
	}
	vk.PublicAndCommitmentCommitted = cm.GetPublicAndCommitmentCommitted(cm.CommitmentIndexes(), public+1)
	return TemplateDependency{CCS: cs, VK: vk}
}

func templateTestPublicZeros(circuit frontend.Circuit) {
	zero := func(v []frontend.Variable) {
		for i := range v {
			v[i] = 0
		}
	}
	switch c := circuit.(type) {
	case *composition.FamilyLeaf:
		zero(c.Digests[:])
	case *composition.CompleteClose:
		zero(c.Digests[:])
	case *composition.FamilyNode:
		zero(c.Digests[:])
	case *q.LinkedCircuit:
		c.ContextHash, c.Input, c.RawResult = 0, 0, 0
		zero(c.ChainRecord[:])
	case *composition.FamilyPhaseJoin:
		zero(c.Public[:])
	case *composition.Join:
		zero(c.Public[:])
	case *composition.RawQualified:
		c.Digest = 0
	case *composition.OutputPipeline:
		c.Digest = 0
	case *composition.SettlementFinal:
		zero(c.Public[:])
	}
}

func TestCatalogTemplateAllRoles(t *testing.T) {
	deps := map[int]TemplateDependency{}
	for _, width := range []int{1, 3, 7, 8, 22} {
		deps[width] = templateTestDependency(t, width, false)
	}
	// Heterogeneous explicit heights cover D0/Bh/Dh and every adapter. A separate
	// full-height pass validates all 3,634 protocol node schemas/topological edges.
	for _, heights := range [][7]int{{}, {1, 2, 3, 4, 5, 6, 7}, {256, 256, 256, 256, 256, 256, 256}} {
		graph, err := BuildCatalogGraph(heights)
		if err != nil {
			t.Fatal(err)
		}
		seen := map[string]int{}
		for _, node := range graph {
			widths, err := templateNodeSchema(node)
			if err != nil {
				t.Fatal(node.ID, err)
			}
			ordered := make([]TemplateDependency, len(node.Dependencies))
			for i, id := range node.Dependencies {
				width, exists := seen[id]
				if !exists || width != widths[i] {
					t.Fatal("non-topological/schema dependency", node.ID, id)
				}
				ordered[i] = deps[width]
			}
			seen[node.ID] = node.PublicInputs
			// Construct representative recursive shapes, including the maximum height,
			// without paying repeated fixed-pairing conversions for intermediate heights.
			if heights[0] == 256 && node.Family != nil && node.Family.Level != 256 {
				continue
			}
			circuit, err := BuildCatalogTemplate(node, ordered...)
			if err != nil {
				t.Fatal(node.ID, err)
			}
			// Populate only public slots to use gnark's compiler-equivalent
			// witness walker (NewSchema double-counts anonymous embedding).
			templateTestPublicZeros(circuit)
			public, err := frontend.NewWitness(circuit, ecc.BN254.ScalarField(), frontend.PublicOnly())
			if err != nil {
				t.Fatal(node.ID, err)
			}
			if len(public.Vector().(fr.Vector)) != node.PublicInputs {
				t.Fatal(node.ID, "public schema")
			}
			switch c := circuit.(type) {
			case *composition.FamilyLeaf:
				if c.Phase != node.Family.Phase || len(c.Preparation)+len(c.Combat)+len(c.Attribution)+len(c.Bridge)+len(c.Reports)+len(c.Raw)+len(c.Output) != 1 {
					t.Fatal("leaf shape")
				}
			case *composition.CompleteClose:
				if node.Family.Kind != rb.Close || c.Step.Kind != rb.Close || len(c.Auth.Keys) != 1 || len(c.Auth.Witness.Public) != 3 {
					t.Fatal("Close shape")
				}
			case *composition.FamilyNode:
				if c.Level != max(1, node.Family.Level) || c.Phase != node.Family.Phase || len(c.Children) != node.Family.Arity || len(c.ChildRanges) != node.Family.Arity {
					t.Fatal("family node shape")
				}
				for _, child := range c.Children {
					if len(child.Keys) != len(ordered) || len(child.Witness.Public) != 3 || child.Selector != 0 {
						t.Fatal("fixed catalog shape")
					}
				}
			case *q.LinkedCircuit:
				if node.Role != "qualification" || c.Meta.Preparation.Identity.Game[0] != nil || c.Meta.Preparation.Identity.Verifier[0] != nil || c.Meta.Codehash[0] != nil {
					t.Fatal("qualification deployment identity embedded")
				}
			case *composition.FamilyPhaseJoin:
				want := 0
				if node.Role == "bridge-report" {
					want = 1
				}
				if c.Mode != want || len(c.Children[0].Keys) != 1 || len(c.Children[1].Keys) != 1 {
					t.Fatal("phase join")
				}
			case *composition.Join:
				if node.Role != "pipeline" || c.Mode != 2 || len(c.Children[0].Witness.Public) != 8 || len(c.Children[1].Witness.Public) != 8 {
					t.Fatal("pipeline")
				}
			case *composition.RawQualified:
				if len(c.Raw.Witness.Public) != 3 || len(c.Qualification.Witness.Public) != 7 {
					t.Fatal("raw-qualified")
				}
			case *composition.OutputPipeline:
				if len(c.Output.Witness.Public) != 3 || len(c.Pipeline.Witness.Public) != 8 {
					t.Fatal("output-pipeline")
				}
			case *composition.SettlementFinal:
				if node.Role != "final" || len(c.Public) != 22 || len(c.Provenance.Witness.Public) != 1 || len(c.Results.Witness.Public) != 1 {
					t.Fatal("Solidity22 final")
				}
			default:
				t.Fatalf("unexpected relation %T", c)
			}
		}
	}
}

func TestCatalogTemplateRejectsMalformed(t *testing.T) {
	graph, _ := BuildCatalogGraph([7]int{1, 1, 1, 1, 1, 1, 1})
	deps := map[int]TemplateDependency{}
	for _, width := range []int{1, 3, 7, 8} {
		deps[width] = templateTestDependency(t, width, false)
	}
	for _, n := range graph {
		widths, _ := templateNodeSchema(n)
		ordered := make([]TemplateDependency, len(widths))
		for i, w := range widths {
			ordered[i] = deps[w]
		}
		bad := n
		bad.PublicInputs++
		if _, err := BuildCatalogTemplate(bad, ordered...); err == nil {
			t.Fatal("accepted public schema", n.ID)
		}
		bad = n
		bad.ID += "/extra"
		if _, err := BuildCatalogTemplate(bad, ordered...); err == nil {
			t.Fatal("accepted identity", n.ID)
		}
		if _, err := BuildCatalogTemplate(n, append(ordered, deps[3])...); err == nil {
			t.Fatal("accepted extra dependency", n.ID)
		}
		if len(ordered) == 0 {
			continue
		}
		if _, err := BuildCatalogTemplate(n, ordered[:len(ordered)-1]...); err == nil {
			t.Fatal("accepted missing dependency", n.ID)
		}
		bad = n
		bad.Dependencies = append([]string(nil), n.Dependencies...)
		bad.Dependencies[0] = AdapterKeyID("final")
		if _, err := BuildCatalogTemplate(bad, ordered...); err == nil {
			t.Fatal("accepted dependency identity", n.ID)
		}
		ordered[0] = TemplateDependency{}
		if _, err := BuildCatalogTemplate(n, ordered...); err == nil {
			t.Fatal("accepted nil dependency", n.ID)
		}
	}
	dep := deps[3]
	for _, bad := range []TemplateDependency{{CCS: dep.CCS}, {VK: dep.VK}, {CCS: (*csbn.R1CS)(nil), VK: dep.VK}, {CCS: dep.CCS, VK: (*bn.VerifyingKey)(nil)}, {CCS: dep.CCS, VK: groth16.NewVerifyingKey(ecc.BLS12_381)}, {CCS: deps[7].CCS, VK: dep.VK}, {CCS: dep.CCS, VK: deps[7].VK}} {
		if _, err := templateAuth(bad, 3); err == nil {
			t.Fatal("accepted malformed dependency")
		}
	}
	committed := templateTestDependency(t, 3, true)
	a, err := templateAuth(committed, 3)
	if err != nil || len(a.Proof.Commitments) != 1 || len(a.Witness.Public) != 3 {
		t.Fatal("commitment placeholders", err)
	}
	vk := committed.VK.(*bn.VerifyingKey)
	vk.PublicAndCommitmentCommitted[0][0] = 2
	if a.Key.PublicAndCommitmentCommitted[0][0] != 1 {
		t.Fatal("aliased key metadata")
	}
	if _, err := templateAuth(committed, 3); err == nil {
		t.Fatal("accepted changed committed layout")
	}
	// Individually matching keys can still be incompatible in a selectable catalog.
	committed = templateTestDependency(t, 3, true)
	id := composition.FamilyID{Phase: composition.Attribution, Arity: 1}
	var node CatalogNode
	for _, n := range graph {
		if n.ID == FamilyKeyID(id) {
			node = n
		}
	}
	ordered := make([]TemplateDependency, len(node.Dependencies))
	for i := range ordered {
		ordered[i] = dep
	}
	ordered[1] = committed
	if _, err := BuildCatalogTemplate(node, ordered...); err == nil {
		t.Fatal("accepted incompatible selector layouts")
	}
}

func TestCatalogTemplateKeyOrderAndCommitments(t *testing.T) {
	graph, _ := BuildCatalogGraph([7]int{1, 1, 1, 1, 1, 1, 1})
	id := composition.FamilyID{Phase: composition.Attribution, Level: 1, Arity: 1}
	var node CatalogNode
	for _, n := range graph {
		if n.ID == FamilyKeyID(id) {
			node = n
		}
	}
	first, second := templateTestDependency(t, 3, true), templateTestDependency(t, 3, true)
	vk := second.VK.(*bn.VerifyingKey)
	vk.G1.K[0].Double(&vk.G1.K[0])
	circuit, err := BuildCatalogTemplate(node, first, second)
	if err != nil {
		t.Fatal(err)
	}
	c := circuit.(*composition.FamilyNode)
	if len(c.Children[0].Proof.Commitments) != 1 || len(c.Children[0].Keys) != 2 {
		t.Fatal("committed dispatch placeholder shape")
	}
	// No proof is produced: compare the independently converted constants to
	// ensure the factory preserves the externally supplied dependency order.
	a, err := templateAuth(first, 3)
	if err != nil {
		t.Fatal(err)
	}
	b, err := templateAuth(second, 3)
	if err != nil {
		t.Fatal(err)
	}
	c.Children[0].Keys[0].G1.K[0].X.Initialize(ecc.BN254.ScalarField())
	c.Children[0].Keys[1].G1.K[0].X.Initialize(ecc.BN254.ScalarField())
	a.Key.G1.K[0].X.Initialize(ecc.BN254.ScalarField())
	b.Key.G1.K[0].X.Initialize(ecc.BN254.ScalarField())
	if fmt.Sprint(c.Children[0].Keys[0].G1.K[0].X.Limbs) != fmt.Sprint(a.Key.G1.K[0].X.Limbs) || fmt.Sprint(c.Children[0].Keys[1].G1.K[0].X.Limbs) != fmt.Sprint(b.Key.G1.K[0].X.Limbs) || fmt.Sprint(a.Key.G1.K[0].X.Limbs) == fmt.Sprint(b.Key.G1.K[0].X.Limbs) {
		t.Fatal("dependency keys reordered or ignored")
	}
	node.Dependencies[0], node.Dependencies[1] = node.Dependencies[1], node.Dependencies[0]
	if _, err := BuildCatalogTemplate(node, second, first); err == nil {
		t.Fatal("accepted reordered node labels")
	}
	// A root label is restricted to the correct phase and dispatch arity.
	closeID := composition.FamilyID{Phase: composition.Bridge, Kind: rb.Close}
	for _, n := range graph {
		if n.ID != FamilyKeyID(closeID) {
			continue
		}
		closeCircuit, err := BuildCatalogTemplate(n, first)
		if err != nil {
			t.Fatal(err)
		}
		close := closeCircuit.(*composition.CompleteClose)
		if len(close.Auth.Proof.Commitments) != 1 {
			t.Fatal("Close commitment placeholder")
		}
		n.Dependencies = []string{FamilyKeyID(composition.FamilyID{Phase: composition.Attribution, Level: 1, Arity: 2})}
		if _, err := BuildCatalogTemplate(n, first); err == nil {
			t.Fatal("accepted non-dispatch attribution root")
		}
	}
}

func TestCatalogTemplateSelectedLeafCompile(t *testing.T) {
	id := composition.FamilyID{Phase: composition.Attribution, Kind: 0}
	circuit, err := BuildCatalogTemplate(CatalogNode{ID: FamilyKeyID(id), Family: &id, PublicInputs: 3})
	if err != nil {
		t.Fatal(err)
	}
	cs, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, circuit)
	if err != nil {
		t.Fatal(err)
	}
	if cs.GetNbConstraints() > 4_000_000 || cs.GetNbPublicVariables() != 4 {
		t.Fatal("leaf compile budget/schema", cs.GetNbConstraints(), cs.GetNbPublicVariables())
	}
	t.Logf("selected real attribution leaf: %d constraints, 3 public inputs", cs.GetNbConstraints())
}

func TestCatalogTemplateBinaryChildrenHaveIndependentStorage(t *testing.T) {
	for _, commit := range []bool{false, true} {
		t.Run(fmt.Sprint(commit), func(t *testing.T) {
			dep := templateTestDependency(t, 3, commit)
			id := composition.FamilyID{Phase: composition.Attribution, Level: 1, Arity: 2}
			deps, _ := composition.Dependencies(id)
			node := CatalogNode{ID: FamilyKeyID(id), Family: &id, PublicInputs: 3, Dependencies: []string{FamilyKeyID(deps[0])}}
			circuit, err := BuildCatalogTemplate(node, dep)
			if err != nil {
				t.Fatal(err)
			}
			binary := circuit.(*composition.FamilyNode)
			left, right := &binary.Children[0], &binary.Children[1]
			if &left.Witness.Public[0] == &right.Witness.Public[0] {
				t.Fatal("binary child public witness slices alias")
			}
			if commit && (len(left.Proof.Commitments) == 0 || &left.Proof.Commitments[0] == &right.Proof.Commitments[0]) {
				t.Fatal("binary child commitment storage aliases")
			}
			// Use the same in-place schema walk used by the compiler, without compiling
			// expensive recursive pairing constraints or creating setup artifacts.
			sequence := 0
			_, err = schema.Walk(ecc.BN254.ScalarField(), binary, reflect.TypeOf((*frontend.Variable)(nil)).Elem(), func(_ schema.LeafInfo, v reflect.Value) error {
				sequence++
				v.Set(reflect.ValueOf(sequence))
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if len(left.Witness.Public[0].Limbs) == 0 || len(right.Witness.Public[0].Limbs) == 0 {
				t.Fatal("schema failed to initialize emulated witness")
			}
			if reflect.DeepEqual(left.Witness.Public[0].Limbs, right.Witness.Public[0].Limbs) {
				t.Fatal("compiler walk overwrote distinct child public variables")
			}
			if commit && reflect.DeepEqual(left.Proof.Commitments[0], right.Proof.Commitments[0]) {
				t.Fatal("compiler walk overwrote distinct child commitment variables")
			}
		})
	}
}
