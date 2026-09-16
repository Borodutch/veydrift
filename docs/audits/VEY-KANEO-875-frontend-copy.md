# VEY-KANEO-875 — Remove placeholder and debug copy from every frontend surface

Baseline: `61f1151e`. Scope: frontend copy only, including the sibling public stats UI. No contracts, backend APIs, game rules, transaction payloads, deployment configuration, dependencies, or CSS visibility rules changed.

## Audit method and inventory

Reviewed the TS/TSX literal and JSX-text inventory for **every non-test file in `apps/frontend/src`**, following constants, error builders, metadata, conditional branches and their rendering sites—not only route headings. The initial inventory contained 15,462 literal/template segments (including identifiers and CSS); 2,356 English multiword candidate segments were reviewed alongside targeted single-word/attribute searches (`verified`, `placeholder`, `debug`, `mock`, `demo`, `coming soon`, `TODO`, `indexer`, `backend`, `contract`, `snapshot`, `deployment`, etc.). Reviewed the public manual, HTML/Mini App metadata, server-rendered social metadata/cards, textual public assets, and `apps/stats/src/main.tsx`/HTML. Identifiers and comments are not treated as rendered copy.

The exact candidate ledger is [`apps/frontend/tests/fixtures/frontendCopyAudit.json`](../../apps/frontend/tests/fixtures/frontendCopyAudit.json). Each confirmed candidate records original text, replacement/deletion, source locations at audit time, and disposition. Locations may shift as dead blocks are removed. Template fragments are intentional: they cover assembled strings as well as literal sentences. This test-only ledger is not imported by the application or shipped as a public asset.

The reproducible guard scans production source, public textual assets and metadata by default, or every emitted textual asset with `--dist` (all JS chunks, HTML, JSON, Markdown, CSS, SVG/XML/text; hidden manifest directories included). The game frontend does not emit source maps; the sibling stats source map is scanned too. Third-party SDK identifiers and legitimate security terminology are not blanket-banned.

```sh
node apps/frontend/scripts/audit-frontend-copy.mjs
node apps/frontend/scripts/audit-frontend-copy.mjs --dist dist
node apps/frontend/scripts/audit-frontend-copy.mjs --dist ../stats/dist
```

## Surface coverage and dispositions

| Surface / producers | Audit result | Regression evidence |
| --- | --- | --- |
| `App`, `main`, `ComingSoonApp`, `FirstPlanetSettlementApp`, `PlayableMvpApp`, routes, settlement/wallet helpers | Removed deployment instructions, SDK diagnostic appenders, backend/indexing jargon and redundant invitation verification. Kept rejected/unknown transaction outcomes, balances, chain selection, duplicate-submission warnings, and retry/support actions. | `settlementScreen`, `walletFlow`, `playableMiniAppWallet`, `playableMvpApp`, `transactionRecovery`, `transactionActionGate`, `frontendCopy` |
| Overview, infrastructure, research, shipyard, defense, moon, Rift | Reworded implementation descriptions/errors; deleted generic research/moon fallback descriptions and obsolete crawler rollout clause. Rift retains one truthful unavailable heading rather than three filler statements. No feature was enabled. | `overviewPage`, `infrastructurePage`, `researchPage`, `researchViewState`, `shipyardPage`, `defensePage`, `moonPage`, `riftPage`, `frontendCopy` |
| Galaxy/universe, rankings/raid tables, planet/moon/player/alliance inspect pages | Removed indexed-row jargon and misleading “verified” attack tooltips; kept target-specific protection rules, stale/loading states and unknown-data distinctions. | `galaxyView`, `universeDisplay`, `rankingsPage`, `raidTargetFinderPage`, `inspectPages`, `alliancePage`, `allianceWarProtection` |
| Mission composer, mission control/detail, battle reports, cargo/route/queue models | Removed random-stream/oracle/contract-simulation plumbing; preserved uncertainty, no-guarantee warnings, missing technology/hold-time information and battle progress. Removed visible `No image` placeholder text; decorative image-sized fallback remains `aria-hidden`. | `missionCreation`, `missionCreationStationedDefenders`, `missionControl`, `missionControlPage`, `missionDetailPage`, `battlePreview`, `fleetMissionRules` |
| Dialogs/modals: level tables, combat stats, batch supply, shares, alliance/member controls, activity, planet effects, player profile/media | Removed activity indexing labels and technical combat descriptions. Kept destructive-action consequences, supply/fuel/slot limits, ownership-transfer warnings, privacy and single-use invite warnings, dialog names and close controls. | `combatStatsInfo`, `BatchSupplyModal`, `shareDialog`, `alliancePage`, `playerActivityDialog`, `overviewPage`, `navBar`, `frontendCopy` |
| Popovers/tooltips/badges/cards: TopBar, production/catalog helpers, protection badges, requirement flairs, planet status | Removed backend-production wording and redundant verification; kept energy shortage, capacity, effective crawler limits, requirements, costs and real readiness/protection state. | `topBar`, `topBarEnergyInfo`, `productionCatalog`, `buildingDetails`, `moonChanceStatus`, `rankingsAttackProtection`, `frontendCopy` |
| Toasts/banners/inline state: action notices, backend query errors, shared outage states, wallet errors | Removed raw HTTP/API codes from shared UI error messages while retaining `GameApiError.status/code/retryAfterMs/cause`. Preserved retry policy and alert/status roles. Updated copy-dependent recovered-wallet and rejection matchers to preserve existing behavior. | `actionNoticeAutoDismiss`, `gameApiError`, `gameUnavailableNotice`, `infrastructureNotice`, `frontendCopy` |
| Loading/error/empty: skeletons, page boundaries, catalogs, lists, landing, disconnected shell | Kept actual empty/loading/error state and accessible skeleton labels; simplified technical explanations rather than pretending missing values are zero or ready. | `loadingSkeletons`, `pageHeader`, `frontendCopy`, page/component tests above |
| Desktop/mobile: NavBar, TopBar, Layout, planet selector, responsive cards/dialogs | Shared string producers cleaned for both layouts. Deleted blocks rather than CSS-hiding text. Existing responsive sizing, reordering and focus semantics unchanged. | `topBar`, `navBar`, `navigationPlanetSelector`, `planetPickerInteraction`, `focusOutline`, `loadingSkeletons`; fresh visual QA remains post-deployment |
| Docs and metadata: `docs/content/docs.md`, `docsSource`, `miniAppMetadata`, HTML, `scripts/serve.mjs`, textual public files | Simplified beginner-facing indexing/backend prose, removed injected-wallet implementation wording, removed generated social-card “Benefits verified in-game”; kept checking availability/benefits before settlement. Reviewed generated metadata and no-data fallbacks. | `docsPage`, `formulaConformance`, `miniAppMetadata`, `serveHeaders`, source and emitted-asset guard |
| Sibling stats frontend | Removed HTTP/debug exception text and snapshot/canonical jargon from outage/footer copy. Retained actual telemetry coverage, block numbers, event/transaction distinctions and automatic retry. | `check:stats` (tests, TypeScript, build), emitted-asset guard |

## Ambiguous candidates deliberately retained

- **Input `placeholder=` attributes**: wallet-address/numeric/URL/name/code examples are input guidance, not unfinished app copy. Labels remain intact. No CSS `placeholder:*` class is user-visible debug text.
- **“Alliance invitation could not be verified”**, “Could not verify settlement funding”, checking ownership/signatures/network, and attack-protection failure: genuine security gates. Only redundant *successful verification* wording was removed; checks and disabled-state logic remain.
- **Loading / refreshing / syncing / pending / ready / unavailable / unknown**, explicit empty queues/lists, and **“Select ships to calculate”**: distinguish real states and next steps. They must not be replaced with fabricated values or silently suppressed.
- **Current vs battle-time forces, historical composition unavailable, war scores/rosters at declaration**: needed to avoid misleading predictions and protection claims. Implementation vocabulary was simplified without deleting the underlying caveat.
- **Onchain transactions, gas on Base vs Ethereum Mainnet, token approval/withdrawal, wallet addresses, block/transaction proof links**: consequences and security information, not developer filler. The stats app's block coverage and contract/event metrics are the product itself.
- **Detailed formulas in the manual**, rounding/basis points/rapidfire limits: player/agent reference material. Beginner pipeline prose was simplified; mathematical rules and examples were preserved.
- **Real feature unavailability** (Rift, restricted vessel, no moon) and genuine legacy/migration states: retain an honest state; do not enable unfinished features or delete recovery/migration flows.
- **Product/marketing prose**, entity descriptions, social-card identity fallbacks, intentional artwork: not diagnostic or placeholder scaffolding. These were not redesigned.
- **`mockUniverse` filename, API schemas, enum values, source/freshness fields, error codes and source-only assertions/logs**: internal machinery, not labels. Do not rename protocol values or strip diagnostic metadata used for safe retry. SDK-owned verification/security UI remains outside authored game copy.
- **User-authored names/descriptions/media and unknown API-supplied domain state**: not globally keyword-filtered. A player can legitimately write “verified”; blanket filtering would alter player content or conceal actionable warnings. Known backend `unavailableReason`/`fleetLaunchUnavailableReason` implementation notices are translated with `playerNotice` at the frontend consumers (including API-fed group battle forecasts), while flags, data and unknown actionable messages are preserved. Backend source was read to enumerate these producers; it was not edited.

## Validation and handoff

See the PR/Kaneo handoff for final command results and head SHA. The full frontend suite has a **host-environment blocker** in the existing `whitepaper.test.ts` unknown-route HTTP assertion: the handler returns `404 / Not found` directly, but the test's loopback `fetch` receives `502 / Secret egress proxy refused the request.` The test and route logic were not weakened or changed. A permitted sandbox runtime was unavailable. No proxy/TLS safeguard was disabled.

Independent GPT-5.6 Sol review, merge/main CI, Easypanel deployment, and fresh live desktop/mobile screenshot QA remain parent-owned gates. No live QA or deployment is claimed by this implementation audit.

### Implementation verification (2026-09-16)

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed; no lockfile/dependency changes. Local Bun 1.4.0, Node 26.8.2. |
| `bun run check:frontend` | Passed: image variants, TypeScript, production build, settlement build, test-API config check. |
| `bun run build:frontend` | Passed; final production entry `index-QMT3uQX5.js`. Existing >500 kB chunk advisory remains. |
| Source copy audit | Passed: 148 text sources, 223 candidate strings, zero matches. |
| Settlement emitted-asset audit | Passed: 42 textual assets, 223 candidates, zero matches; entry `index-settlement-CU-7QGpm.js`. |
| Production emitted-asset audit | Passed: 42 textual assets, 223 candidates, zero matches. |
| `bun run check:stats` | Passed: 7 tests, TypeScript, production build. |
| Stats emitted-asset audit | Passed: 4 textual assets including source map, 223 candidates, zero matches. |
| `bun run check:docs` | Passed: link test, links across 23 Markdown files, content check. |
| `cd apps/frontend && bun test tests/frontendCopy.test.tsx` | Passed: 9 tests / 82 assertions. |
| `bun run test:frontend` | **Not green:** 1,830 pass / 1 fail / 9,167 assertions across 130 files; only the existing loopback HTTP assertion described above fails. |
| `cd apps/frontend && bun run test:touch-browser` | **Setup blocked:** shared hook cannot connect to local Chrome CDP WebSocket; 0 pass / 83 fail due to the hook. No browser gameplay/assertion pass claimed. |
| `git diff --check` | Passed. |

The implementation is intentionally handed off as a **draft**, not review-ready, while required runtime checks are blocked. Re-run the unchanged failing suites in an authorized runner supporting local HTTP/CDP before promoting the PR and moving the canonical task to In Review. Do not disable the egress proxy or weaken the tests. Parent owns independent Sol review and subsequent lifecycle gates.
