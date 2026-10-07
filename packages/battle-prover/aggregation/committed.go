//go:build !plonk_experiment

package aggregation

import (
	"fmt"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	recursive "github.com/consensys/gnark/std/recursion/groth16"
)

// Range is the integration contract for a real VM leaf. Hash fields are native
// BN254 scalars (not uint32 truncations); counter fields are uint64. Context
// must commit full roster/rules/seed and Before/After must commit full memory.
// The leaf must prove every operation, initial semantics and terminal identity.
// These fields, in this exact order, are the entire public leaf witness.
type Range struct {
	Context    frontend.Variable `gnark:",public"`
	Before     frontend.Variable `gnark:",public"`
	After      frontend.Variable `gnark:",public"`
	Start      frontend.Variable `gnark:",public"`
	End        frontend.Variable `gnark:",public"`
	BeforeDone frontend.Variable `gnark:",public"`
	AfterDone  frontend.Variable `gnark:",public"`
}

func (s Range) values() []frontend.Variable {
	return []frontend.Variable{s.Context, s.Before, s.After, s.Start, s.End, s.BeforeDone, s.AfterDone}
}
func (s Range) bound(api frontend.API) {
	api.ToBinary(s.Start, 64)
	api.ToBinary(s.End, 64)
	api.AssertIsLessOrEqual(s.Start, s.End)
	api.AssertIsBoolean(s.BeforeDone)
	api.AssertIsBoolean(s.AfterDone)
}
func nativeScalar(api frontend.API, f *emulated.Field[sw_bn254.ScalarField], v frontend.Variable) *emulated.Element[sw_bn254.ScalarField] {
	return f.FromBits(api.ToBinary(v)...)
}

// RangePair authenticates fixed left/right leaf or node keys. Supporting two
// distinct approved keys allows a bounded heterogeneous instruction schedule
// without a witness VK or incompatible commitment-metadata key selector.
// A production homogeneous route is deliberately not claimed.
type RangePair struct {
	Range
	Proofs    [2]Proof
	Witnesses [2]Witness
	Keys      [2]VerifyingKey `gnark:"-"`
}

func (c *RangePair) Define(api frontend.API) error {
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
		if len(c.Witnesses[i].Public) != 7 {
			return fmt.Errorf("expected seven committed range public values")
		}
		if e = v.AssertProof(c.Keys[i], c.Proofs[i], c.Witnesses[i], recursive.WithCompleteArithmetic(), recursive.WithSubgroupCheck()); e != nil {
			return e
		}
		f.AssertIsEqual(&c.Witnesses[i].Public[0], nativeScalar(api, f, c.Context))
	}
	a, b := c.Witnesses[0].Public, c.Witnesses[1].Public
	f.AssertIsEqual(&a[1], nativeScalar(api, f, c.Before))
	f.AssertIsEqual(&b[2], nativeScalar(api, f, c.After))
	f.AssertIsEqual(&a[2], &b[1])
	f.AssertIsEqual(&a[4], &b[3])
	f.AssertIsEqual(&a[3], nativeScalar(api, f, c.Start))
	f.AssertIsEqual(&b[4], nativeScalar(api, f, c.End))
	f.AssertIsEqual(&a[5], nativeScalar(api, f, c.BeforeDone))
	f.AssertIsEqual(&a[6], &b[5])
	f.AssertIsEqual(&b[6], nativeScalar(api, f, c.AfterDone))
	// A terminal left range only admits a terminal identity suffix. This guard
	// is independent of the leaf's own no-post-terminal-transition constraint.
	terminal := f.IsZero(f.Sub(&a[6], f.One()))
	f.AssertIsEqual(f.Select(terminal, &b[1], &b[2]), &b[2])
	f.AssertIsEqual(f.Select(terminal, &b[3], &b[4]), &b[4])
	f.AssertIsEqual(f.Select(terminal, f.One(), &b[6]), &b[6])
	return nil
}

// RangeFinal pins an approved root key and genesis commitment. It returns seven
// public scalars and exactly one Solidity-target BN254 proof when proven with
// the caller's matching final transcript options. Genesis is a compile-time
// expected zero-machine commitment; Context remains publicly bound to the job.
type RangeFinal struct {
	Range
	Proof   Proof
	Witness Witness
	Key     VerifyingKey      `gnark:"-"`
	Genesis frontend.Variable `gnark:"-"`
}

func (c *RangeFinal) Define(api frontend.API) error {
	c.bound(api)
	api.AssertIsEqual(c.Start, 0)
	api.AssertIsDifferent(c.End, 0)
	api.AssertIsEqual(c.Before, c.Genesis)
	api.AssertIsEqual(c.BeforeDone, 0)
	api.AssertIsEqual(c.AfterDone, 1)
	if len(c.Witness.Public) != 7 {
		return fmt.Errorf("expected seven committed range public values")
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
