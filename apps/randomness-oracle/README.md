# @veydrift/randomness-oracle

Standalone off-chain oracle that fulfills Veydrift attack-battle randomness.

## What it does

When a player launches an attack, `VeydriftGame` calls
`RandomnessEngine.requestRandomness(...)`, creating an unfulfilled request.
Combat resolution later calls `consumeRandomness(...)`, which reverts while the
request is still pending. This service watches the engine and posts a random
word for every unfulfilled request via `fulfillRandomness(requestId, word)` so
resolution can proceed.

It runs with `precommitRequired = false` on the engine (the engine then accepts
any non-zero word from the configured fulfiller). The service is **stateless**:
each poll re-derives the pending set from on-chain state, so a restart never
loses or double-fulfills work. `fulfillRandomness` is idempotent here —
already-fulfilled requests are treated as success.

## Environment

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS` | yes | — | RandomnessEngine address |
| `VEYDRIFT_RANDOMNESS_FULFILLER_PRIVATE_KEY` | yes | — | Key set as the engine `fulfiller`; needs gas |
| `VEYDRIFT_RPC_URL` | yes* | — | or `BASE_SEPOLIA_RPC_URL` / `ALCHEMY_BASE_SEPOLIA_API_KEY` |
| `VEYDRIFT_CHAIN_ID` | no | `84532` | Base Sepolia |
| `VEYDRIFT_RANDOMNESS_POLL_INTERVAL_MS` | no | `5000` | |
| `VEYDRIFT_RANDOMNESS_START_REQUEST_ID` | no | `1` | lowest id ever scanned |
| `VEYDRIFT_RANDOMNESS_MAX_PER_TICK` | no | `25` | gas/time bound per poll |
| `PORT` | no | `4100` | `/health` endpoint |

The fulfiller key should be a **dedicated** account — it can only post random
words, not touch game/engine ownership.

## Run

```sh
bun install
bun --filter @veydrift/randomness-oracle run start
# health: curl localhost:4100/health
```

## Test

```sh
bun --filter @veydrift/randomness-oracle run test
```
