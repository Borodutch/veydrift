// Package runtime loads independently approved proving artifacts. It never runs setup.
package runtime

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"github.com/Borodutch/veydrift/packages/battle-prover/composition"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	bn "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/constraint"
	csbn "github.com/consensys/gnark/constraint/bn254"
	"golang.org/x/sys/unix"
)

const CatalogProtocol = "veydrift-approved-catalog-v1"
const CatalogGnarkVersion = "0.16.3"

// CatalogNode is a circuit role, never a battle-specific witness or receipt.
// Dependencies are ordered exactly as the circuit's fixed verifier inputs.
type CatalogNode struct {
	ID           string
	Family       *composition.FamilyID
	Role         string
	PublicInputs int
	Dependencies []string
}

func FamilyKeyID(id composition.FamilyID) string {
	return fmt.Sprintf("family/%d/%d/%d/%d", id.Phase, id.Level, id.Kind, id.Arity)
}
func AdapterKeyID(role string) string { return "adapter/" + role }

// BuildCatalogGraph returns the full acyclic catalog in instantiation order.
// A reduced root height is explicit; only [256,...,256] spans uint256 work.
func BuildCatalogGraph(heights [7]int) ([]CatalogNode, error) {
	for _, h := range heights {
		if h < 0 || h > composition.ProtocolRootHeight {
			return nil, errors.New("root height outside 0..256")
		}
	}
	var nodes []CatalogNode
	root := func(p int) string { return FamilyKeyID(composition.FamilyID{Phase: p, Level: heights[p], Arity: 1}) }
	for _, p := range []int{composition.Attribution, composition.Preparation, composition.Combat, composition.Bridge, composition.Report, composition.RawJournal, composition.SettlementOutput} {
		add := func(id composition.FamilyID) error {
			deps := []string{}
			if id.Arity != 0 {
				ds, err := composition.Dependencies(id)
				if err != nil {
					return err
				}
				for _, d := range ds {
					deps = append(deps, FamilyKeyID(d))
				}
			}
			if p == composition.Bridge && id.Arity == 0 && id.Kind == rb.Close {
				deps = append(deps, root(composition.Attribution))
			}
			nodes = append(nodes, CatalogNode{ID: FamilyKeyID(id), Family: &id, PublicInputs: 3, Dependencies: deps})
			return nil
		}
		leaves, err := composition.Dependencies(composition.FamilyID{Phase: p, Arity: 1})
		if err != nil {
			return nil, err
		}
		for _, id := range leaves {
			if err = add(id); err != nil {
				return nil, err
			}
		}
		if err = add(composition.FamilyID{Phase: p, Arity: 1}); err != nil {
			return nil, err
		}
		for h := 1; h <= heights[p]; h++ {
			for _, arity := range []int{2, 1} {
				if err = add(composition.FamilyID{Phase: p, Level: h, Arity: arity}); err != nil {
					return nil, err
				}
			}
		}
	}
	adapter := func(role string, n int, deps ...string) {
		if deps == nil {
			deps = []string{}
		}
		nodes = append(nodes, CatalogNode{ID: AdapterKeyID(role), Role: role, PublicInputs: n, Dependencies: deps})
	}
	adapter("qualification", 7)
	adapter("prepared-combat", 8, root(composition.Preparation), root(composition.Combat))
	adapter("bridge-report", 8, root(composition.Bridge), root(composition.Report))
	adapter("pipeline", 8, AdapterKeyID("prepared-combat"), AdapterKeyID("bridge-report"))
	adapter("raw-qualified", 1, root(composition.RawJournal), AdapterKeyID("qualification"))
	adapter("output-pipeline", 1, root(composition.SettlementOutput), AdapterKeyID("pipeline"))
	adapter("final", 22, AdapterKeyID("raw-qualified"), AdapterKeyID("output-pipeline"))
	return nodes, nil
}

// Artifact identifies exact gnark WriteTo bytes. No raw memory dumps are accepted.
type Artifact struct {
	Path, SHA256 string
	Bytes        int64
}
type DependencyApproval struct{ ID, VKSHA256 string }

// Approval binds reviewed source, relation/schema, and ceremony/build provenance.
// These are attestations by the external manifest approver, not claims proven by
// deserialization. A receipt hash alone can never authorize a new key.
type KeyApproval struct {
	SourceSHA256, CircuitSHA256, SchemaSHA256 string
	ProvenanceSHA256, ApprovalSHA256          string
	CCS, PK, VK                               Artifact
	Dependencies                              []DependencyApproval
}
type CatalogEntry struct {
	Node     CatalogNode
	Approval KeyApproval
}
type CatalogManifest struct {
	Protocol, GnarkVersion, Curve           string
	SourceSHA256, RulesSHA256, SchemaSHA256 string
	RootHeights                             [7]int
	Entries                                 []CatalogEntry
}
type CatalogConfig struct {
	Root, ManifestPath, TrustedManifestSHA256 string
	MaxManifestBytes, MaxArtifactBytes        int64
}
type Catalog struct {
	root     *os.Root
	cfg      CatalogConfig
	manifest CatalogManifest
	entries  map[string]CatalogEntry
}

// LoadedKey belongs to the caller; no mutable gnark objects are cached/shared.
// Use groth16.Prove(CCS, PK, witness, recursion-compatible options) and
// groth16.Verify(proof, VK, public, matching options). No setup is needed here.
type LoadedKey struct {
	CCS constraint.ConstraintSystem
	PK  groth16.ProvingKey
	VK  groth16.VerifyingKey
}

func catalogDigest(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func catalogHashValid(s string) bool {
	b, err := hex.DecodeString(s)
	return err == nil && len(b) == 32 && strings.ToLower(s) == s
}
func catalogPathValid(s string) bool {
	return s != "." && filepath.IsLocal(s) && filepath.Clean(s) == s && !strings.ContainsRune(s, 92)
}

// OpenCatalog authenticates exact manifest bytes BEFORE JSON parsing. The pin
// must come from deployment approval, never from the artifact directory itself.
func OpenCatalog(cfg CatalogConfig) (*Catalog, error) {
	if !filepath.IsAbs(cfg.Root) || !catalogPathValid(cfg.ManifestPath) || !catalogHashValid(cfg.TrustedManifestSHA256) || cfg.MaxManifestBytes < 1 || cfg.MaxManifestBytes > 16<<20 || cfg.MaxArtifactBytes < 1 || cfg.MaxArtifactBytes > 8<<30 {
		return nil, errors.New("invalid catalog configuration or missing external manifest pin")
	}
	root, err := os.OpenRoot(cfg.Root)
	if err != nil {
		return nil, err
	}
	c := &Catalog{root: root, cfg: cfg}
	ok := false
	defer func() {
		if !ok {
			root.Close()
		}
	}()
	data, err := c.readArtifact(context.Background(), Artifact{Path: cfg.ManifestPath, SHA256: cfg.TrustedManifestSHA256}, cfg.MaxManifestBytes, false)
	if err != nil {
		return nil, fmt.Errorf("manifest: %w", err)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err = dec.Decode(&c.manifest); err != nil {
		return nil, err
	}
	var extra any
	if err = dec.Decode(&extra); err != io.EOF {
		return nil, errors.New("trailing manifest JSON")
	}
	// Require the one canonical encoding; rejects duplicate JSON fields, ambiguous
	// encodings and omitted zero-valued fields as well as trailing bytes.
	canonical, err := json.Marshal(c.manifest)
	if err != nil || !bytes.Equal(canonical, data) {
		return nil, errors.New("manifest must be canonical json.Marshal encoding")
	}
	if err = c.validateManifest(); err != nil {
		return nil, err
	}
	ok = true
	return c, nil
}
func (c *Catalog) Close() error   { return c.root.Close() }
func (c *Catalog) SHA256() string { return c.cfg.TrustedManifestSHA256 }
func (c *Catalog) Manifest() CatalogManifest {
	b, _ := json.Marshal(c.manifest)
	var m CatalogManifest
	_ = json.Unmarshal(b, &m)
	return m
}
func (c *Catalog) validateManifest() error {
	m := c.manifest
	if m.Protocol != CatalogProtocol || m.GnarkVersion != CatalogGnarkVersion || m.Curve != "BN254" {
		return errors.New("unsupported catalog protocol/gnark/curve")
	}
	for _, h := range []string{m.SourceSHA256, m.RulesSHA256, m.SchemaSHA256} {
		if !catalogHashValid(h) {
			return errors.New("invalid manifest source/rules/schema digest")
		}
	}
	graph, err := BuildCatalogGraph(m.RootHeights)
	if err != nil {
		return err
	}
	if len(graph) != len(m.Entries) {
		return errors.New("incomplete or additional catalog entries")
	}
	c.entries = make(map[string]CatalogEntry, len(graph))
	for i, e := range m.Entries {
		if !reflect.DeepEqual(e.Node, graph[i]) {
			return fmt.Errorf("catalog graph mismatch at %d", i)
		}
		a := e.Approval
		for _, h := range []string{a.SourceSHA256, a.CircuitSHA256, a.SchemaSHA256, a.ProvenanceSHA256, a.ApprovalSHA256} {
			if !catalogHashValid(h) {
				return fmt.Errorf("missing approval digest for %s", e.Node.ID)
			}
		}
		if a.SourceSHA256 != m.SourceSHA256 {
			return fmt.Errorf("source provenance mismatch for %s", e.Node.ID)
		}
		for _, f := range []Artifact{a.CCS, a.PK, a.VK} {
			if !catalogPathValid(f.Path) || f.Path == c.cfg.ManifestPath || !catalogHashValid(f.SHA256) || f.Bytes < 1 || f.Bytes > c.cfg.MaxArtifactBytes {
				return fmt.Errorf("invalid artifact for %s", e.Node.ID)
			}
		}
		if len(a.Dependencies) != len(e.Node.Dependencies) {
			return fmt.Errorf("dependency approval count for %s", e.Node.ID)
		}
		for j, id := range e.Node.Dependencies {
			dep, ok := c.entries[id]
			if !ok || a.Dependencies[j].ID != id || a.Dependencies[j].VKSHA256 != dep.Approval.VK.SHA256 {
				return fmt.Errorf("dependency VK approval mismatch for %s", e.Node.ID)
			}
		}
		c.entries[e.Node.ID] = e
	}
	return nil
}

// readArtifact never follows a symlink out of the opened root (os.Root enforces
// this even during directory rename races). Static symlink components are also
// refused. Final O_NOFOLLOW closes the lstat/open race; O_NONBLOCK prevents FIFO
// hangs. Bytes hashed and decoded come from the same descriptor and buffer.
func (c *Catalog) readArtifact(ctx context.Context, a Artifact, max int64, exact bool) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !catalogPathValid(a.Path) {
		return nil, errors.New("invalid artifact path")
	}
	part := ""
	for _, s := range strings.Split(a.Path, string(filepath.Separator)) {
		part = filepath.Join(part, s)
		st, err := c.root.Lstat(part)
		if err != nil {
			return nil, err
		}
		if st.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("artifact symlink refused")
		}
	}
	f, err := c.root.OpenFile(a.Path, os.O_RDONLY|unix.O_NONBLOCK|unix.O_NOFOLLOW|unix.O_NOCTTY, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !st.Mode().IsRegular() || st.Size() < 1 || st.Size() > max || (exact && st.Size() != a.Bytes) {
		return nil, errors.New("artifact type/size mismatch")
	}
	b, err := io.ReadAll(io.LimitReader(&catalogContextReader{ctx: ctx, r: f}, st.Size()+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) != st.Size() || catalogDigest(b) != a.SHA256 {
		return nil, errors.New("artifact size/hash mismatch")
	}
	return b, nil
}

type catalogContextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r *catalogContextReader) Read(b []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(b)
}

// Validate checks current file bytes, not cryptographic circuit qualification.
func (c *Catalog) Validate(ctx context.Context, id string) error {
	e, ok := c.entries[id]
	if !ok {
		return fmt.Errorf("unapproved key %s", id)
	}
	for _, a := range []Artifact{e.Approval.CCS, e.Approval.PK, e.Approval.VK} {
		if _, err := c.readArtifact(ctx, a, c.cfg.MaxArtifactBytes, true); err != nil {
			return fmt.Errorf("%s: %w", id, err)
		}
	}
	return nil
}

// Ready binds service identity to the externally pinned whole catalog and checks
// all bytes. Call under processrunner limits for large catalogs; no decoded key
// set is retained in memory. Load performs schema checks at the use boundary.
func (c *Catalog) Ready(ctx context.Context, id service.Identity) error {
	if err := id.Validate(); err != nil {
		return err
	}
	if id.Rules != c.manifest.RulesSHA256 || id.Verifier != c.SHA256() {
		return errors.New("identity rules/verifier catalog mismatch")
	}
	for _, e := range c.manifest.Entries {
		if err := c.Validate(ctx, e.Node.ID); err != nil {
			return err
		}
	}
	return ctx.Err()
}

// Load only decodes independently pinned bytes with gnark's checked ReadFrom.
// Byte limits are not hard allocator limits: gnark serializers contain internal
// lengths. Approved artifact decoding/proving must execute in the OS-limited
// processrunner child, not against attacker-authored manifests in the service.
func (c *Catalog) Load(ctx context.Context, id string) (key *LoadedKey, err error) {
	e, ok := c.entries[id]
	if !ok {
		return nil, fmt.Errorf("unapproved key %s", id)
	}
	defer func() {
		if p := recover(); p != nil {
			key = nil
			err = fmt.Errorf("malformed approved key %s: %v", id, p)
		}
	}()
	key = &LoadedKey{CCS: groth16.NewCS(ecc.BN254), PK: groth16.NewProvingKey(ecc.BN254), VK: groth16.NewVerifyingKey(ecc.BN254)}
	for i, a := range []Artifact{e.Approval.CCS, e.Approval.PK, e.Approval.VK} {
		b, e2 := c.readArtifact(ctx, a, c.cfg.MaxArtifactBytes, true)
		if e2 != nil {
			return nil, e2
		}
		// CCS ReadFrom allocates its advertised totalLen before reading. Validate it
		// against the authenticated physical size and exact supported version first.
		if i == 0 && (len(b) < 32 || binary.LittleEndian.Uint64(b[:8]) != uint64(len(b)-32) || binary.LittleEndian.Uint64(b[8:16]) != 0 || binary.LittleEndian.Uint64(b[16:24]) != 16 || binary.LittleEndian.Uint64(b[24:32]) != 3) {
			return nil, errors.New("invalid CCS length/version header")
		}
		r := bytes.NewReader(b)
		var reader io.ReaderFrom
		switch i {
		case 0:
			reader = key.CCS
		case 1:
			reader = key.PK
		case 2:
			reader = key.VK
		}
		n, e2 := reader.ReadFrom(r)
		if e2 != nil {
			return nil, fmt.Errorf("decode %s: %w", a.Path, e2)
		}
		if n != int64(len(b)) || r.Len() != 0 {
			return nil, errors.New("trailing or incompletely consumed key bytes")
		}
	}
	vk := key.VK.(*bn.VerifyingKey)
	pk := key.PK.(*bn.ProvingKey)
	cs := key.CCS.(*csbn.R1CS)
	if cs.Type != constraint.SystemR1CS || cs.Field().Cmp(ecc.BN254.ScalarField()) != 0 {
		return nil, errors.New("approved CCS is not BN254 R1CS")
	}
	if pk.G1.Alpha.IsInfinity() || pk.G1.Beta.IsInfinity() || pk.G1.Delta.IsInfinity() || vk.G2.Gamma.IsInfinity() || !pk.G1.Alpha.Equal(&vk.G1.Alpha) || !pk.G2.Beta.Equal(&vk.G2.Beta) || !pk.G2.Delta.Equal(&vk.G2.Delta) {
		return nil, errors.New("approved PK/VK setup parameters mismatch")
	}
	commitments, ok := cs.GetCommitments().(constraint.Groth16Commitments)
	if !ok || len(commitments) != len(vk.CommitmentKeys) {
		return nil, errors.New("approved CCS/VK commitments mismatch")
	}
	for i, indices := range vk.PublicAndCommitmentCommitted {
		for _, index := range indices {
			if index < 1 || index > e.Node.PublicInputs+i {
				return nil, errors.New("approved VK commitment index mismatch")
			}
		}
	}
	if key.CCS.GetNbPublicVariables() != e.Node.PublicInputs+1 || len(vk.G1.K) != e.Node.PublicInputs+1+len(vk.CommitmentKeys) || len(pk.CommitmentKeys) != len(vk.CommitmentKeys) || len(vk.PublicAndCommitmentCommitted) != len(vk.CommitmentKeys) || key.CCS.GetNbConstraints() < 1 {
		return nil, errors.New("approved CCS/PK/VK public schema mismatch")
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	return key, nil
}
