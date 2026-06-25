# Selectable Moon Bodies - VEY-KANEO-639

## Scope

Moons are now exposed as selectable orbit bodies linked to a parent planet coordinate. The API and frontend distinguish `bodyKind: "planet"` from `bodyKind: "moon"` so the selected moon context cannot silently reuse or mutate parent planet resources and units.

## Current Deployed-State Gap

The current moon contract stores:

- moon existence and parent planet id;
- moon fields, diameter, creation time, and jump-gate readiness;
- moon building levels and active moon-building construction.

It does not yet store moon-owned resource balances, moon ship counts, or moon defense counts. Existing jump-gate movement still mutates planet ship counts. For that reason the indexed moon body serves independent zero resources and empty ship/defense rows instead of aliasing the parent planet.

## Contract Migration Plan

1. Add moon body storage keyed by parent `planetId`:
   - `mapping(uint256 => Resources) moonResources`;
   - `mapping(uint256 => mapping(Ship => uint32)) moonShipCounts`;
   - `mapping(uint256 => mapping(Defense => uint32)) moonDefenseCounts`;
   - optional `moonLastSettledAt` if moon production/accrual is introduced.
2. Emit canonical post-mutation events for moon resources and units:
   - `MoonResourcesSettled(parentPlanetId, metal, crystal, deuterium, settledAt)`;
   - `MoonShipCountChanged(parentPlanetId, shipId, total)`;
   - `MoonDefenseCountChanged(parentPlanetId, defenseId, total)`.
3. Update moon mutating paths to spend from moon resources only. Planet infrastructure/shipyard/defense paths must reject `bodyKind: "moon"` or a moon-specific entrypoint.
4. Update jump-gate movement to debit/credit moon ship counts, not parent planet ship counts.
5. Backfill existing Chicken-granted moons with zero moon resources and zero moon units unless an external grant snapshot explicitly defines starting balances.

## Indexer Backfill Plan

1. Add canonical moon resource/unit tables mirroring the existing planet tables:
   - `contract_moon_resources`;
   - `contract_moon_ship_counts`;
   - `contract_moon_defense_counts`.
2. Rebuild from `MoonCreated` events to seed one zero resource/unit row set per existing moon.
3. Replay the new moon resource/unit events into the canonical tables.
4. Keep legacy deployments serveable by returning independent zero/empty moon body rows when the new events are absent.
5. Add a one-time reconciliation step once upgraded contracts expose canonical moon getter calls.

## QA Notes

- Existing Chicken moons should appear as selectable moon bodies at the same coordinate as their parent planet.
- Until the contract upgrade lands, moon resources should show `0 / 0 / 0` and moon ships/defenses should show empty lists.
- Planet-only pages must not spend or mutate parent planet state while the moon body is selected.
