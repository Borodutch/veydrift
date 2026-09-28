# VEY-KANEO-905 — keyless contract handoff; exact PR/head authorization required

## Proxy and modules
Game proxy (Base mainnet): `0xf397910F005151b09644228573a4353818D3755d`. ProxyAdmin: `0xc81609E77b5ea79d0CdA9794b75B65D567535cb9`. Canonical script: `script/UpgradeGame.s.sol`, empty upgrade calldata, complete fresh module construction. Runtime changes: Game, embedded BatchTransport, Gameplay, PlanetManagement, Missile, DefenseHold. All modules share the append-only storage layout. No mixed old/new writer set. **No Moon proxy upgrade**; UpgradeGameFork no longer silently upgrades Moon. Workers must not merge/deploy/sign/broadcast.

## Event rules
Order is `(scheduled timestamp, kind, mission ID)`, with arrival=0, return=1, hold expiry=2. Arrival wins return ties; combat at an inclusive hold end precedes removal of the stationed roster. IDs only break final ties. Arrival affects target body; return affects actual origin body (including destroyed/replaced-moon fallback). Outbound round trips reserve their scheduled return while survivors are unknown.
Linked ACS/counterplay participants are one lead-battle target event, avoiding participant/lead cycles, but keep individual origin return reservations. Existing linked return times still shift with actual battle completion; guards re-read current timestamps. Planet/moon fleet inventories stay separate. Harvest and moon combat coordinate their shared debris field without making an unrelated planet return depend on moon combat.
Every permissionless arrival/return and lazy settlement enters the same guard. One earlier due return may be landed as preparatory work; earlier combat is never recursively resolved. Non-combat arrival and hold expiry settle production only through their scheduled cutoff, not the delayed resolver block.

## Required bounded legacy migration
Old indexes omit legacy holds/ACS/counterplay/recalled fleets. Complete indexes scan **every allocated mission ID**, never trusting an off-chain omission-free list. Call `syncFleetChronology(uint256 maximum)` with maximum 1..256. Each call scans at most maximum historical IDs and inserts at most **32 active missions**, separately bounding expensive writes. Returns `(through,ready)`; emits `FleetChronologyIndexed(through,nextId,ready)` when advancing. No fleet balance credit occurs. Cursor is slot 78; readiness is `through + 1 == nextFleetId`.
Journal every migration tx/receipt/cursor; reconcile uncertain receipts instead of resending. Resume against the current implementation and authoritative cursor. Migration is complete only when ready=true at the current allocated-ID boundary. This backfill is part of the exact upgrade handoff, not an optional follow-up.
Resolvers/lazy calls auto-scan at most four new IDs and fail closed until complete. Each preparer processes/prunes at most 12 body entries. Terminal entries are pruned. Per-body pruning/recall epochs invalidate affected proofs, including zero-duration same-block recalls; unrelated settlement does not restart a body scan. Moon destruction or pointer changes invalidate proofs because they change return destinations. Lazy settlement uses complete player inventories and visits at most 12 unique entries / 24 slot operations per call, sorting the selected due events.

## Compatibility
New view: `fleetMissionEligibility(uint256) returns (bool eligible,uint256 blockerMissionId,bool inventoryReady)`. Backend must require eligible && inventoryReady and additionally simulate the existing entrypoint for randomness/runtime gates. Missing selector, incomplete inventory, or unfinished oversized proof fails closed. Empty successful eth_call alone is not authoritative eligibility.
**Every mission type and either leg may return progress-only success.** Keeper/backend must read canonical state after receipts and retain Outbound/Returning/Recalled until the actual transition. Mature return timestamp is not credit/archive proof.

## Storage
Live prefix through slot 76 unchanged. Slot 77 is the preceding branch return-scan mapping, now reserved rather than authoritative. Appends: 78 inventory cursor; 79 moon-destruction proof epoch; 80 body inventories; 81 mission scans; 82 body pruning/recall epochs; 83 complete player inventories; 84 lazy player cursors. No existing struct reordered. Storage guard enumerates appends.

## Authorized rollout order
1. Exact-head Astra review, tests, size/storage/policy, and Game-only keyless fork including migration. Record exact PR/head and artifacts in greenlight request.
2. Compatible keeper/backend first: both-leg post-receipt reconciliation and fail-closed readiness.
3. Only authorized rollout owner executes canonical Game upgrade with empty calldata after exact greenlight.
4. Journaled bounded backfill until current inventory readiness is proven.
5. Reconcile config/manifest; run `scripts/veydrift-postdeploy-smoke.mjs`; verify live statuses/readiness.
6. Frontend last; fresh Mission Control/Detail hidden-button proof; then Testing.

## Local validation — final implementation, before parent commit/review
- **420 focused tests passed:** 13 FleetChronology, 19 ScheduledReturns, 306 Game, 82 Moon. Logs `/tmp/vey905-verified-{inventory,scheduled,game,moon}.log`. Includes the exact 93742/93790 reverse-order replay, all three original red amended-scope probes, legacy return/hold inventory, linked-event cycle avoidance, bounded scans/migration, pruning/recall invalidation, lazy ordering, and independent body snapshots. This is focused coverage, not the entire contracts package suite.
- Upgrade size build passed: Game **24,542 bytes (34 bytes EIP-170 headroom)**; Gameplay 24,459; BatchTransport 15,782; PlanetManagement 23,282; DefenseHold 24,146. Full table `/tmp/vey905-acceptance-sizes.log`. Do not add facade code without remeasuring.
- `bun run check:storage`, formatting, live-upgrade policy, and diff whitespace checks passed. Storage log `/tmp/vey905-acceptance-storage.log`.
- **Live keyless fork is blocked, not proven.** The corrected Game-only/full-backfill test compiled successfully but `BASE_MAINNET_RPC=https://mainnet.base.org forge test --match-path test/UpgradeGameFork.t.sol -vv` failed at `vm.createSelectFork`: Foundry RPC TLS `invalid peer certificate: UnknownIssuer`. Log `/tmp/vey905-final-keyless-fork.log`. It failed before creating a fork or running the upgrade; TLS verification was not disabled. Rerun in a supported trusted RPC environment before release approval. Full backfill may require one cold storage read per historical ID; provision a suitable read-only fork/cache RPC rather than assuming the public endpoint can serve it quickly.
- Existing unrelated VEY-741 manifest remains stale and was not relabeled as fresh evidence. Independent exact-head review and PR publication remain parent-owned. No commits, deployment, signing, or broadcasts by this contract worker.
