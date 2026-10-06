package chainsource

import (
	"bytes"
	"context"
	"encoding/json"
	"math/big"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

type foundryDocument struct {
	Game, Rules, Catalog, Engine, Purpose, Header, Snapshot, RandomnessContext, Verifier, VerifierCodehash string
	BattleID, Version, RequestID, Seed, ChainID                                                            json.Number
	Stream                                                                                                 []struct {
		Kind          string
		Index, Source json.Number
		Mission       string
		Row           struct {
			Source, Count, Side, Unit, Weapons, Shielding, Armor json.Number
			Owner                                                string
		}
	}
}

func fixtureNumber(t *testing.T, n json.Number) rb.U {
	t.Helper()
	v, ok := new(big.Int).SetString(n.String(), 10)
	if !ok || v.Sign() < 0 || v.BitLen() > 256 {
		t.Fatalf("bad fixture uint256 %s", n)
	}
	return word(v)
}
func castABI(t *testing.T, sig string, args ...string) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "cast", append([]string{"abi-encode", sig}, args...)...)
	b, e := cmd.CombinedOutput()
	if e != nil {
		t.Fatalf("offline cast ABI: %v %s", e, b)
	}
	out, e := hexbytes(strings.TrimSpace(string(b)))
	if e != nil {
		t.Fatal(e)
	}
	return out
}
func TestFoundryGameFixtureInteroperability(t *testing.T) {
	if _, e := exec.LookPath("cast"); e != nil {
		t.Skip("Foundry cast required for independent ABI encoding")
	}
	b, e := os.ReadFile("../../../docs/battle-proof-qualified-input-fixture.json")
	if e != nil {
		t.Fatal(e)
	}
	var d foundryDocument
	if e = json.Unmarshal(b, &d); e != nil {
		t.Fatal(e)
	}
	id, chain := fixtureNumber(t, d.BattleID), fixtureNumber(t, d.ChainID)
	headerBytes, e := hexbytes(d.Header)
	if e != nil {
		t.Fatal(e)
	}
	hw, e := static(headerBytes, 256, 1, 64, 1, 64, 160, 1, 256, 256, 128, 128, 128, 128, 128, 128, 16)
	if e != nil {
		t.Fatal(e)
	}
	var header rb.Header
	copy(header[:], hw)
	meta := rb.Metadata{Version: fixtureNumber(t, d.Version), Codehash: fromHex(d.VerifierCodehash), Engine: fromHex(d.Engine), RequestID: fixtureNumber(t, d.RequestID), Purpose: fromHex(d.Purpose), Preparation: prep.Context{Identity: prep.Identity{Chain: chain, Game: fromHex(d.Game), Battle: id, Rules: fromHex(d.Rules), Catalog: fromHex(d.Catalog), Verifier: fromHex(d.Verifier)}}}
	version := "(" + d.Version.String() + "," + d.Rules + "," + d.Catalog + "," + d.Verifier + "," + d.VerifierCodehash + ")"
	begin := castABI(t, "f(bytes32,uint256,address,uint256,(uint32,bytes32,bytes32,address,bytes32),address,uint256,bytes32,bytes)", hx(rb.Encode(rb.Domain(rb.RawDomain))), d.ChainID.String(), d.Game, d.BattleID.String(), version, d.Engine, d.RequestID.String(), d.Purpose, d.Header)
	if !bytes.Equal(begin, rb.Encode(rb.HeaderWords(meta, header)...)) {
		t.Fatal("Foundry begin ABI differs")
	}
	journal := fromHex(hx(keccak(begin)))
	// Independently encoded real getter return payloads: every public getter returns
	// bytes, including its static status/row/engine tuples (outer ABI offset/length).
	status := castABI(t, "f((uint32,bytes32,bytes32,address,bytes32),uint8,bytes32,bytes32,uint256,uint256)", version, "3", d.Snapshot, d.RandomnessContext, d.Seed.String(), "2")
	recordPayloads := map[uint64][][]byte{0: {status}, 1: {headerBytes}, 2: {}, 3: {}, 4: {castABI(t, "f(uint32)", d.Version.String())}, 5: {castABI(t, "f(address,uint256,bytes32)", d.Engine, d.RequestID.String(), d.Purpose)}}
	decodedStatus, e := static(status, statusWidths...)
	if e != nil || !eq(decodedStatus[0], meta.Version) || !eq(decodedStatus[5], p.Const(3)) || !eq(decodedStatus[6], fromHex(d.Snapshot)) || !eq(decodedStatus[7], fromHex(d.RandomnessContext)) || !eq(decodedStatus[8], fixtureNumber(t, d.Seed)) || !eq(decodedStatus[9], p.Const(2)) {
		t.Fatal("Foundry status tuple decoder")
	}
	headerEvent := castABI(t, "f(bytes)", d.Header)
	decodedHeader, e := dynamic(headerEvent)
	if e != nil || !bytes.Equal(decodedHeader, headerBytes) {
		t.Fatal("Foundry header event decoder")
	}
	rows := []prep.Row{}
	rawRows := [][]rb.U{}
	var mission rb.Mission
	for _, item := range d.Stream {
		if item.Kind == "source" {
			mb, e := hexbytes(item.Mission)
			if e != nil {
				t.Fatal(e)
			}
			mw, e := rb.DecodeWords(mb, 32)
			if e != nil {
				t.Fatal(e)
			}
			copy(mission[:], mw)
			event := castABI(t, "f(bytes)", item.Mission)
			decoded, e := dynamic(event)
			if e != nil || !bytes.Equal(decoded, mb) {
				t.Fatal("source event ABI")
			}
			encoded := castABI(t, "f(bytes32,uint8,uint256,bytes)", hx(rb.Encode(journal)), "1", item.Source.String(), item.Mission)
			if !bytes.Equal(encoded, rb.Encode(rb.SourceWords(journal, fixtureNumber(t, item.Source), mission)...)) {
				t.Fatal("source journal ABI")
			}
			journal = fromHex(hx(keccak(encoded)))
			recordPayloads[3] = append(recordPayloads[3], mb)
		} else if item.Kind == "row" {
			r := item.Row
			arg := "(" + r.Source.String() + "," + r.Owner + "," + r.Count.String() + "," + r.Side.String() + "," + r.Unit.String() + "," + r.Weapons.String() + "," + r.Shielding.String() + "," + r.Armor.String() + ")"
			rowBytes := castABI(t, "f((uint256,address,uint32,uint8,uint8,uint16,uint16,uint16))", arg)
			w, e := static(rowBytes, 256, 160, 32, 8, 8, 16, 16, 16)
			if e != nil {
				t.Fatal(e)
			}
			row := prep.Row{Source: w[0], Owner: w[1], Count: w[2], Side: rb.Integer(w[3]).Uint64(), Type: rb.Integer(w[4]).Uint64(), Tech: p.Technology{Weapons: rb.Integer(w[5]).Uint64(), Shielding: rb.Integer(w[6]).Uint64(), Armor: rb.Integer(w[7]).Uint64()}}
			encoded := castABI(t, "f(bytes32,uint8,uint256,(uint256,address,uint32,uint8,uint8,uint16,uint16,uint16))", hx(rb.Encode(journal)), "2", item.Index.String(), arg)
			if !bytes.Equal(encoded, rb.Encode(rb.RowWords(journal, fixtureNumber(t, item.Index), row)...)) {
				t.Fatal("row event/journal ABI")
			}
			journal = fromHex(hx(keccak(encoded)))
			recordPayloads[2] = append(recordPayloads[2], rowBytes)
			rows = append(rows, row)
			rawRows = append(rawRows, w)
		} else {
			t.Fatal("unsupported fixture stream")
		}
	}
	seal := castABI(t, "f(bytes32,uint8,uint256)", hx(rb.Encode(journal)), "3", "2")
	if hx(keccak(seal)) != d.Snapshot {
		t.Fatalf("stored Foundry snapshot mismatch: got %s want %s", hx(keccak(seal)), d.Snapshot)
	}
	commitment := rb.Digest(rb.Domain("veydrift.randomness-commitment.v1"), chain, meta.Engine, fixtureNumber(t, d.Seed))
	rc := rb.Digest(rb.Domain("veydrift.battle-snapshot-purpose.v1"), chain, meta.Engine, meta.RequestID, meta.Preparation.Identity.Game, meta.Purpose, commitment, fromHex(d.Snapshot))
	if hx(rb.Encode(rc)) != d.RandomnessContext {
		t.Fatal("stored Foundry engine context mismatch")
	}
	for kind, payloads := range recordPayloads {
		for _, payload := range payloads {
			outer := castABI(t, "f(bytes)", hx(payload))
			inner, e := dynamic(outer)
			if e != nil || !bytes.Equal(inner, payload) {
				t.Fatalf("getter kind%d outer bytes ABI", kind)
			}
		}
	}
	if len(rows) != 2 || rb.Integer(rows[0].Owner).Cmp(rb.Integer(rows[1].Owner)) == 0 || rows[0].Tech.Weapons != uint64(12) {
		t.Fatal("actual mixed-owner research fixture not preserved")
	}
	// Original Foundry labels are NOT the approved linked release. Assert rejection;
	// never relax production New. Explicitly rebind a local fixture's metadata and
	// recompute commitments for a complete HTTP source pass with identical raw rows,
	//16-word header and32-word mission payload except fixture-owned request ID.
	f := newFixture()
	original := f.cfg
	original.URL = "http://localhost:1"
	original.Release.Rules = strings.TrimPrefix(d.Rules, "0x")
	original.Release.Catalog = strings.TrimPrefix(d.Catalog, "0x")
	if _, e = New(original, nil); e == nil {
		t.Fatal("test-only Foundry release accepted in production allowlist")
	}
	f.id = id
	f.cfg.ChainID = d.ChainID.String()
	f.cfg.Game = strings.ToLower(d.Game)
	f.cfg.Release.Engine = strings.ToLower(d.Engine)
	f.header = header
	f.mission = mission
	f.rows = rawRows
	f.cfg.Release.Rules = digest(q.RulesID())
	f.cfg.Release.Catalog = digest(q.CatalogID())
	f.rebuild()
	s := setup(t, f)
	h := service.Anchor{Number: f.head, Hash: blockHash(f.head)}
	ids, e := s.Pending(context.Background(), h, 4)
	if e != nil || len(ids) != 1 {
		t.Fatalf("rebound Foundry HTTP fixture %v %v", ids, e)
	}
	snap, e := s.Snapshot(context.Background(), ids[0], h)
	if e != nil {
		t.Fatal(e)
	}
	var doc Document
	if e = json.Unmarshal(snap.Input, &doc); e != nil {
		t.Fatal(e)
	}
	if doc.HeaderABI != d.Header || len(doc.Journal) != 3 || doc.Journal[0].ABI != hx(recordPayloads[2][0]) || doc.Journal[2].ABI != hx(recordPayloads[2][1]) {
		t.Fatal("Foundry raw body/rows changed in source")
	}
	t.Logf("Foundry fixture original snapshot=%s context=%s; all getter bytes envelopes and source/row event ABI checked; rebound HTTP fixture passed", d.Snapshot, d.RandomnessContext)
}
