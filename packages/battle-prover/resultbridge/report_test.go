package resultbridge

import (
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"math/big"
	"testing"
)

type reportLinkCircuit struct{ Left, Right ReportStatement }

func (c *reportLinkCircuit) Define(api frontend.API) error {
	AssertReportLinked(api, c.Left, c.Right)
	return nil
}

type reportCompleteCircuit struct{ First, Last ReportStatement }

func (c *reportCompleteCircuit) Define(api frontend.API) error {
	AssertReportComplete(api, c.First, c.Last)
	return nil
}

type combinedCircuit struct {
	Bridge Statement
	Report ReportStatement
	Result frontend.Variable
}

func (c *combinedCircuit) Define(api frontend.API) error {
	AssertCombinedResult(api, c.Bridge, c.Report, c.Result)
	return nil
}
func TestReportProjection(t *testing.T) {
	cc := compile(t, ReportShape(0))
	ec := compile(t, ReportShape(1))
	lc := compile(t, &reportLinkCircuit{})
	fc := compile(t, &reportCompleteCircuit{})
	bc := compile(t, &combinedCircuit{})
	for _, groups := range [][]Group{{group(0, 0, 0, 200, 1, 1), group(1, 1, 1, 0, 1)}, {group(0, 0, 0, 0, 1), group(1, 1, 1, 0, 1)}, {group(0, 1, 0, 0, 1)}, {}} {
		f := build(t, groups)
		ws, e := ReportWitnesses(f.m.Context, reportRows(f), f.m.Open)
		if e != nil {
			t.Fatal(e)
		}
		for i, w := range ws {
			c := cc
			if w.Kind == 1 {
				c = ec
			}
			solve(t, c, w, true)
			bad := *w
			bad.Context.Combat.Report = 1
			solve(t, c, &bad, false)
			if w.Kind == 0 {
				bad = *w
				bad.Alive = 1 - scalar(w.Alive).Int64()
				solve(t, c, &bad, false)
				bad = *w
				bad.Unit.Cell[5] = Z(999)
				solve(t, c, &bad, false)
				bad = *w
				bad.Shots0 = add(w.Shots0, 1)
				solve(t, c, &bad, false)
			}
			if i > 0 {
				link := reportLinkCircuit{ws[i-1].Statement(), w.Statement()}
				solve(t, lc, &link, true)
				link.Right = link.Left
				solve(t, lc, &link, false)
			}
		}
		complete := reportCompleteCircuit{ws[0].Statement(), ws[len(ws)-1].Statement()}
		solve(t, fc, &complete, true)
		bridge := f.bridgeSteps[len(f.bridgeSteps)-1].Statement()
		last := ws[len(ws)-1].Statement()
		combined := combinedCircuit{bridge, last, Hash(CompleteResultDomain, bridge[0], bridge[7], last[6])}
		solve(t, bc, &combined, true)
		combined.Report[0] = 1
		solve(t, bc, &combined, false)
		if len(ws) > 1 {
			rows := reportRows(f)
			if _, e = ReportWitnesses(f.m.Context, rows[:len(rows)-1], f.m.Open); e == nil {
				t.Fatal("omitted report record accepted")
			}
			if _, e = ReportWitnesses(f.m.Context, append(rows, rows[0]), f.m.Open); e == nil {
				t.Fatal("extra report record accepted")
			}
			rows[0].Shots0 = add(rows[0].Shots0, 1)
			badws, e := ReportWitnesses(f.m.Context, rows, f.m.Open)
			if e != nil {
				t.Fatal(e)
			}
			solve(t, cc, badws[len(badws)-1], false)
		}
	}
}
func TestValidHighWidthInputs(t *testing.T) {
	g := group(0, 0, 0, 0, 1)
	g.Cohort.Key.Stats.Hull = p.MustValue(new(big.Int).Lsh(big.NewInt(1), 200))
	g.Members[0].Source = p.MustValue(new(big.Int).Add(new(big.Int).Lsh(big.NewInt(1), 255), big.NewInt(19)))
	g.Members[0].Owner = p.MustValue(new(big.Int).Lsh(big.NewInt(1), 159))
	f := build(t, []Group{g})
	systems := map[int]constraint.ConstraintSystem{}
	for _, w := range f.bridgeSteps {
		if systems[w.Kind] == nil {
			systems[w.Kind] = compile(t, Shape(w.Kind))
		}
		solve(t, systems[w.Kind], w, true)
	}
}
