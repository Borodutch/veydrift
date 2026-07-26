# Defender loss audit (VEY-KANEO-761)

## Source of truth

The battle report has three distinct defender loss lanes:

1. Planet or moon fleet losses are emitted as exact absolute totals by
   `PlanetShipCountChanged` / `MoonShipCountChanged`. Their resource value is also included in
   `CombatLosses.defender*`.
2. Stationed `AcsDefend` / `DefenseHold` fleet losses mutate the participating mission ship
   rosters. `CombatLosses.defender*` includes their resource value, but does not identify the
   participant. The indexer subtracts the event-proven planet-fleet loss value, then reconciles the
   residual against the immutable stationed-fleet launch snapshots. It only publishes per-mission
   destroyed counts when the allocation is unique.
3. Static-defense losses are emitted as exact absolute totals by
   `PlanetDefenseCountChanged` / `MoonDefenseCountChanged`. The combat transaction emits decreases
   during each round and increases after combat for the deterministic 70% repair roll.
   `CombatLosses.defender*` deliberately excludes defense costs, so static defenses must have their
   own destroyed, restored, and net-loss resource totals and must not be added to fleet debris.

The persisted `BattleReport.defenderSnapshot` is the pre-battle planet/moon composition.
`BattleReport.defenderLossBreakdown` is derived only from historical count events in the same
transaction, never from the target's current state.

## Representative Base battle

- Mission: `8085`
- Target planet: `616`
- Transaction:
  `0x873eccd1646e1ff6e44ff7b00f240ed9871ed26da711cddd5c7d20b9d03b4a11`
- Block: `49134259`
- API report observed on 2026-07-26:
  `https://api-test.veydrift.com/mission/8085`

The pre-battle snapshot contains four Rocket Launchers. The Base transaction receipt proves the
complete static-defense history:

| Log | Event | Rocket Launcher total | Meaning |
| --- | --- | ---: | --- |
| `0xb3` | `PlanetDefenseCountChanged` | 2 | 2 destroyed in round 1 |
| `0xb4` | `CombatRoundResolved(1)` | — | 2 defender units remain |
| `0xb5` | `PlanetDefenseCountChanged` | 1 | 1 destroyed in round 2 |
| `0xb6` | `CombatRoundResolved(2)` | — | 1 defender unit remains |
| `0xb7` | `PlanetDefenseCountChanged` | 0 | 1 destroyed in round 3 |
| `0xb8` | `CombatRoundResolved(3)` | — | 0 defender units remain |
| `0xb9` | `PlanetDefenseCountChanged` | 2 | 2 defenses restored after combat |
| `0xbd` | `AttackBattleResolved` | — | attacker victory |
| `0xbe` | `CombatLosses` | — | defender fleet value is `0 / 0 / 0` |

Reconciled result:

- Static defenses destroyed: 4 Rocket Launchers
- Static defenses restored: 2 Rocket Launchers
- Static defenses net lost: 2 Rocket Launchers
- Static-defense destroyed value: `8,000 metal / 0 crystal / 0 deuterium`
- Static-defense restored value: `4,000 metal / 0 crystal / 0 deuterium`
- Static-defense net loss value: `4,000 metal / 0 crystal / 0 deuterium`
- Defender fleet loss event: `0 metal / 0 crystal / 0 deuterium`

This explains the player-visible bug: the existing UI showed only `CombatLosses.defender*`, which is
correct for fleets but cannot represent destroyed and subsequently repaired static defenses.

## Materialization and display

- `indexed_unit_count_event_logs` retains planet and moon ship/defense count events.
- Battle-report materialization reconstructs the pre-battle snapshot, applies same-transaction
  decreases/restorations, and persists the breakdown. Existing ready reports without the new field
  are re-queued once for background rematerialization.
- Mission Detail renders planet-fleet loss counts/value, stationed-fleet loss value and
  per-participant counts where uniquely reconstructable, and static-defense destroyed/restored/net
  counts and values as separate rows.
- An event-proven empty defender renders explicit `None` rows. A fully wiped defender keeps its
  pre-battle snapshot and destroyed counts even though the current target state is empty.
