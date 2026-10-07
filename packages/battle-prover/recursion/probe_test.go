package recursion

import (
	"bytes"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/backend/solidity"
	"github.com/consensys/gnark/backend/witness"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	recursive "github.com/consensys/gnark/std/recursion/groth16"
	"os"
	"testing"
	"time"
)

func check(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func statement(start, before uint64) Statement {
	return Statement{Job: 44, Seed: 123, Rules: 1, Start: start, Before: before, End: start + 1, After: before + 1}
}
func witnessFor(t *testing.T, c frontend.Circuit) witness.Witness {
	t.Helper()
	w, e := frontend.NewWitness(c, ecc.BN254.ScalarField())
	check(t, e)
	return w
}
func TestStep(t *testing.T) {
	c, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &Step{})
	check(t, e)
	check(t, c.IsSolved(witnessFor(t, &Step{statement(0, 10)})))
	for _, s := range []Statement{
		{44, 123, 1, 0, 10, 1, 12},                 // arbitrary output
		{44, 123, 1, 0, 10, 2, 11},                 // skipped counter
		{44, 123, 1, 0, 4294967295, 1, 4294967296}, // overflow
		{44, 123, 1, 4294967295, 10, 4294967296, 11},
		{0, 123, 1, 0, 10, 1, 11},
	} {
		if c.IsSolved(witnessFor(t, &Step{s})) == nil {
			t.Fatal("invalid step accepted")
		}
	}
	t.Logf("step constraints=%d", c.GetNbConstraints())
}
func proveStep(t *testing.T, c constraint.ConstraintSystem, pk groth16.ProvingKey, vk groth16.VerifyingKey, s Statement) (Proof, Witness) {
	t.Helper()
	w := witnessFor(t, &Step{s})
	pub, e := w.Public()
	check(t, e)
	p, e := groth16.Prove(c, pk, w)
	check(t, e)
	check(t, groth16.Verify(p, vk, pub))
	cp, e := recursive.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](p)
	check(t, e)
	cw, e := recursive.ValueOfWitness[sw_bn254.ScalarField](pub)
	check(t, e)
	return cp, cw
}

// Explicitly opt in: this performs a real, large non-native recursive setup and
// proof, not merely test.IsSolved. Setup here is DEVELOPMENT ONLY, never ceremony.
func TestRecursivePair(t *testing.T) {
	if testing.Short() || os.Getenv("RUN_RECURSION_PROBE") != "1" {
		t.Skip("set RUN_RECURSION_PROBE=1 for genuine recursive proof")
	}
	start := time.Now()
	leaf, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &Step{})
	check(t, e)
	pk, vk, e := groth16.Setup(leaf)
	check(t, e)
	key, e := recursive.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](vk)
	check(t, e)
	template := &Pair{Key: key}
	assignment := &Pair{Statement: Statement{44, 123, 1, 0, 10, 2, 12}}
	for i := 0; i < 2; i++ {
		template.Proofs[i] = recursive.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](leaf)
		template.Witnesses[i] = recursive.PlaceholderWitness[sw_bn254.ScalarField](leaf)
		assignment.Proofs[i], assignment.Witnesses[i] = proveStep(t, leaf, pk, vk, statement(uint64(i), uint64(10+i)))
	}
	compileStart := time.Now()
	outer, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, template)
	check(t, e)
	t.Logf("outer constraints=%d compile=%s", outer.GetNbConstraints(), time.Since(compileStart))
	// Fail closed before allocating setup for an unexpectedly expanded circuit.
	if outer.GetNbConstraints() > 4000000 {
		t.Fatal("probe exceeds configured 4M constraint resource budget")
	}
	w := witnessFor(t, assignment)
	check(t, outer.IsSolved(w))
	reject := func(name string, bad Pair) {
		t.Helper()
		t.Run(name, func(t *testing.T) {
			if outer.IsSolved(witnessFor(t, &bad)) == nil {
				t.Fatal("malicious aggregation accepted")
			}
		})
	}
	bad := *assignment
	bad.After = 13
	reject("altered_output", bad)
	bad = *assignment
	bad.Seed = 124
	reject("altered_seed", bad)
	bad = *assignment
	bad.Rules = 2
	reject("altered_rules", bad)
	bad = *assignment
	bad.Job = 45
	reject("different_job", bad)
	bad = *assignment
	bad.Start = 1
	reject("wrong_initial_counter", bad)
	bad = *assignment
	bad.Before = 9
	reject("wrong_initial_state", bad)
	bad = *assignment
	bad.End = 1
	reject("premature_terminal_counter", bad)
	bad = *assignment
	bad.Proofs[1] = bad.Proofs[0]
	bad.Witnesses[1] = bad.Witnesses[0]
	reject("replayed_chunk", bad)
	bad = *assignment
	bad.Proofs[0], bad.Proofs[1] = bad.Proofs[1], bad.Proofs[0]
	bad.Witnesses[0], bad.Witnesses[1] = bad.Witnesses[1], bad.Witnesses[0]
	reject("reordered_chunks", bad)
	bad = *assignment
	bad.Proofs[1], bad.Witnesses[1] = proveStep(t, leaf, pk, vk, statement(2, 11))
	bad.End = 3
	reject("skipped_chunk", bad)
	bad = *assignment
	bad.Proofs[1], bad.Witnesses[1] = proveStep(t, leaf, pk, vk, statement(1, 100))
	bad.After = 101
	reject("discontinuous_state", bad)
	// A genuine proof under a different setup key is invalid under the compiled key.
	otherPK, otherVK, e := groth16.Setup(leaf)
	check(t, e)
	bad = *assignment
	bad.Proofs[1], bad.Witnesses[1] = proveStep(t, leaf, otherPK, otherVK, statement(1, 11))
	reject("unapproved_verification_key", bad)
	setupStart := time.Now()
	outerPK, outerVK, e := groth16.Setup(outer)
	check(t, e)
	t.Logf("outer development setup=%s", time.Since(setupStart))
	proveStart := time.Now()
	proof, e := groth16.Prove(outer, outerPK, w, solidity.WithProverTargetSolidityVerifier(backend.GROTH16))
	check(t, e)
	t.Logf("outer genuine proving=%s", time.Since(proveStart))
	pub, e := w.Public()
	check(t, e)
	verifyStart := time.Now()
	check(t, groth16.Verify(proof, outerVK, pub, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)))
	t.Logf("outer native verification=%s", time.Since(verifyStart))
	var encoded bytes.Buffer
	n, e := proof.WriteTo(&encoded)
	check(t, e)
	t.Logf("serialized proof bytes=%d public scalars=%d total=%s", n, outer.GetNbPublicVariables()-1, time.Since(start))
	altered := *assignment
	altered.After = 13
	alteredPub, e := witnessFor(t, &altered).Public()
	check(t, e)
	if groth16.Verify(proof, outerVK, alteredPub, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)) == nil {
		t.Fatal("verified proof against altered output")
	}
	// Exportability only: this does NOT measure EVM execution/gas or deploy anything.
	var exported bytes.Buffer
	check(t, outerVK.ExportSolidity(&exported))
	t.Logf("exported Solidity verifier bytes=%d", exported.Len())
}
