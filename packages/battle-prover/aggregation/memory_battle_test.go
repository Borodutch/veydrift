//go:build !plonk_experiment && memory_battle_integration

package aggregation

import (
	"github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"math/big"
	"testing"
)

func memoryLeafRange(s *memorybattle.Step) MemoryRange {
	v := s.Statement()
	return MemoryRange{v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7]}
}

// An actual empty-roster Boot -> Ready -> Done execution gives two SMALL
// heterogeneous memorybattle leaves without a Merkle access or outer setup.
// This is deliberately not evidence for a nonempty battle or deep recursion.
// The build tag isolates the independently migrating leaf API from adapter CI.
func TestMemoryBattleRecursiveLeaves(t *testing.T) {
	memoryBudget(t)
	m, e := memorybattle.New(memorybattle.PreparedInput{Seed: [32]byte{1}, Snapshot: [4]uint64{1, 2, 3, 4}})
	check(t, e)
	genesis := m.State.Commitment()
	a, e := m.Next()
	check(t, e)
	b, e := m.Next()
	check(t, e)
	if _, e = m.Next(); e == nil {
		t.Fatal("leaf host accepted postterminal transition")
	}
	leftCC := compiled(t, memorybattle.Shape(memorybattle.Boot))
	rightCC := compiled(t, memorybattle.Shape(memorybattle.Ready))
	for _, cc := range []int{leftCC.GetNbConstraints(), rightCC.GetNbConstraints()} {
		if cc > 150_000 {
			t.Fatalf("SMALL leaf setup ceiling exceeded: %d", cc)
		}
	}
	left, right := setup(t, leftCC), setup(t, rightCC)
	ap, bp := prove(t, left, a, Statement{}), prove(t, right, b, Statement{})
	ar, br := memoryLeafRange(a), memoryLeafRange(b)
	if ar.Before.(*big.Int).Cmp(genesis) != 0 {
		t.Fatal("wrong genesis")
	}
	r := ar
	r.After = br.After
	r.End = br.End
	r.AfterDone = br.AfterDone
	r.Result = br.Result
	// Compare actual public witness order to the adapter's eight-scalar order.
	pub, e := wit(t, b).Public()
	check(t, e)
	vec := pub.Vector().(fr.Vector)
	if len(vec) != 8 {
		t.Fatal("leaf public width changed")
	}
	for i, x := range br.values() {
		var want fr.Element
		_, e := want.SetInterface(x)
		check(t, e)
		if !want.Equal(&vec[i]) {
			t.Fatalf("leaf public field order changed at %d", i)
		}
	}
	pair := level{cc: compiled(t, memoryPairTemplate(t, left, right))}
	check(t, pair.cc.IsSolved(wit(t, memoryPairAssignment(r, ap, bp))))
	t.Log("ACTUAL MEMORYBATTLE: genuine Boot+Ready proofs authenticated by generated MemoryPair constraints; empty roster only, no outer proof")
	bad := r
	bad.Result = new(big.Int).Add(br.Result.(*big.Int), big.NewInt(1))
	rejectCombat(t, pair, "actual leaf terminal result mutation", memoryPairAssignment(bad, ap, bp))
	rejectCombat(t, pair, "actual heterogeneous leaf replay", memoryPairAssignment(r, ap, ap))
}
