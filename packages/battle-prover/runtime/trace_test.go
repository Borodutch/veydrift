package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"

	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	comp "github.com/Borodutch/veydrift/packages/battle-prover/composition"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
)

func traceSameEvent(t *testing.T, a, b TraceEvent) {
	t.Helper()
	if a.Phase != b.Phase || a.Group != b.Group || a.Kind != b.Kind {
		t.Fatal("event dispatch changed")
	}
	x, y := traceStatement(a.Step), traceStatement(b.Step)
	if len(x) != len(y) {
		t.Fatal("statement width")
	}
	for i := range x {
		if traceScalar(x[i]).Cmp(traceScalar(y[i])) != 0 {
			t.Fatalf("public statement %d changed", i)
		}
	}
}
func traceSolve(t *testing.T, shape, assignment frontend.Circuit) {
	t.Helper()
	ccs, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, shape)
	if e != nil {
		t.Fatal(e)
	}
	w, e := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
	if e != nil {
		t.Fatal(e)
	}
	if _, e = ccs.Solve(w); e != nil {
		t.Fatal(e)
	}
}

// Two distinct authoritative documents exercise both sides, owner-dependent
// research, nonfixture identities, real combat and all downstream projections.
func TestTraceDocumentsAndRestart(t *testing.T) {
	ctx := context.Background()
	for _, variant := range []int{2, 3} {
		t.Run(string(rune('0'+variant)), func(t *testing.T) {
			snap, doc := witnessTestDocument(t, variant, 1)
			driver, e := NewTrace(snap, doc.Release, witnessTestLimits)
			if e != nil {
				t.Fatal(e)
			}
			var prefix []TraceEvent
			// Interrupt inside a genuine allocation, not merely a phase boundary.
			for {
				ev, e := driver.Next(ctx)
				if e != nil {
					t.Fatal(e)
				}
				prefix = append(prefix, *ev)
				if ev.Phase == comp.Attribution {
					break
				}
			}
			cp, e := driver.Checkpoint()
			if e != nil {
				t.Fatal(e)
			}
			cancelled, cancel := context.WithCancel(ctx)
			cancel()
			if _, e = driver.Next(cancelled); !errors.Is(e, context.Canceled) {
				t.Fatal("cancellation ignored")
			}
			after, _ := driver.Checkpoint()
			if cp != after {
				t.Fatal("cancel advanced cursor")
			}
			encoded, _ := json.Marshal(cp)
			var persisted TraceCheckpoint
			if e = json.Unmarshal(encoded, &persisted); e != nil {
				t.Fatal(e)
			}
			resumed, e := RestoreTrace(snap, doc.Release, witnessTestLimits, persisted)
			if e != nil {
				t.Fatal(e)
			}
			if _, e = resumed.Next(ctx); e == nil {
				t.Fatal("unverified replay exposed")
			}
			for {
				before := resumed.count.Int64()
				done, e := resumed.Replay(ctx, 3)
				if e != nil {
					t.Fatal(e)
				}
				if resumed.count.Int64()-before > 3 {
					t.Fatal("unbounded replay")
				}
				if done {
					break
				}
			}
			for !driver.Done() {
				a, e := driver.Chunk(ctx, 3)
				if e != nil {
					t.Fatal(e)
				}
				b, e := resumed.Chunk(ctx, 3)
				if e != nil {
					t.Fatal(e)
				}
				if len(a) != len(b) || len(a) > 3 {
					t.Fatal("chunk bound")
				}
				for i := range a {
					traceSameEvent(t, a[i], b[i])
				}
				prefix = append(prefix, a...)
			}
			if _, e = driver.Next(ctx); e != io.EOF {
				t.Fatal("terminal next")
			}
			ca, _ := driver.Checkpoint()
			cb, _ := resumed.Checkpoint()
			if ca != cb {
				t.Fatal("different complete replay digest")
			}
			a, e := driver.Result()
			if e != nil {
				t.Fatal(e)
			}
			b, e := resumed.Result()
			if e != nil {
				t.Fatal(e)
			}
			if a.Manifest.Commitment().Cmp(b.Manifest.Commitment()) != 0 || !witnessEqual(a.Manifest.Root, b.Manifest.Root) || len(a.Leaves) != variant {
				t.Fatal("manifest/leaves mismatch")
			}
			for i, l := range a.Leaves {
				if !witnessEqual(l.Digest(a.Manifest.ChainRecord), b.Leaves[i].Digest(b.Manifest.ChainRecord)) {
					t.Fatal("replay leaf changed")
				}
			}
			if witnessDigest(a.Manifest.ChainRecord) != doc.ChainRecord {
				t.Fatal("document not authoritative")
			}
			for _, phase := range []int{comp.Preparation, comp.Combat, comp.Bridge, comp.Report, comp.RawJournal, comp.SettlementOutput, TraceQualification} {
				ep, ok := a.Endpoints[phase]
				if !ok || raw.Integer(ep.Count).Sign() == 0 {
					t.Fatal("missing endpoint", phase)
				}
			}
			if len(a.Closes) != len(a.Attributions) || len(a.Closes) == 0 {
				t.Fatal("allocation association missing")
			}
			// Independently replay legacy native bridge: adapter must produce exactly
			// the same Close endpoints, allocations, reports and output commitments.
			legacy, e := rb.FromMachines(driver.preparation.machine, driver.combat, driver.groups)
			if e != nil {
				t.Fatal(e)
			}
			var legacyClose []*rb.Step
			for traceScalar(legacy.State.Phase).Int64() != rb.Done {
				s, e := legacy.Next()
				if e != nil {
					t.Fatal(e)
				}
				if s.Kind == rb.Close {
					legacyClose = append(legacyClose, s)
				}
			}
			for i, c := range a.Closes {
				traceSameEvent(t, TraceEvent{comp.Bridge, c.Group, rb.Close, c.Step}, TraceEvent{comp.Bridge, c.Group, rb.Close, legacyClose[i]})
				f := c.Attribution.First.(*attr.Step)
				l := c.Attribution.Last.(*attr.Step)
				if traceScalar(c.Step.AttributionContext).Cmp(traceScalar(f.ContextRoot)) != 0 || traceScalar(c.Step.AttributionResult).Cmp(traceScalar(l.Result)) != 0 {
					t.Fatal("close allocation debt mismatch")
				}
			}
			reports, e := rb.ReportWitnesses(driver.bridge.Context, driver.records, driver.bridge.Open)
			if e != nil {
				t.Fatal(e)
			}
			ri := 0
			for _, ev := range prefix {
				if ev.Phase == comp.Report {
					traceSameEvent(t, ev, TraceEvent{comp.Report, "", reports[ri].Kind, reports[ri]})
					ri++
				}
			}
			if ri != len(reports) {
				t.Fatal("report coverage")
			}
			if variant == 2 {
				traceSolve(t, rb.Shape(rb.Close), a.Closes[0].Step)
				traceSolve(t, rb.ReportShape(reports[len(reports)-1].Kind), driver.reportLast)
			}
			// Altering a complete public transcript digest cannot authenticate replay.
			bad := cp
			bad.Digest = strings.Repeat("0", 64)
			tampered, e := RestoreTrace(snap, doc.Release, witnessTestLimits, bad)
			if e != nil {
				t.Fatal(e)
			}
			for {
				done, e := tampered.Replay(ctx, 10)
				if e != nil {
					break
				}
				if done {
					t.Fatal("tampered checkpoint accepted")
				}
			}
			if _, e = tampered.Checkpoint(); e == nil {
				t.Fatal("poisoned replay checkpoint")
			}
		})
	}
}
