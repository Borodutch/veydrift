package qualification

import (
	"bytes"
	"crypto/sha256"
	m "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"os"
	"testing"
)

func fixture(t *testing.T) *Circuit {
	t.Helper()
	id := prep.Identity{Chain: p.Const(8453), Game: p.Const(123), Battle: p.Const(99), Body: p.Const(17), Incarnation: p.Const(3), Impact: p.Const(9999), Rules: p.Const(2), Verifier: p.Const(456), Catalog: p.Const(1), SeedPolicy: p.Const(1), TargetIsMoon: 0}
	rows := []prep.Row{{Owner: p.Const(7), Source: p.Const(9), Count: p.Const(1), Side: 0, Type: 0, Tech: p.Technology{Weapons: 0, Shielding: 0, Armor: 0}}}
	machine, err := prep.New(id, rows, Bases())
	if err != nil {
		t.Fatal(err)
	}
	steps, err := machine.Chunk(50)
	if err != nil {
		t.Fatal(err)
	}
	random := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(7))
	q, err := New(machine.C, machine.State, steps[len(steps)-1].Statement(), p.Const(4), p.MustValue(random))
	if err != nil {
		t.Fatal(err)
	}
	return q
}
func TestPinnedCompleteCatalog(t *testing.T) {
	original, err := os.ReadFile("../../battle-oracle/fixtures/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(original, source) || ValidateSource(original) != nil {
		t.Fatal("source pin")
	}
	changed := append([]byte{}, source...)
	changed[10] ^= 1
	if ValidateSource(changed) == nil {
		t.Fatal("source substitution")
	}
	if len(Bases()) != 24 || Factor(0, 0) != 1 || Factor(11, 9) != 1250 || Factor(6, 16) != 10 || Factor(23, 0) != 1 {
		t.Fatal("catalog/factor mapping")
	}
	all := m.NewMemory()
	for a := uint16(0); a < 24; a++ {
		for b := uint16(0); b < 24; b++ {
			all.Write(m.Key{Domain: m.RFDomain, Index: m.W(uint64(a)*65536 + uint64(b))}, m.Cell{m.W(Factor(a, b) - 1)})
		}
	}
	if all.Root().Cmp(RFRoot()) != 0 {
		t.Fatal("complete576 root differs")
	}
	missing := m.NewMemory()
	wrongDomain := m.NewMemory()
	for lane, f := range Rapidfire() {
		if lane != 9 {
			missing.Write(m.Key{Domain: m.RFDomain, Index: m.W(uint64(lane))}, m.Cell{m.W(f - 1)})
		}
		wrongDomain.Write(m.Key{Domain: m.RosterDomain, Index: m.W(uint64(lane))}, m.Cell{m.W(f - 1)})
	}
	if missing.Root().Cmp(RFRoot()) == 0 || wrongDomain.Root().Cmp(RFRoot()) == 0 {
		t.Fatal("RF omission/domain substitution")
	}
	if ProductionAvailable || RequireProductionBridge() == nil {
		t.Fatal("unimplemented live bridge must stay unavailable")
	}
}
func TestQualificationSolver(t *testing.T) {
	good := fixture(t)
	cc, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &Circuit{})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("qualification constraints=%d public=%d", cc.GetNbConstraints(), cc.GetNbPublicVariables())
	check := func(t *testing.T, w *Circuit, ok bool) {
		t.Helper()
		v, e := frontend.NewWitness(w, ecc.BN254.ScalarField())
		if e != nil {
			t.Fatal(e)
		}
		e = cc.IsSolved(v)
		if (e == nil) != ok {
			t.Fatalf("valid=%v err=%v", ok, e)
		}
	}
	check(t, good, true)
	cases := []struct {
		name string
		f    func(*Circuit)
	}{
		{"catalog-substitution", func(q *Circuit) { q.Preparation.Catalog = 1 }},
		{"wrong-version", func(q *Circuit) { q.CatalogVersion = 2 }},
		{"wrong-identity-version", func(q *Circuit) { q.Preparation.Identity.Catalog = p.Const(2) }},
		{"wrong-seed-policy", func(q *Circuit) { q.Preparation.Identity.SeedPolicy = p.Const(2) }},
		{"seed-byte", func(q *Circuit) { q.Seed[0] = 0 }},
		{"seed-high-limb", func(q *Circuit) { q.Request.RandomWord[3] = 0 }},
		{"random-field-alias", func(q *Circuit) { q.Request.RandomWord[0] = new(big.Int).Lsh(big.NewInt(1), 64) }},
		{"snapshot-alias", func(q *Circuit) {
			n := new(big.Int).Add(q.ContextHash.(*big.Int), fr.Modulus())
			q.Snapshot = [4]frontend.Variable(p.MustValue(n))
			q.Request.Snapshot = p.Uint256(q.Snapshot)
		}},
		{"wrong-purpose", func(q *Circuit) { q.Request.Purpose = p.Const(1) }},
		{"request-zero", func(q *Circuit) { q.Request.ID = p.Const(0) }},
		{"not-ready", func(q *Circuit) { q.Request.Ready = 0 }},
		{"wrong-snapshot", func(q *Circuit) { q.Request.Snapshot = p.Const(1) }},
		{"chain-replay", func(q *Circuit) { q.Preparation.Identity.Chain = p.Const(1) }},
		{"game-replay", func(q *Circuit) { q.Preparation.Identity.Game = p.Const(1) }},
		{"battle-replay", func(q *Circuit) { q.Preparation.Identity.Battle = p.Const(1) }},
		{"body-replay", func(q *Circuit) { q.Preparation.Identity.Body = p.Const(1) }},
		{"moon-replay", func(q *Circuit) { q.Preparation.Identity.TargetIsMoon = 1 }},
		{"incarnation-replay", func(q *Circuit) { q.Preparation.Identity.Incarnation = p.Const(1) }},
		{"impact-replay", func(q *Circuit) { q.Preparation.Identity.Impact = p.Const(1) }},
		{"rules-replay", func(q *Circuit) { q.Preparation.Identity.Rules = p.Const(1) }},
		{"verifier-replay", func(q *Circuit) { q.Preparation.Identity.Verifier = p.Const(1) }},
		{"commitment-high-limb", func(q *Circuit) { q.ChainCommitment[3] = 0 }},
		{"commitment-field-alias", func(q *Circuit) {
			n, _ := value(q.ChainCommitment)
			if n.Cmp(fr.Modulus()) >= 0 {
				n.Sub(n, fr.Modulus())
			} else {
				n.Add(n, fr.Modulus())
			}
			q.ChainCommitment = p.MustValue(n)
		}},
		{"missing-rf-root", func(q *Circuit) {
			roster, _ := scalar(q.Terminal.UnitRoot)
			n, _ := value(q.Terminal.Total)
			var seed [32]byte
			for i := range seed {
				seed[i] = byte(q.Seed[i].(uint64))
			}
			snapshot := m.Big(q.ContextHash.(*big.Int))
			ctx := m.Context{Roster: roster, RF: m.EmptyRoot(), N: m.Big(n), Seed: seed, Snapshot: [4]uint64(snapshot)}
			q.Input = ctx.Commitment()
		}},
		{"sha-domain", func(q *Circuit) {
			b, _ := RecordBytes(q.Preparation, q.Request)
			b[0] ^= 1
			s := sha256.Sum256(b)
			q.ChainCommitment = p.MustValue(new(big.Int).SetBytes(s[:]))
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) { bad := *good; tc.f(&bad); check(t, &bad, false) })
	}
	// A fully rebuilt second battle is a valid candidate relation, but cannot
	// replay against the first battle's trusted chain digest.
	other := *good
	other.Preparation.Identity.Battle = p.Const(100)
	other.Request.Purpose = Purpose(other.Preparation.Identity.Chain, other.Preparation.Identity.Battle)
	trusted := good.ChainCommitment
	different, err := ChainDigest(other.Preparation, other.Request)
	if err != nil {
		t.Fatal(err)
	}
	if Crosscheck(different, trusted) == nil {
		t.Fatal("cross-battle commitment accepted")
	}
	if err := Crosscheck(good.ChainCommitment, trusted); err != nil {
		t.Fatal(err)
	}
}
