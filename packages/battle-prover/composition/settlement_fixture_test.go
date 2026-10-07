package composition

import (
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	out "github.com/Borodutch/veydrift/packages/battle-prover/outputbridge"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"math/big"
	"testing"
)

type settlementFixture struct {
	m           *out.Machine
	steps       []*out.Step
	raw         []*raw.Step
	qualified   *q.LinkedCircuit
	bridge      *rb.Machine
	reports     []*rb.ReportStep
	prep        []*prep.Step
	combat      []*mb.Step
	bridgeSteps []*rb.Step
}

func wordBig(w p.Uint256) *big.Int {
	n := new(big.Int)
	for i := 3; i >= 0; i-- {
		n.Lsh(n, 64)
		n.Add(n, integer(w[i]))
	}
	return n
}

// Fixture mirrors outputbridge's independently crosschecked raw journal and
// pinned-catalog native battle; retains ALL traces for proof composition.
func buildSettlement(t *testing.T, empty bool) settlementFixture {
	t.Helper()
	id := prep.Identity{Chain: p.Const(8453), Game: p.Const(1), Battle: p.Const(100), Body: p.Const(3), Incarnation: p.Const(0), Impact: p.Const(5), Rules: q.RulesID(), Verifier: p.Const(7), Catalog: q.CatalogID(), SeedPolicy: p.Const(1), TargetIsMoon: 0}
	tech := p.Technology{Weapons: 0, Shielding: 0, Armor: 0}
	rows := []prep.Row{{Owner: p.Const(3), Source: p.Const(0), Count: p.Const(1), Side: 1, Type: 0, Tech: tech}, {Owner: p.Const(1), Source: p.Const(100), Count: p.Const(1), Side: 0, Type: 10, Tech: tech}, {Owner: p.Const(2), Source: p.Const(101), Count: p.Const(1), Side: 0, Type: 10, Tech: tech}}
	if empty {
		rows = nil
	}
	pm, e := prep.New(id, rows, q.Bases())
	check(t, e)
	ps, e := pm.Chunk(200)
	check(t, e)
	if integer(pm.State.Phase).Int64() != prep.Done {
		t.Fatal("prep fixture budget")
	}
	groups := []rb.Group{}
	units := []mb.Cell{}
	if !empty {
		for i, typ := range []uint64{10, 0} {
			st := q.Bases()[typ]
			g := rb.Group{Cohort: rb.Cohort{ID: p.Const(uint64(i)), Key: p.Key{Side: i, Type: typ, Stats: st}, Members: p.Const(1), Total: p.Const(1)}}
			rs := rows[:1]
			if i == 0 {
				rs = rows[1:]
				g.Cohort.Members = p.Const(2)
				g.Cohort.Total = p.Const(2)
			}
			for _, r := range rs {
				g.Members = append(g.Members, rb.Member{Owner: r.Owner, Source: r.Source, Quantity: uint64(1), Tech: tech})
				units = append(units, mb.Cell{mb.W(uint64(i)), mb.W(typ), mb.Big(wordBig(st.Attack)), mb.Big(wordBig(st.Shield)), mb.Big(wordBig(st.Hull)), mb.W(uint64(i))})
			}
			groups = append(groups, g)
		}
	}
	var seed [32]byte
	seed[31] = 1
	snap := mb.Big(pm.C.Commitment())
	cm, e := mb.New(mb.PreparedInput{Units: units, Rapidfire: q.Rapidfire(), Seed: seed, Snapshot: [4]uint64(snap)})
	check(t, e)
	var records []rb.ReportRecord
	var combatSteps []*mb.Step
	var bridgeSteps []*rb.Step
	for n := 0; n < 1000 && cm.State.V[0] != mb.W(mb.Done); n++ {
		s, e := cm.Next()
		check(t, e)
		combatSteps = append(combatSteps, s)
		if s.Kind == mb.Scan {
			alive := 0
			for _, v := range s.Openings[0].Cell[mb.Hull] {
				if integer(v).Sign() != 0 {
					alive = 1
				}
			}
			records = append(records, rb.ReportRecord{Alive: alive, Shots0: s.Before[9], Shots1: s.Before[10]})
		}
	}
	if cm.State.V[0] != mb.W(mb.Done) {
		t.Fatal("combat fixture budget")
	}
	bm, e := rb.FromMachines(pm, cm, groups)
	check(t, e)
	for n := 0; n < 200 && integer(bm.State.Phase).Int64() != rb.Done; n++ {
		s, err := bm.Next()
		check(t, err)
		bridgeSteps = append(bridgeSteps, s)
	}
	if integer(bm.State.Phase).Int64() != rb.Done {
		t.Fatal("bridge fixture budget")
	}
	reports, e := rb.ReportWitnesses(bm.Context, records, bm.Open)
	check(t, e)
	meta := raw.Metadata{Preparation: pm.C, Version: p.Const(q.LinkedVersion), Codehash: p.Const(77), Engine: p.Const(88), RequestID: p.Const(4), Purpose: q.Purpose(id.Chain, id.Battle)}
	var header raw.Header
	for i := range header {
		header[i] = p.Const(0)
	}
	header[0] = id.Body
	header[4] = id.Impact
	header[5] = p.Const(3)
	events := []raw.Event{}
	if !empty {
		events = append(events, raw.RowEvent(rows[0]))
		for i, r := range rows[1:] {
			var mission raw.Mission
			for j := range mission {
				mission[j] = p.Const(0)
			}
			mission[0] = p.Const(1)
			mission[1] = p.Const(3)
			if i == 1 {
				mission[1] = p.Const(8)
			}
			mission[2] = r.Owner
			mission[4] = id.Body
			mission[6] = id.Impact
			mission[21] = p.Const(1)
			mission[26] = meta.RequestID
			events = append(events, raw.SourceEvent(r.Source, mission), raw.RowEvent(r))
		}
	}
	rs, e := raw.Build(meta, header, events)
	check(t, e)
	last := rs[len(rs)-1]
	qualified, e := q.NewLinked(meta, last.Statement(), last.After.Journal, pm.State, ps[len(ps)-1].Statement(), p.Const(1))
	check(t, e)
	if integer(qualified.Input).Cmp(cm.Context.Commitment()) != 0 {
		t.Fatal("actual qualification/combat input mismatch")
	}
	m, e := out.FromBridge(bm, reports[len(reports)-1].Statement(), qualified.ChainRecord, qualified.RawResult)
	check(t, e)
	steps, e := m.Chunk(100)
	check(t, e)
	if integer(m.State.Phase).Int64() != out.Done {
		t.Fatal("output fixture budget")
	}
	if !empty {
		if len(bm.Attributions) != 2 || len(m.Leaves) != 3 {
			t.Fatal("two allocation coverage")
		}
		for i, l := range m.Leaves {
			want := uint64(0)
			if i == 2 {
				want = 1
			}
			if integer(l.Lost).Uint64() != want {
				t.Fatal("hand-derived destroyer/cargo casualties")
			}
		}
	}
	return settlementFixture{m: m, steps: steps, raw: rs, qualified: qualified, bridge: bm, reports: reports, prep: ps, combat: combatSteps, bridgeSteps: bridgeSteps}
}
