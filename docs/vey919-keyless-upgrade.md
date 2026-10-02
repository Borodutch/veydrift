# VEY-919 keyless upgrade evidence and release gates

**Not release approval. These checks do not sign or broadcast live transactions.**

Use `UpgradeGame`, followed by `UpgradeMoonSystem`. Do not use the historical
`UpgradeProductionBatchGame`: it reuses modules whose inherited code changed here.

## Public-address rehearsal

Both canonical scripts accept `UPGRADE_DRY_RUN_OWNER=<public owner address>`. When
nonzero they never read `PRIVATE_KEY`; `vm.startBroadcast(address)` records simulated
transactions. Never supply `--broadcast`, `--unlocked`, a keystore or signing key for
this rehearsal. Remove the override before a separately authorized signing run.
Both branches enforce identical authority, migration, wiring and referral checks.

Game inputs: `GAME_PROXY_ADDRESS`, `GAME_PROXY_ADMIN`, `MOON_PROXY_ADDRESS`,
`VEYDRIFT_REFERRAL_SYSTEM_ADDRESS` and a receipt-backed, **distinct**
`VEYDRIFT_SOURCE_REFERRAL_SYSTEM_ADDRESS`. `ADMIN_ADDRESS` defaults to the selected
owner. Moon has its own owner, which need not equal Game owner. Verify chain, block
and block hash; do not substitute a convenient RPC state or waived prerequisites.

```sh
# From packages/contracts, after independently checking all public inputs.
forge script script/UpgradeGame.s.sol:UpgradeGame \
  --rpc-url "$VEY919_LIVE_RPC" --fork-block-number "$VEY919_LIVE_BLOCK" \
  --sender "$UPGRADE_DRY_RUN_OWNER" --enable-tx-gas-limit -vv

# Opt-in combined Game -> Moon rehearsal on one unchanged fork.
forge test --match-path test/VeydriftCoalitionUpgradeLiveFork.t.sol --threads 1 -vv
```

The live fixture needs `VEY919_LIVE_RPC`, `VEY919_LIVE_BLOCK`,
`VEY919_LIVE_BLOCK_HASH` and `VEY919_LIVE_CANONICAL=true`. Missing opt-in means
**skipped**, not proven. It performs the actual scripts without injecting player
resources, queue state, code or migration flags. Separate `forge script` processes
start from separate forks; they do not establish combined rollout behavior.

The synthetic keyless fixture tests authority/referral rejection, no private-key
read, real replacement creation, proxy upgrades and preserved owner/pause/wiring.
It uses valid empty local referral migration and inert old constructor pointers;
it is not deployed-state or maximum-gas evidence. Its environment-mutating cases
run serially because Foundry environment variables are process-global.

## Storage and size checks

CI's `check:contracts:storage` compares Game storage against
`storage-layout/VeydriftGame.v1.json`, and `check:upgrade-sizes` enforces EIP-170 on every
upgraded module. Before execution approval, rebind every library, immutable, runtime and
exact transaction payload to the actual release plan and canonical on-chain reads.

## Progress and compatible consumer rollout

Stop old same-account writers first; preserve their shared SQLite/raw journals and
reconcile pending envelopes. Stage compatible backend, keeper and report consumers
with settlement disabled. Unknown/migrated allocations are not cleared by nonce
counts, elapsed time or journal deletion.

After the approved Game upgrade, verify the actual implementation address and
keccak256 of its complete deployed runtime. Install the reviewed
`implementation-address:runtime-keccak256` pair in
`VEYDRIFT_ARRIVAL_PROGRESS_VERSIONS` for the keeper before enabling
settlement. Empty/unknown pairs fail closed, including return-leg chronology.
Do not whitelist unlinked templates, arbitrary code hashes or getter success.
Verified zero counters can bootstrap once; paid no-op/revert checkpoints persist.

Arrival ordering and per-mission chronology counters are cumulative. Nested return
work advances its parent only when actual state/work changes. Staged attribution
batches at most 32 constant-size operations; round cursors cache in memory only
within one bounded call and persist before return. Stored layout, RNG inputs and
operation order are unchanged. Planet and Moon production preparation are separate.

## Evidence boundaries and remaining release gates

At Base block 52010833, the stronger local replay of persisted mission 95855
completed six rounds in **487 calls** with all 22 holds/23 fleet missions observed,
47 nonzero snapshots, per-mission losses/inventories and fleet slots reconciled.
Peak measured call gas was 2,014,972 under the unchanged 15M call cap; this is not a
cold signed transaction receipt. Earlier 512-call failure and pre-integration
1,845-call result remain historical evidence, not current failures or hidden caps.

Finite fixtures do not prove a universal maximum coalition or global namespace
absence. Keep independent arithmetic/partition parity, cargo/loot/debris/returns,
new impact-research boundaries, saved legacy continuation and actual rollout
verification distinct. Exact combined-head review, green up-to-date CI, source-bound
keyless rehearsal and Nikita’s exact-ticket/PR/head upgrade greenlight remain
mandatory before PR merge or live execution.
