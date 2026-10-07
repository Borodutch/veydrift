package runtime

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"

	"github.com/Borodutch/veydrift/packages/battle-prover/composition"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	bn "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/backend/witness"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	rec "github.com/consensys/gnark/std/recursion/groth16"
)

const frontierSchema = "veydrift-verified-frontier-v1"
const maxFrontierBytes = 32 << 20
const maxFamilyProofBytes = 64 << 10

// FamilyReceipt is a canonical PUBLIC artifact, not a verification authority.
// Count is little-endian uint256; endpoint scalars are canonical field decimals.
type FamilyReceipt struct {
	ID          composition.FamilyID
	First, Last [10]string
	Count       [4]uint64
	Native      NativeReceipt
}

func frontierWord(n *big.Int) (out [4]uint64) {
	x := new(big.Int).Set(n)
	for i := range out {
		out[i] = x.Uint64()
		x.Rsh(x, 64)
	}
	return
}

func frontierScalar(v frontend.Variable) (string, error) {
	var s string
	switch x := v.(type) {
	case *big.Int:
		if x == nil {
			return "", errors.New("nil scalar")
		}
		s = x.String()
	case big.Int:
		s = x.String()
	case string:
		s = x
	case int:
		s = fmt.Sprint(x)
	case uint64:
		s = fmt.Sprint(x)
	case uint:
		s = fmt.Sprint(x)
	case int64:
		s = fmt.Sprint(x)
	default:
		return "", fmt.Errorf("unsupported scalar %T", v)
	}
	n, e := artifactUint(s, 254)
	if e != nil || n.Cmp(ecc.BN254.ScalarField()) >= 0 {
		return "", errors.New("noncanonical field scalar")
	}
	return s, nil
}

func NewFamilyReceipt(id composition.FamilyID, r composition.FamilyRange, native NativeReceipt) (FamilyReceipt, error) {
	out := FamilyReceipt{ID: id, Native: native}
	for i := range out.First {
		var e error
		out.First[i], e = frontierScalar(r.First[i])
		if e != nil {
			return FamilyReceipt{}, e
		}
		out.Last[i], e = frontierScalar(r.Last[i])
		if e != nil {
			return FamilyReceipt{}, e
		}
	}
	for i, v := range r.Count {
		s, e := frontierScalar(v)
		if e != nil {
			return FamilyReceipt{}, e
		}
		n, e := artifactUint(s, 64)
		if e != nil {
			return FamilyReceipt{}, e
		}
		out.Count[i] = n.Uint64()
	}
	if _, e := out.Range(); e != nil {
		return FamilyReceipt{}, e
	}
	return cloneFamily(out), nil
}

// Range checks canonical values and semantic work capacity, not the proof.
func (r FamilyReceipt) Range() (composition.FamilyRange, error) {
	var out composition.FamilyRange
	if !r.ID.Valid() {
		return out, errors.New("invalid family identity")
	}
	for i := range r.First {
		for j, s := range []string{r.First[i], r.Last[i]} {
			n, e := artifactUint(s, 254)
			if e != nil || n.Cmp(ecc.BN254.ScalarField()) >= 0 || (i >= composition.Width(r.ID.Phase) && n.Sign() != 0) {
				return out, errors.New("invalid family endpoint")
			}
			if j == 0 {
				out.First[i] = n
			} else {
				out.Last[i] = n
			}
		}
	}
	n := artifactWord(r.Count[:])
	cap := new(big.Int).Lsh(big.NewInt(1), uint(r.ID.Level))
	if n.Sign() == 0 || n.Cmp(cap) > 0 || (r.ID.Arity == 2 && n.Cmp(big.NewInt(2)) < 0) {
		return out, errors.New("invalid family work count")
	}
	if r.ID.Arity == 0 && r.First != r.Last {
		return out, errors.New("leaf endpoints differ")
	}
	out.Count = p.MustValue(n)
	return out, nil
}

func (r FamilyReceipt) Marshal() ([]byte, error) {
	if _, e := r.Range(); e != nil {
		return nil, e
	}
	if len(r.Native.Proof) == 0 || len(r.Native.Proof) > maxFamilyProofBytes || len(r.Native.Public) != 108 || !catalogHashValid(r.Native.CatalogSHA256) || r.Native.KeyID != FamilyKeyID(r.ID) {
		return nil, errors.New("invalid receipt envelope")
	}
	return json.Marshal(r)
}
func ParseFamilyReceipt(data []byte) (FamilyReceipt, error) {
	var r FamilyReceipt
	if len(data) == 0 || len(data) > 128<<10 {
		return r, errors.New("receipt byte limit")
	}
	if e := artifactJSON(data, &r); e != nil {
		return r, e
	}
	_, e := r.Marshal()
	return r, e
}

func cloneFamily(r FamilyReceipt) FamilyReceipt {
	r.Native.Proof = bytes.Clone(r.Native.Proof)
	r.Native.Public = bytes.Clone(r.Native.Public)
	return r
}

// Only authenticated catalog bytes reach the VK allocating decoder. Untrusted
// proof/public headers are checked before checked ReadFrom and canonical roundtrip.
func familyVK(ctx context.Context, c *Catalog, id string) (result *bn.VerifyingKey, err error) {
	defer func() {
		if v := recover(); v != nil {
			result = nil
			err = fmt.Errorf("invalid approved family key: %v", v)
		}
	}()
	if c == nil {
		return nil, errors.New("approved catalog required")
	}
	e, ok := c.entries[id]
	if !ok || e.Node.PublicInputs != 3 || e.Node.Family == nil || FamilyKeyID(*e.Node.Family) != id {
		return nil, errors.New("unapproved family key")
	}
	b, err := c.readArtifact(ctx, e.Approval.VK, c.cfg.MaxArtifactBytes, true)
	if err != nil {
		return nil, err
	}
	vk := new(bn.VerifyingKey)
	if err = artifactBinary(b, vk); err != nil {
		return nil, err
	}
	n := len(vk.CommitmentKeys)
	if n > (maxFamilyProofBytes-164)/32 || len(vk.G1.K) != 4+n || len(vk.PublicAndCommitmentCommitted) != n {
		return nil, errors.New("family VK public schema")
	}
	for i, indices := range vk.PublicAndCommitmentCommitted {
		for _, v := range indices {
			if v < 1 || v > 3+i {
				return nil, errors.New("family VK commitment schema")
			}
		}
	}
	return vk, nil
}

func verifyFamily(ctx context.Context, pin string, r FamilyReceipt, vk *bn.VerifyingKey) (out composition.FamilyEnvelope, err error) {
	defer func() {
		if v := recover(); v != nil {
			out = composition.FamilyEnvelope{}
			err = fmt.Errorf("invalid family encoding: %v", v)
		}
	}()
	if err = ctx.Err(); err != nil {
		return
	}
	fr, e := r.Range()
	if e != nil {
		return out, e
	}
	if vk == nil || r.Native.CatalogSHA256 != pin || r.Native.KeyID != FamilyKeyID(r.ID) {
		return out, errors.New("family catalog/key mismatch")
	}
	n := len(vk.CommitmentKeys)
	if n > (maxFamilyProofBytes-164)/32 || len(vk.G1.K) != 4+n || len(vk.PublicAndCommitmentCommitted) != n {
		return out, errors.New("family VK schema")
	}
	b := r.Native.Proof
	if len(b) != 164+32*n || binary.BigEndian.Uint32(b[128:132]) != uint32(n) {
		return out, errors.New("proof length/commitment count")
	}
	for _, off := range []int{0, 32, 96} {
		if b[off]&0xc0 == 0 {
			return out, errors.New("uncompressed proof point")
		}
	}
	proof := new(bn.Proof)
	if e = artifactBinary(b, proof); e != nil {
		return out, e
	}
	w := r.Native.Public
	if len(w) != 108 || binary.BigEndian.Uint32(w[:4]) != 3 || binary.BigEndian.Uint32(w[4:8]) != 0 || binary.BigEndian.Uint32(w[8:12]) != 3 {
		return out, errors.New("exact three-public witness required")
	}
	pub, e := witness.New(ecc.BN254.ScalarField())
	if e != nil {
		return out, e
	}
	if e = artifactBinary(w, pub); e != nil {
		return out, e
	}
	expected, e := frontend.NewWitness(&familyPublicWitness{FamilyPublic: fr.Public(r.ID.Phase)}, ecc.BN254.ScalarField(), frontend.PublicOnly())
	if e != nil {
		return out, e
	}
	var canonical bytes.Buffer
	if _, e = expected.WriteTo(&canonical); e != nil {
		return out, e
	}
	if !bytes.Equal(w, canonical.Bytes()) {
		return out, errors.New("family range/public mismatch")
	}
	if e = groth16.Verify(proof, vk, pub, rec.GetNativeVerifierOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField())); e != nil {
		return out, e
	}
	a := composition.CatalogAuth{Selector: 0}
	a.Proof, e = rec.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](proof)
	if e != nil {
		return out, e
	}
	a.Witness, e = rec.ValueOfWitness[sw_bn254.ScalarField](pub)
	if e != nil {
		return out, e
	}
	key, e := rec.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](vk)
	if e != nil {
		return out, e
	}
	a.Keys = []composition.Key{key}
	return composition.FamilyEnvelope{Range: fr, Auth: a, Kind: r.ID.Kind}, ctx.Err()
}

type familyPublicWitness struct{ composition.FamilyPublic }

func (*familyPublicWitness) Define(frontend.API) error { return nil }

func VerifyFamilyReceipt(ctx context.Context, c *Catalog, r FamilyReceipt) (composition.FamilyEnvelope, error) {
	if c == nil {
		return composition.FamilyEnvelope{}, errors.New("approved catalog required")
	}
	vk, e := familyVK(ctx, c, r.Native.KeyID)
	if e != nil {
		return composition.FamilyEnvelope{}, e
	}
	return verifyFamily(ctx, c.SHA256(), r, vk)
}

// FrontierBinding is supplied independently on restore, never adopted from disk.
// SourceSHA256 binds the replayable source group; caller must replay Segments.
type FrontierBinding struct {
	Identity     service.Identity
	Anchor       service.Anchor
	Phase        int
	Group        string
	SourceSHA256 string
}
type FrontierSegment struct {
	Start   [4]uint64
	Receipt FamilyReceipt
}
type frontierState struct {
	Schema        string
	Binding       FrontierBinding
	CatalogSHA256 string
	Height        int
	Cursor        [4]uint64
	Finishing     bool
	Segments      []FrontierSegment
}

// Frontier stores O(height) disjoint ordered intervals. Its right edge encodes
// pending work: a raw leaf needs D0; B_h needs D_h; equal D heights need B.
// No independent mutable operation/cursor log can disagree with these intervals.
type Frontier struct {
	catalog *Catalog
	state   frontierState
	// Private seams are exclusively for frozen-proof tests. Public constructors
	// always install the concrete approved catalog and real ProveApproved path.
	verify func(context.Context, FamilyReceipt) (composition.FamilyEnvelope, error)
	keys   func(context.Context, composition.FamilyID) ([]composition.Key, error)
	prove  func(context.Context, composition.FamilyID, frontend.Circuit) (NativeReceipt, error)
}

func NewFrontier(c *Catalog, b FrontierBinding) (*Frontier, error) {
	if c == nil {
		return nil, errors.New("approved catalog required")
	}
	if e := b.Identity.Validate(); e != nil {
		return nil, e
	}
	if b.Identity.Verifier != c.SHA256() || b.Identity.Rules != c.manifest.RulesSHA256 || !catalogHashValid(b.Anchor.Hash) || !catalogHashValid(b.SourceSHA256) || b.Phase < 0 || b.Phase > composition.SettlementOutput {
		return nil, errors.New("frontier authority binding")
	}
	if _, e := artifactUint(b.Group, 256); e != nil {
		return nil, e
	}
	h := c.manifest.RootHeights[b.Phase]
	if h < 0 || h > 256 {
		return nil, errors.New("frontier height")
	}
	f := &Frontier{catalog: c, state: frontierState{Schema: frontierSchema, Binding: b, CatalogSHA256: c.SHA256(), Height: h, Segments: []FrontierSegment{}}}
	f.verify = func(ctx context.Context, r FamilyReceipt) (composition.FamilyEnvelope, error) {
		return VerifyFamilyReceipt(ctx, c, r)
	}
	f.keys = func(ctx context.Context, id composition.FamilyID) ([]composition.Key, error) {
		deps, e := composition.Dependencies(id)
		if e != nil {
			return nil, e
		}
		keys := make([]composition.Key, len(deps))
		for i, d := range deps {
			vk, e := familyVK(ctx, c, FamilyKeyID(d))
			if e != nil {
				return nil, e
			}
			keys[i], e = rec.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](vk)
			if e != nil {
				return nil, e
			}
		}
		return keys, nil
	}
	f.prove = func(ctx context.Context, id composition.FamilyID, a frontend.Circuit) (NativeReceipt, error) {
		return ProveApproved(ctx, c, FamilyKeyID(id), a)
	}
	return f, nil
}

func RestoreFrontier(ctx context.Context, c *Catalog, b FrontierBinding, data []byte) (*Frontier, error) {
	f, e := NewFrontier(c, b)
	if e != nil {
		return nil, e
	}
	if e = f.restore(ctx, data); e != nil {
		return nil, e
	}
	return f, nil
}
func (f *Frontier) restore(ctx context.Context, data []byte) error {
	if len(data) == 0 || len(data) > maxFrontierBytes {
		return errors.New("frontier checkpoint size")
	}
	var s frontierState
	if e := artifactJSON(data, &s); e != nil {
		return e
	}
	if s.Schema != frontierSchema || s.Binding != f.state.Binding || s.CatalogSHA256 != f.state.CatalogSHA256 || s.Height != f.state.Height {
		return errors.New("checkpoint authority/catalog mismatch")
	}
	if e := validateFrontier(s); e != nil {
		return e
	}
	for _, seg := range s.Segments {
		if _, e := f.verify(ctx, seg.Receipt); e != nil {
			return fmt.Errorf("checkpoint receipt: %w", e)
		}
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	f.state = s
	return nil
}

func validateFrontier(s frontierState) error {
	if s.Height < 0 || s.Height > 256 || len(s.Segments) > s.Height+2 || s.Segments == nil {
		return errors.New("frontier shape")
	}
	total := new(big.Int)
	cap := new(big.Int).Lsh(big.NewInt(1), uint(s.Height))
	previous := s.Height + 1
	for i, seg := range s.Segments {
		r := seg.Receipt
		id := r.ID
		if _, e := r.Range(); e != nil {
			return e
		}
		if id.Phase != s.Binding.Phase || id.Level > s.Height || r.Native.CatalogSHA256 != s.CatalogSHA256 || r.Native.KeyID != FamilyKeyID(id) || seg.Start != frontierWord(total) {
			return errors.New("frontier interval/key mismatch")
		}
		count := artifactWord(r.Count[:])
		full := new(big.Int).Lsh(big.NewInt(1), uint(id.Level))
		if i < len(s.Segments)-1 {
			if id.Arity != 1 || id.Level >= previous || count.Cmp(full) != 0 {
				return errors.New("noncanonical prefix slot")
			}
		} else {
			if id.Level > previous {
				return errors.New("noncanonical pending height")
			}
			if !s.Finishing && count.Cmp(full) != 0 {
				return errors.New("nonfull streaming slot")
			}
			// The right edge can tie the prefix while awaiting leaf dispatch,
			// binary dispatch, or the next binary carry.
		}
		previous = id.Level
		total.Add(total, count)
	}
	if total.BitLen() > 256 || total.Cmp(cap) > 0 || s.Cursor != frontierWord(total) || (s.Finishing && total.Sign() == 0) {
		return errors.New("frontier cursor/work mismatch")
	}
	return nil
}

func (f *Frontier) Cursor() [4]uint64 { return f.state.Cursor }
func (f *Frontier) Segments() []FrontierSegment {
	out := make([]FrontierSegment, len(f.state.Segments))
	for i, s := range f.state.Segments {
		out[i] = s
		out[i].Receipt = cloneFamily(s.Receipt)
	}
	return out
}
func (f *Frontier) Checkpoint() ([]byte, error) {
	if e := validateFrontier(f.state); e != nil {
		return nil, e
	}
	b, e := json.Marshal(f.state)
	if len(b) > maxFrontierBytes {
		return nil, errors.New("frontier checkpoint size")
	}
	return b, e
}

// next is pure: transitions are recomputed from authenticated intervals after
// restore; no checkpoint can inject a selector, child order or operation.
func (f *Frontier) next() (composition.FamilyID, []int, []int, bool) {
	ss := f.state.Segments
	n := len(ss)
	if n == 0 {
		return composition.FamilyID{}, nil, nil, false
	}
	id := ss[n-1].Receipt.ID
	target := composition.FamilyID{Phase: id.Phase, Level: id.Level, Arity: 1}
	if id.Arity == 0 {
		return target, []int{n - 1}, []int{id.Kind}, true
	}
	if id.Arity == 2 {
		return target, []int{n - 1}, []int{0}, true
	}
	if n > 1 && ss[n-2].Receipt.ID.Level == id.Level {
		target.Level++
		target.Arity = 2
		return target, []int{n - 2, n - 1}, []int{0, 0}, true
	}
	if f.state.Finishing && id.Level < f.state.Height {
		target.Level++
		return target, []int{n - 1}, []int{1}, true
	}
	return composition.FamilyID{}, nil, nil, false
}

func (f *Frontier) PushLeaf(ctx context.Context, cursor [4]uint64, r FamilyReceipt) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	if f.state.Finishing || cursor != f.state.Cursor || r.ID.Phase != f.state.Binding.Phase || r.ID.Arity != 0 {
		return errors.New("unexpected leaf/cursor or sealed frontier")
	}
	if _, _, _, pending := f.next(); pending {
		return errors.New("advance pending operation before next leaf")
	}
	next := new(big.Int).Add(artifactWord(cursor[:]), big.NewInt(1))
	if next.BitLen() > 256 || next.Cmp(new(big.Int).Lsh(big.NewInt(1), uint(f.state.Height))) > 0 {
		return errors.New("frontier capacity exhausted")
	}
	if _, e := f.verify(ctx, r); e != nil {
		return e
	}
	s := f.state
	s.Segments = append(f.Segments(), FrontierSegment{Start: cursor, Receipt: cloneFamily(r)})
	s.Cursor = frontierWord(next)
	if e := validateFrontier(s); e != nil {
		return e
	}
	f.state = s
	return nil
}

func (f *Frontier) Finish() error {
	if artifactWord(f.state.Cursor[:]).Sign() == 0 {
		return errors.New("empty frontier")
	}
	f.state.Finishing = true
	return nil
}
func (f *Frontier) Root() (FamilyReceipt, bool) {
	if !f.state.Finishing || len(f.state.Segments) != 1 {
		return FamilyReceipt{}, false
	}
	r := f.state.Segments[0].Receipt
	if r.ID.Arity != 1 || r.ID.Level != f.state.Height {
		return FamilyReceipt{}, false
	}
	return cloneFamily(r), true
}

// Advance executes exactly one approved proof, validates it, then commits one
// in-memory transition. Caller persists Checkpoint atomically after every call.
// Run inside the processrunner resource boundary: gnark is not cancellable.
func (f *Frontier) Advance(ctx context.Context) (bool, error) {
	if e := ctx.Err(); e != nil {
		return false, e
	}
	id, indices, selectors, ok := f.next()
	if !ok {
		return false, nil
	}
	if id.Level > f.state.Height {
		return false, errors.New("root height exhausted")
	}
	children := make([]composition.FamilyEnvelope, len(indices))
	for i, j := range indices {
		ch, e := f.verify(ctx, f.state.Segments[j].Receipt)
		if e != nil {
			return false, e
		}
		children[i] = ch
	}
	keys, e := f.keys(ctx, id)
	if e != nil {
		return false, e
	}
	assignment, e := composition.NewNodeWitness(id, children, keys, selectors)
	if e != nil {
		return false, e
	}
	native, e := f.prove(ctx, id, assignment)
	if e != nil {
		return false, e
	}
	receipt, e := NewFamilyReceipt(id, assignment.Range, native)
	if e != nil {
		return false, e
	}
	if _, e = f.verify(ctx, receipt); e != nil {
		return false, e
	}
	if e = ctx.Err(); e != nil {
		return false, e
	}
	s := f.state
	s.Segments = f.Segments()
	// All operations consume an ordered suffix, never arbitrary chosen slots.
	start := indices[0]
	s.Segments = append(s.Segments[:start], FrontierSegment{Start: f.state.Segments[start].Start, Receipt: receipt})
	if e = validateFrontier(s); e != nil {
		return false, e
	}
	f.state = s
	return true, nil
}
