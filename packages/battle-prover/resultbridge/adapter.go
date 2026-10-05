package resultbridge

import (
	"fmt"
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
)

// FromMachines checks actual package commitments before constructing witnesses.
// Native machines are NOT proofs: callers still verify every dependency listed
// in README. groups must be the complete positive canonical preparation rows.
func FromMachines(prepared *prep.Machine, combat *mb.Machine, groups []Group) (*Machine, error) {
	if prepared == nil || combat == nil {
		return nil, fmt.Errorf("nil machine")
	}
	if scalar(prepared.State.Phase).Int64() != prep.Done || combat.State.V[0] != mb.W(mb.Done) {
		return nil, fmt.Errorf("nonterminal dependency")
	}
	cr, mr, n, nm := PreparedRoots(groups)
	if cr.Cmp(scalar(prepared.State.Cohorts)) != 0 || mr.Cmp(scalar(prepared.State.Members)) != 0 || number(n).Cmp(number(prepared.State.Total)) != 0 {
		return nil, fmt.Errorf("canonical manifests mismatch")
	}
	if combat.Context.Roster.Cmp(scalar(prepared.State.UnitRoot)) != 0 || combat.Context.N.Big().Cmp(number(n)) != 0 {
		return nil, fmt.Errorf("prepared combat roster mismatch")
	}
	snapshot := mb.Big(prepared.C.Commitment())
	if combat.Context.Snapshot != [4]uint64(snapshot) {
		return nil, fmt.Errorf("combat snapshot must encode preparation context")
	}
	c := Context{Prepared: Prepared{PreparationContext: prepared.C.Commitment(), Snapshot: snapshot.Circuit(), Roster: combat.Context.Roster, RF: combat.Context.RF, N: n, Cohorts: Z(uint64(len(groups))), Members: nm, CohortRoot: cr, MemberRoot: mr}, Combat: Combat{Memory: combat.State.Memory, Report: combat.State.Report, Round: combat.State.V[1].Circuit(), Count0: combat.State.V[6].Circuit(), Count1: combat.State.V[7].Circuit(), Outcome: combat.State.V[11].Circuit()}}
	for i, b := range combat.Context.Seed {
		c.Combat.Seed[i] = uint64(b)
	}
	if c.Input().Cmp(combat.Context.Commitment()) != 0 || c.CombatResult().Cmp(combat.Context.Result(combat.State)) != 0 {
		return nil, fmt.Errorf("combat commitment mismatch")
	}
	return New(c, groups, func(i U) Opening {
		o := combat.Memory.Open(mb.Key{Domain: mb.UnitDomain, Index: mb.Big(number(i))})
		return Opening{Cell: Cell(o.Cell), Siblings: o.Siblings}
	}), nil
}
