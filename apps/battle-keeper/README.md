# @veydrift/battle-keeper

A focused, **event-driven keeper** that resolves on-chain combat battles (Attack / Harvest fleet
missions) promptly so players don't wait on a manual mutating call.

## Why this exists (VEY-468)

Veydrift moved all mission completions to **lazy on-chain settlement**, retiring the old 30s polling
keeper. That's fine for deterministic legs (Transport, Deploy, Colonize, returns) — they settle the
next time anyone touches the relevant state. But **combat resolution needs randomness and should not
lag**: an attacker shouldn't have to send their own resolve tx and wait. This service watches for
launched battles and calls the permissionless `resolveFleetMission(uint256)` as soon as each one
arrives.

It is intentionally a **separate web service** (not the backend), so combat resolution is isolated
from the indexer/API and can be deployed on the host that can reach the self-hosted node.

## What it does

- **WebSocket-subscribes** to the game contract's battle events:
  - `FleetMissionLaunched` → if `missionType` is **Attack** or **Harvest**, record
    `{ missionId, arrivalAt }` in a pending set.
  - `FleetMissionResolved` / `AttackBattleResolved` → drop that `missionId` from pending.
- **Resolution loop** (every `RESOLVE_INTERVAL_MS`): for each pending mission whose `arrivalAt <= now`,
  submit `resolveFleetMission(missionId)` as a **signed raw transaction** (`eth_sendRawTransaction`,
  selector `0xde09e7cf`) from `KEEPER_PRIVATE_KEY`. The call is **permissionless** — any funded EOA
  can resolve. Each submission is simulated with `eth_call` first, so a mission whose randomness isn't
  committed yet reverts during simulation and is **retried on the next tick** without burning a nonce
  or crashing.
- **Safety sweep** (every `SWEEP_INTERVAL_MS`): backfills recent battle logs over `eth_getLogs` to
  recover any launch the WebSocket feed may have dropped, then re-attempts due missions.
- **Idempotent**: a mission with an in-flight submission is never submitted again; once a resolution
  is observed (our successful tx or anyone's `FleetMissionResolved`/`AttackBattleResolved`) it is
  dropped from pending and never re-queued.
- **Robust**: auto-reconnects the WebSocket with capped exponential backoff, bounded concurrency on
  tx submission, structured logs, and never wedges.

### Scope decision

This keeper **only resolves Attack/Harvest battle missions**. Every other mission type
(Transport, Deploy, Colonize, AcsDefend, DefenseHold, returns, …) is **deterministic and
lazy-settles**, so it is deliberately left out of scope. `RandomnessCommitterService` stays in the
backend — the keeper **only resolves**, it does not commit randomness.

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
