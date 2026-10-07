package memorybattle

import (
	"fmt"
	"github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/frontend"
)

type U = protocol.Uint256

// Public order is versioned; positions are commitments, not truncated scalars.
type Step struct {
	Input, BeforeRoot, AfterRoot, Start, End, BeforeDone, AfterDone, Result frontend.Variable `gnark:",public"`
	Roster, RF                                                              frontend.Variable
	N                                                                       U
	Seed                                                                    [32]frontend.Variable
	Snapshot                                                                [4]frontend.Variable
	Before, After                                                           [StateSize]U
	BeforeMemory, AfterMemory, BeforeReport, AfterReport                    frontend.Variable
	Sample                                                                  protocol.SampleCircuit
	Openings                                                                []Opening
	Kind                                                                    int `gnark:"-"`
}

func Shape(k int) *Step {
	counts := []int{0, 3, 0, 1, 1, 0, 1, 2, 1, 3, 1}
	if k < Boot || k >= Done {
		panic("invalid kind")
	}
	return &Step{Kind: k, Openings: make([]Opening, counts[k])}
}
func assignment(c Context, a, b State, o []Opening) *Step {
	w := Shape(int(a.V[phase].Small()))
	w.Input = c.Commitment()
	w.BeforeRoot = a.Commitment()
	w.AfterRoot = b.Commitment()
	w.Start = position(a.V[step])
	w.End = position(b.V[step])
	w.BeforeDone = 0
	w.AfterDone = 0
	if b.V[phase] == W(Done) {
		w.AfterDone = 1
	}
	w.Result = c.Result(b)
	w.Roster = c.Roster
	w.RF = c.RF
	w.N = c.N.Circuit()
	for i, x := range c.Seed {
		w.Seed[i] = x
	}
	for i, x := range c.Snapshot {
		w.Snapshot[i] = x
	}
	for i, x := range a.V {
		w.Before[i] = x.Circuit()
		w.After[i] = b.V[i].Circuit()
	}
	w.BeforeMemory = a.Memory
	w.AfterMemory = b.Memory
	w.BeforeReport = a.Report
	w.AfterReport = b.Report
	w.Openings = o
	w.Sample = protocol.SampleCircuit{Word: protocol.Const(0), Bound: protocol.Const(1), Value: protocol.Const(0), Quotient: protocol.Const(0), MaxQuotient: U{^uint64(0), ^uint64(0), ^uint64(0), ^uint64(0)}, MaxRemainder: protocol.Const(0), Accepted: 1}
	return w
}
func (c *Step) Define(api frontend.API) error {
	if c.Kind < Boot || c.Kind >= Done || len(c.Openings) != len(Shape(c.Kind).Openings) {
		return fmt.Errorf("bad circuit shape")
	}
	ar := protocol.New(api)
	// Non-random phases have canonical advice too, avoiding free witness slots.
	if c.Kind != DrawTarget && c.Kind != Explosion && c.Kind != Rapidfire {
		ar.AssertEqual(c.Sample.Word, protocol.Const(0))
		ar.AssertEqual(c.Sample.Bound, protocol.Const(1))
		ar.AssertEqual(c.Sample.Value, protocol.Const(0))
		ar.AssertEqual(c.Sample.Quotient, protocol.Const(0))
		ar.AssertEqual(c.Sample.MaxQuotient, U{^uint64(0), ^uint64(0), ^uint64(0), ^uint64(0)})
		ar.AssertEqual(c.Sample.MaxRemainder, protocol.Const(0))
		api.AssertIsEqual(c.Sample.Accepted, 1)
	}
	z := protocol.Const(0)
	one := protocol.Const(1)
	eq := ar.Equal
	lt := ar.Less
	sel := ar.Select
	add := ar.AddChecked
	sub := ar.SubChecked
	not := func(b frontend.Variable) frontend.Variable { return api.Sub(1, b) }
	small := func(v frontend.Variable) U { return U{v, 0, 0, 0} }
	a := c.Before
	out := a
	out[step] = add(a[step], one)
	for _, arr := range [][StateSize]U{c.Before, c.After} {
		for _, w := range arr {
			for _, x := range w {
				api.ToBinary(x, 64)
			}
		}
	}
	for _, x := range c.N {
		api.ToBinary(x, 64)
	}
	for _, x := range c.Seed {
		api.ToBinary(x, 8)
	}
	for _, x := range c.Snapshot {
		api.ToBinary(x, 64)
	}
	ar.AssertEqual(a[phase], protocol.Const(uint64(c.Kind)))
	api.AssertIsEqual(lt(protocol.Const(6), a[round]), 0)
	ar.AssertEqual(a[side], small(a[side][0]))
	api.AssertIsBoolean(a[side][0])
	api.AssertIsEqual(lt(protocol.Const(2), a[outcome]), 0)
	api.AssertIsEqual(lt(c.N, a[cursor]), 0)
	api.AssertIsEqual(lt(c.N, add(a[count0], a[count1])), 0)
	initial := eq(a[step], z)
	for _, w := range a {
		for _, x := range w {
			api.AssertIsEqual(api.Mul(initial, x), 0)
		}
	}
	api.AssertIsEqual(api.Mul(initial, api.Sub(c.BeforeMemory, NewMemory().Root())), 0)
	api.AssertIsEqual(api.Mul(initial, c.BeforeReport), 0)
	api.AssertIsEqual(c.Input, ContextCommitmentCircuit(api, c.Roster, c.RF, c.N, c.Seed, c.Snapshot))
	api.AssertIsEqual(c.BeforeRoot, StateCommitmentCircuit(api, c.Before, c.BeforeMemory, c.BeforeReport))
	api.AssertIsEqual(c.AfterRoot, StateCommitmentCircuit(api, c.After, c.AfterMemory, c.AfterReport))
	pos := func(v U) frontend.Variable { return api.Select(eq(v, z), 0, hashCircuit(api, positionDomain, v[:]...)) }
	api.AssertIsEqual(c.Start, pos(a[step]))
	api.AssertIsEqual(c.End, pos(c.After[step]))
	// Zero is reserved for the actual initial step, even if a nonzero
	// position commitment were ever zero. No unproved prefix may anchor here.
	api.AssertIsEqual(api.IsZero(c.Start), initial)
	api.AssertIsEqual(api.IsZero(c.End), eq(c.After[step], z))
	api.AssertIsEqual(c.BeforeDone, 0)
	api.AssertIsEqual(c.AfterDone, eq(c.After[phase], protocol.Const(Done)))
	api.AssertIsEqual(c.Result, api.Mul(c.AfterDone, ResultCommitmentCircuit(api, c.Input, c.AfterMemory, c.AfterReport, c.After[round], c.After[count0], c.After[count1], c.After[outcome])))
	memory := c.BeforeMemory
	report := c.BeforeReport
	validUnit := func(u CircuitCell) {
		ar.AssertEqual(u[Side], small(u[Side][0]))
		api.AssertIsBoolean(u[Side][0])
		ar.AssertEqual(u[Type], small(u[Type][0]))
		api.ToBinary(u[Type][0], 16)
		api.AssertIsEqual(eq(u[MaxHull], z), 0)
		ar.AssertEqual(u[Pool], small(u[Pool][0]))
		api.AssertIsBoolean(u[Pool][0])
		api.AssertIsEqual(lt(u[MaxHull], u[Hull]), 0)
		api.AssertIsEqual(lt(u[MaxShield], u[Shield]), 0)
	}
	read := func(k int, i U) CircuitCell {
		api.AssertIsEqual(lt(i, c.N), 1)
		c.Openings[k].constrain(api, c.BeforeMemory, UnitDomain, i)
		u := c.Openings[k].Cell
		validUnit(u)
		return u
	}
	write := func(k int, i U, u CircuitCell) {
		c.Openings[k].write(api, c.AfterMemory, UnitDomain, i, u)
		memory = c.AfterMemory
	}
	scan := func(next uint64) {
		n := add(a[cursor], one)
		last := eq(n, c.N)
		out[cursor] = sel(last, z, n)
		out[phase] = sel(last, protocol.Const(next), a[phase])
	}
	switch c.Kind {
	case Boot:
		ar.AssertEqual(a[step], z)
		out[phase] = sel(eq(c.N, z), protocol.Const(Ready), protocol.Const(Init))
	case Init:
		i := a[cursor]
		api.AssertIsEqual(lt(i, c.N), 1)
		c.Openings[0].constrain(api, c.BeforeMemory, UnitDomain, i)
		for _, w := range c.Openings[0].Cell {
			ar.AssertEqual(w, z)
		}
		c.Openings[1].constrain(api, c.Roster, RosterDomain, i)
		u := c.Openings[1].Cell
		first := eq(i, z)
		prevIndex := sub(i, small(not(first)))
		c.Openings[2].constrain(api, c.Roster, RosterDomain, prevIndex)
		prev := c.Openings[2].Cell
		var same frontend.Variable = 1
		var ordered frontend.Variable = 0
		for j := Side; j <= MaxHull; j++ {
			ordered = api.Add(ordered, api.Mul(same, lt(prev[j], u[j])))
			same = api.Mul(same, eq(prev[j], u[j]))
		}
		api.AssertIsEqual(api.Add(same, ordered), 1)
		ar.AssertEqual(u[Cohort], sel(first, z, add(prev[Cohort], small(not(same)))))
		validUnit(u)
		for _, j := range []int{Hull, Shield, Pool} {
			ar.AssertEqual(u[j], z)
		}
		u[Hull] = u[MaxHull]
		u[Shield] = u[MaxShield]
		u[Pool] = one
		write(0, i, u)
		out[count0] = add(a[count0], small(not(u[Side][0])))
		out[count1] = add(a[count1], u[Side])
		scan(Ready)
	case Ready:
		terminal := api.Or(api.Or(eq(a[count0], z), eq(a[count1], z)), eq(a[round], protocol.Const(6)))
		out[phase] = sel(terminal, protocol.Const(Done), protocol.Const(Reset))
		out[cursor] = sel(terminal, a[cursor], z)
		out[round] = add(a[round], small(not(terminal)))
		out[side] = sel(terminal, a[side], z)
		out[shots0] = sel(terminal, a[shots0], z)
		out[shots1] = sel(terminal, a[shots1], z)
		winner := api.Add(api.Mul(not(eq(a[count0], z)), eq(a[count1], z)), api.Mul(2, not(eq(a[count1], z)), eq(a[count0], z)))
		out[outcome] = sel(terminal, small(winner), a[outcome])
	case Reset:
		u := read(0, a[cursor])
		u[Shield] = sel(u[Pool][0], u[MaxShield], u[Shield])
		write(0, a[cursor], u)
		scan(FindShooter)
	case FindShooter:
		end := eq(a[cursor], c.N)
		u := read(0, sel(end, z, a[cursor]))
		found := api.Mul(not(end), u[Pool][0], eq(u[Side], a[side]))
		finished := api.Mul(end, a[side][0])
		out[shooter] = sel(found, a[cursor], a[shooter])
		out[cursor] = sel(end, z, add(a[cursor], small(api.Mul(not(end), not(found)))))
		out[side] = sel(end, one, a[side])
		out[phase] = sel(finished, protocol.Const(Scan), sel(found, protocol.Const(DrawTarget), a[phase]))
		out[count0] = sel(finished, z, a[count0])
		out[count1] = sel(finished, z, a[count1])
	case DrawTarget:
		bound := sel(a[side][0], a[count0], a[count1])
		x, ok := c.draw(api, ar, &out, bound, 1)
		out[rank] = sel(ok, x, a[rank])
		out[cursor] = sel(ok, z, a[cursor])
		out[phase] = sel(ok, protocol.Const(FindTarget), a[phase])
	case FindTarget:
		u := read(0, a[cursor])
		eligible := api.Mul(u[Pool][0], eq(u[Side], small(not(a[side][0]))))
		found := api.Mul(eligible, eq(a[rank], z))
		out[target] = sel(found, a[cursor], a[target])
		out[phase] = sel(found, protocol.Const(Damage), a[phase])
		out[cursor] = add(a[cursor], small(not(found)))
		out[rank] = sub(a[rank], small(api.Mul(eligible, not(found))))
		out[shots0] = add(a[shots0], small(api.Mul(found, not(a[side][0]))))
		out[shots1] = add(a[shots1], small(api.Mul(found, a[side][0])))
	case Damage:
		u := read(0, a[target])
		sh := read(1, a[shooter])
		ar.AssertEqual(sh[Pool], one)
		ar.AssertEqual(sh[Side], a[side])
		ar.AssertEqual(u[Pool], one)
		ar.AssertEqual(u[Side], small(not(a[side][0])))
		hull, shield, explode := damage(api, ar, sh[Attack], u)
		u[Hull] = hull
		u[Shield] = shield
		write(0, a[target], u)
		out[phase] = sel(explode, protocol.Const(Explosion), protocol.Const(Rapidfire))
	case Explosion:
		u := read(0, a[target])
		x, ok := c.draw(api, ar, &out, u[MaxHull], 1)
		kill := api.Mul(ok, lt(x, sub(u[MaxHull], u[Hull])))
		u[Hull] = sel(kill, z, u[Hull])
		write(0, a[target], u)
		out[phase] = sel(ok, protocol.Const(Rapidfire), a[phase])
	case Rapidfire:
		u := read(0, a[target])
		sh := read(1, a[shooter])
		lane := small(api.Add(api.Mul(sh[Type][0], 65536), u[Type][0]))
		c.Openings[2].constrain(api, c.RF, RFDomain, lane)
		rfCell := c.Openings[2].Cell
		api.AssertIsEqual(lt(protocol.Const(65534), rfCell[0]), 0)
		for _, w := range rfCell[1:] {
			ar.AssertEqual(w, z)
		}
		rf := add(rfCell[0], one)
		enabled := not(eq(rf, one))
		x, ok := c.draw(api, ar, &out, rf, enabled)
		accepted := api.Or(not(enabled), ok)
		again := api.Mul(enabled, not(eq(x, z)))
		out[phase] = sel(accepted, sel(again, protocol.Const(DrawTarget), protocol.Const(FindShooter)), a[phase])
		out[cursor] = sel(api.Mul(accepted, not(again)), add(a[shooter], one), a[cursor])
	case Scan:
		u := read(0, a[cursor])
		u[Pool] = small(not(eq(u[Hull], z)))
		write(0, a[cursor], u)
		out[count0] = add(a[count0], small(api.Mul(u[Pool][0], not(u[Side][0]))))
		out[count1] = add(a[count1], small(api.Mul(u[Pool][0], u[Side][0])))
		scan(Ready)
		report = hashCircuit(api, reportDomain, append([]frontend.Variable{c.BeforeReport}, flatten(a[round], a[cursor], u[Cohort], u[Pool], a[shots0], a[shots1])...)...)
	}
	api.AssertIsEqual(c.AfterMemory, memory)
	api.AssertIsEqual(c.AfterReport, report)
	for i, w := range out {
		ar.AssertEqual(c.After[i], w)
	}
	return nil
}
