# Production witness constructors

Implemented API frozen for runtime callers:

```go
func NewLeafWitness(step frontend.Circuit) (*FamilyLeaf, error)
func NewCloseWitness(step *resultbridge.Step, attributionRange FamilyRange, attributionAuth CatalogAuth) (*CompleteClose, error)
func NewNodeWitness(id FamilyID, children []FamilyEnvelope, keys []Key, selectors []int) (*FamilyNode, error)
func CanonicalRange(phase int, r FamilyRange) ([24]string, error)
func RangeFromCanonical(phase int, values [24]string) (FamilyRange, error)
func RawQualifiedDigest(c RawQualifiedClaims) (*big.Int, error)
func OutputPipelineDigest(c OutputPipelineClaims) (*big.Int, error)
```

NewLeafWitness accepts pointers to preparation.Step, memorybattle.Step, attribution.Step, resultbridge.Step, resultbridge.ReportStep, rawbridge.Step, outputbridge.Step; bare Bridge Close is rejected. Existing private wrappers and relations are reused; one instruction, work=1, exactly three public scalars.

Canonical ranges use decimal strings: First[10], Last[10], Count[4] little-endian uint64 limbs. Reject noncanonical/negative/out-of-field scalars, nonzero phase padding, zero/overflow work. No reflection.

Node keys MUST be trusted approved setup constants in Dependencies(id) order, never a prover-supplied VK. The constructor checks family identity, child arity, selector range, normalized VK/public schema, canonical ranges and work/height bounds. FamilyEnvelope has no authenticated phase/level identity: actual provenance and adjacency remain enforced by the existing recursive circuit and approved keys, not native scheduling. Child Auth.Keys/Selector are replaced by the supplied approved catalog and selectors.

CompleteClose requires an approved complete-attribution-root catalog (normally level256), checks the normalized range/auth schema, and delegates all proof/completion checks to the unchanged CompleteClose relation. Native constructors do not verify proofs or establish key approval.

Existing FamilyPhaseJoin, Join, RawQualified, OutputPipeline, SettlementFinal and claim fields are exported; no generic role-string adapter is needed. RawQualifiedDigest and OutputPipelineDigest expose the existing private hash preimages with canonical scalar validation; no role-string adapter or duplicate circuit relation is introduced. Witness objects and supplied keys must remain frozen until witness serialization/compilation, matching the existing private wrappers.

Verification: `GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./composition -run ^TestRuntime -count=1 -timeout=5m -v`. Two actual attribution machine inputs produce 4 and 10 instructions across all four kinds; each kind reuses one compiled CCS, solves both traces, exposes exactly three public scalars and stays below four million constraints. Forged leaf work fails solving. Separate host tests cover all seven typed dispatch branches, Close/role/selector/schema guards, full uint256 range round trips and malformed scalars. Node/Close host fixtures use explicitly unproved schema placeholders, never claimed as proof evidence. No recursive setup/proof generation or historical receipt changes.
