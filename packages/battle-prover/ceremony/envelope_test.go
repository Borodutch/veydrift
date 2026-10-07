package ceremony

import (
	"bytes"
	"crypto/ed25519"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
)

// Public fixed DEV test seeds only; never operational keys or ceremony entropy.
func devKey(n byte) ed25519.PrivateKey { return ed25519.NewKeyFromSeed(bytes.Repeat([]byte{n}, 32)) }
func h(s string) string                { return sha([]byte(s)) }
func jsonBytes(t *testing.T, v any) []byte {
	t.Helper()
	b, e := json.Marshal(v)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func manifest() Manifest {
	a := func(s string) Artifact { return Artifact{h(s), 1} }
	p := func(s string) Phase {
		return Phase{[]Transcript{{"dev-operator", a(s)}}, h("policy"), h("beacon"), h("evidence")}
	}
	return Manifest{Format, "development", "", "dev-policy", h("source"), h("deps"), h("rules"), []Node{{"leaf", "bn254", h("circuit"), h("schema"), a("ccs"), a("pk"), a("vk"), []Dependency{}, p("p1"), p("p2")}}}
}
func fixture(t *testing.T) (Envelope, Trust, Binding) {
	m := manifest()
	payload := jsonBytes(t, m)
	msg, e := SigningBytes(payload)
	if e != nil {
		t.Fatal(e)
	}
	key := devKey(1)
	env := Envelope{Domain, payload, []Signature{{"dev-operator", ed25519.Sign(key, msg)}}}
	trust := Trust{[]Signer{{"dev-operator", key.Public().(ed25519.PublicKey), "operator", "development", false}}, Policy{"dev-policy", "development", "", 1, map[string]int{"operator": 1}}}
	return env, trust, Binding{sha(payload), m.SourceSHA256, m.DependenciesSHA256, m.RulesSHA256}
}
func reject(t *testing.T, env Envelope, tr Trust, b Binding) {
	t.Helper()
	r, e := Verify(jsonBytes(t, env), tr, b)
	if !errors.Is(e, ErrUnapproved) || r.Authentic || r.ProductionReady || len(r.Signers) != 0 {
		t.Fatalf("not fail closed: %+v %v", r, e)
	}
}
func TestDevelopmentAuthenticityNotReadiness(t *testing.T) {
	env, tr, b := fixture(t)
	r, e := Verify(jsonBytes(t, env), tr, b)
	if e != nil || !r.Authentic || r.ProductionReady || r.OperatorIndependenceVerified || r.CryptographicTranscriptsVerified {
		t.Fatalf("%+v %v", r, e)
	}
	if !errors.Is(RequireNativeDecode(), ErrNativeDecodeBlocked) {
		t.Fatal("decode gate open")
	}
}
func TestActualFixtureNoProductionTrust(t *testing.T) {
	// Actual pilot VK digest is public, but no operational registry/signature exists.
	env, _, b := fixture(t)
	var m Manifest
	json.Unmarshal(env.Payload, &m)
	m.Nodes[0].VK = Artifact{"ac7dbe488119159d5a2e8d2fa3816fc14ca3656219ffbb85e506653e7ea1ff58", 536}
	env.Payload = jsonBytes(t, m)
	env.Signatures = []Signature{}
	b.PayloadSHA256 = sha(env.Payload)
	reject(t, env, Trust{}, b)
}
func TestSignatureAttacks(t *testing.T) {
	for _, attack := range []string{"unknown", "wrong-key", "wrong-domain", "signed-wrong-domain", "alter-payload", "duplicate", "revoked", "short-signature", "empty-signatures"} {
		t.Run(attack, func(t *testing.T) {
			env, tr, b := fixture(t)
			switch attack {
			case "unknown":
				env.Signatures[0].SignerID = "stranger"
			case "wrong-key":
				tr.Signers[0].PublicKey = devKey(2).Public().(ed25519.PublicKey)
			case "wrong-domain":
				env.Domain = "other-domain"
			case "signed-wrong-domain":
				env.Signatures[0].Signature = ed25519.Sign(devKey(1), append([]byte("other-domain"), env.Payload...))
			case "alter-payload":
				var m Manifest
				json.Unmarshal(env.Payload, &m)
				m.Nodes[0].CircuitSHA256 = h("changed")
				env.Payload = jsonBytes(t, m)
				b.PayloadSHA256 = sha(env.Payload)
			case "duplicate":
				env.Signatures = append(env.Signatures, env.Signatures[0])
			case "revoked":
				tr.Signers[0].Revoked = true
			case "short-signature":
				env.Signatures[0].Signature = []byte{1}
			case "empty-signatures":
				env.Signatures = nil
			}
			reject(t, env, tr, b)
		})
	}
}
func TestExternalBindings(t *testing.T) {
	for _, field := range []string{"payload", "source", "deps", "rules", "policy", "scope"} {
		t.Run(field, func(t *testing.T) {
			env, tr, b := fixture(t)
			switch field {
			case "payload":
				b.PayloadSHA256 = h("wrong")
			case "source":
				b.SourceSHA256 = h("wrong")
			case "deps":
				b.DependenciesSHA256 = h("wrong")
			case "rules":
				b.RulesSHA256 = h("wrong")
			case "policy":
				tr.Policy.ID = "another-policy"
			case "scope":
				tr.Policy.Scope = "independent-claim"
				tr.Signers[0].Scope = "independent-claim"
			}
			reject(t, env, tr, b)
		})
	}
}
func TestRegistryDuplicatesAndRevocation(t *testing.T) {
	for _, attack := range []string{"id", "key", "revoked", "empty", "role", "threshold", "scope"} {
		t.Run(attack, func(t *testing.T) {
			env, tr, b := fixture(t)
			s := tr.Signers[0]
			switch attack {
			case "id":
				s.PublicKey = devKey(2).Public().(ed25519.PublicKey)
				tr.Signers = append(tr.Signers, s)
			case "key":
				s.ID = "alias"
				tr.Signers = append(tr.Signers, s)
			case "revoked":
				tr.Signers[0].Revoked = true
			case "empty":
				tr = Trust{}
			case "role":
				tr.Signers[0].Role = "unexpected"
			case "threshold":
				tr.Policy.Threshold = 0
			case "scope":
				tr.Signers[0].Scope = "independent-claim"
			}
			reject(t, env, tr, b)
		})
	}
}
func TestThresholdAndRoles(t *testing.T) {
	env, tr, b := fixture(t)
	tr.Policy.Threshold = 2
	tr.Policy.RequiredRoles["reviewer"] = 1
	k := devKey(2)
	tr.Signers = append(tr.Signers, Signer{"dev-reviewer", k.Public().(ed25519.PublicKey), "reviewer", "development", false})
	reject(t, env, tr, b)
	msg, _ := SigningBytes(env.Payload)
	env.Signatures = append(env.Signatures, Signature{"dev-reviewer", ed25519.Sign(k, msg)})
	if r, e := Verify(jsonBytes(t, env), tr, b); e != nil || !r.Authentic {
		t.Fatal(e)
	}
	tr.Signers[1].Role = "operator"
	reject(t, env, tr, b)
}
func TestSingleOperatorMode(t *testing.T) {
	env, tr, b := fixture(t)
	var m Manifest
	json.Unmarshal(env.Payload, &m)
	m.TrustMode = "single-operator"
	m.OperatorID = "dev-operator"
	tr.Policy.Scope = "single-operator"
	tr.Policy.OperatorID = m.OperatorID
	tr.Signers[0].Scope = "single-operator"
	// Mode mechanics fixture ONLY: deterministic DEV seed not production approval.
	env.Payload = jsonBytes(t, m)
	b.PayloadSHA256 = sha(env.Payload)
	msg, e := SigningBytes(env.Payload)
	if e != nil {
		t.Fatal(e)
	}
	env.Signatures[0].Signature = ed25519.Sign(devKey(1), msg)
	r, e := Verify(jsonBytes(t, env), tr, b)
	if e != nil || !r.Authentic || r.OperatorIndependenceVerified || r.ProductionReady {
		t.Fatal(r, e)
	}
	m.Nodes[0].Phase1.Transcripts = append(m.Nodes[0].Phase1.Transcripts, Transcript{"dev-operator", Artifact{h("second-contribution"), 1}})
	if _, e = SigningBytes(jsonBytes(t, m)); e != nil {
		t.Fatal("same operator repeated contribution", e)
	}
	m.Nodes[0].Phase1.Transcripts[1].ContributorID = "synthetic-other-person"
	if _, e = SigningBytes(jsonBytes(t, m)); e == nil {
		t.Fatal("synthetic identity accepted")
	}
	tr.Signers = append(tr.Signers, Signer{"synthetic-other-person", devKey(2).Public().(ed25519.PublicKey), "operator", "single-operator", false})
	reject(t, env, tr, b)
}
func TestStrictCanonicalEncoding(t *testing.T) {
	env, tr, b := fixture(t)
	raw := jsonBytes(t, env)
	for _, bad := range [][]byte{append(bytes.Clone(raw), ' '), append(bytes.Clone(raw), []byte("{}")...), []byte("{}"), []byte("null"), bytes.Replace(raw, []byte("{\"Domain\":"), []byte("{\"Unknown\":0,\"Domain\":"), 1)} {
		if bytes.Equal(bad, raw) {
			continue
		}
		if _, e := Verify(bad, tr, b); e == nil {
			t.Fatal("noncanonical accepted")
		}
	}
	duplicate := append([]byte("{\"Domain\":\""+Domain+"\","), raw[1:]...)
	if _, e := Verify(duplicate, tr, b); e == nil {
		t.Fatal("duplicate accepted")
	}
}
func TestManifestBoundsAndChildren(t *testing.T) {
	for _, attack := range []string{"nodes", "records", "artifact-bytes", "total-bytes", "beacon", "duplicate-node", "missing-child", "child-digest", "nil-children", "duplicate-transcript"} {
		t.Run(attack, func(t *testing.T) {
			m := manifest()
			switch attack {
			case "nodes":
				for len(m.Nodes) <= MaxNodes {
					m.Nodes = append(m.Nodes, m.Nodes[0])
				}
			case "records":
				for len(m.Nodes[0].Phase1.Transcripts) <= MaxRecords {
					m.Nodes[0].Phase1.Transcripts = append(m.Nodes[0].Phase1.Transcripts, Transcript{"dev-operator", Artifact{h(fmt.Sprint(len(m.Nodes[0].Phase1.Transcripts))), 1}})
				}
			case "artifact-bytes":
				m.Nodes[0].PK.Bytes = MaxArtifactBytes + 1
			case "total-bytes":
				m.Nodes[0].CCS.Bytes = MaxArtifactBytes
				m.Nodes[0].PK.Bytes = MaxArtifactBytes
				m.Nodes[0].VK.Bytes = MaxArtifactBytes
				m.Nodes[0].Phase1.Transcripts[0].Artifact.Bytes = MaxArtifactBytes
			case "beacon":
				m.Nodes[0].Phase2.BeaconValueSHA256 = ""
			case "duplicate-node":
				m.Nodes = append(m.Nodes, m.Nodes[0])
			case "missing-child":
				m.Nodes[0].Children = []Dependency{{"missing", h("vk")}}
			case "child-digest":
				parent := m.Nodes[0]
				parent.ID = "parent"
				parent.Children = []Dependency{{"leaf", h("wrong")}}
				m.Nodes = append(m.Nodes, parent)
			case "nil-children":
				m.Nodes[0].Children = nil
			case "duplicate-transcript":
				m.Nodes[0].Phase1.Transcripts = append(m.Nodes[0].Phase1.Transcripts, m.Nodes[0].Phase1.Transcripts[0])
			}
			if _, e := SigningBytes(jsonBytes(t, m)); e == nil {
				t.Fatal("invalid metadata accepted")
			}
		})
	}
}
func TestOrderedChildAndTranscriptDigestBinding(t *testing.T) {
	m := manifest()
	parent := m.Nodes[0]
	parent.ID = "parent"
	parent.Children = []Dependency{{"leaf", m.Nodes[0].VK.SHA256}}
	m.Nodes = append(m.Nodes, parent)
	if _, e := SigningBytes(jsonBytes(t, m)); e != nil {
		t.Fatal(e)
	}
	m.Nodes[0], m.Nodes[1] = m.Nodes[1], m.Nodes[0]
	if _, e := SigningBytes(jsonBytes(t, m)); e == nil {
		t.Fatal("parent before child")
	}
}
func TestByteAndSignerCountLimits(t *testing.T) {
	env, tr, b := fixture(t)
	if _, e := Verify(make([]byte, MaxEnvelopeBytes+1), tr, b); e == nil {
		t.Fatal("envelope cap")
	}
	if _, e := SigningBytes(make([]byte, MaxPayloadBytes+1)); e == nil {
		t.Fatal("payload cap")
	}
	for len(env.Signatures) <= MaxSigners {
		env.Signatures = append(env.Signatures, env.Signatures[0])
	}
	reject(t, env, tr, b)
	env, tr, b = fixture(t)
	for len(tr.Signers) <= MaxSigners {
		tr.Signers = append(tr.Signers, tr.Signers[0])
	}
	reject(t, env, tr, b)
}
func TestExactSigningDomainBytes(t *testing.T) {
	payload := jsonBytes(t, manifest())
	got, e := SigningBytes(payload)
	if e != nil {
		t.Fatal(e)
	}
	want := append([]byte(Domain), 0)
	want = binary.BigEndian.AppendUint64(want, uint64(len(payload)))
	want = append(want, payload...)
	if !bytes.Equal(got, want) {
		t.Fatal("domain wire mismatch")
	}
}
