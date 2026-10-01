# @veydrift/battle-keeper

A focused, **event-driven keeper** that resolves on-chain fleet missions promptly — **every mission
type, both legs (arrival and return)**. Progress still depends on RPC access, signer funding,
contract preconditions and healthy randomness fulfillment where required.

## Why this exists

The contracts expose lazy settlement paths and explicit permissionless mission entrypoints.
This service watches launched missions and attempts the appropriate entrypoint when each leg is
due. A read-only API request does not send a settlement transaction, and a state touch is not a
guarantee that every due mission or randomness-dependent battle has completed.

It is intentionally a **separate web service** (not the backend), so resolution is isolated from the
indexer/API and can be deployed on a host with approved RPC access. The backend also has a
`MissionResolutionService`; choose the deployed resolver topology deliberately. Never share the
standalone keeper's signing EOA with another independent writer: this service does not participate
in the backend's durable nonce coordinator. See [Backend and indexer](../../docs/backend-indexer.md).

## What it does

Each mission is a small **two-leg state machine**:

```
awaiting-arrival --resolveFleetMission(0xde09e7cf)--> { awaiting-return | terminal }
awaiting-return  --completeFleetMissionReturn(0xc2472852)--> terminal
```

- **WebSocket-subscribes** to the game contract's fleet-mission events:
  - `FleetMissionLaunched` (carries `arrivalAt` **and** `returnAt`) → record **every** outbound
    mission type in the **awaiting-arrival** leg.
  - `FleetMissionResolved` (carries `missionType` + the possibly-updated `returnAt`) → the arrival
    leg is done. If the mission type can safely infer a return and `returnAt > 0`, transition to
    **awaiting-return** with that time; otherwise the mission is **terminal**. Deploy and successful
    Colonize are terminal at arrival even when the event carries a nonzero stored `returnAt`.
  - `FleetMissionReturnExposed` → authoritative signal that a mission actually entered a return leg;
    this is what queues blocked Colonize returns and any other return that cannot be inferred from
    `FleetMissionResolved.returnAt` alone.
  - `DefenseHoldStationed` → carries the DefenseHold `holdUntil` timestamp. DefenseHold cannot be
    sent home at travel arrival; the keeper waits until the hold window ends before resolving it.
  - `FleetMissionReturned` → the return leg is done; the mission is **terminal**.
- **Resolution loop** (every `RESOLVE_INTERVAL_MS`): for each pending mission whose current leg is due
  (`dueAt <= now`), submit the leg's call — `resolveFleetMission(missionId)` for arrival,
  `completeFleetMissionReturn(missionId)` for return — as a **signed raw transaction**
  (`eth_sendRawTransaction`) from `KEEPER_PRIVATE_KEY`. Both calls are **permissionless** — any funded
  EOA can resolve. Each submission is simulated with `eth_call` first, so a leg that isn't resolvable
  yet (arrival: randomness not committed; return: not yet due / wrong status) reverts during
  simulation and is **retried on the next tick** without burning a nonce or crashing. Due legs are
  dispatched by scheduled `dueAt` across both legs; equal timestamps use arrival before return,
  then numeric mission ID. Submission remains serial for nonce safety. This priority is not a
  consensus guarantee: the contract enforces chronology for missions launched after its upgrade,
  including reverse-ordered submissions by permissionless resolvers. Legacy/new interactions retain
  the accepted temporary ordering limitation; the keeper does not infer mission generations.
  `fleetMissionEligibility` confirms ordering support immediately for both generations, without
  historical sync or backfill. Funded workers may advance bounded scans while strict UI eligibility
  is false, but must still simulate the exact arrival/return call before submitting.
- **Safety sweep** (every `SWEEP_INTERVAL_MS`): backfills recent fleet-mission logs over `eth_getLogs`
  to recover **both legs** — a missed launch re-queues the arrival, a missed `FleetMissionResolved`
  drops terminal arrivals, a missed `FleetMissionReturnExposed` transitions to the return leg, and a
  missed `FleetMissionReturned` drops it. After replaying logs, the sweep reads current
  `fleetMission()` status for pending ids and prunes stale terminal entries
  (`None`/`Resolved`/`Returned`) or corrects legs that no longer match on-chain state, then
  re-attempts due legs.
- **In-process deduplication**: an in-flight submission prevents another attempt for that leg;
  tracked terminal missions are not re-queued. After each successful receipt we read canonical
  mission status: progress-only receipts retain the pending leg, and only a canonical transition
  advances it (the matching event refines the authoritative `returnAt`).
- Auto-reconnects the WebSocket with capped exponential backoff, serializes transaction submission,
  and emits structured logs. Monitor retry backlogs and health; these mechanisms do not guarantee
  liveness during RPC, signer, or oracle failures.

### Scope decision

The keeper **only resolves** — it does not commit randomness; `RandomnessCommitterService` stays in
the backend. If the keeper is down, inspect due missions and other resolver coverage rather than
assuming passive reads will finish them. Any mission type that emits no `FleetMissionLaunched`
(i.e. has no resolvable arrival) is simply never tracked.

## Endpoints

- `GET /health` — `200` when the WS feed is connected, `503` only when liveness is degraded. Body
  includes build identity (`build.gitSha` when `GIT_SHA` or provider commit env is set), `pendingCount`,
  `healthWarnings`, `lastResolvedMissionId`, `lastResolvedAt`, `lastError`, full keeper + sweep + ws
  snapshots, and `uptimeSeconds`. A live keeper with a stale due retry backlog reports
  `status: "degraded"` and `healthWarnings: ["stale_due_retry_backlog"]` while keeping HTTP 200 so the
  process is visible instead of restarted blindly.
- `GET /` — same payload.

## Configuration (env)

| Var                     | Required | Default | Description                                                        |
| ----------------------- | -------- | ------- | ------------------------------------------------------------------ |
| `RPC_URL`               | yes      | —       | HTTP JSON-RPC endpoint (reads, simulate, broadcast).               |
| `RPC_FALLBACK_URLS`     | no       | —       | Comma-separated HTTP RPC fallbacks used when the primary is denied, rate-limited, or unhealthy. |
| `WS_RPC_URL`            | yes      | —       | WebSocket JSON-RPC endpoint (event subscription).                  |
| `GAME_CONTRACT_ADDRESS` | yes      | —       | VeydriftGame proxy address (the battle event emitter).             |
| `KEEPER_PRIVATE_KEY`    | yes      | —       | 0x-prefixed 32-byte key of a **funded** EOA that pays for resolves.|
| `CHAIN_ID`              | no       | `84532` | EVM chain id (Base Sepolia by default).                            |
| `RESOLVE_INTERVAL_MS`   | no       | `2000`  | Resolution loop cadence.                                           |
| `SWEEP_INTERVAL_MS`     | no       | `10000` | Backstop log-backfill sweep cadence.                               |
| `BACKFILL_BLOCKS`       | no       | `90000` | Startup recent-backfill accelerator; durable historical discovery is independent of this window. |
| `KEEPER_STATE_PATH` | no | `/data/battle-keeper/state.sqlite` | SQLite WAL journal; mount its parent directory on the managed persistent volume. |
| `GAME_DEPLOYMENT_BLOCK` | no | `0` | Earliest Game proxy deployment block for first-time historical discovery. Zero safely scans from genesis; never set later than its first mission. |
| `PORT`                  | no       | `8080`  | HTTP health/status port.                                           |
| `MAX_CONCURRENCY`       | no       | `1`     | Submission concurrency; currently clamped to 1 to avoid signer nonce races. |
| `GIT_SHA`               | no       | —       | Deployed commit surfaced in `/health` as `build.gitSha`.           |

**Never commit secrets.** `KEEPER_PRIVATE_KEY` must come from the deploy environment.

## Run locally

First configure the variables above through an ignored environment file or approved secret
injection. Verify `CHAIN_ID`, both RPC endpoints and the deployed game address; the Sepolia default
is not an environment check. A local keeper targeting mainnet sends real transactions. Do not copy
production signing keys to a laptop for frontend testing.

From the repository root, with the verified environment loaded and explicit intent to sign:

```sh
bun run dev:keeper
```

Type-check and test:

```bash
bun run check:keeper
bun run test:keeper
```

## EasyPanel deploy recipe

1. Follow [Application deployment](../../docs/deployment.md) and verify the intended managed service
   and resolver topology before creating or changing anything.
2. Use the monorepo root as build context and explicitly select
   [nixpacks.toml](nixpacks.toml); a nested file is not selected merely by setting the root context.
3. Configure the verified chain ID, deployed game address, approved HTTP/WS endpoints and dedicated
   funded signer through the deployment environment. Confirm network access without widening public
   RPC exposure. Keep the key secret and avoid overlapping independent writers for that EOA.
4. Mount a persistent Easypanel volume at `/data/battle-keeper` (or the configured state path
   parent) before starting this version. Keep the SQLite file **and its WAL/SHM siblings together**.
   Use one stop-first keeper replica and a dedicated signer; do not share the journal between
   independent keeper writers. Set the verified original Game proxy deployment block to speed
   first boot; leaving it at zero is safe. No storage/service mutation is performed by this code.
5. Check `GET /health` on the configured port, build identity, due backlog, receipts and gas funding.
   HTTP 200 alone does not prove the mission backlog is healthy.


### Staged combat settlement

Attack/ACS and missile arrival receipts are not completion signals. The keeper reads
`fleetMission` after each receipt and retains `Outbound` arrivals for the next tick;
only canonical returning/terminal status advances the leg. Missing/failed status
reads fail closed. Gas-checkpointed arrivals receive a 15,000,000-gas transaction
budget, below Base's [16,777,216 per-transaction maximum](https://docs.base.org/specifications/transactions/troubleshooting-transactions).
Both the estimate and initial simulation are bounded by this ceiling; the exact
chosen gas/fee/nonce envelope is simulated again before signing. Return estimates
retain buffered gas, capped at the same ceiling and re-simulated. This ceiling is
an envelope bound, not proof that any particular contract stage makes progress.
After exact-envelope preflight, the keeper signs locally and persists the raw transaction,
its deterministic hash/nonce, and the progress checkpoint in SQLite **before broadcasting**.
Restart first reconciles the canonical receipt or re-simulates and rebroadcasts identical signed bytes;
unknown sends never allocate a second nonce. A crash before signed persistence can safely
retry preparation. Fee/funds/pre-sign rejection does not consume a progress checkpoint.
Other jobs cannot reuse a nonce owned by an unresolved durable envelope.

Only a canonical paid receipt (success **or revert**) consumes the checkpoint. An unchanged successful
receipt therefore suppresses further paid attempts, including across restarts. Ticks still
probe canonical state. Version/progress reads share an EIP-1898 canonical block hash;
malformed block quantities/hashes/bytecode and unknown reads fail closed. Within each
implementation version, **all** progress dimensions must be nondecreasing and at least
one must advance. Prior implementation high-water marks are retained across upgrades,
so oscillating versions cannot repeatedly authorize the same checkpoint. A genuinely
advancing chunk receives the next tick without a delay or participant cap.

The staged ABI is (phase, round, workDone), with legacy completed-round fallback only
on an explicit missing-selector revert. Missile preparation also observes pinned packed cursors
and silent compaction array lengths. Every Outbound target's ordering namespace is observed,
including Transport, Deploy and Harvest: bounded ordering scans are not exclusive to combat.

**Source-bound capability / rollout:** configure VEYDRIFT_ARRIVAL_PROGRESS_VERSIONS for the
keeper (the backend uses its own batch resolver) as comma-separated implementation-address:runtime-keccak256 pairs (both 0x hex).
The release owner must derive each pair from the reviewed frozen Game deployment and verify its
exact deployed runtime bytes (including immutable embedded-module addresses), not creation code,
unlinked artifact bytes, selector success, nonzero storage, or an arbitrary nonempty getter.
No wildcard is accepted. Empty/mismatched lists fail closed for guarded arrivals and returns.
The implementation slot, its runtime bytes and target counters are all read at one canonical
EIP-1898 block hash. Unknown old code is never inferred capable from zero or nonzero counters.

Stage the compatible services first with settlement disabled, approve/upgrade Game normally,
install its reviewed address/runtime pair, and enable settlement. A matching upgraded runtime
with existing zero namespace counters gets one ordinary durable initial probe; the first scan
advances cumulative work. A paid no-op/revert consumes zero, so restart cannot buy that probe
again. No manual per-target initialization is needed. Generation and cumulative work must remain
nondecreasing thereafter. Raw legacy cursor is diagnostic only and no arbitrary cursor decrease
is accepted. Returns omit the target arrival-order dimension, but both legs observe the per-mission
chronology work counter. Nested return work advances its parent only after actual progress or a
canonical status transition. Old persisted operation keys retain their original format.

Backend recovery, acknowledgment, and allocation share the coordinator's durable account-wide
lease with moon/randomness writers. Locally signed nonces stay reserved even when latest equals
pending. Only owner receipt reconciliation or identical-byte rebroadcast releases signed ownership;
other jobs cannot borrow/cancel it. Identity/hash/nonce CAS protects acknowledgments after waits.
A10 marks preparation-only reservations in the shared SQLite store before invoking preparation.
Owner reconciliation (also before terminal/index-empty handling) releases ONLY those new marked
allocating/null-hash rows with no corresponding raw envelope. It uses no nonce-count or timeout
inference. Raw-present, submitted, ambiguous, migrated and generic unknown states remain reserved
for explicit owner reconciliation. Separate/lost journals do not prove a pre-dispatch allocation.

All writers for a signer must share the persistent coordinator store and preserve both coordinator
and mission-progress tables (production uses one SQLite file). Retire old writer binaries stop-first;
old versions do not understand new reservation lifecycle markers. Backend and keeper retain the
15M arrival envelope and zero-native-value checks. Generic nonce-gap recovery is fenced on every
async boundary and final success/error; stale owners cannot overwrite successor attempts.

Health due-mission diagnostics expose progressGuard and no-progress errors. Consumed
guards remain after terminal reconciliation as reorg high-water marks. Durable envelopes
are reconciled even if discovery events already removed their pending mission.

A pending keeper nonce blocks new sends, including after a receipt timeout or
process restart, rather than queuing another call behind an unknown outcome.
Staged progress lives on-chain and does not depend on the keeper's in-memory queue.
The pending queue is restored synchronously from a chain/game-scoped SQLite WAL
journal before timers start. Every job mutation is durable; terminal cleanup removes
its job. Before a journal-backed job can sign, canonical status is reconciled again,
so old launch replays and receipts completed during downtime do not cause a paid
arrival/return duplicate. A journal write error disables signing until restart;
corrupt or mismatched-chain storage fails startup rather than silently resetting.

In addition to recent log replay, each sweep scans at most two historical RPC
ranges (90,001 blocks each by default) from the durable discovery cursor. The first
cursor starts at `GAME_DEPLOYMENT_BLOCK`; its safe default is genesis. Jobs and cursor
commit in one SQLite `BEGIN IMMEDIATE` transaction with `synchronous=FULL`. A crash
rolls back both, so restart repeats a batch rather than skipping launches, return
exposures, or terminal events. A cold journal or long outage therefore recovers
missions older than `BACKFILL_BLOCKS` without an active-battle getter or progress-event
assumption. Catch-up is progressive, not instantaneous; recent events remain fast.
The existing rolling replay and canonical reconciliation remain the reorg backstop.
