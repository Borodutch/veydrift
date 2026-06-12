# VEY-474 — API Simplification Implementation Spec (EPIC tracker)

> EPIC / TRACKER. Do not implement this ticket directly. Each numbered step below
> is its own Kaneo child ticket + PR + GPT-5.5 review + Kimi live QA + deploy,
> landed **one at a time** to avoid parallel Codex workers clobbering the shared
> API client/types on a LIVE game. Children for steps 3–7 are created only once
> the prior step lands.

Architecture directive (Nikita, 2026-06-12). See also memory:
`veydrift-api-architecture`, and prior tickets VEY-353 / VEY-463 / VEY-468.

## Principles (restated, with code anchors)

- **Frontend = thin wrapper.** Renders what the backend returns. No game-state
  calculation of its own and no knowledge of the contract or lazy reconciliation.
  Allowed frontend calcs are presentational/derivable only: time-to-build,
  affordability, progress-bar fill.
- **Backend = simple API that hides lazy reconciliation.** Presents fully-settled
  state as if everything already-done is done. **No `real` vs `unreconciled`
  distinction is exposed.** Currently-available resources must come from the
  contract's `previewResources(planetId)` (stored + uncollected production accrued
  to head, capped at storage — the exact value a spend would have available).
- **One simple endpoint per surface**, minimal payload; frontend derives the rest.

## Current state (as of 2026-06-12, branch `main`)

Backend is a single `Bun.serve` handler — `apps/backend/src/server.ts` — routing by
`url.pathname`, plus a `/graphql` endpoint. Per-surface read models live in
`apps/backend/src/readModels.ts` (`deriveBuildingRows`, `deriveShipRows`,
`deriveDefenseRows`, `deriveTechnologyRows`, `deriveInfrastructureFields`, …).

Per-surface wallet endpoints **already exist** (all under `/wallet/<addr>/…`):
`settlement`, `settlement-funding`, `planets`, `queues?planetId=`, `infrastructure`,
`moon`, `shipyard`, `defenses`, `research`, `rift`, `alliance`, `profile`; plus
global `/missions`, `/mission/<id>`, `/battle-reports`, `/highscores`,
`/universe/…`.

Frontend central API client is `apps/frontend/src/walletFlow.ts`
(`fetchWalletInfrastructure` / `…Shipyard` / `…Defenses` / `…Research` / `…Queues` /
etc., and the `Chain*State` response types). Resource/derived logic lives in
`canonicalResources.ts`, `chainState.ts`, `overviewData.ts`, `gameStateCache.ts`.

**Leak points the EPIC must remove** (these expose the real/unreconciled split or
keep contract logic in the frontend):

- `Chain*State` types carry `productionAvailable` / `unavailableReason`, and
  `WalletSettlementResponse.indexer.indexedState: "healthy" | "reconciling" | "stale"`
  (`walletFlow.ts`). These surface backend reconciliation status to the UI.
- A direct `previewResources(planetId)` `eth_call` helper still exists in the
  frontend (`walletFlow.ts` ~L1691–1710, `GAME_SELECTORS.previewResources`), despite
  VEY-463 ("remove all direct RPC reads"). `previewResources` must be a **backend**
  responsibility; the frontend reads available resources from the resources endpoint.

So this EPIC is mostly **simplification/consolidation of existing endpoints**, not
greenfield: shrink payloads, fold reconciliation status out of the contract, move
the remaining contract reads server-side, and strip frontend game-state calc.

## Target endpoints (one per surface, minimal payload)

| Surface | Endpoint | Backend-owned (authoritative) | Frontend-derived (OK) |
|---|---|---|---|
| resources | `/wallet/<a>/resources?planetId=` | currently-available resources (from `previewResources`) + production rate/hr | — |
| overview | `/wallet/<a>/overview?planetId=` | job queue, fleet, current planet | — |
| infrastructure | `/wallet/<a>/infrastructure?planetId=` | current infra levels + current queue | costs, effects, build timing |
| defenses | `/wallet/<a>/defenses?planetId=` | current defense counts + current queue | costs, build timing |
| research | `/wallet/<a>/research?planetId=` | current tech levels + current queue | costs, build timing |
| shipyard | `/wallet/<a>/shipyard?planetId=` | current ship counts + current queue | costs, build timing |
| mission-control | `/wallet/<a>/missions…` + `/mission/<id>` | fleets/missions in settled, ready-to-render shape | countdowns, ETA labels |

Every payload omits `real`-vs-`unreconciled` fields, `productionAvailable`,
`unavailableReason`, and indexer health flags. The backend always returns settled
truth or a clean error; it never asks the frontend to reconcile.

## Sequencing (one ticket + PR + deploy each)

1. **Resources foundation = VEY-KANEO-473** *(in-progress)*. Serve a
   `previewResources`-backed settled balance as the single source for display +
   affordability; fixes the build-revert / bar-vs-affordability bug. Establishes
   the thin-frontend + backend-authoritative pattern. **Backend** computes available
   resources via `previewResources(planetId)`; **frontend** drops its direct
   `previewResources` eth_call and reads the resources endpoint.
2. **Infrastructure thin-wrapper cleanup = VEY-KANEO-472** *(in-progress)*. Restore
   build/research time estimates as a **frontend** presentational calc (regressed by
   #82x); strip any infra game-state calc that belongs server-side.
3. **overview endpoint + thin overview page.** Backend returns job queue + fleet +
   current planet pre-settled; `overviewData.ts` becomes render-only.
4. **infrastructure endpoint simplification.** Levels + queue only; frontend derives
   costs/effects/timing from the static catalog.
5. **defenses, research, shipyard** — each its own ticket; counts/levels + queue
   only; reuse the `deriveXRows` read models, trim reconciliation fields.
6. **mission-control simplification.** Settled, ready-to-render fleets/missions.
7. **Final pass.** Confirm the frontend does zero contract / lazy-reconciliation
   logic (no `previewResources` eth_call, no `productionAvailable`/indexer-health
   branching); deploy backend **and** frontend.

## Per-step acceptance criteria (applies to each child ticket)

- Endpoint returns minimal settled payload; no `real`/`unreconciled`/indexer-health
  fields in the response or the frontend type.
- Frontend surface renders purely from the endpoint; only time-to-build /
  affordability / progress-fill are computed client-side.
- No new direct RPC/`eth_call` reads in the frontend; `previewResources` stays
  server-side.
- Existing backend unit tests pass; add/adjust read-model tests for the trimmed shape.
- GPT-5.5 reviews diff vs these criteria; Kimi runs live QA on `test.veydrift.com`;
  deploy backend + frontend together.

## Risk / coordination notes

- **Live game.** Land one surface at a time. The shared blast radius is
  `walletFlow.ts` (types + fetchers) and `gameStateCache.ts` on the frontend, and the
  `server.ts` route block + `readModels.ts` on the backend — keep each child's diff
  scoped to one surface to avoid clobbering.
- Removing `productionAvailable`/`unavailableReason`/indexer-health is a breaking type
  change; do it surface-by-surface, not in one sweep.
- Keep `gameStateCache` sessionStorage hydration (VEY-242) and anti-snapback gates
  intact while trimming payloads.
