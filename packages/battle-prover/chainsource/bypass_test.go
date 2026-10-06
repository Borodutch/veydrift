package chainsource

import (
	"context"
	"testing"

	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

func TestBypassRejectsStaleEventDiscovery(t *testing.T) {
	f := newFixture()
	s := setup(t, f)
	ctx := context.Background()
	h := service.Anchor{Number: f.head, Hash: blockHash(f.head)}
	before, err := s.Observe(ctx, dec(f.id), h)
	if err != nil {
		t.Fatal(err)
	}
	// Deliberately retain stale launch/header/seal/AwaitingProof discovery hints.
	// The storage getter is authoritative even against this inconsistent RPC view.
	f.status[5] = p.Const(4)
	bypass := f.logs[0]
	bypass.Topics = []string{topics()[6], f.logs[0].Topics[1]}
	bypass.Data = "0x"
	bypass.BlockNumber, bypass.BlockHash, bypass.LogIndex = tag(8), "0x"+blockHash(8), tag(30)
	f.logs = append(f.logs, bypass)
	ids, err := s.Pending(ctx, h, 4)
	if err != nil || len(ids) != 0 {
		t.Fatalf("bypassed battle admitted: %v %v", ids, err)
	}
	if _, err = s.Observe(ctx, dec(f.id), h); err == nil {
		t.Fatal("event discovery admitted bypass")
	}
	if _, err = s.Snapshot(ctx, before.Identity, h); err == nil {
		t.Fatal("cached identity admitted bypass")
	}
	// Conversely, a phase3 claim cannot hide a public bypass in the journal.
	f.status[5] = p.Const(3)
	if ids, err = s.Pending(ctx, h, 4); err == nil || ids != nil {
		t.Fatal("phase3/bypass conflict accepted")
	}
	if _, err = s.Observe(ctx, dec(f.id), h); err == nil {
		t.Fatal("conflicting bypass event accepted")
	}
}
