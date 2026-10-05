package memorybattle

import (
	"fmt"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/math/cmp"
	"math/big"
)

// Eight fixed public scalars; Kind selects a roster-independent elementary key.
type Step struct {
	Context, BeforeRoot, AfterRoot, Start, End, BeforeDone, AfterDone, Result frontend.Variable `gnark:",public"`
	Roster, RF, N                                                             frontend.Variable
	Seed                                                                      [32]frontend.Variable
	Snapshot                                                                  [4]frontend.Variable
	Before, After                                                             [StateSize]frontend.Variable
	BeforeMemory, AfterMemory, BeforeReport, AfterReport                      frontend.Variable
	Openings                                                                  []Opening
	Kind                                                                      int `gnark:"-"`
}

func Shape(kind int) *Step {
	counts := []int{0, 3, 0, 1, 1, 0, 1, 2, 1, 3, 1}
	if kind < Boot || kind >= Done {
		panic("invalid elementary kind")
	}
	return &Step{Kind: kind, Openings: make([]Opening, counts[kind])}
}
func assignment(c Context, a, b State, o []Opening) *Step {
	w := Shape(int(a.V[phase]))
	w.Context = c.Commitment()
	w.BeforeRoot = a.Commitment()
	w.AfterRoot = b.Commitment()
	w.Start = a.V[step]
	w.End = b.V[step]
	w.BeforeDone = 0
	w.AfterDone = 0
	if b.V[phase] == Done {
		w.AfterDone = 1
	}
	w.Result = c.Result(b)
	w.Roster = c.Roster
	w.RF = c.RF
	w.N = c.N
	for i, x := range c.Seed {
		w.Seed[i] = x
	}
	for i, x := range c.Snapshot {
		w.Snapshot[i] = x
	}
	for i, x := range a.V {
		w.Before[i] = x
	}
	for i, x := range b.V {
		w.After[i] = x
	}
	w.BeforeMemory = a.Memory
	w.AfterMemory = b.Memory
	w.BeforeReport = a.Report
	w.AfterReport = b.Report
	w.Openings = o
	return w
}
func (c *Step) Define(api frontend.API) error {
	if c.Kind < Boot || c.Kind >= Done || len(c.Openings) != len(Shape(c.Kind).Openings) {
		return fmt.Errorf("invalid circuit shape")
	}
	eq := func(a, b frontend.Variable) frontend.Variable { return api.IsZero(api.Sub(a, b)) }
	not := func(x frontend.Variable) frontend.Variable { return api.Sub(1, x) }
	lt := cmp.NewBoundedComparator(api, new(big.Int).Lsh(big.NewInt(1), 80), false).IsLess
	a := c.Before
	out := a
	out[step] = api.Add(a[step], 1)
	for _, x := range a {
		api.ToBinary(x, 64)
	}
	for _, x := range c.After {
		api.ToBinary(x, 64)
	}
	api.ToBinary(c.N, 64)
	for _, x := range c.Seed {
		api.ToBinary(x, 8)
	}
	for _, x := range c.Snapshot {
		api.ToBinary(x, 64)
	}
	api.AssertIsEqual(a[phase], c.Kind)
	api.AssertIsLessOrEqual(a[round], 6)
	api.AssertIsBoolean(a[side])
	api.AssertIsLessOrEqual(a[outcome], 2)
	api.AssertIsLessOrEqual(a[cursor], c.N)
	api.AssertIsLessOrEqual(api.Add(a[count0], a[count1]), c.N)
	initial := eq(a[step], 0)
	for _, x := range a {
		api.AssertIsEqual(api.Mul(initial, x), 0)
	}
	api.AssertIsEqual(api.Mul(initial, api.Sub(c.BeforeMemory, NewMemory().Root())), 0)
	api.AssertIsEqual(api.Mul(initial, c.BeforeReport), 0)
	contextValues := []frontend.Variable{c.Roster, c.RF, c.N, 2}
	contextValues = append(contextValues, c.Seed[:]...)
	contextValues = append(contextValues, c.Snapshot[:]...)
	api.AssertIsEqual(c.Context, hashCircuit(api, contextDomain, contextValues...))
	commit := func(v [StateSize]frontend.Variable, m, r frontend.Variable) frontend.Variable {
		return hashCircuit(api, stateDomain, append([]frontend.Variable{m, r}, v[:]...)...)
	}
	api.AssertIsEqual(c.BeforeRoot, commit(c.Before, c.BeforeMemory, c.BeforeReport))
	api.AssertIsEqual(c.AfterRoot, commit(c.After, c.AfterMemory, c.AfterReport))
	api.AssertIsEqual(c.Start, a[step])
	api.AssertIsEqual(c.End, c.After[step])
	api.AssertIsEqual(c.BeforeDone, 0)
	api.AssertIsEqual(c.AfterDone, eq(c.After[phase], Done))
	result := hashCircuit(api, resultDomain, c.Context, c.AfterMemory, c.AfterReport, c.After[round], c.After[count0], c.After[count1], c.After[outcome])
	api.AssertIsEqual(c.Result, api.Mul(c.AfterDone, result))
	memory := c.BeforeMemory
	report := c.BeforeReport
	validUnit := func(u [Width]frontend.Variable) {
		api.AssertIsBoolean(u[Side])
		api.ToBinary(u[Type], 16)
		api.AssertIsDifferent(u[MaxHull], 0)
		api.AssertIsBoolean(u[Pool])
		api.AssertIsLessOrEqual(u[Hull], u[MaxHull])
		api.AssertIsLessOrEqual(u[Shield], u[MaxShield])
	}
	read := func(k int, index frontend.Variable) [Width]frontend.Variable {
		api.AssertIsEqual(lt(index, c.N), 1)
		c.Openings[k].constrain(api, c.BeforeMemory, index)
		u := c.Openings[k].Cell
		validUnit(u)
		return u
	}
	write := func(k int, index frontend.Variable, u [Width]frontend.Variable) {
		c.Openings[k].write(api, c.AfterMemory, index, u)
		memory = c.AfterMemory
	}
	advanceScan := func(next int) {
		last := eq(api.Add(a[cursor], 1), c.N)
		out[cursor] = api.Select(last, 0, api.Add(a[cursor], 1))
		out[phase] = api.Select(last, next, c.Kind)
	}
	switch c.Kind {
	case Boot:
		api.AssertIsEqual(a[step], 0)
		out[phase] = api.Select(eq(c.N, 0), Ready, Init)
	case Init:
		i := a[cursor]
		api.AssertIsEqual(lt(i, c.N), 1)
		c.Openings[0].constrain(api, c.BeforeMemory, i)
		for _, x := range c.Openings[0].Cell {
			api.AssertIsEqual(x, 0)
		}
		c.Openings[1].constrain(api, c.Roster, i)
		u := c.Openings[1].Cell
		first := eq(i, 0)
		previousIndex := api.Select(first, 0, api.Sub(i, 1))
		c.Openings[2].constrain(api, c.Roster, previousIndex)
		previous := c.Openings[2].Cell
		var same frontend.Variable = 1
		var ordered frontend.Variable = 0
		for j := Side; j <= MaxHull; j++ {
			ordered = api.Add(ordered, api.Mul(same, lt(previous[j], u[j])))
			same = api.Mul(same, eq(previous[j], u[j]))
		}
		api.AssertIsEqual(api.Add(same, ordered), 1)
		api.AssertIsEqual(u[Cohort], api.Select(first, 0, api.Add(previous[Cohort], not(same))))
		validUnit(u)
		for _, j := range []int{Hull, Shield, Pool} {
			api.AssertIsEqual(u[j], 0)
		}
		u[Hull] = u[MaxHull]
		u[Shield] = u[MaxShield]
		u[Pool] = 1
		write(0, i, u)
		out[count0] = api.Add(a[count0], not(u[Side]))
		out[count1] = api.Add(a[count1], u[Side])
		advanceScan(Ready)
	case Ready:
		terminal := api.Or(api.Or(eq(a[count0], 0), eq(a[count1], 0)), eq(a[round], 6))
		out[phase] = api.Select(terminal, Done, Reset)
		out[cursor] = api.Select(terminal, a[cursor], 0)
		out[round] = api.Add(a[round], not(terminal))
		out[side] = api.Select(terminal, a[side], 0)
		out[shots0] = api.Select(terminal, a[shots0], 0)
		out[shots1] = api.Select(terminal, a[shots1], 0)
		winner := api.Add(api.Mul(not(eq(a[count0], 0)), eq(a[count1], 0)), api.Mul(2, not(eq(a[count1], 0)), eq(a[count0], 0)))
		out[outcome] = api.Select(terminal, winner, a[outcome])
	case Reset:
		u := read(0, a[cursor])
		u[Shield] = api.Select(u[Pool], u[MaxShield], u[Shield])
		write(0, a[cursor], u)
		advanceScan(FindShooter)
	case FindShooter:
		end := eq(a[cursor], c.N)
		i := api.Select(end, 0, a[cursor])
		u := read(0, i)
		found := api.Mul(not(end), u[Pool], eq(u[Side], a[side]))
		finished := api.Mul(end, a[side])
		out[shooter] = api.Select(found, a[cursor], a[shooter])
		out[cursor] = api.Select(end, 0, api.Select(found, a[cursor], api.Add(a[cursor], 1)))
		out[side] = api.Select(end, 1, a[side])
		out[phase] = api.Select(finished, Scan, api.Select(found, DrawTarget, FindShooter))
		out[count0] = api.Select(finished, 0, a[count0])
		out[count1] = api.Select(finished, 0, a[count1])
	case DrawTarget:
		bound := api.Select(a[side], a[count0], a[count1])
		x, ok := c.draw(api, &out, bound, 1)
		out[rank] = api.Select(ok, x, a[rank])
		out[cursor] = api.Select(ok, 0, a[cursor])
		out[phase] = api.Select(ok, FindTarget, DrawTarget)
	case FindTarget:
		u := read(0, a[cursor])
		eligible := api.Mul(u[Pool], eq(u[Side], not(a[side])))
		found := api.Mul(eligible, eq(a[rank], 0))
		out[target] = api.Select(found, a[cursor], a[target])
		out[phase] = api.Select(found, Damage, FindTarget)
		out[cursor] = api.Select(found, a[cursor], api.Add(a[cursor], 1))
		out[rank] = api.Sub(a[rank], api.Mul(eligible, not(found)))
		out[shots0] = api.Add(a[shots0], api.Mul(found, not(a[side])))
		out[shots1] = api.Add(a[shots1], api.Mul(found, a[side]))
	case Damage:
		u := read(0, a[target])
		sh := read(1, a[shooter])
		api.AssertIsEqual(sh[Pool], 1)
		api.AssertIsEqual(sh[Side], a[side])
		api.AssertIsEqual(u[Pool], 1)
		api.AssertIsEqual(u[Side], not(a[side]))
		attack := sh[Attack]
		bounce := api.Mul(not(eq(u[Shield], 0)), lt(api.Mul(attack, 100), u[MaxShield]))
		hit := api.Mul(not(eq(u[Hull], 0)), not(bounce))
		absorbed := api.Select(lt(attack, u[Shield]), attack, u[Shield])
		damage := api.Sub(attack, absorbed)
		hull := api.Select(lt(damage, u[Hull]), api.Sub(u[Hull], damage), 0)
		explode := api.Mul(hit, not(eq(hull, 0)), not(eq(attack, 0)), lt(api.Mul(u[MaxHull], 3), api.Mul(api.Sub(u[MaxHull], hull), 10)))
		u[Hull] = api.Select(hit, hull, u[Hull])
		u[Shield] = api.Select(hit, api.Sub(u[Shield], absorbed), u[Shield])
		write(0, a[target], u)
		out[phase] = api.Select(explode, Explosion, Rapidfire)
	case Explosion:
		u := read(0, a[target])
		x, ok := c.draw(api, &out, u[MaxHull], 1)
		kill := api.Mul(ok, lt(x, api.Sub(u[MaxHull], u[Hull])))
		u[Hull] = api.Select(kill, 0, u[Hull])
		write(0, a[target], u)
		out[phase] = api.Select(ok, Rapidfire, Explosion)
	case Rapidfire:
		u := read(0, a[target])
		sh := read(1, a[shooter])
		lane := api.Add(api.Mul(sh[Type], 65536), u[Type])
		c.Openings[2].constrain(api, c.RF, lane)
		rfCell := c.Openings[2].Cell
		api.AssertIsLessOrEqual(rfCell[0], 65534)
		for _, x := range rfCell[1:] {
			api.AssertIsEqual(x, 0)
		}
		rf := api.Add(rfCell[0], 1)
		enabled := not(eq(rf, 1))
		x, ok := c.draw(api, &out, rf, enabled)
		accepted := api.Or(not(enabled), ok)
		again := api.Mul(enabled, not(eq(x, 0)))
		out[phase] = api.Select(accepted, api.Select(again, DrawTarget, FindShooter), Rapidfire)
		out[cursor] = api.Select(api.Mul(accepted, not(again)), api.Add(a[shooter], 1), a[cursor])
	case Scan:
		u := read(0, a[cursor])
		u[Pool] = not(eq(u[Hull], 0))
		write(0, a[cursor], u)
		out[count0] = api.Add(a[count0], api.Mul(u[Pool], not(u[Side])))
		out[count1] = api.Add(a[count1], api.Mul(u[Pool], u[Side]))
		advanceScan(Ready)
		report = hashCircuit(api, reportDomain, c.BeforeReport, a[round], a[cursor], u[Cohort], u[Pool], a[shots0], a[shots1])
	}
	api.AssertIsEqual(c.AfterMemory, memory)
	api.AssertIsEqual(c.AfterReport, report)
	for i, x := range out {
		api.AssertIsEqual(c.After[i], x)
	}
	return nil
}
