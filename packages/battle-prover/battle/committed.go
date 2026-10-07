package battle

import (
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	native "github.com/consensys/gnark-crypto/ecc/bn254/fr/mimc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/hash/mimc"
	"math/big"
)

// Commitment uses the standard gnark MiMC gadget, fixed-length domain-separated
// encoding. This changes only proof transport, never the SHA256 battle RNG.
const StateDomain = 440201
const ContextDomain = 440202

func hashNative(domain uint64, values []uint64) *big.Int {
	h := native.NewFieldHasher()
	var e fr.Element
	e.SetUint64(domain)
	h.WriteElement(e)
	e.SetUint64(uint64(len(values)))
	h.WriteElement(e)
	for _, v := range values {
		e.SetUint64(v)
		h.WriteElement(e)
	}
	sum := h.SumElement()
	return sum.BigInt(new(big.Int))
}
func stateCommitment(s State) *big.Int { return hashNative(StateDomain, s.Values()) }
func contextCommitment(c Config, seed [32]byte) *big.Int {
	v := make([]uint64, 0, 64)
	for _, b := range c.Digest() {
		v = append(v, uint64(b))
	}
	for _, b := range seed {
		v = append(v, uint64(b))
	}
	return hashNative(ContextDomain, v)
}

// CommittedStep has seven fixed public fields, independent of state size.
// The private preimages remain fully constrained by Step.Define. No claimed
// output hash can replace battle execution. Variable memory is still future work.
type CommittedStep struct {
	Context, BeforeRoot, AfterRoot, Start, End, BeforeDone, AfterDone frontend.Variable `gnark:",public"`
	Seed                                                              [32]frontend.Variable
	Before, After                                                     [StateSize]frontend.Variable
	Config                                                            Config `gnark:"-"`
	RNG                                                               bool   `gnark:"-"`
}

func (c *CommittedStep) Define(api frontend.API) error {
	hash := func(domain uint64, v []frontend.Variable) (frontend.Variable, error) {
		h, err := mimc.NewMiMC(api)
		if err != nil {
			return nil, err
		}
		h.Write(domain, len(v))
		h.Write(v...)
		return h.Sum(), nil
	}
	var context [32]frontend.Variable
	for i, b := range c.Config.Digest() {
		context[i] = b
	}
	values := append(append([]frontend.Variable{}, context[:]...), c.Seed[:]...)
	commitment, err := hash(ContextDomain, values)
	if err != nil {
		return err
	}
	api.AssertIsEqual(c.Context, commitment)
	before, err := hash(StateDomain, c.Before[:])
	if err != nil {
		return err
	}
	after, err := hash(StateDomain, c.After[:])
	if err != nil {
		return err
	}
	api.AssertIsEqual(c.BeforeRoot, before)
	api.AssertIsEqual(c.AfterRoot, after)
	api.AssertIsEqual(c.Start, c.Before[7])
	api.AssertIsEqual(c.End, c.After[7])
	api.AssertIsEqual(c.BeforeDone, api.IsZero(api.Sub(c.Before[0], Done)))
	api.AssertIsEqual(c.AfterDone, api.IsZero(api.Sub(c.After[0], Done)))
	inner := Step{Context: context, Seed: c.Seed, Before: c.Before, After: c.After, Config: c.Config, RNG: c.RNG}
	return inner.Define(api)
}
func CommittedAssignment(c Config, seed [32]byte, before, after State, rng bool) *CommittedStep {
	base := Assignment(c, seed, before, after, rng)
	bd, ad := 0, 0
	if before.Phase == Done {
		bd = 1
	}
	if after.Phase == Done {
		ad = 1
	}
	return &CommittedStep{Context: contextCommitment(c, seed), BeforeRoot: stateCommitment(before), AfterRoot: stateCommitment(after), Start: before.Step, End: after.Step, BeforeDone: bd, AfterDone: ad, Seed: base.Seed, Before: base.Before, After: base.After, Config: c, RNG: rng}
}
