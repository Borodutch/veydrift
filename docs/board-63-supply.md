# #63 Supply source-list redesign

Supply now has an always-visible request/Max toolbar and one source list, rather than accordion sections plus a duplicated proposed-shipment list. Each source retains name/coordinates, available resources, selected editable cargo, available/planned ship counts and direct type toggles. Unselected/unavailable rows remain visible. Transport/Deploy are accessible pressed-state icon buttons at the title right; behavior explanations are removed. Footer remains fixed with totals, fuel, ETA and launch gating.

The global request is the auto-allocation goal; row edits remain explicit per-source overrides with Auto restoration. The concise Needed/Planned/Remaining summary distinguishes the goal from planned cargo. Existing goal-review, frozen draft, preflight, fuel/ship/slot/body limits and no-automatic-launch behavior are retained.

See board-63-max.md and board-63-preload.md for measured baseline/after performance and request/payload evidence. No endpoint, contract, or backend service change is required.

## Implementation validation

- Full frontend unit suite: 2,193 passed (Bun1.4.0); focused component tests also pass.
- TypeScript and frontend normal/settlement builds pass.
- Mounted production Supply modal: desktop 1280px and mobile 390/320px, short 568px viewport, ship/source toggles, both missions, cargo editing, effective inventory, cancellation/stale events, keyboard, focus and scrolling all pass.
- Level Supply building/moon/research/binary entrypoint fixture passes at desktop/mobile. Mounted production preflight/coordinator/wallet fixture passes, including changed-goal repeated confirmation and final-send identity races.
- Local screenshots are fixtures, not deployed QA.

## Release ownership

Implementation phase only: independent exact-head review and PR publication precede dispatcher review/merge. Deploy only changed frontend service after green required CI; verify running SHA. Dedicated QA must capture fresh live desktop/mobile screenshots, mode controls/source rows and nine-source Max timing, attach to #63 and report in QA topic4016080. No foreground/manual wallet QA or transaction was performed here.
