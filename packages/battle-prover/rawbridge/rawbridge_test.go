package rawbridge

import (
	"fmt"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"runtime"
	"testing"
)

func Fixture(t *testing.T) (Metadata, Header, []Event) {
	t.Helper()
	id := prep.Identity{Chain: p.Const(8453), Game: p.Const(123), Battle: p.Const(99), Body: p.Const(17), Incarnation: p.Const(3), Impact: p.Const(9999), Rules: p.Const(2), Verifier: p.Const(456), Catalog: p.Const(1), SeedPolicy: p.Const(1), TargetIsMoon: 0}
	row := func(owner, source, count, side, typ uint64) prep.Row {
		return prep.Row{Owner: p.Const(owner), Source: p.Const(source), Count: p.Const(count), Side: side, Type: typ, Tech: p.Technology{Weapons: uint64(2), Shielding: uint64(3), Armor: uint64(4)}}
	}
	rows := []prep.Row{row(7, 0, 2, 1, 0), row(8, 99, 3, 0, 0), row(8, 99, 4, 0, 1)}
	bases := map[uint64]p.Stats{0: {Attack: p.Const(5), Shield: p.Const(10), Hull: p.Const(400)}, 1: {Attack: p.Const(50), Shield: p.Const(10), Hull: p.Const(400)}}
	machine, e := prep.New(id, rows, bases)
	if e != nil {
		t.Fatal(e)
	}
	meta := Metadata{Preparation: machine.C, Version: p.Const(3), Codehash: p.Const(77), Engine: p.Const(88), RequestID: p.Const(4), Purpose: Digest(Domain("veydrift.attack-battle.v1"), id.Chain, id.Battle)}
	var h Header
	for i := range h {
		h[i] = p.Const(0)
	}
	h[0] = id.Body
	h[2] = id.Incarnation
	h[4] = id.Impact
	h[5] = p.Const(7)
	h[15] = p.Const(5000)
	var mission Mission
	for i := range mission {
		mission[i] = p.Const(0)
	}
	mission[0] = p.Const(1)
	mission[1] = p.Const(3)
	mission[2] = p.Const(8)
	mission[4] = id.Body
	mission[6] = id.Impact
	mission[12] = p.Const(3)
	mission[13] = p.Const(4)
	mission[26] = meta.RequestID
	return meta, h, []Event{RowEvent(rows[0]), SourceEvent(id.Battle, mission), RowEvent(rows[1]), RowEvent(rows[2])}
}
func TestJournalSolver(t *testing.T) {
	meta, h, events := Fixture(t)
	steps, e := Build(meta, h, events)
	if e != nil {
		t.Fatal(e)
	}
	for kind := Begin; kind <= Seal; kind++ {
		t.Run(fmt.Sprint(kind), func(t *testing.T) {
			cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, Shape(kind))
			if e != nil {
				t.Fatal(e)
			}
			t.Logf("kind=%d constraints=%d", kind, cc.GetNbConstraints())
			if cc.GetNbConstraints() > 4000000 {
				t.Fatal("4M ceiling")
			}
			check := func(w *Step, ok bool) {
				t.Helper()
				v, e := frontend.NewWitness(w, ecc.BN254.ScalarField())
				if e != nil {
					t.Fatal(e)
				}
				e = cc.IsSolved(v)
				if (e == nil) != ok {
					t.Fatalf("valid=%v err=%v", ok, e)
				}
			}
			for _, s := range steps {
				if s.Kind != kind {
					continue
				}
				check(s, true)
				bad := *s
				bad.AfterHash = 1
				check(&bad, false)
			}
			var s *Step
			for _, x := range steps {
				if x.Kind == kind {
					s = x
					break
				}
			}
			for name, mut := range map[string]func(*Step){"identity": func(s *Step) { s.Meta.Preparation.Identity.Game = p.Const(321) }, "journal": func(s *Step) { s.After.Journal = p.Const(0); s.AfterHash = s.After.Commitment() }} {
				t.Run(name, func(t *testing.T) { bad := *s; mut(&bad); check(&bad, false) })
			}
			switch kind {
			case Begin:
				bad := *s
				bad.Header[0] = p.Const(18)
				check(&bad, false)
				bad = *s
				bad.Header[6] = p.Const(1)
				check(&bad, false)
			case Source:
				duplicate := *s
				duplicate.Before.Sources = s.After.Sources
				duplicate.BeforeHash = duplicate.Before.Commitment()
				check(&duplicate, false)
				bad := *s
				bad.Mission[12] = p.Const(8)
				check(&bad, false)
				bad = *s
				bad.SourceID = p.Const(0)
				check(&bad, false)
			case Row:
				for _, mut := range []func(*Step){func(s *Step) { s.Row.Count = p.Const(5) }, func(s *Step) { s.Row.Tech.Weapons = 5 }, func(s *Step) { s.Row.Owner = p.Const(9) }, func(s *Step) { s.Row.Source = p.Const(17) }, func(s *Step) { s.Before.LastType = 1; s.BeforeHash = s.Before.Commitment() }, func(s *Step) { s.After.Raw = big.NewInt(0); s.AfterHash = s.After.Commitment() }} {
					bad := *s
					mut(&bad)
					check(&bad, false)
				}
			case Seal:
				bad := *s
				bad.Before.Remaining = 1
				bad.BeforeHash = bad.Before.Commitment()
				check(&bad, false)
				bad = *s
				bad.Meta.Preparation.Rows = p.Const(2)
				bad.Binding = bad.Meta.Commitment()
				check(&bad, false)
			}
		})
		runtime.GC()
	}
}

type traceLink struct{ S []Statement }

func (c *traceLink) Define(api frontend.API) error {
	AssertComplete(api, c.S[0], c.S[len(c.S)-1])
	for i := 1; i < len(c.S); i++ {
		AssertLinked(api, c.S[i-1], c.S[i])
	}
	return nil
}
func TestStreamCompleteness(t *testing.T) {
	m, h, e := Fixture(t)
	steps, err := Build(m, h, e)
	if err != nil {
		t.Fatal(err)
	}
	w := &traceLink{S: make([]Statement, len(steps))}
	for i, s := range steps {
		w.S[i] = s.Statement()
	}
	cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &traceLink{S: make([]Statement, len(steps))})
	if err != nil {
		t.Fatal(err)
	}
	check := func(w *traceLink, ok bool) {
		v, e := frontend.NewWitness(w, ecc.BN254.ScalarField())
		if e != nil {
			t.Fatal(e)
		}
		e = cc.IsSolved(v)
		if (e == nil) != ok {
			t.Fatal("trace link", ok, e)
		}
	}
	check(w, true)
	for _, mut := range []func([]Statement){func(s []Statement) { s[1] = s[2] }, func(s []Statement) { s[1], s[2] = s[2], s[1] }, func(s []Statement) { s[0][1] = 1 }, func(s []Statement) { s[len(s)-1][4] = Row }} {
		bad := &traceLink{S: append([]Statement{}, w.S...)}
		mut(bad.S)
		check(bad, false)
	}
	if _, err := Build(m, h, e[:len(e)-1]); err == nil {
		t.Fatal("omitted source lane")
	}
	duplicate := append([]Event{}, e...)
	duplicate = append(duplicate, e[1])
	if _, err := Build(m, h, duplicate); err == nil {
		t.Fatal("duplicate source")
	}
}
