package publisher

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	rt "github.com/Borodutch/veydrift/packages/battle-prover/runtime"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	"math/big"
	"os"
	"strings"
	"testing"
)

// Copied public-only construction from frozen runtime/artifact_test.go.
// Genuine historical proof, FAKE LOCAL source/catalog approval; NOT live acceptance.
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

func artifactTestData(t *testing.T) (*rt.ArtifactVerifier, service.Snapshot, rt.FinalArtifact) {
	t.Helper()
	s := artifactTestAuthority(t)
	approval := rt.ArtifactApproval{VKHash: artifactTestVK, Rules: s.Identity.Rules, VerifierManifest: s.Identity.Verifier}
	limits := rt.ArtifactLimits{MaxVKBytes: 1 << 20, MaxInputBytes: 1 << 20, MaxArtifactBytes: 1 << 20, MaxProofBytes: 4096, MaxLeaves: 100}
	v, e := rt.NewArtifactVerifier(artifactRead(t, artifactFixture+".vk"), approval, limits)
	if e != nil {
		t.Fatal(e)
	}
	var receipt struct{ Values []string }
	if e = json.Unmarshal(artifactRead(t, artifactFixture+".json"), &receipt); e != nil {
		t.Fatal(e)
	}
	a := rt.FinalArtifact{Schema: rt.FinalArtifactSchema, Public: receipt.Values, Proof: artifactRead(t, artifactFixture+".proof"), Leaves: []rt.AllocationLeaf{}}
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
		a.Leaves = append(a.Leaves, rt.AllocationLeaf{Index: fmt.Sprint(n.Index), Cohort: fmt.Sprint(n.Cohort), Owner: decimalHex(n.Owner), Source: n.Source, Side: fmt.Sprint(n.Side), Unit: fmt.Sprint(n.Type), Count: fmt.Sprint(n.Initial), Lost: fmt.Sprint(n.Lost), Survivors: fmt.Sprint(n.Survivors), Next: decimalHex(n.Next)})
	}
	a.Manifest = rt.ArtifactManifest{VKHash: artifactTestVK, InputHash: s.Identity.InputHash, ProofHash: service.Hash(a.Proof), ChainRecord: decimalHex(oracle.Binding), OutputRoot: decimalHex(oracle.Root), MemberCount: "3", Rounds: "1", FinalSide0: "2", FinalSide1: "0", Outcome: "1"}
	return v, s, a
}
