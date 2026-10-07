package qualification

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	m "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/frontend"
	"math/big"
)

func scalar(v frontend.Variable) (*big.Int, error) {
	var n *big.Int
	switch v := v.(type) {
	case int:
		n = big.NewInt(int64(v))
	case uint64:
		n = new(big.Int).SetUint64(v)
	case *big.Int:
		if v != nil {
			n = new(big.Int).Set(v)
		}
	}
	if n == nil || n.Sign() < 0 || n.Cmp(fr.Modulus()) >= 0 {
		return nil, fmt.Errorf("noncanonical scalar")
	}
	return n, nil
}
func value(w p.Uint256) (*big.Int, error) {
	n := new(big.Int)
	for j := 3; j >= 0; j-- {
		x, e := scalar(w[j])
		if e != nil || x.BitLen() > 64 {
			return nil, fmt.Errorf("noncanonical uint256 limb")
		}
		n.Lsh(n, 64)
		n.Add(n, x)
	}
	return n, nil
}
func hostScalar(v frontend.Variable) (p.Uint256, error) {
	n, e := scalar(v)
	if e != nil {
		return p.Uint256{}, e
	}
	return p.MustValue(n), nil
}

// RecordBytes is also the canonical adapter serialization, without any field
// reduction of the SHA256 digest. The adapter must build it from trusted state.
func RecordBytes(c prep.Context, r Request) ([]byte, error) {
	w := words(c.Identity)
	w = append(w, p.Uint256{c.Identity.TargetIsMoon, 0, 0, 0})
	for _, v := range []frontend.Variable{c.Raw, c.Catalog, c.Tech} {
		x, e := hostScalar(v)
		if e != nil {
			return nil, e
		}
		w = append(w, x)
	}
	w = append(w, c.Rows)
	for _, x := range w {
		if _, e := value(x); e != nil {
			return nil, e
		}
	}
	w = append(w, p.MustValue(c.Commitment()), r.ID, r.Purpose, r.Snapshot, r.RandomWord, p.Uint256{r.Ready, 0, 0, 0})
	digest, _ := hex.DecodeString(SourceSHA256)
	out := append([]byte(RecordDomain), digest...)
	for _, x := range w {
		n, e := value(x)
		if e != nil {
			return nil, e
		}
		buf := make([]byte, 32)
		n.FillBytes(buf)
		out = append(out, buf...)
	}
	return out, nil
}
func ChainDigest(c prep.Context, r Request) (p.Uint256, error) {
	b, e := RecordBytes(c, r)
	if e != nil {
		return p.Uint256{}, e
	}
	s := sha256.Sum256(b)
	return p.MustValue(new(big.Int).SetBytes(s[:])), nil
}

// Crosscheck requires an independently authenticated adapter digest. This repo's
// inactive raw-journal Solidity branch does NOT produce that digest yet.
func Crosscheck(claimed, trusted p.Uint256) error {
	a, e := value(claimed)
	if e != nil {
		return e
	}
	b, e := value(trusted)
	if e != nil {
		return e
	}
	if a.Cmp(b) != 0 {
		return fmt.Errorf("chain qualification commitment mismatch")
	}
	return nil
}

// New constructs advice only, not chain authentication or a preparation proof.
func New(c prep.Context, terminal prep.State, terminalStatement prep.Statement, requestID, randomWord p.Uint256) (*Circuit, error) {
	context := c.Commitment()
	snapshot := p.MustValue(context)
	r := Request{requestID, Purpose(c.Identity.Chain, c.Identity.Battle), snapshot, randomWord, 1}
	digest, e := ChainDigest(c, r)
	if e != nil {
		return nil, e
	}
	n, e := value(terminal.Total)
	if e != nil {
		return nil, e
	}
	roster, e := scalar(terminal.UnitRoot)
	if e != nil {
		return nil, e
	}
	random, e := value(randomWord)
	if e != nil {
		return nil, e
	}
	var seed [32]byte
	random.FillBytes(seed[:])
	snap := m.Big(context)
	combat := m.Context{Roster: roster, RF: RFRoot(), N: m.Big(n), Seed: seed, Snapshot: [4]uint64(snap)}
	q := &Circuit{ContextHash: context, Input: combat.Commitment(), ChainCommitment: digest, CatalogVersion: CatalogVersion, Preparation: c, Terminal: terminal, PreparationTerminal: terminalStatement, Request: r, Snapshot: [4]frontend.Variable(snapshot)}
	for i, b := range seed {
		q.Seed[i] = uint64(b)
	}
	return q, nil
}

// ProductionAvailable is deliberately false until the live chain's keccak raw
// journal is bridged to these roots/identity and this exact SHA256 record is
// authenticated onchain. The candidate relation cannot enable acceptance.
const ProductionAvailable = false

func RequireProductionBridge() error {
	return fmt.Errorf("qualification unavailable: raw-journal-to-preparation bridge and authenticated chain record not implemented")
}
