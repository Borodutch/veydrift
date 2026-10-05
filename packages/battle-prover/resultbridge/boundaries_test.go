package resultbridge

import (
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"math/big"
	"testing"
)

func TestAuthenticatedHighAddressElementary(t *testing.T) {
	f := build(t, []Group{group(0, 0, 0, 0, 1)})
	var w Step
	for _, s := range f.bridgeSteps {
		if s.Kind == Units {
			w = *s
		}
	}
	index := new(big.Int).Add(new(big.Int).Lsh(big.NewInt(1), 255), big.NewInt(3))
	mem := mb.NewMemory()
	cell := f.combat.Memory.Read(mb.Key{Domain: mb.UnitDomain, Index: mb.W(0)})
	key := mb.Key{Domain: mb.UnitDomain, Index: mb.Big(index)}
	mem.Write(key, cell)
	o := mem.Open(key)
	w.Context.Combat.Memory = mem.Root()
	w.Before.Unit = p.MustValue(index)
	w.After.Unit = add(w.Before.Unit, 1)
	w.Context.Prepared.N = w.After.Unit
	w.Unit = Opening{Cell: Cell(o.Cell), Siblings: o.Siblings}
	w.commit()
	cc := compile(t, Shape(Units))
	solve(t, cc, &w, true)
	w.Before.Unit = Z(3)
	w.After.Unit = Z(4)
	w.commit()
	solve(t, cc, &w, false)
}
func TestSnapshotFieldAliasRejected(t *testing.T) {
	f := build(t, nil)
	w := *f.bridgeSteps[0]
	w.Context.Prepared.Snapshot = p.MustValue(new(big.Int).Add(number(w.Context.Prepared.Snapshot), fr.Modulus()))
	w.commit()
	solve(t, compile(t, Shape(Begin)), &w, false)
}
