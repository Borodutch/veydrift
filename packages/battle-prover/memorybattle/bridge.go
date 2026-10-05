package memorybattle

import (
	"errors"
	"github.com/consensys/gnark/frontend"
	"math/big"
)

// Exported encoding helpers are shared by preparation and terminal projection.
const (
	PhaseField   = phase
	RoundField   = round
	SideField    = side
	ShooterField = shooter
	TargetField  = target
	CursorField  = cursor
	Count0Field  = count0
	Count1Field  = count1
	RankField    = rank
	Shots0Field  = shots0
	Shots1Field  = shots1
	OutcomeField = outcome
	StepField    = step
	CounterField = counter
)

func (o *Opening) Verify(api frontend.API, root frontend.Variable, domain uint64, index U) {
	o.constrain(api, root, domain, index)
}
func (o *Opening) VerifyWrite(api frontend.API, root frontend.Variable, domain uint64, index U, next CircuitCell) {
	o.write(api, root, domain, index, next)
}
func CellHash(c Cell) *big.Int { return cellHash(c) }
func EmptyRoot() *big.Int      { return NewMemory().Root() }
func ContextCommitmentCircuit(api frontend.API, roster, rf frontend.Variable, n U, seed [32]frontend.Variable, snapshot [4]frontend.Variable) frontend.Variable {
	v := append([]frontend.Variable{roster, rf}, n[:]...)
	v = append(v, 3)
	v = append(v, seed[:]...)
	v = append(v, snapshot[:]...)
	for _, x := range n {
		api.ToBinary(x, 64)
	}
	for _, x := range seed {
		api.ToBinary(x, 8)
	}
	for _, x := range snapshot {
		api.ToBinary(x, 64)
	}
	return hashCircuit(api, contextDomain, v...)
}
func StateCommitmentCircuit(api frontend.API, v [StateSize]U, m, r frontend.Variable) frontend.Variable {
	for _, w := range v {
		for _, x := range w {
			api.ToBinary(x, 64)
		}
	}
	return hashCircuit(api, stateDomain, append([]frontend.Variable{m, r}, flatten(v[:]...)...)...)
}
func ResultCommitmentCircuit(api frontend.API, input, m, r frontend.Variable, round, count0, count1, outcome U) frontend.Variable {
	for _, w := range []U{round, count0, count1, outcome} {
		for _, x := range w {
			api.ToBinary(x, 64)
		}
	}
	return hashCircuit(api, resultDomain, append([]frontend.Variable{input, m, r}, flatten(round, count0, count1, outcome)...)...)
}

// A checkpoint is advice, never a replacement for a verified prefix. Its roots
// must match the previous verified statement in the recursive accumulator.
func NewCheckpoint(c Context, s State, roster, rf, memory *Memory) (*Machine, error) {
	if roster == nil || rf == nil || memory == nil || c.Roster == nil || c.RF == nil || s.Memory == nil || s.Report == nil {
		return nil, errors.New("incomplete checkpoint")
	}
	if roster.Root().Cmp(c.Roster) != 0 || rf.Root().Cmp(c.RF) != 0 || memory.Root().Cmp(s.Memory) != 0 {
		return nil, errors.New("checkpoint root mismatch")
	}
	return &Machine{c, s, roster, rf, memory}, nil
}

// AssertTerminal authenticates the full terminal checkpoint against a VERIFIED
// combat statement. It does not verify the statement's proof/key itself.
func AssertTerminal(api frontend.API, statement Statement, v [StateSize]U, memory, report frontend.Variable) {
	api.AssertIsEqual(statement[AfterDoneField], 1)
	api.AssertIsEqual(statement[AfterField], StateCommitmentCircuit(api, v, memory, report))
	for j, x := range v[phase] {
		if j == 0 {
			api.AssertIsEqual(x, Done)
		} else {
			api.AssertIsEqual(x, 0)
		}
	}
	api.AssertIsEqual(statement[ResultField], ResultCommitmentCircuit(api, statement[InputField], memory, report, v[round], v[count0], v[count1], v[outcome]))
}
