package composition

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"testing"
)

// Independent source-owned DEVELOPMENT approval anchors recovered from the
// terminal rawstage0 log, not from an input receipt at verification time.
// This is an explicit audited migration of our own generated14 public proofs,
// not production ceremony/key promotion and not a signature/trust service.
// Source-dependent future pipeline receipts use their separate approval ledger.
var reviewedRaw0 = map[string][4]string{
	"staged-public/raw-v1/leaf-00": {"3514c362b350662e10f16d330487c4ae3f331f10b58df058e13332804cdbb9ed", "a339a3beb07816221702bd80002f2e489b8ad1e52518c283a725f67700ba312c", "4df627debf85b23341f634d98134826e10013f901af122af000f02a4cb3de24a", "0f09b9bff14f7eeedd530f990bd548c92c6e02de026861c0e70e0d0021986a9e"},
	"staged-public/raw-v1/leaf-02": {"390861b4dd6f34c7362fcedcae336a651a5396befcab374942de2b5e95383252", "c0d0cec9354c47afbc355ff76887b7c9266503d0be2d11238009503105c7ac90", "277cfca8c337ed8a97bf12d6d35833d20cf627fb7582c7b96b63d9ae4e396f6d", "aa35d1ffca571e2d6b96ac8a28eba6a061eb21b7f5e04152c80c79f94c8cd348"},
	"staged-public/raw-v1/leaf-04": {"feb19eb3a17caf8d5902966add733dac4f5f5bc1b23e01c5d7dc666ee9b6a2aa", "c0d0cec9354c47afbc355ff76887b7c9266503d0be2d11238009503105c7ac90", "277cfca8c337ed8a97bf12d6d35833d20cf627fb7582c7b96b63d9ae4e396f6d", "035846b8046fe6f2c8a1029179a686b8524f5bfae269b688b41570e00f565f30"},
	"staged-public/raw-v1/leaf-01": {"4f6ce5ae25efa480b0cfb96fe02db8ca5ab9fa022f82547281430d2dbc976d68", "97666d95c764dc8b0f0182bcab7f5a5db87942c199439309962cdb1e65b17f62", "20ada04ef9cf550ee26ba53e7a7d5aa2b1f0f9515551de102b3cd4cf497b9940", "c35d8dad335f3ad91b509223e21dcc7f52bb2379a77470bbeec043af8e22878d"},
	"staged-public/raw-v1/leaf-03": {"cf8ce3a017a4a08cc43da514a5acdffcabe619ee573333c016fedfe7019f2a22", "97666d95c764dc8b0f0182bcab7f5a5db87942c199439309962cdb1e65b17f62", "20ada04ef9cf550ee26ba53e7a7d5aa2b1f0f9515551de102b3cd4cf497b9940", "e02b122fe9a57d02336bbb36cca8459cd60dff1aa24da337ce06e184ca2313d1"},
	"staged-public/raw-v1/leaf-05": {"c7f049371f25d1b44eb162a81af0687ecacac5bc485e2ba01eca406878983797", "97666d95c764dc8b0f0182bcab7f5a5db87942c199439309962cdb1e65b17f62", "20ada04ef9cf550ee26ba53e7a7d5aa2b1f0f9515551de102b3cd4cf497b9940", "553e0a16149962a78c7ae720a8d0e4398ddc8bac748c2a86b76bdb04e0d2eb0a"},
	"staged-public/raw-v1/leaf-06": {"436fca06d8cfc98eaa2180bd02494ebb45126b029701debc307eee756fa48956", "6b5ddb685788d9d3f926cb7754d45306620b8b2156138eb736ae9cebfd913a90", "b08af080767a08abac8bd16af2d00f6fc541222d829f94fa4e7474854c484bb7", "0410cf9b5594bfd03c2464517641667150de9897cd0d5f41cfdf20dbb8145947"},
	"staged-public/raw-v1/D0-00":   {"f80714ce8fc30e0ccc32c8b17ec10d39711d14f4d22165b2de93b4838b4497e3", "8ae8a61c560b680b6725aca1aecdf3c2c5d182deeb6f4bcd37c6323d009521ae", "27c0d8c49628acaf932c560f9a45c21c8199e716aa25eec0658dc10a7ebbd460", "0f09b9bff14f7eeedd530f990bd548c92c6e02de026861c0e70e0d0021986a9e"},
	"staged-public/raw-v1/D0-01":   {"7214969f0c54d5ba6faef08ab091b87faa0cbf1a6e7df0e73520e00a6ed57969", "8ae8a61c560b680b6725aca1aecdf3c2c5d182deeb6f4bcd37c6323d009521ae", "27c0d8c49628acaf932c560f9a45c21c8199e716aa25eec0658dc10a7ebbd460", "c35d8dad335f3ad91b509223e21dcc7f52bb2379a77470bbeec043af8e22878d"},
	"staged-public/raw-v1/D0-02":   {"af53e817bd93c328b214a1d2c6408a97a8db5e5abf3ffdd5389604bb030db541", "8ae8a61c560b680b6725aca1aecdf3c2c5d182deeb6f4bcd37c6323d009521ae", "27c0d8c49628acaf932c560f9a45c21c8199e716aa25eec0658dc10a7ebbd460", "aa35d1ffca571e2d6b96ac8a28eba6a061eb21b7f5e04152c80c79f94c8cd348"},
	"staged-public/raw-v1/D0-03":   {"196d4a3aa8b86fa1fbbd9b82f395e14904f6617188b24f553421548ef54737aa", "8ae8a61c560b680b6725aca1aecdf3c2c5d182deeb6f4bcd37c6323d009521ae", "27c0d8c49628acaf932c560f9a45c21c8199e716aa25eec0658dc10a7ebbd460", "e02b122fe9a57d02336bbb36cca8459cd60dff1aa24da337ce06e184ca2313d1"},
	"staged-public/raw-v1/D0-04":   {"796566f3f16ed5faa3ceb4cc53df95d9c75204956259445f85d501acc747285b", "8ae8a61c560b680b6725aca1aecdf3c2c5d182deeb6f4bcd37c6323d009521ae", "27c0d8c49628acaf932c560f9a45c21c8199e716aa25eec0658dc10a7ebbd460", "035846b8046fe6f2c8a1029179a686b8524f5bfae269b688b41570e00f565f30"},
	"staged-public/raw-v1/D0-05":   {"e99bf655ced981a818a1cef79b9437a94e86b4a1ef8ce2f6f04c5e8b81b8cfa4", "8ae8a61c560b680b6725aca1aecdf3c2c5d182deeb6f4bcd37c6323d009521ae", "27c0d8c49628acaf932c560f9a45c21c8199e716aa25eec0658dc10a7ebbd460", "553e0a16149962a78c7ae720a8d0e4398ddc8bac748c2a86b76bdb04e0d2eb0a"},
	"staged-public/raw-v1/D0-06":   {"3f0e36e92553a38f91eddbce1876ce0feb9473d2afab64a04c46a9c0fb437194", "8ae8a61c560b680b6725aca1aecdf3c2c5d182deeb6f4bcd37c6323d009521ae", "27c0d8c49628acaf932c560f9a45c21c8199e716aa25eec0658dc10a7ebbd460", "0410cf9b5594bfd03c2464517641667150de9897cd0d5f41cfdf20dbb8145947"},
}

func loadPinnedRaw0(t *testing.T, path string, want FamilyID) familyReceipt {
	t.Helper()
	pin, ok := reviewedRaw0[path]
	if !ok {
		t.Fatal("raw stage not approved")
	}
	b, e := os.ReadFile(path + ".json")
	check(t, e)
	var m publicReceipt
	check(t, json.Unmarshal(b, &m))
	if !matchesRawApproval(m, pin, want) {
		t.Fatal("coherent key/CCS/role substitution against independent raw pin")
	}
	return loadStage(t, path, want)
}
func TestPinnedRaw0Reload(t *testing.T) {
	if _, e := os.Stat("staged-public/raw-v1/D0-00.json"); os.IsNotExist(e) {
		t.Skip("public receipt fixture absent")
	}
	f := buildSettlement(t, false)
	for i, s := range f.raw {
		loadPinnedRaw0(t, fmt.Sprintf("staged-public/raw-v1/leaf-%02d", i), FamilyID{Phase: RawJournal, Kind: s.Kind})
		r := loadPinnedRaw0(t, fmt.Sprintf("staged-public/raw-v1/D0-%02d", i), FamilyID{Phase: RawJournal, Arity: 1})
		st := s.Statement()
		for j := 0; j < 5; j++ {
			if integer(st[j]).Cmp(integer(r.rangeValue.First[j])) != 0 || integer(st[j]).Cmp(integer(r.rangeValue.Last[j])) != 0 {
				t.Fatal("pinned raw proof not current actual journal")
			}
		}
	}
	t.Log("14 genuine raw proofs independently pinned/reloaded; old setup not promoted")
}

func matchesRawApproval(m publicReceipt, pin [4]string, want FamilyID) bool {
	return m.ProofHash == pin[0] && m.VKHash == pin[1] && m.CCSHash == pin[2] && m.PublicHash == pin[3] && m.ID == want
}
func TestRawIndependentApprovalAttacks(t *testing.T) {
	if _, e := os.Stat("staged-public/raw-v1/D0-00.json"); os.IsNotExist(e) {
		t.Skip("public receipt fixture absent")
	}
	wanted := FamilyID{Phase: RawJournal, Kind: 0}
	path := "staged-public/raw-v1/leaf-00"
	loadPinnedRaw0(t, path, wanted)
	b, e := os.ReadFile(path + ".json")
	check(t, e)
	var original publicReceipt
	check(t, json.Unmarshal(b, &original))
	pin := reviewedRaw0[path]
	// Alternative is a GENUINE verified dispatcher proof/VK, not malformed data.
	loadPinnedRaw0(t, "staged-public/raw-v1/D0-00", FamilyID{Phase: RawJournal, Arity: 1})
	other, e := os.ReadFile("staged-public/raw-v1/D0-00.json")
	check(t, e)
	var swapped publicReceipt
	check(t, json.Unmarshal(other, &swapped))
	swapped.ID = wanted
	for _, name := range []string{"coherent-proof-key-substitution", "CCS-version", "role", "public"} {
		m := original
		switch name {
		case "coherent-proof-key-substitution":
			m = swapped
		case "CCS-version":
			m.CCSHash = "different reviewed source/CCS"
		case "role":
			m.ID.Kind = 1
		case "public":
			m.PublicHash = "modified"
		}
		if matchesRawApproval(m, pin, wanted) {
			t.Fatalf("accepted %s", name)
		}
		t.Logf("REJECTED independent approval %s", name)
	}
}

func verifyPinnedRawCircuitIdentity(t *testing.T) {
	f := buildSettlement(t, false)
	for kind := 0; kind < 4; kind++ {
		shape, e := LeafShape(RawJournal, kind)
		check(t, e)
		cc := compile(t, fmt.Sprintf("audited-raw-shape%d", kind), shape)
		h := sha256.New()
		_, e = cc.WriteTo(h)
		check(t, e)
		got := fmt.Sprintf("%x", h.Sum(nil))
		found := false
		for i, s := range f.raw {
			if s.Kind == kind {
				pin := reviewedRaw0[fmt.Sprintf("staged-public/raw-v1/leaf-%02d", i)]
				if got != pin[2] {
					t.Fatalf("raw kind%d CCS differs from pinned setup: got%s want%s", kind, got, pin[2])
				}
				found = true
			}
		}
		if !found {
			t.Fatal("missing real kind")
		}
		t.Logf("MATCHED audited raw kind=%d CCS=%s", kind, got)
		cc = nil
		runtime.GC()
	}
	keys := make([]Key, 4)
	var first familyReceipt
	for i, step := range f.raw {
		r := loadPinnedRaw0(t, fmt.Sprintf("staged-public/raw-v1/leaf-%02d", i), FamilyID{Phase: RawJournal, Kind: step.Kind})
		keys[step.Kind] = r.auth.Keys[0]
		if i == 0 {
			first = r
		}
	}
	c := stageNode(RawJournal, 1, []familyReceipt{first}, keys, []int{0})
	cc := compile(t, "audited-raw-D0", c)
	h := sha256.New()
	_, e := cc.WriteTo(h)
	check(t, e)
	got := fmt.Sprintf("%x", h.Sum(nil))
	if got != reviewedRaw0["staged-public/raw-v1/D0-00"][2] {
		t.Fatal("raw D0 CCS differs from independent approved setup")
	}
	t.Logf("MATCHED audited raw D0 CCS=%s", got)

}

func TestPinnedRawCircuitIdentity(t *testing.T) {
	if os.Getenv("CHECK_RAW_IMPORT") != "1" {
		t.Skip("explicit audited public migration check")
	}
	verifyPinnedRawCircuitIdentity(t)
}
