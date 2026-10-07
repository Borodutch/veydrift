package resultbridge

import (
	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"testing"
)

type linkCircuit struct{ Left, Right Statement }

func (c *linkCircuit) Define(api frontend.API) error { AssertLinked(api, c.Left, c.Right); return nil }

type completeCircuit struct{ First, Last Statement }

func (c *completeCircuit) Define(api frontend.API) error {
	AssertComplete(api, c.First, c.Last)
	return nil
}

type attrLinkCircuit struct {
	Close       Statement
	First, Last attr.Statement
}

func (c *attrLinkCircuit) Define(api frontend.API) error {
	AssertAttribution(api, c.Close, c.First, c.Last)
	return nil
}

type inputLinkCircuit struct {
	Bridge      Statement
	Prepared    frontend.Variable
	First, Last [8]frontend.Variable
}

func (c *inputLinkCircuit) Define(api frontend.API) error {
	AssertInputs(api, c.Bridge, c.Prepared, c.First, c.Last)
	return nil
}
func TestNegativeSteps(t *testing.T) {
	f := build(t, []Group{group(0, 0, 0, 200, 1, 1), group(1, 1, 1, 0, 1)})
	systems := map[int]constraint.ConstraintSystem{}
	for _, w := range f.bridgeSteps {
		if systems[w.Kind] == nil {
			systems[w.Kind] = compile(t, Shape(w.Kind))
		}
		cc := systems[w.Kind]
		bad := *w
		bad.Context.Prepared.Snapshot = Z(2)
		solve(t, cc, &bad, false)
		bad = *w
		bad.Result = 1
		solve(t, cc, &bad, false)
		switch w.Kind {
		case Begin:
			bad = *w
			bad.Cohort.ID = add(w.Cohort.ID, 1)
			solve(t, cc, &bad, false)
		case Members:
			for _, mutate := range []func(*Step){func(x *Step) { x.Member.Source = Z(888) }, func(x *Step) { x.Member.Owner = Z(999) }, func(x *Step) { x.Member.Quantity = 2 }, func(x *Step) { x.Member.Tech.Weapons = 1 }, func(x *Step) { x.After.Member = x.Before.Member }} {
				bad = *w
				mutate(&bad)
				bad.AfterRoot = bad.After.Commitment()
				solve(t, cc, &bad, false)
			}
		case Units:
			for _, mutate := range []func(*Step){func(x *Step) {
				other := uint64(2)
				if number(x.Before.Unit).Uint64() == 2 {
					other = 0
				}
				x.Unit = f.m.Open(Z(other))
			}, func(x *Step) { x.Unit.Cell[6] = Z(99) }, func(x *Step) { x.Unit.Cell[5] = Z(99) }, func(x *Step) { x.Unit.Siblings[200] = 1 }, func(x *Step) { x.After.Dead = 1 }, func(x *Step) { x.After.Unit = x.Before.Unit }} {
				bad = *w
				mutate(&bad)
				bad.AfterRoot = bad.After.Commitment()
				solve(t, cc, &bad, false)
			}
		case Close:
			bad = *w
			bad.AttributionResult = 1
			solve(t, cc, &bad, false)
		case Finish:
			for _, mutate := range []func(*Step){func(x *Step) { x.Before.Cohort = Z(1) }, func(x *Step) { x.Before.Member = Z(2) }, func(x *Step) { x.Before.Unit = Z(2) }, func(x *Step) { x.Before.CohortScan = 1 }, func(x *Step) { x.Before.MemberScan = 1 }, func(x *Step) { x.Before.Survivors0 = Z(0) }} {
				bad = *w
				mutate(&bad)
				bad.After = bad.Before
				bad.After.Phase = Done
				bad.commit()
				solve(t, cc, &bad, false)
			}
		}
	}
}
func TestOmittedDuplicatedReorderedStreams(t *testing.T) {
	base := []Group{group(0, 0, 0, 200, 1, 1), group(1, 1, 1, 0, 1)}
	f := build(t, base)
	cc := compile(t, Shape(Finish))
	for _, kind := range []string{"omitted-member", "duplicate-member", "reordered-members", "omitted-cohort", "duplicated-cohort", "reordered-cohorts"} {
		t.Run(kind, func(t *testing.T) {
			groups := []Group{base[0], base[1]}
			groups[0].Members = append([]Member(nil), base[0].Members...)
			switch kind {
			case "omitted-member":
				groups[0].Members = groups[0].Members[:1]
			case "duplicate-member":
				groups[0].Members[1] = groups[0].Members[0]
			case "reordered-members":
				groups[0].Members[0], groups[0].Members[1] = groups[0].Members[1], groups[0].Members[0]
			case "omitted-cohort":
				groups = groups[:1]
			case "duplicated-cohort":
				groups[1] = groups[0]
			case "reordered-cohorts":
				groups[0], groups[1] = groups[1], groups[0]
			}
			cr, mr, n, mc := PreparedRoots(groups)
			w := *f.bridgeSteps[len(f.bridgeSteps)-1]
			w.Before.Cohort = Z(uint64(len(groups)))
			w.Before.Member = mc
			w.Before.Unit = n
			w.Before.CohortScan = cr
			w.Before.MemberScan = mr
			w.After = w.Before
			w.After.Phase = Done
			w.commit()
			solve(t, cc, &w, false)
		})
	}
}
func TestStatementObligations(t *testing.T) {
	f := build(t, []Group{group(0, 0, 0, 200, 1, 1), group(1, 1, 1, 0, 1)})
	lc := compile(t, &linkCircuit{})
	for i := 1; i < len(f.bridgeSteps); i++ {
		w := linkCircuit{f.bridgeSteps[i-1].Statement(), f.bridgeSteps[i].Statement()}
		solve(t, lc, &w, true)
		bad := w
		bad.Right = bad.Left
		solve(t, lc, &bad, false)
		if i+1 < len(f.bridgeSteps) {
			bad = w
			bad.Right = f.bridgeSteps[i+1].Statement()
			solve(t, lc, &bad, false)
		}
	}
	cc := compile(t, &completeCircuit{})
	w := completeCircuit{f.bridgeSteps[0].Statement(), f.bridgeSteps[len(f.bridgeSteps)-1].Statement()}
	solve(t, cc, &w, true)
	w.First = f.bridgeSteps[1].Statement()
	solve(t, cc, &w, false)
	ic := compile(t, &inputLinkCircuit{})
	iw := inputLinkCircuit{f.bridgeSteps[0].Statement(), f.prepSteps[len(f.prepSteps)-1].Result, [8]frontend.Variable(f.combatSteps[0].Statement()), [8]frontend.Variable(f.combatSteps[len(f.combatSteps)-1].Statement())}
	solve(t, ic, &iw, true)
	for _, field := range []int{0, 7} {
		bad := iw
		bad.Last[field] = 1
		solve(t, ic, &bad, false)
	}
	bad := iw
	bad.Prepared = 1
	solve(t, ic, &bad, false)
	ac := compile(t, &attrLinkCircuit{})
	i := 0
	for _, s := range f.bridgeSteps {
		if s.Kind != Close {
			continue
		}
		as := f.m.AttrSteps[i]
		aw := attrLinkCircuit{s.Statement(), as[0].Statement(), as[len(as)-1].Statement()}
		solve(t, ac, &aw, true)
		bad := aw
		bad.Close[8] = 1
		solve(t, ac, &bad, false)
		bad = aw
		bad.Close[9] = 1
		solve(t, ac, &bad, false)
		bad = aw
		bad.Last = f.m.AttrSteps[1-i][len(f.m.AttrSteps[1-i])-1].Statement()
		solve(t, ac, &bad, false)
		i++
	}
}
func reportRows(f fixture) []ReportRecord {
	rs := []ReportRecord{}
	for _, w := range f.combatSteps {
		if w.Kind == mb.Scan {
			alive := uint64(1)
			allzero := true
			for _, v := range w.Openings[0].Cell[mb.Hull] {
				if scalar(v).Sign() != 0 {
					allzero = false
				}
			}
			if allzero {
				alive = 0
			}
			rs = append(rs, ReportRecord{alive, w.Before[9], w.Before[10]})
		}
	}
	return rs
}
