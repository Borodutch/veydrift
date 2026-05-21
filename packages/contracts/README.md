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
Gameplay state is public onchain state. Contracts, public events, and ordinary
indexers must be enough to reconstruct canonical state; the backend is read-side
convenience infrastructure, not hidden authority. See
`../../docs/public-onchain-state-architecture.md`.

`VeydriftSettlement` is the compact Base Sepolia first-planet settlement contract used for the
initial wallet-connect MVP while `VeydriftGame` continues to grow. It supports one settlement per
wallet, weak on-chain entropy for first coordinate assignment, canonical coordinate ownership, and
`FirstPlanetSettled` indexer events.

Starting a planet:

- `startPlanet()` costs exactly `0.05 ether` by default.
- The owner can intentionally change the price with `setStartPrice`.
- Each player can create one home planet with payment, then additional colonies with colony ships.
- Home-planet coordinates are generated from weak on-chain entropy: chain id, contract address,
  player, planet id, block number, timestamp, `block.prevrandao`, the attempt number, and the
  `veydrift.first-planet.v1` domain.
- The first coordinate model uses `galaxy` 1-9, `system` 1-499, and `position` 1-15 with collision prevention.

Planet state:

- Coordinates, field capacity, temperature, resource multipliers, last settled timestamp
- Ledger resources: metal, crystal, deuterium
- Building levels, defense counts, ship counts
- Player-wide technology levels

Resources:

- Resources accrue lazily and are claimed with `settlePlanet` or `collectResources`.
- `settlePlanet` / `collectResources` are idempotent collection calls: they can be called
  before queues are ready, apply any ready building, defense, ship, and research outputs, and
  leave not-yet-ready queues active.
- `collectShips` is a ship-focused wrapper for claiming ready ship production without reverting
  when no ships are ready.
- Production depends on mine levels, planet multipliers, and available solar energy.
- Storage caps are enforced when resources are settled.
- `VeydriftMetal`, `VeydriftCrystal`, and `VeydriftDeuterium` are UUPS ERC-20
  resource token proxies with 6 decimals. Each mints an initial
  `10,000,000,000 * 10^6` base-unit supply to the deployed `VeydriftGame`
  contract or explicit game resource vault. The token owner can mint additional
  supply, and ERC-20 transfers remain standard for future market integrations.
- Metal, crystal, and deuterium are an internal game ledger backed 1:1 by ERC-20 reserve
  balances held by `VeydriftGame`.
- `setResourceTokens(metal, crystal, deuterium)` configures the reserve ERC-20 contracts.
- `depositResourceReserves({metal, crystal, deuterium})` lets the owner top up reserves after
  approving `VeydriftGame` on each token.
- Normal collection never transfers ERC-20 tokens to the player wallet. It only increases the
  internal in-game balance if the configured reserve can back the new claim.
- Spending on buildings, research, ships, defenses, transport fuel, and other game actions
  consumes the internal ledger balance while reserve tokens remain in the game contract.
- Test deployments should initialize/reset balances by minting or otherwise funding the three
  resource token reserves, approving the game contract, and calling `depositResourceReserves`
  before players start planets or collect produced resources.

Production:

- One active building construction per planet; buildings are not queued on-chain
- One active defense queue per planet
- One active ship queue per planet
- One active research queue per player

Colonies:

- `maxPlanets(player)` is `1 + Computer` technology level. A player needs `Computer` level 1 before their first colony.
- `createColony(originPlanetId, galaxy, system, position)` consumes one `ColonyShip` from the origin planet and reserves the target coordinate.
- `createColonyAtNextSlot(originPlanetId, salt)` picks the first unoccupied deterministic slot from `nextColonyCoordinates(player, salt)`.
- `isCoordinateAvailable(galaxy, system, position)` and `coordinateKey(...)` are exposed for frontends/indexers.
- New colonies start with `500 metal`, `500 crystal`, and `0 deuterium`; production and storage then follow normal planet settlement rules.

Fleet missions:

- `launchFleetMission(originPlanetId, targetPlanetId, missionType, ships, cargo, randomnessRequestId)` is the generic contract-backed fleet lifecycle for transport, deploy, colonize, attack, harvest, ACS defend, intercept, and missile attack mission types.
- Departure settles involved planets, enforces fleet slots, removes launched ships from the origin, checks cargo capacity, and spends cargo plus fuel/deuterium.
- `shipCargoCapacity(shipId)`, `transportFuelCost(...)`, and `transportTravelSeconds(...)` remain view helpers for UI previews while transport uses the generic mission path.
- Arrivals are lazy: call `resolveFleetMission(missionId)` after `fleetMission(missionId).arrivalAt` to settle the target and resolve the mission.
- Missions that return must later call `completeFleetMissionReturn(missionId)` after `fleetMission(missionId).returnAt` to land surviving ships and cargo.
- `recallFleetMission(missionId)` can be called before arrival; recalled fleets return to the origin with their ships and cargo. Fuel remains spent.

Indexer-facing events:

- `FirstPlanetSettled(player, planetId, galaxy, system, position, coordinateKey, planetSeed)`
- `ColonyCreated(player, originPlanetId, colonyPlanetId, galaxy, system, position, fields, temperature)`
- `FleetMissionLaunched(missionId, player, missionType, originPlanetId, targetPlanetId, arrivalAt, returnAt, cargo, fuelCost, randomnessRequestId)`
- `FleetMissionRecalled(missionId, player, returnAt)`
- `FleetMissionResolved(missionId, player, missionType, returnAt)`
- `FleetMissionReturned(missionId, player, originPlanetId)`

`coordinateKey(galaxy, system, position)` and `planetSeed(galaxy, system, position)` are exposed
for frontend/backend mapping. `planetSeed` is coordinate-only and domain-separated so the same
coordinate maps to the same deterministic planet metadata for every reader.

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
| 10 | FusionReactor |
| 11 | NaniteFactory |
| 12 | Terraformer |
| 13 | AllianceDepot |
| 14 | MissileSilo |

Defenses:

| ID | Name |
| --- | --- |
| 0 | RocketLauncher |
| 1 | LightLaser |
| 2 | HeavyLaser |
| 3 | SmallShieldDome |
| 4 | GaussCannon |
| 5 | IonCannon |
| 6 | PlasmaTurret |
| 7 | LargeShieldDome |
| 8 | AntiBallisticMissile |
| 9 | InterplanetaryMissile |

Ships:

| ID | Name |
| --- | --- |
| 0 | SmallCargo |
| 1 | LightFighter |
| 2 | Recycler |
| 3 | ColonyShip |
| 4 | LargeCargo |
| 5 | HeavyFighter |
| 6 | Cruiser |
| 7 | Battleship |
| 8 | EspionageProbe |
| 9 | Bomber |
| 10 | SolarSatellite |
| 11 | Destroyer |
| 12 | Deathstar |
| 13 | Battlecruiser |
| 14 | Reaper |
| 15 | Pathfinder |

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
| 9 | Hyperspace |
| 10 | ImpulseDrive |
| 11 | HyperspaceDrive |
| 12 | Plasma |
| 13 | Astrophysics |
| 14 | IntergalacticResearchNetwork |
| 15 | Graviton |

Resources:

| ID | Name |
| --- | --- |
| 0 | Metal |
| 1 | Crystal |
| 2 | Deuterium |
| 3 | Energy |

## Deployment

Scripts require a funded deployer key in the shell environment. Do not commit or print private keys.

Deploy the test game contract to Base Sepolia:

```bash
PRIVATE_KEY=... ADMIN_ADDRESS=0xAdmin \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --verify
```

`Deploy.s.sol` deploys the game, the Moon System module, and the Metal, Crystal,
and Deuterium ERC-20 proxy contracts. It wires the moon module into the game for
moon-building resource debits, wires the resource tokens into the game as reserve
tokens, and emits the proxy/module addresses. Configure the emitted moon module
address as `VEYDRIFT_MOON_CONTRACT_ADDRESS` for backend moon reads. Because the
setup calls are owner-only, `ADMIN_ADDRESS` must match the `PRIVATE_KEY`
broadcaster for this script.

To attach resource tokens to an already deployed game contract, run:

```bash
PRIVATE_KEY=... ADMIN_ADDRESS=0xAdmin VEYDRIFT_GAME_CONTRACT_ADDRESS=0xGame \
  forge script script/DeployResourceTokens.s.sol:DeployResourceTokens \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --verify
```

Then call `setResourceTokens(metal, crystal, deuterium)` as the game owner if
the script was used against an existing game contract.

After deployment, set the backend/runtime config values:

```text
VEYDRIFT_METAL_TOKEN_ADDRESS=<VeydriftMetal proxy>
VEYDRIFT_CRYSTAL_TOKEN_ADDRESS=<VeydriftCrystal proxy>
VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS=<VeydriftDeuterium proxy>
```

Deploy the compact first-planet settlement contract to Base Sepolia:

```bash
PRIVATE_KEY=... forge script script/DeploySettlement.s.sol:DeploySettlement \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --verify
```

Deploy to Base mainnet:

```bash
PRIVATE_KEY=... ADMIN_ADDRESS=0xAdmin \
METAL_TOKEN_ADDRESS=0xMetal CRYSTAL_TOKEN_ADDRESS=0xCrystal DEUTERIUM_TOKEN_ADDRESS=0xDeuterium \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BASE_MAINNET_RPC_URL" --broadcast --verify
```

`ADMIN_ADDRESS` is optional; if omitted, the deployer address owns the game contract. The game
requires all three resource token addresses plus funded reserves before any planet can be started
or new resources can be credited.

`VeydriftGame` is intentionally deployed directly for the test MVP so it remains under the
Base Sepolia contract size limit. `Upgrade.s.sol` is retained only as an explicit guard and
will revert.

Upgrade an existing proxy:

```bash
PRIVATE_KEY=... PROXY_ADDRESS=0xProxy forge script script/Upgrade.s.sol:Upgrade \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --verify
```

The proxy owner must be the broadcasting account for upgrades.

## MVP Simplifications

This ticket intentionally leaves these systems for later work:

- Combat, attacks, debris fields, moons, alliances, and markets
- NFTs or transferable planet ownership

Espionage reports, hidden fleet intent, commit-reveal protections, private
orderflow, and other hidden-state mechanics are out of scope permanently for the
Veydrift product direction. Fleet and combat systems should use the public
counterplay and anti-raid mechanics tracked from VEY-KANEO-119 through
VEY-KANEO-133.

The MVP still enforces payment, duplicate-start prevention, coordinate collision prevention, planet limits, resource/fuel costs, cargo capacity, one active construction or production slot per domain, basic dependencies, owner-gated upgrades/configuration, and timestamp-based lazy settlement.
