package recursion

import (
	"bytes"
	"testing"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
)

// This tiny genuine proof also runs in short CI. It neither compiles nor proves
// the expensive pair; the opt-in benchmark is separate and must not be inferred.
func TestStepProofRoundTrip(t *testing.T) {
	c, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &Step{})
	check(t, err)
	pk, vk, err := groth16.Setup(c)
	check(t, err)
	w := witnessFor(t, &Step{statement(0, 10)})
	public, err := w.Public()
	check(t, err)
	proof, err := groth16.Prove(c, pk, w)
	check(t, err)
	check(t, groth16.Verify(proof, vk, public))
	var buf bytes.Buffer
	_, err = proof.WriteTo(&buf)
	check(t, err)
	restored := groth16.NewProof(ecc.BN254)
	_, err = restored.ReadFrom(&buf)
	check(t, err)
	check(t, groth16.Verify(restored, vk, public))
	bad := statement(0, 10)
	bad.After = 12
	badPublic, err := witnessFor(t, &Step{bad}).Public()
	check(t, err)
	if groth16.Verify(restored, vk, badPublic) == nil {
		t.Fatal("altered output accepted")
	}
	// Valid arithmetic under another context is not the original proof statement.
	for _, name := range []string{"job", "seed", "rules"} {
		t.Run(name, func(t *testing.T) {
			bad := statement(0, 10)
			switch name {
			case "job":
				bad.Job = 45
			case "seed":
				bad.Seed = 124
			case "rules":
				bad.Rules = 2
			}
			badPublic, err := witnessFor(t, &Step{bad}).Public()
			check(t, err)
			if groth16.Verify(restored, vk, badPublic) == nil {
				t.Fatal("different context accepted")
			}
		})
	}
}
