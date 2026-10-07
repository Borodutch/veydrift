// Package battle is a TEST-ONLY small-roster implementation of the candidate
// rules. No production verifier or input qualification is provided.
package battle

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math/big"
)

const Rules = "veydrift-individual-shot-candidate-2"
const Slots = 4
const (
	Init = iota
	Target
	Damage
	Explosion
	Rapidfire
	Advance
	Finish
	Scan
	Reset
	Done
)

// Config fixes the entire canonical roster/catalog/owner attribution in the
// verifying key. One member per cohort, one unit per member, sorted side/type.
// This deliberately small fixture is NOT a fleet limit or general input parser.
type UnitSpec struct {
	Side, Type uint64
	Base, Tech [3]uint64
	Owner      [20]byte
	Source     [32]byte
}
type Config struct {
	Units [Slots]UnitSpec
	RF    [Slots][Slots]uint64
}

func (c Config) Validate() error {
	for i, u := range c.Units {
		if u.Side > 1 || u.Type > 65535 || u.Base[2] == 0 {
			return errors.New("invalid fixture unit")
		}
		if i > 0 && (u.Side < c.Units[i-1].Side || u.Side == c.Units[i-1].Side && u.Type <= c.Units[i-1].Type) {
			return errors.New("fixture requires unique sorted side/type cohorts")
		}
		for j, b := range u.Base {
			if b > 65535 || u.Tech[j] > 65535 {
				return errors.New("test-only uint16 base/technology range")
			}
		}
		for _, r := range c.RF[i] {
			if r < 1 || r > 65535 {
				return errors.New("invalid rapidfire")
			}
		}
	}
	for i, a := range c.Units {
		for j, b := range c.Units {
			if i >= j {
				continue
			}
			if a.Type == b.Type && a.Base != b.Base {
				return errors.New("inconsistent catalog type")
			}
			if a.Source == b.Source && (a.Side != b.Side || a.Owner != b.Owner || a.Tech != b.Tech) {
				return errors.New("inconsistent source")
			}
			if a.Owner == b.Owner && a.Tech != b.Tech {
				return errors.New("inconsistent owner technology")
			}
		}
	}
	for i, a := range c.Units {
		for j, b := range c.Units {
			for k, x := range c.Units {
				for l, y := range c.Units {
					if a.Type == x.Type && b.Type == y.Type && c.RF[i][j] != c.RF[k][l] {
						return errors.New("inconsistent rapidfire type lane")
					}
				}
			}
		}
	}
	return nil
}

// Digest binds owner/source and base/technology even when effective stats match.
func (c Config) Digest() [32]byte {
	b, err := json.Marshal(c)
	if err != nil {
		panic(err)
	}
	return sha256.Sum256(append([]byte(Rules+":fixture:"), b...))
}
func (c Config) Stat(i, j int) uint64 { return c.Units[i].Base[j] * (10 + c.Units[i].Tech[j]) / 10 }

// State is public in diagnostic Step and a private committed preimage in
// CommittedStep. Reads bind to the latest full image, not a selected opening.
// Pool is round-start eligibility; it intentionally survives unit destruction.
type State struct {
	Phase, Round, Side, Shooter, Target, Cursor, Counter, Step uint64
	Hull, Shield, Pool                                         [Slots]uint64
	Shots                                                      [2]uint64
	RoundShots                                                 [6][2]uint64
	RoundSurvivors                                             [6][Slots]uint64
	Outcome                                                    uint64 // 0 draw, 1 attacker, 2 defender
}

func (s State) Values() []uint64 {
	v := []uint64{s.Phase, s.Round, s.Side, s.Shooter, s.Target, s.Cursor, s.Counter, s.Step}
	v = append(v, s.Hull[:]...)
	v = append(v, s.Shield[:]...)
	v = append(v, s.Pool[:]...)
	v = append(v, s.Shots[:]...)
	for _, r := range s.RoundShots {
		v = append(v, r[:]...)
	}
	for _, r := range s.RoundSurvivors {
		v = append(v, r[:]...)
	}
	return append(v, s.Outcome)
}

const StateSize = 59

func stateFrom(v []uint64) State {
	s := State{Phase: v[0], Round: v[1], Side: v[2], Shooter: v[3], Target: v[4], Cursor: v[5], Counter: v[6], Step: v[7]}
	k := 8
	for _, a := range [][]uint64{s.Hull[:], s.Shield[:], s.Pool[:], s.Shots[:]} {
		copy(a, v[k:])
		k += len(a)
	}
	for i := range s.RoundShots {
		copy(s.RoundShots[i][:], v[k:])
		k += 2
	}
	for i := range s.RoundSurvivors {
		copy(s.RoundSurvivors[i][:], v[k:])
		k += Slots
	}
	s.Outcome = v[k]
	return s
}
func word(seed [32]byte, counter uint64) *big.Int {
	b := append([]byte(Rules+":random:"), seed[:]...)
	var n [32]byte
	binary.BigEndian.PutUint64(n[24:], counter)
	b = append(b, n[:]...)
	h := sha256.Sum256(b)
	return new(big.Int).SetBytes(h[:])
}
func draw(seed [32]byte, s *State, bound uint64) (uint64, bool) {
	w := word(seed, s.Counter)
	s.Counter++
	n := new(big.Int).SetUint64(bound)
	top := new(big.Int).Lsh(big.NewInt(1), 256)
	limit := new(big.Int).Sub(top, new(big.Int).Mod(new(big.Int).Set(top), n))
	return new(big.Int).Mod(w, n).Uint64(), w.Cmp(limit) < 0
}
func (c Config) first(s State, side uint64) uint64 {
	for i, u := range c.Units {
		if u.Side == side && s.Pool[i] == 1 {
			return uint64(i)
		}
	}
	return 0
}
func (c Config) counts(s State) [2]uint64 {
	var n [2]uint64
	for i, u := range c.Units {
		n[u.Side] += s.Pool[i]
	}
	return n
}

// Next performs exactly one elementary operation. RNG rejection remains in the
// same phase, round scans/reset touch one slot, and RF has no chain-length cap.
func (c Config) Next(seed [32]byte, s State) (State, error) {
	if err := c.Validate(); err != nil {
		return s, err
	}
	if s.Phase == Done {
		return s, nil
	}
	if s.Counter == ^uint64(0) || s.Step == ^uint64(0) {
		return s, errors.New("test-only counter budget exhausted; incomplete")
	}
	s.Step++
	switch s.Phase {
	case Init:
		i := s.Cursor
		s.Hull[i] = c.Stat(int(i), 2)
		s.Shield[i] = c.Stat(int(i), 1)
		s.Pool[i] = 1
		s.Cursor++
		if s.Cursor == Slots {
			s.Cursor = 0
			s.Phase = Reset
		}
	case Reset:
		n := c.counts(s)
		if n[0] == 0 || n[1] == 0 || s.Round == 6 {
			s.Phase = Done
			if n[0] > 0 && n[1] == 0 {
				s.Outcome = 1
			}
			if n[1] > 0 && n[0] == 0 {
				s.Outcome = 2
			}
			break
		}
		i := s.Cursor
		if s.Pool[i] == 1 {
			s.Shield[i] = c.Stat(int(i), 1)
		}
		s.Cursor++
		if s.Cursor == Slots {
			s.Cursor = 0
			s.Round++
			s.Side = 0
			s.Shooter = c.first(s, 0)
			s.Shots = [2]uint64{}
			s.Phase = Target
		}
	case Target:
		n := c.counts(s)
		v, ok := draw(seed, &s, n[1-s.Side])
		if ok {
			for i, u := range c.Units {
				if u.Side == 1-s.Side && s.Pool[i] == 1 {
					if v == 0 {
						s.Target = uint64(i)
						break
					}
					v--
				}
			}
			s.Shots[s.Side]++
			s.Phase = Damage
		}
	case Damage:
		i := s.Target
		a := c.Stat(int(s.Shooter), 0)
		maxShield := c.Stat(int(i), 1)
		s.Phase = Rapidfire
		if s.Hull[i] == 0 || s.Shield[i] > 0 && a*100 < maxShield {
			break
		}
		absorbed := a
		if s.Shield[i] < absorbed {
			absorbed = s.Shield[i]
		}
		s.Shield[i] -= absorbed
		d := a - absorbed
		if d >= s.Hull[i] {
			s.Hull[i] = 0
		} else {
			s.Hull[i] -= d
		}
		maxHull := c.Stat(int(i), 2)
		if s.Hull[i] > 0 && a > 0 && (maxHull-s.Hull[i])*10 > maxHull*3 {
			s.Phase = Explosion
		}
	case Explosion:
		v, ok := draw(seed, &s, c.Stat(int(s.Target), 2))
		if ok {
			if v < c.Stat(int(s.Target), 2)-s.Hull[s.Target] {
				s.Hull[s.Target] = 0
			}
			s.Phase = Rapidfire
		}
	case Rapidfire:
		r := c.RF[s.Shooter][s.Target]
		if r == 1 {
			s.Phase = Advance
			break
		}
		v, ok := draw(seed, &s, r)
		if ok {
			if v == 0 {
				s.Phase = Advance
			} else {
				s.Phase = Target
			}
		}
	case Advance:
		found := false
		for i, u := range c.Units {
			if uint64(i) > s.Shooter && u.Side == s.Side && s.Pool[i] == 1 {
				s.Shooter = uint64(i)
				found = true
				break
			}
		}
		if found {
			s.Phase = Target
		} else if s.Side == 0 {
			s.Side = 1
			s.Shooter = c.first(s, 1)
			s.Phase = Target
		} else {
			s.Phase = Finish
			s.Cursor = 0
		}
	case Finish:
		s.RoundShots[s.Round-1] = s.Shots
		for i, h := range s.Hull {
			if h > 0 {
				s.RoundSurvivors[s.Round-1][i] = 1
			} else {
				s.RoundSurvivors[s.Round-1][i] = 0
			}
		}
		s.Phase = Scan
	case Scan:
		i := s.Cursor
		if s.Hull[i] > 0 {
			s.Pool[i] = 1
		} else {
			s.Pool[i] = 0
		}
		s.Cursor++
		if s.Cursor == Slots {
			s.Cursor = 0
			s.Phase = Reset
		}
	default:
		return s, errors.New("invalid phase")
	}
	return s, nil
}
