package composition

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	rec "github.com/consensys/gnark/std/recursion/groth16"
	"os"
	"reflect"
	"runtime"
	"runtime/debug"
	"testing"
	"time"
)

// DevSetup owns one reusable setup in memory. Never serialized; all toxic waste
// remains within gnark Setup's lifetime. Receipt logging hashes public artifacts.
type devSetup struct {
	cc  constraint.ConstraintSystem
	pk  groth16.ProvingKey
	vk  groth16.VerifyingKey
	key Key
}
type familyReceipt struct {
	rangeValue FamilyRange
	auth       CatalogAuth
}

func setupFamily(t *testing.T, name string, c frontend.Circuit) *devSetup {
	cc := compile(t, name, c)
	check(t, cc.IsSolved(wit(t, c)))
	s := time.Now()
	t.Logf("MEMORY SETUP START %s", name)
	pk, vk, e := groth16.Setup(cc)
	check(t, e)
	key, e := rec.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](vk)
	check(t, e)
	t.Logf("MEMORY SETUP DONE %s elapsed=%s", name, time.Since(s))
	return &devSetup{cc, pk, vk, key}
}
func proveFamily(t *testing.T, name string, l *devSetup, c frontend.Circuit, r FamilyRange) familyReceipt {
	w := wit(t, c)
	pub, e := w.Public()
	check(t, e)
	start := time.Now()
	pr, e := groth16.Prove(l.cc, l.pk, w, rec.GetNativeProverOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField()))
	check(t, e)
	check(t, groth16.Verify(pr, l.vk, pub, rec.GetNativeVerifierOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField())))
	cp, e := rec.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](pr)
	check(t, e)
	cw, e := rec.ValueOfWitness[sw_bn254.ScalarField](pub)
	check(t, e)
	var b bytes.Buffer
	_, e = pr.WriteTo(&b)
	check(t, e)
	var k bytes.Buffer
	_, e = l.vk.WriteTo(&k)
	check(t, e)
	t.Logf("GENUINE FAMILY PROOF %s bytes=%d proof_sha256=%x vk_sha256=%x elapsed=%s", name, b.Len(), sha256.Sum256(b.Bytes()), sha256.Sum256(k.Bytes()), time.Since(start))
	return familyReceipt{r, CatalogAuth{Proof: cp, Witness: cw, Selector: 0, Keys: []Key{l.key}}}
}
func familyMerge(phase, level int, children []familyReceipt, catalog []Key, selectors []int) *FamilyNode {
	c := &FamilyNode{Phase: phase, Level: level}
	c.Range = children[0].rangeValue
	c.Range.Last = children[len(children)-1].rangeValue.Last
	c.Range.Count = p.Const(uint64(len(children))) // callers below have elementary children
	for i, r := range children {
		a := r.auth
		a.Keys = catalog
		a.Selector = selectors[i]
		c.Children = append(c.Children, a)
		c.ChildRanges = append(c.ChildRanges, r.rangeValue)
	}
	c.FamilyPublic = c.Range.Public(phase)
	return c
}

// A real nonzero-shot SUBRANGE demonstration, not a complete battle proof.
// Both attacking and defending shots reuse exactly the same Damage/Rapidfire
// keys and the same catalog-merge CCS/key. No roster-specific key creation.
func TestFamilyNonzeroProof(t *testing.T) {
	if os.Getenv("RUN_FAMILY_PROOF") != "1" {
		t.Skip("opt-in bounded real proof experiment")
	}
	if runtime.GOMAXPROCS(0) > 2 || debug.SetMemoryLimit(-1) > 6<<30 || debug.SetMemoryLimit(-1) <= 0 {
		t.Fatal("resource envelope")
	}
	start := time.Now()
	chunks, _, _, _ := buildTwoSided(t)
	damage, rapid := []*FamilyLeaf{}, []*FamilyLeaf{}
	for _, c := range chunks {
		if c.Phase != Combat {
			continue
		}
		if c.Combat[0].Kind == mb.Damage {
			damage = append(damage, NewFamilyLeaf(c))
		}
		if c.Combat[0].Kind == mb.Rapidfire {
			rapid = append(rapid, NewFamilyLeaf(c))
		}
	}
	if len(damage) != 2 || len(rapid) != 2 {
		t.Fatal("actual two-shot trace")
	}
	// Catalog order is compile-time protocol kind order, not witness input order.
	receipts := [2][2]familyReceipt{}
	catalog := []Key{}
	for kind, ws := range [][]*FamilyLeaf{damage, rapid} {
		l := setupFamily(t, fmt.Sprintf("family-kind%d", kind), ws[0])
		catalog = append(catalog, l.key)
		for i, w := range ws {
			receipts[i][kind] = proveFamily(t, fmt.Sprintf("kind%d-shot%d", kind, i), l, w, w.Range)
		}
		l = nil
		runtime.GC()
	}
	a := familyMerge(Combat, 1, receipts[0][:], catalog, []int{0, 1})
	cc := compile(t, "catalog-pair-preflight", a)
	check(t, cc.IsSolved(wit(t, a)))
	for _, name := range []string{"wrong-key", "out-of-catalog", "replay", "omission", "work", "phase"} {
		b := clone(reflect.ValueOf(a)).Interface().(*FamilyNode)
		switch name {
		case "wrong-key":
			b.Children[0].Selector = 1
		case "out-of-catalog":
			b.Children[0].Selector = 2
		case "replay":
			b.Children[1].Proof = b.Children[0].Proof
			b.Children[1].Witness = b.Children[0].Witness
			b.Children[1].Selector = 0
		case "omission":
			b.ChildRanges[1] = b.ChildRanges[0]
		case "work":
			b.Range.Count = p.Const(1)
			b.FamilyPublic = b.Range.Public(Combat)
		case "phase":
			b.FamilyPublic = b.Range.Public(Preparation)
		}
		if cc.IsSolved(wit(t, b)) == nil {
			t.Fatalf("accepted %s", name)
		}
		t.Logf("REJECTED catalog %s under authentic leaf proofs", name)
	}
	cc = nil
	runtime.GC()
	l := setupFamily(t, "fixed-catalog-pair", a)
	for i := 0; i < 2; i++ {
		w := familyMerge(Combat, 1, receipts[i][:], catalog, []int{0, 1})
		proveFamily(t, fmt.Sprintf("recursive-shot%d", i), l, w, w.Range)
	}
	t.Logf("ACTUAL NONZERO SUBRANGES VERIFIED two distinct shots same2 leaf keys same1 pair key elapsed=%s; NOT complete combat/allocations", time.Since(start))
}
