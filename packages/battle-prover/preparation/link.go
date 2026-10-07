package preparation

import (
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/frontend"
	"math/big"
)

type Statement [4]frontend.Variable

func (c *Step) Statement() Statement {
	return Statement{c.ContextHash, c.BeforeHash, c.AfterHash, c.Result}
}
func LinkStatements(api frontend.API, l, r Statement) {
	api.AssertIsEqual(l[0], r[0])
	api.AssertIsEqual(l[2], r[1])
	api.AssertIsEqual(l[3], 0)
}

// All statements must have verified elementary proofs under authenticated keys.
// Initial root is fixed, not prover-chosen; terminal Result must be nonzero.
func AssertComplete(api frontend.API, first, last Statement) {
	api.AssertIsEqual(first[0], last[0])
	api.AssertIsEqual(first[1], Initial().Commitment())
	api.AssertIsDifferent(last[3], 0)
}

// Bind the proved terminal manifests/root/count to the exact memorybattle Input.
// Seed and RF are separate policy/catalog boundaries, NOT authenticated by this
// helper: the caller must bind them to its frozen catalog/seed-policy statement.
func AssertCombatInput(api frontend.API, terminal Statement, s State, input, rf frontend.Variable, seed [32]frontend.Variable, snapshot [4]frontend.Variable) {
	api.AssertIsEqual(s.Phase, Done)
	api.AssertIsEqual(terminal[2], hash(api, StateDomain, s.values()...))
	api.AssertIsEqual(terminal[3], ResultHashCircuit(api, terminal[0], s))
	p.New(api).AssertEqual(s.Unit, s.Total)
	values := append([]frontend.Variable{s.UnitRoot, rf}, s.Total[:]...)
	values = append(values, 3)
	for _, b := range seed {
		api.ToBinary(b, 8)
	}
	for _, x := range snapshot {
		api.ToBinary(x, 64)
	}
	a := p.New(api)
	snapshotWord := p.Uint256(snapshot)
	api.AssertIsEqual(a.Less(snapshotWord, p.MustValue(fr.Modulus())), 1)
	var reconstructed frontend.Variable = 0
	for i, x := range snapshot {
		reconstructed = api.Add(reconstructed, api.Mul(x, new(big.Int).Lsh(big.NewInt(1), uint(64*i))))
	}
	api.AssertIsEqual(reconstructed, terminal[0])
	values = append(values, seed[:]...)
	values = append(values, snapshot[:]...)
	api.AssertIsEqual(input, hash(api, 440403, values...))
}
