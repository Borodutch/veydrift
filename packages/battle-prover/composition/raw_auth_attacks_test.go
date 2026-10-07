package composition

import (
	"fmt"
	"os"
	"testing"
)

// Both child proofs and their complete public openings remain authentic. Thus
// these cases isolate adjacency/terminal guards rather than bad proof binding.
func TestRawAuthenticatedAdjacency(t *testing.T) {
	if os.Getenv("RUN_RAW_AUTH_ATTACKS") != "1" {
		t.Skip("explicit genuine raw checkpoint attacks")
	}
	f := buildSettlement(t, false)
	rs := []familyReceipt{}
	for i := range f.raw {
		rs = append(rs, loadPinnedRaw0(t, fmt.Sprintf("staged-public/raw-v1/D0-%02d", i), FamilyID{Phase: RawJournal, Arity: 1}))
	}
	key := []Key{rs[0].auth.Keys[0]}
	valid := stageNode(RawJournal, 1, rs[:2], key, []int{0, 0})
	cc := compile(t, "actual-raw-pair-attacks", valid)
	check(t, cc.IsSolved(wit(t, valid)))
	for name, pair := range map[string][2]int{"omitted-resident-row": {0, 2}, "reordered-source-row": {2, 1}, "replay": {0, 0}, "suffix-after-seal": {6, 0}} {
		a := stageNode(RawJournal, 1, []familyReceipt{rs[pair[0]], rs[pair[1]]}, key, []int{0, 0})
		if cc.IsSolved(wit(t, a)) == nil {
			t.Fatalf("accepted %s", name)
		}
		t.Logf("REJECTED %s with TWO genuine approved proofs and correctly rebound public endpoints", name)
	}
}
