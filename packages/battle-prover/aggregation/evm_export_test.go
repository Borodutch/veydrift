//go:build !plonk_experiment

package aggregation

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"testing"

	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/backend/groth16"
	bn254 "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/backend/witness"
)

// exportCombatEVM is called only after the genuine final proof verifies. The
// fixed, opt-in destination contains public data only; no witness or setup keys.
func exportCombatEVM(t *testing.T, vk groth16.VerifyingKey, proof groth16.Proof, public witness.Witness) {
	t.Helper()
	if os.Getenv("EXPORT_COMBAT_EVM") != "1" {
		return
	}
	values, ok := public.Vector().(fr.Vector)
	if !ok || len(values) != 7 {
		t.Fatal("expected seven BN254 public scalars")
	}
	p, ok := proof.(*bn254.Proof)
	if !ok {
		t.Fatal("expected BN254 proof")
	}
	var source bytes.Buffer
	check(t, vk.ExportSolidity(&source))
	solidityProof := p.MarshalSolidity()
	fixture := struct {
		DevelopmentOnly bool      `json:"developmentOnly"`
		Schema          [7]string `json:"schema"`
		Public          [7]string `json:"public"`
		Proof           string    `json:"proof"`
	}{DevelopmentOnly: true, Schema: [7]string{"Context", "Before", "After", "Start", "End", "BeforeDone", "AfterDone"}, Proof: "0x" + hex.EncodeToString(solidityProof)}
	for i := range values {
		fixture.Public[i] = canonicalScalar(&values[i])
	}
	data, e := json.MarshalIndent(fixture, "", "  ")
	check(t, e)
	// Fail closed rather than mixing exports from different random setups.
	dir := filepath.Join("evm", "public")
	check(t, os.Mkdir(dir, 0755))
	check(t, os.WriteFile(filepath.Join(dir, "Verifier.sol"), source.Bytes(), 0644))
	check(t, os.WriteFile(filepath.Join(dir, "fixture.json"), append(data, byte(10)), 0644))
	t.Logf("PUBLIC EVM EXPORT proof_bytes=%d proof_sha256=%x verifier_sha256=%x fixture_sha256=%x", len(solidityProof), sha256.Sum256(solidityProof), sha256.Sum256(source.Bytes()), sha256.Sum256(append(data, byte(10))))
}

func canonicalScalar(value *fr.Element) string {
	return value.BigInt(new(big.Int)).String()
}
