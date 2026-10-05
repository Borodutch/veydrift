package protocol

import "github.com/consensys/gnark/frontend"

// ExpandCircuit checks one unit emitted from a supplied prepared cohort. Unit
// rank is full uint256. Offsets cover [0,Count); a caller must authenticate the
// cohort and chain NextOffset/NextIndex, requiring first offset zero and ending
// each cohort only when Last=1. Isolated rows do NOT establish completeness.
// At max Index, the increment refuses (no wrap / alternate battle result).
type ExpandCircuit struct {
	Key                                             Key
	Cohort, Count, Offset, Index                    Uint256
	UnitKey                                         Key
	UnitCohort, Hull, Shield, NextOffset, NextIndex Uint256
	Last                                            frontend.Variable
}

func (c *ExpandCircuit) Define(api frontend.API) error {
	a := New(api)
	a.CheckKey(c.Key)
	a.CheckKey(c.UnitKey)
	_, equal := a.CompareKeys(c.Key, c.UnitKey)
	api.AssertIsEqual(equal, 1)
	a.AssertEqual(c.Cohort, c.UnitCohort)
	api.AssertIsEqual(a.Less(c.Offset, c.Count), 1)
	next := a.AddChecked(c.Offset, Const(1))
	last := a.Equal(next, c.Count)
	api.AssertIsEqual(c.Last, last)
	a.AssertEqual(c.NextOffset, a.Select(last, Const(0), next))
	a.AssertEqual(c.NextIndex, a.AddChecked(c.Index, Const(1)))
	a.AssertEqual(c.Hull, c.Key.Stats.Hull)
	a.AssertEqual(c.Shield, c.Key.Stats.Shield)
	return nil
}
