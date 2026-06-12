# Lazy on-chain reconciliation for all completions (VEY-KANEO-468)

## Owner directive

Make **all** completion lazy-settled **inside the smart contract** — the model
buildings/resources already use — for research, ship production, defense production, and
fleet missions (arrival / return / combat). No backend keeper submitting txs, no user
"Complete / finish / land" buttons. A single internal reconcile runs at the start of
every mutating call (including the counterparty's planet/player for cross-player actions).

This document is the implementation design for that epic. It exists because the change
cannot be a single edit: it is gated by two hard, independently-blocking constraints
(EIP-170 bytecode budget and asynchronous combat randomness) and is tightly coupled
across contract → backend keeper → frontend buttons → deploy. It quantifies both
constraints, specifies the reconcile, and lays out a phased rollout that keeps the live,
ERC-20-backed, upgradeable system safe at every step.

## Current state (what already auto-settles vs. what needs a finish tx)

| Subsystem | Scope | Auto-settles today? | Finish entrypoint |
| --- | --- | --- | --- |
| Resource production | planet | yes — `_settleResourcesUntil` | n/a |
| Building upgrade | planet | **yes** — folded into `_settleResourcesUpTo` → `_completeBuilding` (`VeydriftGame.sol:747-757`, `:804-814`) | `finishBuildingUpgrade` (`VeydriftGame.sol:126`) is now redundant |
| Research | **player** | no | `finishResearch()` msg.sender-gated (`VeydriftPlanetManagementModule.sol:263-272`) |
| Ship production | planet | no | `finishShipProduction(planetId)` owner-gated (`VeydriftColonizationModule.sol:98-106`) |
| Defense production | planet | no | `finishDefenseProduction(planetId)` owner-gated (`VeydriftDefenseProductionModule.sol:86-94`) |
| Fleet arrival (Transport/Deploy/Colonize) | planet | no | `resolveFleetMission` (per-module) |
| Fleet arrival (Attack/Harvest = combat) | planet + counterparty | no — needs randomness | `resolveFleetMission` → combat module |
| Fleet return | origin planet | no | `completeFleetMissionReturn(missionId)` (`VeydriftPlanetManagementModule.sol:214-231`) |

Reusable primitives already present:

- `_settleResourcesUpTo(planetId, ceiling)` / `_completeBuilding` — building auto-settle.
- `completeAttackTargetSnapshotQueues(planetId, cutoffAt)` — drains **ship** queues then
  delegates to drain **defense** queues up to a cutoff
  (`VeydriftColonizationModule.sol:108-113`, `VeydriftDefenseProductionModule.sol:96-100`).
  Today gated `msg.sender == address(this)` and used during attack resolution. This is the
  exact ship/defense drain a lazy reconcile needs — call it with `cutoffAt = block.timestamp`.
- Mission-resolution tracking by planet and player with idempotent add/remove
  (`VeydriftResourceReserves.sol:136-200, 367-411`), and `_earliestPendingMissionArrivalForPlanet`
  used by passive collection to settle production only up to (never across) an unresolved arrival.
- `_isPendingResolutionMission` (`VeydriftResourceReserves.sol:343-352`) currently makes
  Attack/Harvest arrivals **revert** mutating calls until an off-chain resolver catches up.
  The lazy design flips this from "revert" to "resolve, else skip".

## Blocking constraint 1 — EIP-170 bytecode budget

Measured with `forge build --sizes` on `01f8a69` (limit = 24,576 bytes runtime):

| Contract | Runtime size | Headroom |
| --- | --- | --- |
| VeydriftCombatModule | 24,567 | **9** |
| VeydriftGame (facade) | 24,522 | **54** |
| VeydriftGameplayModule | 24,449 | **127** |
| VeydriftPlanetManagementModule | 23,455 | 1,121 |
| VeydriftColonizationModule | 23,083 | 1,493 |
| VeydriftDefenseProductionModule | 14,499 | 10,077 |
| VeydriftDefenseHoldModule | 16,312 | 8,264 |

Implication: "call `_settleDue` at the start of **every** external mutating function across
all modules" cannot be added as new bytecode to the facade (54 B), combat (9 B), or gameplay
(127 B). Those three are full. The reconcile must be wired with a **net-neutral-or-negative**
bytecode strategy:

1. **Reclaim first.** Removing the now-redundant `finish*` dispatch + bodies frees real
   bytecode: facade `finishBuildingUpgrade` (has a body), and the thin facade delegators
   `finishResearch` / `finishShipProduction` / `finishDefenseProduction` /
   `finishMarketResourceWithdrawal` / `completeFleetMissionReturn` (each ≈ selector + dispatch
   + `_touchPlayer` + delegate). In the modules, the `finish*` bodies (`finishResearch`,
   `finishShipProduction`, `finishDefenseProduction`, `completeFleetMissionReturn`) can collapse
   into the shared reconcile, removing their per-function gating/branching.
2. **Spend through one shared sink, not per-call-site.** Add the reconcile as a single internal
   helper invoked from the already-present shared hooks rather than inlined at each entrypoint:
   - `_settleResources(planetId)` (the planet hook, already called by `_spend` and every
     start-action) gains the ship+defense drain via the existing `address(this)
     .completeAttackTargetSnapshotQueues(planetId, block.timestamp)` self-call. Each module's
     private `_settleResources` is one call site, so the cost lands once per module.
   - `_touchPlayer(player)` (the per-player hook in `VeydriftGameStorage`, called at the top of
     nearly every external entrypoint) gains the research drain. NOTE: `_touchPlayer` is shared
     base code inherited by every module **including combat (9 B)** — adding logic there will
     overflow combat. Instead, settle research from a facade/module-level helper that combat
     never references, or guard the combat module out of the inheritance path. Measure each step.
3. **Re-measure after every edit.** Treat the three full contracts as a fixed budget; if a wiring
   step pushes any over 24,576, reclaim more `finish*`/dead code or move logic into a library
   (delegatecalled libs like `VeydriftAntiRaidPrimitives` / `VeydriftDefenseHoldStorage` are how
   this codebase has bought headroom before).

## Blocking constraint 2 — asynchronous combat randomness

Attack/Harvest combat is **not** synchronously resolvable inside an arbitrary mutating call:

- At launch the caller passes `randomnessRequestId`; the contract records it and, for Attack,
  calls `IVeydriftAttackRandomnessEngine.requestRandomness` (`VeydriftGameplayModule.sol:434-439`).
- Randomness is fulfilled **asynchronously by a separate backend service** —
  `RandomnessCommitterService` (`apps/backend/src/randomnessCommitter.ts`), which is **not** the
  keeper this ticket removes.
- At resolution, the combat module reads the random word via a **staticcall**
  `consumeRandomness(requestId, purposeHash)` (`VeydriftCombatModule.sol` `_battleSeed` /
  `_consumeAttackBattleRandomness`). If randomness is not yet committed, that staticcall reverts.

Therefore a lazy reconcile that resolves combat must:

1. **Not revert the caller** when an Attack/Harvest arrival is due but randomness is not yet
   available. Wrap the resolution in `try { engine.consumeRandomness(...) } catch { skip }`
   (an external call, so try/catch is available) — or add an `isFulfilled(requestId)` view to the
   randomness engine and branch on it. When unavailable, settle the involved planets' resources
   only up to `arrivalAt` (today's passive-collection behavior) and leave the mission pending; the
   next mutating call after the committer fulfills will resolve it.
2. **Flip `_isPendingResolutionMission`** from a revert-gate into a "resolve due missions here"
   step inside the reconcile, preserving the invariant that production never settles **across** an
   unresolved arrival (combat/loot snapshots are taken at `arrivalAt`).

Non-combat arrivals (Transport, Deploy, Colonize) and **all** returns are deterministic and can be
resolved synchronously in the reconcile with no randomness dependency.

## Reconcile design

Two idempotent, bounded-gas internal helpers:

```
_settlePlayerDue(player):
  # research is player-scoped, single queue, no backlog
  q = researchQueues[player]
  if q.active and block.timestamp >= q.readyAt:
      apply level; delete queue; emit ResearchCompleted   # body of today's finishResearch

_settleDue(planetId):
  _settleResourcesUpTo(planetId, block.timestamp)          # production + building (existing)
  completeAttackTargetSnapshotQueues(planetId, block.timestamp)   # ship then defense drain (existing)
  for missionId in due-arrivals(planetId):                 # Transport/Deploy/Colonize sync;
      resolve(missionId)                                   #   Attack/Harvest only if randomness ready
  for missionId in due-returns(originPlanetId == planetId):
      completeReturn(missionId)                            # body of completeFleetMissionReturn
```

Wiring (after bytecode reclamation):

- Every external mutating function calls `_settlePlayerDue(msg.sender)` and `_settleDue(planetId)`
  for the planet(s) it touches — implemented via the two shared hooks (`_touchPlayer`,
  `_settleResources`) rather than inlined per function, to stay within budget.
- **Cross-player**: attack / join-attack / combat / ACS / any mission targeting another planet must
  `_settleDue(targetPlanetId)` and `_settlePlayerDue(targetOwner)` **before** resolving, so the
  defender's due completions (defense production finishing, returns landing) apply first. The
  tracking in `_trackMissionResolution` already records both origin and target planet/owner, so the
  counterparty set is already known.

Gas bounds: each drain loop advances one queue/backlog entry per iteration and one mission per
iteration. Backlogs are player-built and already bounded by start-time gas; the loops terminate at
the first not-yet-ready entry. Keep the existing pattern (no unbounded external growth). If deep
backlogs are a concern, cap iterations per call and let the remainder settle on the next call —
idempotency makes this safe.

## Backend

- **Remove** the 30 s keeper `MissionResolutionService` (`apps/backend/src/missionResolution.ts`)
  and its wiring in `server.ts` (import, construction in `createRequestHandler`, `.start()`), plus
  `missionResolution.test.ts`. It submits `resolveFleetMission` (arrival leg) and
  `completeFleetMissionReturn` (return leg) from `config.missionResolverAddress`. These are the
  only backend-initiated completion txs; nothing else sends `finish*`/`resolve*`. **Coupled:** do
  not remove until the contract resolves fleets lazily, or missions never resolve.
- **Keep** `RandomnessCommitterService` (`randomnessCommitter.ts`) — it is the VRF source combat
  depends on, not a completion keeper.
- **As-of-now reads are already in place** (VEY-KANEO-464): `withQueueAsOfNow` wraps every queue
  read (`indexer.ts:1052/1056/1060`) and `withMissionAsOfNow` wraps every fleet read via
  `withFleetMissionPlanetReferences` (`indexer.ts:744/803/818/826/3396`). Remaining gap to close
  for "return data as if the past already happened": `withQueueAsOfNow` only flags the **active**
  item `complete` (`asOfNow.ts:25-39`); it does not advance the **derived level/count** of a
  completed-but-unsettled queue or pop the backlog. Extend the read model so a research/ship/defense
  queue whose `readyAt` has elapsed surfaces the post-completion level/count (and the next backlog
  item as active) without waiting for the on-chain `*Completed` event. This is latent today (the
  keeper guarantees the event fires) and becomes load-bearing once settlement is lazy.

## Frontend

Remove every manual Complete/finish/land control (UI shows backend state only). The "Land fleet"
button is already gone (`MissionControlPage.tsx:588`). Remove, with their handlers and
`walletFlow.ts` senders:

| Control | Component | Handler (`PlayableMvpApp.tsx`) | `walletFlow.ts` sender |
| --- | --- | --- | --- |
| Building finish | `OverviewPage.tsx:1009`, `InfrastructurePage.tsx:172/469` | `handleFinishBuildingUpgrade` | `sendFinishBuildingUpgradeTransaction:2117` |
| Defense finish | `OverviewPage.tsx:1052` | `handleFinishDefenseProduction` | `sendFinishDefenseProductionTransaction:2228` |
| Shipyard finish | `OverviewPage.tsx:1071` | `handleFinishShipProduction` | `sendFinishShipProductionTransaction:2215` |
| Research finish | `OverviewPage.tsx:1092` | `handleFinishResearch` | `sendFinishResearchTransaction:2203` |
| Moon building finish | `MoonPage.tsx:212` | `handleFinishMoonBuilding` | `sendFinishMoonBuildingUpgradeTransaction:2154` |
| Rift withdrawal finish | `RiftPage.tsx:238` | `handleFinishRiftWithdrawal` | `sendFinishResourceWithdrawalTransaction:1859` |

After removal each component renders queue/mission state from its existing backend hook
(`onChainQueues.{building,defense,ship,research}`, `moonState.queue`, `riftState.pendingWithdrawals`)
using the `asOfNow` flags, showing progress/ready badges instead of buttons. Keep non-completion
actions (Start, Recall/cancel, Collect resources). NOTE: the moon system is its own contract
(UUPS) and the rift withdrawal is a timed unlock — confirm whether the directive's "all completions"
includes the moon-building queue and rift withdrawal in the in-contract reconcile, or whether those
stay timed/manual; they are listed here because their finish buttons exist, but they are separate
contracts from `VeydriftGame`.

## Upgrade / migration

- `VeydriftGame` is a Transparent proxy; moon/alliance are UUPS. Ship as in-place implementation
  upgrades; **no storage-layout changes** — the reconcile reuses existing mappings
  (`researchQueues`, `shipQueues`/backlogs, `defenseQueues`/backlogs, `buildingConstructions`,
  `_fleetMissions`, resolution-tracking maps). Validate with the existing
  `packages/contracts/storage-layout` snapshots and `scripts/veydrift-alpha-state-preservation-check.mjs`.
- Removing `finish*` from the ABI is a breaking interface change; it is safe only once the frontend
  callers and the backend keeper are removed in the same release train.

## Phased rollout (keeps the live game working at every step)

1. **Deterministic lazy-settle (no fleets).** Reclaim `finish*` bytecode; add `_settleDue` ship+defense
   drain via `_settleResources` and research drain via `_settlePlayerDue`; keep `finish*` as thin
   wrappers that just trigger the reconcile (back-compat). Foundry tests: no finish tx, a later
   mutating call applies due research/ship/defense/building. Keeper + fleet flow untouched.
   **Status — landed (broad coverage).** The reconcile is consolidated into the colonization
   `completeAttackTargetSnapshotQueues` fan-out (research + ship there, defense via its delegate), so
   the bodies live once and every caller pays only a cheap self-call (`_settleDuePlanet`). Research
   settling takes a `cutoffAt`, so an attack's impact-time snapshot also settles the **defender's**
   by-impact research before combat reads tech levels (cross-player counterparty reconcile). The
   self-call is wired into `_settleResources` of the colonization, defense-production, planet-management,
   defense-hold, **and gameplay** modules, plus the **facade** `_settleResources`. So every spend/start
   path — start ship/defense/research, colony ops, defense-hold, fleet launch/recall, building start,
   `_spend`, moon-spend — now settles due research + ship + defense for the planet/owner with no finish
   tx; building already auto-settled. To fit the facade in EIP-170 the now-redundant
   `finishBuildingUpgrade` became a thin reconcile wrapper (no longer reverts before `readyAt`).
   Combat (9 B free) is intentionally untouched. **Remaining gap:** the pure passive-collect path
   (`collectResources` / `settlePlanet` via `_collectPlanetResources`) still settles only resources +
   building, not the unit/research queues — acceptable because the owner's next spend/start settles
   them and reads already show them as-of-now. Foundry: `testMutatingCallSettlesDueShipAndDefense-
   WithoutFinishTx`, `testMutatingCallSettlesDueResearchWithoutFinishTx`,
   `testLazySettleDrainsFullProductionBacklogAndIsIdempotent`, `testAttackImpactSettlesDefenderDue-
   Research`; suite green (261); storage layout unchanged; the `finish*` family is no longer required
   for completion (`finishBuildingUpgrade` is now a thin wrapper; research/ship/defense `finish*`
   remain as working back-compat).
2. **Fleet lazy-settle.** Flip `_isPendingResolutionMission` to resolve-in-reconcile; resolve
   Transport/Deploy/Colonize + all returns synchronously; resolve Attack/Harvest with try/catch on
   randomness (skip when uncommitted). Cross-player counterparty reconcile. Foundry tests incl. the
   cross-player attack ordering and the randomness-not-ready skip path.
3. **Remove keeper.** Delete `MissionResolutionService` + wiring + test. Extend read-model
   level/count derivation. Backend tests.
4. **Remove frontend buttons.** Per the table above; UI renders from `asOfNow`.
5. **Deploy + verify.** Proxy upgrades (state preserved), backend + frontend deploy, live smoke:
   start each queue/mission, advance time, perform an unrelated mutating call, confirm completion
   applied with zero finish/keeper txs.

## Acceptance-criteria mapping

| Criterion | Phase |
| --- | --- |
| No finish tx → subsequent mutating call settles research/ship/defense/building | 1 |
| No finish tx → subsequent mutating call settles fleets | 2 |
| Cross-player attack settles defender's due items first; gas bounded; existing tests pass | 2 |
| Backend: no keeper, no backend-sent txs; reads show due completions as applied | 3 |
| Frontend: zero complete/finish/land buttons; UI reflects backend as-of-now state | 4 |
| Deployed (proxy upgrade + backend + frontend) and verified live | 5 |
