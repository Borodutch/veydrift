# Trusted battle referee (ticket #44)

Attack battles launched while the referee is active (combat model 3) are fought with OGame's
combat rules ([battle-referee-rules.md](battle-referee-rules.md)) off-chain by a trusted resolver.
The chain freezes the battle's inputs and seed first, accepts exactly one result from the
configured resolver, and applies casualties with the existing settlement code. Owner decision
2026-10-10: a trusted referee is acceptable for now; the earlier ZK proof plan is retired.

## Trust model

- The resolver key can submit any result for a battle awaiting one. It cannot pick the inputs or
  the seed, cannot submit twice (only the owner can reset an unapplied result), cannot touch other
  battles or anything else, and the contract rejects results that do not match the journaled
  roster (counts, owners, units, survivor totals).
- Every result is auditable: the roster is in `RefereeBattle*` events and `refereeBattleRecord`,
  the seed is the revealed randomness word, and the committed `reportHash` covers the full
  per-round report. Anyone can replay `packages/battle-oracle` and compare.
- If the resolver is down, battles stay pending (phase 17). Nothing times out into a result.
  Unrelated missions keep resolving; later missions on the same body wait as they do today.
  While a battle holds the body lock, every pending-resolution guard on that planet (and its moon)
  reverts, so enrolled resident, moon and stationed fleets cannot leave after the roster is sealed.

## Lifecycle

| Staged phase | Referee phase | What happens | Who |
|---|---|---|---|
| 0, 14, 15 | Preparing | Protection (launch-time verdict), production cutoff (same as staged combat) | any resolver |
| 1–5 | Preparing | `begin` reserves the gated randomness request, then journal resident lanes, leader, ACS joins, stationed holds (`RefereeBattleRow`, `CombatMemberSnapshot`) | any resolver |
| 16 | AwaitingRandomness | Snapshot sealed into the randomness request; the fulfiller may now reveal | fulfiller |
| 17 | AwaitingResult | Seed consumed; `battleResultBinding` available | referee (`resolveFleetMission`) |
| 17 | Applying | `submitBattleResult` froze root/totals/rounds/report hash | referee |
| 11–13 | Economics | Loot, debris, repairs, moon chance, returns (existing staged code) | any resolver |

Launching a referee battle only freezes its rules; it reserves no FIFO commitment. The gated
request is made at `begin` (end of phase 1) and needs a ready precommitted word: with an empty FIFO
the battle waits in phase 1 (`resolveFleetMission` reverts with the engine's
`NoRandomnessCommitment`/`RandomnessCommitmentNotActive`). Protected targets, missing moons and
abandoned targets are `Bypassed` before `begin`, return without a reveal and never request
randomness; recalled attacks never request it either. Battles launched before activation, and
every non-Attack mission, never enter this path.

Score protection is decided at launch: the battle keeps the verdict recorded by the launch
(admitted normally, or only through the target's live Rift lock), so in-flight score changes
cannot block or unblock it. Same-alliance, missing moon and missing defender still block at
preparation.

## Contract API (Game proxy fallback → StateMigration → CombatRaid → RefereeSettlement)

- `configureBattleReferee((uint32 version, bytes32 rules, bytes32 catalog), address resolver)` —
  owner only. Version 0 stops new referee launches; launched battles keep their frozen rules.
  `combatModelVersion()` returns 3 while a version is set.
- `refereeBattleRecord(id, kind, index)` — kind 0 status, 1 header, 2 row, 3 source mission,
  4 `(prospective version, resolver)`, 5 `(engine, requestId, purpose)`. `requestId` is 0 until
  preparation reaches `begin`; from then on `fleetMission(id).randomnessRequestId` matches it
  (`FleetMissionLaunched` and `RefereeBattleLaunched` carry 0 for referee battles).
- `battleResultBinding(id)` — leaf-hash binding once the seed is consumed.
- `submitBattleResult(id, root, totals[2], reportHash, RoundSummary[])` — resolver only, once.
  Emits `BattleResultSubmitted` and one standard `CombatRoundResolved` per round.
- `applyBattleResultLeaves(id, Leaf[])` — permissionless, ≤32 leaves per transaction, leaf *i*
  must equal journal row *i*; only `lost` comes from the referee. Losses debit current inventory,
  floored at zero like staged combat, so inventory drift can never deadlock application.
- `battleResultProgress(id)`, `battleResultSummary(id)` — views.
- `resetBattleResult(id)` — owner only (same check as `configureBattleReferee`), while the result
  is accepted but no leaf is applied yet. Discards it (`BattleResultReset`); the battle is back to
  awaiting a result, so the (possibly rotated) resolver can submit again.
- `voidRefereeBattle(id)` — owner only, while awaiting the reveal (phase 16), awaiting a result or
  with an accepted but unapplied result (phase 17). Ends the battle with no fight
  (`RefereeBattleVoided`, kind 0 phase becomes `Bypassed`): no casualties, loot, debris, moon
  chance or repairs; fleets return and stationed holds stay, exactly like a protected battle. The
  ordinary permissionless `resolveFleetMission` then runs phases 11–13, which release the body
  lock and the moon freeze. Use it for a lost randomness secret or a roster the backend cannot
  replay.

Leaf hash: `keccak256(abi.encode(keccak256("veydrift.referee-battle.result-leaf.v1"), binding, index,
owner, source, side, unit, enrolledCount, lost, survivors, next))`, chained from the tail
`keccak256(abi.encode(keccak256("veydrift.referee-battle.result-tail.v1"), binding, rowCount))`.
The RandomnessEngine snapshot gate is described in [battle-randomness-gate.md](battle-randomness-gate.md).

## Backend

`BattleRefereeService` runs on the writer worker when `VEYDRIFT_BATTLE_REFEREE_PRIVATE_KEY` is set:
discover `RefereeBattleSealed` logs, wait for the reveal, advance to 17, replay, store the report,
submit, then apply leaves in batches of 32. Its transactions go through the shared resolver
coordinator, so the key may be the randomness fulfiller's. Status is `battleReferee` in `/health`.

| Variable | Meaning |
|---|---|
| `VEYDRIFT_BATTLE_REFEREE_PRIVATE_KEY` | Resolver key configured onchain (needs Base ETH) |
| `VEYDRIFT_BATTLE_REFEREE_STORE_PATH` | Report store (default `battle-referee.sqlite` next to the index DB) |
| `VEYDRIFT_BATTLE_REFEREE_FROM_BLOCK` | Optional first discovery block (default: latest at first start) |

Reports: `GET /battle-reports/:hash` or `GET /battles/:id/report` returns the exact bytes whose
keccak256 is the onchain `reportHash` (also in `x-veydrift-report-hash`). The randomness fulfiller
skips gated requests until their snapshot is sealed; the keeper and both backend resolver paths
never pay for phase 16/17 attempts.

## Audit a result

1. Read `refereeBattleRecord` kinds 0, 2 (every row) and 5, and `battleResultBinding`.
2. Fetch the report by the onchain hash and check its keccak256.
3. Replay with `packages/battle-oracle` (`refereeBattle` in `apps/backend/src/battleReferee.ts`
   shows the exact mapping) and compare root, totals and per-row losses.

## Release order

Merging to `main` autodeploys the backend and frontend (Easypanel builds `main`), and this release
also changes unit costs, cargo and fuel, which the frontend must match. So the contracts go first,
from the pushed release commit, and the merge follows:

1. Push the branch (no merge) and let CI pass.
2. Upgrade from that commit, referee still off (new attacks stay model 2):
   `UpgradeRandomnessEngine` (engine owner), `UpgradeGame` (game owner), `UpgradeMoonSystem`
   (moon owner), `UpgradeAllianceSystem` with `KEEP_PAID_ALLIANCE_INVITE_SYSTEM=true` (alliance
   owner). Rehearse each keylessly first (`UPGRADE_DRY_RUN_OWNER`, no `--broadcast`).
3. Set `VEYDRIFT_BATTLE_REFEREE_PRIVATE_KEY` on the backend service.
4. Merge: the backend and frontend deploy against the upgraded contracts. Until this deploy the
   old frontend shows the previous costs, cargo and fuel, so run steps 2-4 back to back.
5. Activate: `ConfigureBattleReferee` with `BATTLE_REFEREE_ADDRESS` (game owner).
6. Smoke, then QA a live attack end to end.

Rollback: `ConfigureBattleReferee` with `BATTLE_REFEREE_VERSION=0` returns new launches to model 2.
The resolver is kept (the contract refuses a zero resolver), because battles already launched as
referee battles still need it to finish.

## Known limits

- A battle the backend cannot replay stays pending with its body lock held until the owner voids
  it: more than 5,000,000 expanded units, or rules/catalog hashes this backend build does not
  carry. Any rules change must therefore keep the previous rules in the backend until every
  battle launched under them settles.
- A battle whose result leaves were partially applied can be neither reset nor voided; fixing it
  needs a contract upgrade.
- `resetBattleResult` cannot unlog the discarded result: its `BattleResultSubmitted` and
  `CombatRoundResolved` events stay, and the resubmission emits a second set. Readers must use the
  latest submission for a battle. A voided battle's request stays unconsumed in the engine.
- Forecasts use the currently active model; joining a battle launched under the other model shows
  that model's estimate. Model-3 forecasts are time-boxed (fewer samples on slow devices) and are
  unavailable above 1,000,000 expanded units.
- The battle calculator samples with the referee's exact SHA-256 draws (each run is the referee's
  replay of its seed; at least 300 runs, or a visible note when a huge battle hits the time limit).
  Mission forecasts keep a fast seeded draw source with the same rules, because several can run at
  once on a phone; their averages stay within about 1–3% of exact sampling. Defense counts left
  after a battle include the 70% repair; debris comes from destroyed ships only.

## Rules verification

- The shield model reproduces all 41 real OGame combat-report data points
  (`packages/battle-oracle/fixtures/real-shield-reports.json`).
- 863 real Veydrift battles (every fought Attack in blocks 51,103,397–52,441,739) were simulated
  500 times with the referee engine and 1,000 times each with TrashSim
  (klaasvp/trashsim-public @6358da5, MIT) patched to the same rules (an independent
  implementation) and with stock TrashSim. A metric (win/draw/loss odds, survivors per side and
  per unit type, rounds, debris) is flagged at |z| > 5.

| | vs TrashSim, same rules | vs stock TrashSim |
|---|---|---|
| Battles with any significant difference | **0 / 863** | 46 / 863 (overlapping: 32 round count, 14 side survivors, 17 unit types, 11 debris, 4 outcome odds) |
| Same most likely outcome | 860 / 863 (the rest are coin flips near 50%) | 860 / 863 |
| Per-battle survivor z-scores, mean / sd | 0.09 / 0.97 (pure sampling noise) | 0.46 / 3.83 |

Stock TrashSim differs only through the artifacts the real reports rule out: it floors shields,
carries overflow into the next hit, and marks a broken shield as −1, so every later hit deals +1.
In battle 98859 (one Light Fighter against 31 Solar Satellites, two Large Cargo and a Recycler)
that +1 doubles the satellites' damage: stock TrashSim always destroys the fighter, while under
the real rules it survives about half the time.

Against the current onchain model 2, 105 of the 863 historical results differ from the referee's
most likely outcome (47 draw → defender win, 36 attacker win → draw, 13 draw → attacker win,
9 attacker win → defender win).

## Verification

- `forge test --match-path 'test/{VeydriftRefereeBattle,VeydriftRefereeSettlement,RandomnessEngineBattleGate}.t.sol'`
- `bun test apps/backend/src/battleReferee.test.ts packages/battle-oracle`
- Anvil end to end (real proxy, real backend client, ACS + alliance defender + defenses):
  `cd packages/contracts && VEY44_EXPORT_FIXTURE=true forge test --match-test testExportRefereeFixture`
  then `bun scripts/battle-referee-anvil-proof.ts` (also run by the contract gate).
