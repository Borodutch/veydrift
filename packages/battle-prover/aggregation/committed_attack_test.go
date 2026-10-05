//go:build !plonk_experiment

package aggregation

import (
	"math/big"
	"testing"

	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	recursive "github.com/consensys/gnark/std/recursion/groth16"
)

// Deliberately permissive leaf: authenticates a bounded statement, not a VM.
// Genuine proofs here isolate RangePair/RangeFinal guards; they do NOT prove
// any battle execution. Both slots use one key, so replay/reorder failures
// cannot be accidentally credited to heterogeneous-key mismatch.
type adversarialRange struct{ Range }

func (c *adversarialRange) Define(api frontend.API) error { c.bound(api); return nil }

func TestCommittedRangeAuthenticatedAttacks(t *testing.T) {
	if testing.Short() {
		t.Skip("recursive verifier compilation")
	}
	leaf := setup(t, compiled(t, &adversarialRange{}))
	makeProof := func(r Range) receipt {
		return prove(t, leaf, &adversarialRange{r}, Statement{Start: r.Start, End: r.End, Count: 1})
	}
	// More than one limb; equality must preserve every scalar bit.
	context := new(big.Int).Lsh(big.NewInt(1), 200)
	genesis := new(big.Int).Lsh(big.NewInt(1), 180)
	middle := new(big.Int).Add(genesis, big.NewInt(1))
	terminal := new(big.Int).Add(genesis, big.NewInt(2))
	a := Range{context, genesis, middle, 0, 1, 0, 0}
	b := Range{context, middle, terminal, 1, 2, 0, 1}
	ap, bp := makeProof(a), makeProof(b)
	template := &RangePair{Keys: [2]VerifyingKey{key(t, leaf), key(t, leaf)}}
	for i := range template.Proofs {
		template.Proofs[i] = recursive.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](leaf.cc)
		template.Witnesses[i] = recursive.PlaceholderWitness[sw_bn254.ScalarField](leaf.cc)
	}
	pair := level{cc: compiled(t, template)}
	outer := Range{context, genesis, terminal, 0, 2, 0, 1}
	assignment := &RangePair{Range: outer, Proofs: [2]Proof{ap.p, bp.p}, Witnesses: [2]Witness{ap.w, bp.w}}
	check(t, pair.cc.IsSolved(wit(t, assignment)))
	for _, name := range []string{"state discontinuity", "counter discontinuity", "terminal discontinuity", "context discontinuity"} {
		altered := b
		switch name {
		case "state discontinuity":
			altered.Before = new(big.Int).Add(middle, new(big.Int).Lsh(big.NewInt(1), 100))
		case "counter discontinuity":
			altered.Start = 0
		case "terminal discontinuity":
			altered.BeforeDone = 1
		case "context discontinuity":
			altered.Context = new(big.Int).Add(context, big.NewInt(1))
		}
		proof := makeProof(altered)
		bad := *assignment
		bad.Proofs[1] = proof.p
		bad.Witnesses[1] = proof.w
		rejectCombat(t, pair, name+" with genuine approved-key child", &bad)
	}
	bad := *assignment
	bad.Proofs[1] = ap.p
	bad.Witnesses[1] = ap.w
	rejectCombat(t, pair, "same-key replay", &bad)
	bad = *assignment
	bad.Proofs = [2]Proof{bp.p, ap.p}
	bad.Witnesses = [2]Witness{bp.w, ap.w}
	rejectCombat(t, pair, "same-key reorder", &bad)
	// Both children valid and joined, but the terminal suffix illegally advances.
	doneA := a
	doneA.AfterDone = 1
	doneB := b
	doneB.BeforeDone = 1
	da, db := makeProof(doneA), makeProof(doneB)
	bad = *assignment
	bad.Proofs = [2]Proof{da.p, db.p}
	bad.Witnesses = [2]Witness{da.w, db.w}
	rejectCombat(t, pair, "post-terminal advancing suffix", &bad)
	// A terminal identity is permitted, preserving the same state and counter.
	identity := Range{context, middle, middle, 1, 1, 1, 1}
	ip := makeProof(identity)
	padded := &RangePair{Range: Range{context, genesis, middle, 0, 1, 0, 1}, Proofs: [2]Proof{da.p, ip.p}, Witnesses: [2]Witness{da.w, ip.w}}
	check(t, pair.cc.IsSolved(wit(t, padded)))
	t.Log("accepted authenticated terminal identity suffix")
	for _, name := range []string{"state-changing terminal suffix", "counter-advancing terminal suffix", "nonterminal suffix"} {
		suffix := identity
		switch name {
		case "state-changing terminal suffix":
			suffix.After = terminal
		case "counter-advancing terminal suffix":
			suffix.End = 2
		case "nonterminal suffix":
			suffix.AfterDone = 0
		}
		proof := makeProof(suffix)
		bad := *padded
		bad.After = suffix.After
		bad.End = suffix.End
		bad.AfterDone = suffix.AfterDone
		bad.Proofs[1] = proof.p
		bad.Witnesses[1] = proof.w
		rejectCombat(t, pair, name+" with matching parent endpoints", &bad)
	}
	// Isolate final genesis/terminal guards with valid, matching inner proofs,
	// rather than failures caused by changing only an unauthenticated outer field.
	finalTemplate := &RangeFinal{Key: key(t, leaf), Genesis: genesis, Proof: recursive.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](leaf.cc), Witness: recursive.PlaceholderWitness[sw_bn254.ScalarField](leaf.cc)}
	final := level{cc: compiled(t, finalTemplate)}
	valid := makeProof(outer)
	check(t, final.cc.IsSolved(wit(t, &RangeFinal{Range: outer, Proof: valid.p, Witness: valid.w})))
	for _, name := range []string{"wrong genesis", "nonterminal", "already terminal genesis", "nonzero start", "empty execution"} {
		altered := outer
		switch name {
		case "wrong genesis":
			altered.Before = middle
		case "nonterminal":
			altered.AfterDone = 0
		case "already terminal genesis":
			altered.BeforeDone = 1
		case "nonzero start":
			altered.Start = 1
		case "empty execution":
			altered.End = 0
		}
		proof := makeProof(altered)
		rejectCombat(t, final, name+" with genuine approved-key root", &RangeFinal{Range: altered, Proof: proof.p, Witness: proof.w})
	}
}
