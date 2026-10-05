// Package attribution proves an OFFLINE per-cohort allocation relation, not
// chain qualification, combat execution, or settlement. See README.md.
package attribution

import (
	"github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark/frontend"
	"math/big"
)

type Uint256 = protocol.Uint256

var U = protocol.Const
var Big = protocol.MustValue

func integer(v frontend.Variable) *big.Int {
	switch n := v.(type) {
	case *big.Int:
		return new(big.Int).Set(n)
	case uint64:
		return new(big.Int).SetUint64(n)
	case uint32:
		return new(big.Int).SetUint64(uint64(n))
	case int:
		return big.NewInt(int64(n))
	}
	panic("bad native scalar")
}
func number(v Uint256) *big.Int {
	n := new(big.Int)
	for i := 3; i >= 0; i-- {
		n.Lsh(n, 64)
		n.Add(n, integer(v[i]))
	}
	return n
}

type arithmetic struct {
	*protocol.Arithmetic
	api frontend.API
}

func mathAPI(api frontend.API) *arithmetic { return &arithmetic{protocol.New(api), api} }
func (a *arithmetic) conditional(b frontend.Variable, x, y Uint256) {
	for i := range x {
		a.api.AssertIsEqual(a.api.Mul(b, a.api.Sub(x[i], y[i])), 0)
	}
}
func (a *arithmetic) division(loss, total Uint256, quantity, q frontend.Variable, r Uint256) {
	a.api.ToBinary(quantity, 32)
	a.api.ToBinary(q, 32)
	a.MulDiv(loss, Uint256{quantity, 0, 0, 0}, total, Uint256{q, 0, 0, 0}, r)
}
