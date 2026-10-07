//go:build !plonk_experiment

package aggregation

import (
	"bytes"
	"crypto/sha256"
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
	"runtime"
	"strconv"
	"testing"
	"time"
)

func check(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}
func wit(t *testing.T, c frontend.Circuit) witness.Witness {
	t.Helper()
	w, e := frontend.NewWitness(c, ecc.BN254.ScalarField())
	check(t, e)
	return w
}
func span(n, start, end int) Statement {
	return Statement{44, 123, 1, n, n, start, n - start, end, n - end, end - start}
}
func TestStepGuards(t *testing.T) {
	c, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &Step{})
	check(t, e)
	for _, s := range []Statement{span(3, 0, 1), span(3, 2, 3), span(3, 3, 3)} {
		check(t, c.IsSolved(wit(t, &Step{s})))
	}
	bad := []Statement{span(3, 0, 0), span(3, 0, 2), span(3, 2, 2), span(3, 3, 4), span(3, 1, 0)}
	s := span(3, 0, 1)
	s.Before = 4
	bad = append(bad, s)
	s = span(3, 0, 1)
	s.Initial = uint64(1) << 32
	bad = append(bad, s)
	s = span(3, 0, 1)
	s.Job = 0
	bad = append(bad, s)
	s = span(3, 0, 1)
	s.Count = 0
	bad = append(bad, s)
	for _, s = range bad {
		if c.IsSolved(wit(t, &Step{s})) == nil {
			t.Fatal("invalid step accepted")
		}
	}
}

// Only semantic guard tests use this small harness; real final proofs below
// exercise the actual cryptographic verifier, not a mocked/selected bypass.
type guards struct{ Statement }

func (c *guards) Define(api frontend.API) error { c.bound(api); c.final(api); return nil }
func TestFinalGuards(t *testing.T) {
	c, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &guards{})
	check(t, e)
	check(t, c.IsSolved(wit(t, &guards{span(3, 0, 3)})))
	for _, s := range []Statement{span(3, 0, 2), span(3, 1, 3), span(3, 3, 3)} {
		if c.IsSolved(wit(t, &guards{s})) == nil {
			t.Fatal("incomplete execution accepted")
		}
	}
}

type level struct {
	cc constraint.ConstraintSystem
	pk groth16.ProvingKey
	vk groth16.VerifyingKey
}
type receipt struct {
	s Statement
	p Proof
	w Witness
}

func compiled(t *testing.T, c frontend.Circuit) constraint.ConstraintSystem {
	start := time.Now()
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, c)
	check(t, e)
	t.Logf("Groth16 compile constraints=%d public=%d time=%s", cc.GetNbConstraints(), cc.GetNbPublicVariables(), time.Since(start))
	if cc.GetNbConstraints() > 4_000_000 {
		t.Fatal("4M constraint development budget exceeded")
	}
	return cc
}
func setup(t *testing.T, cc constraint.ConstraintSystem) level {
	start := time.Now()
	pk, vk, e := groth16.Setup(cc)
	check(t, e)
	var b bytes.Buffer
	_, e = vk.WriteTo(&b)
	check(t, e)
	t.Logf("Groth16 DEVELOPMENT setup vk_sha256=%x time=%s", sha256.Sum256(b.Bytes()), time.Since(start))
	return level{cc, pk, vk}
}
func prove(t *testing.T, l level, c frontend.Circuit, s Statement) receipt {
	start := time.Now()
	w := wit(t, c)
	pub, e := w.Public()
	check(t, e)
	p, e := groth16.Prove(l.cc, l.pk, w, recursive.GetNativeProverOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField()))
	check(t, e)
	check(t, groth16.Verify(p, l.vk, pub, recursive.GetNativeVerifierOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField())))
	cp, e := recursive.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](p)
	check(t, e)
	cw, e := recursive.ValueOfWitness[sw_bn254.ScalarField](pub)
	check(t, e)
	t.Logf("Groth16 proof start=%v end=%v count=%v time=%s", s.Start, s.End, s.Count, time.Since(start))
	return receipt{s, cp, cw}
}
func key(t *testing.T, l level) VerifyingKey {
	k, e := recursive.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](l.vk)
	check(t, e)
	return k
}
func nodeTemplate(t *testing.T, l level) *Node {
	c := &Node{Key: key(t, l)}
	for i := range c.Proofs {
		c.Proofs[i] = recursive.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](l.cc)
		c.Witnesses[i] = recursive.PlaceholderWitness[sw_bn254.ScalarField](l.cc)
	}
	return c
}
func node(a, b receipt) *Node {
	s := a.s
	s.End = b.s.End
	s.After = b.s.After
	s.Count = a.s.Count.(int) + b.s.Count.(int)
	return &Node{Statement: s, Proofs: [2]Proof{a.p, b.p}, Witnesses: [2]Witness{a.w, b.w}}
}

// Opt-in: generates genuine intermediate AND final proofs. All setup/proof/key
// objects are memory-only. Each level has a fresh DEVELOPMENT setup, not a ceremony.
func TestVariableTreeProofs(t *testing.T) {
	if testing.Short() || os.Getenv("RUN_AGGREGATION_PROBE") != "1" {
		t.Skip("set RUN_AGGREGATION_PROBE=1")
	}
	if runtime.GOMAXPROCS(0) > 2 {
		t.Fatal("run with GOMAXPROCS=2 or lower")
	}
	depth := 2
	if x := os.Getenv("AGGREGATION_DEPTH"); x != "" {
		n, e := strconv.Atoi(x)
		check(t, e)
		depth = n
	}
	if depth < 1 || depth > 3 {
		t.Fatal("development depth must be 1..3")
	}
	started := time.Now()
	l := setup(t, compiled(t, &Step{}))
	sizes := []int{1, 2, 3, 4}
	if depth == 1 {
		sizes = []int{1, 2}
	}
	if depth == 3 {
		sizes = append(sizes, 5, 8)
	}
	forests := make([][]receipt, len(sizes))
	for j, n := range sizes {
		for i := 0; i < (1 << depth); i++ {
			start := min(i, n)
			end := min(i+1, n)
			s := span(n, start, end)
			forests[j] = append(forests[j], prove(t, l, &Step{s}, s))
		}
	}
	for d := 1; d <= depth; d++ {
		t.Logf("begin aggregation level=%d", d)
		next := setup(t, compiled(t, nodeTemplate(t, l)))
		for j := range forests {
			out := make([]receipt, 0, len(forests[j])/2)
			for i := 0; i < len(forests[j]); i += 2 {
				a := node(forests[j][i], forests[j][i+1])
				if j == len(forests)-1 && i == 0 {
					negativeNode(t, next, a, forests[j][i])
				}
				out = append(out, prove(t, next, a, a.Statement))
			}
			forests[j] = out
		}
		l = next
		runtime.GC()
	}
	runtime.GC()
	template := &Final{Key: key(t, l), Proof: recursive.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](l.cc), Witness: recursive.PlaceholderWitness[sw_bn254.ScalarField](l.cc)}
	start := time.Now()
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, template)
	check(t, e)
	if cc.GetNbConstraints() > 4_000_000 {
		t.Fatal("4M final constraint budget exceeded")
	}
	t.Logf("final compile constraints=%d public=%d time=%s", cc.GetNbConstraints(), cc.GetNbPublicVariables()-1, time.Since(start))
	start = time.Now()
	pk, vk, e := groth16.Setup(cc)
	check(t, e)
	t.Logf("final DEVELOPMENT setup time=%s", time.Since(start))
	var exported bytes.Buffer
	check(t, vk.ExportSolidity(&exported))
	t.Logf("Solidity source bytes=%d (not EVM execution)", exported.Len())
	for j, n := range sizes {
		root := forests[j][0]
		a := &Final{Statement: root.s, Proof: root.p, Witness: root.w}
		w := wit(t, a)
		pub, e := w.Public()
		check(t, e)
		start = time.Now()
		p, e := groth16.Prove(cc, pk, w, solidity.WithProverTargetSolidityVerifier(backend.GROTH16))
		check(t, e)
		check(t, groth16.Verify(p, vk, pub, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)))
		var b bytes.Buffer
		_, e = p.WriteTo(&b)
		check(t, e)
		t.Logf("FINAL VERIFIED chunks=%d depth=%d proof_bytes=%d public=10 proof_sha256=%x time=%s", n, depth, b.Len(), sha256.Sum256(b.Bytes()), time.Since(start))
		bad := *a
		bad.Seed = 124
		bp, e := wit(t, &bad).Public()
		check(t, e)
		if groth16.Verify(p, vk, bp, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)) == nil {
			t.Fatal("altered public statement accepted")
		}
	}
	t.Logf("all genuine proofs complete total=%s", time.Since(started))
}
func negativeNode(t *testing.T, l level, a *Node, replay receipt) {
	t.Helper()
	cases := map[string]Node{}
	b := *a
	b.Seed = 124
	cases["seed"] = b
	b = *a
	b.Job = 45
	cases["job"] = b
	b = *a
	b.End = b.End.(int) + 1
	cases["end"] = b
	b = *a
	b.Proofs[1] = replay.p
	b.Witnesses[1] = replay.w
	cases["replay"] = b
	b = *a
	b.Proofs[0], b.Proofs[1] = b.Proofs[1], b.Proofs[0]
	b.Witnesses[0], b.Witnesses[1] = b.Witnesses[1], b.Witnesses[0]
	cases["reorder"] = b
	for name, b := range cases {
		if l.cc.IsSolved(wit(t, &b)) == nil {
			t.Fatalf("invalid %s accepted", name)
		}
		t.Logf("rejected %s", name)
	}
}
