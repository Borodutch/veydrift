package attribution

import (
	"encoding/json"
	"math/big"
	"os"
	"testing"
)

func TestCandidate2OracleFixtures(t *testing.T) {
	var fs []struct {
		Rules   string
		Loss    int
		Members []struct {
			Owner, Source string
			Quantity      uint64
		}
		Allocation []struct {
			Side, Type               uint64
			Owner, Source            string
			Initial, Lost, Survivors uint32
		}
	}
	data, e := os.ReadFile("oracle-candidate2.json")
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(data, &fs); e != nil {
		t.Fatal(e)
	}
	if len(fs) != 6 {
		t.Fatal("fixture coverage")
	}
	for _, f := range fs {
		if f.Rules != "veydrift-individual-shot-candidate-2" {
			t.Fatal("rules mismatch")
		}
		var ms []Member
		total := 0
		for _, x := range f.Members {
			owner, ok := new(big.Int).SetString(x.Owner[2:], 16)
			if !ok {
				t.Fatal("owner")
			}
			source, ok := new(big.Int).SetString(x.Source, 10)
			if !ok {
				t.Fatal("source")
			}
			ms = append(ms, Member{Big(owner), Big(source), x.Quantity})
			total += int(x.Quantity)
		}
		ds := make([]bool, total)
		for i := 0; i < f.Loss; i++ {
			ds[i] = true
		}
		m, e := Prepare(context(), ms, ds)
		if e != nil {
			t.Fatal(e)
		}
		run(t, m, nil)
		if len(m.Rows) != len(f.Allocation) {
			t.Fatal("member coverage")
		}
		for i, r := range m.Rows {
			want := f.Allocation[i]
			owner, _ := new(big.Int).SetString(want.Owner[2:], 16)
			if number(r.Member.Owner).Cmp(owner) != 0 || number(r.Member.Source).String() != want.Source || integer(r.Member.Quantity).Uint64() != uint64(want.Initial) || r.Lost != want.Lost || r.Survivors != want.Survivors || want.Side != 0 || want.Type != 7 {
				t.Fatalf("loss=%d row=%d mismatch", f.Loss, i)
			}
		}
	}
}
