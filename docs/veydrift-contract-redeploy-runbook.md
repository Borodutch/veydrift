# Veydrift Contract Redeploy Runbook

This is the canonical handoff for Base Sepolia contract redeploys. Veydrift is
in open alpha as of 2026-05-29, so redeploying is not a reset button. Preserve
current player state, prefer proxy upgrades when available, and use this runbook
only after the state-preservation gate in
`docs/open-alpha-state-preservation.md` is satisfied.

The goal is to keep contract addresses, backend runtime config, frontend
ABI/runtime assumptions, migration evidence, and tab smoke checks in one
repeatable path.

## 0. Migration Verification Gate

Before broadcasting a full deploy:

Run the executable preflight first and keep its JSON output with the Kaneo
workpad evidence:

```sh
node scripts/veydrift-redeploy-preflight.mjs \
  --api-url https://api-test.veydrift.com \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --out /tmp/veydrift-redeploy-preflight.json
```

The preflight fails closed when backend health/runtime/indexer evidence is
unavailable, the current game is a direct non-proxy deployment, current alpha
state is present or unknown, or the current game holds nonzero resource-token
reserves without an approved migration plan. Its JSON output includes raw
public backend snapshots for `/health`, `/runtime-config`, and `/debug/indexer`
alongside the derived blockers so the state evidence remains reviewable after
the live backend moves on. Passing
`--migration-plan-approved` or `--no-alpha-state` is an explicit declaration,
not a substitute for recording the evidence described below.

1. Decide whether the change can be handled as a proxy upgrade instead. If yes,
   use the proxy upgrade path and record old/new implementation addresses,
   storage-layout evidence, upgrade tx, and post-upgrade state checks.
2. If a full redeploy is unavoidable, record one of:
   - `No alpha player state exists`, with onchain and backend indexer evidence;
   - `Migration plan approved`, with export/import/reconcile/rollback details
     covering the state classes listed in
     `docs/open-alpha-state-preservation.md`.
3. Capture the current manifest/runtime state before mutation:
   game, settlement, resource tokens, alliance, randomness, moon, index block,
   ABI hash, backend `GET /health`, `/runtime-config`, and `/debug/indexer`.
4. Export or read the current state needed for migration: planets and owners,
   names, resources and reserves, buildings and queues, ships and defenses,
   research, fleets and cargo/returns, moons and moon buildings, alliances,
   debris, moon chance, rift state, and backend indexed DB position.
5. Define rollback and verification. The Kaneo handoff must include the
   migration verification note before the task can move to done.

For the VEY-313 Base Sepolia `VeydriftGame` replacement, the approved path is
migrated redeploy. The live game is not proxy-upgradeable and no-state redeploy
is invalid. Complete
`docs/veydriftgame-replacement-plan-VEY-KANEO-313.md` before broadcasting.

Full deploys through `Deploy.s.sol` also require:

```sh
export VEYDRIFT_ALPHA_REDEPLOY_ACK="I have verified Veydrift alpha state migration requirements"
```

This acknowledgement prevents accidental script use. It does not replace the
Kaneo/PR evidence required by the policy.

## 1. Build And Deploy

Run contract validation before broadcasting:

```sh
bun run check:contracts
bun run test:contracts
```

Deploy from `packages/contracts` with the funded deployer wallet and the intended RPC. Do not print
or commit `PRIVATE_KEY`. Only run this full deploy path after section 0 is
complete.

```sh
cd packages/contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast \
  --slow
```

Capture the deploy block from the broadcast receipt. Use the first block touched by the deploy as
`deploy-block`; use the same value for `index-from-block` unless the indexer must intentionally
replay earlier events.

## 2. Produce The Manifest

Run `forge build` first so the VeydriftGame ABI artifact exists, then write a manifest:

```sh
node scripts/veydrift-deployment-manifest.mjs \
  --deploy-block 41848281 \
  --index-from-block 41848281 \
  --game 0x... \
  --settlement 0x... \
  --metal 0x... \
  --crystal 0x... \
  --deuterium 0x... \
  --alliance 0x... \
  --randomness 0x... \
  --moon 0x... \
  --deployer-label "Veydrift deployer wallet" \
  --out deploy/veydrift-base-sepolia-YYYYMMDDTHHMMSSZ.json
```

The manifest must include chain id/network, deploy/index blocks, game and auxiliary addresses,
resource token addresses, deployer label, timestamp, git commit, and ABI hash. The script fails if a
required address or ABI artifact is missing.

## 3. Propagate Config

Render the backend/frontend env payload from the manifest:

```sh
node scripts/veydrift-apply-deployment-manifest.mjs \
  --manifest deploy/veydrift-base-sepolia-YYYYMMDDTHHMMSSZ.json \
  --backend-env-out /tmp/veydrift-backend.env \
  --frontend-env-out /tmp/veydrift-frontend.env \
  --api-url https://api-test.veydrift.com
```

Apply every generated backend variable to the `veydrift_backend-test` EasyPanel service, including:

- `VEYDRIFT_CONTRACT_ADDRESS`
- `VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS`
- `VEYDRIFT_GAME_CONTRACT_ADDRESS`
- `VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS`
- `VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS`
- `VEYDRIFT_MOON_CONTRACT_ADDRESS`
- `VEYDRIFT_METAL_TOKEN_ADDRESS`
- `VEYDRIFT_CRYSTAL_TOKEN_ADDRESS`
- `VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS`
- `VEYDRIFT_INDEX_FROM_BLOCK`
- `VEYDRIFT_DEPLOYMENT_COMMIT`
- `VEYDRIFT_DEPLOYMENT_ABI_HASH`
- `VEYDRIFT_DEPLOYMENT_TIMESTAMP`

> **`VEYDRIFT_INDEX_FROM_BLOCK` is a hard correctness input (VEY-KANEO-476).** The indexer now
> reconstructs served state purely from event replay with no on-the-fly canonical RPC re-pin, so this
> value must be **at or below the contract genesis block** — the block where the oldest still-live planet
> was created (the original `VeydriftGame` proxy deployment, **not** a later upgrade/redeploy block). On a
> proxy upgrade the storage (e.g. planets `1-99`) persists from before the upgrade, so the index block
> must stay at the original genesis; setting it to the upgrade block silently drops every pre-upgrade
> planet (`walletSettlement`/`walletPlanets` go empty while `/health` still reports
> `safeToServeIndexedState: true`). The manifest generator enforces `indexFromBlock <= deployBlock`, but
> `deployBlock` itself must be the original proxy genesis. There is no event-only self-heal for a
> truncated baseline; verify coverage with the post-deploy gate below.

Preserve existing secret/runtime values such as RPC URLs and Alchemy keys. Then rebuild/restart:

1. `veydrift_backend-test`
2. any indexer/worker process attached to the backend service
3. `veydrift_frontend-test`

The frontend should only need `VITE_VEYDRIFT_API_URL` when it reads addresses from
`/runtime-config`; do not hard-code redeployed contract addresses into the frontend bundle.

## 4. Smoke Check

Run the API smoke check before manual QA:

```sh
node scripts/veydrift-postdeploy-smoke.mjs \
  --manifest deploy/veydrift-base-sepolia-YYYYMMDDTHHMMSSZ.json \
  --api-url https://api-test.veydrift.com \
  --wallet 0x...
```

Use a smoke wallet that has already settled a home planet on the fresh deployment. If the wallet has
no `homePlanetId`, the script fails and asks for a settled wallet before checking gameplay tabs.

The smoke check verifies:

- `/health` is configured and reports matching chain/index config.
- `/runtime-config` reports the manifest addresses and feature flags.
- overview/settlement and planet management endpoints load.
- infrastructure, defenses, research, shipyard, galaxy, alliance, mission control, rankings, and
  moon endpoints do not return unsupported or stale-config errors.

If rankings or any tab returns an unsupported deployment error, do not start browser QA. Fix the
backend/ABI/config mismatch or create a narrow follow-up task if the deployed contract truly lacks
that feature.

### Event-replay baseline coverage gate (VEY-KANEO-476)

Because served state is reconstructed purely from event replay, confirm the configured
`VEYDRIFT_INDEX_FROM_BLOCK` actually covers the oldest live planets before handing off to QA:

- Pick a wallet that owns a **low-id / pre-upgrade planet** (e.g. planet `1`). On-chain it should report
  `homePlanetOf(wallet) == <id>` and `planet(<id>).owner == wallet`.
- Run the smoke check with `--expect-planet`, which fails if that planet is missing from the served
  `/wallet/<wallet>/planets` (the truncated-baseline symptom):

  ```sh
  node scripts/veydrift-postdeploy-smoke.mjs \
    --manifest deploy/veydrift-base-sepolia-YYYYMMDDTHHMMSSZ.json \
    --api-url https://api-test.veydrift.com \
    --wallet 0x... --expect-planet 1
  ```

- Then confirm (manually, or via an RPC call against the contract) that the served
  `metal/crystal/deuterium` for that planet match the contract's `previewResources(<id>)` at the sampled
  block within normal accrual timing.
- The RPC/canonical state-getter counters in `/health` must stay zero (no on-the-fly re-pin).

If the wallet serves `homePlanetId: null` / `planets: []` while the planet exists on-chain, the index
baseline is truncated: lower `VEYDRIFT_INDEX_FROM_BLOCK` to the original proxy genesis block and rerun a
full `POST /index/rebuild`. Do not deploy/hand off until this gate passes.

## 5. Kaneo Evidence

Record the manifest path, deployed addresses, deploy block, commit SHA, smoke command output, and
any live tx used for proof in the Kaneo workpad. Also record the preservation
path used: proxy upgrade, no-state redeploy, or migrated redeploy.

For a migrated redeploy, include pre/post evidence for planets, resources,
queues, fleets, research, moons, reserve backing, and backend indexer
reconciliation. Manual browser QA can then focus on gameplay rather than
discovering config drift.
