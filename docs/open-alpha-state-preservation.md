# Veydrift Open-Alpha State Preservation Policy

Veydrift is in open alpha as of 2026-05-29. Existing player and game state is
release state and must be preserved across contract, backend, indexer, and
deployment work.

This policy applies to Base Sepolia test alpha and any later production alpha
network. It applies even when the current task only changes contracts: the
frontend and backend read model must keep showing the same user state after the
change.

## Invariant

- Do not wipe current alpha state.
- Prefer an implementation upgrade on an existing proxy when the deployed
  contract is upgradeable and storage-compatible.
- If a full redeploy is unavoidable, migrate state before the redeploy task is
  marked complete.
- If a network has no player state, record the evidence before treating a
  redeploy as safe.
- Backend indexed state is part of the user-visible state surface. Reconcile or
  rebuild it from the preserved onchain source after any upgrade or migration.

State includes, at minimum:

- planets, owners, coordinates, fields, temperatures, and planet names;
- ledger resources, resource reserve requirements, and ERC-20 reserve backing;
- building levels, active building queues, and completed-but-unclaimed outputs;
- defenses, ships, shipyard queues, and all fleet mission state including cargo,
  return timing, recall state, ACS defense/intercept links, harvests, debris, and
  combat settlement results;
- player research levels and active research queues;
- moons, moon buildings, moon-chance outcomes, rift state, and any linked moon
  systems;
- alliances, membership, diplomacy, and defense permissions where deployed;
- backend SQLite/indexer state, deployment manifests, ABI hashes, and index
  replay positions.

## Contract Change Preflight

Before merging or broadcasting a contract-affecting task, the handoff must state:

Run `node scripts/veydrift-redeploy-preflight.mjs` against the target API/RPC
and attach or paste the JSON result in the Kaneo workpad before any full deploy
or upgrade broadcast. The script is a fail-closed evidence collector; a failing
result blocks broadcast unless the blocker is explicitly resolved by the
approved migration/no-state evidence below.

1. Current network and contract addresses: game, implementation when applicable,
   resource tokens, alliance system, randomness engine, moon system, and any
   auxiliary module contracts.
2. Whether the change is proxy-upgrade compatible. Include storage-layout
   evidence from `cd packages/contracts && bun run storage:check` for any
   `VeydriftGame` or resource-token implementation change.
3. Current player-state evidence:
   - current deploy/index block and ABI hash;
   - backend `GET /health` and `/runtime-config` snapshots;
   - count or export of settled planets, owners, moons, active queues, fleets,
     research queues, alliances, debris fields, and moon-chance reports;
   - resource reserve requirement and available reserve balances.
4. Rollback plan: implementation address to roll back to, manifest/env values to
   restore, and the indexer replay point.
5. Verification plan: API smoke command, representative wallet(s), and the state
   fields that must match before and after.

## Proxy Upgrade Path

Use a proxy upgrade when all of these are true:

- the live contract is behind an upgradeable proxy;
- the new implementation preserves storage layout or includes an explicit
  storage migration that is tested;
- initialized owner/admin permissions remain unchanged;
- module addresses, resource token addresses, and backend runtime config do not
  need a full state move.

The minimum handoff evidence for a proxy upgrade is:

- old proxy and implementation addresses;
- new implementation address;
- storage compatibility output;
- transaction hash for the upgrade;
- post-upgrade smoke output proving existing wallets, planets, resources,
  queues, fleets, moons, research, and backend indexed reads still load.

## Full Redeploy Migration Path

A full redeploy is only acceptable when a proxy upgrade is impossible or would
leave the alpha deployment in a worse state. The redeploy task must include one
of these statements before broadcast:

- `No alpha player state exists`, with evidence from onchain reads and the
  backend indexer; or
- `Migration plan approved`, with the concrete export, import, verification, and
  rollback plan below filled in.

The migration plan must cover:

1. Export current canonical state from onchain reads and indexed logs:
   planets, owners, coordinates, names, resources, buildings, ships, defenses,
   research, queues, fleets, cargo, returns, moons, moon buildings, alliances,
   debris, moon chance, rift state, and resource reserve accounting.
2. Snapshot backend state:
   SQLite DB path, `VEYDRIFT_INDEX_FROM_BLOCK`, indexed block/hash position,
   deployment manifest, ABI hash, and runtime config.
3. Deploy or upgrade replacement contracts.
4. Import or reconstruct state in the replacement contracts with audited owner
   actions or migration scripts. If any state cannot be represented directly,
   define the explicit compensation or product decision before proceeding.
5. Reconcile reserves: internal ledger requirements must be backed by the
   configured ERC-20 reserve token balances after migration.
6. Rebuild or reconcile the backend indexer from the preserved canonical state.
7. Run post-migration verification against representative wallets and compare
   pre/post state exports.

Do not treat the public API, backend indexer, or generated event export as a
complete replacement-contract migration source unless every internal game-state
index is explicitly covered. The current direct `VeydriftGame` stores several
state classes that are not enumerable from public getters alone, including:

- owned-planet indexes: `_ownedPlanetIds` and `_ownedPlanetIndex`;
- pending mission-resolution indexes by planet and player;
- phalanx mission indexes by system;
- linked counterplay mission lists such as ACS/intercept state;
- attack windows and attack-protection exemptions;
- player activity timestamps and honor points.

If a full redeploy plan relies on reconstructing these from logs or backend
state, the plan must name the source of truth for each class and include a
pre/post parity check. If any class is intentionally dropped, record the product
decision and compensation/rollback plan before broadcast.

The approved VEY-313 Base Sepolia `VeydriftGame` replacement path is a migrated
redeploy because the live game is a direct non-proxy deployment with existing
alpha state and nonzero game-held resource reserves. Follow
`docs/veydriftgame-replacement-plan-VEY-KANEO-313.md` before any replacement
broadcast.

## Done Gate

Do not mark a redeploy or upgrade task done unless the Kaneo workpad and PR
description include a migration verification note with:

- the preservation path used: proxy upgrade, no-state redeploy, or migrated
  redeploy;
- relevant transaction hashes and manifest paths;
- pre/post state evidence for player state and reserve backing;
- backend indexer reconciliation evidence;
- automated validation commands and results;
- manual browser or wallet QA evidence when user-facing gameplay state changed.

The full deploy script requires `VEYDRIFT_ALPHA_REDEPLOY_ACK`. That
acknowledgement is not a substitute for the evidence above; it only prevents
accidental broadcasts through the normal script path.
