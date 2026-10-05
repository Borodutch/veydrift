//go:build !plonk_experiment

package aggregation

import (
	"bytes"
	"crypto/sha256"
	"math/big"
	"os"
	"runtime"
	"runtime/debug"
	"testing"
	"time"

	battle "github.com/Borodutch/veydrift/packages/battle-prover/battle"
	"github.com/consensys/gnark/backend"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/backend/solidity"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	recursive "github.com/consensys/gnark/std/recursion/groth16"
)

func combatTrace(t *testing.T) (battle.Config, []battle.State) {
	t.Helper()
	c := combatConfig()
	ss := []battle.State{{}}
	for len(ss) < 128 {
		next, e := c.Next([32]byte{}, ss[len(ss)-1])
		check(t, e)
		ss = append(ss, next)
		if next.Phase == battle.Done {
			break
		}
	}
	if len(ss) != 31 || ss[30].Phase != battle.Done || ss[30].Outcome != 1 || ss[30].Round != 1 {
		t.Fatal("expected complete 30-transition one-round attacker-win fixture")
	}
	return c, ss
}

func combatTemplate(a *combatBatch) *combatBatch {
	c := &combatBatch{Steps: make([]combatPrivateStep, len(a.Steps))}
	for i := range c.Steps {
		c.Steps[i].Config = a.Steps[i].Config
		c.Steps[i].RNG = a.Steps[i].RNG
	}
	return c
}

func rejectCombat(t *testing.T, l level, name string, a frontend.Circuit) {
	t.Helper()
	if l.cc.IsSolved(wit(t, a)) == nil {
		t.Fatalf("accepted %s", name)
	}
	t.Logf("REJECTED %s (compiled recursive constraints, not generated negative proof)", name)
}

// Genuine combat chunk proofs -> genuine RangePair proof -> genuine RangeFinal
// proof. All keys are development-only, compile-time approved and memory-only.
// This fixed four-slot trace/schedule is NOT arbitrary-fleet aggregation.
func TestActualCombatMultiChunkRecursiveProof(t *testing.T) {
	if os.Getenv("RUN_COMBAT_MULTICHUNK") != "1" {
		t.Skip("opt-in RUN_COMBAT_MULTICHUNK=1")
	}
	if runtime.GOMAXPROCS(0) > 2 {
		t.Fatal("GOMAXPROCS must be <=2")
	}
	if limit := debug.SetMemoryLimit(-1); limit <= 0 || limit > 6<<30 {
		t.Fatal("set a soft GOMEMLIMIT <=6GiB")
	}
	started := time.Now()
	c, ss := combatTrace(t)
	t.Logf("RESOURCE GOMAXPROCS=%d soft_GOMEMLIMIT=%d per_circuit_ceiling=4000000", runtime.GOMAXPROCS(0), debug.SetMemoryLimit(-1))
	t.Logf("FIXTURE context_digest=%x terminal=%+v", c.Digest(), ss[30])
	chunks := [2]*combatBatch{combatAssignment(c, ss[:16]), combatAssignment(c, ss[15:])}
	pairTemplate := &RangePair{}
	pairAssignment := &RangePair{Range: Range{chunks[0].Context, chunks[0].Before, chunks[1].After, 0, 30, 0, 1}}
	var unapproved receipt
	// Release each large setup before allocating the next. Only compact keys,
	// proofs and public witnesses cross levels; no setup artifacts are persisted.
	for i, a := range chunks {
		l := setup(t, compiled(t, combatTemplate(a)))
		if l.cc.GetNbPublicVariables()-1 != 7 {
			t.Fatal("chunk public schema")
		}
		r := prove(t, l, a, Statement{Start: i * 15, End: (i + 1) * 15, Count: 15})
		pairTemplate.Keys[i] = key(t, l)
		pairTemplate.Proofs[i] = recursive.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](l.cc)
		pairTemplate.Witnesses[i] = recursive.PlaceholderWitness[sw_bn254.ScalarField](l.cc)
		pairAssignment.Proofs[i] = r.p
		pairAssignment.Witnesses[i] = r.w
		bad := *a
		bad.Steps = append([]combatPrivateStep(nil), a.Steps...)
		if i == 0 {
			bad.Steps[2].Before[8] = 999
			rejectCombat(t, l, "chunk stale private state", &bad)
			// Same circuit/public input, different real setup: not a malformed point.
			other := setup(t, l.cc)
			unapproved = prove(t, other, a, Statement{Start: 0, End: 15, Count: 15})
		} else {
			bad.Steps[len(bad.Steps)-1].After[battle.StateSize-1] = 2
			rejectCombat(t, l, "chunk terminal result mutation", &bad)
		}
		t.Logf("CHUNK VERIFIED index=%d start=%d end=%d", i, i*15, (i+1)*15)
		runtime.GC()
	}
	pair := setup(t, compiled(t, pairTemplate))
	if pair.cc.GetNbPublicVariables()-1 != 7 {
		t.Fatal("pair public schema")
	}
	// Mutated statements and replay test the actual pinned verifier. Valid
	// disconnected child proofs are exercised separately by the adapter tests.
	badPair := *pairAssignment
	badPair.After = 1
	rejectCombat(t, pair, "pair output", &badPair)
	badPair = *pairAssignment
	badPair.Context = 1
	rejectCombat(t, pair, "pair context", &badPair)
	badPair = *pairAssignment
	badPair.Proofs[1] = badPair.Proofs[0]
	badPair.Witnesses[1] = badPair.Witnesses[0]
	rejectCombat(t, pair, "pair replay", &badPair)
	badPair = *pairAssignment
	badPair.Proofs[0] = unapproved.p
	badPair.Witnesses[0] = unapproved.w
	rejectCombat(t, pair, "pair unapproved actual-combat key", &badPair)
	root := prove(t, pair, pairAssignment, Statement{Start: 0, End: 30, Count: 30})
	t.Log("PAIR RECURSIVE PROOF VERIFIED chunks=2 transitions=30")
	finalTemplate := &RangeFinal{Key: key(t, pair), Genesis: chunks[0].Before, Proof: recursive.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](pair.cc), Witness: recursive.PlaceholderWitness[sw_bn254.ScalarField](pair.cc)}
	pair = level{}
	pairTemplate = nil
	unapproved = receipt{}
	runtime.GC()
	final := setup(t, compiled(t, finalTemplate))
	if final.cc.GetNbPublicVariables()-1 != 7 {
		t.Fatal("final public schema")
	}
	a := &RangeFinal{Range: pairAssignment.Range, Proof: root.p, Witness: root.w}
	for _, name := range []string{"genesis", "terminal", "nonzero start", "empty execution", "result"} {
		bad := *a
		switch name {
		case "genesis":
			bad.Before = 1
		case "terminal":
			bad.AfterDone = 0
		case "nonzero start":
			bad.Start = 15
		case "empty execution":
			bad.End = 0
		case "result":
			bad.After = 1
		}
		rejectCombat(t, final, "final "+name, &bad)
	}
	full := wit(t, a)
	pub, e := full.Public()
	check(t, e)
	p, e := groth16.Prove(final.cc, final.pk, full, solidity.WithProverTargetSolidityVerifier(backend.GROTH16))
	check(t, e)
	check(t, groth16.Verify(p, final.vk, pub, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)))
	// Independently open the terminal result into the exact committed state;
	// changed outcomes must not verify under the already generated final proof.
	altered := ss[30]
	altered.Outcome = 2
	changed := battle.CommittedAssignment(c, [32]byte{}, ss[29], altered, battle.IsRandom(c, ss[29]))
	if changed.AfterRoot.(*big.Int).Cmp(chunks[1].After.(*big.Int)) == 0 {
		t.Fatal("result opening collision")
	}
	bad := *a
	bad.After = changed.AfterRoot
	badPublic, e := wit(t, &bad).Public()
	check(t, e)
	if groth16.Verify(p, final.vk, badPublic, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)) == nil {
		t.Fatal("altered terminal result opening verified")
	}
	t.Log("REJECTED changed outcome commitment against generated final proof")
	var b bytes.Buffer
	_, e = p.WriteTo(&b)
	check(t, e)
	t.Logf("MULTI-CHUNK ACTUAL COMBAT FINAL VERIFIED chunks=2 transitions=30 public=7 proof_bytes=%d proof_sha256=%x rounds=%d outcome=%d time=%s", b.Len(), sha256.Sum256(b.Bytes()), ss[30].Round, ss[30].Outcome, time.Since(started))
}
