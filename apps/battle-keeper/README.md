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
  simulation and is **retried on the next tick** without burning a nonce or crashing.
- **Safety sweep** (every `SWEEP_INTERVAL_MS`): backfills recent fleet-mission logs over `eth_getLogs`
  to recover **both legs** — a missed launch re-queues the arrival, a missed `FleetMissionResolved`
  drops terminal arrivals, a missed `FleetMissionReturnExposed` transitions to the return leg, and a
  missed `FleetMissionReturned` drops it. After replaying logs, the sweep reads current
  `fleetMission()` status for pending ids and prunes stale terminal entries
  (`None`/`Resolved`/`Returned`) or corrects legs that no longer match on-chain state, then
  re-attempts due legs.
- **In-process deduplication**: an in-flight submission prevents another attempt for that leg;
  tracked terminal missions are not re-queued. When we resolve a leg ourselves we advance the state machine
  immediately (the matching event is a backstop that refines the authoritative `returnAt`).
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
| `BACKFILL_BLOCKS`       | no       | `90000` | Startup deep-backfill window, chunked below the self-hosted node cap. |
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
4. Check `GET /health` on the configured port, build identity, due backlog, receipts and gas funding.
   HTTP 200 alone does not prove the mission backlog is healthy.
