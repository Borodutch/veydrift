package composition

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/backend/witness"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	rec "github.com/consensys/gnark/std/recursion/groth16"
	"os"
	"reflect"
	"runtime"
	"runtime/debug"
	"testing"
	"time"
)

type receipt struct {
	auth    Auth
	r       Range
	public  [8]frontend.Variable
	proof   groth16.Proof
	vk      groth16.VerifyingKey
	witness witness.Witness
}

func wit(t *testing.T, a frontend.Circuit) witness.Witness {
	w, e := frontend.NewWitness(a, ecc.BN254.ScalarField())
	check(t, e)
	return w
}
func compile(t *testing.T, name string, a frontend.Circuit) constraint.ConstraintSystem {
	t.Helper()
	start := time.Now()
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, clone(reflect.ValueOf(a)).Interface().(frontend.Circuit))
	check(t, e)
	t.Logf("COMPILE %s constraints=%d public=%d time=%s", name, cc.GetNbConstraints(), cc.GetNbPublicVariables()-1, time.Since(start))
	if cc.GetNbConstraints() > 4_000_000 {
		t.Fatalf("4M ceiling: %s", name)
	}
	return cc
}
func prove(t *testing.T, name string, a frontend.Circuit) receipt {
	t.Helper()
	cc := compile(t, name, a)
	check(t, cc.IsSolved(wit(t, a)))
	start := time.Now()
	t.Logf("SETUP START %s", name)
	pk, vk, e := groth16.Setup(cc)
	check(t, e)
	t.Logf("SETUP DONE %s time=%s", name, time.Since(start))
	start = time.Now()
	w := wit(t, a)
	pub, e := w.Public()
	check(t, e)
	pr, e := groth16.Prove(cc, pk, w, rec.GetNativeProverOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField()))
	check(t, e)
	check(t, groth16.Verify(pr, vk, pub, rec.GetNativeVerifierOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField())))
	cp, e := rec.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](pr)
	check(t, e)
	cw, e := rec.ValueOfWitness[sw_bn254.ScalarField](pub)
	check(t, e)
	key, e := rec.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](vk)
	check(t, e)
	var pb, kb bytes.Buffer
	_, e = pr.WriteTo(&pb)
	check(t, e)
	_, e = vk.WriteTo(&kb)
	check(t, e)
	check(t, os.MkdirAll("receipts", 0700))
	check(t, os.WriteFile("receipts/"+name+".proof", pb.Bytes(), 0600))
	check(t, os.WriteFile("receipts/"+name+".vk", kb.Bytes(), 0600))
	var wb bytes.Buffer
	_, e = pub.WriteTo(&wb)
	check(t, e)
	check(t, os.WriteFile("receipts/"+name+".public", wb.Bytes(), 0600))
	t.Logf("PROOF VERIFIED %s bytes=%d sha256=%x vk_sha256=%x time=%s", name, pb.Len(), sha256.Sum256(pb.Bytes()), sha256.Sum256(kb.Bytes()), time.Since(start))
	r := receipt{auth: Auth{Proof: cp, Witness: cw, Key: key}, proof: pr, vk: vk, witness: pub}
	switch c := a.(type) {
	case *Chunk:
		r.r = Range{c.First, c.Last}
	case *Pair:
		r.r = Range{c.First, c.Last}
	case *AuthenticatedClose:
		r.r = Range{c.First, c.Last}
	case *Join:
		r.public = c.Public
	case *BridgeWithAllocation:
		r.r = Range{c.First, c.Last}
	}
	pk = nil
	cc = nil
	runtime.GC()
	return r
}

// BridgeWithAllocation is a fixed microprogram with exactly one Close. It
// proves ALL bridge steps and consumes a verified complete attribution range.
// Other cohort counts must use AuthenticatedClose + Pair, not this key.
type BridgeWithAllocation struct {
	PublicRange
	Steps      []bridgeStep
	Allocation Range
	Auth       Auth
}

func (c *BridgeWithAllocation) Define(api frontend.API) error {
	if e := c.Auth.Verify(api, c.Allocation.values()); e != nil {
		return e
	}
	closes := 0
	for i := range c.Steps {
		x := &c.Steps[i]
		if e := x.Define(api); e != nil {
			return e
		}
		s := x.Statement()
		if x.Kind == rb.Close {
			closes++
			rb.AssertAttribution(api, s, [5]frontend.Variable(c.Allocation.First), [5]frontend.Variable(c.Allocation.Last))
		}
		if i > 0 {
			p := c.Steps[i-1].Statement()
			rb.AssertLinked(api, p, s)
		}
	}
	if closes != 1 {
		return fmt.Errorf("fixed one-Close microprogram")
	}
	a, b := c.Steps[0].Statement(), c.Steps[len(c.Steps)-1].Statement()
	eq(api, c.First, a[:])
	eq(api, c.Last, b[:])
	rb.AssertComplete(api, a, b)
	return nil
}
func bridgeCircuit(f fixture, allocation receipt) *BridgeWithAllocation {
	c := &BridgeWithAllocation{Allocation: allocation.r, Auth: allocation.auth}
	for _, s := range f.bridge {
		c.Steps = append(c.Steps, privatebridgeStep(s))
	}
	a, b := f.bridge[0].Statement(), f.bridge[len(f.bridge)-1].Statement()
	c.First = a[:]
	c.Last = b[:]
	return c
}
func join(mode int, a, b receipt) *Join {
	c := &Join{Mode: mode, Children: [2]Auth{a.auth, b.auth}, Ranges: [2]Range{a.r, b.r}}
	for i := range c.Public {
		c.Public[i] = 0
	}
	for i := range c.ChildrenPublic {
		for j := range c.ChildrenPublic[i] {
			c.ChildrenPublic[i][j] = 0
		}
	}
	if mode == 0 {
		copy(c.Public[:], []frontend.Variable{a.r.First[0], a.r.Last[3], b.r.First[0], b.r.Last[7]})
	}
	if mode == 1 {
		copy(c.Public[1:], []frontend.Variable{a.r.Last[1], a.r.Last[2], a.r.Last[3], a.r.Last[0], a.r.Last[7], b.r.Last[6], rb.Hash(rb.CompleteResultDomain, a.r.Last[0], a.r.Last[7], b.r.Last[6])})
	}
	if mode == 2 {
		c.Ranges = [2]Range{}
		c.ChildrenPublic = [2][8]frontend.Variable{a.public, b.public}
		copy(c.Public[:4], a.public[:4])
		copy(c.Public[4:], b.public[4:])
	}
	return c
}
func TestCompilePhases(t *testing.T) {
	f := build(t)
	for i, c := range []*Chunk{f.prep, f.combat, f.allocation, f.report} {
		cc := compile(t, fmt.Sprintf("phase%d", i), c)
		if cc.GetNbPublicVariables()-1 != 2*Width(c.Phase) {
			t.Fatal("nested public leakage")
		}
		check(t, cc.IsSolved(wit(t, c)))
		runtime.GC()
	}
}
func TestActualPipelineProof(t *testing.T) {
	if os.Getenv("RUN_COMPOSITION") != "1" {
		t.Skip("opt-in actual proofs")
	}
	if runtime.GOMAXPROCS(0) > 2 || debug.SetMemoryLimit(-1) > 6<<30 || debug.SetMemoryLimit(-1) <= 0 {
		t.Fatal("resource envelope")
	}
	start := time.Now()
	t.Logf("RESOURCE CPUs=%d softMemory=%d constraintCeiling=4000000 timeout=60min", runtime.GOMAXPROCS(0), debug.SetMemoryLimit(-1))
	f := build(t)
	prep := prove(t, "preparation", f.prep)
	combat := prove(t, "combat", f.combat)
	pc := prove(t, "prepared-combat", join(0, prep, combat))
	prep = receipt{}
	combat = receipt{}
	runtime.GC()
	alloc := prove(t, "allocation", f.allocation)
	bc := bridgeCircuit(f, alloc)
	bridge := prove(t, "bridge", bc)
	alloc = receipt{}
	runtime.GC()
	report := prove(t, "report", f.report)
	br := prove(t, "bridge-report", join(1, bridge, report))
	bridge = receipt{}
	report = receipt{}
	runtime.GC()
	finalCircuit := join(2, pc, br)
	final := prove(t, "final", finalCircuit)
	bad := *finalCircuit
	bad.Public[7] = 1
	badPub, e := wit(t, &bad).Public()
	check(t, e)
	if groth16.Verify(final.proof, final.vk, badPub, rec.GetNativeVerifierOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField())) == nil {
		t.Fatal("changed final result accepted")
	}
	t.Logf("COMPLETE PIPELINE VERIFIED public=%v elapsed=%s; development setup, bounded one-sided fixture, external RF/seed qualification NOT authenticated", final.public, time.Since(start))
}
