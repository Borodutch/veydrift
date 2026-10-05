package protocol

import "github.com/consensys/gnark/frontend"

// HitCircuit checks damage and explosion from a supplied in-range draw. The
// external controller must consume an authenticated accepted draw IFF Eligible.
// Draw is canonical zero otherwise; this relation does not prove randomness.
type HitCircuit struct {
	Attack, MaxShield, MaxHull, Shield, Hull, Draw Uint256
	AfterShield, AfterHull                         Uint256
	Bounced, Eligible, Exploded                    frontend.Variable
}

func (c *HitCircuit) Define(api frontend.API) error {
	a := New(api)
	attack, maxShield, maxHull, shield, hull, draw := a.lift(c.Attack), a.lift(c.MaxShield), a.lift(c.MaxHull), a.lift(c.Shield), a.lift(c.Hull), a.lift(c.Draw)
	api.AssertIsEqual(a.f.IsZero(maxHull), 0)
	api.AssertIsEqual(a.less(maxShield, shield), 0)
	api.AssertIsEqual(a.less(maxHull, hull), 0)
	alive := api.Sub(1, a.f.IsZero(hull))
	// Oracle comparisons are mathematical integers, up to 263 bits here.
	bounce := api.Mul(alive, api.Sub(1, a.f.IsZero(shield)), a.less(a.f.Mul(attack, a.f.NewElement(100)), maxShield))
	active := api.Mul(alive, api.Sub(1, bounce))
	absorbed := a.f.Select(a.less(attack, shield), attack, shield)
	damage := a.f.Sub(attack, absorbed)
	shieldAfter := a.f.Select(active, a.f.Sub(shield, absorbed), shield)
	survives := a.less(damage, hull)
	hullAfter := a.f.Select(active, a.f.Sub(hull, a.f.Select(survives, damage, hull)), hull)
	missing := a.f.Sub(maxHull, hullAfter)
	eligible := api.Mul(active, api.Sub(1, a.f.IsZero(attack)), api.Sub(1, a.f.IsZero(hullAfter)), a.less(a.f.Mul(maxHull, a.f.NewElement(3)), a.f.Mul(missing, a.f.NewElement(10))))
	api.AssertIsEqual(api.Mul(eligible, api.Sub(1, a.less(draw, maxHull))), 0)
	a.f.AssertIsEqual(a.f.Select(eligible, a.f.Zero(), draw), a.f.Zero())
	exploded := api.Mul(eligible, a.less(draw, missing))
	a.AssertEqual(c.AfterShield, a.narrow(shieldAfter))
	a.AssertEqual(c.AfterHull, a.narrow(a.f.Select(exploded, a.f.Zero(), hullAfter)))
	api.AssertIsEqual(c.Bounced, bounce)
	api.AssertIsEqual(c.Eligible, eligible)
	api.AssertIsEqual(c.Exploded, exploded)
	return nil
}

type SampleCircuit struct {
	Word, Bound, Value, Quotient, MaxQuotient, MaxRemainder Uint256
	Accepted                                                frontend.Variable
}

func (c *SampleCircuit) Define(api frontend.API) error {
	a := New(api)
	api.AssertIsEqual(c.Accepted, a.Sample(c.Word, c.Bound, c.Value, c.Quotient, c.MaxQuotient, c.MaxRemainder))
	return nil
}
