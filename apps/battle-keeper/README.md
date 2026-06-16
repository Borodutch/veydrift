# @veydrift/battle-keeper

A focused, **event-driven keeper** that resolves on-chain fleet missions promptly — **every mission
type, both legs (arrival and return)** — so players never wait on a manual mutating call.

## Why this exists (VEY-468)

Veydrift moved all mission completions to **lazy on-chain settlement**, retiring the old 30s polling
keeper. Lazy settlement is the **correctness floor**: any mission settles the next time someone
touches the relevant state. But that can lag — a player shouldn't have to send their own resolve tx
and wait, and combat in particular needs randomness resolved promptly. This service is the
**promptness optimization**: it watches launched missions and calls the permissionless settlement
entrypoints as soon as each leg is due.

It is intentionally a **separate web service** (not the backend), so resolution is isolated from the
indexer/API and can be deployed on the host that can reach the self-hosted node.

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
- **Idempotent**: a mission with an in-flight submission is never submitted again for that leg; a
  terminal mission is never re-queued. When we resolve a leg ourselves we advance the state machine
  immediately (the matching event is a backstop that refines the authoritative `returnAt`).
- **Robust**: auto-reconnects the WebSocket with capped exponential backoff, bounded concurrency on
  tx submission, structured logs, and never wedges.

### Scope decision

The keeper **only resolves** — it does not commit randomness; `RandomnessCommitterService` stays in
the backend. Lazy on-chain reconcile remains the correctness floor, so even if the keeper is down
nothing is lost; it merely settles later. Any mission type that emits no `FleetMissionLaunched`
(i.e. has no resolvable arrival) is simply never tracked.

## Endpoints

- `GET /health` — `200` when the WS feed is connected, `503` (degraded) otherwise. Body includes
  `pendingCount`, `lastResolvedMissionId`, `lastResolvedAt`, `lastError`, plus full keeper + ws
  snapshots and `uptimeSeconds`.
- `GET /` — same payload.

## Configuration (env)

| Var                     | Required | Default | Description                                                        |
| ----------------------- | -------- | ------- | ------------------------------------------------------------------ |
| `RPC_URL`               | yes      | —       | HTTP JSON-RPC endpoint (reads, simulate, broadcast).               |
| `WS_RPC_URL`            | yes      | —       | WebSocket JSON-RPC endpoint (event subscription).                  |
| `GAME_CONTRACT_ADDRESS` | yes      | —       | VeydriftGame proxy address (the battle event emitter).             |
| `KEEPER_PRIVATE_KEY`    | yes      | —       | 0x-prefixed 32-byte key of a **funded** EOA that pays for resolves.|
| `CHAIN_ID`              | no       | `84532` | EVM chain id (Base Sepolia by default).                            |
| `RESOLVE_INTERVAL_MS`   | no       | `5000`  | Resolution loop cadence.                                           |
| `SWEEP_INTERVAL_MS`     | no       | `15000` | Backstop log-backfill sweep cadence.                               |
| `PORT`                  | no       | `8080`  | HTTP health/status port.                                           |
| `MAX_CONCURRENCY`       | no       | `3`     | Max concurrent `resolveFleetMission` submissions.                  |

**Never commit secrets.** `KEEPER_PRIVATE_KEY` must come from the deploy environment.

## Run locally

```bash
bun install                 # from repo root
cd apps/battle-keeper
RPC_URL=http://178.63.102.149:8545 \
WS_RPC_URL=ws://178.63.102.149:8546 \
GAME_CONTRACT_ADDRESS=0xf12f31734868F1089d9d6514D7F19a31Ec5e00e2 \
KEEPER_PRIVATE_KEY=0x... \
bun src/index.ts
```

Type-check and test:

```bash
bun run check   # tsc
bun test
```

## EasyPanel deploy recipe

1. In the existing **`veydrift`** project, create a **new App** service, e.g. `battle-keeper`.
2. **Source**: the same monorepo repo/branch. **Build**: Nixpacks; build path = repo root; it picks
   up `apps/battle-keeper/nixpacks.toml` (install at root, type-check, `bun src/index.ts`).
3. Deploy it on the **host that can reach the self-hosted Base node** (the node only allows
   `8545`/`8546` from the backend host `148.251.0.158`), and set:
   - `RPC_URL=http://178.63.102.149:8545`
   - `WS_RPC_URL=ws://178.63.102.149:8546`
   - `GAME_CONTRACT_ADDRESS=0xf12f31734868F1089d9d6514D7F19a31Ec5e00e2`
   - `KEEPER_PRIVATE_KEY=<funded keeper EOA key>` (mark as a secret)
   - `CHAIN_ID=84532`
   - `PORT=8080`
4. Expose/health-check `GET /health` on `PORT`.
5. Fund the keeper EOA with enough Base Sepolia ETH to cover resolve-tx gas.
