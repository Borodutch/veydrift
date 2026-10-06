package runtime

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	bn "github.com/consensys/gnark/backend/groth16/bn254"
)

// EVMArtifact is a verified caller export, not the compressed FinalArtifact
// transport or a complete ABI call. Proof is 0x-prefixed MarshalSolidity hex;
// Public contains canonical decimal uint64 limbs for uint256[22] ABI arguments.
// Manifest.ProofHash still identifies the original compressed proof, NOT Proof.
// Leaves retain their authenticated order and canonical decimal representation.
// This does not certify a deployed verifier, release approval or job lifecycle.
type EVMArtifact struct {
	Schema   string           `json:"schema"`
	Proof    string           `json:"proof"`
	Public   [22]string       `json:"public"`
	Manifest ArtifactManifest `json:"manifest"`
	Leaves   []AllocationLeaf `json:"leaves"`
}

// ExportEVM first authenticates the complete artifact against the authoritative
// snapshot and externally approved key. Only the existing one-commitment,
// 384-byte final verifier ABI is supported; no commitment or PoK is discarded.
// Callers must keep data and snapshot immutable during this call, as for Verify.
func (v *ArtifactVerifier) ExportEVM(ctx context.Context, snap service.Snapshot, data []byte) (*EVMArtifact, error) {
	if err := v.Verify(ctx, snap, data); err != nil {
		return nil, err
	}
	if len(v.vk.CommitmentKeys) != 1 || len(v.vk.PublicAndCommitmentCommitted) != 1 || len(v.vk.G1.K) != 24 {
		return nil, errors.New("unsupported EVM final key schema: require 22 public limbs and one commitment")
	}
	var a FinalArtifact
	if err := artifactJSON(data, &a); err != nil {
		return nil, err
	}
	pr := new(bn.Proof)
	if err := artifactBinary(a.Proof, pr); err != nil {
		return nil, fmt.Errorf("EVM final proof encoding: %w", err)
	}
	if len(pr.Commitments) != len(v.vk.CommitmentKeys) {
		return nil, errors.New("unsupported EVM proof commitment count")
	}
	proof := pr.MarshalSolidity()
	if len(proof) != 384 {
		return nil, errors.New("unsupported EVM proof length: require complete 384-byte proof")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	result := &EVMArtifact{Schema: a.Schema, Proof: "0x" + hex.EncodeToString(proof), Manifest: a.Manifest, Leaves: a.Leaves}
	copy(result.Public[:], a.Public)
	return result, nil
}
