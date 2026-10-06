package chainsource

import (
	"context"
	"encoding/json"
	"testing"

	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

func TestLinkedPublicRecordParity(t *testing.T) {
	f := newFixture()
	s := setup(t, f)
	snap, e := s.Observe(context.Background(), dec(f.id), service.Anchor{Number: 8, Hash: blockHash(8)})
	if e != nil {
		t.Fatal(e)
	}
	var d Document
	if e = json.Unmarshal(snap.Input, &d); e != nil {
		t.Fatal(e)
	}
	c := q.LinkedCircuit{Meta: rb.Metadata{Version: f.status[0], Codehash: f.status[4], Engine: f.engine[0], RequestID: f.engine[1], Purpose: f.engine[2], Preparation: prep.Context{Identity: prep.Identity{Chain: p.Const(8453), Game: fromHex(f.cfg.Game), Battle: f.id, Rules: f.status[1], Catalog: f.status[2], Verifier: f.status[3]}, Rows: f.status[9]}}, ChainSnapshot: f.status[6], RandomnessContext: f.status[7], RandomWord: f.status[8]}
	if d.ChainRecord != digest(rb.Digest(c.ChainWords()...)) {
		t.Fatal("independent linked ChainWords mismatch")
	}
	for _, mut := range []func(*fixture){func(f *fixture) { f.cfg.Release.Rules = digest(p.Const(1)) }, func(f *fixture) { f.cfg.Release.Catalog = digest(p.Const(1)) }, func(f *fixture) { f.cfg.Release.Version = 4 }} {
		f := newFixture()
		mut(f)
		f.cfg.URL = "http://localhost:1"
		if _, e := New(f.cfg, nil); e == nil {
			t.Fatal("unsupported approved release accepted")
		}
	}
}
func TestStrictABIAndQuantities(t *testing.T) {
	for _, s := range []string{"0x+1", "0x-1", "0x01", "0xA", "0x", "1"} {
		if _, e := quantity(s); e == nil {
			t.Fatalf("quantity accepted %s", s)
		}
	}
	for _, b := range [][]byte{nil, rb.Encode(p.Const(32)), rb.Encode(p.Const(64), p.Const(0)), rb.Encode(p.Const(32), p.Const(0), p.Const(0)), rb.Encode(p.Const(32), p.Const(1), p.Const(1))} {
		if _, e := dynamic(b); e == nil {
			t.Fatal("noncanonical dynamic ABI accepted")
		}
	}
}
