package publisher

import (
	"encoding/hex"
	"errors"
	"math/big"
	"strconv"
	"strings"

	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	"golang.org/x/crypto/sha3"
)

const AuthoritySchema = "veydrift.proof-artifact-authority.v1"

// Field order is part of the canonical cross-language wire contract. ALL strings.
type Authority struct {
	Schema                string `json:"schema"`
	ChainID               string `json:"chainId"`
	Game                  string `json:"game"`
	BattleID              string `json:"battleId"`
	Binding               string `json:"binding"`
	ReleaseID             string `json:"releaseId"`
	VKHash                string `json:"vkHash"`
	InputHash             string `json:"inputHash"`
	CompressedProofHash   string `json:"compressedProofHash"`
	ExportSHA256          string `json:"exportSha256"`
	CatalogSHA256         string `json:"catalogSha256"`
	JobKey                string `json:"jobKey"`
	JobGeneration         string `json:"jobGeneration"`
	JobAnchorNumber       string `json:"jobAnchorNumber"`
	JobAnchorHash         string `json:"jobAnchorHash"`
	ArtifactBlobSHA256    string `json:"artifactBlobSha256"`
	PublisherConfigSHA256 string `json:"publisherConfigSha256"`
}

func address(s string) bool {
	if len(s) != 42 || !strings.HasPrefix(s, "0x") {
		return false
	}
	b, e := hex.DecodeString(s[2:])
	return e == nil && hex.EncodeToString(b) == s[2:] && s != "0x"+strings.Repeat("0", 40)
}
func decimal(s string, bits int, positive bool) (*big.Int, error) {
	if len(s) < 1 || len(s) > 78 {
		return nil, errors.New("invalid decimal length")
	}
	n, ok := new(big.Int).SetString(s, 10)
	if !ok || n.Sign() < 0 || (positive && n.Sign() == 0) || n.BitLen() > bits || n.String() != s {
		return nil, errors.New("noncanonical integer")
	}
	return n, nil
}
func keccak(b []byte) string {
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write(b)
	return hex.EncodeToString(h.Sum(nil))
}
func word(n *big.Int) []byte { b := make([]byte, 32); n.FillBytes(b); return b }
func hexWord(s string) []byte {
	b, _ := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	out := make([]byte, 32)
	copy(out[32-len(b):], b)
	return out
}

// ReleaseID is keccak256(abi.encode(uint32,bytes32,bytes32,address,bytes32)).
// Catalog is the on-chain rules catalog identifier, NOT catalog manifest SHA256.
func ReleaseID(r chainsource.Release) (string, error) {
	if r.Version != 3 || !digest(r.Rules) || !digest(r.Catalog) || !digest(r.VerifierCodehash) || !address(r.Verifier) {
		return "", errors.New("invalid release ABI")
	}
	b := word(new(big.Int).SetUint64(uint64(r.Version)))
	for _, s := range []string{r.Rules, r.Catalog, r.Verifier, r.VerifierCodehash} {
		b = append(b, hexWord(s)...)
	}
	return "0x" + keccak(b), nil
}

// Basename returns the common 64-hex name, without suffix.
func Basename(chainID, game, battleID, binding, releaseID string) (string, error) {
	chain, e := decimal(chainID, 256, true)
	if e != nil {
		return "", e
	}
	battle, e := decimal(battleID, 256, true)
	if e != nil {
		return "", e
	}
	if !address(game) || !strings.HasPrefix(binding, "0x") || !digest(strings.TrimPrefix(binding, "0x")) || !strings.HasPrefix(releaseID, "0x") || !digest(strings.TrimPrefix(releaseID, "0x")) {
		return "", errors.New("invalid filename identity")
	}
	b := word(chain)
	b = append(b, hexWord(game)...)
	b = append(b, word(battle)...)
	b = append(b, hexWord(binding)...)
	b = append(b, hexWord(releaseID)...)
	return keccak(b), nil
}
func (a Authority) Validate() error {
	if a.Schema != AuthoritySchema {
		return errors.New("invalid authority schema")
	}
	if _, e := Basename(a.ChainID, a.Game, a.BattleID, a.Binding, a.ReleaseID); e != nil {
		return e
	}
	if _, e := decimal(a.JobAnchorNumber, 64, false); e != nil {
		return e
	}
	for _, s := range []string{a.VKHash, a.InputHash, a.CompressedProofHash, a.ExportSHA256, a.CatalogSHA256, a.JobKey, a.JobGeneration, a.JobAnchorHash, a.ArtifactBlobSHA256, a.PublisherConfigSHA256} {
		if !digest(s) {
			return errors.New("noncanonical authority digest")
		}
	}
	return nil
}
func anchorNumber(n uint64) string { return strconv.FormatUint(n, 10) }
