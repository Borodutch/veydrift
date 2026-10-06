package rawbridge

import (
	"encoding/hex"
	"os/exec"
	"strings"
	"testing"
)

func dec(w U) string  { return Integer(w).String() }
func hx(w U) string   { return "0x" + hex.EncodeToString(Encode(w)) }
func addr(w U) string { b := Encode(w); return "0x" + hex.EncodeToString(b[12:]) }
func cast(t *testing.T, sig string, args ...string) []byte {
	t.Helper()
	cmd := exec.Command("cast", append([]string{"abi-encode", sig}, args...)...)
	o, e := cmd.CombinedOutput()
	if e != nil {
		t.Fatalf("cast %v: %s", e, o)
	}
	b, e := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(string(o)), "0x"))
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func TestSolidityABIInterop(t *testing.T) {
	if _, e := exec.LookPath("cast"); e != nil {
		t.Skip("cast unavailable; offline pinned ABI test requires Foundry cast")
	}
	m, h, events := Fixture(t)
	i := m.Preparation.Identity
	hs := []string{dec(h[0]), "false", dec(h[2]), "false", dec(h[4]), addr(h[5]), "false", dec(h[7]), dec(h[8]), "(" + dec(h[9]) + "," + dec(h[10]) + "," + dec(h[11]) + ")", "(" + dec(h[12]) + "," + dec(h[13]) + "," + dec(h[14]) + ")", dec(h[15])}
	hb := cast(t, "f(uint256,bool,uint64,bool,uint64,address,bool,uint256,uint256,(uint128,uint128,uint128),(uint128,uint128,uint128),uint16)", hs...)
	if hex.EncodeToString(hb) != hex.EncodeToString(Encode(h[:]...)) {
		t.Fatal("header ABI")
	}
	version := "(" + dec(m.Version) + "," + hx(i.Rules) + "," + hx(i.Catalog) + "," + addr(i.Verifier) + "," + hx(m.Codehash) + ")"
	begin := cast(t, "f(bytes32,uint256,address,uint256,(uint32,bytes32,bytes32,address,bytes32),address,uint256,bytes32,bytes)", hx(Domain(RawDomain)), dec(i.Chain), addr(i.Game), dec(i.Battle), version, addr(m.Engine), dec(m.RequestID), hx(m.Purpose), "0x"+hex.EncodeToString(hb))
	if hex.EncodeToString(begin) != hex.EncodeToString(Encode(HeaderWords(m, h)...)) {
		t.Fatal("begin ABI offsets/tuple")
	}
	previous := Digest(HeaderWords(m, h)...)
	for _, e := range events {
		if e.Kind == Source {
			mission := e.Mission
			ship := []string{}
			for j := 12; j < 26; j++ {
				ship = append(ship, dec(mission[j]))
			}
			arg := "(" + dec(mission[0]) + "," + dec(mission[1]) + "," + addr(mission[2]) + "," + dec(mission[3]) + "," + dec(mission[4]) + "," + dec(mission[5]) + "," + dec(mission[6]) + "," + dec(mission[7]) + "," + dec(mission[8]) + ",(" + dec(mission[9]) + "," + dec(mission[10]) + "," + dec(mission[11]) + "),(" + strings.Join(ship, ",") + ")," + dec(mission[26]) + ",(" + dec(mission[27]) + "," + dec(mission[28]) + "," + dec(mission[29]) + "),false,false)"
			mb := cast(t, "f((uint8,uint8,address,uint256,uint256,uint64,uint64,uint64,uint128,(uint128,uint128,uint128),(uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32),uint256,(uint16,uint16,uint16),bool,bool))", arg)
			if hex.EncodeToString(mb) != hex.EncodeToString(Encode(mission[:]...)) {
				t.Fatal("mission layout")
			}
			source := cast(t, "f(bytes32,uint8,uint256,bytes)", hx(previous), "1", dec(e.SourceID), "0x"+hex.EncodeToString(mb))
			if hex.EncodeToString(source) != hex.EncodeToString(Encode(SourceWords(previous, e.SourceID, mission)...)) {
				t.Fatal("source ABI")
			}
		}
	}
	steps, err := Build(m, h, events)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range steps {
		if s.Kind == Row {
			r := s.Row
			arg := "(" + dec(r.Source) + "," + addr(r.Owner) + "," + dec(r.Count) + "," + scalar(r.Side).String() + "," + scalar(r.Type).String() + "," + scalar(r.Tech.Weapons).String() + "," + scalar(r.Tech.Shielding).String() + "," + scalar(r.Tech.Armor).String() + ")"
			b := cast(t, "f(bytes32,uint8,uint256,(uint256,address,uint32,uint8,uint8,uint16,uint16,uint16))", hx(s.Before.Journal), "2", dec(s.Before.Rows), arg)
			if hex.EncodeToString(b) != hex.EncodeToString(Encode(RowWords(s.Before.Journal, s.Before.Rows, r)...)) {
				t.Fatal("row ABI")
			}
		}
	}
	last := steps[len(steps)-1]
	sealed := cast(t, "f(bytes32,uint8,uint256)", hx(last.Before.Journal), "3", dec(last.Before.Rows))
	o, e := exec.Command("cast", "keccak", "0x"+hex.EncodeToString(sealed)).CombinedOutput()
	if e != nil {
		t.Fatal(e, string(o))
	}
	if strings.TrimSpace(string(o)) != hx(last.After.Journal) {
		t.Fatal("seal digest")
	}
	t.Logf("independent cast ABI all record kinds; snapshot=%s", hx(last.After.Journal))
}
