package composition

import (
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"testing"
)

// Host registry tests only; zero-point placeholders below are never proved or
// passed to a recursive verifier and are not authentication evidence.
func TestCatalogRoles(t *testing.T) {
	key := Key{}
	key.G1.K = make([]sw_bn254.G1Affine, 4)
	entries := map[FamilyID]Key{}
	for kind := 0; kind < 11; kind++ {
		entries[FamilyID{Phase: Combat, Kind: kind}] = key
	}
	c, e := NewKeyCatalog(entries)
	check(t, e)
	ks, e := c.ForFamily(FamilyID{Phase: Combat, Arity: 1})
	check(t, e)
	if len(ks) != 11 {
		t.Fatal("leaf catalog")
	}
	if _, e = c.ForFamily(FamilyID{Phase: Preparation, Arity: 1}); e == nil {
		t.Fatal("wrong phase")
	}
	if _, e = c.ForFamily(FamilyID{Phase: Combat, Level: 1, Arity: 1}); e == nil {
		t.Fatal("missing level")
	}
	delete(entries, FamilyID{Phase: Combat, Kind: 10})
	if _, e = c.ForFamily(FamilyID{Phase: Combat, Arity: 1}); e != nil {
		t.Fatal("map alias")
	}
	partial, e := NewKeyCatalog(entries)
	check(t, e)
	if _, e = partial.ForFamily(FamilyID{Phase: Combat, Arity: 1}); e == nil {
		t.Fatal("incomplete catalog")
	}
	entries[FamilyID{Phase: Combat, Arity: 1}] = key
	entries[FamilyID{Phase: Combat, Level: 1, Arity: 2}] = key
	c, e = NewKeyCatalog(entries)
	check(t, e)
	ks, e = c.ForFamily(FamilyID{Phase: Combat, Level: 1, Arity: 1})
	check(t, e)
	if len(ks) != 2 {
		t.Fatal("node catalog")
	}
	for _, id := range []FamilyID{{Phase: 7}, {Phase: Combat, Kind: 11}, {Phase: Combat, Level: 257, Arity: 2}, {Phase: Combat, Level: 1, Kind: 1, Arity: 2}, {Phase: Combat, Arity: 2}} {
		if id.Valid() {
			t.Fatalf("invalid role %+v", id)
		}
	}
}

func TestDispatchDAG(t *testing.T) {
	for phase := Preparation; phase <= Report; phase++ {
		seen := map[FamilyID]bool{}
		for kind := 0; kind < []int{5, 11, 4, 5, 2}[phase]; kind++ {
			seen[FamilyID{Phase: phase, Kind: kind}] = true
		}
		order := []FamilyID{{Phase: phase, Arity: 1}}
		for h := 1; h <= 256; h++ {
			order = append(order, FamilyID{Phase: phase, Level: h, Arity: 2}, FamilyID{Phase: phase, Level: h, Arity: 1})
		}
		for _, id := range order {
			deps, e := Dependencies(id)
			check(t, e)
			for _, dep := range deps {
				if !seen[dep] || dep == id {
					t.Fatalf("cyclic or forward key dependency %+v -> %+v", id, dep)
				}
			}
			seen[id] = true
		}
		if len(order) != 513 {
			t.Fatal("key count")
		}
	}
}
