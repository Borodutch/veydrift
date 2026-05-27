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
- Ready ship production is claimed through `finishShipProduction`.
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
- `createColonyAtNextSlot(originPlanetId, salt)` picks the first unoccupied deterministic slot from the same internal coordinate search used by direct colony creation.
- `isCoordinateAvailable(galaxy, system, position)` and `coordinateKey(...)` are exposed for frontends/indexers.
- New colonies start with `500 metal`, `500 crystal`, and `0 deuterium`; production and storage then follow normal planet settlement rules.

Fleet missions:

- `launchFleetMission(originPlanetId, targetPlanetId, missionType, ships, cargo, randomnessRequestId)` is the generic contract-backed fleet lifecycle for transport, deploy, colonize, attack, harvest, ACS defend, and intercept mission types. Missile attacks use `launchInterplanetaryMissileAttack(...)`.
- Departure settles involved planets, enforces fleet slots, removes launched ships from the origin, checks cargo capacity, and spends cargo plus fuel/deuterium.
- For `AcsDefend` and `Intercept`, the `targetPlanetId` argument is the hostile attack mission id. The contract resolves the actual defended planet from that mission, requires alliance defense permission from `VeydriftAllianceSystem`, and links the launched fleet into the combat module's defender-side battle resolution.
- Release-slice parity note: Veydrift currently treats ACS defend and intercept as hostile-mission counterplay, launched from indexed inbound attack rows by mission id. They are not Galaxy planet-slot actions and are not a claim of full classic OGame ACS parity.
- Attack battles use six classic OGame-style rounds with cataloged attack, shield, and hull values, separate Weapons/Shielding/Armor scaling, shield absorption, hull explosion checks once damage exceeds 30% of hull, deterministic unit-weighted target selection, cataloged rapid-fire expectations, and 70% end-of-battle defense repair. ACS defending and intercepting fleets join the defender side when they arrive before the hostile attack.
- For bounded gas, Veydrift resolves combat at the unit-stack level but distributes each firing stack's shots across surviving target stacks by individual unit counts. This keeps battle resolution deterministic and gas-bounded while matching the classic OGame round count, target weighting, shield/hull thresholds, debris, and defense repair.
- Attack launches request battle randomness from the configured `RandomnessEngine`; the caller-supplied `randomnessRequestId` argument is ignored for Attack missions. `resolveFleetMission` consumes the fulfilled oracle word for the mission purpose and reverts while the request is pending, then emits the derived seed in `AttackBattleResolved`.
- Public-state anti-raid primitives are centralized in `VeydriftAntiRaidPrimitives`: fleet slots,
  travel/fuel, recall timing, hostile mission visibility, ACS cutoff, bashing/cooldown limits,
  score protection, loot/protected-storage caps, and defender recovery constants. Frontend/backend
  code may preview these values, but enforcement must remain contract-side.
- `VeydriftCatalog.shipCargoCapacity(shipId)` and `transportFuelCost(...)` remain helpers for UI previews while transport uses the generic mission path.
- Arrivals are lazy: call `resolveFleetMission(missionId)` after `fleetMission(missionId).arrivalAt` to settle the target and resolve the mission.
- Missions that return must later call `completeFleetMissionReturn(missionId)` after `fleetMission(missionId).returnAt` to land surviving ships and cargo.
- `fleetMission(missionId)` is public and exposes owner, origin, target, timing, cargo, fuel, and status for every mission. `FleetMissionCargo` and `FleetMissionShips` expose the launch manifest so hostile inbound and returning fleets are indexable from contract truth.
- The recall deadline is `arrivalAt - FLEET_RECALL_CUTOFF_SECONDS`. `recallFleetMission(missionId)` must be called by that deadline, spends an additional `FLEET_RECALL_COST_BPS` share of the launch fuel from the origin planet, and keeps the recalled fleet publicly visible until it lands. Original launch fuel remains spent.

Moon chance:

- `VeydriftMoonSystem.requestMoonChanceFromBattle(battleId, targetPlanetId, metalDebris, crystalDebris)` is the battle/debris integration hook. The configured moon-chance reporter should call it after a qualifying battle creates debris.
- Moon chance follows the Veydrift debris rule: 1% per 100,000 metal+crystal debris, capped at 20%. Battles below 100,000 debris do not create a randomness request.
- The moon system requests one seed from `RandomnessEngine` and stores a pending outcome. `finalizeMoonChance(outcomeId)` can be called by anyone after fulfillment; before fulfillment it reverts through `RandomnessEngine.PendingRandomness`.
- Duplicate battle/target requests are rejected, and targets that already have a moon emit a skip event instead of creating a second moon. Successful outcomes derive moon fields and diameter from the fulfilled random word and battle context.

Alliances:

- `VeydriftAllianceSystem` is a standalone canonical alliance roster and public
  profile authority linked to `VeydriftGame` for settled-player checks.
- Players with a settled planet can create alliances with public tag, name, and
  short description/link fields. The creator is the single owner.
- Alliance roles are owner, officer, and member. Owners and officers can invite
  members; owners and officers can kick members; owners can add or remove
  officers. Officers cannot remove the owner or other officers.
- Diplomacy state covers ally, non-aggression, and war flags. Attack-limit tickets
  can query `attackLimitAllianceContext(attacker, defender)` for same-alliance,
  war, bashing, and score-protection exceptions.

Indexer-facing events:

- `FirstPlanetSettled(player, planetId, galaxy, system, position, coordinateKey, planetSeed)`
- `ColonyCreated(player, originPlanetId, colonyPlanetId, galaxy, system, position, fields, temperature)`
- `FleetMissionLaunched(missionId, player, missionType, originPlanetId, targetPlanetId, arrivalAt, returnAt, randomnessRequestId)`
- `FleetMissionCargo(missionId, metal, crystal, deuterium, fuelCost)`
- `FleetMissionShips(missionId, smallCargo, lightFighter, recycler, colonyShip, largeCargo, heavyFighter, cruiser, battleship, bomber, destroyer, deathstar, battlecruiser, reaper, pathfinder)`
- `FleetMissionRecalled(missionId, player, returnAt, recallCost)`
- `FleetMissionResolved(missionId, player, missionType, returnAt)`
- `FleetMissionReturnExposed(missionId, player, status, originPlanetId, targetPlanetId, returnAt, metal, crystal, deuterium)`
- `FleetMissionReturned(missionId, player, originPlanetId)`
- `MoonChanceRequested(outcomeId, battleId, targetPlanetId, defender, metalDebris, crystalDebris, chanceBps, randomnessRequestId, purposeHash)`
- `MoonChanceFinalized(outcomeId, battleId, targetPlanetId, chanceBps, moonCreated, randomWord, moonFields, moonDiameterKm)`
- `MoonChanceSkippedExistingMoon(battleId, targetPlanetId, metalDebris, crystalDebris)`
- `MoonCreated(owner, planetId, galaxy, system, position, fields, diameterKm)`

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
| 8 | Bomber |
| 9 | SolarSatellite |
| 10 | Destroyer |
| 11 | Deathstar |
| 12 | Battlecruiser |
| 13 | Reaper |
| 14 | Pathfinder |
| 15 | Crawler |

Technologies:

| ID | Name |
| --- | --- |
| 0 | Energy |
| 1 | Laser |
| 2 | Ion |
| 3 | CombustionDrive |
| 4 | Computer |
| 5 | Weapons |
| 6 | Shielding |
| 7 | Armor |
| 8 | Hyperspace |
| 9 | ImpulseDrive |
| 10 | HyperspaceDrive |
| 11 | Plasma |
| 12 | Astrophysics |
| 13 | IntergalacticResearchNetwork |
| 14 | Graviton |

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

`Deploy.s.sol` deploys the game, `RandomnessEngine`, the Moon System module, and
the Metal, Crystal, and Deuterium ERC-20 proxy contracts. It authorizes the game
and moon module as randomness requesters, wires the randomness and moon modules
into the game, wires the resource tokens into the game as reserve tokens, and
emits all proxy/module addresses. Configure the emitted moon module address as
`VEYDRIFT_MOON_CONTRACT_ADDRESS` for backend moon reads, and the emitted
randomness engine address for the backend fulfiller. Because the setup calls are
owner-only, `ADMIN_ADDRESS` must match the `PRIVATE_KEY` broadcaster for this
script.

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

- Markets
- NFTs or transferable planet ownership

Veydrift uses public blockchain state as the source of truth. Espionage reports,
hidden fleet intent, commit-reveal protections, private orderflow, and other
hidden-state mechanics are out of scope permanently for the product direction.
There is no private state, spy report flow, probe unit, or research path for
revealing information. VEY-KANEO-196 records this as the formal classic
espionage and hidden-intel exclusion. Fleet and combat systems should use the
public counterplay and anti-raid mechanics tracked from VEY-KANEO-119 through
VEY-KANEO-133: visible commitment, recall limits, return exposure, and
hostile-mission ACS/intercept counterplay.

VEY-KANEO-198 records the broader parity boundary: public onchain state, Rift
resource bridging, protected storage, Space Dock recovery, and Veydrift naming
are product-mode decisions unless a later scope ticket explicitly gates or
replaces them.

The MVP still enforces payment, duplicate-start prevention, coordinate collision prevention, planet limits, resource/fuel costs, cargo capacity, missile silo capacity, interplanetary missile interception and defense damage, one active construction or production slot per domain, basic dependencies, owner-gated upgrades/configuration, and timestamp-based lazy settlement.
