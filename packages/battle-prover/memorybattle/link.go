package memorybattle

import "github.com/consensys/gnark/frontend"

// Statement is ordered exactly as Step's public witness (excluding gnark's
// constant wire). A recursive verifier MUST authenticate the elementary key and
// proof before applying these constraints; these helpers do not verify proofs.
type Statement [8]frontend.Variable

const (
	ContextField = iota
	BeforeField
	AfterField
	StartField
	EndField
	BeforeDoneField
	AfterDoneField
	ResultField
)

func (c *Step) Statement() Statement {
	return Statement{c.Context, c.BeforeRoot, c.AfterRoot, c.Start, c.End, c.BeforeDone, c.AfterDone, c.Result}
}
func AssertLinked(api frontend.API, left, right Statement) {
	api.AssertIsEqual(left[ContextField], right[ContextField])
	api.AssertIsEqual(left[AfterField], right[BeforeField])
	api.AssertIsEqual(left[EndField], right[StartField])
	api.AssertIsEqual(left[AfterDoneField], 0)
	api.AssertIsEqual(right[BeforeDoneField], 0)
	api.AssertIsEqual(left[ResultField], 0)
}

// Apply to the first/last VERIFIED statements only after proving every adjacency.
func AssertComplete(api frontend.API, first, last Statement) {
	api.AssertIsEqual(first[ContextField], last[ContextField])
	api.AssertIsEqual(first[StartField], 0)
	api.AssertIsEqual(first[BeforeDoneField], 0)
	api.AssertIsEqual(last[AfterDoneField], 1)
}
