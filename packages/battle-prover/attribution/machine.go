package attribution

import (
	"fmt"
	"math/big"
	"sort"
)

type Row struct {
	Member          Member
	Lost, Survivors uint32
}
type Machine struct {
	Context Context
	State   State
	Members []Member
	Dead    []bool
	Rows    []Row
}

func lessMember(x, y Member) bool {
	o := number(x.Owner).Cmp(number(y.Owner))
	return o < 0 || (o == 0 && number(x.Source).Cmp(number(y.Source)) < 0)
}

// Prepare canonicalizes input order; zero rows are rejected because the oracle
// filters them BEFORE cohort construction. Qualification must validate them there.
// This is a host constructor, NOT authentication of the supplied snapshot/units.
func Prepare(c Context, members []Member, dead []bool) (*Machine, error) {
	ms := append([]Member(nil), members...)
	sort.Slice(ms, func(i, j int) bool { return lessMember(ms[i], ms[j]) })
	if len(ms) == 0 {
		return nil, fmt.Errorf("empty cohort")
	}
	total := new(big.Int)
	seen := map[string]bool{}
	for i, m := range ms {
		for _, u := range []Uint256{m.Owner, m.Source} {
			for _, v := range u {
				if integer(v).Sign() < 0 || integer(v).BitLen() > 64 {
					return nil, fmt.Errorf("invalid limb")
				}
			}
		}
		q := integer(m.Quantity)
		if number(m.Owner).BitLen() > 160 || q.Sign() <= 0 || q.BitLen() > 32 {
			return nil, fmt.Errorf("invalid member")
		}
		if i > 0 && !lessMember(ms[i-1], m) {
			return nil, fmt.Errorf("duplicate member")
		}
		source := number(m.Source).String()
		if seen[source] {
			return nil, fmt.Errorf("source owner conflict")
		}
		seen[source] = true
		total.Add(total, q)
	}
	if total.BitLen() > 256 || total.Cmp(new(big.Int).SetUint64(uint64(len(dead)))) != 0 {
		return nil, fmt.Errorf("unit coverage mismatch")
	}
	c.Members = U(uint64(len(ms)))
	c.Total = Big(total)
	c.Roster = 0
	c.Units = 0
	loss := uint64(0)
	for i, m := range ms {
		c.Roster = chain(rosterDomain, c.Roster, U(uint64(i)), memberHash(m))
	}
	for i, d := range dead {
		v := 0
		if d {
			v = 1
			loss++
		}
		c.Units = chain(unitsDomain, c.Units, U(uint64(i)), v)
	}
	c.Loss = U(loss)
	return &Machine{Context: c, State: zeroState(), Members: ms, Dead: append([]bool(nil), dead...)}, nil
}
func add(x Uint256, y *big.Int) Uint256 { return Big(new(big.Int).Add(number(x), y)) }
func inc(x Uint256) Uint256             { return add(x, big.NewInt(1)) }
func advice(c Context, m Member) (uint64, Uint256) {
	q, r := new(big.Int), new(big.Int)
	q.QuoRem(new(big.Int).Mul(number(c.Loss), integer(m.Quantity)), number(c.Total), r)
	return q.Uint64(), Big(r)
}
func (w *Step) commit() {
	w.ContextRoot = w.Context.Commitment()
	w.BeforeRoot = w.Before.Commitment()
	w.AfterRoot = w.After.Commitment()
	w.Finished = 0
	w.Result = 0
	if integer(w.After.Phase).Int64() == Done {
		w.Finished = 1
		w.Result = hash(resultDomain, w.ContextRoot, w.After.Output)
	}
}
func (m *Machine) Next() (*Step, error) {
	kind := int(integer(m.State.Phase).Int64())
	if kind == Done {
		return nil, fmt.Errorf("complete")
	}
	b := m.State
	out := b
	c := m.Context
	i := int(number(b.Index).Uint64())
	oi := int(number(b.Outer).Uint64())
	z := Member{U(0), U(0), 0}
	w := &Step{Context: c, Before: b, Kind: kind, Member: z, Target: z, Dead: 0, Quotient: 0, TargetQuotient: 0, Remainder: U(0), TargetRemainder: U(0)}
	out.Index = inc(b.Index)
	limit := len(m.Members)
	if kind == Units {
		limit = len(m.Dead)
	}
	last := i+1 == limit
	if kind == Units {
		if m.Dead[i] {
			w.Dead = 1
		}
		out.Scan = chain(unitsDomain, b.Scan, b.Index, w.Dead)
	} else {
		w.Member = m.Members[i]
		out.Scan = chain(rosterDomain, b.Scan, b.Index, memberHash(w.Member))
	}
	if last {
		out.Index = U(0)
		out.Scan = 0
	}
	switch kind {
	case Collect:
		out.PrevOwner = w.Member.Owner
		out.PrevSource = w.Member.Source
		out.Sum = add(b.Sum, integer(w.Member.Quantity))
		if last {
			out.Sum = U(0)
			out.Phase = Units
		}
	case Units:
		out.Sum = add(b.Sum, integer(w.Dead))
		if last {
			out.Sum = U(0)
			out.Phase = Floors
		}
	case Floors:
		q, r := advice(c, w.Member)
		w.Quotient = q
		w.Remainder = r
		out.Sum = add(b.Sum, new(big.Int).SetUint64(q))
		if last {
			out.FloorSum = out.Sum
			out.Sum = U(0)
			out.Phase = Rank
		}
	case Rank:
		w.Target = m.Members[oi]
		q, r := advice(c, w.Member)
		tq, tr := advice(c, w.Target)
		w.Quotient = q
		w.Remainder = r
		w.TargetQuotient = tq
		w.TargetRemainder = tr
		out.Active = memberHash(w.Target)
		out.Rank = b.Rank
		rc := number(r).Cmp(number(tr))
		if rc > 0 || (rc == 0 && lessMember(w.Member, w.Target)) {
			out.Rank = inc(out.Rank)
		}
		if last {
			lost := tq
			if number(out.Rank).Cmp(new(big.Int).Sub(number(c.Loss), number(b.FloorSum))) < 0 {
				lost++
			}
			survivors := integer(w.Target.Quantity).Uint64() - lost
			out.LostSum = add(b.LostSum, new(big.Int).SetUint64(lost))
			out.Outer = inc(b.Outer)
			out.OuterScan = chain(rosterDomain, b.OuterScan, b.Outer, memberHash(w.Target))
			row := hash(outputDomain, memberHash(w.Target), lost, survivors)
			out.Output = chain(outputDomain, b.Output, b.Outer, row)
			out.Active = 0
			out.Rank = U(0)
			m.Rows = append(m.Rows, Row{w.Target, uint32(lost), uint32(survivors)})
			if oi+1 == len(m.Members) {
				out.Phase = Done
			}
		}
	}
	w.After = out
	w.commit()
	m.State = out
	return w, nil
}

// NativeLargestRemainder is an independent sort-based integer oracle, not the
// circuit witness machine's pairwise rank algorithm. It does not authenticate data.
func NativeLargestRemainder(members []Member, loss *big.Int) ([]Row, error) {
	if loss == nil {
		return nil, fmt.Errorf("nil loss")
	}
	total := new(big.Int)
	seen := map[string]bool{}
	for _, m := range members {
		for _, u := range []Uint256{m.Owner, m.Source} {
			for _, v := range u {
				if integer(v).Sign() < 0 || integer(v).BitLen() > 64 {
					return nil, fmt.Errorf("invalid limb")
				}
			}
		}
		if number(m.Owner).BitLen() > 160 {
			return nil, fmt.Errorf("invalid owner")
		}
		source := number(m.Source).String()
		if seen[source] {
			return nil, fmt.Errorf("duplicate or conflicting source")
		}
		seen[source] = true
		q := integer(m.Quantity)
		if q.Sign() <= 0 || q.BitLen() > 32 {
			return nil, fmt.Errorf("quantity")
		}
		total.Add(total, q)
	}
	if total.Sign() == 0 || total.BitLen() > 256 || loss.Sign() < 0 || loss.Cmp(total) > 0 {
		return nil, fmt.Errorf("loss bound")
	}
	type entry struct {
		m Member
		q uint64
		r *big.Int
	}
	es := make([]entry, len(members))
	remaining := new(big.Int).Set(loss)
	for i, m := range members {
		q, r := new(big.Int), new(big.Int)
		q.QuoRem(new(big.Int).Mul(loss, integer(m.Quantity)), total, r)
		es[i] = entry{m, q.Uint64(), r}
		remaining.Sub(remaining, q)
	}
	sort.Slice(es, func(i, j int) bool {
		c := es[i].r.Cmp(es[j].r)
		return c > 0 || (c == 0 && lessMember(es[i].m, es[j].m))
	})
	rows := make([]Row, len(es))
	for i, e := range es {
		q := e.q
		if uint64(i) < remaining.Uint64() {
			q++
		}
		rows[i] = Row{e.m, uint32(q), uint32(integer(e.m.Quantity).Uint64() - q)}
	}
	sort.Slice(rows, func(i, j int) bool { return lessMember(rows[i].Member, rows[j].Member) })
	return rows, nil
}
