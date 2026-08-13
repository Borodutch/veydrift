# VEY-KANEO-105 Catalog Audit

Source basis: a legacy space-strategy catalog audit of dependencies, buildings, ships, defenses, formulas, and missile silo slot rules. Veydrift intentionally keeps faster MVP timing in `VeydriftFormulas`, but the catalog IDs, base costs, and unlock gates should stay internally consistent with the base Veydrift catalog.

Supersession note: VEY-KANEO-117 makes Veydrift public onchain state final
product direction, and VEY-KANEO-111 removes espionage from Veydrift scope.
Espionage-named entries below are historical catalog notes or
legacy IDs only; they are not guidance to implement probe scans, espionage
reports, hidden enemy-state reveal, or fog-of-war.

## Scope Decision

Implemented in this task:
- Planet buildings already present in the Solidity enum are exposed in the frontend catalog.
- The modern/core `Crawler` unit is added as ship id 16, appended after existing ids to avoid shifting saved or UI mappings.
- Ship, defense, missile, and research dependency metadata is tightened to the canonical dependency tree.
- Missile Silo capacity helpers are added: Anti-Ballistic Missile uses 1 slot, Interplanetary Missile uses 2 slots, Missile Silo capacity is 10 slots per level.
- Small and Large Shield Dome one-per-planet caps are exposed through catalog helpers.

Out of scope for the current first-planet MVP:
- Moon systems: Lunar Base and Jump Gate need moon ownership, moon fields, and jump cooldown/state.
- Space Dock / repair dock behavior needs combat debris/repair accounting.
- Lifeforms, classes, officers, and marketplace/event bonuses are outside base catalog parity.

## Buildings

| Catalog item | Veydrift status | Notes |
| --- | --- | --- |
| Metal Mine | implemented | Base cost matches Veydrift contract. |
| Crystal Mine | implemented | Base cost matches Veydrift contract. |
| Deuterium Synthesizer | implemented | Base cost matches Veydrift contract. |
| Solar Plant | implemented | Base cost matches Veydrift contract. |
| Fusion Reactor | implemented catalog, production pending | Solidity/frontend catalog present; dependency now Deuterium Synthesizer 5 + Energy 3. Fusion energy output remains a formula follow-up. |
| Robotics Factory | implemented | No external prerequisite. |
| Nanite Factory | implemented catalog | Dependency now Robotics Factory 10 + Computer 10. Nanite speed formula is not yet active in MVP timings. |
| Shipyard | implemented | Dependency Robotics Factory 2. |
| Metal Storage | implemented | Base cost matches Veydrift contract. |
| Crystal Storage | implemented | Base cost matches Veydrift contract. |
| Deuterium Tank | implemented | Base cost matches Veydrift contract. |
| Research Lab | implemented | Contract currently keeps Robotics Factory 1 as a Veydrift MVP gate; the canonical rules have no structure prerequisite. |
| Terraformer | implemented catalog | Dependency now Nanite Factory 1 + Energy 12. Field expansion behavior remains pending. |
| Alliance Depot | implemented catalog | Catalog item kept, but alliance logistics behavior is not active. |
| Missile Silo | implemented catalog/rules | Dependency now Shipyard 1; missile capacity helpers added. |
| Interdimensional Rift Stabilizer | custom | Veydrift-only building; not in the base catalog. |
| Lunar Base | out of scope | Moon-only system follow-up required. |
| Jump Gate | out of scope | Moon-only system follow-up required. |

## Ships

| Catalog item | Veydrift status | Notes |
| --- | --- | --- |
| Small Cargo | implemented | Dependency tightened to Shipyard 2 + Combustion 2. |
| Large Cargo | implemented | Dependency tightened to Shipyard 4 + Combustion 6. |
| Light Fighter | implemented | Shipyard 1 + Combustion 1. |
| Heavy Fighter | implemented | Dependency tightened to Shipyard 3 + Armor 2 + Impulse 2. |
| Cruiser | implemented | Dependency tightened to Shipyard 5 + Impulse 4 + Ion 2. |
| Battleship | implemented | Dependency tightened to Shipyard 7 + Hyperspace Drive 4. |
| Colony Ship | implemented | Dependency tightened to Shipyard 4 + Impulse 3. |
| Recycler | implemented | Dependency tightened to Shipyard 4 + Combustion 6 + Shielding 2. |
| Espionage Probe | removed / unsupported | Removed from Veydrift scope in VEY-KANEO-111. The reserved contract slot has no catalog cost, no UI entry, and cannot be built. |
| Bomber | implemented | Dependency tightened to Shipyard 8 + Impulse 6 + Plasma 5. |
| Solar Satellite | implemented | Shipyard 1. |
| Destroyer | implemented | Dependency tightened to Shipyard 9 + Hyperspace Drive 6 + Hyperspace 5. |
| Dreadstar | implemented | Dependency tightened to Shipyard 12 + Hyperspace Drive 7 + Hyperspace 6 + Graviton 1. |
| Battlecruiser | implemented | Dependency tightened to Shipyard 8 + Hyperspace Drive 5 + Hyperspace 5 + Laser 12. |
| Reaper | implemented | Dependency tightened to Shipyard 10 + Hyperspace Drive 7 + Hyperspace 6 + Shielding 6 + Energy 5. |
| Pathfinder | implemented | Dependency tightened to Shipyard 5 + Hyperspace Drive 2 + Shielding 4. |
| Crawler | implemented | Added as ship id 16; cost 2,000 metal / 2,000 crystal / 1,000 deuterium; dependency Shipyard 5 + Combustion 4 + Armor 4 + Laser 4. Production boost implemented (VEY-KANEO-435): each crawler adds 0.02% to metal/crystal/deuterium mine output, capped at 8 effective crawlers per combined mine level and a 50% total bonus. Crawler energy consumption is intentionally not modeled yet and remains a separate follow-up. |

## Defenses And Missiles

| Catalog item | Veydrift status | Notes |
| --- | --- | --- |
| Rocket Launcher | implemented | Shipyard 1. |
| Light Laser | implemented | Dependency tightened to Shipyard 2 + Energy 1 + Laser 3. |
| Heavy Laser | implemented | Dependency tightened to Shipyard 4 + Energy 3 + Laser 6. |
| Gauss Cannon | implemented | Dependency tightened to Shipyard 6 + Energy 6 + Weapons 3 + Shielding 1. |
| Ion Cannon | implemented | Dependency tightened to Shipyard 4 + Ion 4. |
| Plasma Turret | implemented | Dependency tightened to Shipyard 8 + Plasma 7. |
| Small Shield Dome | implemented with cap helper | Dependency Shielding 2; catalog cap is 1 per planet. |
| Large Shield Dome | implemented with cap helper | Dependency Shipyard 6 + Shielding 6; catalog cap is 1 per planet. |
| Anti-Ballistic Missile | implemented with silo rules | Requires Shipyard 1 + Missile Silo 2; uses 1 silo slot. |
| Interplanetary Missile | implemented with silo rules | Requires Shipyard 1 + Missile Silo 4 + Impulse 1; uses 2 silo slots. |

## Research

| Catalog item | Veydrift status | Notes |
| --- | --- | --- |
| Energy Technology | implemented | Research Lab 1. |
| Laser Technology | implemented | Dependency tightened to Research Lab 1 + Energy 2. |
| Ion Technology | implemented | Dependency tightened to Research Lab 4 + Laser 5 + Energy 4. |
| Hyperspace Technology | implemented | Dependency tightened to Research Lab 7 + Energy 5 + Shielding 5. |
| Plasma Technology | implemented | Dependency Research Lab 4 + Energy 8 + Laser 10 + Ion 5. |
| Combustion Drive | implemented | Dependency tightened to Research Lab 1 + Energy 1. |
| Impulse Drive | implemented | Dependency Research Lab 2 + Energy 1. |
| Hyperspace Drive | implemented | Dependency Research Lab 7 + Hyperspace 3. |
| Espionage Technology | removed / unsupported | Removed from Veydrift scope in VEY-KANEO-111. The reserved contract slot has no research cost, no UI entry, and cannot be researched. |
| Computer Technology | implemented | Dependency Research Lab 1. |
| Astrophysics | implemented | Dependency Research Lab 3 + Impulse 3. Veydrift intentionally omits the old espionage dependency. |
| Intergalactic Research Network | implemented | Dependency Research Lab 10 + Computer 8 + Hyperspace 8. |
| Graviton Technology | implemented | Dependency Research Lab 12; energy cost behavior remains a production/research module follow-up. |
| Weapons Technology | implemented | Dependency Research Lab 4. |
| Shielding Technology | implemented | Dependency Research Lab 6 + Energy 3. |
| Armor Technology | implemented | Dependency Research Lab 2. |

## Formula Gaps

Veydrift deliberately uses compressed MVP timing:
- Building time is contract-scaled by `(metal + crystal) / (100 * (robotics + 1))`, not the legacy hours formula with Robotics, Nanite, and universe speed.
- Unit time is contract-scaled by total resource cost, shipyard, quantity, and a 60-second floor.
- Research time is contract-scaled by total resource cost, lab level, and a 60-second floor.

The formula audit confirms the current Veydrift formulas are custom MVP formulas rather than exact base-catalog timing. This task keeps the existing formula choice and makes the catalog/dependency rules explicit so later VEY-96/97/98/99 formula work can decide whether to move from MVP timing to base catalog timing.

## References

- Legacy dependency tree, building formula, ship, defense, and formula audit notes were used for this historical catalog pass; external brand-specific source links were intentionally removed in VEY-KANEO-170.
- Missile silo capacity mirror: https://wiki.pr0game.com/doku.php?id=en%3Araketensilo
