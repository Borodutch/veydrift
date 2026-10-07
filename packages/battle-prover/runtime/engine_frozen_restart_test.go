package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	comp "github.com/Borodutch/veydrift/packages/battle-prover/composition"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

const engineFrozenBase = "../composition/staged-public/settlement-phases-v2/full-20261005-v1"

// Historical TEST-LOCAL authority, not chain acquisition or deployment approval.
// Reconstruct the old three-unit Game=1/verifier=7/codehash=77 fixture from ABI
// and journal formulas, through NewEngine/NewTrace's unmodified admission path.
// Changing owner rebuilds a different, internally valid document for replay attacks.
func engineFrozenDocument(t *testing.T, owner uint64) (service.Snapshot, chainsource.Document) {
	t.Helper()
	chain, game, battle := p.Const(8453), p.Const(1), p.Const(100)
	r := chainsource.Release{Version: 3, Rules: witnessDigest(q.RulesID()), Catalog: witnessDigest(q.CatalogID()), Verifier: witnessTestAddress(7), VerifierCodehash: witnessDigest(p.Const(77)), Engine: witnessTestAddress(88), VerifierManifest: strings.Repeat("a", 64)}
	hw := witnessTestZeros(16)
	hw[0], hw[4], hw[5] = p.Const(3), p.Const(5), p.Const(owner)
	en := []p.Uint256{p.Const(88), p.Const(4), q.Purpose(chain, battle)}
	meta := raw.Metadata{Version: p.Const(3), Codehash: p.Const(77), Engine: en[0], RequestID: en[1], Purpose: en[2], Preparation: prep.Context{Identity: prep.Identity{Chain: chain, Game: game, Battle: battle, Rules: q.RulesID(), Catalog: q.CatalogID(), Verifier: p.Const(7)}}}
	var header raw.Header
	copy(header[:], hw)
	journal := raw.Digest(raw.HeaderWords(meta, header)...)
	d := chainsource.Document{Schema: "veydrift.finalized-public-input.v1", ChainID: "8453", Game: witnessTestAddress(1), BattleID: "100", Release: r, Anchor: service.Anchor{Number: 42, Hash: strings.Repeat("c", 64)}, HeaderABI: witnessTestHex(hw...), EngineABI: witnessTestHex(en...), Journal: []chainsource.JournalEntry{}}
	addRow := func(index, source, own, side, typ uint64) {
		row := prep.Row{Source: p.Const(source), Owner: p.Const(own), Count: p.Const(1), Side: side, Type: typ, Tech: p.Technology{Weapons: 0, Shielding: 0, Armor: 0}}
		ws := []p.Uint256{row.Source, row.Owner, row.Count, p.Const(side), p.Const(typ), p.Const(0), p.Const(0), p.Const(0)}
		d.Journal = append(d.Journal, chainsource.JournalEntry{Kind: "row", Index: fmt.Sprint(index), ABI: witnessTestHex(ws...)})
		journal = raw.Digest(raw.RowWords(journal, p.Const(index), row)...)
	}
	addRow(0, 0, owner, 1, 0)
	for i := uint64(0); i < 2; i++ {
		ws := witnessTestZeros(32)
		ws[0], ws[1], ws[2], ws[4], ws[6], ws[21], ws[26] = p.Const(1), p.Const(3+5*i), p.Const(i+1), hw[0], hw[4], p.Const(1), en[1]
		var mission raw.Mission
		copy(mission[:], ws)
		d.Journal = append(d.Journal, chainsource.JournalEntry{Kind: "source", Index: fmt.Sprint(100 + i), ABI: witnessTestHex(ws...)})
		journal = raw.Digest(raw.SourceWords(journal, p.Const(100+i), mission)...)
		addRow(i+1, 100+i, i+1, 0, 10)
	}
	journal = raw.Digest(journal, p.Const(3), p.Const(3))
	random := p.Const(1)
	commitment := raw.Digest(raw.Domain("veydrift.randomness-commitment.v1"), chain, en[0], random)
	rc := raw.Digest(raw.Domain("veydrift.battle-snapshot-purpose.v1"), chain, en[0], en[1], game, en[2], commitment, journal)
	st := []p.Uint256{p.Const(3), q.RulesID(), q.CatalogID(), p.Const(7), p.Const(77), p.Const(3), journal, rc, random, p.Const(3)}
	d.StatusABI = witnessTestHex(st...)
	d.RequestABI = witnessTestHex(game, en[2], commitment, p.Const(90), p.Const(91), random)
	d.PolicyABI = witnessTestHex(p.Const(1), journal)
	d.ChainRecord = witnessDigest(raw.Digest(raw.Domain(q.ChainRecordDomain), chain, game, battle, st[0], st[1], st[2], st[3], st[4], en[0], en[1], en[2], st[6], st[7], st[8], st[9], st[5]))
	return witnessTestSnapshot(t, d), d
}

// Hardcoded independent TEST pins, never taken from receipt metadata. Only VKs
// are admitted; no CCS, PK, prover seam, setup, or production manifest is used.
var engineFrozenRootPins = map[string]string{
	"prep/stage-05":        "af67a8a62b6bc8bca2a436cb4e93209a8ae719cc79b3d538641b9c9fec558359",
	"combat/stage-06":      "b409b88470041e9d1c412e3d5c769d913a8ec2c113c79b1339398d4cb383ca93",
	"attribution/stage-04": "95cfdaf828032e30081b7da4cd3a93241f41a43c0a8cb9a166cafe77a1105f9c",
	"bridge/stage-04":      "ed61f3c8d44ca4d2531b58e8c67f8967bd8cbf76454941d7e5de24c41863406c",
	"report/stage-02":      "aefdbb5ac57e12fceb350d62228be288147c9a0ddbd14521ba98ba01452e6e35",
	"raw/stage-03":         "c7543b292ef8a3423fb1bcec7c887f11f9ddc2eda2713d75f5a50fddef096c0c",
	"output/stage-04":      "30521b11903c68d96662d5c38da9dd7dd2a4a1aaab806d7bd7cf6e88fd7bcc96",
}
var engineFrozenPhases = []string{"prep", "combat", "attribution", "bridge", "report", "raw", "output"}

func engineFrozenCatalog(t *testing.T, s service.Snapshot) *Catalog {
	t.Helper()
	root, err := os.OpenRoot(engineFrozenBase)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	c := &Catalog{root: root, cfg: CatalogConfig{TrustedManifestSHA256: s.Identity.Verifier, MaxArtifactBytes: 1 << 20}, manifest: CatalogManifest{RulesSHA256: s.Identity.Rules, RootHeights: [7]int{5, 6, 4, 4, 2, 3, 4}}, entries: map[string]CatalogEntry{}}
	add := func(node CatalogNode, path, pin string) {
		kb := artifactRead(t, filepath.Join(engineFrozenBase, path))
		if service.Hash(kb) != pin {
			t.Fatal("frozen test VK changed", path)
		}
		c.entries[node.ID] = CatalogEntry{Node: node, Approval: KeyApproval{VK: Artifact{Path: path, SHA256: pin, Bytes: int64(len(kb))}}}
	}
	for phase, name := range engineFrozenPhases {
		id := comp.FamilyID{Phase: phase, Level: c.manifest.RootHeights[phase], Arity: 1}
		dir := fmt.Sprintf("%s/stage-%02d", name, id.Level)
		add(CatalogNode{ID: FamilyKeyID(id), Family: &id, PublicInputs: 3}, dir+"/D-key.vk", engineFrozenRootPins[dir])
	}
	for path, pin := range frontierTestPins {
		id := comp.FamilyID{Phase: comp.RawJournal}
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
		add(CatalogNode{ID: FamilyKeyID(id), Family: &id, PublicInputs: 3}, "raw/"+path+".vk", pin)
	}
	widths := []int{7, 8, 8, 8, 1, 1, 22}
	for i, role := range engineRoles {
		add(CatalogNode{ID: AdapterKeyID(role), Role: role, PublicInputs: widths[i]}, "adapters/"+role+"/receipt.vk", engineAdapterTestPins[role])
	}
	return c
}
func engineFrozenReceipt(t *testing.T, c *Catalog, path string) FamilyReceipt {
	t.Helper()
	var m struct {
		ID          comp.FamilyID
		First, Last [10]string
		Count       [4]string
	}
	base := filepath.Join(engineFrozenBase, path)
	if err := json.Unmarshal(artifactRead(t, base+".json"), &m); err != nil {
		t.Fatal(err)
	}
	r := FamilyReceipt{ID: m.ID, First: m.First, Last: m.Last, Native: NativeReceipt{CatalogSHA256: c.SHA256(), KeyID: FamilyKeyID(m.ID), Proof: artifactRead(t, base+".proof"), Public: artifactRead(t, base+".public")}}
	for i, s := range m.Count {
		n, err := artifactUint(s, 64)
		if err != nil {
			t.Fatal(err)
		}
		r.Count[i] = n.Uint64()
	}
	if _, err := VerifyFamilyReceipt(context.Background(), c, r); err != nil {
		t.Fatal(path, err)
	}
	return r
}
func engineFrozenAdapter(t *testing.T, c *Catalog, role string) NativeReceipt {
	t.Helper()
	base := filepath.Join(engineFrozenBase, "adapters", role, "receipt")
	return NativeReceipt{CatalogSHA256: c.SHA256(), KeyID: AdapterKeyID(role), Proof: artifactRead(t, base+".proof"), Public: artifactRead(t, base+".public")}
}
func engineFrozenMarshal(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func engineFrozenCheckpoint(t *testing.T, e *Engine) []byte {
	t.Helper()
	b, err := e.Checkpoint()
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func engineFrozenReplay(t *testing.T, e *Engine, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if _, err := e.trace.Next(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
}
func engineFrozenInstall(t *testing.T, e *Engine, g engineGroup, finishing bool, receipts ...FamilyReceipt) {
	t.Helper()
	f, err := e.group(g)
	if err != nil {
		t.Fatal(err)
	}
	f.state.Segments = []FrontierSegment{}
	count := new(big.Int)
	for _, r := range receipts {
		f.state.Segments = append(f.state.Segments, FrontierSegment{Start: frontierWord(count), Receipt: r})
		count.Add(count, artifactWord(r.Count[:]))
	}
	f.state.Cursor = frontierWord(count)
	f.state.Finishing = finishing
	// Assembly is test-local; RestoreEngine below authenticates the entire state
	// through the real catalog/crypto/native replay path, with no injected functions.
	if err := validateFrontier(f.state); err != nil {
		t.Fatal(err)
	}
}
func engineFrozenRestore(t *testing.T, s service.Snapshot, d chainsource.Document, c *Catalog, b []byte) *Engine {
	t.Helper()
	e, err := RestoreEngine(context.Background(), s, d.Release, witnessTestLimits, c, b)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(b, engineFrozenCheckpoint(t, e)) {
		t.Fatal("checkpoint changed on restore")
	}
	return e
}

func TestEngineFrozenRawMultiSegmentRestore(t *testing.T) {
	s, d := engineFrozenDocument(t, 3)
	c := engineFrozenCatalog(t, s)
	e, err := NewEngine(s, d.Release, witnessTestLimits, c)
	if err != nil {
		t.Fatal(err)
	}
	engineFrozenReplay(t, e, 3)
	prefix := engineFrozenReceipt(t, c, "raw/stage-01/g00-D-000")
	leaf := engineFrozenReceipt(t, c, "raw/stage-leaf/g00-leaf-002")
	engineFrozenInstall(t, e, engineGroup{comp.RawJournal, "0"}, false, prefix, leaf)
	b := engineFrozenCheckpoint(t, e)
	restored := engineFrozenRestore(t, s, d, c, b)
	if len(restored.frontiers[engineGroup{comp.RawJournal, "0"}].Segments()) != 2 {
		t.Fatal("missing independently verified intervals")
	}
	edits := map[string]func(*frontierState){
		"interval":             func(f *frontierState) { f.Segments[1].Start[0]-- },
		"group":                func(f *frontierState) { f.Binding.Group = "1" },
		"endpoint":             func(f *frontierState) { f.Segments[0].Receipt.Last[1] = "1" },
		"source":               func(f *frontierState) { f.Binding.SourceSHA256 = strings.Repeat("f", 64) },
		"order":                func(f *frontierState) { f.Segments[0], f.Segments[1] = f.Segments[1], f.Segments[0] },
		"missing-prefix-proof": func(f *frontierState) { f.Segments[0].Receipt.Native.Proof = nil },
		"missing-leaf-proof":   func(f *frontierState) { f.Segments[1].Receipt.Native.Proof = nil },
		"missing-segment":      func(f *frontierState) { f.Segments = f.Segments[:1]; f.Cursor = [4]uint64{2} },
		"early-seal":           func(f *frontierState) { f.Finishing = true },
	}
	for name, mutate := range edits {
		t.Run(name, func(t *testing.T) {
			var state engineState
			json.Unmarshal(b, &state)
			var f frontierState
			json.Unmarshal(state.Frontiers[0].Bytes, &f)
			mutate(&f)
			state.Frontiers[0].Bytes = engineFrozenMarshal(t, f)
			if _, err := RestoreEngine(context.Background(), s, d.Release, witnessTestLimits, c, engineFrozenMarshal(t, state)); err == nil {
				t.Fatal("accepted altered proof-bearing checkpoint")
			}
		})
	}
	t.Run("different-input-genuine-proofs", func(t *testing.T) {
		other, doc := engineFrozenDocument(t, 4)
		oe, err := NewEngine(other, doc.Release, witnessTestLimits, c)
		if err != nil {
			t.Fatal(err)
		}
		engineFrozenReplay(t, oe, 3)
		// Rebind ALL envelope metadata and transcript to the new valid source, not
		// merely an input-hash mismatch. The original proofs remain genuine.
		engineFrozenInstall(t, oe, engineGroup{comp.RawJournal, "0"}, false, prefix, leaf)
		_, err = RestoreEngine(context.Background(), other, doc.Release, witnessTestLimits, c, engineFrozenCheckpoint(t, oe))
		if err == nil || !strings.Contains(err.Error(), "frontier/native range mismatch") {
			t.Fatalf("expected native/proof source rejection, got %v", err)
		}
	})
}

func TestEngineFrozenPhaseBoundaryRestore(t *testing.T) {
	s, d := engineFrozenDocument(t, 3)
	c := engineFrozenCatalog(t, s)
	e, err := NewEngine(s, d.Release, witnessTestLimits, c)
	if err != nil {
		t.Fatal(err)
	}
	// Before global source exhaustion, retain full streaming slots (4+2+1),
	// not an early sealed seven-leaf root.
	engineFrozenReplay(t, e, 7)
	engineFrozenInstall(t, e, engineGroup{comp.RawJournal, "0"}, false,
		engineFrozenReceipt(t, c, "raw/stage-02/g00-D-000"),
		engineFrozenReceipt(t, c, "raw/stage-01/g00-D-002"),
		engineFrozenReceipt(t, c, "raw/stage-00/g00-D-006"))
	e = engineFrozenRestore(t, s, d, c, engineFrozenCheckpoint(t, e))
	// Pending preparation crosses phases while retaining three actual raw proof
	// segments; it must not be confused with a proved preparation leaf.
	ev, err := e.trace.Next(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if ev.Phase != comp.Preparation {
		t.Fatal("expected preparation boundary")
	}
	e.pending = ev
	b := engineFrozenCheckpoint(t, e)
	e = engineFrozenRestore(t, s, d, c, b)
	if e.pending == nil || len(e.frontiers) != 1 {
		t.Fatal("phase boundary lost")
	}
	var state engineState
	if err := json.Unmarshal(b, &state); err != nil {
		t.Fatal(err)
	}
	state.Pending = false
	if _, err := RestoreEngine(context.Background(), s, d.Release, witnessTestLimits, c, engineFrozenMarshal(t, state)); err == nil {
		t.Fatal("pending phase accepted without proof")
	}
}

func TestEngineFrozenTerminalRestore(t *testing.T) {
	s, d := engineFrozenDocument(t, 3)
	c := engineFrozenCatalog(t, s)
	e, err := NewEngine(s, d.Release, witnessTestLimits, c)
	if err != nil {
		t.Fatal(err)
	}
	for {
		_, err = e.trace.Next(context.Background())
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	for phase, name := range engineFrozenPhases {
		groups := 1
		if phase == comp.Attribution {
			groups = 2
		}
		for group := 0; group < groups; group++ {
			path := fmt.Sprintf("%s/stage-%02d/g%02d-D-000", name, c.manifest.RootHeights[phase], group)
			r := engineFrozenReceipt(t, c, path)
			engineFrozenInstall(t, e, engineGroup{phase, fmt.Sprint(group)}, true, r)
		}
	}

	// Terminal source + all eight roots (including both attribution groups),
	// followed by every adapter-prefix restart, ending at actual Engine.Result.
	for _, role := range engineRoles {
		e.adapters[role] = engineFrozenAdapter(t, c, role)
		t.Run(role, func(t *testing.T) { e = engineFrozenRestore(t, s, d, c, engineFrozenCheckpoint(t, e)) })
	}
	artifact, err := e.Result(context.Background(), ArtifactLimits{MaxVKBytes: 1 << 20, MaxInputBytes: 100000, MaxArtifactBytes: 1 << 20, MaxProofBytes: 65536, MaxLeaves: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(artifact.Leaves) != 3 || artifact.Manifest.MemberCount != "3" || artifact.Manifest.FinalSide0 != "2" || artifact.Manifest.FinalSide1 != "0" || artifact.Manifest.Rounds != "1" || artifact.Manifest.Outcome != "1" {
		t.Fatal("wrong historical terminal result", artifact.Manifest)
	}
	b := engineFrozenCheckpoint(t, e)
	edits := map[string]func(*engineState){
		"missing-root":          func(s *engineState) { s.Frontiers = s.Frontiers[1:] },
		"frontier-order":        func(s *engineState) { s.Frontiers[0], s.Frontiers[1] = s.Frontiers[1], s.Frontiers[0] },
		"missing-adapter-stage": func(s *engineState) { s.Adapters = append(s.Adapters[:1], s.Adapters[2:]...) },
		"adapter-order":         func(s *engineState) { s.Adapters[0], s.Adapters[1] = s.Adapters[1], s.Adapters[0] },
		"missing-final-proof":   func(s *engineState) { s.Adapters[len(s.Adapters)-1].Proof = nil },
	}
	for name, mutate := range edits {
		t.Run(name, func(t *testing.T) {
			var state engineState
			json.Unmarshal(b, &state)
			mutate(&state)
			if _, err := RestoreEngine(context.Background(), s, d.Release, witnessTestLimits, c, engineFrozenMarshal(t, state)); err == nil {
				t.Fatal("accepted altered terminal checkpoint")
			}
		})
	}
	t.Logf("historical replay only: %s native events, %d authenticated roots, %d adapters, %d leaves; no fresh proving or onchain identity evidence", e.trace.count, len(e.frontiers), len(e.adapters), len(artifact.Leaves))
}
