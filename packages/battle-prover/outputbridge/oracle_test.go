package outputbridge

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"os/exec"
	"testing"
	"time"
)

func hexWord(w U) string { return fmt.Sprintf("0x%064x", number(w)) }
func TestIndependentOracleAndSolidityABI(t *testing.T) {
	f := build(t, false)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	data, e := exec.CommandContext(ctx, "bun", "oracle-fixture.ts", hexWord(f.m.Manifest.ChainRecord)).CombinedOutput()
	if e != nil {
		t.Fatalf("independent oracle: %v: %s", e, data)
	}
	var got struct {
		Root, Tail      string
		Outcome, Rounds uint64
		Nodes           []struct {
			Index, Cohort, Side, Type, Initial, Lost, Survivors uint64
			Owner, Source, Next, Hash, Words                    string
		}
	}
	check(t, json.Unmarshal(data, &got))
	if got.Root != hexWord(f.m.Manifest.Root) || got.Tail != hexWord(Tail(f.m.Manifest.ChainRecord, f.m.Manifest.Context.Prepared.Members)) || len(got.Nodes) != len(f.m.Leaves) {
		t.Fatal("oracle root/tail/count mismatch")
	}
	if got.Outcome != number(f.m.Manifest.Context.Combat.Outcome).Uint64() || got.Rounds != number(f.m.Manifest.Context.Combat.Round).Uint64() {
		t.Fatal("oracle combat summary mismatch")
	}
	for i, l := range f.m.Leaves {
		g := got.Nodes[i]
		if g.Index != number(l.Index).Uint64() || g.Cohort != number(l.Cohort).Uint64() || g.Side != scalar(l.Side).Uint64() || g.Type != scalar(l.Unit).Uint64() || g.Initial != scalar(l.Count).Uint64() || g.Lost != scalar(l.Lost).Uint64() || g.Survivors != scalar(l.Survivors).Uint64() || g.Owner != fmt.Sprintf("0x%040x", number(l.Owner)) || g.Source != number(l.Source).String() || g.Next != hexWord(l.Next) || g.Hash != hexWord(l.Digest(f.m.Manifest.ChainRecord)) {
			t.Fatalf("oracle leaf %d mismatch", i)
		}
		want := "0x" + hex.EncodeToString(raw.Encode(l.Words(f.m.Manifest.ChainRecord)...))
		if len(want) != 2+384*2 || g.Words != want {
			t.Fatalf("ABI word mismatch %d", i)
		}
	}
	t.Logf("binding=%s root=%s tail=%s rows=%d", hexWord(f.m.Manifest.ChainRecord), got.Root, got.Tail, len(got.Nodes))
}
