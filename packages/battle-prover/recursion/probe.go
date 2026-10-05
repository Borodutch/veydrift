// Package recursion is a development-only cryptographic feasibility probe.
// It proves linked integer increments, NOT battle execution or settlement.
package recursion

import (
	"fmt"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	recursive "github.com/consensys/gnark/std/recursion/groth16"
)

// Public values are deliberately only uint32 for this probe. This is not the
// production commitment encoding (which must bind full-width hashes/addresses).
type Statement struct {
	Job    frontend.Variable `gnark:",public"`
	Seed   frontend.Variable `gnark:",public"`
	Rules  frontend.Variable `gnark:",public"`
	Start  frontend.Variable `gnark:",public"`
	Before frontend.Variable `gnark:",public"`
	End    frontend.Variable `gnark:",public"`
	After  frontend.Variable `gnark:",public"`
}

func (s Statement) values() []frontend.Variable {
	return []frontend.Variable{s.Job, s.Seed, s.Rules, s.Start, s.Before, s.End, s.After}
}
func (s Statement) bound(api frontend.API) {
	for _, v := range s.values() {
		api.ToBinary(v, 32)
	}
	api.AssertIsDifferent(s.Job, 0)
	api.AssertIsDifferent(s.Rules, 0)
}

type Step struct{ Statement }

func (c *Step) Define(api frontend.API) error {
	c.bound(api)
	api.AssertIsEqual(c.End, api.Add(c.Start, 1))
	api.AssertIsEqual(c.After, api.Add(c.Before, 1))
	return nil
}

type Proof = recursive.Proof[sw_bn254.G1Affine, sw_bn254.G2Affine]
type Witness = recursive.Witness[sw_bn254.ScalarField]
type VerifyingKey = recursive.VerifyingKey[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl]

// Pair authenticates two proofs under ONE compile-time fixed step key. That key
// is not a prover-supplied witness. This establishes one aggregation level, NOT
// arbitrary-depth recursion: the resulting pair proof has a different key.
type Pair struct {
	Statement
	Proofs    [2]Proof
	Witnesses [2]Witness
	Key       VerifyingKey `gnark:"-"`
}

func (c *Pair) Define(api frontend.API) error {
	c.bound(api)
	v, err := recursive.NewVerifier[sw_bn254.ScalarField, sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](api)
	if err != nil {
		return err
	}
	f, err := emulated.NewField[sw_bn254.ScalarField](api)
	if err != nil {
		return err
	}
	for i := range c.Proofs {
		if len(c.Witnesses[i].Public) != 7 {
			return fmt.Errorf("expected seven step public fields")
		}
		if err = v.AssertProof(c.Key, c.Proofs[i], c.Witnesses[i], recursive.WithCompleteArithmetic(), recursive.WithSubgroupCheck()); err != nil {
			return err
		}
		for j, p := range []frontend.Variable{c.Job, c.Seed, c.Rules} {
			f.AssertIsEqual(&c.Witnesses[i].Public[j], f.NewElement([]frontend.Variable{p, 0, 0, 0}))
		}
	}
	a, b := c.Witnesses[0].Public, c.Witnesses[1].Public
	f.AssertIsEqual(&a[3], f.NewElement([]frontend.Variable{c.Start, 0, 0, 0}))
	f.AssertIsEqual(&a[4], f.NewElement([]frontend.Variable{c.Before, 0, 0, 0}))
	f.AssertIsEqual(&a[5], &b[3])
	f.AssertIsEqual(&a[6], &b[4])
	f.AssertIsEqual(&b[5], f.NewElement([]frontend.Variable{c.End, 0, 0, 0}))
	f.AssertIsEqual(&b[6], f.NewElement([]frontend.Variable{c.After, 0, 0, 0}))
	return nil
}
