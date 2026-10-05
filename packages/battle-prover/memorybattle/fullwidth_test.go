package memorybattle

import (
	"encoding/json"
	"github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"os/exec"
	"reflect"
	"runtime"
	"testing"
)

func high(bit uint) Word { return Big(new(big.Int).Lsh(big.NewInt(1), bit)) }
func checkpoint(t *testing.T, k int, index, n Word) *Machine {
	t.Helper()
	m, e := New(fixture(2))
	if e != nil {
		t.Fatal(e)
	}
	m.Context.N = n
	m.State.V[phase] = W(uint64(k))
	m.State.V[step] = high(200)
	m.State.V[round] = W(1)
	m.State.V[cursor] = index
	m.State.V[target] = index
	m.State.V[shooter] = W(0)
	m.State.V[count0] = W(1)
	m.State.V[count1] = W(1)
	m.State.V[shots0] = high(180)
	m.State.V[shots1] = high(190)
	return m
}
func TestHighBitIntegratedCheckpoints(t *testing.T) {
	systems := map[int]constraint.ConstraintSystem{}
	currentKind := -1
	check := func(w *Step) {
		cc := systems[w.Kind]
		if cc == nil {
			delete(systems, currentKind)
			runtime.GC()
			currentKind = w.Kind
			cc = compile(t, w.Kind)
			systems[w.Kind] = cc
		}
		solve(t, cc, w, true)
	}
	i := high(255).Add(W(9))
	n := i.Add(W(1))
	max := Word{^uint64(0), ^uint64(0), ^uint64(0), ^uint64(0)}
	// Same damage relation admits all uint256 stats, including > native field.
	for _, tc := range []struct {
		attack, shield, hull, maxHull, want Word
		next                                int
	}{{max, max, max, max, max, Rapidfire}, {max, W(0), max, max, W(0), Rapidfire}, {high(250), W(0), high(251), high(251), high(250), Explosion}} {
		m := checkpoint(t, Damage, i, n)
		m.Memory.Write(key(UnitDomain, W(0)), Cell{W(0), W(0), tc.attack, W(0), max, W(0), max, W(0), W(1)})
		m.Memory.Write(key(UnitDomain, i), Cell{W(1), W(1), W(0), tc.shield, tc.maxHull, high(210), tc.hull, tc.shield, W(1)})
		m.State.Memory = m.Memory.Root()
		restored, e := NewCheckpoint(m.Context, m.State, m.Roster, m.RF, m.Memory)
		if e != nil {
			t.Fatal(e)
		}
		w, e := restored.Next()
		if e != nil {
			t.Fatal(e)
		}
		if restored.Memory.Read(key(UnitDomain, i))[Hull] != tc.want || restored.State.V[phase] != W(uint64(tc.next)) {
			t.Fatal("high damage mismatch")
		}
		check(w)
		bad := clone(w)
		bad.Before[target][3] = 0
		recommit(bad)
		solve(t, systems[Damage], bad, false)
	}
	// Counts, target ranks, shot totals and scans are limbs in the ACTUAL controller.
	m := checkpoint(t, FindTarget, i, n)
	m.State.V[rank] = W(0)
	m.Memory.Write(key(UnitDomain, i), Cell{W(1), W(1), W(0), W(0), high(240), high(210), high(240), W(0), W(1)})
	m.State.Memory = m.Memory.Root()
	w, e := m.Next()
	if e != nil {
		t.Fatal(e)
	}
	check(w)
	if m.State.V[target] != i || m.State.V[shots0] != high(180).Add(W(1)) {
		t.Fatal("target/shot truncation")
	}
	m.State.V[phase] = W(Scan)
	m.State.V[cursor] = i
	m.State.V[count0] = high(200)
	m.State.V[count1] = high(201)
	w, e = m.Next()
	if e != nil {
		t.Fatal(e)
	}
	check(w)
	if m.State.V[count1] != high(201).Add(W(1)) || m.State.V[cursor] != W(0) {
		t.Fatal("scan truncation")
	}
	bad := clone(w)
	bad.AfterReport = 1
	recommit(bad)
	solve(t, systems[Scan], bad, false)
	// Full-width bound is sampled from the authenticated seed/counter stream.
	m = checkpoint(t, DrawTarget, W(0), max)
	m.State.V[count0] = W(1)
	m.State.V[count1] = high(255).Add(W(17))
	m.State.V[counter] = high(230)
	w, e = m.Next()
	if e != nil {
		t.Fatal(e)
	}
	check(w)
	bad = clone(w)
	bad.Sample.Word[3] = 0
	solve(t, systems[DrawTarget], bad, false)
	// Full-width hull explosion uses that same rejection sampler.
	m = checkpoint(t, Explosion, i, n)
	m.Memory.Write(key(UnitDomain, i), Cell{W(1), W(1), W(0), W(0), max, high(210), high(240), W(0), W(1)})
	m.State.Memory = m.Memory.Root()
	w, e = m.Next()
	if e != nil {
		t.Fatal(e)
	}
	check(w)
	// A valid high-index canonical initializer checks predecessor and full stats.
	m = checkpoint(t, Init, i, n)
	prev := Cell{W(1), W(2), high(250), high(249), high(248), high(210)}
	u := prev
	u[Attack] = u[Attack].Add(W(1))
	u[Cohort] = u[Cohort].Add(W(1))
	m.Roster.Write(key(RosterDomain, i.Sub(W(1))), prev)
	m.Roster.Write(key(RosterDomain, i), u)
	m.Context.Roster = m.Roster.Root()
	m.State.V[count0] = high(200)
	m.State.V[count1] = high(201)
	w, e = m.Next()
	if e != nil {
		t.Fatal(e)
	}
	check(w)
}
func TestShotOverflowRefusesWithoutWrite(t *testing.T) {
	m := checkpoint(t, FindTarget, W(1), W(2))
	m.State.V[shots0] = Word{^uint64(0), ^uint64(0), ^uint64(0), ^uint64(0)}
	m.Memory.Write(key(UnitDomain, W(1)), Cell{W(1), W(1), W(0), W(0), W(100), W(1), W(100), W(0), W(1)})
	m.State.Memory = m.Memory.Root()
	before := m.State
	root := m.Memory.Root()
	if _, e := m.Next(); e == nil {
		t.Fatal("shot wrap")
	}
	if before.V != m.State.V || root.Cmp(m.Memory.Root()) != 0 {
		t.Fatal("failed step mutated checkpoint")
	}
}

func TestFullWidthSamplingBoundary(t *testing.T) {
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &protocol.SampleCircuit{})
	if e != nil {
		t.Fatal(e)
	}
	top := new(big.Int).Lsh(big.NewInt(1), 256)
	for _, bound := range []Word{W(1), W(3), high(255), high(255).Add(W(1)), Big(new(big.Int).Sub(top, num(1)))} {
		limit := new(big.Int).Sub(top, new(big.Int).Mod(new(big.Int).Set(top), bound.Big()))
		for _, n := range []*big.Int{num(0), new(big.Int).Sub(limit, num(1)), new(big.Int).Sub(top, num(1))} {
			w, e := protocol.NewSampleWitness(n, bound.Big())
			if e != nil {
				t.Fatal(e)
			}
			fw, e := frontend.NewWitness(w, ecc.BN254.ScalarField())
			if e != nil {
				t.Fatal(e)
			}
			if e = cc.IsSolved(fw); e != nil {
				t.Fatalf("bound=%v word=%v: %v", bound, n, e)
			}
		}
	}
}
func TestWrongPhaseKeyAndPublicOrder(t *testing.T) {
	m, e := New(fixture(2))
	if e != nil {
		t.Fatal(e)
	}
	w, e := m.Next()
	if e != nil {
		t.Fatal(e)
	}
	cc := compile(t, Ready)
	bad := clone(w)
	bad.Kind = Ready
	solve(t, cc, bad, false)
	s := w.Statement()
	if !scalarEqual(s[InputField], w.Input) || !scalarEqual(s[ResultField], w.Result) {
		t.Fatal("statement order")
	}
	fw, e := frontend.NewWitness(w, ecc.BN254.ScalarField())
	if e != nil {
		t.Fatal(e)
	}
	pub, e := fw.Public()
	if e != nil {
		t.Fatal(e)
	}
	v := pub.Vector()
	if reflect.ValueOf(v).Len() != 8 {
		t.Fatal("public width changed")
	}
}

func TestCheckedOverflowConstraints(t *testing.T) {
	max := Word{^uint64(0), ^uint64(0), ^uint64(0), ^uint64(0)}
	for _, k := range []int{FindTarget, Scan} {
		m := checkpoint(t, k, W(1), max)
		m.Memory.Write(key(UnitDomain, W(1)), Cell{W(1), W(1), W(0), W(0), W(100), W(1), W(100), W(0), W(1)})
		m.State.Memory = m.Memory.Root()
		w, e := m.Next()
		if e != nil {
			t.Fatal(e)
		}
		cc := compile(t, k)
		solve(t, cc, w, true)
		bad := clone(w)
		if k == FindTarget {
			bad.Before[shots0] = max.Circuit()
			bad.After[shots0] = W(0).Circuit()
		} else {
			bad.Before[count0] = W(0).Circuit()
			bad.Before[count1] = max.Circuit()
			bad.After[count0] = W(0).Circuit()
			bad.After[count1] = W(0).Circuit()
		}
		recommit(bad)
		solve(t, cc, bad, false)
	}
}

func TestHighStatsOracleParity(t *testing.T) {
	in := fixture(6)
	for i := range in.Units {
		for _, j := range []int{Attack, MaxShield, MaxHull} {
			in.Units[i][j] = Big(new(big.Int).Lsh(in.Units[i][j].Big(), 220))
		}
	}
	m, e := New(in)
	if e != nil {
		t.Fatal(e)
	}
	for j := 0; m.State.V[phase] != W(Done) && j < 4000; j++ {
		if _, e = m.Next(); e != nil {
			t.Fatal(e)
		}
	}
	if m.State.V[phase] != W(Done) {
		t.Fatal("incomplete")
	}
	type summary struct {
		Counter        string
		Hull, Shield   []string
		Round, Outcome uint64
	}
	actual := summary{Counter: m.State.V[counter].Big().String(), Round: m.State.V[round].Small(), Outcome: m.State.V[outcome].Small()}
	for i := 0; i < 6; i++ {
		u := m.Memory.Read(key(UnitDomain, W(uint64(i))))
		actual.Hull = append(actual.Hull, u[Hull].Big().String())
		actual.Shield = append(actual.Shield, u[Shield].Big().String())
	}
	data, e := exec.Command("bun", "oracle-high.ts").CombinedOutput()
	if e != nil {
		t.Fatalf("oracle %v %s", e, data)
	}
	var expected summary
	if e = json.Unmarshal(data, &expected); e != nil {
		t.Fatal(e)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("high stats mismatch actual=%+v expected=%+v", actual, expected)
	}
}

func TestMaximumCountCursorTerminal(t *testing.T) {
	max := Word{^uint64(0), ^uint64(0), ^uint64(0), ^uint64(0)}
	m := checkpoint(t, FindShooter, max, max)
	m.Memory.Write(key(UnitDomain, W(0)), Cell{W(0), W(0), W(0), W(0), W(100), W(0), W(100), W(0), W(1)})
	m.State.Memory = m.Memory.Root()
	w, e := m.Next()
	if e != nil {
		t.Fatal(e)
	}
	solve(t, compile(t, FindShooter), w, true)
	if m.State.V[cursor] != W(0) {
		t.Fatal("max cursor did not reset")
	}
	m.State.V[phase] = W(Ready)
	m.State.V[count0] = max
	m.State.V[count1] = W(0)
	w, e = m.Next()
	if e != nil {
		t.Fatal(e)
	}
	solve(t, compile(t, Ready), w, true)
	if m.State.V[phase] != W(Done) || m.State.V[outcome] != W(1) {
		t.Fatal("full count terminal")
	}
}

func TestCheckpointRootRefusal(t *testing.T) {
	m, e := New(fixture(2))
	if e != nil {
		t.Fatal(e)
	}
	bad := m.State
	bad.Memory = num(1)
	if _, e = NewCheckpoint(m.Context, bad, m.Roster, m.RF, m.Memory); e == nil {
		t.Fatal("stale memory checkpoint")
	}
	c := m.Context
	c.Roster = num(1)
	if _, e = NewCheckpoint(c, m.State, m.Roster, m.RF, m.Memory); e == nil {
		t.Fatal("stale roster checkpoint")
	}
	if _, e = NewCheckpoint(m.Context, m.State, nil, m.RF, m.Memory); e == nil {
		t.Fatal("missing tree")
	}
}
