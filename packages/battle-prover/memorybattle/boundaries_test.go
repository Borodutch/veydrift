package memorybattle

import (
	"github.com/consensys/gnark/frontend"
	"testing"
)

func cell(o Opening) Cell {
	var c Cell
	for i, x := range o.Cell {
		c[i] = integer(x).Uint64()
	}
	return c
}
func rootFrom(o Opening, index uint64, c Cell) frontend.Variable {
	h := cellHash(c)
	for _, s := range o.Siblings {
		if index&1 == 0 {
			h = raw(h, integer(s))
		} else {
			h = raw(integer(s), h)
		}
		index >>= 1
	}
	return h
}
func TestDamageBoundaries(t *testing.T) {
	cc := compile(t, Damage)
	max := ^uint64(0)
	for _, tc := range []struct {
		name                                                           string
		attack, shield, maxShield, hull, maxHull, wantHull, wantShield uint64
		wantPhase                                                      int
	}{
		{"bounce", 1, 1000, 1000, 60, 100, 60, 1000, Rapidfire},
		{"shield-only-explosion", 10, 1000, 1000, 60, 100, 60, 990, Explosion},
		{"zero-power", 0, 0, 1000, 60, 100, 60, 0, Rapidfire},
		{"exact-30-percent", 30, 0, 0, 100, 100, 70, 0, Rapidfire},
		{"over-30-percent", 31, 0, 0, 100, 100, 69, 0, Explosion},
		{"overkill", 200, 5, 5, 100, 100, 0, 0, Rapidfire},
		{"dead-target", 200, 5, 5, 0, 100, 0, 5, Rapidfire},
		{"uint64-max-shield", max, max, max, max, max, max, 0, Rapidfire},
		{"uint64-max-hull", max, 0, 0, max, max, 0, 0, Rapidfire},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, err := New(fixture(2))
			if err != nil {
				t.Fatal(err)
			}
			m.Memory.Write(0, Cell{0, 0, tc.attack, 0, 100, 0, 0, 0, 1})
			m.Memory.Write(1, Cell{1, 1, 0, tc.maxShield, tc.maxHull, 1, tc.hull, tc.shield, 1})
			m.State.Memory = m.Memory.Root()
			m.State.V[phase] = Damage
			m.State.V[round] = 1
			m.State.V[target] = 1
			m.State.V[count0] = 1
			m.State.V[count1] = 1
			m.State.V[step] = 100
			w, err := m.Next()
			if err != nil {
				t.Fatal(err)
			}
			got := m.Memory.Read(1)
			if got[Hull] != tc.wantHull || got[Shield] != tc.wantShield || m.State.V[phase] != uint64(tc.wantPhase) {
				t.Fatalf("wrong native damage: %v", got)
			}
			solve(t, cc, w, true)
			forged := clone(w)
			got[Attack]++ // changing immutable target stats is not a legal write
			forged.AfterMemory = rootFrom(forged.Openings[0], 1, got)
			recommit(forged)
			solve(t, cc, forged, false)
		})
	}
}
func TestInitializationCanonicality(t *testing.T) {
	for _, mutate := range []func(*PreparedInput){func(i *PreparedInput) { i.Units[1][Type] = 0 }, func(i *PreparedInput) { i.Units[0][Cohort] = 1 }, func(i *PreparedInput) { i.Units[1][Cohort] = 0 }, func(i *PreparedInput) { i.Units[1][Hull] = 1 }} {
		in := fixture(6)
		mutate(&in)
		if _, err := New(in); err == nil {
			t.Fatal("accepted malformed prepared roster")
		}
	}
	m, err := New(fixture(6))
	if err != nil {
		t.Fatal(err)
	}
	m.Next()
	w, err := m.Next()
	if err != nil {
		t.Fatal(err)
	}
	cc := compile(t, Init)
	solve(t, cc, w, true)
	u := cell(w.Openings[1])
	u[Hull] = u[MaxHull] + 1
	u[Shield] = u[MaxShield]
	u[Pool] = 1
	bad := clone(w)
	bad.AfterMemory = rootFrom(bad.Openings[0], 0, u)
	recommit(bad)
	solve(t, cc, bad, false)
	// An authentic but non-canonical roster root must not turn a misordered pair
	// into valid initialization merely by recomputing the context commitment.
	m, err = New(fixture(6))
	if err != nil {
		t.Fatal(err)
	}
	u = m.Roster.Read(1)
	u[Type] = 0
	m.Roster.Write(1, u)
	m.Context.Roster = m.Roster.Root()
	m.Next()
	m.Next()
	w, err = m.Next()
	if err != nil {
		t.Fatal(err)
	}
	solve(t, cc, w, false)
}
