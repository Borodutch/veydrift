# Selectable Moon Bodies - VEY-KANEO-639

## Scope

Moons are now exposed as selectable orbit bodies linked to a parent planet coordinate. The API and frontend distinguish `bodyKind: "planet"` from `bodyKind: "moon"` so the selected moon context cannot silently reuse or mutate parent planet resources and units.

## Contract / Indexer State

This implementation adds moon body storage to `VeydriftMoonSystem`, keyed by the parent `planetId`:

- moon resource balances;
- moon ship counts;
- moon defense counts;
- canonical moon resource and unit events.

Moon building upgrades now spend moon resources inside `VeydriftMoonSystem`. Jump-gate ship movement now debits and credits moon ship counts through `MoonShipCountChanged` events instead of mutating parent planet ship counts. The backend indexes `MoonResourcesSettled`, `MoonShipCountChanged`, and `MoonDefenseCountChanged` into moon-specific canonical tables, and `moonState` serves those rows independently from parent planet resources, ships, and defenses.

## Upgrade / Backfill Plan

1. Deploy the upgraded `VeydriftMoonSystem` implementation with appended moon storage and the new moon getters/admin seeders.
2. Keep existing `MoonCreated` records as the source of moon existence, parent linkage, fields, diameter, and creation time.
3. For each existing Chicken-granted moon, seed moon resources and unit counts as zero unless an external grant snapshot defines starting balances.
4. When a snapshot exists, call the owner-only seeders to grant moon resources and set moon ship/defense totals so the contract emits the canonical moon events.
5. Run the backend event replay/backfill so `contract_moon_resources`, `contract_moon_ship_counts`, and `contract_moon_defense_counts` rebuild from the moon events.
6. Leave parent planet resource/unit rows unchanged during the backfill; moon state must not be derived by copying parent planet state.

## Indexer Backfill Plan

1. Existing deployments without moon resource/unit events remain serveable: the backend returns independent zero resource balances and zero-count moon unit rows when no moon event exists.
2. After upgrade, replay `MoonResourcesSettled`, `MoonShipCountChanged`, and `MoonDefenseCountChanged` from the deployment block range.
3. Run a one-time repair on any existing indexed databases so the new moon tables are created and stored logs are re-applied.
4. If future contracts introduce passive moon production/accrual, add a moon-specific `lastSettledAt`/production projection instead of reusing planet production.

## QA Notes

- Existing Chicken moons should appear as selectable moon bodies at the same coordinate as their parent planet.
- Without seed events, moon resources should show `0 / 0 / 0` and moon unit rows should stay independent zero counts.
- Seeded or newly mutated moon resources, ships, and defenses should appear only on the moon body.
- Planet-only pages must not spend or mutate parent planet state while the moon body is selected.
