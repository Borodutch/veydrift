package battle

import (
	"fmt"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/frontend"
)

// Keys is supplied by the verifier, not by the proof bundle. Both keys must
// correspond to the same fixed Config: index 0 ordinary, index 1 SHA/RNG.
type Keys [2]groth16.VerifyingKey

// Chunk is one elementary-step proof. Verification is linear in chunk count;
// this is NOT recursive aggregation or a succinct production battle proof.
type Chunk struct {
	Before, After State
	Proof         groth16.Proof
}
type Allocation struct {
	Side, Type               uint64
	Owner                    [20]byte
	Source                   [32]byte
	Initial, Lost, Survivors uint64
}
type Result struct {
	Outcome        uint64
	Rounds         uint64
	RoundShots     [6][2]uint64
	RoundSurvivors [6][Slots]uint64
	Allocation     [Slots]Allocation
}

// VerifyComplete verifies every proof with the caller's pinned keys, binds the
// caller's seed, requires genesis and exact full-state adjacency, and refuses a
// truncated trace. It never accepts a bare claimed result hash.
func VerifyComplete(c Config, keys Keys, seed [32]byte, chunks []Chunk) (Result, error) {
	var result Result
	if err := c.Validate(); err != nil {
		return result, err
	}
	if len(chunks) == 0 {
		return result, fmt.Errorf("empty proof")
	}
	expected := State{}
	for i, ch := range chunks {
		if expected.Phase == Done || ch.Before != expected {
			return result, fmt.Errorf("chunk %d: genesis/link/order mismatch", i)
		}
		if ch.Before.Shooter >= Slots || ch.Before.Target >= Slots {
			return result, fmt.Errorf("invalid index")
		}
		kind := 0
		if IsRandom(c, ch.Before) {
			kind = 1
		}
		if keys[kind] == nil || ch.Proof == nil {
			return result, fmt.Errorf("missing pinned key/proof")
		}
		full, err := frontend.NewWitness(CommittedAssignment(c, seed, ch.Before, ch.After, kind == 1), ecc.BN254.ScalarField())
		if err != nil {
			return result, err
		}
		public, err := full.Public()
		if err != nil {
			return result, err
		}
		if err = groth16.Verify(ch.Proof, keys[kind], public); err != nil {
			return result, fmt.Errorf("chunk %d: %w", i, err)
		}
		expected = ch.After
	}
	if expected.Phase != Done {
		return result, fmt.Errorf("incomplete battle")
	}
	result.Outcome = expected.Outcome
	result.Rounds = expected.Round
	result.RoundShots = expected.RoundShots
	result.RoundSurvivors = expected.RoundSurvivors
	for i, u := range c.Units {
		alive := uint64(0)
		if expected.Hull[i] > 0 {
			alive = 1
		}
		result.Allocation[i] = Allocation{u.Side, u.Type, u.Owner, u.Source, 1, 1 - alive, alive}
	}
	return result, nil
}
