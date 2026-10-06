package outputbridge

import (
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"math/big"
	"testing"
)

// This is an elementary arithmetic checkpoint, not a complete battle fixture.
// A production restart must authenticate its predecessor. It demonstrates that
// >64-bit cursors/aggregates are not narrowed by the output relation.
func TestFullWidthCheckpointAndOverflow(t *testing.T) {
	f := build(t, false)
	s := *f.steps[2]
	cc := compile(t, Shape(Member))
	high := p.MustValue(new(big.Int).Lsh(big.NewInt(1), 200))
	m := s.Manifest
	m.Context.Prepared.Members = inc(high)
	m.Context.Prepared.Cohorts = inc(high)
	m.Pipeline[4] = m.Context.Commitment()
	m.Pipeline[7] = prep.Hash(rb.CompleteResultDomain, m.Pipeline[4], m.Pipeline[5], m.Pipeline[6])
	c := s.Allocation
	c.Cohort = high
	c.Members = inc(high)
	before := s.Before
	before.Index = high
	before.Cohort = high
	before.Total = high
	before.Sum = high
	before.Loss = high
	before.Survivors0 = high
	before.Local = high
	before.PrevOwner = Z(0)
	before.PrevSource = Z(0)
	before.Active = c.Commitment()
	leaf := s.Leaf
	leaf.Index = high
	leaf.Cohort = high
	leaf.Source = high
	leaf.Count = uint64(4294967295)
	leaf.Lost = uint64(0)
	leaf.Survivors = uint64(4294967295)
	before.Expected = leaf.Digest(m.ChainRecord)
	// Reuse the host step transition with a singleton materialization, then lift
	// the global fields. Host arrays are deliberately not indexed by uint256.
	local := before
	local.Index = Z(0)
	local.Cohort = Z(0)
	machine := &Machine{Manifest: m, State: local, Groups: []Group{{Context: c}}, Leaves: []Leaf{leaf}}
	w, e := machine.Next()
	check(t, e)
	w.Before = before
	w.After.Index = inc(high)
	w.After.Cohort = high
	w.Leaf = leaf
	w.Commit()
	solve(t, cc, w, true)
	bad := *w
	max := p.MustValue(new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)))
	bad.Before.Total = max
	bad.After.Total = Z(4294967294)
	bad.Commit()
	solve(t, cc, &bad, false)
	bad = *w
	bad.Leaf.Index[0] = new(big.Int).Lsh(big.NewInt(1), 64)
	solve(t, cc, &bad, false)
	bad = *w
	bad.Leaf.Lost = uint64(4294967295)
	bad.Leaf.Survivors = uint64(1)
	solve(t, cc, &bad, false)
}
