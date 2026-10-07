// Package ceremony authenticates bounded inventory metadata, never transcripts
// or production readiness. No I/O, gnark decoding, setup or activation occurs.
package ceremony

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
)

const (
	Domain                = "veydrift/ceremony-manifest/ed25519/v1"
	Format                = "veydrift-ceremony-manifest-v1"
	MaxPayloadBytes       = 64 << 10
	MaxEnvelopeBytes      = 128 << 10
	MaxSigners            = 16
	MaxNodes              = 16
	MaxRecords            = 64
	MaxArtifactBytes      = 64 << 20
	MaxTotalArtifactBytes = 256 << 20
)

var ErrUnapproved = errors.New("ceremony authenticity unapproved")
var ErrNativeDecodeBlocked = errors.New("native decode blocked: structural bounds and cryptographic validation not implemented")
var idPattern = regexp.MustCompile("^[a-z0-9][a-z0-9_-]{0,63}$")

type Artifact struct {
	SHA256 string
	Bytes  uint64
}
type Dependency struct {
	ID       string
	VKSHA256 string
}
type Transcript struct {
	ContributorID string
	Artifact      Artifact
}
type Phase struct {
	Transcripts          []Transcript
	BeaconPolicySHA256   string
	BeaconValueSHA256    string
	BeaconEvidenceSHA256 string
}
type Node struct {
	ID            string
	Curve         string
	CircuitSHA256 string
	SchemaSHA256  string
	CCS           Artifact
	PK            Artifact
	VK            Artifact
	Children      []Dependency
	Phase1        Phase
	Phase2        Phase
}
type Manifest struct {
	Format             string
	TrustMode          string // development, single-operator, independent-claim
	OperatorID         string // Exactly one real identity for single-operator mode.
	PolicyID           string
	SourceSHA256       string
	DependenciesSHA256 string
	RulesSHA256        string
	Nodes              []Node
}
type Signature struct {
	SignerID  string
	Signature []byte
}
type Envelope struct {
	Domain     string
	Payload    []byte
	Signatures []Signature
}

// Trust is external CALLER configuration, never a field in an envelope. Keys
// are public. Hold caller inputs immutable during Verify; no production keys
// or private signing operations are embedded here.
type Signer struct {
	ID        string
	PublicKey ed25519.PublicKey
	Role      string
	Scope     string
	Revoked   bool
}
type Policy struct {
	ID            string
	Scope         string
	OperatorID    string
	Threshold     int
	RequiredRoles map[string]int
}
type Trust struct {
	Signers []Signer
	Policy  Policy
}

// Exact payload pin binds all circuits, ordered child VKs/transcripts/beacons.
// Obtain it from reviewed configuration outside the untrusted bundle.
type Binding struct {
	PayloadSHA256      string
	SourceSHA256       string
	DependenciesSHA256 string
	RulesSHA256        string
}
type AuthenticatedSigner struct {
	ID   string
	Role string
}
type Result struct {
	Authentic                        bool
	PayloadSHA256                    string
	TrustMode                        string
	OperatorID                       string
	Signers                          []AuthenticatedSigner
	OperatorIndependenceVerified     bool
	CryptographicTranscriptsVerified bool
	ProductionReady                  bool
}

// Signature authenticity NEVER authorizes unbounded native deserialization.
func RequireNativeDecode() error { return ErrNativeDecodeBlocked }
func sha(b []byte) string        { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func validHash(s string) bool {
	b, e := hex.DecodeString(s)
	return e == nil && len(b) == 32 && s == hex.EncodeToString(b)
}
func validID(s string) bool { return idPattern.MatchString(s) }
func scope(s string) bool {
	return s == "development" || s == "single-operator" || s == "independent-claim"
}
func canonical(data []byte, v any, limit int) error {
	if len(data) == 0 || len(data) > limit {
		return errors.New("JSON byte limit")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return e
	}
	encoded, e := json.Marshal(v)
	if e != nil {
		return e
	}
	// Exact encoding rejects omitted/duplicate fields, alternate spelling,
	// whitespace and trailing JSON. Struct field order is the wire order.
	if !bytes.Equal(encoded, data) {
		return errors.New("noncanonical JSON")
	}
	return nil
}

// SigningBytes: Domain || 0x00 || uint64 big-endian length || exact payload.
// No key generation or signing occurs; callers sign with their own procedure.
func SigningBytes(payload []byte) ([]byte, error) {
	if _, e := parseManifest(payload); e != nil {
		return nil, e
	}
	out := make([]byte, 0, len(Domain)+9+len(payload))
	out = append(out, Domain...)
	out = append(out, 0)
	out = binary.BigEndian.AppendUint64(out, uint64(len(payload)))
	return append(out, payload...), nil
}
func parseManifest(payload []byte) (Manifest, error) {
	var m Manifest
	if e := canonical(payload, &m, MaxPayloadBytes); e != nil {
		return m, e
	}
	if m.Format != Format || !scope(m.TrustMode) || !validID(m.PolicyID) || !validHash(m.SourceSHA256) || !validHash(m.DependenciesSHA256) || !validHash(m.RulesSHA256) {
		return m, errors.New("manifest identity")
	}
	if (m.TrustMode == "single-operator" && !validID(m.OperatorID)) || (m.TrustMode != "single-operator" && m.OperatorID != "") {
		return m, errors.New("operator identity")
	}
	if len(m.Nodes) == 0 || len(m.Nodes) > MaxNodes {
		return m, errors.New("node count")
	}
	nodes := map[string]Node{}
	records := 0
	var total uint64
	artifact := func(a Artifact) error {
		if !validHash(a.SHA256) || a.Bytes == 0 || a.Bytes > MaxArtifactBytes {
			return errors.New("artifact bounds/hash")
		}
		total += a.Bytes
		if total > MaxTotalArtifactBytes {
			return errors.New("artifact total bytes")
		}
		return nil
	}
	phase := func(p Phase) error {
		if len(p.Transcripts) == 0 || len(p.Transcripts) > MaxRecords || !validHash(p.BeaconPolicySHA256) || !validHash(p.BeaconValueSHA256) || !validHash(p.BeaconEvidenceSHA256) {
			return errors.New("phase/beacon metadata")
		}
		digests := map[string]bool{}
		for _, t := range p.Transcripts {
			records++
			if records > MaxRecords {
				return errors.New("transcript count")
			}
			// Repeated contributions by one operator are honest, not extra identities.
			if !validID(t.ContributorID) || digests[t.Artifact.SHA256] || (m.TrustMode == "single-operator" && t.ContributorID != m.OperatorID) {
				return errors.New("contributor/transcript identity")
			}
			digests[t.Artifact.SHA256] = true
			if e := artifact(t.Artifact); e != nil {
				return e
			}
		}
		return nil
	}
	for _, n := range m.Nodes {
		if !validID(n.ID) || nodes[n.ID].ID != "" || n.Curve != "bn254" || !validHash(n.CircuitSHA256) || !validHash(n.SchemaSHA256) {
			return m, errors.New("node identity/curve")
		}
		for _, a := range []Artifact{n.CCS, n.PK, n.VK} {
			if e := artifact(a); e != nil {
				return m, e
			}
		}
		if n.Children == nil || len(n.Children) > MaxNodes {
			return m, errors.New("child list")
		}
		seen := map[string]bool{}
		for _, c := range n.Children {
			child, ok := nodes[c.ID]
			if !ok || seen[c.ID] || !validHash(c.VKSHA256) || c.VKSHA256 != child.VK.SHA256 {
				return m, errors.New("child order/VK binding")
			}
			seen[c.ID] = true
		}
		if e := phase(n.Phase1); e != nil {
			return m, e
		}
		if e := phase(n.Phase2); e != nil {
			return m, e
		}
		nodes[n.ID] = n
	}
	return m, nil
}
func registry(t Trust) (map[string]Signer, error) {
	p := t.Policy
	if !validID(p.ID) || !scope(p.Scope) || p.Threshold < 1 || p.Threshold > MaxSigners || len(p.RequiredRoles) == 0 || len(p.RequiredRoles) > MaxSigners || len(t.Signers) == 0 || len(t.Signers) > MaxSigners {
		return nil, errors.New("missing/invalid external trust policy")
	}
	if p.Scope == "single-operator" {
		if !validID(p.OperatorID) || p.Threshold != 1 || len(t.Signers) != 1 || len(p.RequiredRoles) != 1 || p.RequiredRoles["operator"] != 1 || t.Signers[0].ID != p.OperatorID {
			return nil, errors.New("single real operator policy required")
		}
	} else if p.OperatorID != "" {
		return nil, errors.New("unexpected operator policy")
	}
	sum := 0
	for role, n := range p.RequiredRoles {
		if !validID(role) || n < 1 || n > MaxSigners {
			return nil, errors.New("role policy")
		}
		sum += n
	}
	if sum > p.Threshold {
		return nil, errors.New("role thresholds exceed overall threshold")
	}
	byID := map[string]Signer{}
	keys := map[string]bool{}
	active := 0
	roles := map[string]int{}
	for _, s := range t.Signers {
		key := string(s.PublicKey)
		if !validID(s.ID) || !validID(s.Role) || s.Scope != p.Scope || len(s.PublicKey) != ed25519.PublicKeySize || byID[s.ID].ID != "" || keys[key] {
			return nil, errors.New("invalid/duplicate trusted signer ID/key/scope")
		}
		if p.RequiredRoles[s.Role] == 0 {
			return nil, errors.New("unpermitted signer role")
		}
		keys[key] = true
		byID[s.ID] = s
		if !s.Revoked {
			active++
			roles[s.Role]++
		}
	}
	if active < p.Threshold {
		return nil, errors.New("insufficient active trusted signers")
	}
	for role, n := range p.RequiredRoles {
		if roles[role] < n {
			return nil, errors.New("insufficient active role signers")
		}
	}
	return byID, nil
}

// Verify authenticates named signatures only. Every failure returns zero Result.
// Re-evaluates caller revocation and thresholds every time; no cached approval.
func Verify(raw []byte, trust Trust, expected Binding) (Result, error) {
	fail := func(e error) (Result, error) { return Result{}, fmt.Errorf("%w: %v", ErrUnapproved, e) }
	signers, e := registry(trust)
	if e != nil {
		return fail(e)
	}
	for _, h := range []string{expected.PayloadSHA256, expected.SourceSHA256, expected.DependenciesSHA256, expected.RulesSHA256} {
		if !validHash(h) {
			return fail(errors.New("missing external binding"))
		}
	}
	var env Envelope
	if e = canonical(raw, &env, MaxEnvelopeBytes); e != nil {
		return fail(e)
	}
	if env.Domain != Domain || len(env.Signatures) == 0 || len(env.Signatures) > MaxSigners {
		return fail(errors.New("domain/signature count"))
	}
	m, e := parseManifest(env.Payload)
	if e != nil {
		return fail(e)
	}
	if sha(env.Payload) != expected.PayloadSHA256 || m.SourceSHA256 != expected.SourceSHA256 || m.DependenciesSHA256 != expected.DependenciesSHA256 || m.RulesSHA256 != expected.RulesSHA256 || m.PolicyID != trust.Policy.ID || m.TrustMode != trust.Policy.Scope || m.OperatorID != trust.Policy.OperatorID {
		return fail(errors.New("external payload/source/dependency/rules/policy binding"))
	}
	message, e := SigningBytes(env.Payload)
	if e != nil {
		return fail(e)
	}
	seen := map[string]bool{}
	roles := map[string]int{}
	authenticated := make([]AuthenticatedSigner, 0, len(env.Signatures))
	for _, sig := range env.Signatures {
		s, ok := signers[sig.SignerID]
		if !ok || seen[sig.SignerID] || s.Revoked || len(sig.Signature) != ed25519.SignatureSize {
			return fail(errors.New("unknown/duplicate/revoked/malformed signer"))
		}
		if !ed25519.Verify(s.PublicKey, message, sig.Signature) {
			return fail(errors.New("signature mismatch"))
		}
		seen[s.ID] = true
		roles[s.Role]++
		authenticated = append(authenticated, AuthenticatedSigner{s.ID, s.Role})
	}
	if len(authenticated) < trust.Policy.Threshold {
		return fail(errors.New("signature threshold"))
	}
	for role, n := range trust.Policy.RequiredRoles {
		if roles[role] < n {
			return fail(errors.New("role threshold"))
		}
	}
	return Result{Authentic: true, PayloadSHA256: sha(env.Payload), TrustMode: m.TrustMode, OperatorID: m.OperatorID, Signers: authenticated}, nil
}
