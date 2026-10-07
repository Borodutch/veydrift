package runtime

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"testing"

	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
)

var witnessTestLimits = WitnessLimits{MaxInputBytes: 100000, MaxJournalEntries: 100, MaxRows: 30, MaxChunkSteps: 10}

func witnessTestHex(ws ...p.Uint256) string { return "0x" + hex.EncodeToString(raw.Encode(ws...)) }
func witnessTestAddress(n uint64) string    { return "0x" + witnessDigest(p.Const(n))[24:] }
func witnessTestZeros(n int) []p.Uint256 {
	out := make([]p.Uint256, n)
	for i := range out {
		out[i] = p.Const(0)
	}
	return out
}

// Builds varied public documents from journal records, not settlement helpers.
// The runtime has no dependency on this test generator.
func witnessTestDocument(t *testing.T, variant int, count uint64) (service.Snapshot, chainsource.Document) {
	t.Helper()
	r := chainsource.Release{Version: 3, Rules: witnessDigest(q.RulesID()), Catalog: witnessDigest(q.CatalogID()), Verifier: witnessTestAddress(33), VerifierCodehash: strings.Repeat("a", 64), Engine: witnessTestAddress(44), VerifierManifest: strings.Repeat("b", 64)}
	chain := p.MustValue(new(big.Int).Add(new(big.Int).Lsh(big.NewInt(1), 180), big.NewInt(8453)))
	battle := p.MustValue(new(big.Int).Add(new(big.Int).Lsh(big.NewInt(1), 200), big.NewInt(int64(variant+1))))
	game := p.Const(55)
	hw := witnessTestZeros(16)
	hw[0] = battle
	hw[1] = p.Const(uint64(variant % 2))
	hw[2] = p.Const(7)
	hw[3] = p.Const(1)
	hw[4] = p.Const(100)
	hw[5] = p.Const(77)
	hw[9] = p.MustValue(new(big.Int).Lsh(big.NewInt(1), 100))
	hw[15] = p.Const(5000)
	en := []p.Uint256{witnessWord(r.Engine), p.MustValue(new(big.Int).Lsh(big.NewInt(1), 210)), q.Purpose(chain, battle)}
	meta := raw.Metadata{Version: p.Const(3), Codehash: witnessWord(r.VerifierCodehash), Engine: en[0], RequestID: en[1], Purpose: en[2], Preparation: prep.Context{Identity: prep.Identity{Chain: chain, Game: game, Battle: battle, Rules: q.RulesID(), Catalog: q.CatalogID(), Verifier: witnessWord(r.Verifier)}}}
	var header raw.Header
	copy(header[:], hw)
	journal := raw.Digest(raw.HeaderWords(meta, header)...)
	d := chainsource.Document{Schema: "veydrift.finalized-public-input.v1", ChainID: raw.Integer(chain).String(), Game: witnessTestAddress(55), BattleID: raw.Integer(battle).String(), Release: r, Anchor: service.Anchor{Number: 42, Hash: strings.Repeat("c", 64)}, HeaderABI: witnessTestHex(hw...), EngineABI: witnessTestHex(en...), Journal: []chainsource.JournalEntry{}}
	rowCount := uint64(0)
	addRow := func(source, owner p.Uint256, n, side, typ, tech uint64) {
		ws := []p.Uint256{source, owner, p.Const(n), p.Const(side), p.Const(typ), p.Const(tech), p.Const(tech + 1), p.Const(tech + 2)}
		row := prep.Row{Source: source, Owner: owner, Count: p.Const(n), Side: side, Type: typ, Tech: p.Technology{Weapons: tech, Shielding: tech + 1, Armor: tech + 2}}
		d.Journal = append(d.Journal, chainsource.JournalEntry{Kind: "row", Index: fmt.Sprint(rowCount), ABI: witnessTestHex(ws...)})
		journal = raw.Digest(raw.RowWords(journal, p.Const(rowCount), row)...)
		rowCount++
	}
	if variant > 0 {
		addRow(p.Const(0), hw[5], count, 1, 16, uint64(variant))
	}
	if variant > 1 {
		for i := 0; i < variant-1; i++ {
			source := p.MustValue(new(big.Int).Add(raw.Integer(battle), big.NewInt(int64(i))))
			mission := witnessTestZeros(32)
			mission[0] = p.Const(1)
			mission[1] = p.Const(3 + uint64(i%2)*5)
			mission[2] = p.Const(uint64(88 + i))
			mission[4] = hw[0]
			mission[6] = hw[4]
			mission[12] = p.Const(count)
			mission[26] = en[1]
			var m raw.Mission
			copy(m[:], mission)
			d.Journal = append(d.Journal, chainsource.JournalEntry{Kind: "source", Index: raw.Integer(source).String(), ABI: witnessTestHex(mission...)})
			journal = raw.Digest(raw.SourceWords(journal, source, m)...)
			addRow(source, mission[2], count, 0, 0, uint64(i+5))
		}
	}
	journal = raw.Digest(journal, p.Const(3), p.Const(rowCount))
	random := p.Const(uint64(123 + variant))
	commitment := raw.Digest(raw.Domain("veydrift.randomness-commitment.v1"), chain, en[0], random)
	rc := raw.Digest(raw.Domain("veydrift.battle-snapshot-purpose.v1"), chain, en[0], en[1], game, en[2], commitment, journal)
	st := []p.Uint256{p.Const(3), q.RulesID(), q.CatalogID(), witnessWord(r.Verifier), witnessWord(r.VerifierCodehash), p.Const(3), journal, rc, random, p.Const(rowCount)}
	d.StatusABI = witnessTestHex(st...)
	d.RequestABI = witnessTestHex(game, en[2], commitment, p.Const(90), p.Const(91), random)
	d.PolicyABI = witnessTestHex(p.Const(1), journal)
	d.ChainRecord = witnessDigest(raw.Digest(raw.Domain(q.ChainRecordDomain), chain, game, battle, st[0], st[1], st[2], st[3], st[4], en[0], en[1], en[2], st[6], st[7], st[8], st[9], st[5]))
	return witnessTestSnapshot(t, d), d
}
func witnessTestSnapshot(t *testing.T, d chainsource.Document) service.Snapshot {
	t.Helper()
	b, e := json.Marshal(d)
	if e != nil {
		t.Fatal(e)
	}
	return service.Snapshot{Identity: service.Identity{ChainID: d.ChainID, Game: d.Game, BattleID: d.BattleID, InputHash: service.Hash(b), Rules: d.Release.Rules, Verifier: d.Release.VerifierManifest}, Anchor: d.Anchor, Input: b}
}
func TestWitnessVariedDocumentsAndBoundedRestart(t *testing.T) {
	for variant := 0; variant < 4; variant++ {
		t.Run(fmt.Sprint(variant), func(t *testing.T) {
			snap, d := witnessTestDocument(t, variant, 2)
			w, e := NewPreparationWitness(snap, d.Release, witnessTestLimits)
			if e != nil {
				t.Fatal(e)
			}
			want := 2 + variant*variant + variant + variant*2
			if w.PreparationSteps() != fmt.Sprint(want) {
				t.Fatalf("steps %s != %d", w.PreparationSteps(), want)
			}
			steps, e := w.Chunk(context.Background(), 2)
			if e != nil {
				t.Fatal(e)
			}
			if len(steps) != 2 {
				t.Fatal("chunk")
			}
			cp, e := w.Checkpoint()
			if e != nil {
				t.Fatal(e)
			}
			b, _ := json.Marshal(cp)
			var persisted PreparationCheckpoint
			if e = json.Unmarshal(b, &persisted); e != nil {
				t.Fatal(e)
			}
			restarted, e := RestorePreparationWitness(snap, d.Release, witnessTestLimits, persisted)
			if e != nil {
				t.Fatal(e)
			}
			if _, e = restarted.Chunk(context.Background(), 1); e == nil {
				t.Fatal("unverified replay allowed")
			}
			for i := 0; i < 2; i++ {
				done, e := restarted.Replay(context.Background(), 1)
				if e != nil || done != (i == 1) {
					t.Fatalf("replay %v %v", done, e)
				}
			}
			for !w.Done() {
				a, e := w.Chunk(context.Background(), 3)
				if e != nil {
					t.Fatal(e)
				}
				b, e := restarted.Chunk(context.Background(), 3)
				if e != nil {
					t.Fatal(e)
				}
				if len(a) != len(b) || len(a) > 3 {
					t.Fatal("bounded suffix")
				}
				for i := range a {
					if a[i].After.Commitment().Cmp(b[i].After.Commitment()) != 0 {
						t.Fatal("different resumed transition")
					}
				}
			}
			if !restarted.Done() {
				t.Fatal("restart not done")
			}
			ca, _ := w.Checkpoint()
			cb, _ := restarted.Checkpoint()
			if ca != cb {
				t.Fatal("restart identity")
			}
			rs, e := w.RawWitnesses()
			if e != nil {
				t.Fatal(e)
			}
			if len(rs) != len(d.Journal)+2 {
				t.Fatal("raw trace count")
			}
			linked, e := w.QualificationWitness()
			if e != nil {
				t.Fatal(e)
			}
			if witnessDigest(linked.ChainRecord) != d.ChainRecord {
				t.Fatal("record")
			}
		})
	}
}
func TestWitnessPreparationAssignmentsSolve(t *testing.T) {
	snap, d := witnessTestDocument(t, 2, 1)
	w, e := NewPreparationWitness(snap, d.Release, witnessTestLimits)
	if e != nil {
		t.Fatal(e)
	}
	seen := map[int]bool{}
	systems := map[int]constraint.ConstraintSystem{}
	for !w.Done() {
		ss, e := w.Chunk(context.Background(), 2)
		if e != nil {
			t.Fatal(e)
		}
		for _, s := range ss {
			cs := systems[s.Kind]
			if cs == nil {
				var err error
				cs, err = frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, prep.Shape(s.Kind))
				if err != nil {
					t.Fatal(err)
				}
				systems[s.Kind] = cs
			}
			assignment, e := frontend.NewWitness(s, ecc.BN254.ScalarField())
			if e != nil {
				t.Fatal(e)
			}
			if e = cs.IsSolved(assignment); e != nil {
				t.Fatalf("kind %d: %v", s.Kind, e)
			}
			seen[s.Kind] = true
		}
	}
	if len(seen) != 5 {
		t.Fatal("missing preparation phase")
	}
}
func TestWitnessRejectsMalformedAuthority(t *testing.T) {
	snap, d := witnessTestDocument(t, 3, 1)
	mutateABI := func(s string, index int, value p.Uint256) string {
		b, _ := hex.DecodeString(s[2:])
		ws, _ := raw.DecodeWords(b, len(b)/32)
		ws[index] = value
		return witnessTestHex(ws...)
	}
	tests := map[string]func(*chainsource.Document){
		"schema":           func(d *chainsource.Document) { d.Schema = "other" },
		"release":          func(d *chainsource.Document) { d.Release.VerifierManifest = strings.Repeat("d", 64) },
		"status phase":     func(d *chainsource.Document) { d.StatusABI = mutateABI(d.StatusABI, 5, p.Const(2)) },
		"abi width":        func(d *chainsource.Document) { d.HeaderABI = mutateABI(d.HeaderABI, 1, p.Const(2)) },
		"blocked":          func(d *chainsource.Document) { d.HeaderABI = mutateABI(d.HeaderABI, 6, p.Const(1)) },
		"unrecorded moon":  func(d *chainsource.Document) { d.HeaderABI = mutateABI(d.HeaderABI, 3, p.Const(0)) },
		"hex case":         func(d *chainsource.Document) { d.HeaderABI = strings.ToUpper(d.HeaderABI) },
		"unknown event":    func(d *chainsource.Document) { d.Journal[0].Kind = "evil" },
		"row order":        func(d *chainsource.Document) { d.Journal[0].Index = "1" },
		"index format":     func(d *chainsource.Document) { d.Journal[0].Index = "00" },
		"row side":         func(d *chainsource.Document) { d.Journal[0].ABI = mutateABI(d.Journal[0].ABI, 3, p.Const(0)) },
		"row owner":        func(d *chainsource.Document) { d.Journal[0].ABI = mutateABI(d.Journal[0].ABI, 1, p.Const(88)) },
		"zero count":       func(d *chainsource.Document) { d.Journal[0].ABI = mutateABI(d.Journal[0].ABI, 2, p.Const(0)) },
		"invalid type":     func(d *chainsource.Document) { d.Journal[0].ABI = mutateABI(d.Journal[0].ABI, 4, p.Const(24)) },
		"mission count":    func(d *chainsource.Document) { d.Journal[1].ABI = mutateABI(d.Journal[1].ABI, 12, p.Const(2)) },
		"duplicate source": func(d *chainsource.Document) { d.Journal[3].Index = d.Journal[1].Index },
		"owner research": func(d *chainsource.Document) {
			d.Journal[3].ABI = mutateABI(d.Journal[3].ABI, 2, p.Const(88))
			d.Journal[4].ABI = mutateABI(d.Journal[4].ABI, 1, p.Const(88))
		},
		"owner width": func(d *chainsource.Document) {
			d.Journal[0].ABI = mutateABI(d.Journal[0].ABI, 1, p.MustValue(new(big.Int).Lsh(big.NewInt(1), 160)))
		},
		"missing row":       func(d *chainsource.Document) { d.Journal = d.Journal[:len(d.Journal)-1] },
		"journal seal":      func(d *chainsource.Document) { d.StatusABI = mutateABI(d.StatusABI, 6, p.Const(1)) },
		"request authority": func(d *chainsource.Document) { d.RequestABI = mutateABI(d.RequestABI, 0, p.Const(1)) },
		"policy":            func(d *chainsource.Document) { d.PolicyABI = mutateABI(d.PolicyABI, 0, p.Const(0)) },
		"record":            func(d *chainsource.Document) { d.ChainRecord = strings.Repeat("0", 64) },
	}
	for name, fn := range tests {
		t.Run(name, func(t *testing.T) {
			var dd chainsource.Document
			if e := json.Unmarshal(snap.Input, &dd); e != nil {
				t.Fatal(e)
			}
			fn(&dd)
			ss := witnessTestSnapshot(t, dd)
			if _, e := NewPreparationWitness(ss, d.Release, witnessTestLimits); e == nil {
				t.Fatal("accepted mutation")
			}
		})
	}
	for _, suffix := range []string{" ", "{}"} {
		ss := snap
		ss.Input = append(append([]byte{}, snap.Input...), suffix...)
		ss.Identity.InputHash = service.Hash(ss.Input)
		if _, e := NewPreparationWitness(ss, d.Release, witnessTestLimits); e == nil {
			t.Fatal("noncanonical JSON")
		}
	}
	for _, replacement := range []string{
		strings.Replace(string(snap.Input), "{", `{"Unknown":1,`, 1),
		strings.Replace(string(snap.Input), "{", `{"Schema":"veydrift.finalized-public-input.v1",`, 1),
	} {
		ss := snap
		ss.Input = []byte(replacement)
		ss.Identity.InputHash = service.Hash(ss.Input)
		if _, e := NewPreparationWitness(ss, d.Release, witnessTestLimits); e == nil {
			t.Fatal("duplicate/unknown JSON")
		}
	}
	ss := snap
	ss.Anchor.Number++
	if _, e := NewPreparationWitness(ss, d.Release, witnessTestLimits); e == nil {
		t.Fatal("anchor")
	}
	ss = snap
	ss.Identity.BattleID = "1"
	if _, e := NewPreparationWitness(ss, d.Release, witnessTestLimits); e == nil {
		t.Fatal("identity")
	}
	ss = snap
	ss.Identity.InputHash = strings.Repeat("d", 64)
	if _, e := NewPreparationWitness(ss, d.Release, witnessTestLimits); e == nil {
		t.Fatal("hash")
	}
	limits := witnessTestLimits
	limits.MaxRows = 1
	if _, e := NewPreparationWitness(snap, d.Release, limits); e == nil {
		t.Fatal("row budget")
	}
	limits = witnessTestLimits
	limits.MaxJournalEntries = 1
	if _, e := NewPreparationWitness(snap, d.Release, limits); e == nil {
		t.Fatal("journal budget")
	}
	limits = witnessTestLimits
	limits.MaxInputBytes = len(snap.Input) - 1
	if _, e := NewPreparationWitness(snap, d.Release, limits); e == nil {
		t.Fatal("byte budget")
	}
}
func TestWitnessCheckpointAdversariesAndCancellation(t *testing.T) {
	snap, d := witnessTestDocument(t, 1, 2)
	w, e := NewPreparationWitness(snap, d.Release, witnessTestLimits)
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	before, _ := w.Checkpoint()
	if ss, e := w.Chunk(ctx, 2); e != context.Canceled || len(ss) != 0 {
		t.Fatal("cancel")
	}
	after, _ := w.Checkpoint()
	if before != after {
		t.Fatal("cancel advanced")
	}
	if _, e = w.Chunk(context.Background(), 0); e == nil {
		t.Fatal("zero budget")
	}
	if _, e = w.Chunk(context.Background(), 11); e == nil {
		t.Fatal("oversize budget")
	}
	if _, e = w.Chunk(context.Background(), 3); e != nil {
		t.Fatal(e)
	}
	cp, _ := w.Checkpoint()
	for _, mutate := range []func(*PreparationCheckpoint){func(c *PreparationCheckpoint) { c.Identity.BattleID = "2" }, func(c *PreparationCheckpoint) { c.Anchor.Number++ }, func(c *PreparationCheckpoint) { c.Release.Engine = witnessTestAddress(9) }, func(c *PreparationCheckpoint) { c.Context = "0" }, func(c *PreparationCheckpoint) { c.Steps = "99999999999999999999999999" }, func(c *PreparationCheckpoint) { c.Steps = "03" }} {
		bad := cp
		mutate(&bad)
		if _, e := RestorePreparationWitness(snap, d.Release, witnessTestLimits, bad); e == nil {
			t.Fatal("bad checkpoint admitted")
		}
	}
	bad := cp
	bad.State = "0"
	rw, e := RestorePreparationWitness(snap, d.Release, witnessTestLimits, bad)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = rw.Replay(context.Background(), 10); e == nil {
		t.Fatal("forged state")
	}
	if _, e = rw.Chunk(context.Background(), 1); e == nil {
		t.Fatal("poison bypass")
	}
	if _, e = rw.Checkpoint(); e == nil {
		t.Fatal("poison checkpoint")
	}
	// A uint32-max lane is admitted without expanding billions of units or using
	// a fixture ceiling. Only the explicitly requested boot/pair work is done.
	huge, hd := witnessTestDocument(t, 1, 1<<32-1)
	hw, e := NewPreparationWitness(huge, hd.Release, witnessTestLimits)
	if e != nil {
		t.Fatal(e)
	}
	if hw.PreparationSteps() != "4294967299" {
		t.Fatal(hw.PreparationSteps())
	}
	if ss, e := hw.Chunk(context.Background(), 2); e != nil || len(ss) != 2 {
		t.Fatal("huge bounded prefix")
	}
}

func TestWitnessRestartEveryPreparationPhase(t *testing.T) {
	snap, d := witnessTestDocument(t, 1, 3)
	for _, cursor := range []int{0, 1, 2, 3, 4, 5, 6, 7} {
		t.Run(fmt.Sprint(cursor), func(t *testing.T) {
			w, e := NewPreparationWitness(snap, d.Release, witnessTestLimits)
			if e != nil {
				t.Fatal(e)
			}
			if cursor > 0 {
				if _, e = w.Chunk(context.Background(), cursor); e != nil {
					t.Fatal(e)
				}
			}
			cp, e := w.Checkpoint()
			if e != nil {
				t.Fatal(e)
			}
			rw, e := RestorePreparationWitness(snap, d.Release, witnessTestLimits, cp)
			if e != nil {
				t.Fatal(e)
			}
			for {
				before := raw.Integer(rw.machine.State.Step)
				done, e := rw.Replay(context.Background(), 2)
				if e != nil {
					t.Fatal(e)
				}
				delta := new(big.Int).Sub(raw.Integer(rw.machine.State.Step), before)
				if delta.Cmp(big.NewInt(2)) > 0 {
					t.Fatal("unbounded replay")
				}
				if done {
					break
				}
			}
			got, e := rw.Checkpoint()
			if e != nil || got != cp {
				t.Fatal("phase checkpoint mismatch", e)
			}
			for !w.Done() {
				a, e := w.Chunk(context.Background(), 2)
				if e != nil {
					t.Fatal(e)
				}
				b, e := rw.Chunk(context.Background(), 2)
				if e != nil {
					t.Fatal(e)
				}
				if len(a) != len(b) {
					t.Fatal("suffix length")
				}
				for i := range a {
					if a[i].After.Commitment().Cmp(b[i].After.Commitment()) != 0 {
						t.Fatal("phase suffix")
					}
				}
			}
			linked, e := rw.QualificationWitness()
			if e != nil || witnessDigest(linked.ChainRecord) != d.ChainRecord {
				t.Fatal("resumed terminal", e)
			}
		})
	}
}
