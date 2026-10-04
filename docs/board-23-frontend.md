# #23 frontend current-state lane

Base: 6c8d3de0d18bd160720640f142649cb581abe1c1. No backend/contract changes or live wallet QA. Integrate with the backend current-inventory lane; this frontend must not ship alone against the old canonical-defense API.

## Implemented paths

| Surface | Current-state consumer / behavior | Proof |
|---|---|---|
| Overview | Remaining defense queue only, honest empty state; removed settlement component; lifecycle badges use game language | Mounted mobile/desktop; overview unit suite |
| Defense catalog + detail | defenses authoritative effective count; remaining queue; removed awaiting field and completion control | Unit partial/final fixtures; browser selected details and compact list |
| Production plan, planet/moon | defenseRows + defenseQueue paired once for dome/silo limits; ignores canonical unsettled metadata | Dedicated catalog/plan capacity assertions, existing mounted plan regressions |
| Shipyard | Existing effective ships display and authoritative launchable manifest checks preserved | Production/manifest suites; backend lane owns quantity correctness |
| Infrastructure/research | Existing effective levels/current resources retained; chronology gates preserved, game-language pending mission warning | Existing app-helper tests; no upgrade-table edits (#20) |
| Moon | Existing effective ships/defenses; mission origin now uses resourcesAsOfNow before raw resources | Moon production tests and moon launch resource regression |
| Supply | Existing current resources + launchable inventory and fresh confirmation checks unchanged | App supply tests |
| Mission creation | Unavailable grouped forecast reasons fail closed to a safe message; readiness fails with ATTACKS_UNAVAILABLE semantic error; original preparation lock and eligibility checks retained | Composer unit tests, mounted safe forecast/readiness branches |
| Mission Control / detail | Removed Resolve props, callback, buttons, grace-period helper; pending battle/chronology/staged states remain unknown; useful automatic report feedback retained | Affected lifecycle branches mounted at 390/1280; chronology and recall regression suites |
| Public planet / rankings | Existing public current-state payload consumers unchanged | Backend integration responsibility; no local invented quantities |
| Finder | Debris fuel reads current resources first, explicit zero respected after spend; launch gates unchanged | settled < fuel <= current and current-zero regression |
| Forecasts | Never pass raw backend unavailableReason into battle detail or grouped composer; stale/missing/arrived/intel failure remains uncertain | Arbitrary diagnostic unit regression, mounted forecast branches |
| Rift | Existing API consumer unchanged; backend lane supplies current balance | Backend integration responsibility |
| Activity | Color determined by gameplay category, not projection provenance; one occurredAt timestamp; transaction link retained when available | Indexed/projected browser comparison, activity unit suite |

Removed DefenseSettlementNotice, defenseSettlement helper, their obsolete tests, and PlayableMvpApp finish-defense transaction plumbing. Low-level wallet ABI wrappers remain for compatibility/testing but no gameplay control calls them. Removed manual mission resolution plumbing rather than merely hiding a button. Backend automation remains responsible for progress; this lane did not validate deployment funding/health.

## Verification

- Isolated frozen dependency install (Bun 1.4.0 locally; CI uses repository pinned Bun).
- TypeScript check passed; production Vite build passed (existing large-chunk warning).
- Full exact-source frontend unit suite: 2112 passed, 0 failed (150 files); targeted lane suite: 551 passed, 0 failed. Two earlier local HTTP tests returned 502 because inherited proxy variables intercepted localhost; rerunning with HTTP(S)/ALL proxy variables unset and NO_PROXY=localhost,127.0.0.1 passed both and the complete suite. No product/test safeguards were weakened.
- node --test tests/currentState.browser.mjs: passed, 390px and 1280px, 58 rendered combinations across Defense, Overview, Mission Control/detail, forecasts, activity, readiness and grouped composer; visible text plus accessible labels/tooltips checked for retired diagnostics/actions. Screenshots at workspace artifacts/board-23-frontend/; local fixtures only, no wallet/API calls.
- Added browser suite to existing test:touch-browser list (CI already invokes it).
- Existing fake-DOM mounted Defenses/Overview regression now checks 78 → 81 → 101 effective units, backlog, refresh, mined settlement, no duplicate credit/no completion duty.

## Exact remaining integration gaps

Backend must provide effective defense/ship counts, trusted legacy provenance, remaining queues, cache-boundary invalidation, and stable activity identity/order. Browser never adds canonical unsettled batches itself. Backend due-mission uncertainty/chronology cannot be removed by this UI. No live resolver health/funding proof, live screenshots, account-switch backend/reorg proof, merge/deploy, or independent review is claimed by this lane. Dedicated QA and parent exact-head review/deployment still required. The fixture suite mounts modified branches; it is not an end-to-end live-wallet proof of every unchanged entrypoint.
