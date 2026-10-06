package chainsource

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"

	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

var signatures = []string{
	"ProofBattleLaunched(uint256,uint32,address,bytes32,bytes32,address,uint256)",
	"ProofBattleHeader(uint256,bytes)",
	"ProofBattleSource(uint256,uint256,bytes)",
	"ProofBattleRow(uint256,uint256,(uint256,address,uint32,uint8,uint8,uint16,uint16,uint16))",
	"ProofBattleSealed(uint256,bytes32,uint256)",
	"ProofBattleAwaitingProof(uint256,bytes32,bytes32,uint256)",
	"ProofBattleBypassed(uint256)",
}

func topics() []string {
	a := make([]string, len(signatures))
	for i, v := range signatures {
		a[i] = hx(keccak([]byte(v)))
	}
	return a
}

type chainLog struct {
	Address                                                                   string
	Topics                                                                    []string
	Data, BlockNumber, BlockHash, TransactionHash, TransactionIndex, LogIndex string
	Removed                                                                   bool
}

func logKind(l chainLog) int {
	for i, t := range topics() {
		if l.Topics[0] == t {
			return i
		}
	}
	return -1
}
func (s *Source) logs(ctx context.Context, h service.Anchor, battle string) ([]chainLog, error) {
	if h.Number < s.cfg.DeploymentBlock {
		return nil, ErrIncomplete
	}
	var all []chainLog
	seen := map[string]chainLog{}
	blocks := map[uint64]string{}
	pages := 0
	for lo := s.cfg.DeploymentBlock; ; {
		pages++
		if pages > s.cfg.MaxPages {
			return nil, ErrIncomplete
		}
		hi := h.Number
		if h.Number-lo >= s.cfg.BlockPage {
			hi = lo + s.cfg.BlockPage - 1
		}
		ts := []any{topics()}
		if battle != "" {
			n, _ := decimal(battle)
			ts = append(ts, hx(rb.Encode(word(n))))
		}
		var page []chainLog
		if e := s.rpc(ctx, "eth_getLogs", []any{map[string]any{"address": s.cfg.Game, "fromBlock": tag(lo), "toBlock": tag(hi), "topics": ts}}, &page); e != nil {
			return nil, e
		}
		// A null/partial non-array result is not an empty successful page.
		if page == nil {
			return nil, errors.New("null log page")
		}
		if len(page) > s.cfg.MaxLogs-len(all) {
			return nil, ErrIncomplete
		}
		for _, l := range page {
			n, e := quantity(l.BlockNumber)
			if e != nil || !n.IsUint64() {
				return nil, errors.New("invalid log block")
			}
			bn := n.Uint64()
			if l.Address != s.cfg.Game || l.Removed || bn < lo || bn > hi || len(l.Topics) < 2 || !strings.HasPrefix(l.BlockHash, "0x") || !hash(strings.TrimPrefix(l.BlockHash, "0x")) || !strings.HasPrefix(l.TransactionHash, "0x") || !hash(strings.TrimPrefix(l.TransactionHash, "0x")) {
				return nil, errors.New("invalid log envelope")
			}
			kind := logKind(l)
			want := 2
			if kind == 2 || kind == 3 {
				want = 3
			}
			if kind < 0 || len(l.Topics) != want {
				return nil, errors.New("unsupported log topics")
			}
			for _, t := range l.Topics {
				b, e := hexbytes(t)
				if e != nil || len(b) != 32 {
					return nil, errors.New("invalid indexed word")
				}
			}
			if zero(fromHex(l.Topics[1])) {
				return nil, errors.New("zero battle")
			}
			if battle != "" && rb.Integer(fromHex(l.Topics[1])).String() != battle {
				return nil, errors.New("wrong battle log")
			}
			for _, v := range []string{l.TransactionIndex, l.LogIndex} {
				n, e := quantity(v)
				if e != nil || !n.IsUint64() {
					return nil, errors.New("invalid log position")
				}
			}
			if old, ok := blocks[bn]; ok {
				if old != l.BlockHash {
					return nil, errors.New("mixed block hashes")
				}
			} else {
				a, e := s.block(ctx, tag(bn))
				if e != nil {
					return nil, e
				}
				if "0x"+a.Hash != l.BlockHash {
					return nil, errors.New("orphan log")
				}
				blocks[bn] = l.BlockHash
			}
			key := l.BlockNumber + ":" + l.LogIndex
			if old, ok := seen[key]; ok {
				a, _ := json.Marshal(old)
				b, _ := json.Marshal(l)
				if !bytes.Equal(a, b) {
					return nil, errors.New("conflicting duplicate log")
				}
				continue
			}
			seen[key] = l
			all = append(all, l)
		}
		if hi == h.Number {
			break
		}
		lo = hi + 1
	}
	sort.Slice(all, func(i, j int) bool {
		a, _ := quantity(all[i].BlockNumber)
		b, _ := quantity(all[j].BlockNumber)
		if c := a.Cmp(b); c != 0 {
			return c < 0
		}
		a, _ = quantity(all[i].LogIndex)
		b, _ = quantity(all[j].LogIndex)
		return a.Cmp(b) < 0
	})
	return all, nil
}
func widths(ws []rb.U, bits ...int) error {
	if len(ws) != len(bits) {
		return errors.New("unsupported static ABI")
	}
	for i, w := range ws {
		if rb.Integer(w).BitLen() > bits[i] {
			return fmt.Errorf("noncanonical ABI word %d", i)
		}
	}
	return nil
}
func static(b []byte, bits ...int) ([]rb.U, error) {
	ws, e := rb.DecodeWords(b, len(bits))
	if e != nil {
		return nil, e
	}
	return ws, widths(ws, bits...)
}

var statusWidths = []int{32, 256, 256, 160, 256, 8, 256, 256, 256, 256}

func (s *Source) status(ctx context.Context, h service.Anchor, id rb.U) ([]rb.U, error) {
	b, e := s.record(ctx, h, id, 0, p.Const(0))
	if e != nil {
		return nil, e
	}
	v, e := static(b, statusWidths...)
	if e == nil && rb.Integer(v[5]).Uint64() > 4 {
		e = errors.New("unsupported phase")
	}
	return v, e
}
func eq(a, b rb.U) bool         { return rb.Integer(a).Cmp(rb.Integer(b)) == 0 }
func zero(a rb.U) bool          { return rb.Integer(a).Sign() == 0 }
func dec(a rb.U) string         { return rb.Integer(a).String() }
func addressWord(a rb.U) string { return "0x" + digest(a)[24:] }

// Document is canonical public JSON. All ABI uint256 values are decimal strings;
// ABI byte records are lowercase 0x hex. No observation head enters its identity.
// Journal order is significant. Anchor is the original seal event, never a later
// AwaitingProof hint. Public engine data and all16 header words are retained.
type Document struct {
	Schema                                                 string
	ChainID, Game, BattleID                                string
	Release                                                Release
	Anchor                                                 service.Anchor
	StatusABI, HeaderABI, EngineABI, RequestABI, PolicyABI string
	Journal                                                []JournalEntry
	ChainRecord                                            string
}
type JournalEntry struct {
	Kind  string
	Index string
	ABI   string
}

func (s *Source) load(ctx context.Context, h service.Anchor, id rb.U, logs []chainLog) (service.Snapshot, error) {
	fail := func(e error) (service.Snapshot, error) { return service.Snapshot{}, e }
	st, e := s.status(ctx, h, id)
	if e != nil {
		return fail(e)
	}
	if !eq(st[5], p.Const(3)) {
		return fail(errors.New("battle not AwaitingProof"))
	}
	r := s.cfg.Release
	if !eq(st[0], p.Const(uint64(r.Version))) || digest(st[1]) != r.Rules || digest(st[2]) != r.Catalog || addressWord(st[3]) != r.Verifier || digest(st[4]) != r.VerifierCodehash {
		return fail(errors.New("unapproved frozen release"))
	}
	code, e := s.code(ctx, h, r.Verifier)
	if e != nil {
		return fail(e)
	}
	if hx(keccak(code)) != "0x"+r.VerifierCodehash {
		return fail(errors.New("verifier codehash mismatch"))
	}
	count := rb.Integer(st[9])
	if !count.IsUint64() || count.Cmp(big.NewInt(int64(s.cfg.MaxRows))) > 0 {
		return fail(ErrIncomplete)
	}
	headBytes, e := s.record(ctx, h, id, 1, p.Const(0))
	if e != nil {
		return fail(e)
	}
	hw, e := static(headBytes, 256, 1, 64, 1, 64, 160, 1, 256, 256, 128, 128, 128, 128, 128, 128, 16)
	if e != nil {
		return fail(e)
	}
	if !zero(hw[6]) || (!zero(hw[1]) && !eq(hw[3], p.Const(1))) {
		return fail(errors.New("blocked or unrecorded body snapshot"))
	}
	engineBytes, e := s.record(ctx, h, id, 5, p.Const(0))
	if e != nil {
		return fail(e)
	}
	en, e := static(engineBytes, 160, 256, 256)
	if e != nil {
		return fail(e)
	}
	chain, _ := decimal(s.cfg.ChainID)
	chainWord := word(chain)
	game := fromHex(s.cfg.Game)
	if addressWord(en[0]) != r.Engine || zero(en[1]) || !eq(en[2], rb.Digest(rb.Domain(q.PurposeDomain), chainWord, id)) {
		return fail(errors.New("invalid engine/request/purpose"))
	}
	if _, e = s.code(ctx, h, r.Engine); e != nil {
		return fail(e)
	}
	var header rb.Header
	copy(header[:], hw)
	meta := rb.Metadata{Version: st[0], Codehash: st[4], Engine: en[0], RequestID: en[1], Purpose: en[2], Preparation: prep.Context{Identity: prep.Identity{Chain: chainWord, Game: game, Battle: id, Rules: st[1], Catalog: st[2], Verifier: st[3]}}}
	journal := rb.Digest(rb.HeaderWords(meta, header)...)
	d := Document{Schema: "veydrift.finalized-public-input.v1", ChainID: s.cfg.ChainID, Game: s.cfg.Game, BattleID: dec(id), Release: r, StatusABI: hx(rb.Encode(st...)), HeaderABI: hx(headBytes), EngineABI: hx(engineBytes), Journal: []JournalEntry{}}
	started, sealed, launched := false, false, false
	rows := uint64(0)
	sources := map[string]bool{}
	tech := map[string]string{}
	source := p.Const(0)
	owner := hw[5]
	side := uint64(1)
	last := -1
	remaining := uint64(0)
	counts := [16]uint64{}
	for _, l := range logs {
		if !eq(fromHex(l.Topics[1]), id) {
			continue
		}
		b, e := hexbytes(l.Data)
		if e != nil {
			return fail(e)
		}
		switch logKind(l) {
		case 0:
			if launched || started {
				return fail(errors.New("duplicate or late launch"))
			}
			v, e := static(b, 32, 160, 256, 256, 160, 256)
			if e != nil {
				return fail(e)
			}
			expected := []rb.U{st[0], st[3], st[1], st[2], en[0], en[1]}
			if !bytes.Equal(rb.Encode(v...), rb.Encode(expected...)) {
				return fail(errors.New("launch differs from storage"))
			}
			launched = true
		case 1:
			v, e := dynamic(b)
			if e != nil || !bytes.Equal(v, headBytes) || started || !launched || sealed {
				return fail(errors.New("invalid header event"))
			}
			started = true
		case 2:
			if !started || sealed || remaining != 0 {
				return fail(errors.New("source outside complete journal"))
			}
			source = fromHex(l.Topics[2])
			if zero(source) || sources[dec(source)] {
				return fail(errors.New("duplicate source"))
			}
			sources[dec(source)] = true
			v, e := dynamic(b)
			if e != nil {
				return fail(e)
			}
			stored, e := s.record(ctx, h, id, 3, source)
			if e != nil {
				return fail(e)
			}
			if !bytes.Equal(v, stored) {
				return fail(errors.New("source event/storage mismatch"))
			}
			ws, e := static(v, 8, 8, 160, 256, 256, 64, 64, 64, 128, 128, 128, 128, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 256, 16, 16, 16, 1, 1)
			if e != nil {
				return fail(e)
			}
			if rb.Integer(ws[0]).Uint64() > 5 || rb.Integer(ws[1]).Uint64() > 9 {
				return fail(errors.New("unsupported mission enum"))
			}
			var mission rb.Mission
			copy(mission[:], ws)
			journal = rb.Digest(rb.SourceWords(journal, source, mission)...)
			owner = ws[2]
			side = 1
			typ := rb.Integer(ws[1]).Uint64()
			if typ == 3 || typ == 8 {
				side = 0
			}
			last = -1
			counts = [16]uint64{}
			j := 12
			for t := 0; t < 16; t++ {
				if t != 9 && t != 15 {
					counts[t] = rb.Integer(ws[j]).Uint64()
					remaining += counts[t]
					j++
				}
			}
			d.Journal = append(d.Journal, JournalEntry{"source", dec(source), hx(v)})
		case 3:
			if !started || sealed || rows >= count.Uint64() || !eq(fromHex(l.Topics[2]), p.Const(rows)) {
				return fail(errors.New("missing/duplicate/out-of-order row"))
			}
			v, e := static(b, 256, 160, 32, 8, 8, 16, 16, 16)
			if e != nil {
				return fail(e)
			}
			stored, e := s.record(ctx, h, id, 2, p.Const(rows))
			if e != nil {
				return fail(e)
			}
			if !bytes.Equal(b, stored) {
				return fail(errors.New("row event/storage mismatch"))
			}
			n := rb.Integer(v[2]).Uint64()
			t := int(rb.Integer(v[4]).Uint64())
			if !eq(v[0], source) || !eq(v[1], owner) || n == 0 || rb.Integer(v[3]).Uint64() != side || t > 23 || t <= last {
				return fail(errors.New("invalid source row semantics"))
			}
			if !zero(source) {
				if t >= 16 || counts[t] != n || remaining < n {
					return fail(errors.New("incomplete mission lanes"))
				}
				remaining -= n
			}
			key := dec(owner)
			research := hx(rb.Encode(v[5:]...))
			if old, ok := tech[key]; ok && old != research {
				return fail(errors.New("conflicting owner research"))
			}
			tech[key] = research
			row := prep.Row{Source: v[0], Owner: v[1], Count: v[2], Side: side, Type: uint64(t), Tech: p.Technology{Weapons: rb.Integer(v[5]).Uint64(), Shielding: rb.Integer(v[6]).Uint64(), Armor: rb.Integer(v[7]).Uint64()}}
			journal = rb.Digest(rb.RowWords(journal, p.Const(rows), row)...)
			last = t
			d.Journal = append(d.Journal, JournalEntry{"row", fmt.Sprint(rows), hx(b)})
			rows++
		case 4:
			v, e := static(b, 256, 256)
			if e != nil {
				return fail(e)
			}
			if !started || sealed || remaining != 0 || rows != count.Uint64() || !eq(v[1], st[9]) {
				return fail(errors.New("incomplete or duplicate seal"))
			}
			journal = rb.Digest(journal, p.Const(3), st[9])
			if !eq(journal, st[6]) || !eq(v[0], st[6]) {
				return fail(errors.New("journal snapshot mismatch"))
			}
			n, _ := quantity(l.BlockNumber)
			d.Anchor = service.Anchor{Number: n.Uint64(), Hash: l.BlockHash[2:]}
			sealed = true
		case 5:
			v, e := static(b, 256, 256, 256)
			if e != nil {
				return fail(e)
			}
			if !sealed || !eq(v[0], st[6]) || !eq(v[1], st[7]) || !eq(v[2], st[8]) {
				return fail(errors.New("invalid randomness hint"))
			}
		case 6:
			return fail(errors.New("bypassed journal claimed pending"))
		}
	}
	if !sealed {
		return fail(errors.New("missing public seal/journal"))
	}
	req, e := s.call(ctx, h, r.Engine, "request(uint256)", en[1])
	if e != nil {
		return fail(e)
	}
	rq, e := static(req, 160, 256, 256, 64, 64, 256)
	if e != nil {
		return fail(e)
	}
	policy, e := s.call(ctx, h, r.Engine, "battleRequestPolicy(uint256)", en[1])
	if e != nil {
		return fail(e)
	}
	po, e := static(policy, 1, 256)
	if e != nil {
		return fail(e)
	}
	randomContext, e := s.call(ctx, h, r.Engine, "battlePurposeContext(uint256)", en[1])
	if e != nil {
		return fail(e)
	}
	rc, e := static(randomContext, 256)
	if e != nil {
		return fail(e)
	}
	commitment := rb.Digest(rb.Domain("veydrift.randomness-commitment.v1"), chainWord, en[0], st[8])
	contextHash := rb.Digest(rb.Domain("veydrift.battle-snapshot-purpose.v1"), chainWord, en[0], en[1], game, en[2], commitment, st[6])
	if !eq(rq[0], game) || !eq(rq[1], en[2]) || !eq(rq[2], commitment) || zero(rq[3]) || zero(rq[4]) || rb.Integer(rq[4]).Cmp(rb.Integer(rq[3])) < 0 || zero(st[8]) || !eq(rq[5], st[8]) || !eq(po[0], p.Const(1)) || !eq(po[1], st[6]) || !eq(rc[0], contextHash) || !eq(st[7], contextHash) {
		return fail(errors.New("engine randomness authority mismatch"))
	}
	d.RequestABI = hx(req)
	d.PolicyABI = hx(policy)
	record := rb.Digest(rb.Domain(q.ChainRecordDomain), chainWord, game, id, st[0], st[1], st[2], st[3], st[4], en[0], en[1], en[2], st[6], st[7], st[8], st[9], st[5])
	d.ChainRecord = digest(record)
	input, e := json.Marshal(d)
	if e != nil {
		return fail(e)
	}
	if len(input) > s.cfg.MaxInputBytes {
		return fail(ErrIncomplete)
	}
	identity := service.Identity{ChainID: d.ChainID, Game: d.Game, BattleID: d.BattleID, InputHash: service.Hash(input), Rules: r.Rules, Verifier: r.VerifierManifest}
	if e = identity.Validate(); e != nil {
		return fail(e)
	}
	return service.Snapshot{Identity: identity, Anchor: d.Anchor, Input: input}, nil
}
