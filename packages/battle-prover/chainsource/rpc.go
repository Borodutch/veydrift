// Package chainsource reads public finalized authority. It neither signs nor proves.
package chainsource

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	"golang.org/x/crypto/sha3"
)

// Limits are operational budgets, never protocol fleet/row limits. Exhaustion
// fails the entire observation; callers may increase budgets, never accept a prefix.
type Config struct {
	URL, ChainID, Game                                                                    string
	DeploymentBlock                                                                       uint64
	Release                                                                               Release
	BlockPage                                                                             uint64
	FleetPage, MaxPages, MaxFleetReads, MaxLogs, MaxRows, MaxInputBytes, MaxResponseBytes int
}
type Release struct {
	Version                                            uint32
	Rules, Catalog, Verifier, VerifierCodehash, Engine string
	// VerifierManifest is the SHA256 identity of the approved proof/key manifest.
	VerifierManifest string
}
type Source struct {
	cfg    Config
	client *http.Client
	seq    atomic.Uint64
}

var _ service.Source = (*Source)(nil)
var ErrIncomplete = errors.New("incomplete chain observation or operational budget exhausted")

func New(c Config, client *http.Client) (*Source, error) {
	u, e := url.Parse(c.URL)
	if e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
		return nil, errors.New("HTTP RPC URL without credentials required")
	}
	if _, e = decimal(c.ChainID); e != nil {
		return nil, e
	}
	if !address(c.Game) || !address(c.Release.Verifier) || !address(c.Release.Engine) || c.Release.Version != 3 {
		return nil, errors.New("unsupported release or address")
	}
	for _, v := range []string{c.Release.Rules, c.Release.Catalog, c.Release.VerifierCodehash, c.Release.VerifierManifest} {
		if !hash(v) {
			return nil, errors.New("release requires canonical nonzero digests")
		}
	}
	if c.Release.Rules != digest(q.RulesID()) || c.Release.Catalog != digest(q.CatalogID()) {
		return nil, errors.New("release rules/catalog unsupported by linked qualification")
	}
	if c.BlockPage == 0 || c.FleetPage < 1 || c.MaxPages < 1 || c.MaxFleetReads < 1 || c.MaxLogs < 1 || c.MaxRows < 1 || c.MaxInputBytes < 1 || c.MaxResponseBytes < 1 {
		return nil, errors.New("explicit positive pagination and byte budgets required")
	}
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &Source{cfg: c, client: client}, nil
}
func hash(s string) bool {
	b, e := hex.DecodeString(s)
	return e == nil && len(b) == 32 && s == strings.ToLower(s) && s != strings.Repeat("0", 64)
}
func address(s string) bool {
	b, e := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	return strings.HasPrefix(s, "0x") && e == nil && len(b) == 20 && s == strings.ToLower(s) && s != "0x"+strings.Repeat("0", 40)
}
func decimal(s string) (*big.Int, error) {
	n, ok := new(big.Int).SetString(s, 10)
	if !ok || n.Sign() <= 0 || n.BitLen() > 256 || n.String() != s {
		return nil, errors.New("canonical positive uint256 required")
	}
	return n, nil
}
func quantity(s string) (*big.Int, error) {
	if !strings.HasPrefix(s, "0x") || len(s) < 3 || (len(s) > 3 && s[2] == '0') {
		return nil, errors.New("invalid RPC quantity")
	}
	n, ok := new(big.Int).SetString(s[2:], 16)
	if !ok || n.Sign() < 0 || n.BitLen() > 256 || "0x"+n.Text(16) != s {
		return nil, errors.New("invalid RPC quantity")
	}
	return n, nil
}
func hexbytes(s string) ([]byte, error) {
	if !strings.HasPrefix(s, "0x") {
		return nil, errors.New("missing hex prefix")
	}
	return hex.DecodeString(s[2:])
}
func hx(b []byte) string   { return "0x" + hex.EncodeToString(b) }
func word(n *big.Int) rb.U { return p.MustValue(n) }
func fromHex(s string) rb.U {
	b, _ := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	return word(new(big.Int).SetBytes(b))
}
func digest(u rb.U) string     { return hex.EncodeToString(rb.Encode(u)) }
func keccak(b []byte) []byte   { h := sha3.NewLegacyKeccak256(); h.Write(b); return h.Sum(nil) }
func selector(s string) []byte { return keccak([]byte(s))[:4] }
func (s *Source) rpc(ctx context.Context, method string, params any, out any) error {
	id := s.seq.Add(1)
	b, e := json.Marshal(struct {
		JSONRPC string `json:"jsonrpc"`
		ID      uint64 `json:"id"`
		Method  string `json:"method"`
		Params  any    `json:"params"`
	}{"2.0", id, method, params})
	if e != nil {
		return e
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.URL, bytes.NewReader(b))
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	resp, e := s.client.Do(req)
	if e != nil {
		return fmt.Errorf("RPC transport: %w", e)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("RPC HTTP status %d", resp.StatusCode)
	}
	b, e = io.ReadAll(io.LimitReader(resp.Body, int64(s.cfg.MaxResponseBytes)+1))
	if e != nil {
		return e
	}
	if len(b) > s.cfg.MaxResponseBytes {
		return ErrIncomplete
	}
	var r struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      uint64          `json:"id"`
		Result  json.RawMessage `json:"result"`
		Error   json.RawMessage `json:"error"`
	}
	if e = json.Unmarshal(b, &r); e != nil {
		return e
	}
	if r.JSONRPC != "2.0" || r.ID != id || len(r.Result) == 0 || string(r.Result) == "null" || (len(r.Error) > 0 && string(r.Error) != "null") {
		return errors.New("invalid or failed JSONRPC response")
	}
	return json.Unmarshal(r.Result, out)
}
func (s *Source) block(ctx context.Context, tag string) (service.Anchor, error) {
	var b struct{ Number, Hash string }
	if e := s.rpc(ctx, "eth_getBlockByNumber", []any{tag, false}, &b); e != nil {
		return service.Anchor{}, e
	}
	n, e := quantity(b.Number)
	if e != nil || !n.IsUint64() || !strings.HasPrefix(b.Hash, "0x") || !hash(strings.TrimPrefix(b.Hash, "0x")) {
		return service.Anchor{}, errors.New("invalid block")
	}
	if tag != "finalized" && tag != "latest" && b.Number != tag {
		return service.Anchor{}, errors.New("wrong block number")
	}
	return service.Anchor{Number: n.Uint64(), Hash: b.Hash[2:]}, nil
}
func tag(n uint64) string { return "0x" + strconv.FormatUint(n, 16) }
func (s *Source) chain(ctx context.Context) error {
	var v string
	if e := s.rpc(ctx, "eth_chainId", []any{}, &v); e != nil {
		return e
	}
	n, e := quantity(v)
	if e != nil || n.String() != s.cfg.ChainID {
		return errors.New("chain identity mismatch")
	}
	return nil
}
func (s *Source) Finalized(ctx context.Context) (service.Anchor, error) {
	if e := s.chain(ctx); e != nil {
		return service.Anchor{}, e
	}
	h, e := s.block(ctx, "finalized")
	if e == nil && h.Number < s.cfg.DeploymentBlock {
		e = errors.New("finalized head predates deployment")
	}
	return h, e
}

// requireHead brackets every multi-read operation. eth_call/getCode additionally
// use EIP-1898 requireCanonical; unsupported RPCs fail, without latest fallback.
func (s *Source) requireHead(ctx context.Context, h service.Anchor) error {
	if !hash(h.Hash) {
		return errors.New("invalid head")
	}
	if e := s.chain(ctx); e != nil {
		return e
	}
	f, e := s.block(ctx, "finalized")
	if e != nil {
		return e
	}
	if f.Number < h.Number {
		return errors.New("head not finalized")
	}
	got, e := s.block(ctx, tag(h.Number))
	if e != nil {
		return e
	}
	if got != h {
		return errors.New("finalized head reorganized")
	}
	return nil
}
func (s *Source) Canonical(ctx context.Context, a, h service.Anchor) (bool, error) {
	if e := s.requireHead(ctx, h); e != nil {
		return false, e
	}
	if !hash(a.Hash) || a.Number > h.Number {
		return false, nil
	}
	got, e := s.block(ctx, tag(a.Number))
	if e != nil {
		return false, e
	}
	if e = s.requireHead(ctx, h); e != nil {
		return false, e
	}
	return got == a, nil
}
func pin(h service.Anchor) any {
	return map[string]any{"blockHash": "0x" + h.Hash, "requireCanonical": true}
}
func (s *Source) call(ctx context.Context, h service.Anchor, to, sig string, args ...rb.U) ([]byte, error) {
	data := append(selector(sig), rb.Encode(args...)...)
	var out string
	e := s.rpc(ctx, "eth_call", []any{map[string]string{"to": to, "data": hx(data)}, pin(h)}, &out)
	if e != nil {
		return nil, e
	}
	return hexbytes(out)
}
func dynamic(b []byte) ([]byte, error) {
	if len(b) < 64 || len(b)%32 != 0 || new(big.Int).SetBytes(b[:32]).Cmp(big.NewInt(32)) != 0 {
		return nil, errors.New("unsupported dynamic ABI")
	}
	n := new(big.Int).SetBytes(b[32:64])
	if !n.IsUint64() || n.Uint64() > uint64(len(b)-64) {
		return nil, errors.New("invalid ABI length")
	}
	l := int(n.Uint64())
	if (l+31)/32*32 != len(b)-64 {
		return nil, errors.New("trailing ABI")
	}
	for _, v := range b[64+l:] {
		if v != 0 {
			return nil, errors.New("nonzero ABI padding")
		}
	}
	return b[64 : 64+l], nil
}
func (s *Source) record(ctx context.Context, h service.Anchor, id rb.U, kind uint64, index rb.U) ([]byte, error) {
	b, e := s.call(ctx, h, s.cfg.Game, "proofBattleRecord(uint256,uint8,uint256)", id, p.Const(kind), index)
	if e != nil {
		return nil, e
	}
	return dynamic(b)
}
func (s *Source) code(ctx context.Context, h service.Anchor, a string) ([]byte, error) {
	var v string
	if e := s.rpc(ctx, "eth_getCode", []any{a, pin(h)}, &v); e != nil {
		return nil, e
	}
	b, e := hexbytes(v)
	if e == nil && len(b) == 0 {
		e = errors.New("empty contract code")
	}
	return b, e
}
