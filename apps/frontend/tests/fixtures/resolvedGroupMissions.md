# Resolved group mission capture

Captured read-only on 2026-09-29 from `https://api.veydrift.com/mission/{94886,94887,94888,94889}` and `/battle-report/94880`. JSON retains the four mission summaries and one canonical report. No wallet operations or combat replay.

- All four are distinct resolved ACS participant missions against planet812, leader94880.
- Report block51960775, transaction `0x0c51a53cdebcac1790c14139680cc8b8844cce874c745c3cf54dbec58c32c0aa`, six rounds, actual Draw.
- Seven participants: 94880,94881,94886,94887,94888,94889,94911. Fleet compositions differ; all loot shares zero.
- Combined attacker losses: 2,081,000 metal +1,421,000 crystal +401,000 deuterium =3,903,000; defender losses zero. Per-participant attacker losses are not emitted/exposed and must not be inferred.
- The forwarded Telegram21553 image shows four rows, but original wallet/filter/full report are unknown. The incoming fixture uses the target owner explicitly; it does not identify the screenshot viewer. This is a local real-component reproduction, not dedicated live QA.

`node --test tests/resolvedGroupMissions.browser.mjs` checks five viewport widths (1440,1100,791,390,320), uncut badges, route separation, desktop column alignment, no horizontal overflow, actual Draw/shared scope, keyboard disclosure and separate participant/canonical actions. Set `GROUP_MISSIONS_ARTIFACTS` to save screenshots/measurements. Dedicated post-deploy QA remains required.
