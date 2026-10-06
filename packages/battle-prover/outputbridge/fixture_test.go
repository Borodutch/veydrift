package outputbridge

import (
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"testing"
)

type fixture struct {
	m         *Machine
	steps     []*Step
	raw       []*raw.Step
	qualified *q.LinkedCircuit
	bridge    *rb.Machine
	reports   []*rb.ReportStep
}

func check(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}
func compile(t *testing.T, c frontend.Circuit) constraint.ConstraintSystem {
	t.Helper()
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, c)
	check(t, e)
	t.Logf("%T constraints=%d public=%d", c, cc.GetNbConstraints(), cc.GetNbPublicVariables())
	if cc.GetNbConstraints() > 4000000 {
		t.Fatal("4M circuit budget")
	}
	return cc
}
func solve(t *testing.T, cc constraint.ConstraintSystem, w frontend.Circuit, ok bool) {
	t.Helper()
	v, e := frontend.NewWitness(w, ecc.BN254.ScalarField())
	check(t, e)
	e = cc.IsSolved(v)
	if (e == nil) != ok {
		t.Fatalf("expected valid=%v: %v", ok, e)
	}
}
func build(t *testing.T, empty bool) fixture {
	t.Helper()
	id := prep.Identity{Chain: Z(8453), Game: Z(1), Battle: Z(100), Body: Z(3), Incarnation: Z(0), Impact: Z(5), Rules: q.RulesID(), Verifier: Z(7), Catalog: q.CatalogID(), SeedPolicy: Z(1), TargetIsMoon: 0}
	tech := p.Technology{Weapons: 0, Shielding: 0, Armor: 0}
	rows := []prep.Row{{Owner: Z(3), Source: Z(0), Count: Z(1), Side: 1, Type: 0, Tech: tech}, {Owner: Z(1), Source: Z(100), Count: Z(1), Side: 0, Type: 10, Tech: tech}, {Owner: Z(2), Source: Z(101), Count: Z(1), Side: 0, Type: 10, Tech: tech}}
	if empty {
		rows = nil
	}
	pm, e := prep.New(id, rows, q.Bases())
	check(t, e)
	ps, e := pm.Chunk(200)
	check(t, e)
	if scalar(pm.State.Phase).Int64() != prep.Done {
		t.Fatal("prep fixture budget")
	}
	groups := []rb.Group{}
	units := []mb.Cell{}
	if !empty {
		for i, typ := range []uint64{10, 0} {
			st := q.Bases()[typ]
			g := rb.Group{Cohort: rb.Cohort{ID: Z(uint64(i)), Key: p.Key{Side: i, Type: typ, Stats: st}, Members: Z(1), Total: Z(1)}}
			rs := rows[:1]
			if i == 0 {
				rs = rows[1:]
				g.Cohort.Members = Z(2)
				g.Cohort.Total = Z(2)
			}
			for _, r := range rs {
				g.Members = append(g.Members, rb.Member{Owner: r.Owner, Source: r.Source, Quantity: uint64(1), Tech: tech})
				units = append(units, mb.Cell{mb.W(uint64(i)), mb.W(typ), mb.Big(number(st.Attack)), mb.Big(number(st.Shield)), mb.Big(number(st.Hull)), mb.W(uint64(i))})
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
	for n := 0; n < 1000 && cm.State.V[0] != mb.W(mb.Done); n++ {
		s, e := cm.Next()
		check(t, e)
		if s.Kind == mb.Scan {
			alive := 0
			for _, v := range s.Openings[0].Cell[mb.Hull] {
				if scalar(v).Sign() != 0 {
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
	for n := 0; n < 200 && scalar(bm.State.Phase).Int64() != rb.Done; n++ {
		_, e = bm.Next()
		check(t, e)
	}
	if scalar(bm.State.Phase).Int64() != rb.Done {
		t.Fatal("bridge fixture budget")
	}
	reports, e := rb.ReportWitnesses(bm.Context, records, bm.Open)
	check(t, e)
	meta := raw.Metadata{Preparation: pm.C, Version: Z(q.LinkedVersion), Codehash: Z(77), Engine: Z(88), RequestID: Z(4), Purpose: q.Purpose(id.Chain, id.Battle)}
	var header raw.Header
	for i := range header {
		header[i] = Z(0)
	}
	header[0] = id.Body
	header[4] = id.Impact
	header[5] = Z(3)
	events := []raw.Event{}
	if !empty {
		events = append(events, raw.RowEvent(rows[0]))
		for i, r := range rows[1:] {
			var mission raw.Mission
			for j := range mission {
				mission[j] = Z(0)
			}
			mission[0] = Z(1)
			mission[1] = Z(3)
			if i == 1 {
				mission[1] = Z(8)
			}
			mission[2] = r.Owner
			mission[4] = id.Body
			mission[6] = id.Impact
			mission[21] = Z(1)
			mission[26] = meta.RequestID
			events = append(events, raw.SourceEvent(r.Source, mission), raw.RowEvent(r))
		}
	}
	rs, e := raw.Build(meta, header, events)
	check(t, e)
	last := rs[len(rs)-1]
	qualified, e := q.NewLinked(meta, last.Statement(), last.After.Journal, pm.State, ps[len(ps)-1].Statement(), Z(1))
	check(t, e)
	if scalar(qualified.Input).Cmp(cm.Context.Commitment()) != 0 {
		t.Fatal("actual qualification/combat input mismatch")
	}
	m, e := FromBridge(bm, reports[len(reports)-1].Statement(), qualified.ChainRecord, qualified.RawResult)
	check(t, e)
	steps, e := m.Chunk(100)
	check(t, e)
	if scalar(m.State.Phase).Int64() != Done {
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
			if scalar(l.Lost).Uint64() != want {
				t.Fatal("hand-derived destroyer/cargo casualties")
			}
		}
	}
	return fixture{m, steps, rs, qualified, bm, reports}
}
