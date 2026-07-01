# VeydriftGame Replacement Plan - VEY-KANEO-313

This note records the approved state-preserving path for replacing the live
Base Sepolia `VeydriftGame` before the VEY-306 settle-before-spend contract
changes can be validated on `https://test.veydrift.com`.

Veydrift is in open alpha as of 2026-05-29. Do not broadcast a replacement that
resets current alpha state. This plan extends
`docs/open-alpha-state-preservation.md` and
`docs/veydrift-contract-redeploy-runbook.md`.

## Decision

Use a migrated redeploy.

Proxy upgrade is unavailable for the current live game address
`0x3e98dFAb0C29A685d5B0b7981cD8c907CaE7a38F` because the ERC1967
implementation slot is empty. No-state redeploy is invalid because the
preflight evidence recorded existing alpha state and nonzero game-held resource
token reserves.

The replacement broadcast remains blocked until export, import, reserve
backing, backend reconciliation, rollback, and pre/post parity checks are
implemented and reviewed.

## Evidence

The VEY-313 Kaneo planning pass recorded raw preflight JSON at:

```text
/Users/borodutch/.openclaw/workspace/tmp/vey313-evidence/veydrift-redeploy-preflight-vey313-20260604.json
```

Recorded preflight summary:

- `ok=false`
- live game: `0x3e98dFAb0C29A685d5B0b7981cD8c907CaE7a38F`
- ERC1967 implementation slot:
  `0x0000000000000000000000000000000000000000`
- `proxyUpgradeable=false`
- `indexedPlanets=96`
- `indexedEventLogs=3609`
- `latestIndexedBlock=42390253`
- game-held metal, crystal, and deuterium reserves:
  `10000000000000000` each
- resource-token owner/runtime authority:
  `0xc2142a4918754abe5975ecd486a66dfeba39a419`

Current `main` includes `scripts/veydrift-redeploy-preflight.mjs` as the
reviewed fail-closed evidence collector for replacement planning. A replacement
branch must rerun it before and after replacement, or include an equivalent
reviewed command, and preserve both JSON outputs in the Kaneo workpad or deploy
artifact directory.

## Pre-Broadcast Gate

Before broadcasting replacement contracts:

1. Freeze the deploy surface: record git SHA, deployed addresses, deploy block,
   index block, ABI hash, backend `/health`, `/runtime-config`,
   `/health`, resource-token owner, and runtime authority.
2. Pause nonessential alpha contract broadcasts while the migration snapshot is
   captured.
3. Rerun the redeploy preflight against the target API/RPC. The only acceptable
   pre-broadcast blocker is the approved migrated-redeploy state.
4. Capture rollback artifacts: old manifest/env, old game/resource/module
   addresses, previous ABI hash, indexer replay point, and backend SQLite
   snapshot.
5. Confirm the deployer can mint or deposit replacement resource reserve backing
   before any runtime address changes.

## State Export

Export canonical state from onchain reads plus indexed logs. The export must
cover:

- planets, owners, coordinates, names, fields, temperatures, and multipliers;
- ledger resources, preview/settled resource state, reserve requirements, and
  resource-token balances;
- building levels, active building queues, and completed-but-unclaimed queue
  outputs;
- defenses, ships, defense queues, and ship queues;
- research levels and active research queues;
- fleet missions, cargo, return timing, recalls, ACS defend/intercept links,
  hostile-mission counterplay links, and pending mission-resolution indexes;
- debris fields, combat results, moon chance, moons, moon buildings, and moon
  queues;
- alliances, members, invites, applications, diplomacy, and defense intents;
- rift state and rift resource accounting;
- attack windows, attack protection exemptions, player activity timestamps, and
  honor points;
- backend SQLite/indexer state, deployment manifest, ABI hash, and replay
  positions.

Public getters and backend API exports do not currently prove every internal
index complete. The implementation must add or use an audited exporter/importer
for internal state classes such as owned-planet indexes, resolution indexes,
phalanx indexes, ACS/counterplay links, attack windows, activity timestamps, and
honor points. Any intentionally dropped class requires an explicit product
decision plus compensation or rollback handling before broadcast.

## Replacement And Import

Deploy the replacement `VeydriftGame` with the reviewed VEY-306 contract code
and current module/runtime wiring. Full deploys must keep
`VEYDRIFT_ALPHA_REDEPLOY_ACK` as an explicit safety gate.

Import or reconstruct alpha state through audited owner-only migration actions
or scripts. Import order must preserve dependencies:

1. game/module/resource-token wiring;
2. planets, coordinate occupancy, owners, owned-planet indexes, names, and
   resource ledgers;
3. buildings, defenses, ships, technologies, queues, and pending production;
4. fleet missions, mission indexes, counterplay links, debris, and combat state;
5. moon, alliance, rift, attack-protection, activity, and honor state;
6. backend/indexer replay and reconciliation state.

Run parity checks after import for every exported class, including counts and
representative wallet snapshots. Parity checks must include at least planets,
resources, queues, research, fleets/missions, moons, alliances, and visible
backend state.

## Reserve Backing

Replacement gameplay must not start until internal resource requirements are
backed by metal, crystal, and deuterium token balances held by the replacement
game.

If the old direct game cannot transfer reserves, leave it frozen and back the
replacement from token-owner mint/deposit authority. Record the authority used,
mint/deposit transactions, and final reserve check:

```text
replacement.resourceReserveRequirement() <= replacement resource token balances
```

Run this check separately for metal, crystal, and deuterium.

## Runtime Reconciliation

After replacement:

1. Generate a deployment manifest for the new game, auxiliary contracts,
   resource tokens, ABI hash, deploy block, and index-from block.
2. Apply backend/frontend runtime config from the manifest.
3. Restart the test backend/indexer/frontend in that order.
4. Rebuild or reconcile the backend SQLite/indexer from preserved canonical
   state and the selected replay point.
5. Verify `/health` and `/runtime-config` match the
   replacement manifest and report safe indexed state before live QA.

## Validation

Required automated checks:

```sh
bun run check:alpha-state
node scripts/veydrift-postdeploy-smoke.mjs \
  --manifest deploy/veydrift-base-sepolia-YYYYMMDDTHHMMSSZ.json \
  --api-url https://api-test.veydrift.com \
  --wallet 0x...
```

Required evidence:

- pre- and post-replacement preflight JSON;
- deploy/import/reconcile transaction hashes or script outputs;
- old and new manifests plus rollback manifest path;
- reserve backing proof for all three resources;
- pre/post parity report for every exported state class;
- representative wallet API snapshots showing preserved planets, resources,
  queues, research, fleets, moons, alliances, and indexed state;
- browser/wallet QA evidence that VEY-306 can be exercised on
  `https://test.veydrift.com` without a player-facing Collect action.

## Rollback

If parity, reserve backing, smoke, or live QA fails, restore the old runtime
manifest/env, backend DB snapshot, ABI hash, and indexer replay point. Point
frontend/API back to the old game and resource addresses. Do not mark the
replacement complete until the failure is fixed or explicitly accepted in Kaneo.
