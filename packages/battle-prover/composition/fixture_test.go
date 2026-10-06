package composition

import (
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark/frontend"
	"math/big"
	"testing"
)

func integer(v frontend.Variable) *big.Int {
	switch x := v.(type) {
	case int:
		return big.NewInt(int64(x))
	case uint64:
		return new(big.Int).SetUint64(x)
	case *big.Int:
		return x
	default:
		panic("scalar")
	}
}
func check(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}

type fixture struct {
	prep, combat, allocation, report *Chunk
	bridge                           []*rb.Step
	machine                          *rb.Machine
	combatMachine                    *mb.Machine
}

// One real positive raw roster row. Deliberately one-sided (zero shots), not an
// empty battle: preparation expands a unit, combat initializes its actual hull,
// bridge authenticates final memory, and attribution allocates its survivor.
func build(t *testing.T) fixture {
	z := p.Const
	identity := prep.Identity{Chain: z(8453), Game: z(1), Battle: z(2), Body: z(3), Incarnation: z(4), Impact: z(5), Rules: z(6), Verifier: z(7), Catalog: z(8), SeedPolicy: z(9), TargetIsMoon: 0}
	stats := p.Stats{Attack: z(20), Shield: z(5), Hull: z(100)}
	row := prep.Row{Owner: z(1), Source: z(1), Count: z(1), Side: 0, Type: 0, Tech: p.Technology{Weapons: 0, Shielding: 0, Armor: 0}}
	pm, e := prep.New(identity, []prep.Row{row}, map[uint64]p.Stats{0: stats})
	check(t, e)
	ps, e := pm.Chunk(100)
	check(t, e)
	if integer(pm.State.Phase).Int64() != prep.Done {
		t.Fatal("prep budget")
	}
	f := fixture{prep: &Chunk{Phase: Preparation, Complete: true}, combat: &Chunk{Phase: Combat, Complete: true}, allocation: &Chunk{Phase: Attribution, Complete: true}, report: &Chunk{Phase: Report, Complete: true}}
	for _, s := range ps {
		f.prep.Preparation = append(f.prep.Preparation, privateprepStep(s))
	}
	snap := mb.Big(pm.C.Commitment())
	cm, e := mb.New(mb.PreparedInput{Units: []mb.Cell{{mb.W(0), mb.W(0), mb.W(20), mb.W(5), mb.W(100), mb.W(0)}}, Snapshot: [4]uint64(snap)})
	check(t, e)
	for i := 0; i < 100 && cm.State.V[0] != mb.W(mb.Done); i++ {
		s, e := cm.Next()
		check(t, e)
		f.combat.Combat = append(f.combat.Combat, privatecombatStep(s))
	}
	if cm.State.V[0] != mb.W(mb.Done) {
		t.Fatal("combat budget")
	}
	f.combatMachine = cm
	group := rb.Group{Cohort: rb.Cohort{ID: z(0), Key: p.Key{Side: 0, Type: 0, Stats: stats}, Members: z(1), Total: z(1)}, Members: []rb.Member{{Owner: z(1), Source: z(1), Quantity: uint64(1), Tech: row.Tech}}}
	bm, e := rb.FromMachines(pm, cm, []rb.Group{group})
	check(t, e)
	f.machine = bm
	for i := 0; i < 100 && integer(bm.State.Phase).Int64() != rb.Done; i++ {
		s, e := bm.Next()
		check(t, e)
		f.bridge = append(f.bridge, s)
	}
	if integer(bm.State.Phase).Int64() != rb.Done {
		t.Fatal("bridge budget")
	}
	if len(bm.AttrSteps) != 1 {
		t.Fatal("allocation missing")
	}
	for _, s := range bm.AttrSteps[0] {
		f.allocation.Attribution = append(f.allocation.Attribution, privateattrStep(s))
	}
	rs, e := rb.ReportWitnesses(bm.Context, nil, bm.Open)
	check(t, e)
	for _, s := range rs {
		f.report.Reports = append(f.report.Reports, privatereportStep(s))
	}
	for _, c := range []*Chunk{f.prep, f.combat, f.allocation, f.report} {
		setRange(c)
	}
	// Independent simple native oracle: an uncontested unit has no loss, all hull,
	// zero rounds/shots, attacker outcome. This is not a nonzero-shot oracle claim.
	if cm.State.V[1] != mb.W(0) || cm.State.V[6] != mb.W(1) || cm.State.V[7] != mb.W(0) || cm.State.V[11] != mb.W(1) {
		t.Fatal("native outcome oracle")
	}
	rows := bm.Attributions[0].Rows
	if len(rows) != 1 || rows[0].Lost != 0 || rows[0].Survivors != 1 {
		t.Fatal("allocation oracle")
	}
	t.Logf("NONEMPTY raw_rows=1 units=1 prep=%d combat=%d attribution=%d bridge=%d report=%d lost=0 survivors=1 rounds=0 shots=0", len(ps), len(f.combat.Combat), len(f.allocation.Attribution), len(f.bridge), len(rs))
	return f
}
func setRange(c *Chunk) {
	var ss [][]frontend.Variable
	switch c.Phase {
	case Preparation:
		for _, x := range c.Preparation {
			s := x.Statement()
			ss = append(ss, s[:])
		}
	case Combat:
		for _, x := range c.Combat {
			s := x.Statement()
			ss = append(ss, s[:])
		}
	case Attribution:
		for _, x := range c.Attribution {
			s := x.Statement()
			ss = append(ss, s[:])
		}
	case Bridge:
		for _, x := range c.Bridge {
			s := x.Statement()
			ss = append(ss, s[:])
		}
	case Report:
		for _, x := range c.Reports {
			s := x.Statement()
			ss = append(ss, s[:])
		}
	}
	c.First = append([]frontend.Variable{}, ss[0]...)
	c.Last = append([]frontend.Variable{}, ss[len(ss)-1]...)
}
func TestNativeFixture(t *testing.T) { build(t) }
