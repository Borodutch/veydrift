//go:build !plonk_experiment

package aggregation

import (
	"bytes"
	battle "github.com/Borodutch/veydrift/packages/battle-prover/battle"
	"github.com/consensys/gnark/backend"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/backend/solidity"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	recursive "github.com/consensys/gnark/std/recursion/groth16"
	"os"
	"runtime"
	"testing"
	"time"
)

// A bounded composition fixture. Each embedded committed transition actually
// executes the battle circuit; endpoints are private except seven root fields.
// A compile-time RNG schedule fixes this fixture's circuit, NOT its values.
// General instruction scheduling and variable memory remain separate work.
type combatBatch struct {
	Range
	Steps []combatPrivateStep
}
type combatPrivateStep struct {
	Context, BeforeRoot, AfterRoot, Start, End, BeforeDone, AfterDone frontend.Variable
	Seed                                                              [32]frontend.Variable
	Before, After                                                     [battle.StateSize]frontend.Variable
	Config                                                            battle.Config `gnark:"-"`
	RNG                                                               bool          `gnark:"-"`
}

func (c combatPrivateStep) Define(api frontend.API) error {
	inner := battle.CommittedStep{Context: c.Context, BeforeRoot: c.BeforeRoot, AfterRoot: c.AfterRoot, Start: c.Start, End: c.End, BeforeDone: c.BeforeDone, AfterDone: c.AfterDone, Seed: c.Seed, Before: c.Before, After: c.After, Config: c.Config, RNG: c.RNG}
	return inner.Define(api)
}
func (c *combatBatch) Define(api frontend.API) error {
	c.bound(api)
	for i := range c.Steps {
		x := &c.Steps[i]
		if e := x.Define(api); e != nil {
			return e
		}
		api.AssertIsEqual(x.Context, c.Context)
		if i == 0 {
			api.AssertIsEqual(x.BeforeRoot, c.Before)
			api.AssertIsEqual(x.Start, c.Start)
			api.AssertIsEqual(x.BeforeDone, c.BeforeDone)
		} else {
			prev := &c.Steps[i-1]
			api.AssertIsEqual(x.BeforeRoot, prev.AfterRoot)
			api.AssertIsEqual(x.Start, prev.End)
			api.AssertIsEqual(x.BeforeDone, prev.AfterDone)
		}
	}
	last := &c.Steps[len(c.Steps)-1]
	api.AssertIsEqual(last.AfterRoot, c.After)
	api.AssertIsEqual(last.End, c.End)
	api.AssertIsEqual(last.AfterDone, c.AfterDone)
	return nil
}
func combatConfig() battle.Config {
	var c battle.Config
	for i := range c.Units {
		c.Units[i] = battle.UnitSpec{Side: uint64(i / 2), Type: uint64(i), Base: [3]uint64{1000, 0, 1}}
		c.Units[i].Owner[19] = byte(i + 1)
		c.Units[i].Source[31] = byte(i + 1)
		for j := range c.RF[i] {
			c.RF[i][j] = 1
		}
	}
	return c
}
func combatAssignment(c battle.Config, ss []battle.State) *combatBatch {
	out := &combatBatch{Steps: make([]combatPrivateStep, len(ss)-1)}
	for i := range out.Steps {
		x := battle.CommittedAssignment(c, [32]byte{}, ss[i], ss[i+1], battle.IsRandom(c, ss[i]))
		out.Steps[i] = combatPrivateStep{x.Context, x.BeforeRoot, x.AfterRoot, x.Start, x.End, x.BeforeDone, x.AfterDone, x.Seed, x.Before, x.After, x.Config, x.RNG}
	}
	a, b := out.Steps[0], out.Steps[len(out.Steps)-1]
	out.Range = Range{a.Context, a.BeforeRoot, b.AfterRoot, a.Start, b.End, a.BeforeDone, b.AfterDone}
	return out
}
func TestActualCombatRecursiveProof(t *testing.T) {
	if os.Getenv("RUN_COMBAT_AGGREGATION") != "1" {
		t.Skip("opt-in RUN_COMBAT_AGGREGATION=1")
	}
	if runtime.GOMAXPROCS(0) > 2 {
		t.Fatal("GOMAXPROCS must be <=2")
	}
	started := time.Now()
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
	if ss[len(ss)-1].Phase != battle.Done {
		t.Fatal("bounded fixture incomplete")
	}
	assignment := combatAssignment(c, ss)
	// Compile-time config/RNG flags survive schema parsing; private step values
	// are not constants and are supplied independently in the witness.
	template := &combatBatch{Steps: make([]combatPrivateStep, len(assignment.Steps))}
	for i := range template.Steps {
		template.Steps[i].Config = c
		template.Steps[i].RNG = assignment.Steps[i].RNG
	}
	cc := compiled(t, template)
	if cc.GetNbPublicVariables()-1 != 7 {
		t.Fatal("private embedded public fields leaked into outer schema")
	}
	leaf := setup(t, cc)
	r := prove(t, leaf, assignment, Statement{Start: 0, End: len(ss) - 1, Count: len(ss) - 1})
	wrapper := &RangeFinal{Key: key(t, leaf), Genesis: assignment.Before, Proof: recursive.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](cc), Witness: recursive.PlaceholderWitness[sw_bn254.ScalarField](cc)}
	finalCC := compiled(t, wrapper)
	final := setup(t, finalCC)
	full := wit(t, &RangeFinal{Range: assignment.Range, Proof: r.p, Witness: r.w})
	pub, e := full.Public()
	check(t, e)
	p, e := groth16.Prove(finalCC, final.pk, full, solidity.WithProverTargetSolidityVerifier(backend.GROTH16))
	check(t, e)
	check(t, groth16.Verify(p, final.vk, pub, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)))
	var b bytes.Buffer
	_, e = p.WriteTo(&b)
	check(t, e)
	t.Logf("ACTUAL COMBAT RECURSIVELY VERIFIED transitions=%d public=7 proof_bytes=%d rounds=%d outcome=%d time=%s", len(ss)-1, b.Len(), ss[len(ss)-1].Round, ss[len(ss)-1].Outcome, time.Since(started))
}
