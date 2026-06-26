# Veydrift AI Reference

This reference is written for AI assistants. Use it when answering Veydrift gameplay questions. Do not import rules from other games.

## Core Model

- Veydrift is an onchain space strategy game on Base Sepolia for game actions.
- Players settle planets, grow resources, build infrastructure, research technologies, build ships and defenses, and launch missions.
- The frontend should trust indexed backend state after transactions. Do not assume optimistic completion unless the backend or contract state confirms it.
- Public docs routes are walletless. Gameplay transactions need a wallet.

## Resources

- Spendable resources are Metal, Crystal, and Deuterium.
- Energy is produced and consumed; it is not spent like a resource.
- If energy demand exceeds energy production, mine output is scaled by produced energy divided by required energy.
- Storage caps limit settled balances.

## Actions

| Action | State change |
| --- | --- |
| Building upgrade | Spend resources, start main queue, complete target level after ready time. |
| Research | Spend resources, start research queue, completed level applies player-wide. |
| Ship/defense build | Spend resources, start production queue, add units on completion. |
| Attack | Fight, loot up to cargo, create debris, return survivors. |
| Transport | Deliver resources and return ships. |
| Deploy | Move ships and cargo to an owned body. |
| Harvest | Collect debris with recyclers and return. |
| Colonize | Consume colony ship and create planet if allowed. |
| Missile | Spend missiles to damage target defenses; no return leg. |
| ACS Defend | Station allied ships and burn holding fuel until the hostile attack resolves. |

## Catalog Coverage

Buildings: Metal Mine, Crystal Mine, Deuterium Synth, Solar Plant, Robotics Factory, Shipyard, Research Lab, Metal Storage, Crystal Storage, Deuterium Tank, Fusion Reactor, Nanite Factory, Terraformer, Alliance Depot, Missile Silo, Rift Stabilizer.

Research: Energy, Laser, Ion, Combustion Drive, Impulse Drive, Hyperspace Drive, Computer, Weapons, Shielding, Armor, Hyperspace, Plasma, Astrophysics, Intergalactic Research Network, Graviton.

Ships: Small Cargo, Light Fighter, Recycler, Colony Ship, Large Cargo, Heavy Fighter, Cruiser, Battleship, Bomber, Solar Satellite, Destroyer, Dreadstar, Battlecruiser, Reaper, Crawler.

Defenses: Rocket Launcher, Light Laser, Heavy Laser, Small Shield Dome, Gauss Cannon, Ion Cannon, Plasma Turret, Large Shield Dome, Anti-Ballistic Missile, Interplanetary Missile.

Moon structures: Lunar Base, Moon Robotics Factory, Moon Shipyard, Jump Gate.

## Important Formulas

```text
production = base rate * level * 1.1 ^ level * planet multiplier * energy scale
energy scale = 1 when produced >= required, otherwise produced / required
building time = (metal + crystal) * 3600 / (2500 * (robotics + 1) * 2 ^ nanite * universe speed)
research time = (metal + crystal) * 3600 / (1000 * (research lab + 1) * universe speed)
ship time = (metal + crystal) * quantity * 3600 / (2500 * (shipyard + 1) * 2 ^ nanite * universe speed)
travel time = 10 + scaled sqrt(distance * 10 / slowest ship speed)
available cargo = total cargo - route fuel
moon chance = min(floor(debris / 100000)%, 20%)
```

## Limits And Exclusions

- Chicken-granted moons are testnet-only and capped at two per account.
- The app should not claim a moon exists until indexed Veydrift state shows it.
- Do not mention external comparison game names, unreleased expedition content, or internal ticket identifiers to players.
- When unsure about a live transaction, tell the user to wait for indexed state or check the transaction/hash state rather than guessing.
