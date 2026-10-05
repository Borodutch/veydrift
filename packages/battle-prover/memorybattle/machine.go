package memorybattle

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
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
	counter0
	counter1
	counter2
	counter3
	StateSize
)

type State struct {
	V              [StateSize]uint64
	Memory, Report *big.Int
}

func (s State) Commitment() *big.Int {
	v := []*big.Int{s.Memory, s.Report}
	for _, x := range s.V {
		v = append(v, num(x))
	}
	return hash(stateDomain, v...)
}

type Context struct {
	Roster, RF *big.Int
	N          uint64
	Seed       [32]byte
	Snapshot   [4]uint64
}

func (c Context) Commitment() *big.Int {
	v := []*big.Int{c.Roster, c.RF, num(c.N), num(2)}
	for _, x := range c.Seed {
		v = append(v, num(uint64(x)))
	}
	for _, x := range c.Snapshot {
		v = append(v, num(x))
	}
	return hash(contextDomain, v...)
}
func (c Context) Result(s State) *big.Int {
	if s.V[phase] != Done {
		return num(0)
	}
	return hash(resultDomain, c.Commitment(), s.Memory, s.Report, num(s.V[round]), num(s.V[count0]), num(s.V[count1]), num(s.V[outcome]))
}

// PreparedInput is a boundary, NOT a proof of group canonicalization, research,
// on-chain enrollment or settlement. Caller must authenticate this root/count.
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
		if u[Side] > 1 || u[Type] > 65535 || u[MaxHull] == 0 || u[Hull] != 0 || u[Shield] != 0 || u[Pool] != 0 {
			return nil, fmt.Errorf("invalid prepared unit %d", i)
		}
		if i == 0 {
			if u[Cohort] != 0 {
				return nil, errors.New("first cohort must be zero")
			}
		} else {
			previous := in.Units[i-1]
			order := 0
			for j := Side; j <= MaxHull; j++ {
				if u[j] < previous[j] {
					order = -1
					break
				}
				if u[j] > previous[j] {
					order = 1
					break
				}
			}
			expected := previous[Cohort]
			if order > 0 {
				expected++
			}
			if order < 0 || u[Cohort] != expected {
				return nil, errors.New("prepared roster is not canonical")
			}
		}
		m.Roster.Write(uint64(i), u)
	}
	// Absent RF lane means factor 1, encoded as zero. Every present lane is uint16.
	for lane, factor := range in.Rapidfire {
		if factor < 1 || factor > 65535 {
			return nil, errors.New("invalid rapidfire")
		}
		m.RF.Write(uint64(lane), Cell{factor - 1})
	}
	m.Context = Context{Roster: m.Roster.Root(), RF: m.RF.Root(), N: uint64(len(in.Units)), Seed: in.Seed, Snapshot: in.Snapshot}
	m.State = State{Memory: m.Memory.Root(), Report: num(0)}
	return m, nil
}
func (m *Machine) draw(s *State, bound uint64) (uint64, bool, error) {
	if bound == 0 {
		return 0, false, errors.New("zero random bound")
	}
	b := append([]byte(Rules+":random:"), m.Context.Seed[:]...)
	var counter [32]byte
	for j := 0; j < 4; j++ {
		binary.BigEndian.PutUint64(counter[(3-j)*8:], s.V[counter0+j])
	}
	b = append(b, counter[:]...)
	digest := sha256.Sum256(b)
	w := new(big.Int).SetBytes(digest[:])
	carry := true
	for j := 0; j < 4 && carry; j++ {
		s.V[counter0+j]++
		carry = s.V[counter0+j] == 0
	}
	if carry {
		return 0, false, errors.New("uint256 RNG exhausted; incomplete")
	}
	n := num(bound)
	top := new(big.Int).Lsh(big.NewInt(1), 256)
	limit := new(big.Int).Sub(top, new(big.Int).Mod(new(big.Int).Set(top), n))
	return new(big.Int).Mod(w, n).Uint64(), w.Cmp(limit) < 0, nil
}
func lessScaled(a uint64, am int64, b uint64, bm int64) bool {
	return new(big.Int).Mul(num(a), big.NewInt(am)).Cmp(new(big.Int).Mul(num(b), big.NewInt(bm))) < 0
}

// Next makes one bounded memory/control operation, including one RNG rejection.
// Host callers impose execution budgets externally; exhaustion returns no result.
func (m *Machine) Next() (*Step, error) {
	before := m.State
	s := before
	v := &s.V
	n := m.Context.N
	p := v[phase]
	if p == Done {
		return nil, errors.New("already terminal")
	}
	if v[step] == ^uint64(0) {
		return nil, errors.New("step transport exhausted; incomplete")
	}
	v[step]++
	var opens []Opening
	open := func(mem *Memory, i uint64) Cell { opens = append(opens, mem.Open(i)); return mem.Read(i) }
	switch p {
	case Boot:
		if n == 0 {
			v[phase] = Ready
		} else {
			v[phase] = Init
		}
	case Init:
		i := v[cursor]
		open(m.Memory, i)
		u := open(m.Roster, i)
		previous := i
		if previous > 0 {
			previous--
		}
		open(m.Roster, previous)
		u[Hull] = u[MaxHull]
		u[Shield] = u[MaxShield]
		u[Pool] = 1
		m.Memory.Write(i, u)
		v[count0+u[Side]]++
		v[cursor]++
		if v[cursor] == n {
			v[cursor] = 0
			v[phase] = Ready
		}
	case Ready:
		if v[count0] == 0 || v[count1] == 0 || v[round] == 6 {
			v[phase] = Done
			if v[count0] > 0 && v[count1] == 0 {
				v[outcome] = 1
			}
			if v[count1] > 0 && v[count0] == 0 {
				v[outcome] = 2
			}
		} else {
			v[phase] = Reset
			v[cursor] = 0
			v[round]++
			v[side] = 0
			v[shots0] = 0
			v[shots1] = 0
		}
	case Reset:
		i := v[cursor]
		u := open(m.Memory, i)
		if u[Pool] == 1 {
			u[Shield] = u[MaxShield]
		}
		m.Memory.Write(i, u)
		v[cursor]++
		if v[cursor] == n {
			v[cursor] = 0
			v[phase] = FindShooter
		}
	case FindShooter:
		index := v[cursor]
		if index == n {
			index = 0
		}
		u := open(m.Memory, index)
		if v[cursor] == n {
			if v[side] == 0 {
				v[side] = 1
				v[cursor] = 0
			} else {
				v[phase] = Scan
				v[cursor] = 0
				v[count0] = 0
				v[count1] = 0
			}
		} else {
			if u[Pool] == 1 && u[Side] == v[side] {
				v[shooter] = v[cursor]
				v[phase] = DrawTarget
			} else {
				v[cursor]++
			}
		}
	case DrawTarget:
		x, ok, err := m.draw(&s, v[count0+1-v[side]])
		if err != nil {
			return nil, err
		}
		if ok {
			v[rank] = x
			v[cursor] = 0
			v[phase] = FindTarget
		}
	case FindTarget:
		u := open(m.Memory, v[cursor])
		eligible := u[Pool] == 1 && u[Side] == 1-v[side]
		if eligible && v[rank] == 0 {
			v[target] = v[cursor]
			v[phase] = Damage
			if v[shots0+v[side]] == ^uint64(0) {
				return nil, errors.New("shot counter exhausted; incomplete")
			}
			v[shots0+v[side]]++
		} else {
			v[cursor]++
			if eligible {
				v[rank]--
			}
		}
	case Damage:
		i := v[target]
		u := open(m.Memory, i)
		a := open(m.Memory, v[shooter])[Attack]
		v[phase] = Rapidfire
		if u[Hull] > 0 && !(u[Shield] > 0 && lessScaled(a, 100, u[MaxShield], 1)) {
			absorbed := a
			if absorbed > u[Shield] {
				absorbed = u[Shield]
			}
			u[Shield] -= absorbed
			d := a - absorbed
			if d >= u[Hull] {
				u[Hull] = 0
			} else {
				u[Hull] -= d
			}
			if u[Hull] > 0 && a > 0 && lessScaled(u[MaxHull], 3, u[MaxHull]-u[Hull], 10) {
				v[phase] = Explosion
			}
		}
		m.Memory.Write(i, u)
	case Explosion:
		i := v[target]
		u := open(m.Memory, i)
		x, ok, err := m.draw(&s, u[MaxHull])
		if err != nil {
			return nil, err
		}
		if ok {
			if x < u[MaxHull]-u[Hull] {
				u[Hull] = 0
			}
			v[phase] = Rapidfire
		}
		m.Memory.Write(i, u)
	case Rapidfire:
		u := open(m.Memory, v[target])
		a := open(m.Memory, v[shooter])
		lane := a[Type]<<16 | u[Type]
		rf := open(m.RF, lane)[0] + 1
		again := false
		accepted := true
		if rf > 1 {
			x, ok, err := m.draw(&s, rf)
			if err != nil {
				return nil, err
			}
			accepted = ok
			again = x != 0
		}
		if accepted {
			if again {
				v[phase] = DrawTarget
			} else {
				v[phase] = FindShooter
				v[cursor] = v[shooter] + 1
			}
		}
	case Scan:
		i := v[cursor]
		u := open(m.Memory, i)
		u[Pool] = 0
		if u[Hull] > 0 {
			u[Pool] = 1
		}
		v[count0+u[Side]] += u[Pool]
		m.Memory.Write(i, u)
		s.Report = hash(reportDomain, s.Report, num(v[round]), num(i), num(u[Cohort]), num(u[Pool]), num(v[shots0]), num(v[shots1]))
		v[cursor]++
		if v[cursor] == n {
			v[cursor] = 0
			v[phase] = Ready
		}
	default:
		return nil, errors.New("bad phase")
	}
	s.Memory = m.Memory.Root()
	m.State = s
	return assignment(m.Context, before, s, opens), nil
}
