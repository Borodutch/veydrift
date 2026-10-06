package qualification

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	m "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/frontend"
	"math/big"
	"sync"
)

const CatalogVersion = 1
const SeedPolicy = 1
const TypeCount = 24
const SourceSHA256 = "86290965991ad030826bb0ae7d65f767940d1cbf7c37f0f76fcaaf11309e8ae1"

//go:embed catalog.json
var source []byte

type entry struct{ ID, Attack, Shield, Hull uint64 }
type lane struct{ Attacker, Defender, Value uint64 }
type document struct {
	Ships, Defenses                 []entry
	ShipRapidfire, DefenseRapidfire []lane
}
type pinned struct {
	bases               map[uint64]p.Stats
	rf                  map[uint32]uint64
	catalogRoot, rfRoot *big.Int
}

var once sync.Once
var fixed pinned

// ValidateSource refuses even semantically equivalent edits: the release pins bytes.
func ValidateSource(b []byte) error {
	sum := sha256.Sum256(b)
	if hex.EncodeToString(sum[:]) != SourceSHA256 {
		return fmt.Errorf("catalog source digest mismatch")
	}
	return nil
}
func load() pinned {
	once.Do(func() {
		if err := ValidateSource(source); err != nil {
			panic(err)
		}
		var d document
		if err := json.Unmarshal(source, &d); err != nil {
			panic(err)
		}
		if len(d.Ships) != 16 || len(d.Defenses) != 8 {
			panic("exact24types")
		}
		fixed.bases = map[uint64]p.Stats{}
		fixed.rf = map[uint32]uint64{}
		tree := prep.NewTree(big.NewInt(0))
		for typ, e := range append(d.Ships, d.Defenses...) {
			expected := typ
			if typ >= 16 {
				expected -= 16
			}
			if e.ID != uint64(expected) || e.Hull == 0 {
				panic("catalog IDs/stats")
			}
			s := p.Stats{Attack: p.Const(e.Attack), Shield: p.Const(e.Shield), Hull: p.Const(e.Hull)}
			fixed.bases[uint64(typ)] = s
			v := []frontend.Variable{uint64(typ)}
			v = append(v, s.Attack[:]...)
			v = append(v, s.Shield[:]...)
			v = append(v, s.Hull[:]...)
			tree.Write(big.NewInt(int64(typ)), prep.Hash(prep.CatalogDomain, v...))
		}
		memory := m.NewMemory()
		for section, lanes := range [][]lane{d.ShipRapidfire, d.DefenseRapidfire} {
			for _, l := range lanes {
				limit := uint64(16)
				if section == 1 {
					limit = 8
				}
				if l.Attacker >= 16 || l.Defender >= limit || l.Value < 2 || l.Value > 65535 {
					panic("invalid RF lane")
				}
				target := l.Defender + uint64(section*16)
				k := uint32(l.Attacker*65536 + target)
				if _, ok := fixed.rf[k]; ok {
					panic("duplicate RF lane")
				}
				fixed.rf[k] = l.Value
				memory.Write(m.Key{Domain: m.RFDomain, Index: m.W(uint64(k))}, m.Cell{m.W(l.Value - 1)})
			}
		}
		fixed.catalogRoot = tree.Root()
		fixed.rfRoot = memory.Root()
	})
	return fixed
}

// CatalogRoot and RFRoot are complete fixed trees, not prover-supplied tables.
// Every omitted RF lane is the all-zero cell, hence factor one. All other
// namespaces and uint256 keys are empty, including out-of-catalog type lanes.
func CatalogRoot() *big.Int { return new(big.Int).Set(load().catalogRoot) }
func RFRoot() *big.Int      { return new(big.Int).Set(load().rfRoot) }
func Bases() map[uint64]p.Stats {
	v := map[uint64]p.Stats{}
	for k, s := range load().bases {
		v[k] = s
	}
	return v
}
func Rapidfire() map[uint32]uint64 {
	v := map[uint32]uint64{}
	for k, s := range load().rf {
		v[k] = s
	}
	return v
}
func Factor(shooter, target uint16) uint64 {
	if v, ok := load().rf[uint32(shooter)*65536+uint32(target)]; ok {
		return v
	}
	return 1
}
