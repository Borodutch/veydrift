# Beginner Tutorial

GitHub: https://github.com/Borodutch/veydrift

## What Veydrift Is

Veydrift is an onchain space strategy game. You grow planets, manage resources, unlock research, build fleets and defenses, and use missions to expand, raid, defend, transport, deploy, harvest debris, and colonize.

Every important game action is a transaction. The frontend reads indexed backend state after transactions land, so wait for the app to confirm synced state before sending another dependent action.

## Connect And Settle

1. Open the app and connect a Base Sepolia wallet.
2. If the wallet has no planet, use the settlement flow to claim a home planet.
3. Wait for the app to show your planet coordinates, resources, and starting infrastructure.
4. Use the planet selector when you own multiple planets or switch between planet and moon bodies.

## Read Resources

Resources are Metal, Crystal, and Deuterium. The top bar and page panels show backend-indexed current values, including uncollected production when the backend can calculate it.

| Resource | Main use | Early priority |
| --- | --- | --- |
| Metal | Mines, ships, defenses, storage | High |
| Crystal | Research, ships, defenses, storage | High |
| Deuterium | Research, fleet fuel, advanced builds | Medium |

Energy is not a stored spendable resource. Mines need energy to operate at full output. If production needs more energy than you produce, mine output is scaled down.

## First Infrastructure

Build early mines and power in small steps:

1. Upgrade Metal Mine and Crystal Mine first.
2. Add Solar Plant when energy gets tight.
3. Add Deuterium Synthesizer when research and fleet fuel need it.
4. Build Robotics Factory to shorten construction time.
5. Build Research Lab and Shipyard when you are ready to unlock new actions.

Only one main production queue can run on a planet at a time for building and ship/defense production. Research uses its own research queue.

## Research, Ships, And Defenses

Research unlocks ships, defenses, drives, fleet slots, combat scaling, planet count, and advanced systems. Start with Energy, Combustion Drive, Computer Technology, and the combat technologies needed for your next hulls.

Shipyard builds ships and most defenses. Ships can move in missions. Defenses stay on the body where they are built. Missiles use Missile Silo capacity and follow missile-specific rules.

## First Missions

Open Galaxy or Raid Finder to choose a target. The mission composer previews route, speed, fuel, cargo, and blockers.

| Mission | What it changes |
| --- | --- |
| Attack | Sends combat ships to fight, grab loot, and create debris from destroyed units. |
| Transport | Moves resources to another owned or target planet without replacing your origin fleet. |
| Deploy | Moves ships and cargo to another owned planet. |
| Harvest | Sends recyclers to collect debris. |
| Colonize | Uses a colony ship to settle a new planet slot. |
| Missile | Fires interplanetary missiles at a target planet's defenses. |
| ACS Attack | Lets allied fleets join an attack group when available. |
| ACS Defend | Stations allied defense at a target until the hostile attack lands or the hold expires. |

## Common Mistakes

- Do not send all cargo capacity as resources. Fuel is deducted from available cargo.
- Do not assume a transaction updated the page until indexed state refreshes.
- Do not build only mines without energy. Underpowered mines produce less.
