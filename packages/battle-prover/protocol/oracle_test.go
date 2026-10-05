package protocol

import (
	"context"
	"encoding/json"
	"math/big"
	"os/exec"
	"testing"
	"time"
)

func integer(s string) *big.Int {
	n, ok := new(big.Int).SetString(s, 10)
	if !ok {
		panic(s)
	}
	return n
}
func flag(b bool) int {
	if b {
		return 1
	}
	return 0
}
func TestLiveTypeScriptOracle(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out, e := exec.CommandContext(ctx, "bun", "run", "oracle-boundary.ts").CombinedOutput()
	if e != nil {
		t.Fatalf("oracle required: %v %s", e, out)
	}
	var rows struct {
		EffectiveRows []struct {
			Base, Result string
			Tech         int
			Valid        bool
		}
		HitRows []struct {
			Attack, MaxShield, MaxHull, Shield, Hull, Draw, AfterShield, AfterHull string
			Bounced, Eligible, Exploded                                            bool
		}
	}
	if e = json.Unmarshal(out, &rows); e != nil {
		t.Fatal(e)
	}
	ec := compile(t, &effectiveCircuit{})
	for _, r := range rows.EffectiveRows {
		n := mul(integer(r.Base), big.NewInt(int64(10+r.Tech)))
		rem := new(big.Int).Mod(n, big.NewInt(10))
		w := effectiveCircuit{MustValue(integer(r.Base)), MustValue(integer(r.Result)), r.Tech, rem}
		solve(t, ec, &w, r.Valid)
	}
	hc := compile(t, &HitCircuit{})
	for i, r := range rows.HitRows {
		t.Run(big.NewInt(int64(i)).String(), func(t *testing.T) {
			w := HitCircuit{Attack: MustValue(integer(r.Attack)), MaxShield: MustValue(integer(r.MaxShield)), MaxHull: MustValue(integer(r.MaxHull)), Shield: MustValue(integer(r.Shield)), Hull: MustValue(integer(r.Hull)), Draw: MustValue(integer(r.Draw)), AfterShield: MustValue(integer(r.AfterShield)), AfterHull: MustValue(integer(r.AfterHull)), Bounced: flag(r.Bounced), Eligible: flag(r.Eligible), Exploded: flag(r.Exploded)}
			solve(t, hc, &w, true)
			bad := w
			bad.Bounced = 1 - flag(r.Bounced)
			solve(t, hc, &bad, false)
			bad = w
			bad.Eligible = 1 - flag(r.Eligible)
			solve(t, hc, &bad, false)
			bad = w
			bad.Exploded = 1 - flag(r.Exploded)
			solve(t, hc, &bad, false)
			bad = w
			bad.AfterHull = MustValue(new(big.Int).Xor(integer(r.AfterHull), big.NewInt(1)))
			solve(t, hc, &bad, false)
			bad = w
			bad.AfterShield = MustValue(new(big.Int).Xor(integer(r.AfterShield), big.NewInt(1)))
			solve(t, hc, &bad, false)
			bad = w
			if r.Eligible {
				bad.Draw = w.MaxHull
			} else {
				bad.Draw = Const(1)
			}
			solve(t, hc, &bad, false)
		})
	}
	t.Logf("live oracle: %d scaling rows, %d hit rows", len(rows.EffectiveRows), len(rows.HitRows))
}
