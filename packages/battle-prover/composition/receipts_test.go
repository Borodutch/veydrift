package composition

import (
	"bytes"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/backend/witness"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	rec "github.com/consensys/gnark/std/recursion/groth16"
	"io"
	"math/big"
	"os"
	"reflect"
	"testing"
)

func load(t *testing.T, name string) receipt {
	t.Helper()
	pr := groth16.NewProof(ecc.BN254)
	vk := groth16.NewVerifyingKey(ecc.BN254)
	w, e := witness.New(ecc.BN254.ScalarField())
	check(t, e)
	for ext, obj := range map[string]io.ReaderFrom{"proof": pr, "vk": vk, "public": w} {
		b, e := os.ReadFile("receipts/" + name + "." + ext)
		check(t, e)
		_, e = obj.ReadFrom(bytes.NewReader(b))
		check(t, e)
	}
	check(t, groth16.Verify(pr, vk, w, rec.GetNativeVerifierOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField())))
	cp, e := rec.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](pr)
	check(t, e)
	cw, e := rec.ValueOfWitness[sw_bn254.ScalarField](w)
	check(t, e)
	key, e := rec.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](vk)
	check(t, e)
	r := receipt{auth: Auth{Proof: cp, Witness: cw, Key: key}, proof: pr, vk: vk, witness: w}
	v := reflect.ValueOf(w.Vector())
	values := make([]frontend.Variable, v.Len())
	for i := range values {
		a := v.Index(i).Addr().Interface().(interface{ BigInt(*big.Int) *big.Int })
		values[i] = a.BigInt(new(big.Int))
	}
	if name == "final" || name == "prepared-combat" || name == "bridge-report" {
		copy(r.public[:], values)
	} else {
		r.r = Range{values[:len(values)/2], values[len(values)/2:]}
	}
	return r
}
func TestPersistedRecursiveAttacks(t *testing.T) {
	if os.Getenv("RUN_COMPOSITION_ATTACKS") != "1" {
		t.Skip("requires genuine generated receipt DAG")
	}
	for _, n := range []string{"preparation", "combat", "prepared-combat", "allocation", "bridge", "report", "bridge-report", "final"} {
		load(t, n)
		t.Logf("NATIVE RECEIPT VERIFIED %s", n)
	}
	f := build(t)
	alloc := load(t, "allocation")
	bridge := bridgeCircuit(f, alloc)
	cc := compile(t, "bridge-auth-attacks", bridge)
	check(t, cc.IsSolved(wit(t, bridge)))
	for _, name := range []string{"wrong-key", "omitted-attribution", "attribution-context", "attribution-result", "bridge-genesis", "premature"} {
		b := clone(reflect.ValueOf(bridge)).Interface().(*BridgeWithAllocation)
		switch name {
		case "wrong-key":
			b.Auth = load(t, "preparation").auth
		case "omitted-attribution":
			b.Auth.Proof = Proof{}
		case "attribution-context":
			b.Allocation.First[0] = 1
		case "attribution-result":
			b.Allocation.Last[4] = 1
		case "bridge-genesis":
			b.First[4] = 1
		case "premature":
			b.Last[6] = 0
		}
		w, e := frontend.NewWitness(b, ecc.BN254.ScalarField())
		if e == nil && cc.IsSolved(w) == nil {
			t.Fatalf("accepted %s", name)
		}
		t.Logf("REJECTED %s actual pinned recursive circuit", name)
	}
	pc, br := load(t, "prepared-combat"), load(t, "bridge-report")
	a := join(2, pc, br)
	fc := compile(t, "final-attacks", a)
	check(t, fc.IsSolved(wit(t, a)))
	for _, name := range []string{"replay", "wrong-key", "result", "context", "omission"} {
		b := clone(reflect.ValueOf(a)).Interface().(*Join)
		switch name {
		case "replay", "wrong-key":
			b.Children[1] = b.Children[0]
		case "result":
			b.Public[7] = 1
		case "context":
			b.Public[0] = 1
		case "omission":
			b.ChildrenPublic[1][1] = 0
		}
		if fc.IsSolved(wit(t, b)) == nil {
			t.Fatalf("accepted %s", name)
		}
		t.Logf("REJECTED final %s genuine proofs", name)
	}
}
