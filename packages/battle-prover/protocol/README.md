# Full-width elementary protocol relations (not authentication)

Stable arithmetic interface for sibling packages:

- `Uint256 [4]frontend.Variable`, little-endian uint64 limbs.
- `New(api) *Arithmetic`; `Const(uint64)`, `Value(*big.Int) (Uint256,error)`, `MustValue(*big.Int)`.
- `AddChecked/SubChecked/MulChecked(x,y Uint256) Uint256`.
- `Less/Equal(x,y Uint256) frontend.Variable`, `AssertEqual(x,y)`, `Select(boolean,x,y)`.
- `DivMod(n,d,q,r Uint256)` asserts n=q*d+r, 0<=r<d, d>0.
- `MulDiv(x,y,d,q,r Uint256)` asserts x*y=q*d+r without narrowing its up-to-512-bit numerator; suitable for 288-bit losses*member. Caller separately constrains member count to uint32. No host hint is trusted.
- `DivisionAdvice(n,d *big.Int)` constructs q/r witnesses for uint256 numerator.

All operations range-check their operands. No native-field truncation.
Uses pinned gnark standard emulated Mod1e512 and standard binary comparison;
no new dependencies/crypto. Every lifted integer is explicitly padded to the
standard eight-limb representation; unpadded short elements fail the all-ones
boundary under strict reduction in pinned gnark. The near-max regression tests
exercise that path. The emulation modulus is 2^512-1, not uint256 wraparound:
all multiplication/equality operands stay strictly below it. Checked results
must have their top 256 bits zero; subtraction separately enforces ordering.

## Fixed-size elementary circuits

- PrepareCircuit: one Group (owner160/source256/count32/type16/side1/tech16),
  supplied Base Stats and three remainder values. It checks all three exact
  effective stats with checked numerator multiplication before floor /10.
  Hull is positive. Type16 follows candidate-2 catalog IDs; authenticating the
  deployed unit catalog (Solidity cohort unit is uint8) is a caller obligation.
- AppendCircuit: Previous/Current Group, First, Before/AfterCount and Cohort,
  NewCohort. Keys are exactly (side,type,attack,shield,hull), followed within a
  cohort by strictly increasing (owner,source). Same-key rows add uint32 counts
  into checked uint256; new cohorts reset count and increment uint256 ID. First
  requires zero prior count/ID. Current count is positive; zero-count enrollment
  rows must still pass preparation/identity coverage before external omission.
- ConsistencyCircuit: two Group rows, SameSource/SameOwner. Equal sources imply
  same owner and side; equal owners imply identical frozen technology. It proves
  only this pair, not global coverage or uniqueness.
- ExpandCircuit: supplied Key/Cohort/Count, Offset/Index, UnitKey/UnitCohort,
  Hull/Shield and NextOffset/NextIndex/Last. It proves one in-range unit starts at
  maxima, offset progression and end-of-cohort reset, and checked global index
  progression. All counts/ranks/IDs are uint256. This is NOT a 256-level memory
  tree and does not extend memorybattle's existing uint64 addressing.
- HitCircuit: uint256 Attack/MaxShield/MaxHull/Shield/Hull/Draw, outputs
  AfterShield/AfterHull and Bounced/Eligible/Exploded. Widened 263-bit bounce and
  260-bit explosion comparisons match the oracle, including positive-power
  shield-only explosion, strict thresholds, dead targets and overkill. Draw must
  be zero when ineligible and below MaxHull otherwise.
- SampleCircuit: Word/Bound/Value/Quotient/MaxQuotient/MaxRemainder and Accepted.
  Proves one full-256-bit rejection attempt; nonzero Bound can be max uint256.
  Value is word % bound even on rejection, but MUST NOT be consumed then.

Helpers: EffectiveAdvice(base,tech), NewSampleWitness(word,bound), and
MulDivisionAdvice(x,y,d) construct checked witnesses; the circuit constrains
all advice independently. Value rejects negatives and values >=2^256.

All circuit fields are private by default: these are relation building blocks,
not standalone externally meaningful proof statements. The integration must
bind every input/output through authenticated commitments/public statements.

## Explicitly missing integration

No enrollment/catalog/research root authentication, snapshot/seed lifecycle,
complete member coverage, global identity uniqueness, authenticated owner/source
indexes, source-to-cohort permutation proof, linked complete scan, roster-root
construction, RF qualification, RNG digest/counter binding, memorybattle wiring,
recursive key authorization, or settlement verifier is supplied. Append/Expand
standalone witnesses may select arbitrary prior state; an authenticated
controller must anchor and chain them and enforce terminal coverage. Sample
requires the authenticated SHA256 word and counter from that controller; Hit
requires exactly one accepted draw iff Eligible. Owner/source values are not
silently reduced to cohort IDs. These limitations are not authentication claims.

## Verification

From packages/battle-prover:

    GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./protocol -count=1 -v -timeout=240s

Bun is required: live TypeScript imports execute oracle.effective and oracle.hit,
not copied expected results. Independent big.Int cases cover checked arithmetic,
full 512-bit MulDiv, 2^64/2^128/2^255/max bounds, RNG acceptance edges and high-bit
changes. Malicious advice, noncanonical remainders, range violations, overflow,
forged flags/results/identity/order/count/cohort/roster fields must fail. Only
compile/solver tests; no setup/proving/recursion performed. GOMEMLIMIT is a soft
Go limit, not OS isolation. See solver-evidence.txt and source-sha256.txt.
