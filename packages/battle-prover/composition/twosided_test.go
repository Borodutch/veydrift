package composition

import (
	"fmt"
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark/frontend"
	"runtime"
	"testing"
)

// Fixed two-sided preflight: all units/rows are private witnesses, never key
// constants. Two round-start-pool shots (one lethal, one zero damage), complete report and both allocations.
func buildTwoSided(t *testing.T) ([]*Chunk, [][]*Chunk, []*rb.Step, *Chunk) {
	z := p.Const
	identity := prep.Identity{Chain: z(8453), Game: z(1), Battle: z(2), Body: z(3), Incarnation: z(4), Impact: z(5), Rules: z(6), Verifier: z(7), Catalog: z(8), SeedPolicy: z(9), TargetIsMoon: 0}
	stats := []p.Stats{{Attack: z(200), Shield: z(0), Hull: z(100)}, {Attack: z(0), Shield: z(0), Hull: z(100)}}
	rows := []prep.Row{}
	groups := []rb.Group{}
	units := []mb.Cell{}
	for i := 0; i < 2; i++ {
		r := prep.Row{Owner: z(uint64(i + 1)), Source: z(uint64(i + 1)), Count: z(1), Side: i, Type: i, Tech: p.Technology{Weapons: 0, Shielding: 0, Armor: 0}}
		rows = append(rows, r)
		groups = append(groups, rb.Group{Cohort: rb.Cohort{ID: z(uint64(i)), Key: p.Key{Side: i, Type: i, Stats: stats[i]}, Members: z(1), Total: z(1)}, Members: []rb.Member{{Owner: r.Owner, Source: r.Source, Quantity: uint64(1), Tech: r.Tech}}})
		attack := uint64(0)
		if i == 0 {
			attack = 200
		}
		units = append(units, mb.Cell{mb.W(uint64(i)), mb.W(uint64(i)), mb.W(attack), mb.W(0), mb.W(100), mb.W(uint64(i))})
	}
	pm, e := prep.New(identity, rows, map[uint64]p.Stats{0: stats[0], 1: stats[1]})
	check(t, e)
	ps, e := pm.Chunk(100)
	check(t, e)
	if integer(pm.State.Phase).Int64() != prep.Done {
		t.Fatal("prep bound")
	}
	// Fixed four elementary steps per chunk is NOT safe for the 1M-member phase.
	// Use single-step heterogeneous phase keys; scheduling varies proof count.
	chunks := []*Chunk{}
	for _, s := range ps {
		c := &Chunk{Phase: Preparation, Preparation: []prepStep{privateprepStep(s)}}
		setRange(c)
		chunks = append(chunks, c)
	}
	snap := mb.Big(pm.C.Commitment())
	cm, e := mb.New(mb.PreparedInput{Units: units, Snapshot: [4]uint64(snap)})
	check(t, e)
	records := []rb.ReportRecord{}
	combatN := 0
	shots := uint64(0)
	for i := 0; i < 200 && cm.State.V[0] != mb.W(mb.Done); i++ {
		s, e := cm.Next()
		check(t, e)
		c := &Chunk{Phase: Combat, Combat: []combatStep{privatecombatStep(s)}}
		setRange(c)
		chunks = append(chunks, c)
		combatN++
		if s.Kind == mb.Damage {
			shots++
		}
		if s.Kind == mb.Scan {
			alive := uint64(0)
			for _, v := range s.Openings[0].Cell[mb.Hull] {
				if integer(v).Sign() != 0 {
					alive = 1
				}
			}
			records = append(records, rb.ReportRecord{Alive: alive, Shots0: s.Before[9], Shots1: s.Before[10]})
		}
	}
	if cm.State.V[0] != mb.W(mb.Done) || cm.State.V[1] != mb.W(1) || cm.State.V[6] != mb.W(1) || cm.State.V[7] != mb.W(0) || cm.State.V[11] != mb.W(1) || shots != 2 {
		t.Fatalf("two-sided oracle: rounds=%v survivors=%v/%v outcome=%v shots=%d", cm.State.V[1], cm.State.V[6], cm.State.V[7], cm.State.V[11], shots)
	}
	bm, e := rb.FromMachines(pm, cm, groups)
	check(t, e)
	bs := []*rb.Step{}
	for i := 0; i < 100 && integer(bm.State.Phase).Int64() != rb.Done; i++ {
		s, e := bm.Next()
		check(t, e)
		bs = append(bs, s)
	}
	if integer(bm.State.Phase).Int64() != rb.Done || len(bm.Attributions) != 2 {
		t.Fatal("bridge incomplete")
	}
	allocations := [][]*Chunk{}
	for i, steps := range bm.AttrSteps {
		c := &Chunk{Phase: Attribution, Complete: true}
		for _, s := range steps {
			c.Attribution = append(c.Attribution, privateattrStep(s))
		}
		setRange(c)
		allocations = append(allocations, []*Chunk{c})
		a := bm.Attributions[i].Rows
		if len(a) != 1 || a[0].Lost != uint32(i) || a[0].Survivors != uint32(1-i) {
			t.Fatal("allocation native oracle")
		}
	}
	rs, e := rb.ReportWitnesses(bm.Context, records, bm.Open)
	check(t, e)
	report := &Chunk{Phase: Report, Complete: true}
	for _, s := range rs {
		report.Reports = append(report.Reports, privatereportStep(s))
	}
	setRange(report)
	t.Logf("TWO-SIDED ORACLE raw=2 units=2 preparation=%d combat=%d bridge=%d closes=2 attribution=4+4 report=%d rounds=1 actualDamageSteps=%d lost=[0,1] survivors=[1,0]", len(ps), combatN, len(bs), len(rs), shots)
	return chunks, allocations, bs, report
}
func TestTwoSidedPreflight(t *testing.T) {
	chunks, allocations, bridge, report := buildTwoSided(t)
	seen := map[string]bool{}
	for _, c := range chunks {
		kind := 0
		if c.Phase == Preparation {
			kind = c.Preparation[0].Kind
		} else {
			kind = c.Combat[0].Kind
		}
		name := fmt.Sprintf("phase%d-kind%d", c.Phase, kind)
		if seen[name] {
			continue
		}
		seen[name] = true
		cc := compile(t, name, c)
		for _, w := range chunks {
			k := 0
			if w.Phase == Preparation {
				k = w.Preparation[0].Kind
			} else {
				k = w.Combat[0].Kind
			}
			if fmt.Sprintf("phase%d-kind%d", w.Phase, k) == name {
				check(t, cc.IsSolved(wit(t, w)))
			}
		}
		runtime.GC()
	}
	for i, a := range allocations {
		cc := compile(t, fmt.Sprintf("attribution%d", i), a[0])
		check(t, cc.IsSolved(wit(t, a[0])))
		runtime.GC()
	}
	cc := compile(t, "nonzero-report", report)
	check(t, cc.IsSolved(wit(t, report)))
	cc = nil
	runtime.GC()
	for _, s := range bridge {
		if s.Kind == rb.Close {
			continue
		}
		name := fmt.Sprintf("bridge%d", s.Kind)
		if seen[name] {
			continue
		}
		seen[name] = true
		c := &Chunk{Phase: Bridge, Bridge: []bridgeStep{privatebridgeStep(s)}}
		setRange(c)
		cc := compile(t, name, c)
		for _, w := range bridge {
			if w.Kind == s.Kind {
				x := &Chunk{Phase: Bridge, Bridge: []bridgeStep{privatebridgeStep(w)}}
				setRange(x)
				check(t, cc.IsSolved(wit(t, x)))
			}
		}
		runtime.GC()
	}
	t.Log("PREFLIGHT ONLY: no recursive proof generated; Close obligations require genuine attribution receipts")
}

// Constraint-only cross-phase check, supplemental to cryptographic receipts.
// Explicitly NOT an authenticated recursive proof.
type twoSidedLinks struct {
	Prep, Combat []Range
	Bridge       []Range
	Allocation   []Range
	Report       Range
	Result       frontend.Variable
}

func (c *twoSidedLinks) Define(api frontend.API) error {
	for _, xs := range []struct {
		phase int
		rs    []Range
	}{{Preparation, c.Prep}, {Combat, c.Combat}, {Bridge, c.Bridge}} {
		for i := 1; i < len(xs.rs); i++ {
			link(api, xs.phase, xs.rs[i-1].Last, xs.rs[i].First)
		}
		complete(api, xs.phase, xs.rs[0].First, xs.rs[len(xs.rs)-1].Last)
	}
	for i, idx := range []int{3, 7} {
		a := c.Allocation[i]
		rb.AssertAttribution(api, rb.Statement(c.Bridge[idx].Last), [5]frontend.Variable(a.First), [5]frontend.Variable(a.Last))
	}
	complete(api, Report, c.Report.First, c.Report.Last)
	rb.AssertInputs(api, rb.Statement(c.Bridge[0].First), c.Prep[len(c.Prep)-1].Last[3], [8]frontend.Variable(c.Combat[0].First), [8]frontend.Variable(c.Combat[len(c.Combat)-1].Last))
	rb.AssertCombinedResult(api, rb.Statement(c.Bridge[len(c.Bridge)-1].Last), rb.ReportStatement(c.Report.Last), c.Result)
	return nil
}
func TestTwoSidedAllLinks(t *testing.T) {
	chunks, allocations, bridge, report := buildTwoSided(t)
	a := &twoSidedLinks{Report: Range{report.First, report.Last}}
	for _, c := range chunks {
		r := Range{c.First, c.Last}
		if c.Phase == Preparation {
			a.Prep = append(a.Prep, r)
		} else {
			a.Combat = append(a.Combat, r)
		}
	}
	for _, s := range bridge {
		r := s.Statement()
		a.Bridge = append(a.Bridge, Range{r[:], r[:]})
	}
	for _, xs := range allocations {
		c := xs[0]
		a.Allocation = append(a.Allocation, Range{c.First, c.Last})
	}
	b := bridge[len(bridge)-1].Statement()
	a.Result = rb.Hash(rb.CompleteResultDomain, b[0], b[7], report.Last[6])
	cc := compile(t, "all-nonzero-links", a)
	check(t, cc.IsSolved(wit(t, a)))
	t.Log("all adjacency/genesis/terminal/Close/report links solved; not cryptographic authentication")
}
