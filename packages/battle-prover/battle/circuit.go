package battle

import (
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/hash/sha2"
	"github.com/consensys/gnark/std/math/cmp"
	"github.com/consensys/gnark/std/math/uints"
	"math/big"
)

// Step proves one elementary operation with complete public memory endpoints.
// Config and RNG/non-RNG circuit kind are pinned in the verification key.
// Hashing only in RNG keys avoids paying two SHA blocks for scans and hits.
type Step struct {
	Context       [32]frontend.Variable        `gnark:",public"`
	Seed          [32]frontend.Variable        `gnark:",public"`
	Before, After [StateSize]frontend.Variable `gnark:",public"`
	Config        Config                       `gnark:"-"`
	RNG           bool                         `gnark:"-"`
}

func Assignment(c Config, seed [32]byte, a, b State, rng bool) *Step {
	w := &Step{Config: c, RNG: rng}
	for i, v := range c.Digest() {
		w.Context[i] = v
	}
	for i, v := range seed {
		w.Seed[i] = v
	}
	for i, v := range a.Values() {
		w.Before[i] = v
	}
	for i, v := range b.Values() {
		w.After[i] = v
	}
	return w
}
func IsRandom(c Config, s State) bool {
	return s.Phase == Target || s.Phase == Explosion || s.Phase == Rapidfire && c.RF[s.Shooter][s.Target] > 1
}
func (c *Step) Define(api frontend.API) error {
	if err := c.Config.Validate(); err != nil {
		return err
	}
	for i, b := range c.Config.Digest() {
		api.AssertIsEqual(c.Context[i], b)
	}
	for _, b := range c.Seed {
		api.ToBinary(b, 8)
	}
	a := c.Before
	out := a
	eq := func(x, y frontend.Variable) frontend.Variable { return api.IsZero(api.Sub(x, y)) }
	not := func(x frontend.Variable) frontend.Variable { return api.Sub(1, x) }
	and := func(x, y frontend.Variable) frontend.Variable { return api.Mul(x, y) }
	comparator := cmp.NewBoundedComparator(api, new(big.Int).Lsh(big.NewInt(1), 48), false)
	lt := comparator.IsLess
	for _, v := range a {
		api.ToBinary(v, 64)
	}
	for _, v := range c.After {
		api.ToBinary(v, 64)
	}
	api.AssertIsLessOrEqual(a[0], Done)
	api.AssertIsLessOrEqual(a[1], 6)
	api.AssertIsBoolean(a[2])
	for _, i := range []int{3, 4, 5} {
		api.AssertIsLessOrEqual(a[i], Slots-1)
	}
	for i := 0; i < Slots; i++ {
		api.AssertIsLessOrEqual(a[8+i], c.Config.Stat(i, 2))
		api.AssertIsLessOrEqual(a[12+i], c.Config.Stat(i, 1))
		api.AssertIsBoolean(a[16+i])
	}
	for i := 34; i < 58; i++ {
		api.AssertIsBoolean(a[i])
	}
	api.AssertIsLessOrEqual(a[58], 2)
	// Initialization is not a supplied initial-state commitment: step zero must be
	// the all-zero machine. Linked verification additionally requires this anchor.
	initial := eq(a[7], 0)
	for _, v := range a {
		api.AssertIsEqual(api.Mul(initial, v), 0)
	}
	phase := func(p int) frontend.Variable { return eq(a[0], p) }
	set := func(index int, condition, value frontend.Variable) {
		out[index] = api.Select(condition, value, out[index])
	}
	selectAt := func(index frontend.Variable, values []frontend.Variable) frontend.Variable {
		var result frontend.Variable = 0
		for i, v := range values {
			result = api.Add(result, api.Mul(eq(index, i), v))
		}
		return result
	}
	stats := func(index frontend.Variable, j int) frontend.Variable {
		v := make([]frontend.Variable, Slots)
		for i := range v {
			v[i] = c.Config.Stat(i, j)
		}
		return selectAt(index, v)
	}
	var count [2]frontend.Variable
	count[0] = 0
	count[1] = 0
	for i, u := range c.Config.Units {
		count[u.Side] = api.Add(count[u.Side], a[16+i])
	}
	first := func(side frontend.Variable) frontend.Variable {
		var result frontend.Variable = 0
		for i := Slots - 1; i >= 0; i-- {
			eligible := and(eq(side, c.Config.Units[i].Side), a[16+i])
			result = api.Select(eligible, i, result)
		}
		return result
	}
	var rf frontend.Variable = 0
	for i := 0; i < Slots; i++ {
		for j := 0; j < Slots; j++ {
			rf = api.Add(rf, api.Mul(eq(a[3], i), eq(a[4], j), c.Config.RF[i][j]))
		}
	}
	random := api.Add(phase(Target), phase(Explosion), and(phase(Rapidfire), not(eq(rf, 1))))
	if c.RNG {
		api.AssertIsEqual(random, 1)
	} else {
		api.AssertIsEqual(random, 0)
	}
	set(7, not(phase(Done)), api.Add(a[7], 1))
	// Initialization/reset/round-start scans are resumable, one slot per step.
	last := eq(a[5], Slots-1)
	set(5, phase(Init), api.Select(last, 0, api.Add(a[5], 1)))
	set(0, and(phase(Init), last), Reset)
	terminal := api.Or(api.Or(eq(count[0], 0), eq(count[1], 0)), eq(a[1], 6))
	reset := and(phase(Reset), not(terminal))
	set(0, and(phase(Reset), terminal), Done)
	outcome := api.Add(and(not(eq(count[0], 0)), eq(count[1], 0)), api.Mul(2, and(not(eq(count[1], 0)), eq(count[0], 0))))
	set(58, and(phase(Reset), terminal), outcome)
	set(5, reset, api.Select(last, 0, api.Add(a[5], 1)))
	start := and(reset, last)
	set(1, start, api.Add(a[1], 1))
	set(2, start, 0)
	set(3, start, first(0))
	set(20, start, 0)
	set(21, start, 0)
	set(0, start, Target)
	for i := 0; i < Slots; i++ {
		at := eq(a[5], i)
		initialize := and(phase(Init), at)
		set(8+i, initialize, c.Config.Stat(i, 2))
		set(12+i, api.Or(initialize, api.Mul(reset, at, a[16+i])), c.Config.Stat(i, 1))
		set(16+i, initialize, 1)
		set(16+i, and(phase(Scan), at), not(eq(a[8+i], 0)))
	}
	set(5, phase(Scan), api.Select(last, 0, api.Add(a[5], 1)))
	set(0, and(phase(Scan), last), Reset)
	if c.RNG {
		bound := api.Select(phase(Target), api.Select(a[2], count[0], count[1]), api.Select(phase(Explosion), stats(a[4], 2), rf))
		api.AssertIsDifferent(bound, 0)
		api.ToBinary(bound, 32)
		h, err := sha2.New(api)
		if err != nil {
			return err
		}
		bytes, err := uints.NewBytes(api)
		if err != nil {
			return err
		}
		input := uints.NewU8Array([]byte(Rules + ":random:"))
		for _, b := range c.Seed {
			input = append(input, bytes.ValueOf(b))
		}
		counterBits := api.ToBinary(a[6], 64)
		for i := 0; i < 24; i++ {
			input = append(input, uints.NewU8(0))
		}
		for i := 7; i >= 0; i-- {
			input = append(input, bytes.ValueOf(api.FromBinary(counterBits[i*8:(i+1)*8]...)))
		}
		h.Write(input)
		digest := h.Sum()
		bits := make([]frontend.Variable, 0, 256)
		for i := 31; i >= 0; i-- {
			bits = append(bits, api.ToBinary(bytes.Value(digest[i]), 8)...)
		}
		remainder, accepted := uniformWord(api, bits, bound)
		set(6, 1, api.Add(a[6], 1))
		targetOK := and(phase(Target), accepted)
		var rank frontend.Variable = 0
		var selected frontend.Variable = 0
		for i, u := range c.Config.Units {
			eligible := and(eq(api.Sub(1, a[2]), u.Side), a[16+i])
			pick := and(eligible, eq(rank, remainder))
			selected = api.Add(selected, api.Mul(pick, i))
			rank = api.Add(rank, eligible)
		}
		set(4, targetOK, selected)
		set(0, targetOK, Damage)
		set(20, and(targetOK, eq(a[2], 0)), api.Add(a[20], 1))
		set(21, and(targetOK, eq(a[2], 1)), api.Add(a[21], 1))
		explosionOK := and(phase(Explosion), accepted)
		missing := api.Sub(stats(a[4], 2), selectAt(a[4], a[8:12]))
		explode := and(explosionOK, lt(remainder, missing))
		for i := 0; i < Slots; i++ {
			set(8+i, and(explode, eq(a[4], i)), 0)
		}
		set(0, explosionOK, Rapidfire)
		set(0, and(phase(Rapidfire), accepted), api.Select(eq(remainder, 0), Advance, Target))
	}
	// Damage always reads current hull/shield at the authenticated target index.
	attack := stats(a[3], 0)
	hull := selectAt(a[4], a[8:12])
	shield := selectAt(a[4], a[12:16])
	maxHull := stats(a[4], 2)
	maxShield := stats(a[4], 1)
	bounce := and(not(eq(shield, 0)), lt(api.Mul(attack, 100), maxShield))
	hit := api.Mul(phase(Damage), not(eq(hull, 0)), not(bounce))
	absorbed := api.Select(lt(attack, shield), attack, shield)
	damage := api.Sub(attack, absorbed)
	afterHull := api.Select(lt(damage, hull), api.Sub(hull, damage), 0)
	checkExplosion := api.Mul(hit, not(eq(afterHull, 0)), not(eq(attack, 0)), lt(api.Mul(maxHull, 3), api.Mul(api.Sub(maxHull, afterHull), 10)))
	for i := 0; i < Slots; i++ {
		at := and(hit, eq(a[4], i))
		set(8+i, at, afterHull)
		set(12+i, at, api.Sub(shield, absorbed))
	}
	set(0, phase(Damage), api.Select(checkExplosion, Explosion, Rapidfire))
	set(0, and(phase(Rapidfire), eq(rf, 1)), Advance)
	var found frontend.Variable = 0
	var next frontend.Variable = 0
	for i := Slots - 1; i >= 0; i-- {
		eligible := api.Mul(eq(a[2], c.Config.Units[i].Side), a[16+i], lt(a[3], i))
		next = api.Select(eligible, i, next)
		found = api.Or(found, eligible)
	}
	advance := phase(Advance)
	change := api.Mul(advance, not(found), eq(a[2], 0))
	finish := api.Mul(advance, not(found), eq(a[2], 1))
	set(3, and(advance, found), next)
	set(3, change, first(1))
	set(2, change, 1)
	set(0, advance, api.Select(finish, Finish, Target))
	set(5, finish, 0)
	for r := 0; r < 6; r++ {
		record := and(phase(Finish), eq(a[1], r+1))
		for side := 0; side < 2; side++ {
			set(22+r*2+side, record, a[20+side])
		}
		for i := 0; i < Slots; i++ {
			set(34+r*Slots+i, record, not(eq(a[8+i], 0)))
		}
	}
	set(0, phase(Finish), Scan)
	for i := range out {
		api.AssertIsEqual(c.After[i], out[i])
	}
	return nil
}
