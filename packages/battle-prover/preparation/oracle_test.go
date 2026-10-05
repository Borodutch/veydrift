package preparation

import (
	"encoding/json"
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"math/big"
	"os/exec"
	"testing"
)

type oracleGroup struct {
	Owner, Source     string
	Count, Side, Type uint64
	Technology        struct{ Weapons, Shielding, Armor uint64 }
}
type oracleCohort struct {
	Side, Type, Count    uint64
	Attack, Shield, Hull string
	Groups               []oracleGroup
}

func parse(s string, base int) *big.Int {
	n, ok := new(big.Int).SetString(s, base)
	if !ok {
		panic(s)
	}
	return n
}
func TestOrdinaryOracleAndMemoryRoot(t *testing.T) {
	data, e := exec.Command("bun", "oracle-fixture.ts").CombinedOutput()
	if e != nil {
		t.Fatalf("oracle %v %s", e, data)
	}
	var fs []struct {
		Groups  []oracleGroup
		Cohorts []oracleCohort
	}
	if e = json.Unmarshal(data, &fs); e != nil {
		t.Fatal(e)
	}
	var baseline *big.Int
	for variant, f := range fs {
		rows := []Row{}
		for _, g := range f.Groups {
			r := Row{p.MustValue(parse(g.Owner[2:], 16)), p.MustValue(parse(g.Source, 10)), p.Const(g.Count), g.Side, g.Type, p.Technology{g.Technology.Weapons, g.Technology.Shielding, g.Technology.Armor}}
			rows = append(rows, r)
		}
		m, e := New(identity(), rows, base())
		if e != nil {
			t.Fatal(e)
		}
		ws, e := m.Chunk(1000)
		if e != nil || scalar(m.State.Phase).Int64() != Done {
			t.Fatal("incomplete", e)
		}
		_ = ws
		var ch, mh interface{} = 0, 0
		mem := mb.NewMemory()
		index := uint64(0)
		for id, c := range f.Cohorts {
			k := p.Key{Side: c.Side, Type: c.Type, Stats: p.Stats{p.MustValue(parse(c.Attack, 10)), p.MustValue(parse(c.Shield, 10)), p.MustValue(parse(c.Hull, 10))}}
			ch = CohortHash(ch, k, p.Const(uint64(id)), p.Const(c.Count))
			for _, g := range c.Groups {
				r := Row{p.MustValue(parse(g.Owner[2:], 16)), p.MustValue(parse(g.Source, 10)), p.Const(g.Count), g.Side, g.Type, p.Technology{g.Technology.Weapons, g.Technology.Shielding, g.Technology.Armor}}
				mh = MemberHash(mh, r, k, p.Const(uint64(id)))
			}
			for n := uint64(0); n < c.Count; n++ {
				cell := mb.Cell{mb.W(c.Side), mb.W(c.Type), mb.Big(parse(c.Attack, 10)), mb.Big(parse(c.Shield, 10)), mb.Big(parse(c.Hull, 10)), mb.W(uint64(id))}
				mem.Write(mb.Key{Domain: mb.RosterDomain, Index: mb.W(index)}, cell)
				index++
			}
		}
		if scalar(ch).Cmp(scalar(m.State.Cohorts)) != 0 || scalar(mh).Cmp(scalar(m.State.Members)) != 0 || mem.Root().Cmp(scalar(m.State.UnitRoot)) != 0 {
			t.Fatalf("oracle manifest/root mismatch variant=%d", variant)
		}
		if variant == 0 {
			baseline = mem.Root()
		}
		if variant < 4 && baseline.Cmp(mem.Root()) != 0 {
			t.Fatal("partition/order/owner changes altered cohorts")
		}
	}
}
