package qualification

import (
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"testing"
)

func linkedFixture(t *testing.T) *LinkedCircuit {
	t.Helper()
	old := fixture(t)
	id := old.Preparation.Identity
	id.Catalog = CatalogID()
	id.Rules = RulesID()
	row := prep.Row{Owner: p.Const(7), Source: p.Const(99), Count: p.Const(1), Side: 0, Type: 0, Tech: p.Technology{Weapons: 0, Shielding: 0, Armor: 0}}
	pm, e := prep.New(id, []prep.Row{row}, Bases())
	if e != nil {
		t.Fatal(e)
	}
	ps, e := pm.Chunk(50)
	if e != nil {
		t.Fatal(e)
	}
	meta := rb.Metadata{Preparation: pm.C, Version: p.Const(LinkedVersion), Codehash: p.Const(77), Engine: p.Const(88), RequestID: p.Const(4), Purpose: Purpose(id.Chain, id.Battle)}
	var h rb.Header
	for i := range h {
		h[i] = p.Const(0)
	}
	h[0] = id.Body
	h[2] = id.Incarnation
	h[4] = id.Impact
	h[5] = p.Const(9)
	var mission rb.Mission
	for i := range mission {
		mission[i] = p.Const(0)
	}
	mission[0] = p.Const(1)
	mission[1] = p.Const(3)
	mission[2] = row.Owner
	mission[4] = id.Body
	mission[6] = id.Impact
	mission[12] = row.Count
	mission[26] = meta.RequestID
	rs, e := rb.Build(meta, h, []rb.Event{rb.SourceEvent(id.Battle, mission), rb.RowEvent(row)})
	if e != nil {
		t.Fatal(e)
	}
	last := rs[len(rs)-1]
	q, e := NewLinked(meta, last.Statement(), last.After.Journal, pm.State, ps[len(ps)-1].Statement(), old.Request.RandomWord)
	if e != nil {
		t.Fatal(e)
	}
	return q
}
func TestLinkedQualificationSolver(t *testing.T) {
	good := linkedFixture(t)
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &LinkedCircuit{})
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("linked qualification constraints=%d public=%d", cc.GetNbConstraints(), cc.GetNbPublicVariables())
	if cc.GetNbConstraints() > 4000000 {
		t.Fatal("4M ceiling")
	}
	check := func(t *testing.T, w *LinkedCircuit, ok bool) {
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
	forged, err := NewLinked(good.Meta, good.RawTerminal, good.ChainSnapshot, good.Terminal, good.PreparationTerminal, p.Const(42))
	if err != nil {
		t.Fatal(err)
	}
	// All private seed/input/precommit/context advice rebuilt consistently, but
	// the actual chain record is fixed: arbitrary alternative randomness fails.
	forged.ChainRecord = good.ChainRecord
	check(t, forged, false)
	if rb.Integer(good.ChainSnapshot).Cmp(rb.Integer(p.Uint256(good.PreparationSnapshot))) == 0 {
		t.Fatal("fixture must distinguish chain/prep snapshots")
	}
	cases := map[string]func(*LinkedCircuit){
		"wrong-chain-snapshot":       func(c *LinkedCircuit) { c.ChainSnapshot = p.Const(1) },
		"force-snapshot-equality":    func(c *LinkedCircuit) { c.ChainSnapshot = p.Uint256(c.PreparationSnapshot) },
		"wrong-preparation-snapshot": func(c *LinkedCircuit) { c.PreparationSnapshot = [4]frontend.Variable(c.ChainSnapshot) },
		"wrong-raw-result":           func(c *LinkedCircuit) { c.RawTerminal[3] = 1 },
		"wrong-raw-binding":          func(c *LinkedCircuit) { c.RawTerminal[0] = 1 },
		"unsealed-raw":               func(c *LinkedCircuit) { c.RawTerminal[4] = rb.Row },
		"seed-high-byte":             func(c *LinkedCircuit) { c.Seed[0] = 0 },
		"wrong-word":                 func(c *LinkedCircuit) { c.RandomWord = p.Const(42) },
		"zero-word":                  func(c *LinkedCircuit) { c.RandomWord = p.Const(0) },
		"wrong-purpose":              func(c *LinkedCircuit) { c.Meta.Purpose = p.Const(1) },
		"wrong-rng-context":          func(c *LinkedCircuit) { c.RandomnessContext = p.Const(1) },
		"wrong-precommit":            func(c *LinkedCircuit) { c.RandomnessCommitment = p.Const(1) },
		"wrong-engine":               func(c *LinkedCircuit) { c.Meta.Engine = p.Const(99) },
		"wrong-request":              func(c *LinkedCircuit) { c.Meta.RequestID = p.Const(99) },
		"wrong-codehash":             func(c *LinkedCircuit) { c.Meta.Codehash = p.Const(99) },
		"wrong-version":              func(c *LinkedCircuit) { c.Meta.Version = p.Const(4) },
		"wrong-rules":                func(c *LinkedCircuit) { c.Meta.Preparation.Identity.Rules = p.Const(2) },
		"wrong-catalog":              func(c *LinkedCircuit) { c.Meta.Preparation.Identity.Catalog = p.Const(1) },
		"wrong-game":                 func(c *LinkedCircuit) { c.Meta.Preparation.Identity.Game = p.Const(321) },
		"wrong-body":                 func(c *LinkedCircuit) { c.Meta.Preparation.Identity.Body = p.Const(18) },
		"wrong-incarnation":          func(c *LinkedCircuit) { c.Meta.Preparation.Identity.Incarnation = p.Const(4) },
		"wrong-research-root":        func(c *LinkedCircuit) { c.Meta.Preparation.Tech = 1 },
		"wrong-chain-record":         func(c *LinkedCircuit) { c.ChainRecord = p.Const(1) },
		"snapshot-field-alias": func(c *LinkedCircuit) {
			n := rb.Integer(c.ChainSnapshot)
			if n.Cmp(fr.Modulus()) >= 0 {
				n.Sub(n, fr.Modulus())
			} else {
				n.Add(n, fr.Modulus())
			}
			c.ChainSnapshot = p.MustValue(n)
		},
		"digest-limb-overflow": func(c *LinkedCircuit) { c.ChainRecord[0] = new(big.Int).Lsh(big.NewInt(1), 64) },
	}
	for name, f := range cases {
		t.Run(name, func(t *testing.T) { bad := *good; f(&bad); check(t, &bad, false) })
	}
}
