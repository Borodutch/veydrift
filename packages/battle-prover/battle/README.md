# Test-only complete individual-shot battle proof

Small cryptographic prerequisite only. Candidate-2, including shield-only explosion checks. **Not the production arbitrary-fleet/recursive authenticated-memory gate.** No chain/deployment changes.

## Compact statement for aggregation integration

CommittedStep public order is exactly seven BN254 scalars:

0. Context = MiMC(440202,64, fixtureDigest bytes[32], seed bytes[32])
1. BeforeRoot = MiMC(440201,59, Before.Values())
2. AfterRoot = MiMC(440201,59, After.Values())
3. Start = Before.Step
4. End = After.Step
5. BeforeDone = (Before.Phase == Done)
6. AfterDone = (After.Phase == Done)

MiMC is the installed gnark/gnark-crypto standard gadget, with fixed-length domain-separated encodings. Context digest is SHA256(candidate rules + ":fixture:" + Go JSON Config). Both state preimages and seed are **private**; every preimage field is constrained by the real transition circuit. No output hash can replace battle execution. SHA256 randomness is unchanged. A separate Step circuit exposes all fields for inexpensive diagnostics.

Config is compile-time, not witness-selected. Context binds all identities/base stats/technology/RF, including different owners with identical effective stats. Both verification keys must be verifier-pinned to the same Config: ordinary key and RNG key. Genesis is the all-zero state with Start=0/BeforeDone=0. Aggregation must enforce common Context, AfterRoot/BeforeRoot and End/Start adjacency, prohibit continued execution after done, anchor genesis and require final AfterDone=1; terminal state opening binds full result. Current VerifyComplete performs this through linear verification with complete transport states. **It is not recursion.**

## Execution

Initialization writes one individual slot per operation, deriving exact effective stats from fixed uint16 base/tech constants. Reads select the current authenticated hull/shield array, writes preserve untouched entries; full private-state preimage commitments plus links authenticate latest writes. This is O(fleet size), not scalable memory authentication.

RNG uses actual two-block SHA256 via gnark SHA2/uints. Bitwise long division retains all 256 digest bits; no hash-to-BN254 truncation. Rejection checks the unbiased limit; each rejected word is a resumable step. RF chains have no cap. Round pool scans/reset touch one slot per operation; round-start wrecks remain targets and scheduled shooters. Six-round termination and the full round/result state are constrained.

## Deliberate ceilings

Exactly four fixed units, distinct side/type cohorts, one member/unit per cohort (attribution is therefore trivial but exact). uint16 base/technology, effective values below 2^29, intermediate arithmetic below 2^48. uint64 stream position/work/shot counters fail rather than wrap. These are test-only ceilings, not gameplay limits. A new Config needs test-only setup; no production ceremony, parser, catalog authentication or roster qualification is claimed.

## Commands

From packages/battle-prover:

~~~sh
GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./battle -short -count=1 -v
BATTLE_PROOF=1 GOMAXPROCS=2 GOMEMLIMIT=2GiB go test ./battle -run TestCompleteBattleProof -count=1 -timeout 10m -v
~~~

Short tests solve compiled constraints, compare eight seeds against the independent TypeScript oracle and mutate witnesses. They cover rejected SHA-word arithmetic at limit-1/limit/max (including bound one), full-shield bounce equality, shield-only explosions, strict 30%, zero attack/wreck hits, six-round draw, empty-side initialization, killed defender firing eligibility, every-boundary JSON resumption and counter wrap refusal. Opt-in test does real setup/prove, serializes/deserializes every proof, links/verifies to terminal full result; keys stay in memory. It rejects truncated/skipped/reordered chunks, stale memory, result/seed/genesis mutations and swapped proofs. Proof evidence files must match current source/rules; candidate-1 evidence is obsolete.

## Still required; engineering, not external blockers

- Integrate the MemoryUpdate standard MiMC/Merkle gadget (currently separately tested with two linked writes and stale-read/index/sibling attacks) into variable-length units/pools and chunked variable roster canonicalization; fleet growth means more work/chunks, never truncation.
- Full uint256 checked input scaling/RNG counter and nontrivial largest-remainder member attribution.
- Integrate actual battle leaves with variable recursive aggregation, pinned key graph, exact terminal result binding; sibling increment-probe proofs alone do not prove a battle.
- Immutable qualified roster/research/catalog/seed authentication, identity domains, production key lifecycle and exactly-once conserving settlement.
- Independent review and wider adversarial oracle vectors, resource-bounded resumable prover service.
