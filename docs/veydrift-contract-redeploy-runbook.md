# Veydrift Contract Redeploy Runbook

This is the canonical contract deployment handoff, including the release-specific mainnet path
below and state-preserving redeploys. Verify the intended chain; historical Sepolia examples are
not production configuration. Veydrift is
in open alpha as of 2026-05-29, so redeploying is not a reset button. Preserve
current player state, prefer proxy upgrades when available, and use this runbook
only after the state-preservation gate in
`docs/open-alpha-state-preservation.md` is satisfied.

The goal is to keep contract addresses, backend runtime config, frontend
ABI/runtime assumptions, migration evidence, and tab smoke checks in one
repeatable path.

Run commands from the repository root unless a package directory is explicitly named.
No procedure here authorizes a broadcast or production operation without the required owner approval.

## Production Timed-Missile Upgrade (Only Approved Path)

The timed-missile release is an **in-place Transparent ProxyAdmin upgrade**. Do not run
`Deploy.s.sol`, do not replace the Game proxy, and do not pause the Game. The only approved order is:

1. Build the exact merged commit and pass contract, storage-layout, backend, keeper, and frontend gates.
2. Deploy that backend writer and battle-keeper build first with
   `VEYDRIFT_TIMED_MISSILE_STANDBY=true` and with
   `VEYDRIFT_TIMED_MISSILE_INDEX_FROM_BLOCK` absent. Verify `/health` reports the expected build SHA,
   `timedMissileStandby=true`, a connected/caught-up writer, and an unpaused Game. Do not deploy the
   frontend yet.
3. From `packages/contracts`, simulate and then broadcast exactly:

   ```sh
   forge script script/UpgradeGame.s.sol:UpgradeGame --rpc-url "${BASE_RPC_URL:?Set the verified target RPC}"
   forge script script/UpgradeGame.s.sol:UpgradeGame --rpc-url "${BASE_RPC_URL:?Set the verified target RPC}" --broadcast --slow
   ```

   The script must use empty upgrade calldata and must reject a paused Game. Capture the confirmed
   upgrade transaction hash, its exact receipt block, the EIP-1967 implementation address, and the
   implementation runtime code hash. The receipt block—not a pre-upgrade estimate—is the immutable
   timed-missile replay boundary.
4. Generate the final manifest with `--deploy-block` and `--timed-missile-index-from-block` both set
   to that exact receipt block, plus `--upgrade-tx`, `--game-implementation`, and
   `--game-implementation-code-hash` from the confirmed chain state.
5. Replace standby config on the backend writer with the manifest-rendered exact boundary and proof
   variables; `VEYDRIFT_TIMED_MISSILE_STANDBY` must be absent/false. Redeploy the same exact backend
   and keeper image. Wait until the narrow lifecycle replay is complete through the latest synchronized
   block. A rollback to an older writer is forbidden after the proxy upgrade.
6. Run `veydrift-postdeploy-smoke.mjs`. It must prove the upgrade receipt/block, active EIP-1967
   implementation and runtime hash, unpaused Game, timed-missile selectors, exact backend build/ABI,
   and replay coverage through the synchronized head.
7. Deploy the frontend last, then verify a real timed one-way missile launch and arrival without
   submitting any unrelated player action.

Any failed step leaves the frontend on the previous feature set. Repair or roll forward the compatible
backend and implementation; never solve rollout uncertainty by pausing gameplay or using the fresh
deploy path below.

## 0. Migration Verification Gate

Before broadcasting a full deploy:

Run the executable preflight first and keep its JSON output with the Kaneo
workpad evidence:

```sh
node scripts/veydrift-redeploy-preflight.mjs \
  --api-url "${DEPLOYMENT_API_URL:?Set the verified target API}" \
  --rpc-url "${DEPLOYMENT_RPC_URL:?Set the verified target RPC}" \
  --out "${PREFLIGHT_OUTPUT_PATH:?Choose a new evidence file}"
```

The preflight fails closed when backend health/runtime/indexer evidence is
unavailable, the current game is a direct non-proxy deployment, current alpha
state is present or unknown, or the current game holds nonzero resource-token
reserves without an approved migration plan. Its JSON output includes raw
public backend snapshots for `/health` and `/runtime-config`
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
   ABI hash, backend `GET /health` and `/runtime-config`.
4. Export or read the current state needed for migration: planets and owners,
   names, resources and reserves, buildings and queues, ships and defenses,
   research, fleets and cargo/returns, moons and moon buildings, alliances,
   debris, moon chance, rift state, and backend indexed DB position.
5. Define rollback and verification. The Kaneo handoff must include the
   migration verification note before the task can move to done.

For a non-upgradeable target with player state, follow the
[full-redeploy migration and rollback requirements](open-alpha-state-preservation.md#full-redeploy-migration-path).
Do not infer upgradeability or absence of state from an earlier deployment's evidence.

Full deploys through `Deploy.s.sol` also require:

```sh
export VEYDRIFT_ALPHA_REDEPLOY_ACK="I have verified Veydrift alpha state migration requirements"
```

This acknowledgement prevents accidental script use. It does not replace the
Kaneo/PR evidence required by the policy.

## 1. Full Redeploy Only: Build And Deploy

Run contract validation before broadcasting:

```sh
bun run check:contracts
bun run test:contracts
```

This section is not the timed-missile rollout. Deploy from `packages/contracts` with the funded deployer wallet and the intended RPC. Do not print
or commit `PRIVATE_KEY`. Only run this full deploy path after section 0 is
complete.

```sh
(cd packages/contracts && forge script script/Deploy.s.sol:Deploy \
  --rpc-url "${DEPLOYMENT_RPC_URL:?Set the verified target RPC}" \
  --broadcast \
  --slow)
```

Capture the deploy block from the broadcast receipt. Use the first block touched by the deploy as
`deploy-block`; use the same value for `index-from-block` unless the indexer must intentionally
replay earlier events.

## 2. Produce The Manifest

Run `bun run build:contracts` from the root so the VeydriftGame ABI artifact exists. Populate the
reviewed deployment environment with actual receipt blocks, addresses and activation proof; choose
a new output path in an existing ignored evidence directory. Do not overwrite earlier evidence.
Then generate from that environment, explicitly binding chain identity:

```sh
node scripts/veydrift-deployment-manifest.mjs --from-env \
  --chain-id "${VEYDRIFT_CHAIN_ID:?Set the verified chain ID}" \
  --network-name "${VEYDRIFT_NETWORK_NAME:?Set the verified network name}" \
  --index-from-block "${VEYDRIFT_INDEX_FROM_BLOCK:?Set the reviewed replay start}" \
  --out "${DEPLOYMENT_MANIFEST_PATH:?Choose a new manifest file}"
```

The manifest must include chain id/network, deploy/index blocks, game and auxiliary addresses,
resource token addresses, deployer label, timestamp, git commit, and ABI hash. The script fails if a
required address or ABI artifact is missing.

In particular, the current generator requires `VEYDRIFT_DEPLOY_BLOCK`,
`VEYDRIFT_UPGRADE_TRANSACTION_HASH`, `VEYDRIFT_EXPECTED_GAME_IMPLEMENTATION`, and
`VEYDRIFT_EXPECTED_GAME_IMPLEMENTATION_CODE_HASH`. Its timed-missile boundary must equal the
confirmed activation receipt block. On an existing deployment preserve the earlier ordinary index
start so old player history is replayed; the narrow timed-missile boundary is not its replacement.
Include every deployed auxiliary address, especially `VEYDRIFT_REFERRAL_SYSTEM_ADDRESS` where
configured. Do not fabricate proof or omit an active module to make validation pass. If an approved
migration cannot satisfy the current proof schema, stop and review the tooling before cutover.

## 3. Propagate Config

Render the backend/frontend env payload from the manifest:

```sh
node scripts/veydrift-apply-deployment-manifest.mjs \
  --manifest "${DEPLOYMENT_MANIFEST_PATH:?Set the reviewed manifest}" \
  --backend-env-out "${BACKEND_ENV_OUTPUT_PATH:?Choose a new output file}" \
  --frontend-env-out "${FRONTEND_ENV_OUTPUT_PATH:?Choose a new output file}" \
  --api-url "${DEPLOYMENT_API_URL:?Set the verified target API}"
```

Apply every generated backend variable to the verified target's managed backend service, including:

- `VEYDRIFT_CONTRACT_ADDRESS`
- `VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS`
- `VEYDRIFT_GAME_CONTRACT_ADDRESS`
- `VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS`
- `VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS`
- `VEYDRIFT_MOON_CONTRACT_ADDRESS`
- `VEYDRIFT_REFERRAL_SYSTEM_ADDRESS`
- `VEYDRIFT_SETTLEMENT_START_PRICE_WEI` (cold-start bootstrap; must equal the deployed game proxy's `startPrice()`, then indexed `StartPriceUpdated` events are authoritative)
- `VEYDRIFT_METAL_TOKEN_ADDRESS`
- `VEYDRIFT_CRYSTAL_TOKEN_ADDRESS`
- `VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS`
- `VEYDRIFT_INDEX_FROM_BLOCK`
- `VEYDRIFT_TIMED_MISSILE_INDEX_FROM_BLOCK` (required; exact Game upgrade block for rollback-safe timed-missile lifecycle replay)
- `VEYDRIFT_UPGRADE_TRANSACTION_HASH`
- `VEYDRIFT_EXPECTED_GAME_IMPLEMENTATION`
- `VEYDRIFT_EXPECTED_GAME_IMPLEMENTATION_CODE_HASH`
- `VEYDRIFT_DEPLOYMENT_COMMIT`
- `VEYDRIFT_DEPLOYMENT_ABI_HASH`
- `VEYDRIFT_DEPLOYMENT_TIMESTAMP`

Preserve existing secret/runtime values such as RPC URLs and Alchemy keys. Then rebuild/restart:

For the timed-missile in-place upgrade, use the production ordering above: compatible writer/keeper in
standby, proxy upgrade, exact-boundary writer/keeper, smoke, then frontend. The generic full-redeploy
order below applies only to this full-redeploy section:

1. The target backend, including its indexing writer and read workers under the
   [supervisor ownership rules](deployment.md#backend-readiness).
2. Any separately deployed compatible workers required by that target.
3. The matching frontend, only after backend/indexer readiness.

The frontend should only need `VITE_VEYDRIFT_API_URL` when it reads addresses from
`/runtime-config`; do not hard-code redeployed contract addresses into the frontend bundle.

## 4. Smoke Check

Run the API smoke check before manual QA:

```sh
node scripts/veydrift-postdeploy-smoke.mjs \
  --manifest "${DEPLOYMENT_MANIFEST_PATH:?Set the reviewed manifest}" \
  --api-url "${DEPLOYMENT_API_URL:?Set the verified target API}" \
  --rpc-url "${DEPLOYMENT_RPC_URL:?Set the verified target RPC}" \
  --referral-signer "$REFERRAL_SIGNER_ADDRESS" \
  --referral-start-price-wei "$VEYDRIFT_SETTLEMENT_START_PRICE_WEI" \
  --wallet "${SMOKE_WALLET_ADDRESS:?Set a reviewed settled wallet}"
```

Use a smoke wallet that has already settled a home planet on the fresh deployment. If the wallet has
no `homePlanetId`, the script fails and asks for a settled wallet before checking gameplay tabs.

The smoke check verifies:

- `/health` is configured and reports matching chain/index config.
- `/runtime-config` reports the manifest addresses and feature flags.
- when a referral address is present, runtime and on-chain referral addresses,
  signer, authorized game proxy, and exact start price all agree.
- overview/settlement and planet management endpoints load.
- infrastructure, defenses, research, shipyard, galaxy, alliance, mission control, rankings, and
  moon endpoints do not return unsupported or stale-config errors.

If rankings or any tab returns an unsupported deployment error, do not start browser QA. Fix the
backend/ABI/config mismatch or create a narrow follow-up task if the deployed contract truly lacks
that feature.

For backend-test fixes touching the indexer, response cache, mission lifecycle, shipyard, defenses,
or read models, also run the fleet/defense parity guard before review handoff:

```sh
(cd apps/backend && bun run fleet-defense:parity -- \
  --api-url "${DEPLOYMENT_API_URL:?Set the verified target API}" \
  --rpc-url "${DEPLOYMENT_RPC_URL:?Set the verified target RPC}" \
  --api-timeout-ms 15000 \
  --rpc-timeout-ms 20000 \
  --out "${PARITY_OUTPUT_PATH:?Choose a new evidence file}")
```

The guard must exit zero and the Kaneo workpad must include the artifact path. It compares the
target chain's `shipCount` / `defenseCount` against both raw indexed DB rows from
the local indexed DB (`--index-db`/`VEYDRIFT_INDEX_DB_PATH`) and warmed served `/wallet/:wallet/shipyard` plus
`/wallet/:wallet/defenses` read models, so a PR is not accepted on UI screenshots alone.
If the guard reports `raw_db_mismatch`, diagnose the cause before choosing an explicit repair. Follow
[Index repair](development.md#index-repair): verify the exact database/chain, make a consistent
backup, and use an offline copy or controlled writer ownership. Only then use the reviewed replay
or current-state seeding path; never start a competing repair writer on the live service.
Rerun the parity guard after the repair and record the
zero-divergence artifact. If the RPC or API path fails before comparison, the guard still writes a
non-zero failure artifact; use that artifact as the deploy/readiness blocker instead of leaving a
hung validation run.

## 5. Kaneo Evidence

Record the manifest path, deployed addresses, deploy block, commit SHA, smoke command output, and
any live tx used for proof in the Kaneo workpad. Also record the preservation
path used: proxy upgrade, no-state redeploy, or migrated redeploy.

For a migrated redeploy, include pre/post evidence for planets, resources,
queues, fleets, research, moons, reserve backing, and backend indexer
reconciliation. Manual browser QA can then focus on gameplay rather than
discovering config drift.
