package battle

import (
	"fmt"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/accumulator/merkle"
	"github.com/consensys/gnark/std/hash/mimc"
)

// MemoryUpdate is a reusable authenticated single-slot read/write. Caller must
// connect BeforeRoot to the latest prior AfterRoot and constrain Old/New against
// its actual operation. This gadget does not on its own prove a battle.
// Depth is circuit-sized, but it is an address-space parameter, NOT a maximum
// number of battle operations: every access composes another elementary step.
type MemoryUpdate struct {
	BeforeRoot, AfterRoot, Index frontend.Variable
	Old, New                     [3]frontend.Variable // cohort identity, hull, shield
	Siblings                     []frontend.Variable
}

func (m *MemoryUpdate) Constrain(api frontend.API) error {
	if len(m.Siblings) == 0 {
		return fmt.Errorf("memory path must have positive depth")
	}
	// Commit index and payload with distinct domain/fixed length before the
	// standard Merkle gadget's leaf hash. Inner nodes have exactly two elements.
	leaf := func(payload [3]frontend.Variable) (frontend.Variable, error) {
		h, err := mimc.NewMiMC(api)
		if err != nil {
			return nil, err
		}
		h.Write(440203, 4, m.Index)
		h.Write(payload[:]...)
		return h.Sum(), nil
	}
	for _, v := range m.Old {
		api.ToBinary(v, 64)
	}
	for _, v := range m.New {
		api.ToBinary(v, 64)
	}
	old, err := leaf(m.Old)
	if err != nil {
		return err
	}
	next, err := leaf(m.New)
	if err != nil {
		return err
	}
	h, err := mimc.NewMiMC(api)
	if err != nil {
		return err
	}
	before := merkle.MerkleProof{RootHash: m.BeforeRoot, Path: append([]frontend.Variable{old}, m.Siblings...)}
	before.VerifyProof(api, &h, m.Index)
	after := merkle.MerkleProof{RootHash: m.AfterRoot, Path: append([]frontend.Variable{next}, m.Siblings...)}
	after.VerifyProof(api, &h, m.Index)
	return nil
}
