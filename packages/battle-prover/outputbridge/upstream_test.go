package outputbridge

import (
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"runtime"
	"testing"
)

// These are solver checks of the actual shared fixture dependencies, not new
// setup/proof receipts. Complete recursive authentication remains parent work.
func TestActualRawJournalSolvers(t *testing.T) {
	f := build(t, false)
	for kind := raw.Begin; kind <= raw.Seal; kind++ {
		cc := compile(t, raw.Shape(kind))
		for _, s := range f.raw {
			if s.Kind == kind {
				solve(t, cc, s, true)
			}
		}
		cc = nil
		runtime.GC()
	}
}
func TestActualReportSolvers(t *testing.T) {
	f := build(t, false)
	cc := compile(t, rb.ReportShape(0))
	for _, s := range f.reports {
		solve(t, cc, s, true)
	}
	bad := *f.reports[len(f.reports)-1]
	bad.After.Output = 1
	solve(t, cc, &bad, false)
}
