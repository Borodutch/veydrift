package preparation

import (
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/frontend"
	"math/big"
	"testing"
)

func TestAuthenticatedOwnerTechMismatch(t *testing.T) {
	m, _ := New(identity(), []Row{row(1, 1, 1), row(1, 2, 1)}, base())
	m.Rows[1].Tech.Armor = 1
	m.Raw.Write(big.NewInt(1), Hash(RawDomain, m.Rows[1].Values()...))
	m.C.Raw = m.Raw.Root()
	m.Next()
	m.Next()
	w, _ := m.Next()
	solve(t, compile(t, Pair), w, false)
}
func TestMemberIntegerBoundaries(t *testing.T) {
	c := compile(t, Member)
	m, _ := New(identity(), []Row{row(1, 1, 1)}, base())
	m.Next()
	m.Next()
	w, _ := m.Next()
	solve(t, c, w, true)
	max := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
	for _, mutate := range []func(*Step){
		func(x *Step) { x.Before.Total = p.MustValue(max); x.After.Total = p.Const(0) },
		func(x *Step) {
			x.Row.Count = p.MustValue(new(big.Int).Lsh(big.NewInt(1), 32))
			x.After.Previous = x.Row
		},
		func(x *Step) {
			x.Base.Attack = p.MustValue(max)
			x.Effective.Attack = p.MustValue(max)
			x.After.Key.Stats.Attack = x.Effective.Attack
		},
		func(x *Step) { x.C.Identity.TargetIsMoon = 2 },
	} {
		bad := *w
		bad.Paths = append([]Path{}, w.Paths...)
		mutate(&bad)
		// Authenticate attacker-controlled raw/catalog substitutions so failure is
		// the domain/arithmetic condition, not just a stale Merkle leaf.
		rt := NewTree(big.NewInt(0))
		rt.Write(big.NewInt(0), Hash(RawDomain, bad.Row.Values()...))
		bad.C.Raw = rt.Root()
		bad.Paths[0] = rt.Open(big.NewInt(0))
		ct := NewTree(big.NewInt(0))
		ct.Write(big.NewInt(0), Hash(CatalogDomain, append([]frontend.Variable{bad.Row.Type}, fields(bad.Base.Attack, bad.Base.Shield, bad.Base.Hull)...)...))
		bad.C.Catalog = ct.Root()
		bad.Paths[2] = ct.Open(big.NewInt(0))
		bad.ContextHash = bad.C.Commitment()
		bad.BeforeHash = bad.Before.Commitment()
		bad.AfterHash = bad.After.Commitment()
		solve(t, c, &bad, false)
	}
}
