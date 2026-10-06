package qualification

import (
	"encoding/hex"
	m "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/consensys/gnark/frontend"
	"math/big"
)

// LinkedCircuit is the new raw-journal relation. The earlier SHA adapter Circuit
// and its seven-scalar ABI/receipts are intentionally retained unchanged.
const LinkedVersion = 3
const ChainRecordDomain = "veydrift.proof-battle.public-record.v1"

func CatalogID() p.Uint256 {
	b, _ := hex.DecodeString(SourceSHA256)
	return p.MustValue(new(big.Int).SetBytes(b))
}
func RulesID() p.Uint256 { return rb.Domain(m.Rules) }

type LinkedCircuit struct {
	ContextHash, Input, RawResult                                      frontend.Variable `gnark:",public"`
	ChainRecord                                                        p.Uint256         `gnark:",public"`
	Meta                                                               rb.Metadata
	RawTerminal                                                        rb.Statement
	PreparationTerminal                                                prep.Statement
	Terminal                                                           prep.State
	ChainSnapshot, RandomnessContext, RandomnessCommitment, RandomWord p.Uint256
	Seed                                                               [32]frontend.Variable
	PreparationSnapshot                                                [4]frontend.Variable
}
type LinkedStatement [7]frontend.Variable

func (c *LinkedCircuit) Statement() LinkedStatement {
	return LinkedStatement{c.ContextHash, c.Input, c.RawResult, c.ChainRecord[0], c.ChainRecord[1], c.ChainRecord[2], c.ChainRecord[3]}
}
func AssertLinkedStatements(api frontend.API, q LinkedStatement, raw rb.Statement, prepared prep.Statement, combat m.Statement) {
	api.AssertIsEqual(q[0], prepared[0])
	api.AssertIsEqual(q[1], combat[m.InputField])
	api.AssertIsEqual(q[2], raw[3])
	api.AssertIsEqual(raw[4], rb.Seal)
}

// ChainWords contains only actual game/engine storage or execution-context
// fields. The final onchain verifier recomputes this exact ABI hash itself.
// No preparation MiMC root or prover-asserted adapter digest enters this record.
func (c *LinkedCircuit) ChainWords() []p.Uint256 {
	i := c.Meta.Preparation.Identity
	return []p.Uint256{rb.Domain(ChainRecordDomain), i.Chain, i.Game, i.Battle, c.Meta.Version, i.Rules, i.Catalog, i.Verifier, c.Meta.Codehash, c.Meta.Engine, c.Meta.RequestID, c.Meta.Purpose, c.ChainSnapshot, c.RandomnessContext, c.RandomWord, c.Meta.Preparation.Rows, p.Const(3)}
}
func (c *LinkedCircuit) Define(api frontend.API) error {
	a := p.New(api)
	id := c.Meta.Preparation.Identity
	api.AssertIsEqual(c.ContextHash, rb.ContextHash(api, c.Meta.Preparation))
	api.AssertIsEqual(c.Meta.Preparation.Catalog, CatalogRoot())
	a.AssertEqual(id.Catalog, CatalogID())
	a.AssertEqual(id.Rules, RulesID())
	a.AssertEqual(id.SeedPolicy, p.Const(SeedPolicy))
	a.AssertEqual(c.Meta.Version, p.Const(LinkedVersion))
	rb.AssertSealed(api, c.RawTerminal, c.Meta, c.ChainSnapshot)
	api.AssertIsEqual(c.RawResult, c.RawTerminal[3])
	api.AssertIsEqual(c.PreparationTerminal[0], c.ContextHash)
	prep.AssertCombatInput(api, c.PreparationTerminal, c.Terminal, c.Input, RFRoot(), c.Seed, c.PreparationSnapshot)
	a.AssertEqual(c.Meta.Purpose, rb.Keccak(api, rb.Domain(PurposeDomain), id.Chain, id.Battle))
	api.AssertIsEqual(a.Equal(c.Meta.RequestID, p.Const(0)), 0)
	api.AssertIsEqual(a.Equal(c.RandomWord, p.Const(0)), 0)
	randomBytes := rb.Bytes(api, c.RandomWord)
	for i, b := range randomBytes {
		api.AssertIsEqual(c.Seed[i], b.Val)
	}
	commitment := rb.Keccak(api, rb.Domain("veydrift.randomness-commitment.v1"), id.Chain, c.Meta.Engine, c.RandomWord)
	a.AssertEqual(c.RandomnessCommitment, commitment)
	context := rb.Keccak(api, rb.Domain("veydrift.battle-snapshot-purpose.v1"), id.Chain, c.Meta.Engine, c.Meta.RequestID, id.Game, c.Meta.Purpose, c.RandomnessCommitment, c.ChainSnapshot)
	a.AssertEqual(c.RandomnessContext, context)
	api.AssertIsEqual(a.Equal(c.RandomnessContext, p.Const(0)), 0)
	a.AssertEqual(c.ChainRecord, rb.Keccak(api, c.ChainWords()...))
	return nil
}

// NewLinked constructs advice from a terminal raw journal and preparation trace.
// The caller must verify both complete prefixes; this function proves nothing.
func NewLinked(meta rb.Metadata, rawTerminal rb.Statement, snapshot p.Uint256, terminal prep.State, prepared prep.Statement, word p.Uint256) (*LinkedCircuit, error) {
	q, e := New(meta.Preparation, terminal, prepared, meta.RequestID, word)
	if e != nil {
		return nil, e
	}
	c := &LinkedCircuit{ContextHash: q.ContextHash, Input: q.Input, RawResult: rawTerminal[3], Meta: meta, RawTerminal: rawTerminal, PreparationTerminal: prepared, Terminal: terminal, ChainSnapshot: snapshot, RandomWord: word, Seed: q.Seed, PreparationSnapshot: q.Snapshot}
	id := meta.Preparation.Identity
	c.RandomnessCommitment = rb.Digest(rb.Domain("veydrift.randomness-commitment.v1"), id.Chain, meta.Engine, word)
	c.RandomnessContext = rb.Digest(rb.Domain("veydrift.battle-snapshot-purpose.v1"), id.Chain, meta.Engine, meta.RequestID, id.Game, meta.Purpose, c.RandomnessCommitment, snapshot)
	c.ChainRecord = rb.Digest(c.ChainWords()...)
	return c, nil
}
