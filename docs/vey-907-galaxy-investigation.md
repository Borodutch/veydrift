# VEY-KANEO-907: sparse Galaxy slot report

## Disposition

QA-20260929-080842-9CE7 is not a demonstrated slot-mapping defect. Its manifest says both that positions 2/3/4/12 contain no API objects and that rendering them as empty is wrong. Those empty rows are correct. The supplied 5:199 screenshot visibly aligns planet 1 (204 fields), Hyxx at 5, and the other visible identities with their positions. Position 15 is below the screenshot's crop, not proven absent.

No product behavior is changed by this PR. Current GalaxyView maps planets by explicit position, then renders all positions 1–15. It does not zip sparse API arrays with slot indices.

## Captured inputs

Public read-only API: https://api.veydrift.com/universe/galaxies/{galaxy}/systems/{system}. The 5:199 payload is the filing snapshot from 2026-09-29; the other four were fetched during investigation at approximately 16:34 UTC that day. Relevant response fields are committed in apps/frontend/tests/fixtures/galaxySlots.json; only top-level generator/chain metadata was omitted. They are fixed snapshots, not assertions about future live state.

| System | Planet positions | Empty positions |
| --- | --- | --- |
| 5:199 | 1, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15 | 2, 3, 4, 12 |
| 5:198 | 1, 2, 3, 4, 5, 6, 8, 9, 11, 12, 15 | 7, 10, 13, 14 |
| 5:201 | 1, 4, 5, 6, 8, 9, 10, 11 | 2, 3, 7, 12, 13, 14, 15 |
| 8:42 | 1, 3, 4, 5, 7, 8, 9, 10, 11, 14, 15 | 2, 6, 12, 13 |
| 8:43 | 1, 3, 4, 6, 7, 8, 11, 12, 13, 14, 15 | 2, 5, 9, 10 |

For 5:199, the expected identities include Planet 5.199.1 (unclaimed, 204 fields), Hyxx at 5 (occupied, planet ID 749, 224 fields), and Planet 5.199.15 (unclaimed, 234 fields).

## Reproducible regression evidence

Run from apps/frontend:

```sh
node --test tests/galaxySlots.browser.mjs
```

The existing test:touch-browser CI lane includes this regression. It uses the real GalaxyView, canonical backend query/store, API conversion, row components and CSS in an isolated local Chrome fixture, with only API transport mocked. No wallet/profile, gameplay transaction or live-browser QA is involved.

32 rendered states / 480 rows passed: 1440×900 and 390×900 DPR1, original and reversed API arrays, reload, coordinate-input Enter navigation through all five captured systems and back, synthetic trailing gaps, and an entirely empty system. Assertions cover every row number, planet name, fields, occupied/unclaimed/empty semantics, selection coordinates, and slot 15 visibility/hit testing after scrolling. The original capture 5:201 already has real trailing gaps at 12–15. Optional GALAXY_SLOTS_ARTIFACTS writes screenshots and row measurements.

Existing coverage: galaxyView.test.tsx checks owned names/public intel, actions and load errors; universeDisplay.test.ts checks payload hydration, occupancy, system URLs and home overlays; planetIdentity.test.ts checks sparse slot-aware artwork; galaxyCoordinateInput.test.ts checks coordinate draft/commit rules. The new regression closes the full rendered-row/navigation gap without changing the correct mapper.

## Limits and dedicated QA handoff

These are local current-source results, not proof that the historical deployed bundle was identical or that the authenticated app shell cannot clip/occlude a row. Original bundle: assets/index-4fklb9-Y.js, SHA-256 b6a28a0adcccca6d704cb55d6aa32a9b1d4eeb37a06e955293430e8b6f67b340. Original Telegram screenshots: 21509, 21511, 21512 in QA topic 4016080.

Dedicated QA should capture the current served bundle and same-time API payload, navigate Overview → Galaxy → 5:199, and compare all 15 rows after scrolling on desktop/mobile, reload and system switching. Only report failure with the exact differing position and planet identity; do not treat the viewport fold or intentional empty positions as omitted planets. Until that check, disposition is **original allegation contradicted; local reproduction passed; live QA pending**, not Done.
