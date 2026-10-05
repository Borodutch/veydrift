package memorybattle

import (
	"encoding/json"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"os/exec"
	"reflect"
	"runtime"
	"strconv"
	"testing"
)

func fixture(n int) PreparedInput {
	in := PreparedInput{Rapidfire: map[uint32]uint64{uint32(n / 2): 2}}
	for i := 0; i < n; i++ {
		s := uint64(0)
		if i >= n/2 {
			s = 1
		}
		in.Units = append(in.Units, Cell{W(s), W(uint64(i)), W(45), W(5), W(100), W(uint64(i))})
	}
	return in
}
func TestBoundedInitialization(t *testing.T) {
	m, err := New(fixture(6))
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		w, err := m.Next()
		if err != nil {
			t.Fatal(err)
		}
		cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, Shape(w.Kind))
		if err != nil {
			t.Fatal(err)
		}
		fw, err := frontend.NewWitness(w, ecc.BN254.ScalarField())
		if err != nil {
			t.Fatal(err)
		}
		if err = cc.IsSolved(fw); err != nil {
			t.Fatal(err)
		}
		t.Logf("kind=%d constraints=%d", w.Kind, cc.GetNbConstraints())
	}
}

type oracleRound struct {
	Shots     [2]uint64
	Survivors []uint64
}
type oracleResult struct {
	Counter        string
	Hull, Shield   []uint64
	Round, Outcome uint64
	Rounds         []oracleRound
}

func compareOracle(t *testing.T, n int, m *Machine, ws []*Step) {
	t.Helper()
	data, err := exec.Command("bun", "oracle-fixture.ts", strconv.Itoa(n)).CombinedOutput()
	if err != nil {
		t.Fatalf("independent oracle: %v %s", err, data)
	}
	var expected oracleResult
	if err = json.Unmarshal(data, &expected); err != nil {
		t.Fatal(err)
	}
	actual := oracleResult{Counter: strconv.FormatUint(m.State.V[counter][0], 10), Round: m.State.V[round].Small(), Outcome: m.State.V[outcome].Small()}
	for i := 0; i < n; i++ {
		u := m.Memory.Read(key(UnitDomain, W(uint64(i))))
		actual.Hull = append(actual.Hull, u[Hull].Small())
		actual.Shield = append(actual.Shield, u[Shield].Small())
	}
	for _, w := range ws {
		if w.Kind == Scan {
			a, _ := states(w)
			if a.V[cursor] == W(0) {
				actual.Rounds = append(actual.Rounds, oracleRound{Shots: [2]uint64{a.V[shots0].Small(), a.V[shots1].Small()}})
			}
			alive := uint64(0)
			if !word(w.Openings[0].Cell[Hull]).IsZero() {
				alive = 1
			}
			last := len(actual.Rounds) - 1
			actual.Rounds[last].Survivors = append(actual.Rounds[last].Survivors, alive)
		}
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("oracle mismatch actual=%+v expected=%+v", actual, expected)
	}
}
func TestVariableRosterAndAdversarial(t *testing.T) {
	// One key at a time; both sizes reuse the same R1CS without retaining eleven.
	var trace []*Step
	var all []*Step
	for _, n := range []int{6, 10} {
		m, e := New(fixture(n))
		if e != nil {
			t.Fatal(e)
		}
		var ws []*Step
		for j := 0; m.State.V[phase] != W(Done) && j < 4000; j++ {
			w, e := m.Next()
			if e != nil {
				t.Fatal(e)
			}
			ws = append(ws, w)
		}
		if !linked(ws) {
			t.Fatal("incomplete trace")
		}
		compareOracle(t, n, m, ws)
		t.Logf("units=%d steps=%d round=%v counter=%v", n, len(ws), m.State.V[round], m.State.V[counter])
		all = append(all, ws...)
		if n == 6 {
			trace = ws
		}
	}
	var current constraint.ConstraintSystem
	currentKind := -1
	system := func(k int) constraint.ConstraintSystem {
		if currentKind != k {
			current = nil
			runtime.GC()
			current = compile(t, k)
			currentKind = k
		}
		return current
	}
	for k := Boot; k < Done; k++ {
		cc := system(k)
		seen := false
		for _, w := range all {
			if w.Kind == k {
				solve(t, cc, w, true)
				seen = true
			}
		}
		if !seen {
			t.Fatalf("missing phase %d", k)
		}
	}
	first := func(kind int) *Step {
		for _, w := range trace {
			if w.Kind == kind {
				return w
			}
		}
		t.Fatalf("missing kind %d", kind)
		return nil
	}
	cases := []struct {
		name   string
		kind   int
		mutate func(*Step)
	}{
		{"stale-read", Damage, func(w *Step) { w.Openings[0].Cell[Hull] = W(101).Circuit() }},
		{"stale-write-root", Damage, func(w *Step) { w.AfterMemory = w.BeforeMemory; recommit(w) }},
		{"wrong-index", Damage, func(w *Step) { w.Before[target] = W(0).Circuit(); recommit(w) }},
		{"wrong-sibling", Damage, func(w *Step) { w.Openings[0].Siblings[63] = 1 }},
		{"wrong-initial-root", Boot, func(w *Step) { w.BeforeMemory = 1; w.AfterMemory = 1; recommit(w) }},
		{"wrong-initial-state", Boot, func(w *Step) { w.Before[counter] = W(1).Circuit(); w.After[counter] = W(1).Circuit(); recommit(w) }},
		{"wrong-initialization-spec", Init, func(w *Step) { w.Openings[1].Cell[MaxHull] = W(999).Circuit() }},
		{"skip-initialization", Init, func(w *Step) { w.After[phase] = W(Ready).Circuit(); recommit(w) }},
		{"wrong-target-rank", DrawTarget, func(w *Step) { w.After[rank] = W(999).Circuit(); recommit(w) }},
		{"wrong-round-pool", Scan, func(w *Step) { w.After[count0] = W(999).Circuit(); recommit(w) }},
		{"wrong-report", Scan, func(w *Step) { w.AfterReport = 1; recommit(w) }},
		{"premature-terminal", Ready, func(w *Step) {
			w.After = w.Before
			w.After[step] = word(w.Before[step]).Add(W(1)).Circuit()
			w.After[phase] = W(Done).Circuit()
			w.AfterDone = 1
			w.AfterMemory = w.BeforeMemory
			w.AfterReport = w.BeforeReport
			recommit(w)
			_, s := states(w)
			w.Result = hash(resultDomain, appendWords([]*big.Int{integer(w.Input), s.Memory, s.Report}, s.V[round], s.V[count0], s.V[count1], s.V[outcome])...)
		}},
		{"changed-seed", DrawTarget, func(w *Step) { w.Seed[0] = 1 }},
		{"forged-rng-word", DrawTarget, func(w *Step) { w.Sample.Word[3] = 0 }},
		{"forged-acceptance", DrawTarget, func(w *Step) { w.Sample.Accepted = 0 }},
		{"noncanonical-limb", DrawTarget, func(w *Step) { w.N[0] = new(big.Int).Lsh(big.NewInt(1), 64) }},
		{"forged-zero-anchor", DrawTarget, func(w *Step) { w.Start = 0 }},
		{"changed-snapshot", Damage, func(w *Step) { w.Snapshot[0] = 1 }},
		{"changed-roster-root", Init, func(w *Step) { w.Roster = 1 }},
		{"wrong-rf-lane", Rapidfire, func(w *Step) { w.Openings[2].Cell[0] = W(5).Circuit() }},
		{"forged-result", Ready, func(w *Step) { w.Result = 1 }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) { w := clone(first(tc.kind)); tc.mutate(w); solve(t, system(tc.kind), w, false) })
	}
	// Substitute an earlier VALID opening of the SAME target.
	staleChecked := false
	for i, w := range trace {
		if w.Kind != Damage {
			continue
		}
		for _, old := range trace[:i] {
			if old.Kind == Damage && word(old.Before[target]) == word(w.Before[target]) && !scalarEqual(old.BeforeMemory, w.BeforeMemory) {
				bad := clone(w)
				bad.Openings[0] = old.Openings[0]
				solve(t, system(Damage), bad, false)
				staleChecked = true
				break
			}
		}
		if staleChecked {
			break
		}
	}
	if !staleChecked {
		t.Fatal("missing repeated target stale-read coverage")
	}
	terminal := clone(trace[len(trace)-1])
	terminal.Result = 1
	solve(t, system(Ready), terminal, false)
	for _, kind := range []string{"skip", "replay", "truncate", "context", "stale-root"} {
		t.Run("link-"+kind, func(t *testing.T) {
			ws := append([]*Step(nil), trace...)
			switch kind {
			case "skip":
				ws = append(ws[:5], ws[6:]...)
			case "replay":
				ws[6] = ws[5]
			case "truncate":
				ws = ws[:len(ws)-1]
			case "context":
				ws[6] = clone(ws[6])
				ws[6].Input = 1
			case "stale-root":
				ws[6] = clone(ws[6])
				ws[6].BeforeRoot = ws[4].BeforeRoot
			}
			if linked(ws) {
				t.Fatal("accepted bad linkage")
			}
		})
	}
}
