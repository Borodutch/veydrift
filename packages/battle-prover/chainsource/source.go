package chainsource

import (
	"context"
	"errors"
	"math/big"

	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

// Pending scans every fleet ID at the supplied head as well as all public
// journal pages since deployment. Thus dropped discovery events cannot produce
// a false empty set. No partial scan escapes on budget/RPC/unsupported-ABI error.
// Current contract lacks a pending-ID index; this deliberately costs O(nextFleetId).
func (s *Source) Pending(ctx context.Context, h service.Anchor, limit int) ([]service.Identity, error) {
	if limit < 1 {
		return nil, service.ErrBackpressure
	}
	if e := s.requireHead(ctx, h); e != nil {
		return nil, e
	}
	if _, e := s.code(ctx, h, s.cfg.Game); e != nil {
		return nil, e
	}
	logs, e := s.logs(ctx, h, "")
	if e != nil {
		return nil, e
	}
	b, e := s.call(ctx, h, s.cfg.Game, "nextFleetId()")
	if e != nil {
		return nil, e
	}
	v, e := static(b, 256)
	if e != nil {
		return nil, e
	}
	next := rb.Integer(v[0])
	if next.Sign() == 0 {
		return nil, errors.New("invalid fleet sequence")
	}
	total := new(big.Int).Sub(next, big.NewInt(1))
	if total.Cmp(big.NewInt(int64(s.cfg.MaxFleetReads))) > 0 {
		return nil, ErrIncomplete
	}
	for _, l := range logs {
		n := rb.Integer(fromHex(l.Topics[1]))
		if n.Sign() == 0 || n.Cmp(next) >= 0 {
			return nil, errors.New("event outside authoritative fleet range")
		}
	}
	out := []service.Identity{}
	pages := 0
	for start := uint64(1); start < next.Uint64(); {
		pages++
		if pages > s.cfg.MaxPages {
			return nil, ErrIncomplete
		}
		end := start + uint64(s.cfg.FleetPage)
		if end < start || end > next.Uint64() {
			end = next.Uint64()
		}
		for n := start; n < end; n++ {
			st, e := s.status(ctx, h, p.Const(n))
			if e != nil {
				return nil, e
			}
			if eq(st[5], p.Const(3)) {
				if len(out) >= limit {
					return nil, service.ErrBackpressure
				}
				snap, e := s.load(ctx, h, p.Const(n), logs)
				if e != nil {
					return nil, e
				}
				out = append(out, snap.Identity)
			} else if zero(st[0]) && !zero(st[5]) {
				return nil, errors.New("invalid legacy phase")
			}
		}
		start = end
	}
	if e = s.requireHead(ctx, h); e != nil {
		return nil, e
	}
	return out, nil
}

// Snapshot requires an exact Identity (including expected SHA256). For callers
// that only know an event's battle ID, Observe derives authority first; event
// contents themselves are never admitted to service.Discover.
func (s *Source) Snapshot(ctx context.Context, id service.Identity, h service.Anchor) (service.Snapshot, error) {
	if e := id.Validate(); e != nil {
		return service.Snapshot{}, e
	}
	if id.ChainID != s.cfg.ChainID || id.Game != s.cfg.Game || id.Rules != s.cfg.Release.Rules || id.Verifier != s.cfg.Release.VerifierManifest {
		return service.Snapshot{}, errors.New("identity outside approved source")
	}
	snap, e := s.Observe(ctx, id.BattleID, h)
	if e != nil {
		return service.Snapshot{}, e
	}
	if snap.Identity != id {
		return service.Snapshot{}, errors.New("authoritative identity changed")
	}
	return snap, nil
}
func (s *Source) Observe(ctx context.Context, battleID string, h service.Anchor) (service.Snapshot, error) {
	n, e := decimal(battleID)
	if e != nil {
		return service.Snapshot{}, e
	}
	if e = s.requireHead(ctx, h); e != nil {
		return service.Snapshot{}, e
	}
	if _, e = s.code(ctx, h, s.cfg.Game); e != nil {
		return service.Snapshot{}, e
	}
	logs, e := s.logs(ctx, h, battleID)
	if e != nil {
		return service.Snapshot{}, e
	}
	snap, e := s.load(ctx, h, word(n), logs)
	if e != nil {
		return service.Snapshot{}, e
	}
	if e = s.requireHead(ctx, h); e != nil {
		return service.Snapshot{}, e
	}
	return snap, nil
}
