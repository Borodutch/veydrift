package runtime

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"strings"

	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	out "github.com/Borodutch/veydrift/packages/battle-prover/outputbridge"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend"
	"github.com/consensys/gnark/backend/groth16"
	bn "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/backend/solidity"
	"github.com/consensys/gnark/backend/witness"
)

const FinalArtifactSchema = "raw-linked-settlement22-v3"

// ArtifactApproval MUST come from deployment policy, never the proof, receipt,
// development fixture or an adjacent self-signed manifest. Approving a hash is
// also approving that key's full circuit and setup provenance.
type ArtifactApproval struct{ VKHash, Rules, VerifierManifest string }
type ArtifactLimits struct{ MaxVKBytes, MaxInputBytes, MaxArtifactBytes, MaxProofBytes, MaxLeaves int }

// FinalArtifact uses canonical json.Marshal encoding. Proof is the compressed
// gnark WriteTo encoding (base64 in JSON), NOT MarshalSolidity calldata.
type FinalArtifact struct {
	Schema   string
	Manifest ArtifactManifest
	Public   []string
	Proof    []byte
	Leaves   []AllocationLeaf
}

// ArtifactManifest exposes only authenticated settlement facts. It deliberately
// excludes private outputbridge.Manifest advice, which the 22 public fields do
// not independently reveal or authenticate.
type ArtifactManifest struct {
	VKHash, InputHash, ProofHash                                                  string
	ChainRecord, OutputRoot, MemberCount, Rounds, FinalSide0, FinalSide1, Outcome string
}
type AllocationLeaf struct{ Index, Cohort, Owner, Source, Side, Unit, Count, Lost, Survivors, Next string }
type ArtifactVerifier struct {
	vk       *bn.VerifyingKey
	approval ArtifactApproval
	limits   ArtifactLimits
}

func artifactDigest(s string) bool {
	b, err := hex.DecodeString(s)
	return err == nil && len(b) == 32 && hex.EncodeToString(b) == s
}

func NewArtifactVerifier(vkBytes []byte, approval ArtifactApproval, limits ArtifactLimits) (*ArtifactVerifier, error) {
	if !artifactDigest(approval.VKHash) || !artifactDigest(approval.Rules) || !artifactDigest(approval.VerifierManifest) {
		return nil, errors.New("externally approved VK, rules and verifier manifest pins required")
	}
	if limits.MaxVKBytes <= 0 || limits.MaxInputBytes <= 0 || limits.MaxArtifactBytes <= 0 || limits.MaxProofBytes <= 0 || limits.MaxLeaves <= 0 {
		return nil, errors.New("positive artifact resource limits required")
	}
	if len(vkBytes) == 0 || len(vkBytes) > limits.MaxVKBytes || service.Hash(vkBytes) != approval.VKHash {
		return nil, errors.New("unapproved or oversized final verifying key")
	}
	// Hash approval precedes key decoding: unauthenticated length prefixes must
	// never reach gnark's allocating key decoder.
	vk := new(bn.VerifyingKey)
	if err := artifactBinary(vkBytes, vk); err != nil {
		return nil, fmt.Errorf("final key: %w", err)
	}
	n := len(vk.PublicAndCommitmentCommitted)
	if len(vk.G1.K)-n-1 != 22 || len(vk.CommitmentKeys) != n {
		return nil, errors.New("final key public schema mismatch")
	}
	for i, indices := range vk.PublicAndCommitmentCommitted {
		for _, index := range indices {
			if index < 1 || index > 22+i {
				return nil, errors.New("invalid final key commitment index")
			}
		}
	}
	return &ArtifactVerifier{vk: vk, approval: approval, limits: limits}, nil
}

func artifactBinary(b []byte, v interface {
	io.ReaderFrom
	io.WriterTo
}) error {
	r := bytes.NewReader(b)
	if _, err := v.ReadFrom(r); err != nil {
		return err
	}
	if r.Len() != 0 {
		return errors.New("trailing binary bytes")
	}
	var canonical bytes.Buffer
	if _, err := v.WriteTo(&canonical); err != nil {
		return err
	}
	if !bytes.Equal(b, canonical.Bytes()) {
		return errors.New("noncanonical binary encoding")
	}
	return nil
}
func artifactJSON(b []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	canonical, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if !bytes.Equal(b, canonical) {
		return errors.New("noncanonical JSON encoding")
	}
	return nil
}
func artifactUint(s string, bits int) (*big.Int, error) {
	if len(s) == 0 || len(s) > 78 {
		return nil, errors.New("invalid unsigned integer")
	}
	n, ok := new(big.Int).SetString(s, 10)
	if !ok || n.Sign() < 0 || n.BitLen() > bits || n.String() != s {
		return nil, errors.New("noncanonical or oversized unsigned integer")
	}
	return n, nil
}
func artifactWord(v []uint64) *big.Int {
	n := new(big.Int)
	for i := len(v) - 1; i >= 0; i-- {
		n.Lsh(n, 64)
		n.Add(n, new(big.Int).SetUint64(v[i]))
	}
	return n
}
func artifactABI(s string, widths ...int) ([]p.Uint256, error) {
	if !strings.HasPrefix(s, "0x") || len(s) != 2+64*len(widths) {
		return nil, errors.New("invalid authority ABI length")
	}
	b, err := hex.DecodeString(s[2:])
	if err != nil || hex.EncodeToString(b) != s[2:] {
		return nil, errors.New("noncanonical authority ABI")
	}
	words, err := raw.DecodeWords(b, len(widths))
	if err != nil {
		return nil, err
	}
	for i, w := range words {
		if raw.Integer(w).BitLen() > widths[i] {
			return nil, errors.New("noncanonical authority ABI word")
		}
	}
	return words, nil
}

// artifactAuthority checks the source's canonical document and independently
// rebuilds its ChainRecord. Finality, codehash allowlisting, journal completeness
// and randomness authority remain the Source's responsibility, not artifact advice.
func (v *ArtifactVerifier) artifactAuthority(s service.Snapshot) (*big.Int, error) {
	if err := s.Identity.Validate(); err != nil {
		return nil, err
	}
	if s.Identity.Rules != v.approval.Rules || s.Identity.Verifier != v.approval.VerifierManifest {
		return nil, errors.New("snapshot outside approved release")
	}
	if !artifactDigest(s.Anchor.Hash) || len(s.Input) == 0 || len(s.Input) > v.limits.MaxInputBytes || service.Hash(s.Input) != s.Identity.InputHash {
		return nil, errors.New("invalid authoritative snapshot bytes")
	}
	var d chainsource.Document
	if err := artifactJSON(s.Input, &d); err != nil {
		return nil, err
	}
	if d.Schema != "veydrift.finalized-public-input.v1" || d.ChainID != s.Identity.ChainID || d.Game != s.Identity.Game || d.BattleID != s.Identity.BattleID || d.Release.Rules != s.Identity.Rules || d.Release.VerifierManifest != s.Identity.Verifier || d.Anchor != s.Anchor {
		return nil, errors.New("authority document identity mismatch")
	}
	st, err := artifactABI(d.StatusABI, 32, 256, 256, 160, 256, 8, 256, 256, 256, 256)
	if err != nil {
		return nil, err
	}
	en, err := artifactABI(d.EngineABI, 160, 256, 256)
	if err != nil {
		return nil, err
	}
	if raw.Integer(st[5]).Uint64() != 3 {
		return nil, errors.New("battle not awaiting proof")
	}
	chain, _ := artifactUint(d.ChainID, 256)
	battle, _ := artifactUint(d.BattleID, 256)
	game, _ := new(big.Int).SetString(d.Game[2:], 16)
	record := raw.Digest(raw.Domain(q.ChainRecordDomain), p.MustValue(chain), p.MustValue(game), p.MustValue(battle), st[0], st[1], st[2], st[3], st[4], en[0], en[1], en[2], st[6], st[7], st[8], st[9], st[5])
	if !artifactDigest(d.ChainRecord) || hex.EncodeToString(raw.Encode(record)) != d.ChainRecord {
		return nil, errors.New("authority chain record mismatch")
	}
	return raw.Integer(record), nil
}

func (v *ArtifactVerifier) Verify(ctx context.Context, snap service.Snapshot, data []byte) error {
	if v == nil || v.vk == nil {
		return errors.New("final verifier not configured")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	expected, err := v.artifactAuthority(snap)
	if err != nil {
		return err
	}
	if len(data) == 0 || len(data) > v.limits.MaxArtifactBytes {
		return errors.New("empty or oversized final artifact")
	}
	var a FinalArtifact
	if err = artifactJSON(data, &a); err != nil {
		return err
	}
	if a.Schema != FinalArtifactSchema || len(a.Public) != 22 {
		return errors.New("final artifact public schema mismatch")
	}
	if len(a.Proof) == 0 || len(a.Proof) > v.limits.MaxProofBytes || len(a.Leaves) > v.limits.MaxLeaves || a.Leaves == nil {
		return errors.New("missing or oversized final output")
	}
	if a.Manifest.VKHash != v.approval.VKHash || a.Manifest.InputHash != snap.Identity.InputHash || a.Manifest.ProofHash != service.Hash(a.Proof) {
		return errors.New("artifact manifest hash mismatch")
	}
	var limbs [22]uint64
	for i, s := range a.Public {
		n, e := artifactUint(s, 64)
		if e != nil {
			return fmt.Errorf("public %d: %w", i, e)
		}
		limbs[i] = n.Uint64()
	}
	if limbs[12] > 255 || limbs[21] > 2 {
		return errors.New("round/outcome width mismatch")
	}
	values := []*big.Int{artifactWord(limbs[0:4]), artifactWord(limbs[4:8]), artifactWord(limbs[8:12]), new(big.Int).SetUint64(limbs[12]), artifactWord(limbs[13:17]), artifactWord(limbs[17:21]), new(big.Int).SetUint64(limbs[21])}
	claimed := []string{a.Manifest.ChainRecord, a.Manifest.OutputRoot, a.Manifest.MemberCount, a.Manifest.Rounds, a.Manifest.FinalSide0, a.Manifest.FinalSide1, a.Manifest.Outcome}
	for i, n := range values {
		if claimed[i] != n.String() {
			return errors.New("manifest/public settlement mismatch")
		}
	}
	if values[0].Cmp(expected) != 0 {
		return errors.New("proof chain record does not match authority")
	}
	if values[2].Cmp(new(big.Int).SetUint64(uint64(len(a.Leaves)))) != 0 {
		return errors.New("incomplete output member count")
	}
	if err = v.artifactLeaves(ctx, a.Leaves, values); err != nil {
		return err
	}
	// Decode untrusted proof with fixed, approved commitment count first. gnark's
	// generic slice decoder otherwise allocates from an attacker-controlled uint32.
	commitments := len(v.vk.CommitmentKeys)
	if len(a.Proof) != 164+32*commitments || binary.BigEndian.Uint32(a.Proof[128:132]) != uint32(commitments) {
		return errors.New("noncanonical proof length/commitment count")
	}
	// Forbid uncompressed point tags before ReadFrom, which would move the slice
	// count offset. Roundtrip checking alone would happen too late to bound memory.
	for _, offset := range []int{0, 32, 96} {
		if a.Proof[offset]&0xc0 == 0 {
			return errors.New("uncompressed proof point")
		}
	}
	pr := new(bn.Proof)
	if err = artifactBinary(a.Proof, pr); err != nil {
		return fmt.Errorf("final proof encoding: %w", err)
	}
	pub, err := witness.New(ecc.BN254.ScalarField())
	if err != nil {
		return err
	}
	// Build public witness ourselves; never decode attacker-selected field values
	// through a reduction-mod-Fr parser.
	ch := make(chan any, 22)
	for i := range limbs {
		ch <- limbs[i]
	}
	close(ch)
	if err = pub.Fill(22, 0, ch); err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if err = groth16.Verify(pr, v.vk, pub, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)); err != nil {
		return fmt.Errorf("final Groth16 verification: %w", err)
	}
	return ctx.Err()
}

func (v *ArtifactVerifier) artifactLeaves(ctx context.Context, leaves []AllocationLeaf, values []*big.Int) error {
	binding := p.MustValue(values[0])
	expected := p.MustValue(values[1])
	count := p.MustValue(values[2])
	sums := [2]*big.Int{new(big.Int), new(big.Int)}
	for i, l := range leaves {
		if err := ctx.Err(); err != nil {
			return err
		}
		fields := []string{l.Index, l.Cohort, l.Owner, l.Source, l.Side, l.Unit, l.Count, l.Lost, l.Survivors, l.Next}
		widths := []int{256, 256, 160, 256, 1, 8, 32, 32, 32, 256}
		n := make([]*big.Int, len(fields))
		for j, s := range fields {
			x, err := artifactUint(s, widths[j])
			if err != nil {
				return fmt.Errorf("leaf %d field %d: %w", i, j, err)
			}
			n[j] = x
		}
		if n[0].Cmp(new(big.Int).SetUint64(uint64(i))) != 0 || n[6].Sign() == 0 || new(big.Int).Add(n[7], n[8]).Cmp(n[6]) != 0 {
			return errors.New("invalid output leaf index/count")
		}
		leaf := out.Leaf{Index: p.MustValue(n[0]), Cohort: p.MustValue(n[1]), Owner: p.MustValue(n[2]), Source: p.MustValue(n[3]), Side: n[4], Unit: n[5], Count: n[6], Lost: n[7], Survivors: n[8], Next: p.MustValue(n[9])}
		if raw.Integer(leaf.Digest(binding)).Cmp(raw.Integer(expected)) != 0 {
			return errors.New("unauthenticated output leaf/order")
		}
		expected = leaf.Next
		sums[n[4].Uint64()].Add(sums[n[4].Uint64()], n[8])
	}
	if raw.Integer(expected).Cmp(raw.Integer(out.Tail(binding, count))) != 0 {
		return errors.New("output suffix tail mismatch")
	}
	if sums[0].Cmp(values[4]) != 0 || sums[1].Cmp(values[5]) != 0 {
		return errors.New("output survivor aggregate mismatch")
	}
	return nil
}
