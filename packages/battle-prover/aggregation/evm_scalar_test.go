//go:build !plonk_experiment

package aggregation

import (
	"encoding/json"
	"math/big"
	"os"
	"testing"

	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
)

func TestCanonicalEVMScalars(t *testing.T) {
	for _, n := range []*big.Int{big.NewInt(0), big.NewInt(1), new(big.Int).Sub(fr.Modulus(), big.NewInt(1))} {
		var x fr.Element
		x.SetBigInt(n)
		if got := canonicalScalar(&x); got != n.String() {
			t.Fatalf("canonical scalar: got %s want %s", got, n)
		}
	}
}

// Reconstruct this fixture's seven public scalars without generating proofs.
// This also verifies that the review correction changes no exported scalar.
func TestExportedCombatEVMScalars(t *testing.T) {
	data, e := os.ReadFile("evm/public/fixture.json")
	if os.IsNotExist(e) {
		t.Skip("public export not present")
	}
	check(t, e)
	var fixture struct {
		Public [7]string `json:"public"`
	}
	check(t, json.Unmarshal(data, &fixture))
	c, ss := combatTrace(t)
	a := combatAssignment(c, ss)
	pub, e := wit(t, a).Public()
	check(t, e)
	values := pub.Vector().(fr.Vector)
	for i := range values {
		expected := canonicalScalar(&values[i])
		if fixture.Public[i] != expected {
			t.Fatalf("public scalar %d: got %s want %s", i, fixture.Public[i], expected)
		}
		if values[i].String() != expected {
			t.Fatalf("original run serialization differs at %d", i)
		}
	}
	t.Log("exported seven canonical scalars equal reconstructed combat statement and original run serialization")
}
