package runtime

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"

	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	comp "github.com/Borodutch/veydrift/packages/battle-prover/composition"
	mb "github.com/Borodutch/veydrift/packages/battle-prover/memorybattle"
	out "github.com/Borodutch/veydrift/packages/battle-prover/outputbridge"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	"github.com/consensys/gnark/frontend"
)

const TraceQualification = 7

// TraceEvent is one real elementary assignment. Phase IDs match composition.
// Group is the decimal cohort ID for attribution and its consuming bridge Close.
// Assignments and all returned result objects must be treated as immutable.
type TraceEvent struct {
	Phase int
	Group string
	Kind  int
	Step  frontend.Circuit
}
type TraceEndpoint struct {
	First, Last frontend.Circuit
	Count       p.Uint256
}
type TraceClose struct {
	Group       string
	Step        *rb.Step
	Attribution TraceEndpoint
}
type TraceResult struct {
	Endpoints     map[int]TraceEndpoint
	Attributions  map[string]TraceEndpoint
	Closes        []TraceClose
	Qualification *q.LinkedCircuit
	Manifest      out.Manifest
	Leaves        []out.Leaf
}
type TraceCheckpoint struct {
	Schema         string
	Identity       service.Identity
	Anchor         service.Anchor
	Release        chainsource.Release
	Events, Digest string
}

// Trace owns mutable native advice, not proofs. It is not concurrent-safe.
// Work cursors/counts are uint256; host slices remain finite materializations.
type Trace struct {
	preparation *PreparationWitness
	rawSteps    []*raw.Step
	rawIndex    int
	stage       int
	groups      []rb.Group
	units       []mb.Cell
	combat      *mb.Machine
	bridge      *rb.Machine
	allocation  *attr.Machine
	dead        []bool
	records     []rb.ReportRecord
	reportState rb.ReportState
	reportIndex int
	reportLast  *rb.ReportStep
	output      *out.Machine
	result      TraceResult
	count       *big.Int
	digest      [32]byte
	resume      *TraceCheckpoint
	poisoned    bool
}

func traceScalar(v frontend.Variable) *big.Int {
	switch x := v.(type) {
	case int:
		return big.NewInt(int64(x))
	case uint64:
		return new(big.Int).SetUint64(x)
	case uint32:
		return new(big.Int).SetUint64(uint64(x))
	case *big.Int:
		return new(big.Int).Set(x)
	}
	panic("unsupported native trace scalar")
}
func traceFields(ws ...p.Uint256) []frontend.Variable {
	var v []frontend.Variable
	for _, w := range ws {
		v = append(v, w[:]...)
	}
	return v
}
func traceInc(w p.Uint256) p.Uint256 {
	return p.MustValue(new(big.Int).Add(raw.Integer(w), big.NewInt(1)))
}

// NewTrace validates the full finalized document against the independently
// approved release. raw.Build is an explicit O(document*tree-depth) admission
// materialization here, not concealed inside an elementary transition.
func NewTrace(s service.Snapshot, approved chainsource.Release, limits WitnessLimits) (*Trace, error) {
	w, e := NewPreparationWitness(s, approved, limits)
	if e != nil {
		return nil, e
	}
	rs, e := w.RawWitnesses()
	if e != nil {
		return nil, e
	}
	return &Trace{preparation: w, rawSteps: rs, stage: comp.RawJournal, count: new(big.Int), reportState: rb.ReportInitial(), result: TraceResult{Endpoints: map[int]TraceEndpoint{}, Attributions: map[string]TraceEndpoint{}}}, nil
}
func (t *Trace) Done() bool { return t.stage == 8 && t.resume == nil && !t.poisoned }
func (t *Trace) Result() (*TraceResult, error) {
	if !t.Done() {
		return nil, errors.New("trace not terminal or replay unverified")
	}
	return &t.result, nil
}
func (t *Trace) Checkpoint() (TraceCheckpoint, error) {
	if t.poisoned || t.resume != nil {
		return TraceCheckpoint{}, errors.New("trace replay unverified")
	}
	w := t.preparation
	return TraceCheckpoint{"veydrift.native-trace-replay.v1", w.identity, w.anchor, w.release, t.count.String(), hex.EncodeToString(t.digest[:])}, nil
}
func RestoreTrace(s service.Snapshot, approved chainsource.Release, limits WitnessLimits, cp TraceCheckpoint) (*Trace, error) {
	t, e := NewTrace(s, approved, limits)
	if e != nil {
		return nil, e
	}
	n, ok := new(big.Int).SetString(cp.Events, 10)
	if cp.Schema != "veydrift.native-trace-replay.v1" || cp.Identity != s.Identity || cp.Anchor != s.Anchor || cp.Release != approved || !ok || n.Sign() < 0 || n.BitLen() > 256 || n.String() != cp.Events || !witnessHex(cp.Digest, 32, false) {
		return nil, errors.New("trace checkpoint identity/cursor/digest")
	}
	t.resume = &cp
	return t, nil
}
func (t *Trace) budget(n int) error {
	if t.poisoned {
		return errors.New("trace poisoned")
	}
	if n < 1 || n > t.preparation.limits.MaxChunkSteps {
		return errors.New("trace chunk budget")
	}
	return nil
}
func (t *Trace) Replay(ctx context.Context, budget int) (bool, error) {
	if e := t.budget(budget); e != nil {
		return false, e
	}
	if t.resume == nil {
		return true, nil
	}
	target, _ := new(big.Int).SetString(t.resume.Events, 10)
	for i := 0; i < budget && t.count.Cmp(target) < 0; i++ {
		if _, e := t.next(ctx); e != nil {
			if e == io.EOF {
				t.poisoned = true
				return false, errors.New("checkpoint past terminal trace")
			}
			return false, e
		}
	}
	if t.count.Cmp(target) != 0 {
		return false, nil
	}
	if hex.EncodeToString(t.digest[:]) != t.resume.Digest {
		t.poisoned = true
		return false, errors.New("trace replay digest mismatch")
	}
	t.resume = nil
	return true, nil
}
func (t *Trace) Next(ctx context.Context) (*TraceEvent, error) {
	if t.resume != nil {
		return nil, errors.New("trace checkpoint replay required")
	}
	return t.next(ctx)
}
func (t *Trace) Chunk(ctx context.Context, budget int) ([]TraceEvent, error) {
	if e := t.budget(budget); e != nil {
		return nil, e
	}
	var events []TraceEvent
	for i := 0; i < budget; i++ {
		e, err := t.Next(ctx)
		if err == io.EOF {
			return events, nil
		}
		if err != nil {
			return events, err
		}
		events = append(events, *e)
	}
	return events, nil
}
func traceStatement(step frontend.Circuit) []frontend.Variable {
	switch s := step.(type) {
	case *prep.Step:
		v := s.Statement()
		return v[:]
	case *mb.Step:
		v := s.Statement()
		return v[:]
	case *attr.Step:
		v := s.Statement()
		return v[:]
	case *rb.Step:
		v := s.Statement()
		return v[:]
	case *rb.ReportStep:
		v := s.Statement()
		return v[:]
	case *raw.Step:
		v := s.Statement()
		return v[:]
	case *out.Step:
		v := s.Statement()
		return v[:]
	case *q.LinkedCircuit:
		v := s.Statement()
		return v[:]
	default:
		panic("unsupported trace circuit")
	}
}
func traceExtend(ep TraceEndpoint, s frontend.Circuit) TraceEndpoint {
	if ep.First == nil {
		ep.First = s
		ep.Count = p.Const(0)
	}
	ep.Last = s
	ep.Count = traceInc(ep.Count)
	return ep
}
func (t *Trace) emit(phase int, group string, kind int, s frontend.Circuit) (*TraceEvent, error) {
	e := &TraceEvent{phase, group, kind, s}
	values := []string{}
	for _, v := range traceStatement(s) {
		values = append(values, traceScalar(v).String())
	}
	b, err := json.Marshal(struct {
		Phase  int
		Group  string
		Kind   int
		Public []string
	}{phase, group, kind, values})
	if err != nil {
		return nil, err
	}
	h := sha256.New()
	h.Write(t.digest[:])
	h.Write(b)
	copy(t.digest[:], h.Sum(nil))
	t.count.Add(t.count, big.NewInt(1))
	if t.count.BitLen() > 256 {
		t.poisoned = true
		return nil, errors.New("uint256 event overflow")
	}
	if phase == comp.Attribution {
		t.result.Attributions[group] = traceExtend(t.result.Attributions[group], s)
	} else {
		t.result.Endpoints[phase] = traceExtend(t.result.Endpoints[phase], s)
	}
	return e, nil
}

func (t *Trace) next(ctx context.Context) (*TraceEvent, error) {
	if t.poisoned {
		return nil, errors.New("trace poisoned")
	}
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	switch t.stage {
	case comp.RawJournal:
		s := t.rawSteps[t.rawIndex]
		t.rawIndex++
		if t.rawIndex == len(t.rawSteps) {
			t.stage = comp.Preparation
		}
		return t.emit(comp.RawJournal, "", s.Kind, s)
	case comp.Preparation:
		ss, e := t.preparation.Chunk(ctx, 1)
		if e != nil {
			return nil, e
		}
		s := ss[0]
		if s.Kind == prep.Member && raw.Integer(s.Row.Count).Sign() != 0 {
			id := raw.Integer(s.After.Cohort)
			if id.Cmp(new(big.Int).SetUint64(uint64(len(t.groups)))) == 0 {
				t.groups = append(t.groups, rb.Group{Cohort: rb.Cohort{ID: s.After.Cohort, Key: s.After.Key, Members: p.Const(0), Total: p.Const(0)}})
			}
			if !id.IsUint64() || id.Uint64() >= uint64(len(t.groups)) {
				return nil, errors.New("preparation cohort order")
			}
			g := &t.groups[id.Uint64()]
			g.Cohort.Members = traceInc(g.Cohort.Members)
			g.Cohort.Total = p.MustValue(new(big.Int).Add(raw.Integer(g.Cohort.Total), raw.Integer(s.Row.Count)))
			g.Members = append(g.Members, rb.Member{Owner: s.Row.Owner, Source: s.Row.Source, Quantity: raw.Integer(s.Row.Count).Uint64(), Tech: s.Row.Tech})
		}
		if s.Kind == prep.Expand {
			k := s.Before.Key
			t.units = append(t.units, mb.Cell{mb.Big(traceScalar(k.Side)), mb.Big(traceScalar(k.Type)), mb.Big(raw.Integer(k.Stats.Attack)), mb.Big(raw.Integer(k.Stats.Shield)), mb.Big(raw.Integer(k.Stats.Hull)), mb.Big(raw.Integer(s.Before.Cohort))})
		}
		if t.preparation.Done() {
			t.stage = TraceQualification
		}
		return t.emit(comp.Preparation, "", s.Kind, s)
	case TraceQualification:
		w := t.preparation
		s, e := q.NewLinked(w.meta, t.rawSteps[len(t.rawSteps)-1].Statement(), w.snapshot, w.machine.State, w.terminal.Statement(), w.randomWord)
		if e != nil {
			return nil, e
		}
		if witnessDigest(s.ChainRecord) != w.chainRecord {
			return nil, errors.New("trace chain record mismatch")
		}
		t.result.Qualification = s
		t.stage = comp.Combat
		return t.emit(TraceQualification, "", 0, s)
	case comp.Combat:
		if t.combat == nil {
			var seed [32]byte
			copy(seed[:], raw.Encode(t.preparation.randomWord))
			snapshot := mb.Big(t.preparation.machine.C.Commitment())
			m, e := mb.New(mb.PreparedInput{Units: t.units, Rapidfire: q.Rapidfire(), Seed: seed, Snapshot: [4]uint64(snapshot)})
			if e != nil {
				return nil, e
			}
			if m.Context.Roster.Cmp(traceScalar(t.preparation.machine.State.UnitRoot)) != 0 || m.Context.Commitment().Cmp(traceScalar(t.result.Qualification.Input)) != 0 {
				return nil, errors.New("actual preparation/combat qualification mismatch")
			}
			t.combat = m
			t.units = nil
		}
		s, e := t.combat.Next()
		if e != nil {
			return nil, e
		}
		if s.Kind == mb.Scan {
			alive := 0
			if raw.Integer(s.Openings[0].Cell[mb.Hull]).Sign() != 0 {
				alive = 1
			}
			t.records = append(t.records, rb.ReportRecord{Alive: alive, Shots0: s.Before[9], Shots1: s.Before[10]})
		}
		if t.combat.State.V[0] == mb.W(mb.Done) {
			t.stage = comp.Bridge
		}
		return t.emit(comp.Combat, "", s.Kind, s)
	case comp.Bridge:
		if t.bridge == nil {
			m, e := rb.FromMachines(t.preparation.machine, t.combat, t.groups)
			if e != nil {
				return nil, e
			}
			t.bridge = m
		}
		if traceScalar(t.bridge.State.Phase).Int64() == rb.Close {
			group := raw.Integer(t.bridge.State.Cohort).String()
			if t.allocation == nil {
				if e := t.startAllocation(); e != nil {
					return nil, e
				}
			}
			if traceScalar(t.allocation.State.Phase).Int64() != attr.Done {
				s, e := t.allocation.Next()
				if e != nil {
					return nil, e
				}
				return t.emit(comp.Attribution, group, s.Kind, s)
			}
			s, e := t.closeAllocation()
			if e != nil {
				return nil, e
			}
			t.result.Closes = append(t.result.Closes, TraceClose{group, s, t.result.Attributions[group]})
			return t.emit(comp.Bridge, group, rb.Close, s)
		}
		s, e := t.bridge.Next()
		if e != nil {
			return nil, e
		}
		if s.Kind == rb.Begin {
			t.dead = nil
		}
		if s.Kind == rb.Units {
			t.dead = append(t.dead, raw.Integer(s.Unit.Cell[mb.Hull]).Sign() == 0)
		}
		if traceScalar(t.bridge.State.Phase).Int64() == rb.Done {
			t.stage = comp.Report
		}
		return t.emit(comp.Bridge, "", s.Kind, s)
	case comp.Report:
		s, e := t.nextReport()
		if e != nil {
			return nil, e
		}
		t.reportLast = s
		if traceScalar(s.After.Done).Sign() != 0 {
			t.stage = comp.SettlementOutput
		}
		return t.emit(comp.Report, "", s.Kind, s)
	case comp.SettlementOutput:
		if t.output == nil {
			m, e := out.FromBridge(t.bridge, t.reportLast.Statement(), t.result.Qualification.ChainRecord, t.result.Qualification.RawResult)
			if e != nil {
				return nil, e
			}
			t.output = m
		}
		s, e := t.output.Next()
		if e != nil {
			return nil, e
		}
		if traceScalar(t.output.State.Phase).Int64() == out.Done {
			t.result.Manifest = t.output.Manifest
			t.result.Leaves = t.output.Leaves
			t.stage = 8
		}
		return t.emit(comp.SettlementOutput, "", s.Kind, s)
	case 8:
		return nil, io.EOF
	default:
		return nil, fmt.Errorf("unknown trace stage %d", t.stage)
	}
}

// startAllocation reconstructs only the current cohort's actual final-memory
// bitmap and member commitments. Every attribution transition runs separately.
func (t *Trace) startAllocation() error {
	b := t.bridge.State
	i := raw.Integer(b.Cohort)
	if !i.IsUint64() || i.Uint64() >= uint64(len(t.groups)) {
		return errors.New("allocation cohort cursor")
	}
	g := t.groups[i.Uint64()]
	c := attr.Context{Snapshot: t.bridge.Context.Prepared.Snapshot, Cohort: g.Cohort.ID, Side: g.Cohort.Key.Side, Type: g.Cohort.Key.Type, Stats: [3]p.Uint256{g.Cohort.Key.Stats.Attack, g.Cohort.Key.Stats.Shield, g.Cohort.Key.Stats.Hull}}
	ms := make([]attr.Member, len(g.Members))
	for i, m := range g.Members {
		ms[i] = attr.Member{Owner: m.Owner, Source: m.Source, Quantity: m.Quantity}
	}
	a, e := attr.Prepare(c, ms, t.dead)
	if e != nil {
		return e
	}
	if !witnessEqual(a.Context.Loss, b.Loss) || traceScalar(a.Context.Roster).Cmp(traceScalar(b.Roster)) != 0 || traceScalar(a.Context.Units).Cmp(traceScalar(b.Dead)) != 0 {
		return errors.New("actual allocation/bridge mismatch")
	}
	t.allocation = a
	return nil
}

// closeAllocation is the public typed Close adapter. It does not call the
// legacy bridge.Next(Close), whose nested attribution loop is unbounded.
func (t *Trace) closeAllocation() (*rb.Step, error) {
	m := t.bridge
	b := m.State
	a := t.allocation
	g := t.groups[raw.Integer(b.Cohort).Uint64()]
	ac := a.Context.Commitment()
	ar := rb.Hash(440607, ac, a.State.Output)
	o := b
	row := rb.Hash(rb.OutputDomain, append(traceFields(g.Cohort.ID), ac, ar)...)
	o.Output = rb.Hash(rb.OutputDomain, append(append([]frontend.Variable{b.Output}, b.Cohort[:]...), row)...)
	o.Cohort = traceInc(b.Cohort)
	o.Phase = rb.Begin
	if witnessEqual(o.Cohort, m.Context.Prepared.Cohorts) {
		o.Phase = rb.Finish
	}
	o.Active = 0
	o.Roster = 0
	o.Dead = 0
	o.Loss = p.Const(0)
	var unit rb.Opening
	for i := range unit.Cell {
		unit.Cell[i] = p.Const(0)
	}
	for i := range unit.Siblings {
		unit.Siblings[i] = 0
	}
	s := &rb.Step{Kind: rb.Close, Context: m.Context, Before: b, After: o, Cohort: g.Cohort, Member: rb.Member{Owner: p.Const(0), Source: p.Const(0), Quantity: 0, Tech: p.Technology{Weapons: 0, Shielding: 0, Armor: 0}}, Unit: unit, AttributionOutput: a.State.Output, AttributionContext: ac, AttributionResult: ar, ContextRoot: m.Context.Commitment(), PreparedRoot: m.Context.Prepared.Commitment(), Input: m.Context.Input(), CombatResult: m.Context.CombatResult(), BeforeRoot: b.Commitment(), AfterRoot: o.Commitment(), Finished: 0, Result: 0}
	m.State = o
	m.Attributions = append(m.Attributions, a)
	t.allocation = nil
	t.dead = nil
	return s, nil
}

// nextReport mirrors the exported ReportStep relation one record at a time.
// The records come exclusively from actual combat Scan transitions.
func (t *Trace) nextReport() (*rb.ReportStep, error) {
	c := t.bridge.Context
	b := t.reportState
	o := b
	var unit rb.Opening
	for i := range unit.Cell {
		unit.Cell[i] = p.Const(0)
	}
	for i := range unit.Siblings {
		unit.Siblings[i] = 0
	}
	s := &rb.ReportStep{Context: c, Before: b, Unit: unit, Alive: 0, Shots0: p.Const(0), Shots1: p.Const(0), Kind: 0}
	if raw.Integer(c.Combat.Round).Sign() == 0 {
		if len(t.records) != 0 {
			return nil, errors.New("zero-round report advice")
		}
		s.Kind = 1
		o.Done = 1
	} else {
		expected := new(big.Int).Mul(raw.Integer(c.Prepared.N), raw.Integer(c.Combat.Round))
		if expected.Cmp(new(big.Int).SetUint64(uint64(len(t.records)))) != 0 || t.reportIndex >= len(t.records) {
			return nil, errors.New("incomplete actual report advice")
		}
		r := t.records[t.reportIndex]
		s.Unit = t.bridge.Open(b.Index)
		s.Alive = r.Alive
		s.Shots0 = r.Shots0
		s.Shots1 = r.Shots1
		u := s.Unit.Cell
		o.Scan = rb.Hash(440404, append([]frontend.Variable{b.Scan}, traceFields(b.Round, b.Index, u[5], p.Uint256{r.Alive, 0, 0, 0}, r.Shots0, r.Shots1)...)...)
		row := rb.Hash(rb.ReportRowDomain, append(traceFields(b.Round, b.Index, u[0], u[1], u[2], u[3], u[4], u[5], r.Shots0, r.Shots1), r.Alive)...)
		o.Output = rb.Hash(rb.ReportOutputDomain, b.Output, row)
		o.Index = traceInc(b.Index)
		o.Shots0 = r.Shots0
		o.Shots1 = r.Shots1
		if witnessEqual(o.Index, c.Prepared.N) {
			o.Index = p.Const(0)
			o.Round = traceInc(b.Round)
			o.Shots0 = p.Const(0)
			o.Shots1 = p.Const(0)
			if witnessEqual(b.Round, c.Combat.Round) {
				o.Done = 1
			}
		}
		if traceScalar(o.Done).Sign() != 0 && traceScalar(o.Scan).Cmp(traceScalar(c.Combat.Report)) != 0 {
			return nil, errors.New("actual report root mismatch")
		}
		t.reportIndex++
	}
	s.After = o
	s.ContextRoot = c.Commitment()
	s.Input = c.Input()
	s.CombatResult = c.CombatResult()
	s.BeforeRoot = b.Commitment()
	s.AfterRoot = o.Commitment()
	s.Finished = o.Done
	s.Result = 0
	if traceScalar(o.Done).Sign() != 0 {
		s.Result = rb.Hash(rb.ReportResultDomain, s.ContextRoot, s.Input, s.CombatResult, o.Output)
	}
	t.reportState = o
	return s, nil
}
