package outputbridge

import (
	"fmt"
	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/frontend"
	"math/big"
	"runtime"
	"testing"
)

func TestNativeFixture(t *testing.T) { build(t, false); build(t, true) }
func TestOutputSolvers(t *testing.T) {
	fs := []fixture{build(t, false), build(t, true)}
	for kind := Begin; kind <= Finish; kind++ {
		t.Run(fmt.Sprint(kind), func(t *testing.T) {
			cc := compile(t, Shape(kind))
			if cc.GetNbPublicVariables() != 6 {
				t.Fatal("statement schema")
			}
			for _, f := range fs {
				for _, s := range f.steps {
					if s.Kind == kind {
						solve(t, cc, s, true)
					}
				}
			}
			var good *Step
			for _, s := range fs[0].steps {
				if s.Kind == kind {
					good = s
					break
				}
			}
			attacks := map[string]func(*Step){
				"changed-state":  func(s *Step) { s.After.Index = inc(s.After.Index); s.Commit() },
				"phase-restart":  func(s *Step) { s.Before = Initial(); s.Commit() },
				"root":           func(s *Step) { s.Manifest.Root = Z(777) },
				"chain-binding":  func(s *Step) { s.Manifest.ChainRecord = Z(777) },
				"terminal-claim": func(s *Step) { s.Finished = 1; s.Result = 1 },
			}
			if kind == Begin {
				delete(attacks, "phase-restart")
			}
			if kind == Member {
				attacks["skip-zero-loss-member"] = func(s *Step) { s.Leaf = fs[0].m.Leaves[1] }
				attacks["wrong-loss"] = func(s *Step) { s.Leaf.Lost = 1; s.Leaf.Survivors = 0 }
				attacks["zero-quantity"] = func(s *Step) { s.Leaf.Count = 0 }
				attacks["loss-overflow"] = func(s *Step) { s.Leaf.Lost = uint64(1) << 32 }
				attacks["survivor-overflow"] = func(s *Step) { s.Leaf.Survivors = uint64(1) << 32 }
				attacks["wrong-source"] = func(s *Step) { s.Leaf.Source = Z(991) }
				attacks["wrong-cohort"] = func(s *Step) { s.Leaf.Cohort = Z(1) }
				attacks["wrong-side"] = func(s *Step) { s.Leaf.Side = 1 }
				attacks["wrong-unit"] = func(s *Step) { s.Leaf.Unit = 0 }
				attacks["wrong-owner"] = func(s *Step) { s.Leaf.Owner = Z(991) }
				attacks["owner-overflow"] = func(s *Step) { s.Leaf.Owner = p.MustValue(new(big.Int).Lsh(big.NewInt(1), 160)) }
				attacks["suffix"] = func(s *Step) { s.Leaf.Next = Z(991) }
				attacks["limb-alias"] = func(s *Step) { s.Leaf.Next[0] = new(big.Int).Lsh(big.NewInt(1), 64) }
				attacks["field-alias"] = func(s *Step) {
					n := number(s.Leaf.Next)
					if n.Cmp(fr.Modulus()) >= 0 {
						n.Sub(n, fr.Modulus())
					} else {
						n.Add(n, fr.Modulus())
					}
					s.Leaf.Next = p.MustValue(n)
				}
				attacks["full-width-cursor-gap"] = func(s *Step) { s.Before.Index = p.MustValue(new(big.Int).Lsh(big.NewInt(1), 200)); s.Commit() }
			}
			if kind == Finish {
				attacks["incomplete-members"] = func(s *Step) { s.Before.Index = Z(1); s.Commit() }
				attacks["wrong-cohort-output"] = func(s *Step) { s.Before.Output = 1; s.Commit() }
				attacks["wrong-tail"] = func(s *Step) { s.Before.Expected = Z(1); s.Commit() }
				attacks["changed-report"] = func(s *Step) { s.Manifest.Pipeline[6] = 1; s.Commit() }
				attacks["changed-complete-result"] = func(s *Step) { s.Manifest.Pipeline[7] = 1; s.Commit() }
			}
			for name, attack := range attacks {
				t.Run(name, func(t *testing.T) { bad := *good; attack(&bad); solve(t, cc, &bad, false) })
			}
			if kind == Member {
				// Duplicate/reordered canonical rows rejected independently of Keccak:
				// recompute the attacked expected digest rather than leaving a stale hash.
				s := *fs[0].steps[3]
				if s.Kind != Member {
					t.Fatal("fixture order")
				}
				s.Leaf.Owner = s.Before.PrevOwner
				s.Leaf.Source = s.Before.PrevSource
				s.Before.Expected = s.Leaf.Digest(s.Manifest.ChainRecord)
				s.Commit()
				solve(t, cc, &s, false)
			}
		})
		runtime.GC()
	}
}

type links struct {
	Left, Right Statement
	Complete    bool `gnark:"-"`
}

func (l *links) Define(api frontend.API) error {
	if l.Complete {
		AssertComplete(api, l.Left, l.Right)
	} else {
		AssertLinked(api, l.Left, l.Right)
	}
	return nil
}
func TestChunkRestartCoverage(t *testing.T) {
	f := build(t, false)
	cc := compile(t, &links{})
	fc := compile(t, &links{Complete: true})
	for size := 1; size <= 7; size++ {
		m, e := New(f.m.Manifest, f.m.Groups)
		check(t, e)
		var all []*Step
		for scalar(m.State.Phase).Int64() != Done {
			chunk, e := m.Chunk(size)
			check(t, e)
			all = append(all, chunk...)
			saved := m.State
			restarted, e := New(f.m.Manifest, f.m.Groups)
			check(t, e)
			restarted.State = saved
			m = restarted
		}
		if len(all) != len(f.steps) {
			t.Fatal("chunk coverage")
		}
		for i, s := range all {
			if s.After.Commitment().Cmp(f.steps[i].After.Commitment()) != 0 {
				t.Fatal("restart diverged")
			}
			if i > 0 {
				solve(t, cc, &links{Left: all[i-1].Statement(), Right: s.Statement()}, true)
			}
		}
		solve(t, fc, &links{Left: all[0].Statement(), Right: all[len(all)-1].Statement(), Complete: true}, true)
	}
	for _, pair := range [][2]int{{0, 2}, {2, 2}, {3, 2}, {len(f.steps) - 1, 0}} {
		solve(t, cc, &links{Left: f.steps[pair[0]].Statement(), Right: f.steps[pair[1]].Statement()}, false)
	}
	solve(t, fc, &links{Left: f.steps[1].Statement(), Right: f.steps[len(f.steps)-1].Statement(), Complete: true}, false)
	solve(t, fc, &links{Left: f.steps[0].Statement(), Right: f.steps[len(f.steps)-2].Statement(), Complete: true}, false)
	m, e := New(f.m.Manifest, f.m.Groups)
	check(t, e)
	z, e := m.Chunk(0)
	check(t, e)
	if len(z) != 0 || m.State.Commitment().Cmp(Initial().Commitment()) != 0 {
		t.Fatal("zero work")
	}
}

// Test-only linkage harness: NOT a proof verifier. Production uses these
// equations only AFTER authenticating all four complete dependency statements.
type linking struct {
	First, Last       Statement
	Manifest          Manifest
	Pipeline          [8]frontend.Variable
	Qualified         q.LinkedStatement
	RawFirst, RawLast raw.Statement
	Public            Settlement
}

func (c *linking) Define(api frontend.API) error {
	AssertAuthenticated(api, c.First, c.Last, c.Manifest, c.Pipeline, c.Qualified, c.RawFirst, c.RawLast, c.Public)
	return nil
}
func TestActualRawQualificationAndPipelineLinks(t *testing.T) {
	f := build(t, false)
	m := f.m.Manifest
	good := linking{First: f.steps[0].Statement(), Last: f.steps[len(f.steps)-1].Statement(), Manifest: m, Pipeline: m.Pipeline, Qualified: f.qualified.Statement(), RawFirst: f.raw[0].Statement(), RawLast: f.raw[len(f.raw)-1].Statement(), Public: m.Settlement()}
	cc := compile(t, &linking{})
	solve(t, cc, &good, true)
	for _, name := range []string{"raw-result", "raw-prefix", "qualification-context", "qualification-input", "chain-record", "root", "count", "round", "survivors", "outcome", "report", "complete", "limb"} {
		t.Run(name, func(t *testing.T) {
			bad := good
			switch name {
			case "raw-result":
				bad.RawLast[3] = 1
			case "raw-prefix":
				bad.RawFirst = f.raw[1].Statement()
			case "qualification-context":
				bad.Qualified[0] = 1
			case "qualification-input":
				bad.Qualified[1] = 1
			case "chain-record":
				bad.Qualified[3] = 1
			case "root":
				bad.Public[4] = 1
			case "count":
				bad.Public[8] = 1
			case "round":
				bad.Public[12] = 55
			case "survivors":
				bad.Public[13] = 55
			case "outcome":
				bad.Public[21] = 2
			case "report":
				bad.Pipeline[6] = 1
			case "complete":
				bad.Pipeline[7] = 1
			case "limb":
				bad.Public[0] = new(big.Int).Lsh(big.NewInt(1), 64)
			}
			solve(t, cc, &bad, false)
		})
	}
}
func TestActualAttributionStreams(t *testing.T) {
	f := build(t, false)
	for kind := attr.Collect; kind <= attr.Rank; kind++ {
		cc := compile(t, attr.Shape(kind))
		for _, ss := range f.bridge.AttrSteps {
			for _, s := range ss {
				if s.Kind == kind {
					solve(t, cc, s, true)
				}
			}
		}
		cc = nil
		runtime.GC()
	}
}
func TestLinkedQualificationSolver(t *testing.T) {
	f := build(t, false)
	cc := compile(t, &q.LinkedCircuit{})
	solve(t, cc, f.qualified, true)
	bad := *f.qualified
	bad.ChainSnapshot = p.MustValue(f.bridge.Context.Prepared.Commitment())
	solve(t, cc, &bad, false)
}
