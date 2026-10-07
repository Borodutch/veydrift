package composition

import (
	"fmt"
	"math/big"
)

// CountPlan needs O(height) memory, not O(roster) memory. It can plan the full
// uint256 protocol domain without materializing astronomical proof slices.
type LevelCount struct {
	Level                 int
	Pairs, Unary, Outputs *big.Int
}

func CountPlan(work *big.Int, height int) ([]LevelCount, error) {
	if work == nil || work.Sign() <= 0 || work.BitLen() > 256 || height < 0 || height > 256 {
		return nil, fmt.Errorf("invalid uint256 work/height")
	}
	current := new(big.Int).Set(work)
	out := make([]LevelCount, 0, height)
	for level := 1; level <= height; level++ {
		pairs := new(big.Int).Rsh(new(big.Int).Set(current), 1)
		unary := new(big.Int).And(current, big.NewInt(1))
		outputs := new(big.Int).Add(pairs, unary)
		out = append(out, LevelCount{level, pairs, unary, outputs})
		current = new(big.Int).Set(outputs)
	}
	if current.Cmp(big.NewInt(1)) != 0 {
		return nil, fmt.Errorf("height cannot cover work")
	}
	return out, nil
}

// ExtendToRoot makes the chosen test/production root level explicit. Unary
// promotions authenticate a real prior proof; they add no phantom work.
func ScheduleTo(leaves, height int) ([][]ScheduledNode, error) {
	if _, e := CountPlan(big.NewInt(int64(leaves)), height); e != nil {
		return nil, e
	}
	levels, e := Schedule(leaves)
	if e != nil {
		return nil, e
	}
	for len(levels) < height {
		levels = append(levels, []ScheduledNode{{Level: len(levels) + 1, Start: 0, End: leaves, Arity: 1}})
	}
	return levels, nil
}

// Required production instantiation order (not yet generated):
// 1 attribution leaves -> D0 -> B1,D1,...,B256,D256;
// 2 CompleteClose key pins attribution D256;
// 3 each other phase leaves -> D0 -> B1,D1,...,B256,D256;
// 4 final verifier pins each D256 root and qualified-input keys.
// No recursive VK fixed point or self-key is required.
// Dispatch-first: per phase D0 plus (B_h,D_h) for h1..256 = 513 keys,
// hence 2565 across five phases. Leaf catalogs:
// prep5,combat11,attribution4,bridge5(includes CompleteClose),report2 =27 keys.
// Circuit/setup keys depend on phase,level,arity and approved catalog only.
// This is an implementable uint256-bounded catalog SHAPE, not a claim all2565
// keys were generated or every catalog's <=4M cost measured.
const ProtocolRootHeight = 256
