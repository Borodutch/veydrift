package preparation

import (
	"fmt"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/frontend"
	"math/big"
	"sort"
)

type Machine struct {
	C                           Context
	State                       State
	Rows                        []Row
	Bases                       map[uint64]p.Stats
	Raw, Catalog, Tech, Visited *Tree
	Units                       *UnitTree
	order                       []int
	keys                        []p.Key
}

func add(x p.Uint256, n uint64) p.Uint256 {
	return p.MustValue(new(big.Int).Add(integer(x), new(big.Int).SetUint64(n)))
}
func zero(x p.Uint256) bool   { return integer(x).Sign() == 0 }
func sameKey(a, b p.Key) bool { return cmpKey(a, b) == 0 }
func cmpKey(a, b p.Key) int {
	av, bv := keyTuple(a), keyTuple(b)
	for i := range av {
		if n := integer(av[i]).Cmp(integer(bv[i])); n != 0 {
			return n
		}
	}
	return 0
}
func effective(s p.Stats, t p.Technology) (p.Stats, [3]frontend.Variable, error) {
	var rem [3]frontend.Variable
	vals := []p.Uint256{s.Attack, s.Shield, s.Hull}
	tech := []frontend.Variable{t.Weapons, t.Shielding, t.Armor}
	var out [3]p.Uint256
	for i, v := range vals {
		n := new(big.Int).Mul(integer(v), new(big.Int).Add(big.NewInt(10), scalar(tech[i])))
		if n.BitLen() > 256 {
			return p.Stats{}, rem, fmt.Errorf("effective overflow")
		}
		q, r := new(big.Int), new(big.Int)
		q.QuoRem(n, big.NewInt(10), r)
		out[i] = p.MustValue(q)
		rem[i] = r
	}
	return p.Stats{out[0], out[1], out[2]}, rem, nil
}
func New(id Identity, rows []Row, bases map[uint64]p.Stats) (*Machine, error) {
	m := &Machine{Rows: append([]Row{}, rows...), Bases: bases, Raw: NewTree(big.NewInt(0)), Catalog: NewTree(big.NewInt(0)), Tech: NewTree(big.NewInt(0)), Visited: NewTree(big.NewInt(0)), Units: NewUnitTree(), State: Initial()}
	for typ, b := range bases {
		m.Catalog.Write(new(big.Int).SetUint64(typ), Hash(CatalogDomain, append([]frontend.Variable{typ}, fields(b.Attack, b.Shield, b.Hull)...)...))
	}
	for i, r := range rows {
		b, ok := bases[scalar(r.Type).Uint64()]
		if !ok {
			return nil, fmt.Errorf("catalog")
		}
		s, _, err := effective(b, r.Tech)
		if err != nil {
			return nil, err
		}
		m.keys = append(m.keys, rowKey(r, s))
		m.order = append(m.order, i)
		m.Raw.Write(big.NewInt(int64(i)), Hash(RawDomain, r.Values()...))
		v := Hash(TechDomain, append(fields(r.Owner), r.Tech.Weapons, r.Tech.Shielding, r.Tech.Armor)...)
		if old := m.Tech.Read(integer(r.Owner)); old.Sign() != 0 && old.Cmp(v) != 0 {
			return nil, fmt.Errorf("owner tech inconsistent")
		}
		m.Tech.Write(integer(r.Owner), v)
	}
	sort.Slice(m.order, func(i, j int) bool {
		x, y := m.order[i], m.order[j]
		rz, sz := zero(rows[x].Count), zero(rows[y].Count)
		if rz != sz {
			return rz
		}
		if c := cmpKey(m.keys[x], m.keys[y]); c != 0 {
			return c < 0
		}
		if c := integer(rows[x].Owner).Cmp(integer(rows[y].Owner)); c != 0 {
			return c < 0
		}
		return integer(rows[x].Source).Cmp(integer(rows[y].Source)) < 0
	})
	m.C = Context{id, m.Raw.Root(), m.Catalog.Root(), m.Tech.Root(), p.Const(uint64(len(rows)))}
	return m, nil
}
func blank(kind int) *Step {
	w := Shape(kind)
	w.Row = zeroRow()
	w.Other = zeroRow()
	w.Index = p.Const(0)
	w.Effective = zeroKey().Stats
	w.Base = zeroKey().Stats
	w.Remainders = [3]frontend.Variable{0, 0, 0}
	for i := range w.UnitPath.Low {
		w.UnitPath.Low[i] = 0
	}
	w.UnitPath.Top = [2]frontend.Variable{0, 0}
	return w
}
func (m *Machine) Next() (*Step, error) {
	b := m.State
	kind := int(scalar(b.Phase).Int64())
	if kind == Done {
		return nil, fmt.Errorf("done")
	}
	w := blank(kind)
	w.C = m.C
	w.Before = b
	out := b
	out.Step = add(b.Step, 1)
	w.Result = 0
	switch kind {
	case Boot:
		out.Phase = Pair
		if len(m.Rows) == 0 {
			out.Phase = Finish
		}
	case Pair:
		i, j := integer(b.I).Int64(), integer(b.J).Int64()
		w.Row = m.Rows[i]
		w.Other = m.Rows[j]
		w.Paths[0] = m.Raw.Open(integer(b.I))
		w.Paths[1] = m.Raw.Open(integer(b.J))
		out.J = add(b.J, 1)
		if integer(out.J).Cmp(integer(m.C.Rows)) == 0 {
			out.J = p.Const(0)
			out.I = add(b.I, 1)
			if integer(out.I).Cmp(integer(m.C.Rows)) == 0 {
				out.I = p.Const(0)
				out.Phase = Member
			}
		}
	case Member:
		i := m.order[integer(b.Processed).Int64()]
		r, k := m.Rows[i], m.keys[i]
		w.Index = p.Const(uint64(i))
		w.Row = r
		w.Base = m.Bases[scalar(r.Type).Uint64()]
		w.Effective, w.Remainders, _ = effective(w.Base, r.Tech)
		w.Paths[0] = m.Raw.Open(big.NewInt(int64(i)))
		w.Paths[1] = m.Visited.Open(big.NewInt(int64(i)))
		w.Paths[2] = m.Catalog.Open(scalar(r.Type))
		w.Paths[3] = m.Tech.Open(integer(r.Owner))
		m.Visited.Write(big.NewInt(int64(i)), big.NewInt(1))
		out.Visited = m.Visited.Root()
		fresh := zero(b.Processed) || zero(b.Previous.Count) || !sameKey(b.Key, k)
		flush := !zero(b.Processed) && !zero(b.Previous.Count) && fresh
		if flush {
			out.Cohorts = CohortHash(b.Cohorts, b.Key, b.Cohort, b.Count)
			out.Cohort = add(b.Cohort, 1)
		}
		if fresh {
			out.Count = p.Const(0)
		}
		out.Count = p.MustValue(new(big.Int).Add(integer(out.Count), integer(r.Count)))
		if !zero(r.Count) {
			out.Members = MemberHash(b.Members, r, k, out.Cohort)
		}
		out.Total = p.MustValue(new(big.Int).Add(integer(b.Total), integer(r.Count)))
		out.Previous = r
		out.Key = k
		out.Offset = p.Const(0)
		out.Processed = add(b.Processed, 1)
		out.Phase = Expand
		if zero(r.Count) {
			out.Phase = Member
			if integer(out.Processed).Cmp(integer(m.C.Rows)) == 0 {
				out.Phase = Finish
			}
		}
	case Expand:
		w.UnitPath = m.Units.Open(integer(b.Unit))
		m.Units.Write(integer(b.Unit), b.Key, b.Cohort)
		out.UnitRoot = m.Units.Root()
		out.Unit = add(b.Unit, 1)
		out.Offset = add(b.Offset, 1)
		if integer(out.Offset).Cmp(integer(b.Previous.Count)) == 0 {
			out.Offset = p.Const(0)
			out.Phase = Member
			if integer(b.Processed).Cmp(integer(m.C.Rows)) == 0 {
				out.Phase = Finish
			}
		}
	case Finish:
		out.Phase = Done
		if !zero(b.Count) {
			out.Cohorts = CohortHash(b.Cohorts, b.Key, b.Cohort, b.Count)
		}
		w.Result = ResultHash(m.C.Commitment(), out)
	}
	w.After = out
	w.ContextHash = m.C.Commitment()
	w.BeforeHash = b.Commitment()
	w.AfterHash = out.Commitment()
	m.State = out
	return w, nil
}
func ResultHash(context frontend.Variable, s State) *big.Int {
	return Hash(ResultDomain, append([]frontend.Variable{context, s.Members, s.Cohorts, s.UnitRoot}, s.Total[:]...)...)
}
func (m *Machine) Chunk(budget int) ([]*Step, error) {
	out := []*Step{}
	for len(out) < budget && scalar(m.State.Phase).Int64() != Done {
		w, e := m.Next()
		if e != nil {
			return out, e
		}
		out = append(out, w)
	}
	return out, nil
}
