# Public-State Anti-Raid Balance Primitives

Veydrift gameplay state is public onchain state. Planets, resources, fleets, defenses, queues,
combat reports, debris/wreck fields, alliance/war relationships, colonies, and moons are intended
to be plainly indexable from contracts and events. The backend and frontend may cache or explain
this state, but they must not become hidden-state authorities.

Because attackers can index exact targets, anti-raid balance must come from contract-enforced
opportunity costs, rate limits, and defender recovery rather than espionage friction or privacy.
The shared constants and pure helpers live in
`packages/contracts/src/libraries/VeydriftAntiRaidPrimitives.sol` so fleet, combat, alliance, and
Galaxy UI work can preview the same rules the contracts enforce.

## Primitive Surface

- Fleet slots: `1 + Computer Technology level`, with launched ships and cargo unavailable until
  return or final resolution.
- Travel and fuel: missions have a minimum travel time, distance-based travel seconds, and a
  deuterium fuel cost derived from committed ship count and distance. The current contract
  intentionally keeps this as the Veydrift MVP formula, `5 minutes + distance` for one-way travel
  and `shipCount + floor(shipCount * distance / 10000)` for fuel. It does not yet model selected
  mission speed, per-ship consumption, or drive-technology speed bonuses, so UI previews must mirror
  this contract formula exactly instead of presenting classic OGame mechanics the contract will not
  charge or store.
- Recall: recalled fleets still spend fuel, cannot return faster than the minimum recall window,
  and use contract-calculated return timing.
- Hostile visibility: hostile inbound missions become publicly highlighted inside the reveal
  window. The UI can show this earlier, but contracts must treat the reveal threshold as canonical.
- ACS defend/intercept: defenders can join only before the ACS cutoff window so public state does
  not enable zero-risk last-second defense stuffing.
- Bashing and cooldowns: attacker/defender/planet attack counters use a rolling window, a maximum
  attacks-per-window value, and a per-target cooldown. War exceptions must be explicit onchain
  alliance/war state.
- Score protection: attacks against low-score defenders are blocked when attacker score exceeds
  the configured score ratio, unless a contract-recognized war/alliance exception applies.
- Loot caps and protected storage: raidable resources are computed from exposed balance after
  protected storage and then capped by both loot percentage and committed cargo capacity.
- Defender recovery: wreck-field and defense-repair basis points are contract constants so combat,
  Space Dock, and report/indexer work share one recovery model.

## Follow-Up Ticket Coordination

- VEY-118/VEY-128 should use the fleet slot, fuel, travel, recall, and in-flight commitment helpers.
- VEY-119/VEY-129 should store attack counters and total-score gates against the bashing and
  score-protection primitives.
- VEY-120 combat resolution should use the loot, cargo, wreck-field, and defense-repair helpers.
- VEY-114 alliances/ACS should provide the onchain war/alliance exception state and ACS defend or
  intercept authorization checks.
- Missile and moon/combat tickets should not add hidden intel or espionage dependencies; they
  should emit public reports/events and rely on these cost/recovery gates.

## Product Constraint

No anti-raid rule in Veydrift should depend on private preimages, zk commitments, hidden backend
oracles, spy reports, or espionage probes. If a rule matters for balance, the contract must either
enforce it directly or expose enough canonical state for another contract path to enforce it.
