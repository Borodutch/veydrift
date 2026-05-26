# Espionage And Hidden-Intel Decision

## Decision

Veydrift excludes classic OGame espionage and hidden-intel parity by design.
Gameplay remains public onchain state, and the product will not add espionage
probes, hidden spy reports, fog-of-war target state, private fleet intent,
committed hidden roots, or an authoritative hidden-intel backend.

This is a product decision, not a temporary MVP gap. If Veydrift later revisits
classic hidden-intel parity, that work requires a new product decision and a
separate contract architecture plan before any probe/report UI is added.

## Rationale

Classic OGame uses espionage probes and reports as a core source of information
asymmetry for fleet hunting, target selection, noob protection, combat planning,
and debris setup. Veydrift instead makes the chain and public indexers the
source of truth for game state. Any rule that protects defenders or constrains
raids must be enforceable by contracts or reconstructable from public events.

Adding hidden intel would conflict with the current architecture because it
would require at least one hidden-state authority:

- Contracts would need private or committed state for scan results, fleet
  intent, target inventory, or reveal permissions.
- The backend would become an authoritative game-state service instead of a
  cache/indexer.
- The frontend would need to hide state that remains visible to chain readers,
  creating a false privacy model.

## Explicit Non-Parity

Veydrift does not implement these classic OGame mechanics:

- Espionage Probe ships or probe-only fleet missions.
- Espionage Technology as a scan-strength or reveal-depth system.
- Spy reports that reveal otherwise hidden resources, buildings, fleets,
  defenses, research, or activity.
- Hidden enemy planet state, hidden inbound hostile missions, or fog-of-war
  target inspection.
- Anti-raid rules that depend on spy friction, private preimages, hidden
  backend decisions, or non-public intelligence.

## Replacement Model

Veydrift anti-raid and counterplay balance must come from public, enforceable
mechanics:

- Protected storage, loot caps, bashing limits, and score protection.
- Public fleet commitment, travel time, fuel cost, recall limits, and return
  exposure.
- Public debris, moon chance, combat, harvest, missile, ACS, and intercept
  events as those systems ship.
- Frontend/backend previews that explain contract-backed rules without becoming
  the rule authority.

The Galaxy UI surfaces this directly with public-intel copy so players do not
expect probe scans or hidden spy reports.
