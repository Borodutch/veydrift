# Receipt — 2026-10-05

Implemented only the new memorybattle package. No battle/, aggregation/, oracle,
go.mod, contract, service, deployment, board or git mutations by this worker.

## Collected verification

- Bounded Boot+Init compile/solver passed before full trace expansion.
- Full suite: PASS, 97.945s Go test; 98.25s measured wall time.
- Max RSS: 2,419,654,656 bytes (~2.25 GiB). GOMAXPROCS=2,
  GOMEMLIMIT=2GiB (soft limit, not a hard ceiling), test timeout 300s.
- Six units: 132 constrained elementary transitions, 2 rounds, 18 RNG words.
- Ten units: 346 constrained elementary transitions, 3 rounds, 38 RNG words.
- BOTH rosters used the SAME cached eleven compiled constraint systems.
- Live independent TypeScript candidate-2 oracle equality: final hull/shield,
  RNG counter, round, winner, every round's shots and per-cohort survivors.
- Negative tests reject valid-but-stale earlier target openings, stale write
  roots, wrong index/sibling, modified seed/snapshot/roster, forged initial
  memory/state/spec, skipped initialization, authentic noncanonical roster,
  unauthorized immutable-field writes, invalid pools/ranks/reports, self-consistent
  premature-terminal/result commitments, altered final result, missing/replayed
  or context-mixed links. Linkage constraints also separately solver-tested.
- Boundary tests: shield-only explosion eligibility, 30% strictness, bounce,
  dead target/dead shooter scheduling, overkill, uint64-max damage/shield/hull,
  index above 2^63 and rejection of 2^64 alias, >32-bit RNG bounds, full-digest
  rejection, 256-bit counter carry and exhaustion refusal, empty/one-sided
  battles and six-round terminal condition.
- go vet ./memorybattle: PASS.
- All worker-launched processes collected. No Setup/proving invocation.

Constraints per operation (BN254 R1CS):

| Kind | Constraints |
|---|---:|
| Boot | 35,211 |
| Init | 224,404 |
| Ready | 35,231 |
| Reset | 131,134 |
| FindShooter | 84,760 |
| DrawTarget | 280,609 |
| FindTarget | 84,755 |
| Damage | 181,135 |
| Explosion | 376,611 |
| Rapidfire | 426,702 |
| Scan | 133,446 |

## Not proved / not shipped

No generated proof for these memory circuits, no recursion integration or
verified-key registry, no independent security review, no production ceremony.
The sibling worker's tiny fixed-roster multi-chunk proof is a separate artifact.
This foundation is **uint64 memory/stat/count limited**, not deployed uint256
protocol complete. Group/research/catalog/on-chain preparation qualification,
full-width arithmetic/address extension, source attribution and full settlement
result derivation remain implementation work. Prepared-input roots/snapshot/seed
must be authenticated externally. The README specifies the exact boundary.
These are unfinished engineering, not a request for a user decision or blocker.
