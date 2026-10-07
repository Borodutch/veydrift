package outputbridge

import (
	"fmt"
	attr "github.com/Borodutch/veydrift/packages/battle-prover/attribution"
	prep "github.com/Borodutch/veydrift/packages/battle-prover/preparation"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/consensys/gnark/frontend"
)

type Group struct {
	Context attr.Context
	Rows    []attr.Row
}
type Machine struct {
	Manifest Manifest
	State    State
	Groups   []Group
	Leaves   []Leaf
}

func blankLeaf() Leaf {
	return Leaf{Index: Z(0), Cohort: Z(0), Owner: Z(0), Source: Z(0), Side: 0, Unit: 0, Count: 0, Lost: 0, Survivors: 0, Next: Z(0)}
}
func blankAllocation() attr.Context {
	return attr.Context{Snapshot: Z(0), Cohort: Z(0), Side: 0, Type: 0, Stats: [3]U{Z(0), Z(0), Z(0)}, Members: Z(0), Total: Z(0), Loss: Z(0), Roster: 0, Units: 0}
}
func (s *Step) Commit() {
	s.Binding = s.Manifest.Commitment()
	s.BeforeHash = s.Before.Commitment()
	s.AfterHash = s.After.Commitment()
	s.Finished = 0
	s.Result = 0
	if scalar(s.After.Phase).Int64() == Done {
		s.Finished = 1
		s.Result = prep.Hash(ResultDomain, s.Binding)
	}
}

// New constructs advice; it neither authenticates dependencies nor silently sorts
// rows. Canonical order is checked by the circuit and complete upstream proof.
func New(m Manifest, groups []Group) (*Machine, error) {
	var leaves []Leaf
	for i, g := range groups {
		if number(g.Context.Cohort).Cmp(number(Z(uint64(i)))) != 0 || number(g.Context.Members).Cmp(number(Z(uint64(len(g.Rows))))) != 0 {
			return nil, fmt.Errorf("group index/count")
		}
		for _, r := range g.Rows {
			leaves = append(leaves, Leaf{Index: Z(uint64(len(leaves))), Cohort: g.Context.Cohort, Owner: r.Member.Owner, Source: r.Member.Source, Side: g.Context.Side, Unit: g.Context.Type, Count: r.Member.Quantity, Lost: uint64(r.Lost), Survivors: uint64(r.Survivors), Next: Z(0)})
		}
	}
	if number(m.Context.Prepared.Cohorts).Cmp(number(Z(uint64(len(groups))))) != 0 || number(m.Context.Prepared.Members).Cmp(number(Z(uint64(len(leaves))))) != 0 {
		return nil, fmt.Errorf("manifest count")
	}
	next := Tail(m.ChainRecord, m.Context.Prepared.Members)
	for i := len(leaves) - 1; i >= 0; i-- {
		leaves[i].Next = next
		next = leaves[i].Digest(m.ChainRecord)
	}
	m.Root = next
	return &Machine{Manifest: m, State: Initial(), Groups: groups, Leaves: leaves}, nil
}

// FromBridge consumes an ACTUAL terminal resultbridge machine, its attribution
// rows and a terminal report statement. Both machines/statements remain advice.
func FromBridge(b *rb.Machine, report rb.ReportStatement, chain U, rawResult frontend.Variable) (*Machine, error) {
	if b == nil || scalar(b.State.Phase).Int64() != rb.Done {
		return nil, fmt.Errorf("bridge not terminal")
	}
	c := b.Context
	if scalar(report[0]).Cmp(c.Commitment()) != 0 || scalar(report[1]).Cmp(c.Input()) != 0 || scalar(report[2]).Cmp(c.CombatResult()) != 0 || scalar(report[5]).Int64() != 1 {
		return nil, fmt.Errorf("report mismatch/incomplete")
	}
	allocation := prep.Hash(rb.ResultDomain, c.Commitment(), c.Prepared.Commitment(), c.Input(), c.CombatResult(), b.State.Output)
	pipeline := [8]frontend.Variable{c.Prepared.PreparationContext, c.Prepared.Commitment(), c.Input(), c.CombatResult(), c.Commitment(), allocation, report[6], prep.Hash(rb.CompleteResultDomain, c.Commitment(), allocation, report[6])}
	groups := make([]Group, len(b.Attributions))
	for i, a := range b.Attributions {
		if scalar(a.State.Phase).Int64() != attr.Done {
			return nil, fmt.Errorf("attribution not terminal")
		}
		groups[i] = Group{Context: a.Context, Rows: a.Rows}
	}
	return New(Manifest{Context: c, Pipeline: pipeline, RawResult: rawResult, ChainRecord: chain, Root: Z(0)}, groups)
}
func index(w U, n int) (int, error) {
	v := number(w)
	if !v.IsUint64() || v.Uint64() >= uint64(n) {
		return 0, fmt.Errorf("host materialization cursor")
	}
	return int(v.Uint64()), nil
}
func (m *Machine) Next() (*Step, error) {
	b := m.State
	o := b
	k := int(scalar(b.Phase).Int64())
	if k == Done {
		return nil, fmt.Errorf("complete")
	}
	s := &Step{Kind: k, Manifest: m.Manifest, Before: b, Allocation: blankAllocation(), Leaf: blankLeaf()}
	var c attr.Context
	if k == Open || k == Member || k == Close {
		i, e := index(b.Cohort, len(m.Groups))
		if e != nil {
			return nil, e
		}
		c = m.Groups[i].Context
		s.Allocation = c
	}
	switch k {
	case Begin:
		o.Expected = m.Manifest.Root
		o.Phase = Open
		if len(m.Groups) == 0 {
			o.Phase = Finish
		}
	case Open:
		o.Active = c.Commitment()
		o.Phase = Member
	case Member:
		i, e := index(b.Index, len(m.Leaves))
		if e != nil {
			return nil, e
		}
		l := m.Leaves[i]
		s.Leaf = l
		o.Expected = l.Next
		mh := prep.Hash(440601, memberValues(attr.Member{Owner: l.Owner, Source: l.Source, Quantity: l.Count})...)
		o.Roster = prep.Hash(440602, streamValues(b.Roster, b.Local, mh)...)
		row := prep.Hash(440606, mh, l.Lost, l.Survivors)
		o.Allocation = prep.Hash(440606, streamValues(b.Allocation, b.Local, row)...)
		o.Sum = add(b.Sum, l.Count)
		o.Loss = add(b.Loss, l.Lost)
		o.Total = add(b.Total, l.Count)
		if scalar(c.Side).Sign() == 0 {
			o.Survivors0 = add(b.Survivors0, l.Survivors)
		} else {
			o.Survivors1 = add(b.Survivors1, l.Survivors)
		}
		o.PrevOwner = l.Owner
		o.PrevSource = l.Source
		o.Index = inc(b.Index)
		o.Local = inc(b.Local)
		if number(o.Local).Cmp(number(c.Members)) == 0 {
			o.Phase = Close
		}
	case Close:
		ar := prep.Hash(440607, b.Active, b.Allocation)
		row := prep.Hash(rb.OutputDomain, append(fields(b.Cohort), b.Active, ar)...)
		o.Output = prep.Hash(rb.OutputDomain, streamValues(b.Output, b.Cohort, row)...)
		o.Cohort = inc(b.Cohort)
		o.Local = Z(0)
		o.Sum = Z(0)
		o.Loss = Z(0)
		o.PrevOwner = Z(0)
		o.PrevSource = Z(0)
		o.Active = 0
		o.Roster = 0
		o.Allocation = 0
		o.Phase = Open
		if number(o.Cohort).Cmp(number(m.Manifest.Context.Prepared.Cohorts)) == 0 {
			o.Phase = Finish
		}
	case Finish:
		o.Phase = Done
	default:
		return nil, fmt.Errorf("phase")
	}
	s.After = o
	s.Commit()
	m.State = o
	return s, nil
}

// Chunk limits host work, not eligible members. Resuming requires authentication
// of State.Commitment against a verified prefix, not trusting this host object.
func (m *Machine) Chunk(max int) ([]*Step, error) {
	if max < 0 {
		return nil, fmt.Errorf("negative work")
	}
	var out []*Step
	for i := 0; i < max && scalar(m.State.Phase).Int64() != Done; i++ {
		s, e := m.Next()
		if e != nil {
			return nil, e
		}
		out = append(out, s)
	}
	return out, nil
}
