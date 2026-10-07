//go:build !plonk_experiment

package aggregation

import (
	"fmt"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	recursive "github.com/consensys/gnark/std/recursion/groth16"
)

// MemoryRange is the eight-scalar memorybattle public statement, in leaf order.
// Input/state/result are full BN254 scalars. Start/End are commitments to
// uint256 positions, NOT counters: never truncate, subtract, or order them.
// Zero is the leaf protocol's distinguished genesis-position encoding.
type MemoryRange struct {
	Input      frontend.Variable `gnark:",public"`
	Before     frontend.Variable `gnark:",public"`
	After      frontend.Variable `gnark:",public"`
	Start      frontend.Variable `gnark:",public"`
	End        frontend.Variable `gnark:",public"`
	BeforeDone frontend.Variable `gnark:",public"`
	AfterDone  frontend.Variable `gnark:",public"`
	Result     frontend.Variable `gnark:",public"`
}

func (s MemoryRange) values() []frontend.Variable {
	return []frontend.Variable{s.Input, s.Before, s.After, s.Start, s.End, s.BeforeDone, s.AfterDone, s.Result}
}
func (s MemoryRange) bound(api frontend.API) {
	// There is currently no authenticated terminal-identity leaf. Reject all
	// ranges that begin terminal, including seemingly unchanged public roots.
	api.AssertIsEqual(s.BeforeDone, 0)
	api.AssertIsBoolean(s.AfterDone)
	api.AssertIsEqual(api.Mul(api.Sub(1, s.AfterDone), s.Result), 0)
}

// MemoryPair verifies two compile-time approved, potentially heterogeneous
// keys. Keys are circuit constants, never witness-selected verification keys.
// Each approved leaf must enforce real transition and position semantics;
// a node key must itself authenticate only approved descendants.
type MemoryPair struct {
	MemoryRange
	Proofs    [2]Proof
	Witnesses [2]Witness
	Keys      [2]VerifyingKey `gnark:"-"`
}

func (c *MemoryPair) Define(api frontend.API) error {
	c.bound(api)
	v, e := recursive.NewVerifier[sw_bn254.ScalarField, sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](api)
	if e != nil {
		return e
	}
	f, e := emulated.NewField[sw_bn254.ScalarField](api)
	if e != nil {
		return e
	}
	for i := range c.Proofs {
		if len(c.Witnesses[i].Public) != 8 {
			return fmt.Errorf("expected eight memory range public values")
		}
		if e = v.AssertProof(c.Keys[i], c.Proofs[i], c.Witnesses[i], recursive.WithCompleteArithmetic(), recursive.WithSubgroupCheck()); e != nil {
			return e
		}
		f.AssertIsEqual(&c.Witnesses[i].Public[0], nativeScalar(api, f, c.Input))
		f.AssertIsEqual(&c.Witnesses[i].Public[5], f.Zero())
	}
	a, b := c.Witnesses[0].Public, c.Witnesses[1].Public
	f.AssertIsEqual(&a[1], nativeScalar(api, f, c.Before))
	f.AssertIsEqual(&a[2], &b[1])
	f.AssertIsEqual(&b[2], nativeScalar(api, f, c.After))
	f.AssertIsEqual(&a[3], nativeScalar(api, f, c.Start))
	f.AssertIsEqual(&a[4], &b[3])
	f.AssertIsEqual(&b[4], nativeScalar(api, f, c.End))
	// No suffix after a terminal left child, even an alleged identity suffix.
	f.AssertIsEqual(&a[6], f.Zero())
	f.AssertIsEqual(&a[7], f.Zero())
	f.AssertIsEqual(&b[6], nativeScalar(api, f, c.AfterDone))
	f.AssertIsEqual(&b[7], nativeScalar(api, f, c.Result))
	return nil
}

// MemoryFinal pins an approved root key and protocol genesis state. Input and
// terminal Result remain public so the consumer must compare them with its job
// and settlement commitment. This circuit does not authenticate that consumer.
type MemoryFinal struct {
	MemoryRange
	Proof   Proof
	Witness Witness
	Key     VerifyingKey      `gnark:"-"`
	Genesis frontend.Variable `gnark:"-"`
}

func (c *MemoryFinal) Define(api frontend.API) error {
	c.bound(api)
	api.AssertIsEqual(c.Start, 0)
	api.AssertIsDifferent(c.End, 0)
	api.AssertIsEqual(c.Before, c.Genesis)
	api.AssertIsEqual(c.AfterDone, 1)
	if len(c.Witness.Public) != 8 {
		return fmt.Errorf("expected eight memory range public values")
	}
	v, e := recursive.NewVerifier[sw_bn254.ScalarField, sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](api)
	if e != nil {
		return e
	}
	if e = v.AssertProof(c.Key, c.Proof, c.Witness, recursive.WithCompleteArithmetic(), recursive.WithSubgroupCheck()); e != nil {
		return e
	}
	f, e := emulated.NewField[sw_bn254.ScalarField](api)
	if e != nil {
		return e
	}
	for i, x := range c.values() {
		f.AssertIsEqual(&c.Witness.Public[i], nativeScalar(api, f, x))
	}
	return nil
}
