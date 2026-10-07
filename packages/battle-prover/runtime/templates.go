package runtime

import (
	"fmt"
	"slices"

	"github.com/Borodutch/veydrift/packages/battle-prover/composition"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	bn "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/constraint"
	csbn "github.com/consensys/gnark/constraint/bn254"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	rec "github.com/consensys/gnark/std/recursion/groth16"
)

// TemplateDependency contains already-built public artifacts, in the exact
// order of CatalogNode.Dependencies. No proving key or battle input is needed.
// Callers must independently approve the CCS/VK bytes and their node identity;
// matching dimensions do NOT establish relation or setup provenance. Objects
// must remain immutable while this call reads them.
type TemplateDependency struct {
	CCS constraint.ConstraintSystem
	VK  groth16.VerifyingKey
}

// BuildCatalogTemplate constructs the existing production relation, not a
// witness, setup, or approval. Walk BuildCatalogGraph in order, compiling and
// obtaining externally approved dependency keys before constructing parents.
// Game, verifier address and codehash remain witness fields: the final key can
// be built before deployment and before any actual battle/job exists.
func BuildCatalogTemplate(node CatalogNode, dependencies ...TemplateDependency) (frontend.Circuit, error) {
	widths, err := templateNodeSchema(node)
	if err != nil {
		return nil, err
	}
	if len(dependencies) != len(widths) {
		return nil, fmt.Errorf("%s: dependency count", node.ID)
	}
	auth := make([]composition.Auth, len(dependencies))
	for i, dep := range dependencies {
		auth[i], err = templateAuth(dep, widths[i])
		if err != nil {
			return nil, fmt.Errorf("%s dependency %s: %w", node.ID, node.Dependencies[i], err)
		}
	}
	catalogAuth := func(i int) composition.CatalogAuth {
		// Each occurrence is a different private proof, even when selecting the
		// same immutable key. Gnark schema traversal writes witness slots in
		// place; reusing these slices aliases binary children.
		return composition.CatalogAuth{Proof: rec.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](dependencies[i].CCS), Witness: rec.PlaceholderWitness[sw_bn254.ScalarField](dependencies[i].CCS), Selector: 0, Keys: []composition.Key{auth[i].Key}}
	}
	if node.Family != nil {
		id := *node.Family
		if id.Arity == 0 {
			if id.Phase != composition.Bridge || id.Kind != rb.Close {
				return composition.LeafShape(id.Phase, id.Kind)
			}
			// The private bridgeStep is intentionally accessible only through the
			// production constructor. Initialize ONLY its native public statement;
			// none of these zeros becomes a compile-time constant or battle fixture.
			step := rb.Shape(rb.Close)
			step.ContextRoot, step.PreparedRoot, step.Input, step.CombatResult = 0, 0, 0, 0
			step.BeforeRoot, step.AfterRoot, step.Finished, step.Result = 0, 0, 0, 0
			step.AttributionContext, step.AttributionResult = 0, 0
			allocation := composition.Normalize(composition.Attribution, composition.Range{}, p.Const(1))
			allocation.Last[3] = 1 // constructor checks completion; still a witness slot
			return composition.NewCloseWitness(step, allocation, catalogAuth(0))
		}
		ids, _ := composition.Dependencies(id) // validated above
		entries := make(map[composition.FamilyID]composition.Key, len(ids))
		for i, dep := range ids {
			entries[dep] = auth[i].Key
		}
		catalog, err := composition.NewKeyCatalog(entries)
		if err != nil {
			return nil, err
		}
		keys, err := catalog.ForFamily(id)
		if err != nil {
			return nil, err
		}
		// Every selectable key must share the same proof/witness layout. The
		// catalog checks exact commitment metadata as well as public dimensions.
		n := &composition.FamilyNode{Phase: id.Phase, Level: max(1, id.Level), Children: make([]composition.CatalogAuth, id.Arity), ChildRanges: make([]composition.FamilyRange, id.Arity)}
		for i := range n.Children {
			n.Children[i] = catalogAuth(0)
			n.Children[i].Keys = keys
		}
		return n, nil
	}
	switch node.Role {
	case "qualification":
		return &q.LinkedCircuit{}, nil
	case "prepared-combat", "bridge-report":
		mode := 0
		if node.Role == "bridge-report" {
			mode = 1
		}
		return &composition.FamilyPhaseJoin{Mode: mode, Children: [2]composition.CatalogAuth{catalogAuth(0), catalogAuth(1)}}, nil
	case "pipeline":
		return &composition.Join{Mode: 2, Children: [2]composition.Auth{auth[0], auth[1]}}, nil
	case "raw-qualified":
		return &composition.RawQualified{Raw: auth[0], Qualification: auth[1]}, nil
	case "output-pipeline":
		return &composition.OutputPipeline{Output: auth[0], Pipeline: auth[1]}, nil
	case "final":
		return &composition.SettlementFinal{Provenance: auth[0], Results: auth[1]}, nil
	default:
		return nil, fmt.Errorf("unknown adapter %q", node.Role)
	}
}

// Root heights are graph policy, not inferable from an individual node. Accept
// any canonical D_h root here; the externally approved full graph pins h.
func templateRoot(id string, phase int) bool {
	for h := 0; h <= composition.ProtocolRootHeight; h++ {
		if id == FamilyKeyID(composition.FamilyID{Phase: phase, Level: h, Arity: 1}) {
			return true
		}
	}
	return false
}

func templateNodeSchema(n CatalogNode) ([]int, error) {
	bad := func() ([]int, error) { return nil, fmt.Errorf("invalid catalog node schema: %s", n.ID) }
	if n.Family != nil {
		id := *n.Family
		if !id.Valid() || n.ID != FamilyKeyID(id) || n.Role != "" || n.PublicInputs != 3 {
			return bad()
		}
		if id.Arity == 0 {
			if id.Phase == composition.Bridge && id.Kind == rb.Close {
				if len(n.Dependencies) != 1 || !templateRoot(n.Dependencies[0], composition.Attribution) {
					return bad()
				}
				return []int{3}, nil
			}
			if len(n.Dependencies) != 0 {
				return bad()
			}
			return nil, nil
		}
		ids, err := composition.Dependencies(id)
		if err != nil || len(ids) != len(n.Dependencies) {
			return bad()
		}
		widths := make([]int, len(ids))
		for i, dep := range ids {
			if n.Dependencies[i] != FamilyKeyID(dep) {
				return bad()
			}
			widths[i] = 3
		}
		return widths, nil
	}
	if n.ID != AdapterKeyID(n.Role) {
		return bad()
	}
	var public int
	var widths []int
	var exact []string
	var roots []int
	switch n.Role {
	case "qualification":
		public = 7
	case "prepared-combat":
		public, widths, roots = 8, []int{3, 3}, []int{composition.Preparation, composition.Combat}
	case "bridge-report":
		public, widths, roots = 8, []int{3, 3}, []int{composition.Bridge, composition.Report}
	case "pipeline":
		public, widths, exact = 8, []int{8, 8}, []string{AdapterKeyID("prepared-combat"), AdapterKeyID("bridge-report")}
	case "raw-qualified":
		public, widths, roots, exact = 1, []int{3, 7}, []int{composition.RawJournal}, []string{"", AdapterKeyID("qualification")}
	case "output-pipeline":
		public, widths, roots, exact = 1, []int{3, 8}, []int{composition.SettlementOutput}, []string{"", AdapterKeyID("pipeline")}
	case "final":
		public, widths, exact = 22, []int{1, 1}, []string{AdapterKeyID("raw-qualified"), AdapterKeyID("output-pipeline")}
	default:
		return bad()
	}
	if n.PublicInputs != public || len(n.Dependencies) != len(widths) {
		return bad()
	}
	for i, phase := range roots {
		if !templateRoot(n.Dependencies[i], phase) {
			return bad()
		}
	}
	for i, id := range exact {
		if id != "" && n.Dependencies[i] != id {
			return bad()
		}
	}
	return widths, nil
}

func templateAuth(dep TemplateDependency, public int) (composition.Auth, error) {
	var empty composition.Auth
	cs, ok := dep.CCS.(*csbn.R1CS)
	if !ok || cs == nil || cs.Type != constraint.SystemR1CS || cs.Field().Cmp(ecc.BN254.ScalarField()) != 0 || cs.GetNbConstraints() < 1 || cs.GetNbPublicVariables() != public+1 {
		return empty, fmt.Errorf("expected BN254 R1CS with %d public inputs", public)
	}
	vk, ok := dep.VK.(*bn.VerifyingKey)
	if !ok || vk == nil {
		return empty, fmt.Errorf("expected BN254 verifying key")
	}
	commitments, ok := cs.GetCommitments().(constraint.Groth16Commitments)
	if !ok || len(commitments) != len(vk.CommitmentKeys) || len(vk.G1.K) != public+1+len(commitments) || len(vk.PublicAndCommitmentCommitted) != len(commitments) {
		return empty, fmt.Errorf("CCS/VK public or commitment schema mismatch")
	}
	// Translate commitment wire indexes without an unchecked search in gnark's
	// helper: malformed metadata must return an error rather than panic.
	for i, c := range commitments {
		if c.NbPublicCommitted < 0 || c.NbPublicCommitted > len(c.PublicAndCommitmentCommitted) {
			return empty, fmt.Errorf("invalid CCS commitment metadata")
		}
		expected := append([]int(nil), c.PublicAndCommitmentCommitted...)
		for j, index := range expected {
			if j < c.NbPublicCommitted {
				if index < 1 || index > public {
					return empty, fmt.Errorf("invalid committed public index")
				}
			} else {
				found := false
				for k := 0; k < i; k++ {
					if commitments[k].CommitmentIndex == index {
						expected[j], found = public+1+k, true
						break
					}
				}
				if !found {
					return empty, fmt.Errorf("invalid committed dependency index")
				}
			}
		}
		if !slices.Equal(expected, vk.PublicAndCommitmentCommitted[i]) {
			return empty, fmt.Errorf("CCS/VK committed public layout mismatch")
		}
	}
	key, err := rec.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](vk)
	if err != nil {
		return empty, err
	}
	// gnark's conversion aliases this metadata; snapshot it with the constants.
	key.PublicAndCommitmentCommitted = make([][]int, len(vk.PublicAndCommitmentCommitted))
	for i, row := range vk.PublicAndCommitmentCommitted {
		key.PublicAndCommitmentCommitted[i] = append([]int(nil), row...)
	}
	return composition.Auth{Key: key, Proof: rec.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](cs), Witness: rec.PlaceholderWitness[sw_bn254.ScalarField](cs)}, nil
}
