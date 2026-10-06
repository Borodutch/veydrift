package runtime

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

// WitnessLimits are local admission/work budgets, not protocol limits. Nothing
// is truncated on exhaustion. Increase the budgets explicitly to retry.
type WitnessLimits struct {
	MaxInputBytes, MaxJournalEntries, MaxRows, MaxChunkSteps int
}

// PreparationWitness owns native preparation state. It produces advice, not
// proofs or a settlement. Input authority/finality must come from chainsource.
// Not safe for concurrent use. Returned steps must be treated as immutable.
type PreparationWitness struct {
	identity             service.Identity
	anchor               service.Anchor
	release              chainsource.Release
	limits               WitnessLimits
	machine              *prep.Machine
	meta                 raw.Metadata
	header               raw.Header
	events               []raw.Event
	snapshot, randomWord p.Uint256
	chainRecord          string
	totalSteps           *big.Int
	terminal             *prep.Step
	resume               *PreparationCheckpoint
	poisoned             bool
}

// PreparationCheckpoint stores no trusted mutable machine or Merkle state.
// Resume reconstructs it by bounded deterministic replay, checking commitments.
// It is NOT a proof receipt and cannot authorize skipping a proof prefix.
type PreparationCheckpoint struct {
	Schema                string
	Identity              service.Identity
	Anchor                service.Anchor
	Release               chainsource.Release
	Context, Steps, State string
}

func witnessHex(s string, n int, prefix bool) bool {
	if prefix {
		if !strings.HasPrefix(s, "0x") {
			return false
		}
		s = s[2:]
	}
	b, e := hex.DecodeString(s)
	return e == nil && len(b) == n && s == strings.ToLower(s)
}
func witnessWord(s string) p.Uint256 {
	b, _ := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	return p.MustValue(new(big.Int).SetBytes(b))
}
func witnessDigest(w p.Uint256) string { return hex.EncodeToString(raw.Encode(w)) }
func witnessEqual(a, b p.Uint256) bool { return raw.Integer(a).Cmp(raw.Integer(b)) == 0 }
func witnessDecimal(s string) (p.Uint256, error) {
	n, ok := new(big.Int).SetString(s, 10)
	if !ok || n.Sign() < 0 || n.BitLen() > 256 || n.String() != s {
		return p.Uint256{}, errors.New("noncanonical uint256")
	}
	return p.MustValue(n), nil
}
func witnessABI(s string, widths ...int) ([]p.Uint256, error) {
	if !witnessHex(s, len(widths)*32, true) {
		return nil, errors.New("noncanonical ABI hex/length")
	}
	b, _ := hex.DecodeString(s[2:])
	ws, e := raw.DecodeWords(b, len(widths))
	if e != nil {
		return nil, e
	}
	for i, w := range ws {
		if raw.Integer(w).BitLen() > widths[i] {
			return nil, fmt.Errorf("ABI width at word %d", i)
		}
	}
	return ws, nil
}
func witnessCanonicalJSON(b []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return e
	}
	encoded, e := json.Marshal(v)
	if e != nil {
		return e
	}
	if !bytes.Equal(b, encoded) {
		return errors.New("noncanonical JSON")
	}
	return nil
}

// NewPreparationWitness strictly reconstructs the canonical public document.
// approved is supplied out of band, never derived from the input itself.
// Initialization is O(document size + rows*tree depth); expansion and pair
// scans occur only in Chunk/Replay. No fleet-size fixture or step ceiling exists.
func NewPreparationWitness(s service.Snapshot, approved chainsource.Release, limits WitnessLimits) (*PreparationWitness, error) {
	if limits.MaxInputBytes < 1 || limits.MaxJournalEntries < 1 || limits.MaxRows < 1 || limits.MaxChunkSteps < 1 {
		return nil, errors.New("positive witness budgets required")
	}
	if e := s.Identity.Validate(); e != nil {
		return nil, e
	}
	if len(s.Input) == 0 || len(s.Input) > limits.MaxInputBytes || service.Hash(s.Input) != s.Identity.InputHash || !witnessHex(s.Anchor.Hash, 32, false) {
		return nil, errors.New("snapshot bytes/hash/anchor")
	}
	if approved.Version != q.LinkedVersion || approved.Rules != witnessDigest(q.RulesID()) || approved.Catalog != witnessDigest(q.CatalogID()) {
		return nil, errors.New("unsupported approved release")
	}
	for _, v := range []string{approved.Verifier, approved.Engine} {
		if !witnessHex(v, 20, true) || raw.Integer(witnessWord(v)).Sign() == 0 {
			return nil, errors.New("approved release address")
		}
	}
	for _, v := range []string{approved.VerifierCodehash, approved.VerifierManifest} {
		if !witnessHex(v, 32, false) || raw.Integer(witnessWord(v)).Sign() == 0 {
			return nil, errors.New("approved release digest")
		}
	}
	var d chainsource.Document
	if e := witnessCanonicalJSON(s.Input, &d); e != nil {
		return nil, e
	}
	if d.Schema != "veydrift.finalized-public-input.v1" || d.ChainID != s.Identity.ChainID || d.Game != s.Identity.Game || d.BattleID != s.Identity.BattleID || d.Release != approved || d.Anchor != s.Anchor || s.Identity.Rules != approved.Rules || s.Identity.Verifier != approved.VerifierManifest {
		return nil, errors.New("document identity/anchor/release binding")
	}
	if d.Journal == nil || len(d.Journal) > limits.MaxJournalEntries {
		return nil, errors.New("journal budget or null journal")
	}
	st, e := witnessABI(d.StatusABI, 32, 256, 256, 160, 256, 8, 256, 256, 256, 256)
	if e != nil {
		return nil, e
	}
	hw, e := witnessABI(d.HeaderABI, 256, 1, 64, 1, 64, 160, 1, 256, 256, 128, 128, 128, 128, 128, 128, 16)
	if e != nil {
		return nil, e
	}
	en, e := witnessABI(d.EngineABI, 160, 256, 256)
	if e != nil {
		return nil, e
	}
	rq, e := witnessABI(d.RequestABI, 160, 256, 256, 64, 64, 256)
	if e != nil {
		return nil, e
	}
	po, e := witnessABI(d.PolicyABI, 1, 256)
	if e != nil {
		return nil, e
	}
	expected := []p.Uint256{p.Const(uint64(approved.Version)), witnessWord(approved.Rules), witnessWord(approved.Catalog), witnessWord(approved.Verifier), witnessWord(approved.VerifierCodehash), p.Const(3)}
	for i, w := range expected {
		if !witnessEqual(w, st[i]) {
			return nil, errors.New("status release/phase mismatch")
		}
	}
	if raw.Integer(st[9]).Cmp(big.NewInt(int64(limits.MaxRows))) > 0 {
		return nil, errors.New("row budget")
	}
	if raw.Integer(hw[6]).Sign() != 0 || (raw.Integer(hw[1]).Sign() != 0 && !witnessEqual(hw[3], p.Const(1))) {
		return nil, errors.New("blocked/unrecorded body")
	}
	chain, _ := witnessDecimal(d.ChainID)
	battle, _ := witnessDecimal(d.BattleID)
	game := witnessWord(d.Game)
	if !witnessEqual(en[0], witnessWord(approved.Engine)) || raw.Integer(en[1]).Sign() == 0 || !witnessEqual(en[2], q.Purpose(chain, battle)) {
		return nil, errors.New("engine request/purpose")
	}
	id := prep.Identity{Chain: chain, Game: game, Battle: battle, Body: hw[0], Incarnation: hw[2], Impact: hw[4], Rules: st[1], Verifier: st[3], Catalog: st[2], SeedPolicy: p.Const(q.SeedPolicy), TargetIsMoon: raw.Integer(hw[1]).Uint64()}
	w := &PreparationWitness{identity: s.Identity, anchor: s.Anchor, release: approved, limits: limits, snapshot: st[6], randomWord: st[8], chainRecord: d.ChainRecord}
	copy(w.header[:], hw)
	w.meta = raw.Metadata{Preparation: prep.Context{Identity: id}, Version: st[0], Codehash: st[4], Engine: en[0], RequestID: en[1], Purpose: en[2]}
	journal := raw.Digest(raw.HeaderWords(w.meta, w.header)...)
	rows := []prep.Row{}
	seen := map[string]bool{}
	research := map[string]string{}
	source := p.Const(0)
	owner := hw[5]
	side := uint64(1)
	last := -1
	remaining := uint64(0)
	var counts [16]uint64
	units := new(big.Int)
	for i, entry := range d.Journal {
		index, err := witnessDecimal(entry.Index)
		if err != nil {
			return nil, fmt.Errorf("journal %d: %w", i, err)
		}
		switch entry.Kind {
		case "source":
			if raw.Integer(index).Sign() == 0 || seen[entry.Index] || remaining != 0 {
				return nil, errors.New("duplicate/zero source or missing rows")
			}
			ws, err := witnessABI(entry.ABI, 8, 8, 160, 256, 256, 64, 64, 64, 128, 128, 128, 128, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 256, 16, 16, 16, 1, 1)
			if err != nil {
				return nil, err
			}
			if raw.Integer(ws[0]).Uint64() > 5 || raw.Integer(ws[1]).Uint64() > 9 {
				return nil, errors.New("unsupported mission enum")
			}
			seen[entry.Index] = true
			source = index
			owner = ws[2]
			side = 1
			typ := raw.Integer(ws[1]).Uint64()
			if typ == 3 || typ == 8 {
				side = 0
			}
			last = -1
			counts = [16]uint64{}
			j := 12
			for t := 0; t < 16; t++ {
				if t != 9 && t != 15 {
					counts[t] = raw.Integer(ws[j]).Uint64()
					remaining += counts[t]
					j++
				}
			}
			var mission raw.Mission
			copy(mission[:], ws)
			w.events = append(w.events, raw.SourceEvent(source, mission))
			journal = raw.Digest(raw.SourceWords(journal, source, mission)...)
		case "row":
			if len(rows) >= limits.MaxRows || !witnessEqual(index, p.Const(uint64(len(rows)))) {
				return nil, errors.New("row index/budget")
			}
			ws, err := witnessABI(entry.ABI, 256, 160, 32, 8, 8, 16, 16, 16)
			if err != nil {
				return nil, err
			}
			count := raw.Integer(ws[2]).Uint64()
			typ := int(raw.Integer(ws[4]).Uint64())
			if !witnessEqual(ws[0], source) || !witnessEqual(ws[1], owner) || count == 0 || raw.Integer(ws[3]).Uint64() != side || typ > 23 || typ <= last {
				return nil, errors.New("row source/owner/count/side/type")
			}
			if raw.Integer(source).Sign() != 0 {
				if typ >= 16 || counts[typ] != count || remaining < count {
					return nil, errors.New("mission lane mismatch")
				}
				remaining -= count
			}
			key := raw.Integer(owner).String()
			tech := hex.EncodeToString(raw.Encode(ws[5:]...))
			if prev, ok := research[key]; ok && prev != tech {
				return nil, errors.New("inconsistent owner research")
			}
			research[key] = tech
			row := prep.Row{Source: source, Owner: owner, Count: ws[2], Side: side, Type: uint64(typ), Tech: p.Technology{Weapons: raw.Integer(ws[5]).Uint64(), Shielding: raw.Integer(ws[6]).Uint64(), Armor: raw.Integer(ws[7]).Uint64()}}
			rows = append(rows, row)
			w.events = append(w.events, raw.RowEvent(row))
			journal = raw.Digest(raw.RowWords(journal, index, row)...)
			units.Add(units, raw.Integer(ws[2]))
			last = typ
		default:
			return nil, errors.New("unknown journal kind")
		}
	}
	if remaining != 0 || !witnessEqual(st[9], p.Const(uint64(len(rows)))) {
		return nil, errors.New("incomplete journal")
	}
	journal = raw.Digest(journal, p.Const(3), st[9])
	if !witnessEqual(journal, st[6]) {
		return nil, errors.New("sealed snapshot mismatch")
	}
	commitment := raw.Digest(raw.Domain("veydrift.randomness-commitment.v1"), chain, en[0], st[8])
	rc := raw.Digest(raw.Domain("veydrift.battle-snapshot-purpose.v1"), chain, en[0], en[1], game, en[2], commitment, st[6])
	if !witnessEqual(rq[0], game) || !witnessEqual(rq[1], en[2]) || !witnessEqual(rq[2], commitment) || raw.Integer(rq[3]).Sign() == 0 || raw.Integer(rq[4]).Sign() == 0 || raw.Integer(rq[4]).Cmp(raw.Integer(rq[3])) < 0 || raw.Integer(st[8]).Sign() == 0 || !witnessEqual(rq[5], st[8]) || !witnessEqual(po[0], p.Const(1)) || !witnessEqual(po[1], st[6]) || !witnessEqual(st[7], rc) {
		return nil, errors.New("randomness authority mismatch")
	}
	record := raw.Digest(raw.Domain(q.ChainRecordDomain), chain, game, battle, st[0], st[1], st[2], st[3], st[4], en[0], en[1], en[2], st[6], st[7], st[8], st[9], st[5])
	if d.ChainRecord != witnessDigest(record) {
		return nil, errors.New("chain record mismatch")
	}
	w.machine, e = prep.New(id, rows, q.Bases())
	if e != nil {
		return nil, e
	}
	w.meta.Preparation = w.machine.C
	n := big.NewInt(int64(len(rows)))
	w.totalSteps = new(big.Int).Mul(n, n)
	w.totalSteps.Add(w.totalSteps, n)
	w.totalSteps.Add(w.totalSteps, units)
	w.totalSteps.Add(w.totalSteps, big.NewInt(2))
	return w, nil
}

// PreparationSteps is the exact dynamic work count (boot + pairs + members +
// units + finish), in decimal, without truncating fleet sizes to host integers.
func (w *PreparationWitness) PreparationSteps() string { return w.totalSteps.String() }
func (w *PreparationWitness) Done() bool {
	return !w.poisoned && w.resume == nil && raw.Integer(w.machine.State.Step).Cmp(w.totalSteps) == 0
}
func (w *PreparationWitness) Checkpoint() (PreparationCheckpoint, error) {
	if w.poisoned || w.resume != nil {
		return PreparationCheckpoint{}, errors.New("replay not verified")
	}
	return PreparationCheckpoint{Schema: "veydrift.preparation-replay.v1", Identity: w.identity, Anchor: w.anchor, Release: w.release, Context: w.machine.C.Commitment().String(), Steps: raw.Integer(w.machine.State.Step).String(), State: w.machine.State.Commitment().String()}, nil
}

// RestorePreparationWitness admits the same authority first, then schedules
// replay. Each Replay call performs at most budget elementary transitions.
func RestorePreparationWitness(s service.Snapshot, approved chainsource.Release, limits WitnessLimits, cp PreparationCheckpoint) (*PreparationWitness, error) {
	w, e := NewPreparationWitness(s, approved, limits)
	if e != nil {
		return nil, e
	}
	n, ok := new(big.Int).SetString(cp.Steps, 10)
	if cp.Schema != "veydrift.preparation-replay.v1" || cp.Identity != w.identity || cp.Anchor != w.anchor || cp.Release != approved || cp.Context != w.machine.C.Commitment().String() || !ok || n.Sign() < 0 || n.String() != cp.Steps || n.Cmp(w.totalSteps) > 0 {
		return nil, errors.New("checkpoint identity/context/cursor")
	}
	state, ok := new(big.Int).SetString(cp.State, 10)
	if !ok || state.Sign() < 0 || state.String() != cp.State || state.BitLen() > 254 {
		return nil, errors.New("checkpoint state")
	}
	w.resume = &cp
	return w, nil
}
func (w *PreparationWitness) witnessBudget(budget int) error {
	if w.poisoned {
		return errors.New("checkpoint replay mismatch")
	}
	if budget < 1 || budget > w.limits.MaxChunkSteps {
		return errors.New("chunk budget")
	}
	return nil
}

// Replay discards regenerated advice, but never trusts the checkpoint to skip
// native work. On mismatch the object is permanently unusable. No proof is made.
func (w *PreparationWitness) Replay(ctx context.Context, budget int) (bool, error) {
	if e := w.witnessBudget(budget); e != nil {
		return false, e
	}
	if w.resume == nil {
		return true, nil
	}
	target, _ := new(big.Int).SetString(w.resume.Steps, 10)
	for n := 0; n < budget && raw.Integer(w.machine.State.Step).Cmp(target) < 0; n++ {
		if e := ctx.Err(); e != nil {
			return false, e
		}
		step, e := w.machine.Next()
		if e != nil {
			return false, e
		}
		w.terminal = step
	}
	if raw.Integer(w.machine.State.Step).Cmp(target) != 0 {
		return false, nil
	}
	if w.machine.State.Commitment().String() != w.resume.State {
		w.poisoned = true
		return false, errors.New("checkpoint replay state mismatch")
	}
	w.resume = nil
	return true, nil
}

// Chunk returns genuine preparation.Step assignments and never runs more than
// budget transitions. On cancellation returned prefix remains valid advice;
// checkpoint that prefix before retrying if the caller retained it.
func (w *PreparationWitness) Chunk(ctx context.Context, budget int) ([]*prep.Step, error) {
	if e := w.witnessBudget(budget); e != nil {
		return nil, e
	}
	if w.resume != nil {
		return nil, errors.New("checkpoint replay required")
	}
	steps := []*prep.Step{}
	for len(steps) < budget && !w.Done() {
		if e := ctx.Err(); e != nil {
			return steps, e
		}
		s, e := w.machine.Next()
		if e != nil {
			return steps, e
		}
		w.terminal = s
		steps = append(steps, s)
	}
	return steps, nil
}

// RawWitnesses materializes the raw advice in one bounded-document operation.
// rawbridge only exposes Build, not a streaming constructor. It is intentionally
// separate from Chunk so that this cost is never disguised as one replay step.
func (w *PreparationWitness) RawWitnesses() ([]*raw.Step, error) {
	if w.poisoned || w.resume != nil {
		return nil, errors.New("replay not verified")
	}
	steps, e := raw.Build(w.meta, w.header, w.events)
	if e != nil {
		return nil, e
	}
	if !witnessEqual(steps[len(steps)-1].After.Journal, w.snapshot) {
		return nil, errors.New("raw terminal snapshot")
	}
	return steps, nil
}

// QualificationWitness binds the real preparation and raw terminal advice to
// the document's chain record. Caller still needs every elementary proof.
func (w *PreparationWitness) QualificationWitness() (*q.LinkedCircuit, error) {
	if !w.Done() || w.terminal == nil {
		return nil, errors.New("preparation not terminal")
	}
	rs, e := w.RawWitnesses()
	if e != nil {
		return nil, e
	}
	c, e := q.NewLinked(w.meta, rs[len(rs)-1].Statement(), w.snapshot, w.machine.State, w.terminal.Statement(), w.randomWord)
	if e != nil {
		return nil, e
	}
	if witnessDigest(c.ChainRecord) != w.chainRecord {
		return nil, errors.New("qualification chain record")
	}
	return c, nil
}
