package runtime

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"strings"
	"testing"

	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	bn "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/backend/witness"
)

const artifactFixture = "../composition/staged-public/settlement-phases-v2/full-20261005-v1/adapters/final/receipt"

// This is EXPLICIT TEST TRUST ONLY. Never used or promoted by production code.
const artifactTestVK = "bb99dcb236243b696f0cb812ccc16df40e50659f769168a5458df861473d6505"

func artifactRead(t *testing.T, path string) []byte {
	t.Helper()
	b, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func artifactEncode(t *testing.T, v any) []byte {
	t.Helper()
	b, e := json.Marshal(v)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func artifactTestHex(w p.Uint256) string { return hex.EncodeToString(raw.Encode(w)) }

// Rebuild only the fixture's public journal ABI hash, not its expensive battle
// witness/proof. These fake addresses and source authority are test-only. The
// real proof, key and independent allocation fixture are read without edits.
func artifactTestAuthority(t *testing.T) service.Snapshot {
	id := prep.Identity{Chain: p.Const(8453), Game: p.Const(1), Battle: p.Const(100), Rules: q.RulesID(), Catalog: q.CatalogID(), Verifier: p.Const(7)}
	meta := raw.Metadata{Preparation: prep.Context{Identity: id}, Version: p.Const(q.LinkedVersion), Codehash: p.Const(77), Engine: p.Const(88), RequestID: p.Const(4), Purpose: q.Purpose(id.Chain, id.Battle)}
	var h raw.Header
	for i := range h {
		h[i] = p.Const(0)
	}
	h[0] = p.Const(3)
	h[4] = p.Const(5)
	h[5] = p.Const(3)
	journal := raw.Digest(raw.HeaderWords(meta, h)...)
	tech := p.Technology{Weapons: 0, Shielding: 0, Armor: 0}
	rows := []prep.Row{{Owner: p.Const(3), Source: p.Const(0), Count: p.Const(1), Side: 1, Type: 0, Tech: tech}, {Owner: p.Const(1), Source: p.Const(100), Count: p.Const(1), Side: 0, Type: 10, Tech: tech}, {Owner: p.Const(2), Source: p.Const(101), Count: p.Const(1), Side: 0, Type: 10, Tech: tech}}
	journal = raw.Digest(raw.RowWords(journal, p.Const(0), rows[0])...)
	for i, r := range rows[1:] {
		var m raw.Mission
		for j := range m {
			m[j] = p.Const(0)
		}
		m[0] = p.Const(1)
		m[1] = p.Const(3)
		if i == 1 {
			m[1] = p.Const(8)
		}
		m[2] = r.Owner
		m[4] = p.Const(3)
		m[6] = p.Const(5)
		m[21] = p.Const(1)
		m[26] = p.Const(4)
		journal = raw.Digest(raw.SourceWords(journal, r.Source, m)...)
		journal = raw.Digest(raw.RowWords(journal, p.Const(uint64(i+1)), r)...)
	}
	journal = raw.Digest(journal, p.Const(3), p.Const(3))
	commitment := raw.Digest(raw.Domain("veydrift.randomness-commitment.v1"), id.Chain, meta.Engine, p.Const(1))
	randomness := raw.Digest(raw.Domain("veydrift.battle-snapshot-purpose.v1"), id.Chain, meta.Engine, meta.RequestID, id.Game, meta.Purpose, commitment, journal)
	st := []p.Uint256{meta.Version, id.Rules, id.Catalog, id.Verifier, meta.Codehash, p.Const(3), journal, randomness, p.Const(1), p.Const(3)}
	en := []p.Uint256{meta.Engine, meta.RequestID, meta.Purpose}
	record := raw.Digest(raw.Domain(q.ChainRecordDomain), id.Chain, id.Game, id.Battle, st[0], st[1], st[2], st[3], st[4], en[0], en[1], en[2], st[6], st[7], st[8], st[9], st[5])
	d := chainsource.Document{Schema: "veydrift.finalized-public-input.v1", ChainID: "8453", Game: "0x0000000000000000000000000000000000000001", BattleID: "100", Release: chainsource.Release{Version: q.LinkedVersion, Rules: artifactTestHex(id.Rules), Catalog: artifactTestHex(id.Catalog), Verifier: "0x0000000000000000000000000000000000000007", VerifierCodehash: artifactTestHex(meta.Codehash), Engine: "0x0000000000000000000000000000000000000058", VerifierManifest: strings.Repeat("a", 64)}, Anchor: service.Anchor{Number: 1, Hash: strings.Repeat("b", 64)}, StatusABI: "0x" + hex.EncodeToString(raw.Encode(st...)), EngineABI: "0x" + hex.EncodeToString(raw.Encode(en...)), ChainRecord: artifactTestHex(record)}
	b := artifactEncode(t, d)
	return service.Snapshot{Identity: service.Identity{ChainID: d.ChainID, Game: d.Game, BattleID: d.BattleID, InputHash: service.Hash(b), Rules: d.Release.Rules, Verifier: d.Release.VerifierManifest}, Anchor: d.Anchor, Input: b}
}

func artifactTestData(t *testing.T) (*ArtifactVerifier, service.Snapshot, FinalArtifact) {
	t.Helper()
	s := artifactTestAuthority(t)
	approval := ArtifactApproval{VKHash: artifactTestVK, Rules: s.Identity.Rules, VerifierManifest: s.Identity.Verifier}
	limits := ArtifactLimits{MaxVKBytes: 1 << 20, MaxInputBytes: 1 << 20, MaxArtifactBytes: 1 << 20, MaxProofBytes: 4096, MaxLeaves: 100}
	v, e := NewArtifactVerifier(artifactRead(t, artifactFixture+".vk"), approval, limits)
	if e != nil {
		t.Fatal(e)
	}
	var receipt struct{ Values []string }
	if e = json.Unmarshal(artifactRead(t, artifactFixture+".json"), &receipt); e != nil {
		t.Fatal(e)
	}
	a := FinalArtifact{Schema: FinalArtifactSchema, Public: receipt.Values, Proof: artifactRead(t, artifactFixture+".proof"), Leaves: []AllocationLeaf{}}
	var oracle struct {
		Binding, Root, Tail string
		Nodes               []struct {
			Index, Cohort, Side, Type, Initial, Lost, Survivors int
			Owner, Source, Next                                 string
		}
	}
	if e = json.Unmarshal(artifactRead(t, "../outputbridge/solidity-fixture.json"), &oracle); e != nil {
		t.Fatal(e)
	}
	decimalHex := func(s string) string {
		n, ok := new(big.Int).SetString(strings.TrimPrefix(s, "0x"), 16)
		if !ok {
			t.Fatal("fixture hex")
		}
		return n.String()
	}
	for _, n := range oracle.Nodes {
		a.Leaves = append(a.Leaves, AllocationLeaf{Index: fmt.Sprint(n.Index), Cohort: fmt.Sprint(n.Cohort), Owner: decimalHex(n.Owner), Source: n.Source, Side: fmt.Sprint(n.Side), Unit: fmt.Sprint(n.Type), Count: fmt.Sprint(n.Initial), Lost: fmt.Sprint(n.Lost), Survivors: fmt.Sprint(n.Survivors), Next: decimalHex(n.Next)})
	}
	a.Manifest = ArtifactManifest{VKHash: artifactTestVK, InputHash: s.Identity.InputHash, ProofHash: service.Hash(a.Proof), ChainRecord: decimalHex(oracle.Binding), OutputRoot: decimalHex(oracle.Root), MemberCount: "3", Rounds: "1", FinalSide0: "2", FinalSide1: "0", Outcome: "1"}
	return v, s, a
}

func TestArtifactFrozenFinalAuthentic(t *testing.T) {
	v, s, a := artifactTestData(t)
	if e := v.Verify(context.Background(), s, artifactEncode(t, a)); e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if e := v.Verify(ctx, s, artifactEncode(t, a)); e != context.Canceled {
		t.Fatalf("cancel: %v", e)
	}
}
func TestArtifactRejectsTampering(t *testing.T) {
	v, s, a := artifactTestData(t)
	original := artifactEncode(t, a)
	attacks := map[string]func(*FinalArtifact){
		"schema":           func(a *FinalArtifact) { a.Schema = "legacy" },
		"wrong-key":        func(a *FinalArtifact) { a.Manifest.VKHash = strings.Repeat("1", 64) },
		"wrong-input":      func(a *FinalArtifact) { a.Manifest.InputHash = strings.Repeat("1", 64) },
		"wrong-proof-hash": func(a *FinalArtifact) { a.Manifest.ProofHash = strings.Repeat("1", 64) },
		"proof-bit":        func(a *FinalArtifact) { a.Proof[1] ^= 1; a.Manifest.ProofHash = service.Hash(a.Proof) },
		"proof-extra":      func(a *FinalArtifact) { a.Proof = append(a.Proof, 0); a.Manifest.ProofHash = service.Hash(a.Proof) },
		"proof-allocation-bomb": func(a *FinalArtifact) {
			binary.BigEndian.PutUint32(a.Proof[128:132], 0xffffffff)
			a.Manifest.ProofHash = service.Hash(a.Proof)
		},
		"proof-uncompressed-tag": func(a *FinalArtifact) { a.Proof[0] &= 0x3f; a.Manifest.ProofHash = service.Hash(a.Proof) },
		"manifest-root":          func(a *FinalArtifact) { a.Manifest.OutputRoot = "1" },
		"omit-zero-loss":         func(a *FinalArtifact) { a.Leaves = a.Leaves[1:] },
		"reorder":                func(a *FinalArtifact) { a.Leaves[0], a.Leaves[1] = a.Leaves[1], a.Leaves[0] },
		"duplicate":              func(a *FinalArtifact) { a.Leaves[1] = a.Leaves[0] },
		"extra-leaf":             func(a *FinalArtifact) { a.Leaves = append(a.Leaves, a.Leaves[2]) },
		"missing-leaves":         func(a *FinalArtifact) { a.Leaves = nil },
		"tail":                   func(a *FinalArtifact) { a.Leaves[2].Next = "0" },
		"owner":                  func(a *FinalArtifact) { a.Leaves[0].Owner = "4" },
		"leaf-leading-zero":      func(a *FinalArtifact) { a.Leaves[0].Count = "01" },
		"owner-overflow":         func(a *FinalArtifact) { a.Leaves[0].Owner = new(big.Int).Lsh(big.NewInt(1), 160).String() },
		"count-overflow":         func(a *FinalArtifact) { a.Leaves[0].Count = "4294967296" },
		"round-overflow":         func(a *FinalArtifact) { a.Public[12] = "256"; a.Manifest.Rounds = "256" },
		"outcome-overflow":       func(a *FinalArtifact) { a.Public[21] = "3"; a.Manifest.Outcome = "3" },
		// Rebinding every redundant manifest field cannot authorize changed public values.
		"rebound-round":   func(a *FinalArtifact) { a.Public[12] = "2"; a.Manifest.Rounds = "2" },
		"rebound-outcome": func(a *FinalArtifact) { a.Public[21] = "2"; a.Manifest.Outcome = "2" },
	}
	for i := 0; i < 22; i++ {
		index := i
		attacks[fmt.Sprintf("public-%d", i)] = func(a *FinalArtifact) {
			n, _ := new(big.Int).SetString(a.Public[index], 10)
			a.Public[index] = n.Add(n, big.NewInt(1)).String()
		}
	}
	for _, bad := range []string{"01", "-1", "+1", "1e0", " 1", "18446744073709551616"} {
		b := bad
		attacks["scalar-"+bad] = func(a *FinalArtifact) { a.Public[0] = b }
	}
	for name, change := range attacks {
		t.Run(name, func(t *testing.T) {
			var copy FinalArtifact
			if e := json.Unmarshal(original, &copy); e != nil {
				t.Fatal(e)
			}
			change(&copy)
			if e := v.Verify(context.Background(), s, artifactEncode(t, copy)); e == nil {
				t.Fatal("accepted tampering")
			}
		})
	}
	for name, b := range map[string][]byte{"trailing": append(append([]byte{}, original...), 10), "duplicate": append([]byte(`{"Schema":"raw-linked-settlement22-v3",`), original[1:]...), "unknown": append([]byte(`{"Untrusted":0,`), original[1:]...)} {
		t.Run(name, func(t *testing.T) {
			if name == "duplicate" && bytes.Equal(b, original) {
				t.Fatal("test duplicate injection failed")
			}
			if e := v.Verify(context.Background(), s, b); e == nil {
				t.Fatal("accepted noncanonical JSON")
			}
		})
	}
}

func TestArtifactAuthorityAndApproval(t *testing.T) {
	v, s, a := artifactTestData(t)
	data := artifactEncode(t, a)
	for _, field := range []string{"InputHash", "BattleID", "ChainID", "Game", "Rules", "Verifier", "Anchor"} {
		t.Run(field, func(t *testing.T) {
			bad := s
			switch field {
			case "InputHash":
				bad.Identity.InputHash = strings.Repeat("c", 64)
			case "BattleID":
				bad.Identity.BattleID = "101"
			case "ChainID":
				bad.Identity.ChainID = "1"
			case "Game":
				bad.Identity.Game = "0x0000000000000000000000000000000000000002"
			case "Rules":
				bad.Identity.Rules = strings.Repeat("c", 64)
			case "Verifier":
				bad.Identity.Verifier = strings.Repeat("c", 64)
			case "Anchor":
				bad.Anchor.Number++
			}
			if e := v.Verify(context.Background(), bad, data); e == nil {
				t.Fatal("accepted changed authority")
			}
		})
	}
	var d chainsource.Document
	if e := json.Unmarshal(s.Input, &d); e != nil {
		t.Fatal(e)
	}
	d.ChainRecord = strings.Repeat("c", 64)
	s.Input = artifactEncode(t, d)
	s.Identity.InputHash = service.Hash(s.Input)
	a.Manifest.InputHash = s.Identity.InputHash
	if e := v.Verify(context.Background(), s, artifactEncode(t, a)); e == nil {
		t.Fatal("accepted claimed record without recomputation")
	}
	key := artifactRead(t, artifactFixture+".vk")
	if _, e := NewArtifactVerifier(key, ArtifactApproval{}, v.limits); e == nil {
		t.Fatal("self-approved fixture")
	}
	bad := v.approval
	bad.VKHash = strings.Repeat("c", 64)
	if _, e := NewArtifactVerifier(key, bad, v.limits); e == nil {
		t.Fatal("wrong pin")
	}
	for _, encoded := range [][]byte{append(append([]byte{}, key...), 0), key[:len(key)-1]} {
		bad = v.approval
		bad.VKHash = service.Hash(encoded)
		if _, e := NewArtifactVerifier(encoded, bad, v.limits); e == nil {
			t.Fatal("noncanonical key")
		}
	}
	pr := new(bn.Proof)
	if e := artifactBinary(a.Proof, pr); e != nil {
		t.Fatal(e)
	}
	var uncompressed bytes.Buffer
	if _, e := pr.WriteRawTo(&uncompressed); e != nil {
		t.Fatal(e)
	}
	a.Proof = uncompressed.Bytes()
	a.Manifest.ProofHash = service.Hash(a.Proof)
	// Reset the valid authority to reach the binary proof gate.
	s = artifactTestAuthority(t)
	a.Manifest.InputHash = s.Identity.InputHash
	if e := v.Verify(context.Background(), s, artifactEncode(t, a)); e == nil {
		t.Fatal("accepted uncompressed proof")
	}
}

// These cases reach cryptographic verification, rather than just redundant
// manifest checks; no setup or proving is performed.
func TestArtifactCryptographicRejections(t *testing.T) {
	v, s, a := artifactTestData(t)
	pr := new(bn.Proof)
	if e := artifactBinary(a.Proof, pr); e != nil {
		t.Fatal(e)
	}
	pub, e := witness.New(ecc.BN254.ScalarField())
	if e != nil {
		t.Fatal(e)
	}
	ch := make(chan any, 22)
	for _, s := range a.Public {
		n, _ := artifactUint(s, 64)
		ch <- n
	}
	close(ch)
	if e = pub.Fill(22, 0, ch); e != nil {
		t.Fatal(e)
	}
	if e = groth16.Verify(pr, v.vk, pub); e == nil {
		t.Fatal("default non-Solidity hash accepted final receipt")
	}
	// A different, well-formed same-schema key is not the authentic key.
	other := new(bn.VerifyingKey)
	if e = artifactBinary(artifactRead(t, artifactFixture+".vk"), other); e != nil {
		t.Fatal(e)
	}
	other.G1.Alpha.Neg(&other.G1.Alpha)
	var encoded bytes.Buffer
	if _, e = other.WriteTo(&encoded); e != nil {
		t.Fatal(e)
	}
	approval := v.approval
	approval.VKHash = service.Hash(encoded.Bytes())
	alternate, e := NewArtifactVerifier(encoded.Bytes(), approval, v.limits)
	if e != nil {
		t.Fatal(e)
	}
	a.Manifest.VKHash = approval.VKHash
	if e = alternate.Verify(context.Background(), s, artifactEncode(t, a)); e == nil || !strings.Contains(e.Error(), "Groth16") {
		t.Fatalf("wrong-key cryptographic rejection: %v", e)
	}
	_, _, a = artifactTestData(t)
	a.Public[12] = "2"
	a.Manifest.Rounds = "2"
	if e = v.Verify(context.Background(), s, artifactEncode(t, a)); e == nil || !strings.Contains(e.Error(), "Groth16") {
		t.Fatalf("changed-round cryptographic rejection: %v", e)
	}
}

func TestArtifactOperationalLimits(t *testing.T) {
	v, s, a := artifactTestData(t)
	data := artifactEncode(t, a)
	for _, which := range []string{"input", "artifact", "proof", "leaves"} {
		t.Run(which, func(t *testing.T) {
			copy := *v
			switch which {
			case "input":
				copy.limits.MaxInputBytes = len(s.Input) - 1
			case "artifact":
				copy.limits.MaxArtifactBytes = len(data) - 1
			case "proof":
				copy.limits.MaxProofBytes = len(a.Proof) - 1
			case "leaves":
				copy.limits.MaxLeaves = len(a.Leaves) - 1
			}
			if e := copy.Verify(context.Background(), s, data); e == nil {
				t.Fatal("budget ignored")
			}
		})
	}
	if _, e := NewArtifactVerifier(artifactRead(t, artifactFixture+".vk"), v.approval, ArtifactLimits{}); e == nil {
		t.Fatal("zero limits")
	}
}
