package attribution

import (
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"math/big"
	"testing"
)

type divisionCircuit struct {
	Loss, Total, R Uint256
	Quantity, Q    frontend.Variable
}

func (c *divisionCircuit) Define(api frontend.API) error {
	a := mathAPI(api)
	api.AssertIsEqual(a.Less(c.Total, c.Loss), 0)
	a.division(c.Loss, c.Total, c.Quantity, c.Q, c.R)
	return nil
}
func TestUint256LossAnd288BitProduct(t *testing.T) {
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &divisionCircuit{})
	if e != nil {
		t.Fatal(e)
	}
	max := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
	loss := new(big.Int).Sub(max, big.NewInt(17))
	qty := uint64(0xffffffff)
	q, r := new(big.Int), new(big.Int)
	product := new(big.Int).Mul(loss, new(big.Int).SetUint64(qty))
	q.QuoRem(product, max, r)
	if product.BitLen() != 288 {
		t.Fatal("not testing wide product")
	}
	good := divisionCircuit{Big(loss), Big(max), Big(r), qty, q.Uint64()}
	solve(t, cc, &good, true)
	for _, mutate := range []func(*divisionCircuit){
		func(w *divisionCircuit) { w.R = Big(max) },
		func(w *divisionCircuit) { w.Q = q.Uint64() + 1 },
		func(w *divisionCircuit) { w.Q = uint64(1) << 32 },
		func(w *divisionCircuit) { w.Quantity = uint64(1) << 32 },
		func(w *divisionCircuit) { w.Total = U(0) },
		func(w *divisionCircuit) { w.Loss = Big(max); w.Total = Big(loss) },
		func(w *divisionCircuit) { w.Loss[0] = new(big.Int).Lsh(big.NewInt(1), 64) },
	} {
		bad := good
		mutate(&bad)
		solve(t, cc, &bad, false)
	}
	// Not a full enormous-roster trace: independently tests large aggregate native
	// conservation, while the solver above proves the untruncated integer relation.
	ms := []Member{member(1, 2, qty), member(1, 10, qty), member(2, 0, qty)}
	L := new(big.Int).SetUint64(2*qty + 123)
	rows, e := NativeLargestRemainder(ms, L)
	if e != nil {
		t.Fatal(e)
	}
	total := uint64(0)
	for _, r := range rows {
		total += uint64(r.Lost)
		if uint64(r.Lost)+uint64(r.Survivors) != qty {
			t.Fatal("member conservation")
		}
	}
	if total != L.Uint64() {
		t.Fatal("aggregate conservation")
	}
}

type linkCircuit struct{ Left, Right Statement }

func (c *linkCircuit) Define(api frontend.API) error { AssertLinked(api, c.Left, c.Right); return nil }

type completeCircuit struct{ First, Last Statement }

func (c *completeCircuit) Define(api frontend.API) error {
	AssertComplete(api, c.First, c.Last)
	return nil
}
func TestChunkLinksAndCoverage(t *testing.T) {
	ws := run(t, fixture(t, 2), nil)
	cc, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &linkCircuit{})
	if e != nil {
		t.Fatal(e)
	}
	end, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &completeCircuit{})
	if e != nil {
		t.Fatal(e)
	}
	for i := 1; i < len(ws); i++ {
		solve(t, cc, &linkCircuit{ws[i-1].Statement(), ws[i].Statement()}, true)
	}
	solve(t, end, &completeCircuit{ws[0].Statement(), ws[len(ws)-1].Statement()}, true)
	// Omission, replay, reordering and false context are not legal chunk links.
	for _, p := range [][2]int{{0, 2}, {1, 1}, {2, 1}, {19, 0}} {
		solve(t, cc, &linkCircuit{ws[p[0]].Statement(), ws[p[1]].Statement()}, false)
	}
	bad := ws[1].Statement()
	bad[0] = 1
	solve(t, cc, &linkCircuit{ws[0].Statement(), bad}, false)
	solve(t, end, &completeCircuit{ws[1].Statement(), ws[19].Statement()}, false)
	solve(t, end, &completeCircuit{ws[0].Statement(), ws[18].Statement()}, false)
	// Any chunking of verified elementary steps uses identical boundary statements.
	for _, chunk := range []int{1, 2, 3, 7, 20} {
		for i := chunk; i < len(ws); i += chunk {
			solve(t, cc, &linkCircuit{ws[i-1].Statement(), ws[i].Statement()}, true)
		}
	}
}
func TestHighIdentityBitsAndOwnerTie(t *testing.T) {
	maxSource := Big(new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)))
	maxOwner := Big(new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 160), big.NewInt(1)))
	ms := []Member{{maxOwner, maxSource, uint64(1)}, member(1, 10, 1), member(1, 2, 1)}
	m, e := Prepare(context(), ms, []bool{true, true, false})
	if e != nil {
		t.Fatal(e)
	}
	run(t, m, nil)
	if m.Rows[0].Lost != 1 || m.Rows[1].Lost != 1 || m.Rows[2].Lost != 0 {
		t.Fatal("numeric identity tie")
	}
	// Solver-test the high limbs in Collect and Rank, not only the native helper.
	m, e = Prepare(context(), ms, []bool{true, true, false})
	if e != nil {
		t.Fatal(e)
	}
	ws := run(t, m, nil)
	collect := compile(t, Collect)
	rank := compile(t, Rank)
	solve(t, collect, ws[2], true)
	solve(t, rank, ws[len(ws)-1], true)
	bad := *ws[len(ws)-1]
	bad.Target.Source = U(0)
	bad.commit()
	solve(t, rank, &bad, false)
}
