# VEY-141 Catalog Re-Audit

Date: 2026-05-21

## Audit Inputs

- Fusion Reactor cost factor, requirements, Energy Technology scaling, and deuterium consumption.
- Nanite Factory construction-time formulas for buildings, ships, and defenses.
- Production time formulas and Robotics Factory construction-time effects.
- Ship cost, requirement, structural integrity, cargo, speed, and fuel tables.
- Defense cost and stat tables.

## Corrections Made

| Surface | Finding | Change |
| --- | --- | --- |
| Fusion Reactor frontend level table | The fallback effect row showed generic construction speed. Base Fusion Reactor converts deuterium into energy and does not speed construction. | Fusion Reactor rows now show energy output and deuterium consumption, with no construction-speed text. |
| Fusion Reactor frontend modeled production | Fallback modeled production ignored Fusion Reactor energy and deuterium draw. | Fallback production now adds Fusion Reactor energy, subtracts deuterium consumption, and uses Energy Technology when infrastructure state includes it. |
| Fusion Reactor contract formula | Contract energy production used a fixed 1.05 factor and did not include Energy Technology. | Contract formula now uses `30 * level * (1.05 + Energy Technology * 0.01) ^ level`. |
| Fusion Reactor deuterium consumption | Contract used the generic floor-scaled level helper. | Contract now uses ceil-style `10 * level * 1.1 ^ level` deuterium draw. |
| Fusion Reactor frontend cost growth | Frontend fallback cost scaling used the default 2x facility factor. | Frontend fallback now uses the base 1.8x Fusion Reactor growth factor. |
| Storage capacity UI fixture | Frontend fallback storage cap table stopped before the max modal level. | Storage caps now cover the same level 0-50 table as the contract. |
| Rift requirement projection | Backend Rift UI requirements still exposed older easier requirements. | Requirement projection now matches the current contract/frontend Interdimensional Rift Stabilizer gate: Robotics 4, Research Lab 2, Energy 5, Hyperspace 1. |

## Catalog Coverage

The automated conformance fixtures cover representative values for:

- resource buildings: mine production, deuterium temperature multiplier, energy use, storage caps, cost growth, and construction time;
- facilities: Robotics/Nanite construction-time divisors, Shipyard unit-time divisor, Research Lab research-time divisor, Fusion Reactor energy/deuterium behavior, and Rift requirements;
- ships: costs, cargo capacity, requirements, and shipyard/Nanite unit construction time;
- defenses and missiles: costs, requirements, missile silo slot rules in the existing contract catalog tests;
- research: costs, requirements, Graviton produced-energy gate, and research time.

## Intentional Veydrift Deviations

| Item | Deviation |
| --- | --- |
| Espionage Probe / Espionage Technology | Intentionally removed by public-onchain-state scope; no spy mechanics are supported. |
| Interdimensional Rift Stabilizer | Veydrift-only building for resource token bridge mechanics; not a base catalog item. |
| Space Dock repair system | Veydrift combat-recovery mechanic; not treated as a base construction-speed or production building. |
| Dreadstar label | Uses Veydrift naming while keeping the classic catalog id/cost/requirement semantics. |
| Universe speed | Current formulas use a 1x speed constant with a 60-second minimum queue guard for playable testnet UX. |
| Deuterium Synthesizer temperature formula | Keeps the already-selected Veydrift approximation using max temperature and basis-point multipliers from the deterministic universe library. |

## Deployment Impact

The contract formula changes affect production/energy settlement behavior for deployments. A testnet contract upgrade/redeploy is required before live Base Sepolia reflects the corrected Fusion Reactor Energy Technology scaling and deuterium consumption.
