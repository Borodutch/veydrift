//go:build !plonk_experiment

package aggregation

import (
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	recursive "github.com/consensys/gnark/std/recursion/groth16"
	"math/big"
	"os"
	"runtime"
	"runtime/debug"
	"testing"
)

func memoryHigh(bit uint, n int64) *big.Int {
	return new(big.Int).Add(new(big.Int).Lsh(big.NewInt(1), bit), big.NewInt(n))
}
func memoryExample() (MemoryRange, MemoryRange, MemoryRange) {
	// Deliberately decreasing hash-position values. Ordering hashes would reject
	// the valid right child even though its real abstract position advances.
	a := MemoryRange{memoryHigh(240, 11), memoryHigh(200, 12), memoryHigh(200, 13), 0, memoryHigh(230, 14), 0, 0, 0}
	b := MemoryRange{a.Input, a.After, memoryHigh(200, 15), a.End, memoryHigh(220, 16), 0, 1, new(big.Int).Sub(fr.Modulus(), big.NewInt(1))}
	r := a
	r.After = b.After
	r.End = b.End
	r.AfterDone = 1
	r.Result = b.Result
	return a, b, r
}

// These are SMALL adapter fixtures, NOT battle leaves. Unlike freely claimed
// statements, each approved key pins all eight fields to an exact transition.
// Separate keys pin different transitions; wrong-key proofs remain genuine.
type memoryPinnedLeaf struct {
	MemoryRange
	Expected MemoryRange `gnark:"-"`
}

func (c *memoryPinnedLeaf) Define(api frontend.API) error {
	for i, x := range c.values() {
		api.AssertIsEqual(x, c.Expected.values()[i])
	}
	return nil
}

// Isolated adapter-only adversarial fixture. Public claims here intentionally
// have no transition semantics. Real Groth16 proofs under this test-only key
// let attacks isolate recursive linkage/terminal guards, never battle validity.
// A private echo makes every public input used without restricting the claim.
type memoryClaimsLeaf struct {
	MemoryRange
	Echo [8]frontend.Variable
}

func (c *memoryClaimsLeaf) Define(api frontend.API) error {
	for i, x := range c.values() {
		api.AssertIsEqual(x, c.Echo[i])
	}
	return nil
}
func memoryClaims(r MemoryRange) *memoryClaimsLeaf {
	c := &memoryClaimsLeaf{MemoryRange: r}
	copy(c.Echo[:], r.values())
	return c
}
func memoryBudget(t *testing.T) {
	t.Helper()
	if testing.Short() || os.Getenv("RUN_MEMORY_RECURSION") != "1" {
		t.Skip("set RUN_MEMORY_RECURSION=1; small leaf setup and outer solver only")
	}
	if runtime.GOMAXPROCS(0) > 2 {
		t.Fatal("run with GOMAXPROCS=2 or lower")
	}
	old := debug.SetMemoryLimit(4 << 30)
	t.Cleanup(func() { debug.SetMemoryLimit(old); runtime.GC() })
}
func memoryPairTemplate(t *testing.T, a, b level) *MemoryPair {
	c := &MemoryPair{Keys: [2]VerifyingKey{key(t, a), key(t, b)}}
	for i, l := range []level{a, b} {
		c.Proofs[i] = recursive.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](l.cc)
		c.Witnesses[i] = recursive.PlaceholderWitness[sw_bn254.ScalarField](l.cc)
	}
	return c
}
func memoryPairAssignment(r MemoryRange, a, b receipt) *MemoryPair {
	return &MemoryPair{MemoryRange: r, Proofs: [2]Proof{a.p, b.p}, Witnesses: [2]Witness{a.w, b.w}}
}
func memoryFinalTemplate(t *testing.T, l level, g frontend.Variable) *MemoryFinal {
	return &MemoryFinal{Key: key(t, l), Genesis: g, Proof: recursive.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](l.cc), Witness: recursive.PlaceholderWitness[sw_bn254.ScalarField](l.cc)}
}
func TestMemoryPinnedRecursiveProofs(t *testing.T) {
	memoryBudget(t)
	a, b, r := memoryExample()
	left := setup(t, compiled(t, &memoryPinnedLeaf{Expected: a}))
	right := setup(t, compiled(t, &memoryPinnedLeaf{Expected: b}))
	ap := prove(t, left, &memoryPinnedLeaf{MemoryRange: a}, Statement{})
	bp := prove(t, right, &memoryPinnedLeaf{MemoryRange: b}, Statement{})
	cc := level{cc: compiled(t, memoryPairTemplate(t, left, right))}
	valid := memoryPairAssignment(r, ap, bp)
	check(t, cc.cc.IsSolved(wit(t, valid)))
	t.Log("accepted exact-transition heterogeneous keys and full-width descending position commitments")
	// A second setup for the identical right circuit produces a genuine proof
	// with matching fields but an unapproved key. Witness Keys cannot override it.
	rogue := setup(t, right.cc)
	rp := prove(t, rogue, &memoryPinnedLeaf{MemoryRange: b}, Statement{})
	bad := memoryPairAssignment(r, ap, rp)
	bad.Keys = [2]VerifyingKey{key(t, left), key(t, rogue)}
	rejectCombat(t, cc, "unapproved genuine key with attempted witness-key replacement", bad)
	bad = memoryPairAssignment(r, bp, ap)
	rejectCombat(t, cc, "heterogeneous reorder", bad)
	for i, name := range []string{"input", "before", "after", "start", "end", "beforeDone", "afterDone", "result"} {
		wrong := r
		xs := wrong.values()
		xs[i] = memoryHigh(100, 777)
		wrong = MemoryRange{xs[0], xs[1], xs[2], xs[3], xs[4], xs[5], xs[6], xs[7]}
		rejectCombat(t, cc, "tampered outer "+name, memoryPairAssignment(wrong, ap, bp))
	}
	// Final verification uses another SMALL exact-statement root fixture, not
	// a pair proof: no outer setup/proof is attempted in this resource lane.
	root := setup(t, compiled(t, &memoryPinnedLeaf{Expected: r}))
	proof := prove(t, root, &memoryPinnedLeaf{MemoryRange: r}, Statement{})
	final := level{cc: compiled(t, memoryFinalTemplate(t, root, r.Before))}
	check(t, final.cc.IsSolved(wit(t, &MemoryFinal{MemoryRange: r, Proof: proof.p, Witness: proof.w})))
	badFinal := &MemoryFinal{MemoryRange: r, Proof: proof.p, Witness: proof.w}
	badFinal.Result = memoryHigh(100, 1)
	rejectCombat(t, final, "altered terminal result", badFinal)
	for _, name := range []string{"input", "after", "end"} {
		bad := &MemoryFinal{MemoryRange: r, Proof: proof.p, Witness: proof.w}
		switch name {
		case "input":
			bad.Input = memoryHigh(253, 1)
		case "after":
			bad.After = memoryHigh(253, 2)
		case "end":
			bad.End = memoryHigh(253, 3)
		}
		rejectCombat(t, final, "altered final "+name, bad)
	}
	rogueRoot := setup(t, root.cc)
	rogueProof := prove(t, rogueRoot, &memoryPinnedLeaf{MemoryRange: r}, Statement{})
	rejectCombat(t, final, "unapproved root and witness key override", &MemoryFinal{MemoryRange: r, Proof: rogueProof.p, Witness: rogueProof.w, Key: key(t, rogueRoot)})
}

func TestMemoryAuthenticatedAdapterAttacks(t *testing.T) {
	memoryBudget(t)
	a, b, r := memoryExample()
	leaf := setup(t, compiled(t, &memoryClaimsLeaf{}))
	makeProof := func(s MemoryRange) receipt { return prove(t, leaf, memoryClaims(s), Statement{}) }
	ap, bp := makeProof(a), makeProof(b)
	cc := level{cc: compiled(t, memoryPairTemplate(t, leaf, leaf))}
	check(t, cc.cc.IsSolved(wit(t, memoryPairAssignment(r, ap, bp))))
	attacks := []struct {
		name   string
		side   int
		change func(*MemoryRange)
	}{
		{"input link", 1, func(s *MemoryRange) { s.Input = memoryHigh(241, 11) }},
		{"state link high bit", 1, func(s *MemoryRange) { s.Before = memoryHigh(201, 13) }},
		{"position link high bit", 1, func(s *MemoryRange) { s.Start = memoryHigh(231, 14) }},
		{"terminal before", 1, func(s *MemoryRange) { s.BeforeDone = 1 }},
		{"left terminal", 0, func(s *MemoryRange) { s.AfterDone = 1 }},
		{"left result nonzero", 0, func(s *MemoryRange) { s.Result = memoryHigh(200, 1) }},
		{"left before terminal", 0, func(s *MemoryRange) { s.BeforeDone = 1 }},
		{"left invalid terminal flag", 0, func(s *MemoryRange) { s.AfterDone = 2 }},
	}
	for _, tc := range attacks {
		aa, bb := a, b
		p, q := ap, bp
		if tc.side == 0 {
			tc.change(&aa)
			p = makeProof(aa)
		} else {
			tc.change(&bb)
			q = makeProof(bb)
		}
		rejectCombat(t, cc, tc.name+" authenticated claims fixture", memoryPairAssignment(r, p, q))
	}
	rejectCombat(t, cc, "same-key replay", memoryPairAssignment(r, ap, ap))
	rejectCombat(t, cc, "same-key reorder", memoryPairAssignment(r, bp, ap))
	// Matching parent endpoints prevent accidental rejection on unrelated binds.
	terminalA := a
	terminalA.AfterDone = 1
	terminalA.Result = r.Result
	identity := MemoryRange{a.Input, a.After, a.After, a.End, a.End, 1, 1, r.Result}
	paddingOuter := terminalA
	rejectCombat(t, cc, "terminal identity padding rejected", memoryPairAssignment(paddingOuter, makeProof(terminalA), makeProof(identity)))
	nonterminal := b
	nonterminal.AfterDone = 0
	nr := r
	nr.AfterDone = 0
	rejectCombat(t, cc, "nonterminal nonzero result", memoryPairAssignment(nr, ap, makeProof(nonterminal)))
	nonterminal.Result = 0
	nr.Result = 0
	check(t, cc.cc.IsSolved(wit(t, memoryPairAssignment(nr, ap, makeProof(nonterminal)))))
	invalidFlag := b
	invalidFlag.AfterDone = 2
	ir := r
	ir.AfterDone = 2
	rejectCombat(t, cc, "nonboolean right terminal", memoryPairAssignment(ir, ap, makeProof(invalidFlag)))
	// Genuine approved-key roots with matching outer fields isolate final guards.
	final := level{cc: compiled(t, memoryFinalTemplate(t, leaf, r.Before))}
	root := makeProof(r)
	check(t, final.cc.IsSolved(wit(t, &MemoryFinal{MemoryRange: r, Proof: root.p, Witness: root.w})))
	finalAttacks := []struct {
		name   string
		change func(*MemoryRange)
	}{
		{"genesis", func(s *MemoryRange) { s.Before = memoryHigh(201, 12) }},
		{"start position", func(s *MemoryRange) { s.Start = memoryHigh(240, 1) }},
		{"empty execution", func(s *MemoryRange) { s.End = 0 }},
		{"before terminal", func(s *MemoryRange) { s.BeforeDone = 1 }},
		{"nonterminal", func(s *MemoryRange) { s.AfterDone = 0; s.Result = 0 }},
	}
	for _, tc := range finalAttacks {
		s := r
		tc.change(&s)
		p := makeProof(s)
		rejectCombat(t, final, tc.name+" genuine claims root", &MemoryFinal{MemoryRange: s, Proof: p.p, Witness: p.w, Genesis: s.Before})
	}
	t.Log("ADAPTER ONLY: real small claims proofs isolate guards; no battle or outer proof claim")
}
