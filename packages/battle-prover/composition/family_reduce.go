package composition

import (
	"fmt"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/frontend"
	"math/big"
)

// FamilyEnvelope carries a genuine proof from the prover callback. No native
// constructor is a proof verifier; every emitted node verifies its dependency.
type FamilyEnvelope struct {
	Range FamilyRange
	Auth  CatalogAuth
	Kind  int
	work  *big.Int
}

// ReduceFamily is streaming O(height) proof storage, with a fixed catalog and
// fixed node relation per phase/height/arity. The callback may cache reusable
// development setup keys IN MEMORY by FamilyID. It must never return dummy
// proofs; invalid callback results fail the next standard recursive verifier.
// All height256 family keys must already be approved before production use.
func ReduceFamily(phase, height int, catalog *KeyCatalog, next func() (FamilyEnvelope, bool, error), prove func(FamilyID, frontend.Circuit) (CatalogAuth, error)) (FamilyEnvelope, error) {
	if phase < 0 || phase > Report || height < 0 || height > 256 || catalog == nil {
		return FamilyEnvelope{}, fmt.Errorf("invalid reducer configuration")
	}
	emit := func(id FamilyID, children []FamilyEnvelope, selectors []int) (FamilyEnvelope, error) {
		keys, e := catalog.ForFamily(id)
		if e != nil {
			return FamilyEnvelope{}, e
		}
		n := &FamilyNode{Phase: phase, Level: id.Level}
		if n.Level == 0 {
			n.Level = 1
		}
		n.Range = children[0].Range
		n.Range.Last = children[len(children)-1].Range.Last
		work := new(big.Int)
		for i, ch := range children {
			if ch.work == nil {
				return FamilyEnvelope{}, fmt.Errorf("missing scheduler count")
			}
			work.Add(work, ch.work)
			auth := ch.Auth
			auth.Keys = keys
			auth.Selector = selectors[i]
			n.Children = append(n.Children, auth)
			n.ChildRanges = append(n.ChildRanges, ch.Range)
		}
		if work.Sign() <= 0 || work.BitLen() > 256 {
			return FamilyEnvelope{}, fmt.Errorf("uint256 work overflow")
		}
		n.Range.Count = p.MustValue(work)
		n.FamilyPublic = n.Range.Public(phase)
		auth, e := prove(id, n)
		if e != nil {
			return FamilyEnvelope{}, e
		}
		return FamilyEnvelope{Range: n.Range, Auth: auth, work: work}, nil
	}
	merge := func(level int, left, right FamilyEnvelope) (FamilyEnvelope, error) {
		binary, e := emit(FamilyID{Phase: phase, Level: level, Arity: 2}, []FamilyEnvelope{left, right}, []int{0, 0})
		if e != nil {
			return FamilyEnvelope{}, e
		}
		return emit(FamilyID{Phase: phase, Level: level, Arity: 1}, []FamilyEnvelope{binary}, []int{0})
	}
	lift := func(level int, x FamilyEnvelope) (FamilyEnvelope, error) {
		return emit(FamilyID{Phase: phase, Level: level, Arity: 1}, []FamilyEnvelope{x}, []int{1})
	}
	stack := make([]*FamilyEnvelope, height+1)
	total := new(big.Int)
	capacity := new(big.Int).Lsh(big.NewInt(1), uint(height))
	for {
		leaf, ok, e := next()
		if e != nil {
			return FamilyEnvelope{}, e
		}
		if !ok {
			break
		}
		total.Add(total, big.NewInt(1))
		if total.BitLen() > 256 || total.Cmp(capacity) > 0 {
			return FamilyEnvelope{}, fmt.Errorf("uint256 work overflow")
		}
		leaf.work = big.NewInt(1)
		current, e := emit(FamilyID{Phase: phase, Arity: 1}, []FamilyEnvelope{leaf}, []int{leaf.Kind})
		if e != nil {
			return FamilyEnvelope{}, e
		}
		level := 0
		for level <= height && stack[level] != nil {
			if level == height {
				return FamilyEnvelope{}, fmt.Errorf("root height exhausted")
			}
			current, e = merge(level+1, *stack[level], current)
			if e != nil {
				return FamilyEnvelope{}, e
			}
			stack[level] = nil
			level++
		}
		stack[level] = &current
	}
	if total.Sign() == 0 {
		return FamilyEnvelope{}, fmt.Errorf("empty trace")
	}
	var current *FamilyEnvelope
	at := 0
	for level, prefix := range stack {
		if prefix == nil {
			continue
		}
		if current == nil {
			copy := *prefix
			current = &copy
			at = level
			continue
		}
		for at < level {
			x, e := lift(at+1, *current)
			if e != nil {
				return FamilyEnvelope{}, e
			}
			current = &x
			at++
		}
		if at != level || level == height {
			return FamilyEnvelope{}, fmt.Errorf("invalid reduction height")
		}
		x, e := merge(level+1, *prefix, *current)
		if e != nil {
			return FamilyEnvelope{}, e
		}
		current = &x
		at = level + 1
	}
	for at < height {
		x, e := lift(at+1, *current)
		if e != nil {
			return FamilyEnvelope{}, e
		}
		current = &x
		at++
	}
	return *current, nil
}
