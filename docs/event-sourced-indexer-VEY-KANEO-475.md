# Event-sourced indexer: emit events for ALL state mutations (VEY-KANEO-475)

## Owner directive

Make the contract emit an event for **every** planet state mutation so the backend
indexer keeps its DB in sync **purely from events** (sequential, atomic) plus
downtime/missed-event reconciliation via `getLogs` — and **stop re-reading the contract
via RPC on the fly**. This is the foundation for EPIC VEY-KANEO-474 (thin frontend /
DB-only read path) and unblocks VEY-KANEO-473 (resources served from indexed state).
Nikita authorized upgrading the contract ("all contracts are upgradeable"); the on-chain
Base Sepolia proxy upgrade is run by OpenClaw (ProxyAdmin access) after review/merge.

Hard product constraints from the directive:

1. **Authoritative values, not deltas.** Each event carries the resulting authoritative
   value (or enough to derive it deterministically), so the indexer never needs to read
   the chain to learn the post-mutation balance.
2. **No duplicated / partial / overlapping events for one logical change.** Emit the
   *final* `{metal,crystal,deuterium,settledAt}` **once per tx per planet**, at the end,
   not a partial event per micro-mutation.
3. **Gas-reasonable**; index the fields the indexer filters on (`planetId` / `owner`).

## Why this is gated, like VEY-KANEO-468

The same two structural constraints that shaped the lazy-settlement epic shape this one:

- **EIP-170 bytecode budget.** `forge build --sizes` (this branch, base `5325be1`):

  | Contract | Runtime size | Headroom |
  | --- | --- | --- |
  | VeydriftCombatModule | 24,567 | **9** |
  | VeydriftPlanetManagementModule | 24,564 | **12** |
  | VeydriftGame (facade) | 24,526 | **50** |
  | VeydriftGameplayModule | 24,526 | **50** |
  | VeydriftColonizationModule | 24,145 | 431 |
  | VeydriftDefenseHoldModule | 16,372 | 8,204 |
  | VeydriftDefenseProductionModule | 14,851 | 9,725 |
  | VeydriftAttackProtectionModule | 8,943 | 15,633 |

  Four of the seven game modules are within **≤ 50 bytes** of the limit. New emit
  bytecode cannot be added to Combat / PlanetManagement / Gameplay / facade without first
  reclaiming space or routing the emit through a relief valve.

- **Delegatecall module architecture.** `VeydriftGame` is a Transparent proxy facade
  that delegatecalls module implementations. All modules inherit `VeydriftGameStorage`
  and share its storage layout, so an `internal` helper defined there is *emittable from
  every module* — but its body is **recompiled into each module that references it**
  (inherited `internal` ⇒ duplicated bytecode). That is exactly why the existing
  ship/defense count sink (`_writeUnitCount`, `VeydriftGameStorage.sol:726`) is a single
  compact assembly `LOG3` — "the event-emitting bytecode exists once per module rather
  than once per event … the headroom the size-critical combat module needs to stay within
  EIP-170."

### Bytecode relief valves available

1. **Inherited compact sink** — one `internal _emitPlanetSettled(planetId)` in
   `VeydriftGameStorage`; the `emit`/`LOG2` bytecode then exists once per *module*, and
   call sites are a cheap jump. This is the `_writeUnitCount` model applied to resources.
2. **Public delegatecall libraries.** `VeydriftRaidStorage.raid` is a `public` library
   function (`VeydriftRaidStorage.sol:25`, its own deployed 885-byte blob, 23.6 KB
   headroom). It runs under the combat module's storage via DELEGATECALL, so an
   `emit VeydriftGameStorage.PlanetSettled(...)` placed there costs the **library's**
   bytecode, **not combat's 9 bytes**. Combat's defender-loot resource mutation can be
   emitted for free this way by threading `planetId` into `raid`.
3. **Library extraction** to reclaim space in a full module (the codebase already does
   this with `VeydriftAntiRaidPrimitives` / `VeydriftDefenseHoldStorage`).

## Complete audit: planet state mutation → event

Legend: ✅ already emits a sufficient authoritative event · ❌ silent (indexer must RPC).

### Resources (`_planets[planetId].resources`, `Resources{uint128 metal,crystal,deuterium}`)

| # | Mutation site | File:line | Currently | Plan |
| --- | --- | --- | --- | --- |
| R1 | Production settle `_settleResourcesUntil` (writes `resources`, `lastSettledAt`) | VeydriftGame.sol:790; VeydriftGameplayModule.sol:608 | ❌ | emit final once at end of tx (see design) |
| R2 | Module settle wrappers `_settleResources` | VeydriftGame.sol:750; Gameplay:596; Colonization:602; DefenseProduction:261; DefenseHold:310; PlanetManagement:447 | ❌ | mark dirty; flush emits final |
| R3 | Cost debit `_spend` (build/ship/defense/research/fuel/cargo-out) | VeydriftGame.sol:850; Gameplay:652; Colonization:624; DefenseProduction:283; DefenseHold:354; PlanetManagement:469 | ❌ | mark dirty; flush emits final |
| R4 | Moon-system resource drain | VeydriftGame.sol:207 (`_spend`) | ❌ | covered by R3 |
| R5 | Transport cargo arrival credit | VeydriftGameplayModule.sol:525 | ❌ | mark dirty; flush emits final |
| R6 | Deploy cargo arrival credit | VeydriftGameplayModule.sol:530 | ❌ | mark dirty; flush emits final |
| R7 | Fleet return cargo credit `_landFleetReturn` | VeydriftPlanetManagementModule.sol:302 | ❌ (FleetMissionReturned only) | mark dirty; flush emits final |
| R8 | Market deposit credit | VeydriftPlanetManagementModule.sol:194 | ❌ (MarketResourceDeposited only) | mark dirty; flush emits final |
| R9 | Colony initial cargo | VeydriftColonizationModule.sol:457 | ❌ (ColonyCreated only) | emit final for new planet |
| R10 | Combat raid loot debit (defender) | VeydriftRaidStorage.sol:62-64 via VeydriftCombatModule.sol:1635 | ❌ (RaidLootResolved is the attack outcome, not the balance) | emit final from the library (free for combat) |
| R11 | Starting resources `_startPlanet` | VeydriftGame.sol:630/654 | ❌ (PlanetStarted/FirstPlanetSettled only) | emit final |
| R12 | Explicit collect `_collectPlanetResources` | VeydriftGame.sol:781 | ✅ `PlanetSettled` | keep (route through sink) |

### Ships / defenses

| # | Mutation | File:line | Currently |
| --- | --- | --- | --- |
| S1 | Any ship count change | `_setPlanetShipCount` sink, VeydriftGameStorage.sol:747 → `PlanetShipCountChanged` | ✅ authoritative absolute total |
| S2 | Any defense count change | `_setPlanetDefenseCount` sink, VeydriftGameStorage.sol:770 → `PlanetDefenseCountChanged` | ✅ authoritative absolute total |

### Queues / research / buildings / moon / alliance / missions

These already emit indexed lifecycle events the indexer consumes (`BuildingStarted/Completed`,
`ShipQueued/ShipCompleted`, `DefenseQueued/DefenseCompleted`, `ResearchQueued/ResearchCompleted`,
`FleetMission*`, `Moon*`, `Alliance*`, `DebrisFieldUpdated`, `MarketResourceWithdrawal*`).
They are in-scope for the audit table only to confirm sufficiency; no new events are required
for them beyond the resource balance that each *also* mutates (covered by R1–R12).

## Contract design — one authoritative resource event per tx per planet

`PlanetSettled(uint256 indexed planetId, uint128 metal, uint128 crystal, uint128 deuterium,
uint64 settledAt)` (VeydriftGameStorage.sol:379) is already the right shape and is already a
decoded, indexed event. Reuse it as **the** authoritative resource event; do not add a new one.

### Single inherited sink

Add to `VeydriftGameStorage`:

```solidity
function _emitPlanetSettled(uint256 planetId) internal {
    Resources storage r = _planets[planetId].resources;
    emit PlanetSettled(planetId, r.metal, r.crystal, r.deuterium, _planets[planetId].lastSettledAt);
}
```

The body compiles once per module; call sites are cheap. This makes the resource event a
single sink, mirroring `_setPlanetShipCount`.

### Final values, emitted at the terminal discrete mutation

The flow post-468 is *settle (produce) at the start → spend/credit later*. Production accrued by
elapsed time carries no discrete delta — the indexer **derives** it from the last emitted
`{balance, settledAt}` via the existing read-model projection. So the contract only needs to emit
when the balance changes by something other than passive time, and it emits the **full** authoritative
post-mutation balance at that mutation's **terminal** point:

- `_spend` emits after the debit (post-settle, post-spend = the final balance for a build/ship/
  defense/research/fuel spend tx).
- Each credit site (Transport/Deploy arrival, fleet return, market deposit, colony, starting balance)
  emits after the `_add` credit. PlanetManagement funnels its two credit paths through one
  `_creditResources` helper; Gameplay merges its Transport/Deploy branches to a single credit + emit.
- Combat loot emits from the `VeydriftRaidStorage` library after the raid debit.

Because every emit carries the **whole** balance (never a partial delta), an event is sufficient on
its own and the indexer applies it last-wins by `(blockNumber, logIndex)`. For the common
single-action tx this is exactly one emit per planet; the rare multi-mutation tx (e.g. combat settle
+ later same-planet action) emits a full snapshot at each terminal point and the latest wins — never
partial/overlapping. (A transient EIP-1153 dirty-flush to collapse those rare multi-emits to a single
end-of-tx event was evaluated but not needed: the terminal-mutation emit already yields one emit for
all real flows and the snapshots are non-overlapping.)

### Combat (9 bytes) — emit via the library

`VeydriftRaidStorage.raid` already runs in the combat storage context via delegatecall. Thread
`planetId` in and `emit VeydriftGameStorage.PlanetSettled(planetId, …final…)` there: the loot
debit is the *last* resource mutation of the defender in that path, so a single emit is final,
and it costs the library's bytecode, not combat's.

## Indexer design — serve from events, RPC only for downtime

`apps/backend/src/indexer.ts` already ingests events **sequentially and atomically**
(`applyLog` wraps event row + state mutation + `latestIndexedBlock` advance in one
transaction, indexer.ts:1235) and already has authoritative handlers for `PlanetSettled`
(`updatePlanetResources`, indexer.ts:2440), `PlanetShipCountChanged`, and
`PlanetDefenseCountChanged`. The work is to make those the **only** source of served state:

1. **Serve path** (`/wallet/:addr/{infrastructure,shipyard,defenses,research}`) currently
   reads `getInfrastructureState/getShipyardState/getDefenseState/getResearchState`, each of
   which RPC-calls `previewResources` (evm.ts:1608/1745/1837/1904) behind a 2 s cache
   (`CachedChainReader`). Re-point the resource fields of these responses at the indexed
   `contract_planet_resources` table; keep deterministic, non-resource fields (caps, rates)
   computed from already-indexed building levels.
2. **Remove the periodic RPC re-pin.** `refreshCanonicalState` → `readCanonicalState`
   (indexer.ts:1363/2128) sweeps every planet via RPC to overwrite `contract_*`. Demote it to
   **downtime / missed-event reconciliation only**: on boot/gap, `getLogs` from
   `latestIndexedBlock` and replay; never a serve-time or periodic full-RPC pin.
3. **Reads never trigger RPC.** After (1)+(2), a `contract_planet_resources` miss returns the
   last event state (or triggers a *bounded* getLogs backfill), not a live `previewResources`.

**The production projection already exists.** `readModels.ts` projects `resources` forward from
`lastSettledAt` at the current production rate (derived from indexed building levels) — see the
`SettlementIndexer` resource tests and the VEY-KANEO-429 regression. The indexer only fell back to
RPC because most discrete mutations never emitted `PlanetSettled`, so the stored snapshot drifted.
Once the contract emits on every discrete mutation, the existing snapshot+projection is authoritative
and the periodic RPC re-pin / serve-path reads become removable. This is the lever this task pulls.

### Proof (acceptance)

An indexer test that **replays a recorded event stream** (`PlanetSettled` + ship/defense +
queue events) and asserts the served resource/ship/defense state matches the on-chain
`previewResources`/`shipCount` for sample planets **without calling them at serve time**
(the faked `ChainReader` throws on `getInfrastructureState`/`previewResources` during serve). Landed
in this PR as `serves planet resources from a PlanetSettled event alone, never an on-the-fly RPC read
(VEY-KANEO-475)` (`apps/backend/src/indexer.test.ts`).

## Phased rollout (keeps the live game working at every step)

1. **Full contract coverage. — LANDED in this PR.** Added the `_emitPlanetSettled` sink in
   `VeydriftGameStorage` and emit the final post-mutation balance on **every** discrete resource
   mutation (R3–R11), across all modules:
   - Facade `VeydriftGame`: `_spend`, `_collectPlanetResources` (refactored through the sink),
     `_startPlanet`.
   - Colonization: `_spend`, colony creation.
   - DefenseProduction, DefenseHold: `_spend`.
   - Gameplay: `_spend` (fleet-launch), and a merged Transport/Deploy branch sharing one cargo credit
     + one `_emitPlanetSettled` (the dedup reclaimed the bytecode to fit the sink within EIP-170).
   - PlanetManagement: `_spend`, plus a shared `_creditResources` helper (market deposit + fleet
     return) so the `_add` + emit compiles once; fit by removing the proxy-unreachable `createColony`/
     `createColonyAtNextSlot` dead path (the facade exposes no such selector and has no fallback;
     colony creation runs through the fleet Colonize path in the colonization module).
   - **Combat loot via `VeydriftRaidStorage`** — the combat module has 9 B of headroom, so the
     defender's post-raid `PlanetSettled` is emitted from the already-linked library (delegatecall
     storage context), costing combat nothing.

   Production accrued purely by elapsed time (R1/R2) carries no discrete delta and is **not** emitted
   — it is derived by the read-model projection from the last emitted `{balance, settledAt}`. Every
   module re-measured under EIP-170 (tightest: PlanetManagement 1,611 B, Gameplay 33 B, facade 39 B
   of headroom); storage layout unchanged. Foundry tests per wired path + the indexer event-replay
   test.
2. **Indexer cutover (Phase 2) — LANDED in VEY-KANEO-476.** With full coverage, the indexer serves
   steady-state from event replay only. Serve-path resources already come from the snapshot+projection
   and serve-path `getInfrastructureState`/`previewResources` RPC was already removed (VEY-KANEO-461/
   464/465). This task removed the two remaining on-the-fly canonical RPC re-pins, so served state is
   now reconstructed from events alone:
   - Deleted `refreshCanonicalState`/`refreshCanonicalStateUncached` (the unscheduled periodic
     universe-wide RPC re-pin).
   - Removed the bounded per-planet combat reconcile (`reconcilePlanetState` +
     `drainFleetMissionReconcilePlanets` wiring in `server.ts`). It existed because combat could thin a
     defender's ships/defenses with no event; post-Phase-1 the contract emits `PlanetShipCountChanged`/
     `PlanetDefenseCountChanged` on every count change and `PlanetSettled` for loot, all applied
     directly, so the reconcile is redundant.
   - **Kept for downtime reconciliation only:** the cold-start/gap `rebuild`→`readCanonicalState` RPC
     pin and the manual `verifyCanonicalState` debug endpoint (`/debug/...verify`). These never run at
     serve time or on a periodic/steady-state timer.
   New acceptance test: `reconstructs a defender's combat ship/defense losses and loot from events
   alone, never an on-the-fly RPC read (VEY-KANEO-476)` — the faked `ChainReader` throws on every
   on-the-fly canonical read. The production projection already exists in `readModels.ts`, so this was a
   serve-path/reconcile rewire, not new derivation.
3. **Deploy + verify (OpenClaw).** ProxyAdmin upgrade via the existing `script/UpgradeGame.s.sol`
   (state preserved — no storage-layout change), backend redeploy, live smoke: mutate each path,
   advance a block, confirm `contract_planet_resources` matches on-chain `previewResources` with zero
   serve-time RPC, and confirm VEY-KANEO-473's build-revert / bar-vs-affordability bug no longer
   reproduces.

## Upgrade / migration

`VeydriftGame` is a Transparent proxy; moon/alliance are UUPS. Ship as in-place implementation
upgrades. **No storage-layout change**: the new events only read existing `_planets` storage and add
no state variables (verified — `VeydriftGame storage layout matches storage-layout/VeydriftGame.v1.json`).
Validate with the `packages/contracts/storage-layout`
snapshots and `scripts/veydrift-alpha-state-preservation-check.mjs`. The upgrade is executed by
OpenClaw via ProxyAdmin (note: `script/Upgrade.s.sol` has a known misleading revert; the proxy
*is* upgradeable and state is preserved).

## Acceptance-criteria mapping

| Criterion | Phase |
| --- | --- |
| Audit table mutation → event in the PR | this doc (Phase 1) |
| Every planet resource mutation emits a sufficient final event | 1 — LANDED (all modules) |
| No duplicated/partial event for one logical change (full balance, emitted at the terminal mutation) | 1 — LANDED |
| Indexer syncs from events only; serve-path / periodic / on-the-fly RPC re-pin removed | 2 — LANDED (VEY-KANEO-476) |
| Event-replay test matches `previewResources` without serve-time RPC | 1 — LANDED (`indexer.test.ts`) |
| Deployed (proxy upgrade + backend) and verified live; VEY-473 fixed | 3 (OpenClaw) |
