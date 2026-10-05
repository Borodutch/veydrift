package attribution

import "testing"

// Bypass host Prepare deliberately. Rebuild all native commitments, so rejection
// cannot be attributed merely to changing a leaf without updating its hash.
func TestForgedCommittedLists(t *testing.T) {
	collect := compile(t, Collect)
	rank := compile(t, Rank)
	for _, duplicate := range []bool{false, true} {
		m, e := Prepare(context(), []Member{member(1, 7, 1), member(2, 8, 1)}, []bool{true, false})
		if e != nil {
			t.Fatal(e)
		}
		m.Members[1].Source = U(7)
		if duplicate {
			m.Members[1].Owner = U(1)
		}
		m.Context.Roster = 0
		for i, r := range m.Members {
			m.Context.Roster = chain(rosterDomain, m.Context.Roster, U(uint64(i)), memberHash(r))
		}
		ws := run(t, m, nil)
		solve(t, collect, ws[0], true)
		if duplicate {
			solve(t, collect, ws[1], false)
		} else {
			solve(t, collect, ws[1], true) // distinct pairs sort, but source owner conflicts
			solve(t, rank, ws[7], false)   // target owner1 / compared member owner2, same source
		}
	}
	m := fixture(t, 2)
	pinned := m.Context.Roster
	m.Members = m.Members[:2]
	m.Context.Members = U(2)
	// Altering claimed count cannot make a shortened scan cover the pinned manifest.
	m.Context.Roster = pinned
	w0, _ := m.Next()
	w1, _ := m.Next()
	solve(t, collect, w0, true)
	solve(t, collect, w1, false)
}

func TestNativeRejectsMalformedMembers(t *testing.T) {
	for _, ms := range [][]Member{{member(1, 2, 1), member(1, 2, 1)}, {member(1, 2, 1), member(2, 2, 1)}, {member(1, 2, 0)}} {
		if _, e := NativeLargestRemainder(ms, number(U(1))); e == nil {
			t.Fatal("accepted invalid members")
		}
	}
}
