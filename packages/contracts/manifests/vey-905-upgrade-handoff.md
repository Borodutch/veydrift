# VEY-KANEO-905 — prospective chronology upgrade handoff

## Authorization and activation
Nikita approved prospective-only ordering in reviews-topic message #21475; this is **not** exact-head upgrade greenlight. Workers must not merge, sign, broadcast or deploy. Request the reviewed PR/head in Veydrift upgrades topic 4042963.

Game proxy (Base mainnet): `0xf397910F005151b09644228573a4353818D3755d`. ProxyAdmin: `0xc81609E77b5ea79d0CdA9794b75B65D567535cb9`. Canonical script: `script/UpgradeGame.s.sol`, empty upgrade calldata and complete fresh module graph. Changed writers include Game/embedded BatchTransport, Gameplay, DefenseHold, ACS, Colonization, Missile and PlanetManagement. Do not reuse old launch modules. **No Moon proxy upgrade.**

The activation boundary is the atomic Game implementation switch. Every subsequent successful allocation registers itself in the new inventory before the launch returns, even through old launch selectors, direct calls, delegates, body-aware launches or transport batches. The registration selector is self-only and accepts only the just-allocated Outbound mission. Registration is sticky through arrival, return, recall, holding and linked-fleet participation. No owner/player opt-out, initialization window, timestamp heuristic or separate activation transaction exists.

**No data migration/backfill:** there is no `syncFleetChronology` selector, no historical-ID scan and no rewriting/reseeding of existing mission state. Old active missions remain unregistered. Their direct arrival/return resolution remains available; old resolution indexes provide bounded best-effort lazy completion. Completed missions/results are untouched. Mixed-generation interactions intentionally retain the temporary legacy ordering risk accepted in #21475. A legacy event is not promised to appear in new-event chronology, but it cannot downgrade a new mission. Do not describe this as universal chronology for legacy fleets.

## New/new event rules
Order `(scheduled timestamp, kind, mission ID)`: arrival=0, return=1, hold expiry=2. Arrivals win return ties; combat at an inclusive hold end precedes hold removal. IDs only break final ties. Arrival affects target body; return affects actual origin body, including destroyed/replaced-moon fallback. Outbound round trips reserve home return even before survivors are known. Deploy reserves a return only if its target moon is missing/replaced. Linked participants share their lead battle but retain origin-return dependencies. Moon combat and Harvest share the debris field, without coupling unrelated planet/moon fleets.

Permissionless and lazy paths share the same guard. One earlier due return can land as bounded preparatory work; earlier combat is not recursively resolved. Arrivals and hold expiry settle target production through the scheduled cutoff, not delayed wall time. Each preparer scans/prunes at most 12 body entries. Body pruning/recall epochs invalidate saved proofs; Moon destruction/pointer change invalidates destination proofs. New player inventory visits at most 12 unique entries / 24 slot operations; old player-index fallback visits at most 12 entries. Registration performs a fixed number of body/player inserts per new mission, independent of historical mission count.

## Integration
`fleetMissionEligibility(uint256)` retains its three-word ABI: `(eligible, blockerMissionId, orderingReady)`. Third word is true immediately on this implementation, including for legacy missions; it is not migration completion. Strict UI requires eligible and orderingReady plus exact-call simulation. Funded workers require orderingReady and exact-entrypoint simulation, allowing bounded progress when eligible=false. Missing selector/RPC failure remains fail-closed. Every arrival and return receipt requires canonical status reconciliation: success may mean progress, not completion.

## Storage
Live prefix through slot 76 unchanged; all appends remain append-only. Reserved unused slots 77 (old return scan), 78 (abandoned backfill cursor) and 85 (abandoned completion flag) are never initialized. Active appends: 79 global destination epoch, 80 body inventory, 81 scans, 82 body epochs, 83 prospective player inventory, 84 prospective lazy cursor, 86 sticky registration mapping, 87 legacy lazy cursor. No mission struct changes or historical writes. Storage checker enumerates the exact layout.

## Release sequence (only after exact-head greenlight)
1. Independent Astra/high review and exact-head green CI; collect size/storage/policy tests and keyless Game-only fork.
2. Deploy compatible backend/keeper first: exact funded preflight, third-word support gate and both-leg canonical receipt reconciliation.
3. Authorized release owner executes canonical Game upgrade with empty calldata and fresh modules. Journal every transaction; reconcile unclear receipts, never auto-resend.
4. **No backfill step.** Verify old mission state preserved, immediate readiness and first new launch registration. Update manifest/config; run `scripts/veydrift-postdeploy-smoke.mjs`.
5. Frontend last; fresh Mission Control/Detail hidden-button proof; dedicated Testing handoff.

## Evidence status
Prospective local validation: **450 focused tests passed** (17 FleetChronology, 26 ScheduledReturns, 308 Game, 82 Moon, 17 combat parity). They cover no-initialization readiness, removed backfill selector, unauthorized relabeling, all six allocation routines and their public launch families, sticky recall/hold/linked classification, legacy completion and accepted old/new behavior, the exact return/impact fixture, no double credit, body isolation and bounded scans. One old synthetic historical-insertion fixture was replaced with a real newly allocated earlier-impact mission; no runtime guard was weakened.

Size gate passes: Game 24,542 bytes (34 bytes headroom), Gameplay 24,538 (38 bytes headroom), BatchTransport 15,826, DefenseHold 24,242, ACS 23,347, Colonization 22,261, Missile 18,908. Append-only storage, formatting, live-upgrade policy and whitespace pass. Logs: `/tmp/vey905-prospective-{chronotest-complete,scheduled-final,game-final,moon-final,parity-final,sizes-final,storage,policy}.log`. Independent exact-head review/full CI remain parent-owned.

Updated Game-only fork test compiles and now checks preserved allocation boundary/latest legacy mission bytes, unchanged legacy classification and immediate readiness without a backfill. **Live keyless fork remains unproven**: this worker ran it only with BASE_MAINNET_RPC unset, so its live path was skipped (`/tmp/vey905-prospective-fork-compile.log`). Earlier transport failures on the obsolete design are not proof. Require a terminal exact-design live fork result before release approval. No commits, live mutations, deployments, signing or broadcasts by this worker.
