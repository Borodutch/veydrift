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


## Review repair at integration base ad12e062 (2026-10-04)

- Effective inventory and remaining production queues stay paired. Explicit null/inactive detail queues cannot resurrect overview work. Catalogs only use overview queues while the detail snapshot is absent, matching app/plan behavior. Regression: 17 interplanetary missiles, silo level 4, stale overview queue of 2 → Max 3; authoritative remaining queue of 1 → Max 2. Mounted Max interaction covered at 390/1280px.
- Shared currentResources selector distinguishes omitted legacy fields from explicit null. Null cannot fall back to raw settled balances or a stale spendable prop. Guards cover top bar, defense/shipyard, infrastructure/research, moon buildings/production, mission origins/composer, Supply source/destination, batch plans, finder and abandonment. Unknown moon balances display Unavailable; construction now uses the nullable converter rather than silently turning unknown into zero.
- Added focused real-consumer regressions for infrastructure/research, Supply versus rich roster, moon production/building/plans, body resource switches, zero/omitted fields and preserved wallet/network/auth recovery.
- Existing planet-picker completed-defense fixture now provides effective count 9 before and after mined settlement; route hydration, real cache-bypassing reload, overview navigation, incomplete-overview recovery and no-duplicate-credit assertions remain. Added mock-keychain flag for disposable automated Chrome profile.
- Existing Overview sizing fixture checks production accessible names rather than removed settlement text. A 16-entry stress queue still forces wrapping at 639px after removal of the tall settlement notice; clipping, compact independent mobile cards, desktop row alignment and navigation assertions remain unchanged.

### Repair verification

- Full frontend unit suite on final repair source: **2132 passed, 0 failed**, 153 files, 22,769 assertions (26.14s). Run with HTTP_PROXY/HTTPS_PROXY/ALL_PROXY (and lowercase variants) unset, NO_PROXY=localhost,127.0.0.1.
- Focused currentResources/currentState: **11 passed, 0 failed**, 58 assertions.
- Current-state browser: **passed**, 68 rendered viewport/mode combinations, including explicit-null catalog controls/top bar and actual missile Max interaction.
- Level Supply browser: **passed**, eight desktop/mobile building/moon/research/binary handoffs. Initial cold animation warmup exceeded the unchanged 120s timeout; warm rerun passed (10.62s).
- Overview sizing browser: **passed**, 40 viewport/mode combinations plus navigation/touch proof (4.58s).
- An initial overlapping cold run failed whitepaper dev/preview tests when Vite restarted animation preparation and timed out; warm final full unit run passed without weakening tests. New moon fixture initially lacked field/drive prerequisites; those fixture prerequisites were corrected, then it caught and verified the actual nullable-converter fix.
- Full planet-picker browser suite: **122 passed, 0 failed** (107.40s), including completed defense before/after settlement, hard reload, incomplete-overview hydration, transaction recovery and account/body-switch safety. Initial overlapping cold invocation stalled before scenarios and was stopped; isolated warm invocation completed.
- Final frontend TypeScript **passed**; production Vite build **passed** (6.34s; existing >500kB chunk warning). git diff --check passed.
- No known remaining defect in the assigned frontend repairs. Broader backend provenance/reorg/chronology proof and independent integrated review remain parent/backend responsibilities; this is not a claim that every unchanged entrypoint has live mounted QA. No personal-profile, wallet or live QA, transaction, board/PR/deploy action or commit performed by this repair lane.

### Second exact-head review repair

Player documentation now matches automatic mission/production completion: removed the retired 60-second Resolve fallback, funded-resolver/randomness instructions, and explicit/lazy-completion duties. Battle outcomes remain unknown until available; planet-founding settlement and legitimate combat probability formulas remain. Added docs regression; six docs tests and content/link checks pass.
