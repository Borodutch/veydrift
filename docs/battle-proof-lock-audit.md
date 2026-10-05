# Pending-proof integration audit (source baseline only)

Ticket #44; source `4a017cc9772c1bd6bcba6bdad7b12221e71c63e9`. This is a source integration checklist, not an implemented or exhaustively verified reservation system. All paths below retain current behavior in this checkpoint.

| Mutation / event | Current ordering guard | Required pending-proof treatment |
|---|---|---|
| Attack/ACS battle | Batch chronology, protection snapshot, staged combat | Only new-version leaders enter immutable snapshot/proof path; previously launched leaders retain legacy continuation |
| Transport/Deploy | `VeydriftBatchTransportModule.resolveFleetMission`, chronology and target body lock | Keep ordinary proof-free dispatch; same-inventory later arrival may wait; independent targets continue |
| DefenseHold arrival | Dedicated hold dispatch after chronology | No arrival proof; enroll eligible units only into the relevant Attack proof |
| Harvest/MissileAttack | Existing due-mission guard and specialized resolution | No new proof requirement; preserve chronology and authenticated prior losses |
| Recall / ACS join / hold launch | Origin and target pending-mission guards | Must not remove or duplicate enrolled inventory or change completed snapshot |
| Ship / defense production | Planet pending guard and impact-cutoff queues | Keep cutoff invariant; later units cannot become retroactive targets or be overwritten by old survivors |
| Research start/finish | Player-wide pending-mission guard | Frozen per-owner research cannot be reconstructed by reading current values later; relaxation needs separate history/reservation proof |
| Rename, abandonment, withdrawals | Planet pending guard | Existing scope is broader than combat inventory; do not advertise unaffected usability without testing these paths |
| Buildings / Rift | Planet pending guard | Preserve economic/score/protection snapshot and impact ordering |
| Alliance production boundary | Staged `bodyLock[planetId]` | Current key also couples planet and moon; any narrower key requires reviewed chronology and ownership semantics |
| Passive resource collection | Caps settlement at earliest unresolved impact | Not a global freeze; preserve this permitted path without crossing the battle snapshot cutoff |
| Legacy returns / settlement | Chronology plus resident casualty subtraction | Apply losses/reservations, never replace current inventory with snapshot survivor totals |

## Concrete source anchors

- `packages/contracts/src/VeydriftBatchTransportModule.sol:62-94`: already-resolved no-op, target body lock, chronology then mission-specific dispatch. The lock currently runs before mission dispatch, so an unrelated mission type touching that locked body can wait without requiring a proof of its own.
- `packages/contracts/src/VeydriftResourceReserves.sol:387-425,592-635`: planet/player pending checks, earliest pending arrival, due Outbound Attack/Harvest/MissileAttack predicate. These are pre-transaction logical guards, not an EVM timer.
- `packages/contracts/src/VeydriftStagedCombatModule.sol:75-258`: current staged phases consume the seed before roster enrollment; old math performs round-by-round attribution/application. A new proof handoff cannot reuse phase numbers as if they already represented AwaitingProof.
- `packages/contracts/src/VeydriftGameplayModule.sol:371-376` and `packages/contracts/src/RandomnessEngine.sol:234-321`: launch requests precommitted randomness, fulfiller can reveal before enrollment, owner can recover a stale commitment. New battle jobs must prohibit reroll/recovery and enforce the chosen reveal gate; current engine is not VRF.
- `packages/contracts/src/VeydriftGame.sol:950-990`: ordinary settlement versus capped passive collection.

## Outage assertions needed before activation

An unproved battle must remain pending, not time out into acceptance. Demonstrate repeated resolver calls make no duplicate credits/debits; competing valid submissions choose one result; interrupted preparation/application resumes; unrelated due Transport/Deploy/returns remain processable; dependent inventory waits until its earlier attack settles. Measure and surface the resulting broad player/planet locks honestly rather than claiming only enrolled units are unavailable. API/UI must not use a stale backend outcome to bypass these locks or require a player-funded settle merely to display authoritative totals.
