package chainsource

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

type fixture struct {
	cfg                              Config
	id                               rb.U
	header                           rb.Header
	mission                          rb.Mission
	rows                             [][]rb.U
	status, engine, request, policy  []rb.U
	logs                             []chainLog
	head                             uint64
	next                             rb.U
	badID, dropLogs, nullLogs, reorg bool
	failFleet                        string
	reads                            int
	pages                            int
	changeAfter                      int
}

func dyn(b []byte) []byte { return append(rb.Encode(p.Const(32), p.Const(uint64(len(b)))), b...) }
func zeros(n int) []rb.U {
	a := make([]rb.U, n)
	for i := range a {
		a[i] = p.Const(0)
	}
	return a
}
func blockHash(n uint64) string { return fmt.Sprintf("%064x", n+100) }
func newFixture() *fixture {
	f := &fixture{head: 8, next: p.Const(5), id: p.Const(2)}
	f.cfg = Config{ChainID: "8453", Game: addressWord(p.Const(123)), DeploymentBlock: 1, Release: Release{Version: 3, Rules: digest(q.RulesID()), Catalog: digest(q.CatalogID()), Verifier: addressWord(p.Const(456)), Engine: addressWord(p.Const(88)), VerifierCodehash: fmt.Sprintf("%x", keccak([]byte{0x60, 0})), VerifierManifest: strings.Repeat("a", 64)}, BlockPage: 2, FleetPage: 2, MaxPages: 20, MaxFleetReads: 30, MaxLogs: 100, MaxRows: 30, MaxInputBytes: 100000, MaxResponseBytes: 100000}
	copy(f.header[:], zeros(16))
	f.header[0] = word(new(big.Int).Lsh(big.NewInt(1), 200))
	f.header[1] = p.Const(1)
	f.header[2] = p.Const(3)
	f.header[3] = p.Const(1)
	f.header[4] = p.Const(100)
	f.header[5] = p.Const(7)
	f.header[9] = word(new(big.Int).Lsh(big.NewInt(1), 100))
	f.header[15] = p.Const(5000)
	copy(f.mission[:], zeros(32))
	f.mission[0] = p.Const(1)
	f.mission[1] = p.Const(3)
	f.mission[2] = p.Const(8)
	f.mission[4] = f.header[0]
	f.mission[6] = f.header[4]
	f.mission[12] = p.Const(3)
	f.mission[13] = p.Const(4)
	f.rows = [][]rb.U{{p.Const(0), p.Const(7), p.Const(2), p.Const(1), p.Const(0), p.Const(2), p.Const(3), p.Const(4)}, {f.id, p.Const(8), p.Const(3), p.Const(0), p.Const(0), p.Const(6), p.Const(7), p.Const(8)}, {f.id, p.Const(8), p.Const(4), p.Const(0), p.Const(1), p.Const(6), p.Const(7), p.Const(8)}}
	f.rebuild()
	return f
}
func (f *fixture) rebuild() {
	r := f.cfg.Release
	chain, _ := decimal(f.cfg.ChainID)
	c := word(chain)
	game := fromHex(f.cfg.Game)
	f.engine = []rb.U{fromHex(r.Engine), word(new(big.Int).Lsh(big.NewInt(1), 210)), rb.Digest(rb.Domain(q.PurposeDomain), c, f.id)}
	f.mission[26] = f.engine[1]
	meta := rb.Metadata{Version: p.Const(3), Codehash: fromHex(r.VerifierCodehash), Engine: f.engine[0], RequestID: f.engine[1], Purpose: f.engine[2], Preparation: prep.Context{Identity: prep.Identity{Chain: c, Game: game, Battle: f.id, Rules: fromHex(r.Rules), Catalog: fromHex(r.Catalog), Verifier: fromHex(r.Verifier)}}}
	journal := rb.Digest(rb.HeaderWords(meta, f.header)...)
	f.logs = nil
	add := func(kind int, b []byte, index *rb.U, block uint64) {
		l := chainLog{Address: f.cfg.Game, Topics: []string{topics()[kind], hx(rb.Encode(f.id))}, Data: hx(b), BlockNumber: tag(block), BlockHash: "0x" + blockHash(block), TransactionHash: "0x" + blockHash(99), TransactionIndex: "0x0", LogIndex: tag(uint64(len(f.logs)))}
		if index != nil {
			l.Topics = append(l.Topics, hx(rb.Encode(*index)))
		}
		f.logs = append(f.logs, l)
	}
	add(0, rb.Encode(p.Const(3), fromHex(r.Verifier), fromHex(r.Rules), fromHex(r.Catalog), f.engine[0], f.engine[1]), nil, 2)
	add(1, dyn(rb.Encode(f.header[:]...)), nil, 3)
	for i, row := range f.rows {
		if i == 1 {
			journal = rb.Digest(rb.SourceWords(journal, f.id, f.mission)...)
			add(2, dyn(rb.Encode(f.mission[:]...)), &f.id, 4)
		}
		rr := prep.Row{Source: row[0], Owner: row[1], Count: row[2], Side: rb.Integer(row[3]).Uint64(), Type: rb.Integer(row[4]).Uint64(), Tech: p.Technology{Weapons: rb.Integer(row[5]).Uint64(), Shielding: rb.Integer(row[6]).Uint64(), Armor: rb.Integer(row[7]).Uint64()}}
		journal = rb.Digest(rb.RowWords(journal, p.Const(uint64(i)), rr)...)
		idx := p.Const(uint64(i))
		block := uint64(4)
		if i == 0 {
			block = 3
		}
		add(3, rb.Encode(row...), &idx, block)
	}
	journal = rb.Digest(journal, p.Const(3), p.Const(uint64(len(f.rows))))
	seed := word(new(big.Int).Add(new(big.Int).Lsh(big.NewInt(1), 255), big.NewInt(19)))
	commitment := rb.Digest(rb.Domain("veydrift.randomness-commitment.v1"), c, f.engine[0], seed)
	rc := rb.Digest(rb.Domain("veydrift.battle-snapshot-purpose.v1"), c, f.engine[0], f.engine[1], game, f.engine[2], commitment, journal)
	f.status = []rb.U{p.Const(3), fromHex(r.Rules), fromHex(r.Catalog), fromHex(r.Verifier), fromHex(r.VerifierCodehash), p.Const(3), journal, rc, seed, p.Const(uint64(len(f.rows)))}
	f.request = []rb.U{game, f.engine[2], commitment, p.Const(10), p.Const(20), seed}
	f.policy = []rb.U{p.Const(1), journal}
	add(4, rb.Encode(journal, f.status[9]), nil, 5)
	add(5, rb.Encode(journal, rc, seed), nil, 7)
}
func (f *fixture) serve(t *testing.T, w http.ResponseWriter, r *http.Request) {
	t.Helper()
	var in struct {
		ID     uint64
		Method string
		Params []json.RawMessage
	}
	if e := json.NewDecoder(r.Body).Decode(&in); e != nil {
		t.Error(e)
		return
	}
	var result any
	var rpcErr any
	switch in.Method {
	case "eth_chainId":
		n, _ := decimal(f.cfg.ChainID)
		result = "0x" + n.Text(16)
	case "eth_getBlockByNumber":
		var s string
		json.Unmarshal(in.Params[0], &s)
		n := f.head
		if s != "finalized" {
			v, _ := quantity(s)
			n = v.Uint64()
		}
		hash := blockHash(n)
		if f.reorg && n == f.head {
			hash = blockHash(999)
		}
		result = map[string]string{"number": tag(n), "hash": "0x" + hash}
	case "eth_getLogs":
		f.pages++
		var filter struct {
			FromBlock, ToBlock string
			Topics             []json.RawMessage
		}
		json.Unmarshal(in.Params[0], &filter)
		lo, _ := quantity(filter.FromBlock)
		hi, _ := quantity(filter.ToBlock)
		ls := []chainLog{}
		if !f.dropLogs {
			for _, l := range f.logs {
				n, _ := quantity(l.BlockNumber)
				if n.Cmp(lo) >= 0 && n.Cmp(hi) <= 0 {
					ls = append(ls, l)
				}
			}
		}
		if f.nullLogs {
			result = nil
		} else {
			result = ls
		}
	case "eth_getCode":
		f.assertPin(t, in.Params[1])
		result = "0x6000"
	case "eth_call":
		f.assertPin(t, in.Params[1])
		var call struct{ To, Data string }
		json.Unmarshal(in.Params[0], &call)
		data, _ := hexbytes(call.Data)
		sel := hx(data[:4])
		args, _ := rb.DecodeWords(data[4:], len(data[4:])/32)
		switch sel {
		case hx(selector("nextFleetId()")):
			result = hx(rb.Encode(f.next))
		case hx(selector("proofBattleRecord(uint256,uint8,uint256)")):
			kind := rb.Integer(args[1]).Uint64()
			idx := rb.Integer(args[2]).Uint64()
			var b []byte
			if kind == 0 {
				f.reads++
				if f.changeAfter > 0 && f.reads >= f.changeAfter {
					f.reorg = true
				}
				if dec(args[0]) == f.failFleet {
					rpcErr = map[string]any{"code": -32000, "message": "fixture unavailable"}
					break
				}
				if eq(args[0], f.id) {
					b = rb.Encode(f.status...)
				} else {
					b = rb.Encode(zeros(10)...)
				}
			} else {
				switch kind {
				case 1:
					b = rb.Encode(f.header[:]...)
				case 2:
					if idx < uint64(len(f.rows)) {
						b = rb.Encode(f.rows[idx]...)
					}
				case 3:
					b = rb.Encode(f.mission[:]...)
				case 5:
					b = rb.Encode(f.engine...)
				}
			}
			result = hx(dyn(b))
		case hx(selector("request(uint256)")):
			result = hx(rb.Encode(f.request...))
		case hx(selector("battleRequestPolicy(uint256)")):
			result = hx(rb.Encode(f.policy...))
		case hx(selector("battlePurposeContext(uint256)")):
			result = hx(rb.Encode(f.status[7]))
		default:
			t.Errorf("unexpected call %s", sel)
		}
	default:
		t.Errorf("unexpected RPC %s", in.Method)
	}
	id := in.ID
	if f.badID {
		id++
	}
	out := map[string]any{"jsonrpc": "2.0", "id": id, "result": result}
	if rpcErr != nil {
		delete(out, "result")
		out["error"] = rpcErr
	}
	json.NewEncoder(w).Encode(out)
}
func (f *fixture) assertPin(t *testing.T, b json.RawMessage) {
	var pin struct {
		BlockHash        string
		RequireCanonical bool
	}
	if e := json.Unmarshal(b, &pin); e != nil || !pin.RequireCanonical || pin.BlockHash != "0x"+blockHash(f.head) {
		t.Errorf("unpinned request %s", b)
	}
}
func setup(t *testing.T, f *fixture) *Source {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { f.serve(t, w, r) }))
	t.Cleanup(srv.Close)
	f.cfg.URL = srv.URL
	s, e := New(f.cfg, srv.Client())
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func TestCompleteReadOnlySource(t *testing.T) {
	f := newFixture()
	s := setup(t, f)
	ctx := context.Background()
	h, e := s.Finalized(ctx)
	if e != nil {
		t.Fatal(e)
	}
	ids, e := s.Pending(ctx, h, 4)
	if e != nil || len(ids) != 1 {
		t.Fatalf("pending %v %v", ids, e)
	}
	if f.pages != 4 || f.reads < 4 {
		t.Fatal("incomplete pagination")
	}
	snap, e := s.Snapshot(ctx, ids[0], h)
	if e != nil {
		t.Fatal(e)
	}
	if snap.Anchor.Number != 5 || snap.Anchor.Hash != blockHash(5) || service.Hash(snap.Input) != snap.Identity.InputHash {
		t.Fatal("wrong original anchor or input hash")
	}
	var doc Document
	if e = json.Unmarshal(snap.Input, &doc); e != nil {
		t.Fatal(e)
	}
	if len(doc.Journal) != 4 || doc.HeaderABI != hx(rb.Encode(f.header[:]...)) || !hash(doc.ChainRecord) {
		t.Fatal("incomplete body/research/public record")
	}
	ok, e := s.Canonical(ctx, snap.Anchor, h)
	if e != nil || !ok {
		t.Fatal(e)
	}
	// Replay identical RPC events and advance observation head: same original bytes.
	f.logs = append(f.logs, f.logs[2])
	f.head = 9
	h, e = s.Finalized(ctx)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.Snapshot(ctx, ids[0], h)
	if e != nil || string(again.Input) != string(snap.Input) || again.Anchor != snap.Anchor {
		t.Fatalf("unstable identity %v", e)
	}
}
func TestMaliciousAndIncompleteRPC(t *testing.T) {
	cases := map[string]func(*fixture){
		"wrong response id":     func(f *fixture) { f.badID = true },
		"missing all events":    func(f *fixture) { f.dropLogs = true },
		"null page":             func(f *fixture) { f.nullLogs = true },
		"partial row journal":   func(f *fixture) { f.logs = append(f.logs[:3], f.logs[4:]...) },
		"altered snapshot":      func(f *fixture) { f.status[6] = p.Const(77) },
		"altered source getter": func(f *fixture) { f.mission[12] = p.Const(90) },
		"altered body getter":   func(f *fixture) { f.header[0] = p.Const(99) },
		"wrong verifier code": func(f *fixture) {
			f.cfg.Release.VerifierCodehash = strings.Repeat("b", 64)
			f.status[4] = fromHex(f.cfg.Release.VerifierCodehash)
		},
		"conflicting owner research": func(f *fixture) { f.rows[2][5] = p.Const(99); f.rebuild() },
		"missing mission lane":       func(f *fixture) { f.mission[14] = p.Const(1); f.rebuild() },
		"noncanonical row width":     func(f *fixture) { f.rows[0][5] = p.Const(65536); f.rebuild() },
		"unrecorded moon":            func(f *fixture) { f.header[3] = p.Const(0); f.rebuild() },
		"altered engine seed":        func(f *fixture) { f.request[5] = p.Const(77) },
		"legacy engine policy":       func(f *fixture) { f.policy[0] = p.Const(0) },
		"wrong requester":            func(f *fixture) { f.request[0] = p.Const(89) },
		"unsupported header":         func(f *fixture) { f.logs[1].Data = hx(dyn(rb.Encode(f.header[:15]...))) },
		"reorg during read":          func(f *fixture) { f.changeAfter = 2 },
		"wrong log blockhash":        func(f *fixture) { f.logs[1].BlockHash = "0x" + blockHash(99) },
		"superseded seal": func(f *fixture) {
			l := f.logs[len(f.logs)-2]
			l.BlockNumber = tag(6)
			l.BlockHash = "0x" + blockHash(6)
			l.LogIndex = tag(30)
			f.logs = append(f.logs, l)
		},
		"conflicting duplicate": func(f *fixture) { l := f.logs[2]; l.Data = "0x00"; f.logs = append(f.logs, l) },
		"fleet budget":          func(f *fixture) { f.cfg.MaxFleetReads = 2 },
		"log pagination budget": func(f *fixture) { f.cfg.MaxPages = 2 },
		"row budget":            func(f *fixture) { f.cfg.MaxRows = 2 },
		"response budget":       func(f *fixture) { f.cfg.MaxResponseBytes = 100 },
		"snapshot budget":       func(f *fixture) { f.cfg.MaxInputBytes = 100 },
	}
	for name, mut := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFixture()
			mut(f)
			s := setup(t, f)
			h := service.Anchor{Number: f.head, Hash: blockHash(f.head)}
			ids, e := s.Pending(context.Background(), h, 4)
			if e == nil || ids != nil {
				t.Fatalf("accepted incomplete/malicious source: %v %v", ids, e)
			}
		})
	}
}
func TestGetterNotEventPendingAuthority(t *testing.T) {
	f := newFixture()
	f.status[5] = p.Const(2)
	s := setup(t, f)
	h := service.Anchor{Number: 8, Hash: blockHash(8)}
	ids, e := s.Pending(context.Background(), h, 4)
	if e != nil || len(ids) != 0 {
		t.Fatalf("event claimed phase3: %v %v", ids, e)
	}
	f.failFleet = "4"
	if ids, e = s.Pending(context.Background(), h, 4); e == nil || ids != nil {
		t.Fatal("last-page getter failure became empty success")
	}
}
func TestFullUint256AndAlteredIdentity(t *testing.T) {
	f := newFixture()
	f.id = word(new(big.Int).Add(new(big.Int).Lsh(big.NewInt(1), 240), big.NewInt(123)))
	f.rows[1][0] = f.id
	f.rows[2][0] = f.id
	f.cfg.ChainID = new(big.Int).Add(new(big.Int).Lsh(big.NewInt(1), 200), big.NewInt(8453)).String()
	f.next = word(new(big.Int).Add(rb.Integer(f.id), big.NewInt(1)))
	f.rebuild()
	s := setup(t, f)
	h := service.Anchor{Number: 8, Hash: blockHash(8)}
	snap, e := s.Observe(context.Background(), dec(f.id), h)
	if e != nil {
		t.Fatal(e)
	}
	if snap.Identity.BattleID != dec(f.id) || snap.Identity.ChainID != f.cfg.ChainID {
		t.Fatal("uint256 truncated")
	}
	bad := snap.Identity
	bad.InputHash = strings.Repeat("b", 64)
	if _, e = s.Snapshot(context.Background(), bad, h); e == nil {
		t.Fatal("altered SHA accepted")
	}
	if ids, e := s.Pending(context.Background(), h, 4); e == nil || ids != nil {
		t.Fatal("huge fleet range silently truncated")
	}
}
func TestHistoricalCanonicalReorg(t *testing.T) {
	f := newFixture()
	s := setup(t, f)
	h := service.Anchor{Number: 8, Hash: blockHash(8)}
	ok, e := s.Canonical(context.Background(), service.Anchor{Number: 5, Hash: blockHash(99)}, h)
	if e != nil || ok {
		t.Fatal("orphan anchor accepted")
	}
	f.reorg = true
	if _, e = s.Canonical(context.Background(), service.Anchor{Number: 5, Hash: blockHash(5)}, h); e == nil {
		t.Fatal("reorganized head accepted")
	}
}
