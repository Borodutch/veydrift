package memorybattle

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"math/big"
)

const Rules = "veydrift-individual-shot-candidate-2"
const (
	Boot = iota
	Init
	Ready
	Reset
	FindShooter
	DrawTarget
	FindTarget
	Damage
	Explosion
	Rapidfire
	Scan
	Done
)
const (
	phase = iota
	round
	side
	shooter
	target
	cursor
	count0
	count1
	rank
	shots0
	shots1
	outcome
	step
	counter
	StateSize
)

type State struct {
	V              [StateSize]Word
	Memory, Report *big.Int
}

func (s State) Commitment() *big.Int {
	return hash(stateDomain, appendWords([]*big.Int{s.Memory, s.Report}, s.V[:]...)...)
}

type Context struct {
	Roster, RF *big.Int
	N          Word
	Seed       [32]byte
	Snapshot   [4]uint64
}

func (c Context) Commitment() *big.Int {
	v := appendWords([]*big.Int{c.Roster, c.RF}, c.N)
	v = append(v, num(3))
	for _, x := range c.Seed {
		v = append(v, num(uint64(x)))
	}
	for _, x := range c.Snapshot {
		v = append(v, num(x))
	}
	return hash(contextDomain, v...)
}
func (c Context) Result(s State) *big.Int {
	if s.V[phase] != W(Done) {
		return num(0)
	}
	return hash(resultDomain, appendWords([]*big.Int{c.Commitment(), s.Memory, s.Report}, s.V[round], s.V[count0], s.V[count1], s.V[outcome])...)
}
func position(w Word) *big.Int {
	if w.IsZero() {
		return num(0)
	}
	h := hash(positionDomain, appendWords(nil, w)...)
	if h.Sign() == 0 {
		panic("reserved zero position commitment")
	}
	return h
}

// PreparedInput is an externally authenticated preparation boundary.
type PreparedInput struct {
	Units     []Cell
	Rapidfire map[uint32]uint64
	Seed      [32]byte
	Snapshot  [4]uint64
}
type Machine struct {
	Context            Context
	State              State
	Roster, RF, Memory *Memory
}

func New(in PreparedInput) (*Machine, error) {
	m := &Machine{Roster: NewMemory(), RF: NewMemory(), Memory: NewMemory()}
	for i, u := range in.Units {
		if u[Side].Cmp(W(1)) > 0 || u[Type].Cmp(W(65535)) > 0 || u[MaxHull].IsZero() || !u[Hull].IsZero() || !u[Shield].IsZero() || !u[Pool].IsZero() {
			return nil, fmt.Errorf("invalid prepared unit %d", i)
		}
		expected := W(0)
		if i > 0 {
			p := in.Units[i-1]
			order := 0
			for j := Side; j <= MaxHull; j++ {
				order = u[j].Cmp(p[j])
				if order != 0 {
					break
				}
			}
			if order < 0 {
				return nil, errors.New("noncanonical roster")
			}
			expected = p[Cohort]
			if order > 0 {
				expected = expected.Add(W(1))
			}
		}
		if u[Cohort] != expected {
			return nil, errors.New("noncanonical cohort")
		}
		m.Roster.Write(key(RosterDomain, W(uint64(i))), u)
	}
	for lane, factor := range in.Rapidfire {
		if factor < 1 || factor > 65535 {
			return nil, errors.New("invalid rapidfire")
		}
		m.RF.Write(key(RFDomain, W(uint64(lane))), Cell{W(factor - 1)})
	}
	m.Context = Context{m.Roster.Root(), m.RF.Root(), W(uint64(len(in.Units))), in.Seed, in.Snapshot}
	m.State = State{Memory: m.Memory.Root(), Report: num(0)}
	return m, nil
}
func (m *Machine) draw(s *State, bound Word) (Word, bool, *protocol.SampleCircuit, error) {
	if bound.IsZero() {
		return Word{}, false, nil, errors.New("zero bound")
	}
	b := append([]byte(Rules+":random:"), m.Context.Seed[:]...)
	var cb [32]byte
	for j := 0; j < 4; j++ {
		binary.BigEndian.PutUint64(cb[(3-j)*8:], s.V[counter][j])
	}
	b = append(b, cb[:]...)
	digest := sha256.Sum256(b)
	word := new(big.Int).SetBytes(digest[:])
	advice, e := protocol.NewSampleWitness(word, bound.Big())
	if e != nil {
		return Word{}, false, nil, e
	}
	s.V[counter] = s.V[counter].Add(W(1))
	top := new(big.Int).Lsh(big.NewInt(1), 256)
	limit := new(big.Int).Sub(top, new(big.Int).Mod(new(big.Int).Set(top), bound.Big()))
	return Big(new(big.Int).Mod(word, bound.Big())), word.Cmp(limit) < 0, advice, nil
}
func lessScaled(a Word, am int64, b Word, bm int64) bool {
	return new(big.Int).Mul(a.Big(), big.NewInt(am)).Cmp(new(big.Int).Mul(b.Big(), big.NewInt(bm))) < 0
}

// Writes are staged until all checked arithmetic succeeds. Sparse checkpoints
// may use any uint256 address without materializing a host slice.
func (m *Machine) Next() (w *Step, err error) {
	defer func() {
		if r := recover(); r != nil {
			w = nil
			err = fmt.Errorf("incomplete transition: %v", r)
		}
	}()
	before := m.State
	s := before
	v := &s.V
	n := m.Context.N
	p := v[phase].Small()
	if p == Done {
		return nil, errors.New("already terminal")
	}
	v[step] = v[step].Add(W(1))
	var opens []Opening
	var advice *protocol.SampleCircuit
	var pending *Cell
	var writeIndex Word
	open := func(mem *Memory, d uint64, i Word) Cell {
		opens = append(opens, mem.Open(key(d, i)))
		return mem.Read(key(d, i))
	}
	read := func(i Word) Cell {
		if i.Cmp(n) >= 0 {
			panic("index outside roster")
		}
		return open(m.Memory, UnitDomain, i)
	}
	write := func(i Word, u Cell) { pending = &u; writeIndex = i }
	scan := func(next uint64) {
		v[cursor] = v[cursor].Add(W(1))
		if v[cursor] == n {
			v[cursor] = W(0)
			v[phase] = W(next)
		}
	}
	draw := func(bound Word) (Word, bool) {
		x, ok, a, e := m.draw(&s, bound)
		if e != nil {
			panic(e)
		}
		advice = a
		return x, ok
	}
	switch p {
	case Boot:
		if n.IsZero() {
			v[phase] = W(Ready)
		} else {
			v[phase] = W(Init)
		}
	case Init:
		i := v[cursor]
		read(i)
		u := open(m.Roster, RosterDomain, i)
		prev := i
		if !prev.IsZero() {
			prev = prev.Sub(W(1))
		}
		open(m.Roster, RosterDomain, prev)
		u[Hull] = u[MaxHull]
		u[Shield] = u[MaxShield]
		u[Pool] = W(1)
		write(i, u)
		j := count0 + int(u[Side].Small())
		v[j] = v[j].Add(W(1))
		scan(Ready)
	case Ready:
		if v[count0].IsZero() || v[count1].IsZero() || v[round] == W(6) {
			v[phase] = W(Done)
			v[outcome] = W(0)
			if !v[count0].IsZero() && v[count1].IsZero() {
				v[outcome] = W(1)
			}
			if !v[count1].IsZero() && v[count0].IsZero() {
				v[outcome] = W(2)
			}
		} else {
			v[phase] = W(Reset)
			v[cursor] = W(0)
			v[round] = v[round].Add(W(1))
			v[side] = W(0)
			v[shots0] = W(0)
			v[shots1] = W(0)
		}
	case Reset:
		i := v[cursor]
		u := read(i)
		if u[Pool] == W(1) {
			u[Shield] = u[MaxShield]
		}
		write(i, u)
		scan(FindShooter)
	case FindShooter:
		i := v[cursor]
		if i == n {
			i = W(0)
		}
		u := read(i)
		if v[cursor] == n {
			v[cursor] = W(0)
			if v[side].IsZero() {
				v[side] = W(1)
			} else {
				v[phase] = W(Scan)
				v[count0] = W(0)
				v[count1] = W(0)
			}
		} else if u[Pool] == W(1) && u[Side] == v[side] {
			v[shooter] = v[cursor]
			v[phase] = W(DrawTarget)
		} else {
			v[cursor] = v[cursor].Add(W(1))
		}
	case DrawTarget:
		x, ok := draw(v[count0+1-int(v[side].Small())])
		if ok {
			v[rank] = x
			v[cursor] = W(0)
			v[phase] = W(FindTarget)
		}
	case FindTarget:
		u := read(v[cursor])
		eligible := u[Pool] == W(1) && u[Side] == W(1-v[side].Small())
		if eligible && v[rank].IsZero() {
			v[target] = v[cursor]
			v[phase] = W(Damage)
			j := shots0 + int(v[side].Small())
			v[j] = v[j].Add(W(1))
		} else {
			v[cursor] = v[cursor].Add(W(1))
			if eligible {
				v[rank] = v[rank].Sub(W(1))
			}
		}
	case Damage:
		i := v[target]
		u := read(i)
		a := read(v[shooter])[Attack]
		v[phase] = W(Rapidfire)
		if !u[Hull].IsZero() && !(!u[Shield].IsZero() && lessScaled(a, 100, u[MaxShield], 1)) {
			absorbed := a
			if absorbed.Cmp(u[Shield]) > 0 {
				absorbed = u[Shield]
			}
			u[Shield] = u[Shield].Sub(absorbed)
			d := a.Sub(absorbed)
			if d.Cmp(u[Hull]) >= 0 {
				u[Hull] = W(0)
			} else {
				u[Hull] = u[Hull].Sub(d)
			}
			if !u[Hull].IsZero() && !a.IsZero() && lessScaled(u[MaxHull], 3, u[MaxHull].Sub(u[Hull]), 10) {
				v[phase] = W(Explosion)
			}
		}
		write(i, u)
	case Explosion:
		i := v[target]
		u := read(i)
		x, ok := draw(u[MaxHull])
		if ok {
			if x.Cmp(u[MaxHull].Sub(u[Hull])) < 0 {
				u[Hull] = W(0)
			}
			v[phase] = W(Rapidfire)
		}
		write(i, u)
	case Rapidfire:
		u := read(v[target])
		a := read(v[shooter])
		lane := W(a[Type].Small()<<16 | u[Type].Small())
		rf := open(m.RF, RFDomain, lane)[0].Add(W(1))
		again := false
		accepted := true
		if rf.Cmp(W(1)) > 0 {
			x, ok := draw(rf)
			accepted = ok
			again = !x.IsZero()
		}
		if accepted {
			if again {
				v[phase] = W(DrawTarget)
			} else {
				v[phase] = W(FindShooter)
				v[cursor] = v[shooter].Add(W(1))
			}
		}
	case Scan:
		i := v[cursor]
		u := read(i)
		u[Pool] = W(0)
		if !u[Hull].IsZero() {
			u[Pool] = W(1)
		}
		j := count0 + int(u[Side].Small())
		v[j] = v[j].Add(u[Pool])
		write(i, u)
		s.Report = hash(reportDomain, appendWords([]*big.Int{s.Report}, v[round], i, u[Cohort], u[Pool], v[shots0], v[shots1])...)
		scan(Ready)
	default:
		return nil, errors.New("bad phase")
	}
	// Fail any reserved-position encoding before committing staged memory.
	position(before.V[step])
	position(s.V[step])
	if pending != nil {
		m.Memory.Write(key(UnitDomain, writeIndex), *pending)
	}
	s.Memory = m.Memory.Root()
	w = assignment(m.Context, before, s, opens)
	if advice != nil {
		w.Sample = *advice
	}
	m.State = s
	return w, nil
}
