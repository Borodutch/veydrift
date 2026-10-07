package runtime

import (
	"bytes"
	"context"
	"errors"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/backend/solidity"
	"github.com/consensys/gnark/frontend"
	rec "github.com/consensys/gnark/std/recursion/groth16"
)

// NativeReceipt contains public artifacts only. CatalogSHA256 is an identity,
// never an approval supplied by the receipt consumer.
type NativeReceipt struct {
	CatalogSHA256 string
	KeyID         string
	Proof, Public []byte
}

// ProveApproved executes a real gnark relation using already approved immutable
// CCS/PK/VK. It never compiles, sets up, promotes keys or invokes Go test. Call
// only INSIDE the pinned killable engine: gnark Prove has no context cancellation
// API; hard wall/CPU/address-space cancellation belongs to processrunner.
// Context checks before/after prevent canceled results from being published.
func ProveApproved(ctx context.Context, catalog *Catalog, keyID string, assignment frontend.Circuit) (NativeReceipt, error) {
	var zero NativeReceipt
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	if catalog == nil || assignment == nil {
		return zero, errors.New("approved catalog and actual witness required")
	}
	key, err := catalog.Load(ctx, keyID)
	if err != nil {
		return zero, err
	}
	if key.CCS.GetNbConstraints() > 4000000 {
		return zero, errors.New("circuit exceeds approved execution constraint envelope")
	}
	full, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
	if err != nil {
		return zero, err
	}
	public, err := full.Public()
	if err != nil {
		return zero, err
	}
	proverOption := rec.GetNativeProverOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField())
	verifierOption := rec.GetNativeVerifierOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField())
	if keyID == AdapterKeyID("final") {
		proverOption = solidity.WithProverTargetSolidityVerifier(backend.GROTH16)
		verifierOption = solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)
	}
	if err = ctx.Err(); err != nil {
		return zero, err
	}
	proof, err := groth16.Prove(key.CCS, key.PK, full, proverOption)
	if err != nil {
		return zero, err
	}
	if err = ctx.Err(); err != nil {
		return zero, err
	}
	if err = groth16.Verify(proof, key.VK, public, verifierOption); err != nil {
		return zero, err
	}
	var p, w bytes.Buffer
	if _, err = proof.WriteTo(&p); err != nil {
		return zero, err
	}
	if _, err = public.WriteTo(&w); err != nil {
		return zero, err
	}
	if err = ctx.Err(); err != nil {
		return zero, err
	}
	return NativeReceipt{CatalogSHA256: catalog.SHA256(), KeyID: keyID, Proof: p.Bytes(), Public: w.Bytes()}, nil
}
