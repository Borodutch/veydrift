# Veydrift Contract Redeploy Runbook

This is the canonical handoff for Base Sepolia contract redeploys. The goal is to keep contract
addresses, backend runtime config, frontend ABI/runtime assumptions, and tab smoke checks in one
repeatable path.

## 1. Build And Deploy

Run contract validation before broadcasting:

```sh
bun run check:contracts
bun run test:contracts
```

Deploy from `packages/contracts` with the funded deployer wallet and the intended RPC. Do not print
or commit `PRIVATE_KEY`.

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

## 5. Kaneo Evidence

Record the manifest path, deployed addresses, deploy block, commit SHA, smoke command output, and
any live tx used for proof in the Kaneo workpad. Manual browser QA can then focus on gameplay rather
than discovering config drift.
