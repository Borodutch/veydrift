package rawbridge

import (
	"fmt"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/frontend"
	native "golang.org/x/crypto/sha3"
	"math/big"
)

func scalar(v frontend.Variable) *big.Int {
	switch x := v.(type) {
	case int:
		return big.NewInt(int64(x))
	case uint64:
		return new(big.Int).SetUint64(x)
	case *big.Int:
		return new(big.Int).Set(x)
	}
	panic("scalar type")
}
func Integer(w U) *big.Int {
	n := new(big.Int)
	for i := 3; i >= 0; i-- {
		v := scalar(w[i])
		if v.Sign() < 0 || v.BitLen() > 64 {
			panic("uint64 limb")
		}
		n.Lsh(n, 64)
		n.Add(n, v)
	}
	return n
}
func Encode(ws ...U) []byte {
	var b []byte
	for _, w := range ws {
		v := make([]byte, 32)
		Integer(w).FillBytes(v)
		b = append(b, v...)
	}
	return b
}
func Digest(ws ...U) U {
	h := native.NewLegacyKeccak256()
	h.Write(Encode(ws...))
	return p.MustValue(new(big.Int).SetBytes(h.Sum(nil)))
}

// DecodeWords accepts exactly the canonical static ABI byte length. Width and
// enum checks are constraints, not a trusted parser's decision.
func DecodeWords(b []byte, n int) ([]U, error) {
	if len(b) != 32*n {
		return nil, fmt.Errorf("ABI length")
	}
	out := make([]U, n)
	for i := range out {
		out[i] = p.MustValue(new(big.Int).SetBytes(b[i*32 : (i+1)*32]))
	}
	return out, nil
}

type Event struct {
	Kind     int
	SourceID U
	Mission  Mission
	Row      prep.Row
}

func SourceEvent(id U, m Mission) Event { return Event{Kind: Source, SourceID: id, Mission: m} }
func RowEvent(r prep.Row) Event         { return Event{Kind: Row, Row: r} }
func Blank(kind int) *Step {
	s := Shape(kind)
	s.SourceID = p.Const(0)
	s.OldTech = 0
	s.Row = prep.Row{Owner: p.Const(0), Source: p.Const(0), Count: p.Const(0), Side: 0, Type: 0, Tech: p.Technology{Weapons: 0, Shielding: 0, Armor: 0}}
	for i := range s.Header {
		s.Header[i] = p.Const(0)
	}
	for i := range s.Mission {
		s.Mission[i] = p.Const(0)
	}
	return s
}

// Build reconstructs the complete journal and trees; advice still requires all
// elementary proofs. It refuses inconsistent final preparation roots.
func Build(meta Metadata, header Header, events []Event) ([]*Step, error) {
	raw := prep.NewTree(big.NewInt(0))
	tech := prep.NewTree(big.NewInt(0))
	sources := prep.NewTree(big.NewInt(0))
	state := Initial()
	var steps []*Step
	finish := func(s *Step, o State) {
		s.Meta = meta
		s.Before = state
		s.After = o
		s.Binding = meta.Commitment()
		s.BeforeHash = state.Commitment()
		s.AfterHash = o.Commitment()
		s.KindPublic = s.Kind
		s.Result = 0
		if s.Kind == Seal {
			s.Result = prep.Hash(ResultDomain, append([]frontend.Variable{s.Binding}, o.Journal[:]...)...)
		}
		state = o
		steps = append(steps, s)
	}
	s := Blank(Begin)
	s.Header = header
	o := state
	o.Started = 1
	o.Owner = header[5]
	o.Journal = Digest(HeaderWords(meta, header)...)
	finish(s, o)
	for _, e := range events {
		s = Blank(e.Kind)
		o = state
		switch e.Kind {
		case Source:
			if scalar(state.Remaining).Sign() != 0 {
				return nil, fmt.Errorf("missing source rows")
			}
			id := Integer(e.SourceID)
			if id.Sign() == 0 || sources.Read(id).Sign() != 0 {
				return nil, fmt.Errorf("duplicate source")
			}
			s.SourceID = e.SourceID
			s.Mission = e.Mission
			s.Paths[0] = sources.Open(id)
			sources.Write(id, big.NewInt(1))
			o.Sources = sources.Root()
			o.Journal = Digest(SourceWords(state.Journal, e.SourceID, e.Mission)...)
			o.SourceID = e.SourceID
			o.Owner = e.Mission[2]
			o.LastType = 0
			var total uint64
			j := 12
			for typ := 0; typ < 16; typ++ {
				o.Counts[typ] = uint64(0)
				if typ != 9 && typ != 15 {
					o.Counts[typ] = Integer(e.Mission[j]).Uint64()
					j++
				}
				total += scalar(o.Counts[typ]).Uint64()
			}
			o.Remaining = total
			typ := Integer(e.Mission[1]).Uint64()
			o.Side = 1
			if typ == 3 || typ == 8 {
				o.Side = 0
			}
		case Row:
			r := e.Row
			s.Row = r
			idx := Integer(state.Rows)
			s.Paths[0] = raw.Open(idx)
			raw.Write(idx, prep.Hash(prep.RawDomain, r.Values()...))
			o.Raw = raw.Root()
			owner := Integer(r.Owner)
			s.OldTech = tech.Read(owner)
			s.Paths[1] = tech.Open(owner)
			tech.Write(owner, prep.Hash(prep.TechDomain, append(fields(r.Owner), r.Tech.Weapons, r.Tech.Shielding, r.Tech.Armor)...))
			o.Tech = tech.Root()
			o.Journal = Digest(RowWords(state.Journal, state.Rows, r)...)
			o.Rows = p.MustValue(new(big.Int).Add(idx, big.NewInt(1)))
			o.LastType = scalar(r.Type).Uint64() + 1
			if Integer(state.SourceID).Sign() != 0 {
				remaining := new(big.Int).Sub(scalar(state.Remaining), Integer(r.Count))
				if remaining.Sign() < 0 {
					return nil, fmt.Errorf("source count")
				}
				o.Remaining = remaining.Uint64()
			}
		default:
			return nil, fmt.Errorf("event kind")
		}
		finish(s, o)
	}
	if scalar(state.Remaining).Sign() != 0 {
		return nil, fmt.Errorf("missing final rows")
	}
	if raw.Root().Cmp(scalar(meta.Preparation.Raw)) != 0 || tech.Root().Cmp(scalar(meta.Preparation.Tech)) != 0 || Integer(state.Rows).Cmp(Integer(meta.Preparation.Rows)) != 0 {
		return nil, fmt.Errorf("preparation roots/count mismatch")
	}
	s = Blank(Seal)
	o = state
	o.Done = 1
	o.Journal = Digest(state.Journal, p.Const(3), state.Rows)
	finish(s, o)
	return steps, nil
}
