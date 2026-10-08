# #57 Max flicker regression

The player runtime report has no recording or live reproduction. These are confirmed **local mounted-fixture** failures, not a claim to reproduce the player’s exact environment.

## Confirmed causes

- Batch Supply changed Max to Calculating… and inserted a status/cancel row. Restoring the original modal independently, the 1280px fixture measured button width changing 42.80 → 94.94px, input width 148.38 → 96.23px, and the source section moving 24px. Measurement waits for the modal entrance animation.
- Backend snapshot refresh recreates Supply source objects. Cancellation depended on options object identity, so equal-value refresh terminated pending work. Restoring the original hook fails the refresh regression (aria-busy becomes false). Values, including selected Set membership, now define invalidation; real inventory, eligibility, drive, route, draft and slot changes still cancel.
- Normal transport disabled Max when input equalled the maximum. Stock refresh broke equality, toggling disabled opacity with a transition. Restoring the original control fails the rendered opacity assertion (0.45 → intermediate 0.467811). Max is now an idempotent action, without equality-based disabled/opacity animation.

## Coverage

Run from apps/frontend:

- `node --test tests/batchSupply.browser.mjs`: production BatchSupplyModal and MissionCargoPicker at desktop/390/320px; pending/completed/cancelled geometry, focus, equal refresh, rapid replacement, stale results/errors, numeric-equivalent edits, repeated overrides, source/ship/mission/inventory/eligibility/drives/route/body/slot/pending invalidation, failure/retry/unmount; real-worker responsiveness and existing preview/launch checks.
- `bun test tests/batchSupplyMax.test.ts src/missionCreation.test.ts src/components/BatchSupplyModal.test.ts`: #55 remaining capacity, other-resource preservation and confirmation parity remain unchanged.

The browser fixture skips only unrelated planet-animation pre-encoding at Vite startup. It uses production components/styles and the real Max worker. No wallet or production browser is used.

## Verification limitations

Typecheck and playable JS/CSS/worker bundling passed. Normal build and complete frontend suite were attempted, but cold planet-animation derivative encoding exceeded bounded execution time. A scoped playable bundle omitting only that unrelated pre-encoding hook passed. The broad suite excluding serveHeaders/whitepaper cold-animation integrations ran 2,111 tests: 2,110 passed; unchanged landingTrailer localhost byte-range test returned HTTP 502 instead of 200, including an isolated retry. These are not green full-suite/full-build claims; CI still owns those gates.
