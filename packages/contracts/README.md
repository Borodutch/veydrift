# @veydrift/contracts

Foundry Solidity contracts for the first playable Veydrift on-chain MVP targeting Base-compatible EVMs.

## Stack

- Solidity `0.8.28`
- Foundry for build, tests, formatting, scripts
- OpenZeppelin upgradeable contracts
- UUPS implementation behind an ERC1967 proxy

Install dependencies:

```bash
forge install
```

Copy `.env.example` to `.env` and configure your deployer key:

```bash
cp .env.example .env
```

The deployer wallet is stored in Vaultwarden under **"Veydrift deployer wallet"**:

- **Address:** `0x87C47Fa2c7747f73E0cA19232615CA4F6B92328c`
- **Networks:** Base Sepolia (testnet) and Base mainnet

## Commands

```bash
forge fmt --check
forge build
forge test
```

From the repository root:

```bash
bun run check:contracts
bun run test:contracts
```

## Contract Model

`VeydriftGame` is an upgradeable MVP contract with one paid home planet per wallet,
player-owned colonies, lazy resource settlement, and non-combat transport fleets.

Starting a planet:

- `startPlanet()` costs exactly `0.05 ether` by default.
- The owner can intentionally change the price with `setStartPrice`.
- Each player can create one home planet with payment, then additional colonies with colony ships.
- Coordinates are generated deterministically from chain id, contract address, player, planet id, and attempt.
- The first coordinate model uses `galaxy` 1-9, `system` 1-499, and `position` 1-15 with collision prevention.

Planet state:

- Coordinates, field capacity, temperature, resource multipliers, last settled timestamp
- Ledger resources: metal, crystal, deuterium
- Building levels, defense counts, ship counts
- Player-wide technology levels

Resources:

- Resources accrue lazily and are claimed with `settlePlanet` or `collectResources`.
- Production depends on mine levels, planet multipliers, and available solar energy.
- Storage caps are enforced when resources are settled.

Queues:

- One active building queue per planet
- One active defense queue per planet
- One active ship queue per planet
- One active research queue per player

Colonies:

- `maxPlanets(player)` is `1 + Computer` technology level. A player needs `Computer` level 1 before their first colony.
- `createColony(originPlanetId, galaxy, system, position)` consumes one `ColonyShip` from the origin planet and reserves the target coordinate.
- `createColonyAtNextSlot(originPlanetId, salt)` picks the first unoccupied deterministic slot from `nextColonyCoordinates(player, salt)`.
- `isCoordinateAvailable(galaxy, system, position)` and `coordinateKey(...)` are exposed for frontends/indexers.
- New colonies start with `500 metal`, `500 crystal`, and `0 deuterium`; production and storage then follow normal planet settlement rules.

Transport fleets:

- `dispatchTransport(originPlanetId, destinationPlanetId, smallCargo, recycler, colonyShip, cargo)` moves ships/resources only between planets owned by the caller.
- Departure settles both planets, removes launched ships from the origin, checks cargo capacity, and spends cargo plus fuel/deuterium.
- `transportCargoCapacity(...)`, `shipCargoCapacity(shipId)`, `transportFuelCost(...)`, and `transportTravelSeconds(...)` are view helpers for UI previews.
- Arrivals are lazy: call `settleFleetArrival(fleetId)` after `fleet(fleetId).arrivesAt` to settle the destination, credit cargo, and land the ships.
- `recallFleet(fleetId)` can be called before arrival; recalled fleets return to the origin with their ships and cargo. Fuel remains spent.

Indexer-facing events:

- `ColonyCreated(player, originPlanetId, colonyPlanetId, galaxy, system, position, fields, temperature)`
- `FleetDispatched(fleetId, player, originPlanetId, destinationPlanetId, arrivesAt, smallCargo, recycler, colonyShip, metal, crystal, deuterium, fuelCost)`
- `FleetRecalled(fleetId, player, originPlanetId, destinationPlanetId, arrivesAt)`
- `FleetArrived(fleetId, player, destinationPlanetId, returning)`
- `ResourcesTransferred(fleetId, originPlanetId, destinationPlanetId, metal, crystal, deuterium)`

## IDs

Buildings:

| ID | Name |
| --- | --- |
| 0 | MetalMine |
| 1 | CrystalMine |
| 2 | DeuteriumSynthesizer |
| 3 | SolarPlant |
| 4 | RoboticsFactory |
| 5 | Shipyard |
| 6 | ResearchLab |
| 7 | MetalStorage |
| 8 | CrystalStorage |
| 9 | DeuteriumTank |

Defenses:

| ID | Name |
| --- | --- |
| 0 | RocketLauncher |
| 1 | LightLaser |
| 2 | HeavyLaser |
| 3 | SmallShieldDome |

Ships:

| ID | Name |
| --- | --- |
| 0 | SmallCargo |
| 1 | LightFighter |
| 2 | Recycler |
| 3 | ColonyShip |

Technologies:

| ID | Name |
| --- | --- |
| 0 | Energy |
| 1 | Laser |
| 2 | Ion |
| 3 | CombustionDrive |
| 4 | Espionage |
| 5 | Computer |
| 6 | Weapons |
| 7 | Shielding |
| 8 | Armor |

## Deployment

Scripts require a funded deployer key in the shell environment. Do not commit or print private keys.

Deploy a proxy to Base Sepolia:

```bash
PRIVATE_KEY=... ADMIN_ADDRESS=0xAdmin forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --verify
```

Deploy to Base mainnet:

```bash
PRIVATE_KEY=... ADMIN_ADDRESS=0xAdmin forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BASE_MAINNET_RPC_URL" --broadcast --verify
```

`ADMIN_ADDRESS` is optional; if omitted, the deployer address owns the proxy.

Upgrade an existing proxy:

```bash
PRIVATE_KEY=... PROXY_ADDRESS=0xProxy forge script script/Upgrade.s.sol:Upgrade \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --verify
```

The proxy owner must be the broadcasting account for upgrades.

## MVP Simplifications

This ticket intentionally leaves these systems for later work:

- Combat, attacks, espionage reports, debris fields, moons, alliances, and markets
- NFTs or transferable planet ownership
- Commit-reveal or private-orderflow protections for future hidden fleet intent

The MVP still enforces payment, duplicate-start prevention, coordinate collision prevention, planet limits, resource/fuel costs, cargo capacity, one active queue per domain, basic dependencies, owner-gated upgrades/configuration, and timestamp-based lazy settlement.
