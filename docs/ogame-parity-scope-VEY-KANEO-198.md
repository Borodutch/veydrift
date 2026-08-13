# VEY-KANEO-198 OGame Parity Scope

Date: 2026-05-27

This record classifies the known places where Veydrift intentionally differs
from classic OGame. Parity tickets should use this document as the default scope
boundary before changing contract rules, backend projections, or frontend copy.

## Decisions

| Mechanic | Decision | Reason |
| --- | --- | --- |
| Public onchain state | Keep as product deviation | Gameplay state must be reconstructable from contracts and events; hidden target state is out of scope. |
| Espionage probes and hidden reports | Exclude from parity mode | VEY-KANEO-196 records this as a permanent public-state architecture decision. |
| Interdimensional Rift Stabilizer and resource token bridge | Keep as Veydrift mode | Token reserve flows are core Veydrift economy plumbing, not an OGame mechanic. |
| Protected storage, loot caps, bashing counters, score protection | Keep as Veydrift public-state counterplay | These replace hidden-intel friction with contract-enforced anti-raid limits. |
| Space Dock wreckage and repair | Keep as Veydrift recovery layer | Current recovery is explicit contract state and can coexist with OGame-style combat/debris rules. |
| Dreadstar label | Keep as Veydrift copy over classic superweapon semantics | The catalog keeps the classic id/cost/stat role while using Veydrift-facing naming. |
| ACS defend, intercept, and return exposure | Keep as public-state implementations | The behavior should track classic fleet counterplay where possible, but visibility remains public. |
| Markets and transferable planet ownership | Defer | Not part of the current OGame parity batch or MVP gameplay authority. |

## Parity Mode Rule

Classic OGame parity work should replace formulas, costs, timing, combat,
debris, moon, fleet, and scoring behavior only where doing so does not require
hidden state or removal of explicit Veydrift product systems. If a parity change
would conflict with the decisions above, open a scope ticket instead of silently
mixing modes.

## UI Copy Rule

Player-facing surfaces should avoid implying that Veydrift-only systems are
classic OGame mechanics. Resource bridge copy should identify the Rift as
Veydrift-specific, and Mission Control/Galaxy copy should frame target intel as
public contract state rather than espionage.

## Follow-Up Hooks

- VEY-KANEO-196 remains the detailed decision for espionage and hidden intel.
- Future parity tickets should cite this record when they keep a Veydrift-only
  mechanic instead of replacing it with classic behavior.
- If a true selectable "classic mode" is introduced later, this document should
  become the migration checklist for mode gates.
