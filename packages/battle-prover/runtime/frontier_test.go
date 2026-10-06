package runtime

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Borodutch/veydrift/packages/battle-prover/composition"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	bn "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	rec "github.com/consensys/gnark/std/recursion/groth16"
)

const frontierFixture = "../composition/staged-public/settlement-phases-v2/full-20261005-v1/raw"

// EXPLICIT TEST-ONLY trust in frozen development artifacts. No setup/proving,
// production catalog promotion, or receipt-supplied VK approval occurs here.
var frontierTestPins = map[string]string{
	"stage-leaf/leaf-key-00": "a339a3beb07816221702bd80002f2e489b8ad1e52518c283a725f67700ba312c",
	"stage-leaf/leaf-key-01": "c0d0cec9354c47afbc355ff76887b7c9266503d0be2d11238009503105c7ac90",
	"stage-leaf/leaf-key-02": "97666d95c764dc8b0f0182bcab7f5a5db87942c199439309962cdb1e65b17f62",
	"stage-leaf/leaf-key-03": "6b5ddb685788d9d3f926cb7754d45306620b8b2156138eb736ae9cebfd913a90",
	"stage-00/D-key":         "8ae8a61c560b680b6725aca1aecdf3c2c5d182deeb6f4bcd37c6323d009521ae",
	"stage-01/D-key":         "5a11bb76d27cb9cc3e3ddef5c885ab1bc3100b676820b994acc4e3e2f58e34f7",
	"stage-02/D-key":         "3b5fe533e60dc67663a35a5ff3668ad03f85a1bdfd6f3236ee0ff298c6349b51",
	"stage-03/D-key":         "c7543b292ef8a3423fb1bcec7c887f11f9ddc2eda2713d75f5a50fddef096c0c",
	"stage-01/B-key":         "a69f8e3cbe6758904a8b2f3fb20a32ea297d5eca019a2760806832aaf74bdf79",
	"stage-02/B-key":         "b61c99274678a65573ef66e713c34a2d1bba80ffa39472301b86faefdbeb001d",
	"stage-03/B-key":         "1546964317e223b76b52f4d479c056d2e0cba832c5840906e824d571b0a3b00a",
}

type frontierFixtures struct {
	keys     map[composition.FamilyID]*bn.VerifyingKey
	receipts []FamilyReceipt
	leaves   []FamilyReceipt
	calls    int
}

func loadFrontierFixtures(t *testing.T) *frontierFixtures {
	t.Helper()
	x := &frontierFixtures{keys: map[composition.FamilyID]*bn.VerifyingKey{}}
	for path, pin := range frontierTestPins {
		id := composition.FamilyID{Phase: composition.RawJournal}
		if strings.HasPrefix(path, "stage-leaf") {
			fmt.Sscanf(path, "stage-leaf/leaf-key-%d", &id.Kind)
		} else {
			var kind string
			fmt.Sscanf(path, "stage-%d/%s", &id.Level, &kind)
			id.Arity = 1
			if kind == "B-key" {
				id.Arity = 2
			}
		}
		b := artifactRead(t, filepath.Join(frontierFixture, path+".vk"))
		if catalogDigest(b) != pin {
			t.Fatal("test trust pin changed", path)
		}
		vk := new(bn.VerifyingKey)
		if e := artifactBinary(b, vk); e != nil {
			t.Fatal(e)
		}
		x.keys[id] = vk
	}
	paths, e := filepath.Glob(frontierFixture + "/stage-*/g00-*.json")
	if e != nil {
		t.Fatal(e)
	}
	for _, path := range paths {
		var m struct {
			ID          composition.FamilyID
			First, Last [10]string
			Count       [4]string
		}
		if e = json.Unmarshal(artifactRead(t, path), &m); e != nil {
			t.Fatal(e)
		}
		r := FamilyReceipt{ID: m.ID, First: m.First, Last: m.Last, Native: NativeReceipt{CatalogSHA256: strings.Repeat("a", 64), KeyID: FamilyKeyID(m.ID)}}
		for i, s := range m.Count {
			n, e := artifactUint(s, 64)
			if e != nil {
				t.Fatal(e)
			}
			r.Count[i] = n.Uint64()
		}
		base := strings.TrimSuffix(path, ".json")
		r.Native.Proof = artifactRead(t, base+".proof")
		r.Native.Public = artifactRead(t, base+".public")
		x.receipts = append(x.receipts, r)
		if m.ID.Arity == 0 {
			x.leaves = append(x.leaves, r)
		}
	}
	if len(x.leaves) != 7 {
		t.Fatal("expected seven frozen leaves")
	}
	return x
}
func (x *frontierFixtures) new(t *testing.T) *Frontier {
	t.Helper()
	pin := strings.Repeat("a", 64)
	f := &Frontier{state: frontierState{Schema: frontierSchema, CatalogSHA256: pin, Height: 3, Segments: []FrontierSegment{}, Binding: FrontierBinding{Phase: composition.RawJournal, Group: "0", SourceSHA256: strings.Repeat("b", 64), Anchor: service.Anchor{Number: 1, Hash: strings.Repeat("c", 64)}, Identity: service.Identity{ChainID: "8453", BattleID: "100", Game: "0x0000000000000000000000000000000000000001", InputHash: strings.Repeat("d", 64), Rules: strings.Repeat("e", 64), Verifier: pin}}}}
	f.verify = func(ctx context.Context, r FamilyReceipt) (composition.FamilyEnvelope, error) {
		return verifyFamily(ctx, pin, r, x.keys[r.ID])
	}
	f.keys = func(ctx context.Context, id composition.FamilyID) ([]composition.Key, error) {
		deps, e := composition.Dependencies(id)
		if e != nil {
			return nil, e
		}
		keys := make([]composition.Key, len(deps))
		for i, d := range deps {
			vk := x.keys[d]
			if vk == nil {
				return nil, errors.New("missing test key")
			}
			keys[i], e = rec.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](vk)
			if e != nil {
				return nil, e
			}
		}
		return keys, nil
	}
	// Return only a real frozen proof for EXACT circuit ID and range. Every
	// Advance still verifies children and output cryptographically. No fake proof.
	f.prove = func(ctx context.Context, id composition.FamilyID, a frontend.Circuit) (NativeReceipt, error) {
		x.calls++
		n, ok := a.(*composition.FamilyNode)
		if !ok {
			return NativeReceipt{}, errors.New("not node")
		}
		want, e := NewFamilyReceipt(id, n.Range, NativeReceipt{})
		if e != nil {
			return NativeReceipt{}, e
		}
		for _, r := range x.receipts {
			if r.ID == id && r.First == want.First && r.Last == want.Last && r.Count == want.Count {
				return cloneFamily(r).Native, nil
			}
		}
		return NativeReceipt{}, fmt.Errorf("no frozen proof for %+v count %v", id, want.Count)
	}
	return f
}
func TestFrontierFrozenProofRestartEveryOperation(t *testing.T) {
	x := loadFrontierFixtures(t)
	f := x.new(t)
	ctx := context.Background()
	restarts := 0
	restart := func() {
		b, e := f.Checkpoint()
		if e != nil {
			t.Fatal(e)
		}
		next := x.new(t)
		if e = next.restore(ctx, b); e != nil {
			t.Fatal(e)
		}
		after, e := next.Checkpoint()
		if e != nil || !bytes.Equal(b, after) {
			t.Fatal("unstable checkpoint", e)
		}
		f = next
		restarts++
	}
	drain := func() {
		for {
			before := x.calls
			worked, e := f.Advance(ctx)
			if e != nil {
				t.Fatal(e)
			}
			if !worked {
				if x.calls != before {
					t.Fatal("idle proof")
				}
				break
			}
			if x.calls != before+1 {
				t.Fatal("more than one proof operation")
			}
			restart()
		}
	}
	for i, r := range x.leaves {
		if e := f.PushLeaf(ctx, [4]uint64{uint64(i)}, r); e != nil {
			t.Fatal(i, e)
		}
		restart()
		if e := f.PushLeaf(ctx, [4]uint64{uint64(i)}, r); e == nil {
			t.Fatal("accepted replay")
		}
		drain()
	}
	if _, ok := f.Root(); ok {
		t.Fatal("unsealed root")
	}
	if e := f.Finish(); e != nil {
		t.Fatal(e)
	}
	restart()
	drain()
	root, ok := f.Root()
	if !ok || root.Count != [4]uint64{7} || root.ID.Level != 3 {
		t.Fatal("wrong root")
	}
	if x.calls != 20 || restarts != 28 {
		t.Fatal("unexpected operations/restarts", x.calls, restarts)
	}
	if e := f.PushLeaf(ctx, f.Cursor(), x.leaves[0]); e == nil {
		t.Fatal("accepted after finish")
	}
	if _, e := VerifyFamilyReceipt(ctx, nil, root); e == nil {
		t.Fatal("test trust escaped")
	}
}

func TestFrontierReceiptTampering(t *testing.T) {
	x := loadFrontierFixtures(t)
	r := x.leaves[0]
	ctx := context.Background()
	if _, e := verifyFamily(ctx, r.Native.CatalogSHA256, r, x.keys[r.ID]); e != nil {
		t.Fatal(e)
	}
	edits := map[string]func(*FamilyReceipt){
		"proof":             func(r *FamilyReceipt) { r.Native.Proof[10] ^= 1 },
		"public":            func(r *FamilyReceipt) { r.Native.Public[30] ^= 1 },
		"proof-length":      func(r *FamilyReceipt) { r.Native.Proof = append(r.Native.Proof, 0) },
		"proof-allocation":  func(r *FamilyReceipt) { binary.BigEndian.PutUint32(r.Native.Proof[128:132], ^uint32(0)) },
		"uncompressed":      func(r *FamilyReceipt) { r.Native.Proof[0] &= 0x3f },
		"public-allocation": func(r *FamilyReceipt) { binary.BigEndian.PutUint32(r.Native.Public[8:12], ^uint32(0)) },
		"private-witness":   func(r *FamilyReceipt) { binary.BigEndian.PutUint32(r.Native.Public[4:8], 1) },
		"range":             func(r *FamilyReceipt) { r.First[0] = "1"; r.Last[0] = "1" },
		"scalar-alias":      func(r *FamilyReceipt) { r.First[0] = "0" + r.First[0] },
		"padding":           func(r *FamilyReceipt) { r.First[9] = "1" },
		"count":             func(r *FamilyReceipt) { r.Count[0] = 2 },
		"key":               func(r *FamilyReceipt) { r.ID.Kind = 1; r.Native.KeyID = FamilyKeyID(r.ID) },
		"catalog":           func(r *FamilyReceipt) { r.Native.CatalogSHA256 = strings.Repeat("f", 64) },
	}
	for name, edit := range edits {
		t.Run(name, func(t *testing.T) {
			bad := cloneFamily(r)
			edit(&bad)
			if _, e := verifyFamily(ctx, r.Native.CatalogSHA256, bad, x.keys[bad.ID]); e == nil {
				t.Fatal("accepted altered receipt")
			}
		})
	}
	b, e := r.Marshal()
	if e != nil {
		t.Fatal(e)
	}
	parsed, e := ParseFamilyReceipt(b)
	if e != nil || parsed.First != r.First {
		t.Fatal(e)
	}
	for _, bad := range [][]byte{append(bytes.Clone(b), ' '), append([]byte("{\"ID\":null,"), b[1:]...)} {
		if _, e := ParseFamilyReceipt(bad); e == nil {
			t.Fatal("accepted noncanonical JSON")
		}
	}
}

func TestFrontierCheckpointMutations(t *testing.T) {
	x := loadFrontierFixtures(t)
	f := x.new(t)
	ctx := context.Background()
	// A real D1 prefix plus a real raw leaf pending D0 exercises every stored
	// receipt, cursor coverage and ordering without generating new proofs.
	for i := 0; i < 3; i++ {
		if e := f.PushLeaf(ctx, f.Cursor(), x.leaves[i]); e != nil {
			t.Fatal(e)
		}
		if i < 2 {
			for {
				ok, e := f.Advance(ctx)
				if e != nil {
					t.Fatal(e)
				}
				if !ok {
					break
				}
			}
		}
	}
	original, e := f.Checkpoint()
	if e != nil {
		t.Fatal(e)
	}
	edits := map[string]func(*frontierState){
		"cursor":        func(s *frontierState) { s.Cursor[0]++ },
		"omit":          func(s *frontierState) { s.Segments = s.Segments[1:] },
		"reorder":       func(s *frontierState) { s.Segments[0], s.Segments[1] = s.Segments[1], s.Segments[0] },
		"offset":        func(s *frontierState) { s.Segments[1].Start[0]-- },
		"group":         func(s *frontierState) { s.Binding.Group = "1" },
		"source":        func(s *frontierState) { s.Binding.SourceSHA256 = strings.Repeat("f", 64) },
		"anchor":        func(s *frontierState) { s.Binding.Anchor.Number++ },
		"identity":      func(s *frontierState) { s.Binding.Identity.BattleID = "101" },
		"height":        func(s *frontierState) { s.Height++ },
		"catalog":       func(s *frontierState) { s.CatalogSHA256 = strings.Repeat("f", 64) },
		"prefix-proof":  func(s *frontierState) { s.Segments[0].Receipt.Native.Proof[10] ^= 1 },
		"pending-proof": func(s *frontierState) { s.Segments[1].Receipt.Native.Proof[10] ^= 1 },
	}
	for name, edit := range edits {
		t.Run(name, func(t *testing.T) {
			var s frontierState
			if e := json.Unmarshal(original, &s); e != nil {
				t.Fatal(e)
			}
			edit(&s)
			bad, _ := json.Marshal(s)
			if e := x.new(t).restore(ctx, bad); e == nil {
				t.Fatal("accepted altered checkpoint")
			}
		})
	}
	before := bytes.Clone(original)
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	calls := x.calls
	if worked, e := f.Advance(canceled); e == nil || worked || x.calls != calls {
		t.Fatal("canceled operation ran")
	}
	if e := x.new(t).restore(canceled, original); e == nil {
		t.Fatal("canceled restore accepted")
	}
	f.prove = func(context.Context, composition.FamilyID, frontend.Circuit) (NativeReceipt, error) {
		return NativeReceipt{}, errors.New("interrupted")
	}
	if worked, e := f.Advance(ctx); e == nil || worked {
		t.Fatal("expected proof failure")
	}
	after, _ := f.Checkpoint()
	if !bytes.Equal(before, after) {
		t.Fatal("failure mutated checkpoint")
	}
	// Returned receipt buffers cannot mutate the frontier.
	copy := f.Segments()
	copy[0].Receipt.Native.Proof[0] ^= 1
	after, _ = f.Checkpoint()
	if !bytes.Equal(before, after) {
		t.Fatal("mutable alias")
	}
}

func TestFrontierUint256Bounds(t *testing.T) {
	max := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
	limbs := frontierWord(max)
	if artifactWord(limbs[:]).Cmp(max) != 0 {
		t.Fatal("uint256 roundtrip")
	}
	// Structural-only arithmetic test; deliberately not a proof/authentication test.
	x := loadFrontierFixtures(t)
	f := x.new(t)
	f.state.Height = 256
	f.state.Finishing = true
	r := cloneFamily(x.leaves[0])
	r.ID = composition.FamilyID{Phase: composition.RawJournal, Level: 256, Arity: 1}
	r.Native.KeyID = FamilyKeyID(r.ID)
	r.Count = limbs
	f.state.Cursor = limbs
	f.state.Segments = []FrontierSegment{{Receipt: r}}
	if e := validateFrontier(f.state); e != nil {
		t.Fatal(e)
	}
	r.Count = [4]uint64{}
	f.state.Segments[0].Receipt = r
	if e := validateFrontier(f.state); e == nil {
		t.Fatal("zero count")
	}
	if _, e := NewFrontier(nil, FrontierBinding{}); e == nil {
		t.Fatal("missing approval")
	}
}

// Exercise production VK-loader and public RestoreFrontier with a concrete
// catalog whose approval is explicitly TEST ONLY. Never expose this fixture
// constructor to application code or persist it as a production manifest.
func TestFrontierConcreteCatalogRestore(t *testing.T) {
	x := loadFrontierFixtures(t)
	f := x.new(t)
	r := x.leaves[0]
	ctx := context.Background()
	root, e := os.OpenRoot(frontierFixture)
	if e != nil {
		t.Fatal(e)
	}
	defer root.Close()
	pin := f.state.CatalogSHA256
	path := "stage-leaf/leaf-key-00.vk"
	b := artifactRead(t, filepath.Join(frontierFixture, path))
	id := r.ID
	c := &Catalog{root: root, cfg: CatalogConfig{TrustedManifestSHA256: pin, MaxArtifactBytes: 1 << 20}, manifest: CatalogManifest{RulesSHA256: f.state.Binding.Identity.Rules, RootHeights: [7]int{0, 0, 0, 0, 0, 3, 0}}, entries: map[string]CatalogEntry{FamilyKeyID(id): {Node: CatalogNode{ID: FamilyKeyID(id), Family: &id, PublicInputs: 3}, Approval: KeyApproval{VK: Artifact{Path: path, SHA256: frontierTestPins["stage-leaf/leaf-key-00"], Bytes: int64(len(b))}}}}}
	concrete, e := NewFrontier(c, f.state.Binding)
	if e != nil {
		t.Fatal(e)
	}
	if e = concrete.PushLeaf(ctx, [4]uint64{}, r); e != nil {
		t.Fatal(e)
	}
	data, e := concrete.Checkpoint()
	if e != nil {
		t.Fatal(e)
	}
	restored, e := RestoreFrontier(ctx, c, f.state.Binding, data)
	if e != nil {
		t.Fatal(e)
	}
	if restored.Cursor() != [4]uint64{1} {
		t.Fatal("wrong restored cursor")
	}
	changed := f.state.Binding
	changed.Group = "1"
	if _, e = RestoreFrontier(ctx, c, changed, data); e == nil {
		t.Fatal("changed binding accepted")
	}
	entry := c.entries[FamilyKeyID(id)]
	entry.Approval.VK.SHA256 = strings.Repeat("f", 64)
	c.entries[FamilyKeyID(id)] = entry
	if _, e = RestoreFrontier(ctx, c, f.state.Binding, data); e == nil {
		t.Fatal("unauthenticated VK accepted")
	}
}
