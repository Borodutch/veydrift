package qualification

import (
	"encoding/hex"
	m "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/hash/mimc"
	"github.com/consensys/gnark/std/hash/sha2"
	"github.com/consensys/gnark/std/hash/sha3"
	"github.com/consensys/gnark/std/math/uints"
	nativeKeccak "golang.org/x/crypto/sha3"
	"math/big"
)

const RecordDomain = "veydrift:candidate2:qualification:v1:"
const PurposeDomain = "veydrift.attack-battle.v1"

func purposeDomain() []byte {
	h := nativeKeccak.NewLegacyKeccak256()
	h.Write([]byte(PurposeDomain))
	return h.Sum(nil)
}

// Purpose matches _attackBattlePurposeHash: keccak256(abi.encode(domain,chain,battle)).
func Purpose(chain, battle p.Uint256) p.Uint256 {
	h := nativeKeccak.NewLegacyKeccak256()
	h.Write(purposeDomain())
	for _, w := range []p.Uint256{chain, battle} {
		n, e := value(w)
		if e != nil {
			panic(e)
		}
		buf := make([]byte, 32)
		n.FillBytes(buf)
		h.Write(buf)
	}
	return p.MustValue(new(big.Int).SetBytes(h.Sum(nil)))
}

type Request struct {
	ID, Purpose, Snapshot, RandomWord p.Uint256
	Ready                             frontend.Variable
}
type Circuit struct {
	ContextHash, Input  frontend.Variable `gnark:",public"`
	ChainCommitment     p.Uint256         `gnark:",public"`
	CatalogVersion      frontend.Variable `gnark:",public"`
	Preparation         prep.Context
	Terminal            prep.State
	PreparationTerminal prep.Statement
	Request             Request
	Seed                [32]frontend.Variable
	Snapshot            [4]frontend.Variable
}
type Statement [7]frontend.Variable

const (
	ContextField = 0
	InputField   = 1
	ChainField   = 2
	VersionField = 6
)

func (c *Circuit) Statement() Statement {
	return Statement{c.ContextHash, c.Input, c.ChainCommitment[0], c.ChainCommitment[1], c.ChainCommitment[2], c.ChainCommitment[3], c.CatalogVersion}
}

// Arguments must already have valid proofs under authenticated circuit keys.
func AssertLinked(api frontend.API, q Statement, t prep.Statement, b m.Statement) {
	api.AssertIsEqual(q[ContextField], t[0])
	api.AssertIsEqual(q[InputField], b[m.InputField])
	api.AssertIsEqual(q[VersionField], CatalogVersion)
}
func words(i prep.Identity) []p.Uint256 {
	return []p.Uint256{i.Chain, i.Game, i.Battle, i.Body, i.Incarnation, i.Impact, i.Rules, i.Verifier, i.Catalog, i.SeedPolicy}
}
func contextValues(c prep.Context) []frontend.Variable {
	var v []frontend.Variable
	for _, w := range words(c.Identity) {
		v = append(v, w[:]...)
	}
	v = append(v, c.Identity.TargetIsMoon, c.Raw, c.Catalog, c.Tech)
	return append(v, c.Rows[:]...)
}
func hash(api frontend.API, d int, v ...frontend.Variable) frontend.Variable {
	h, _ := mimc.NewMiMC(api)
	h.Write(d, len(v))
	h.Write(v...)
	return h.Sum()
}
func wordBytes(api frontend.API, b *uints.Bytes, w p.Uint256) []uints.U8 {
	out := make([]uints.U8, 0, 32)
	for j := 3; j >= 0; j-- {
		bits := api.ToBinary(w[j], 64)
		for k := 7; k >= 0; k-- {
			out = append(out, b.ValueOf(api.FromBinary(bits[k*8:(k+1)*8]...)))
		}
	}
	return out
}
func canonicalScalar(api frontend.API, x frontend.Variable) p.Uint256 {
	bits := api.ToBinary(x, fr.Modulus().BitLen())
	bits = append(bits, 0, 0)
	var w p.Uint256
	for i := range w {
		w[i] = api.FromBinary(bits[i*64 : (i+1)*64]...)
	}
	api.AssertIsEqual(p.New(api).Less(w, p.MustValue(fr.Modulus())), 1)
	return w
}

// Fixed-width wire format shared with host/onchain adapter: domain ASCII,
// raw sourceSHA256 bytes, then each recordWords item encoded uint256 BE.
func (c *Circuit) recordWords(api frontend.API) []p.Uint256 {
	w := words(c.Preparation.Identity)
	w = append(w, p.Uint256{c.Preparation.Identity.TargetIsMoon, 0, 0, 0})
	w = append(w, canonicalScalar(api, c.Preparation.Raw), canonicalScalar(api, c.Preparation.Catalog), canonicalScalar(api, c.Preparation.Tech), c.Preparation.Rows)
	w = append(w, canonicalScalar(api, c.ContextHash), c.Request.ID, c.Request.Purpose, c.Request.Snapshot, c.Request.RandomWord, p.Uint256{c.Request.Ready, 0, 0, 0})
	return w
}
func (c *Circuit) Define(api frontend.API) error {
	a := p.New(api)
	api.AssertIsEqual(c.CatalogVersion, CatalogVersion)
	a.AssertEqual(c.Preparation.Identity.Catalog, p.Const(CatalogVersion))
	a.AssertEqual(c.Preparation.Identity.SeedPolicy, p.Const(SeedPolicy))
	api.AssertIsBoolean(c.Preparation.Identity.TargetIsMoon)
	for _, w := range append(words(c.Preparation.Identity), c.Preparation.Rows) {
		for _, v := range w {
			api.ToBinary(v, 64)
		}
	}
	// Game/verifier are address-sized identities, never ambiguous uint256 aliases.
	for _, w := range []p.Uint256{c.Preparation.Identity.Game, c.Preparation.Identity.Verifier} {
		api.ToBinary(w[2], 32)
		api.AssertIsEqual(w[3], 0)
	}
	api.AssertIsEqual(c.Preparation.Catalog, CatalogRoot())
	api.AssertIsEqual(c.ContextHash, hash(api, prep.ContextDomain, contextValues(c.Preparation)...))
	api.AssertIsEqual(c.PreparationTerminal[0], c.ContextHash)
	prep.AssertCombatInput(api, c.PreparationTerminal, c.Terminal, c.Input, RFRoot(), c.Seed, c.Snapshot)
	api.AssertIsEqual(c.Request.Ready, 1)
	api.AssertIsEqual(a.Equal(c.Request.ID, p.Const(0)), 0)
	a.AssertEqual(c.Request.Snapshot, p.Uint256(c.Snapshot))
	bytes, err := uints.NewBytes(api)
	if err != nil {
		return err
	}
	keccak, err := sha3.NewLegacyKeccak256(api)
	if err != nil {
		return err
	}
	purposeInput := uints.NewU8Array(purposeDomain())
	purposeInput = append(purposeInput, wordBytes(api, bytes, c.Preparation.Identity.Chain)...)
	purposeInput = append(purposeInput, wordBytes(api, bytes, c.Preparation.Identity.Battle)...)
	keccak.Write(purposeInput)
	purposeDigest := keccak.Sum()
	claimedPurpose := wordBytes(api, bytes, c.Request.Purpose)
	for i := range purposeDigest {
		api.AssertIsEqual(bytes.Value(purposeDigest[i]), bytes.Value(claimedPurpose[i]))
	}
	seed := wordBytes(api, bytes, c.Request.RandomWord)
	for i := range seed {
		api.AssertIsEqual(c.Seed[i], bytes.Value(seed[i]))
	}
	h, err := sha2.New(api)
	if err != nil {
		return err
	}
	sourceDigest, _ := hex.DecodeString(SourceSHA256)
	data := uints.NewU8Array(append([]byte(RecordDomain), sourceDigest...))
	for _, w := range c.recordWords(api) {
		data = append(data, wordBytes(api, bytes, w)...)
	}
	h.Write(data)
	digest := h.Sum()
	claimed := wordBytes(api, bytes, c.ChainCommitment)
	for i := range digest {
		api.AssertIsEqual(bytes.Value(digest[i]), bytes.Value(claimed[i]))
	}
	return nil
}
