//go:build plonk_experiment

// Package aggregation is a development-only levelled PLONK recursion experiment.
// The VM is a bounded countdown, not combat. No keys are accepted as witnesses.
package aggregation

import (
	"fmt"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	recursive "github.com/consensys/gnark/std/recursion/plonk"
)

// Statement has ten public uint32 scalars at every level. Initial is the
// countdown's initial state; Limit is its exact number of required transitions.
// Full battle commitments/addresses are intentionally not represented here.
type Statement struct {
	Job     frontend.Variable `gnark:",public"`
	Seed    frontend.Variable `gnark:",public"`
	Rules   frontend.Variable `gnark:",public"`
	Initial frontend.Variable `gnark:",public"`
	Limit   frontend.Variable `gnark:",public"`
	Start   frontend.Variable `gnark:",public"`
	Before  frontend.Variable `gnark:",public"`
	End     frontend.Variable `gnark:",public"`
	After   frontend.Variable `gnark:",public"`
	Count   frontend.Variable `gnark:",public"`
}

func (s Statement) values() []frontend.Variable {
	return []frontend.Variable{s.Job, s.Seed, s.Rules, s.Initial, s.Limit, s.Start, s.Before, s.End, s.After, s.Count}
}
func (s Statement) bound(api frontend.API) {
	for _, x := range s.values() {
		api.ToBinary(x, 32)
	}
	api.AssertIsDifferent(s.Job, 0)
	api.AssertIsEqual(s.Rules, 1)
	api.AssertIsDifferent(s.Initial, 0)
	api.AssertIsEqual(s.Limit, s.Initial)
	api.AssertIsLessOrEqual(s.Start, s.End)
	api.AssertIsLessOrEqual(s.End, s.Limit)
	api.AssertIsEqual(s.Count, api.Sub(s.End, s.Start))
	// Non-wrapping conservation binds every partial range to the real base.
	api.AssertIsEqual(api.Add(s.Before, s.Start), s.Initial)
	api.AssertIsEqual(api.Add(s.After, s.End), s.Initial)
}
func (s Statement) final(api frontend.API) {
	api.AssertIsEqual(s.Start, 0)
	api.AssertIsEqual(s.Before, s.Initial)
	api.AssertIsEqual(s.End, s.Limit)
	api.AssertIsEqual(s.After, 0)
	api.AssertIsEqual(s.Count, s.Limit)
}

// Step executes one decrement, or exactly the terminal identity. No idle
// nonterminal chunk is possible. There is no freely supplied padding flag.
type Step struct{ Statement }

func (c *Step) Define(api frontend.API) error {
	c.bound(api)
	active := api.Sub(1, api.IsZero(c.Before))
	api.AssertIsEqual(c.End, api.Add(c.Start, active))
	api.AssertIsEqual(c.After, api.Sub(c.Before, active))
	api.AssertIsEqual(c.Count, active)
	return nil
}

type Proof = recursive.Proof[sw_bn254.ScalarField, sw_bn254.G1Affine, sw_bn254.G2Affine]
type Witness = recursive.Witness[sw_bn254.ScalarField]
type VerifyingKey = recursive.VerifyingKey[sw_bn254.ScalarField, sw_bn254.G1Affine, sw_bn254.G2Affine]

// Node is a binary merge with a compile-time previous-level key. Distinct
// levels deliberately have distinct keys: no self-key or root fixed point.
type Node struct {
	Statement
	Proofs    [2]Proof
	Witnesses [2]Witness
	Key       VerifyingKey `gnark:"-"`
}

func (c *Node) Define(api frontend.API) error {
	c.bound(api)
	v, err := recursive.NewVerifier[sw_bn254.ScalarField, sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](api)
	if err != nil {
		return err
	}
	if err = v.AssertSameProofs(c.Key, c.Proofs[:], c.Witnesses[:], recursive.WithCompleteArithmetic()); err != nil {
		return err
	}
	f, err := emulated.NewField[sw_bn254.ScalarField](api)
	if err != nil {
		return err
	}
	val := func(x frontend.Variable) *emulated.Element[sw_bn254.ScalarField] {
		return f.NewElement([]frontend.Variable{x, 0, 0, 0})
	}
	for i := range c.Witnesses {
		if len(c.Witnesses[i].Public) != 10 {
			return fmt.Errorf("expected ten public fields")
		}
		for j, x := range c.values()[:5] {
			f.AssertIsEqual(&c.Witnesses[i].Public[j], val(x))
		}
	}
	a, b := c.Witnesses[0].Public, c.Witnesses[1].Public
	f.AssertIsEqual(&a[5], val(c.Start))
	f.AssertIsEqual(&a[6], val(c.Before))
	f.AssertIsEqual(&a[7], &b[5])
	f.AssertIsEqual(&a[8], &b[6])
	f.AssertIsEqual(&b[7], val(c.End))
	f.AssertIsEqual(&b[8], val(c.After))
	f.AssertIsEqual(f.Add(&a[9], &b[9]), val(c.Count))
	return nil
}

// Final verifies one approved root, enforces base and terminal, and yields one
// BN254 Groth16 proof. Its key pins the chosen compiled tree height.
type Final struct {
	Statement
	Proof   Proof
	Witness Witness
	Key     VerifyingKey `gnark:"-"`
}

func (c *Final) Define(api frontend.API) error {
	c.bound(api)
	c.final(api)
	v, err := recursive.NewVerifier[sw_bn254.ScalarField, sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](api)
	if err != nil {
		return err
	}
	if err = v.AssertProof(c.Key, c.Proof, c.Witness, recursive.WithCompleteArithmetic()); err != nil {
		return err
	}
	if len(c.Witness.Public) != 10 {
		return fmt.Errorf("expected ten public fields")
	}
	f, err := emulated.NewField[sw_bn254.ScalarField](api)
	if err != nil {
		return err
	}
	for j, x := range c.values() {
		f.AssertIsEqual(&c.Witness.Public[j], f.NewElement([]frontend.Variable{x, 0, 0, 0}))
	}
	return nil
}
