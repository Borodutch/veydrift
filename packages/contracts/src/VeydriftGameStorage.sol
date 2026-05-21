// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Building, Defense, Resource, Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IERC20ReserveToken {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Shared storage, ABI structs, events, and owner controls for VeydriftGame modules.
abstract contract VeydriftGameStorage {
    uint256 public constant DEFAULT_START_PRICE = 0.05 ether;
    uint8 public constant MAX_BUILDING_ID = uint8(type(Building).max);
    uint8 public constant MAX_DEFENSE_ID = uint8(type(Defense).max);
    uint8 public constant MAX_SHIP_ID = uint8(type(Ship).max);
    uint8 public constant MAX_TECHNOLOGY_ID = uint8(type(Technology).max);
    uint8 public constant MAX_RESOURCE_ID = uint8(type(Resource).max);
    uint16 public constant MAX_LEVEL = 50;
    uint16 public constant BPS = 10_000;
    uint16 public constant RAID_LOOT_CAP_BPS = 5_000;
    uint16 public constant PROTECTED_STORAGE_BPS = 1_000;
    uint32 public constant MIN_QUEUE_SECONDS = 60;
    uint32 public constant MIN_FLEET_TRAVEL_SECONDS = 5 minutes;
    uint32 public constant FLEET_RECALL_CUTOFF_SECONDS = 60;
    uint16 public constant FLEET_RECALL_COST_BPS = 2_500;
    uint64 public constant MARKET_WITHDRAWAL_DELAY = 30 days;
    uint16 public constant MAX_GALAXY = 9;
    uint16 public constant MAX_SYSTEM = 499;
    uint8 public constant MAX_POSITION = 15;
    bytes32 public constant FIRST_PLANET_DOMAIN = keccak256("veydrift.first-planet.v1");
    bytes32 public constant PLANET_SEED_DOMAIN = keccak256("veydrift.planet.v1");
    bytes32 public constant ATTACK_BATTLE_DOMAIN = keccak256("veydrift.attack-battle.v1");
    uint8 public constant BATTLE_MAX_ROUNDS = 6;
    uint16 public constant RAID_LOOT_BPS = 5_000;
    uint16 public constant RAID_PROTECTED_STORAGE_BPS = 1_000;
    uint16 public constant COMBAT_DEBRIS_BPS = 3_000;

    struct Resources {
        uint128 metal;
        uint128 crystal;
        uint128 deuterium;
    }

    struct Planet {
        address owner;
        uint16 galaxy;
        uint16 system;
        uint8 position;
        uint16 fields;
        int16 temperature;
        uint16 metalMultiplierBps;
        uint16 crystalMultiplierBps;
        uint16 deuteriumMultiplierBps;
        uint64 lastSettledAt;
        Resources resources;
    }

    struct FirstPlanet {
        uint16 galaxy;
        uint16 system;
        uint8 position;
        uint16 fields;
        int16 temperature;
        uint64 settledAt;
        uint64 settledBlock;
    }

    struct BuildingConstruction {
        bool active;
        Building building;
        uint16 targetLevel;
        uint64 readyAt;
        Resources cost;
    }

    struct DefenseQueue {
        bool active;
        Defense defense;
        uint32 quantity;
        uint64 readyAt;
        Resources cost;
    }

    struct ShipQueue {
        bool active;
        Ship ship;
        uint32 quantity;
        uint64 readyAt;
        Resources cost;
    }

    struct ResearchQueue {
        bool active;
        Technology technology;
        uint16 targetLevel;
        uint64 readyAt;
        Resources cost;
    }

    struct Fleet {
        bool active;
        bool returning;
        address owner;
        uint256 originPlanetId;
        uint256 destinationPlanetId;
        uint64 dispatchedAt;
        uint64 arrivesAt;
        uint128 fuelCost;
        Resources cargo;
        uint32 smallCargo;
        uint32 recycler;
        uint32 colonyShip;
    }

    enum FleetMissionType {
        Transport,
        Deploy,
        Colonize,
        Attack,
        Harvest,
        AcsDefend,
        Intercept,
        MissileAttack
    }

    enum FleetMissionStatus {
        None,
        Outbound,
        Returning,
        Resolved,
        Returned,
        Recalled
    }

    enum BattleOutcome {
        Draw,
        AttackerWin,
        DefenderWin
    }

    struct MissionShips {
        uint32 smallCargo;
        uint32 lightFighter;
        uint32 recycler;
        uint32 colonyShip;
        uint32 largeCargo;
        uint32 heavyFighter;
        uint32 cruiser;
        uint32 battleship;
        uint32 removedShipSlot;
        uint32 bomber;
        uint32 destroyer;
        uint32 deathstar;
        uint32 battlecruiser;
        uint32 reaper;
        uint32 pathfinder;
    }

    struct FleetMission {
        FleetMissionStatus status;
        FleetMissionType missionType;
        address owner;
        uint256 originPlanetId;
        uint256 targetPlanetId;
        uint64 departureAt;
        uint64 arrivalAt;
        uint64 returnAt;
        uint128 fuelCost;
        Resources cargo;
        MissionShips ships;
        uint256 randomnessRequestId;
    }

    struct DebrisField {
        uint128 metal;
        uint128 crystal;
    }

    struct ResourceWithdrawal {
        bool active;
        uint256 planetId;
        Resource resource;
        uint128 amount;
        uint64 unlocksAt;
    }

    uint256 public startPrice;
    uint256 public nextPlanetId;
    address internal _owner;

    mapping(address player => uint256 planetId) public homePlanetOf;
    mapping(uint256 planetId => Planet planet) internal _planets;
    mapping(bytes32 coordinateKey => bool occupied) public occupiedCoordinates;
    mapping(uint256 planetId => mapping(Building building => uint16 level)) internal
        _buildingLevels;
    mapping(uint256 planetId => BuildingConstruction construction) public buildingConstructions;
    mapping(uint256 planetId => DefenseQueue queue) public defenseQueues;
    mapping(uint256 planetId => ShipQueue queue) public shipQueues;
    mapping(address player => ResearchQueue queue) public researchQueues;
    uint256 public nextFleetId;
    mapping(address player => uint256 count) public planetCountOf;
    mapping(Resource resource => IERC20ReserveToken token) internal _resourceTokens;
    Resources internal _totalInternalResources;
    Resources internal _lockedWithdrawalResources;
    mapping(address player => mapping(Resource resource => ResourceWithdrawal withdrawal)) public
        resourceWithdrawals;
    mapping(uint256 planetId => mapping(Defense defense => uint32 count)) internal _defenseCounts;
    mapping(address player => mapping(Technology technology => uint16 level)) internal
        _technologyLevels;
    address internal _moonSystem;
    mapping(uint256 planetId => mapping(Ship ship => uint32 count)) internal _shipCounts;
    mapping(uint256 fleetId => Fleet fleet) internal _fleets;
    mapping(uint256 missionId => FleetMission mission) internal _fleetMissions;
    mapping(address player => uint256 count) public activeFleetMissionCount;
    mapping(uint256 planetId => string name) public planetNames;
    mapping(uint256 planetId => DebrisField field) internal _debrisFields;
    address internal _spaceDockSystem;

    error AlreadyStarted();
    error BadStartPayment();
    error CoordinatesExhausted();
    error InvalidId();
    error InvalidQuantity();
    error NoPlanet();
    error NotPlanetOwner();
    error QueueActive();
    error QueueInactive();
    error QueueNotReady(uint64 readyAt);
    error NoFirstPlanet(address player);
    error ConstructionActive();
    error ConstructionInactive();
    error ConstructionNotReady(uint64 readyAt);
    error InsufficientResources(uint128 metal, uint128 crystal, uint128 deuterium);
    error MissingDependency(bytes32 dependency);
    error FieldCapacityReached();
    error LevelTooHigh();
    error InvalidCoordinates();
    error CoordinatesOccupied();
    error PlanetLimitReached(uint256 limit);
    error InsufficientShips(Ship ship, uint32 available, uint32 required);
    error SamePlanet();
    error CargoCapacityExceeded(uint256 capacity, uint256 cargo);
    error FleetInactive();
    error FleetNotOwner();
    error FleetNotArrived(uint64 arrivesAt);
    error FleetAlreadyReturning();
    error FleetAlreadyArrived();
    error FleetRecallCutoffPassed(uint64 recallDeadline);
    error InvalidMissionType(FleetMissionType missionType);
    error FleetSlotLimitReached(uint256 limit);
    error FleetMissionNotResolved(uint64 returnAt);
    error DebrisFieldEmpty();
    error RiftStabilizerRequired(uint256 planetId);
    error ResourceTokenNotConfigured(Resource resource);
    error WithdrawalActive(Resource resource);
    error WithdrawalInactive(Resource resource);
    error WithdrawalNotReady(uint64 unlocksAt);
    error TransferFailed();
    error Unauthorized(address account);
    error InvalidResource(Resource resource);
    error ResourceTokenUnset(Resource resource);
    error ResourceTransferFailed(Resource resource, address token, uint256 amount);
    error InsufficientResourceReserve(Resource resource, uint256 required, uint256 available);
    error UnsupportedGameplayModule();
    error DefenseLimitReached(Defense defense);
    error MissileSiloCapacityExceeded(uint32 requiredSlots, uint32 availableSlots);
    error InvalidPlanetName();
    error CannotAbandonHomePlanet();
    error PlanetHasActiveQueues();
    error PlanetHasResources();
    error PlanetHasActiveFleetMissions();

    event StartPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event PlanetStarted(
        address indexed player,
        uint256 indexed planetId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        uint16 fields,
        int16 temperature
    );
    event FirstPlanetSettled(
        address indexed player,
        uint256 indexed planetId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        bytes32 coordinateKey,
        bytes32 planetSeed
    );
    event PlanetSettled(
        uint256 indexed planetId, uint128 metal, uint128 crystal, uint128 deuterium
    );
    event BuildingStarted(
        uint256 indexed planetId,
        Building indexed building,
        uint16 targetLevel,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event BuildingCompleted(uint256 indexed planetId, Building indexed building, uint16 level);
    event DefenseQueued(
        uint256 indexed planetId,
        Defense indexed defense,
        uint32 quantity,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event DefenseCompleted(
        uint256 indexed planetId, Defense indexed defense, uint32 quantity, uint32 total
    );
    event ShipQueued(
        uint256 indexed planetId,
        Ship indexed ship,
        uint32 quantity,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event ShipCompleted(uint256 indexed planetId, Ship indexed ship, uint32 quantity, uint32 total);
    event ResearchQueued(
        address indexed player,
        Technology indexed technology,
        uint16 targetLevel,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event ResearchCompleted(address indexed player, Technology indexed technology, uint16 level);
    event ColonyCreated(
        address indexed player,
        uint256 indexed originPlanetId,
        uint256 indexed colonyPlanetId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        uint16 fields,
        int16 temperature
    );
    event FleetDispatched(
        uint256 indexed fleetId,
        address indexed player,
        uint256 indexed originPlanetId,
        uint256 destinationPlanetId,
        uint64 arrivesAt,
        uint32 smallCargo,
        uint32 recycler,
        uint32 colonyShip,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium,
        uint128 fuelCost
    );
    event FleetRecalled(
        uint256 indexed fleetId,
        address indexed player,
        uint256 indexed originPlanetId,
        uint256 destinationPlanetId,
        uint64 arrivesAt
    );
    event FleetArrived(
        uint256 indexed fleetId,
        address indexed player,
        uint256 indexed destinationPlanetId,
        bool returning
    );
    event ResourcesTransferred(
        uint256 indexed fleetId,
        uint256 indexed originPlanetId,
        uint256 indexed destinationPlanetId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event FleetMissionLaunched(
        uint256 indexed missionId,
        address indexed owner,
        FleetMissionType indexed missionType,
        uint256 originPlanetId,
        uint256 targetPlanetId,
        uint64 arrivalAt,
        uint64 returnAt,
        uint256 randomnessRequestId
    );
    event FleetMissionCargo(
        uint256 indexed missionId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium,
        uint128 fuelCost
    );
    event FleetMissionShips(
        uint256 indexed missionId,
        uint32 smallCargo,
        uint32 lightFighter,
        uint32 recycler,
        uint32 colonyShip,
        uint32 largeCargo,
        uint32 heavyFighter,
        uint32 cruiser,
        uint32 battleship,
        uint32 bomber,
        uint32 destroyer,
        uint32 deathstar,
        uint32 battlecruiser,
        uint32 reaper,
        uint32 pathfinder
    );
    event FleetMissionRecalled(
        uint256 indexed missionId, address indexed owner, uint64 returnAt, uint128 recallCost
    );
    event FleetMissionResolved(
        uint256 indexed missionId,
        address indexed resolver,
        FleetMissionType indexed missionType,
        uint64 returnAt
    );
    event AttackBattleResolved(
        uint256 indexed missionId,
        address indexed attacker,
        uint256 indexed targetPlanetId,
        BattleOutcome outcome,
        uint8 rounds,
        uint256 randomSeed,
        uint128 lootMetal,
        uint128 lootCrystal,
        uint128 lootDeuterium
    );
    event CombatLosses(
        uint256 indexed missionId,
        uint128 attackerMetal,
        uint128 attackerCrystal,
        uint128 attackerDeuterium,
        uint128 defenderMetal,
        uint128 defenderCrystal,
        uint128 defenderDeuterium
    );
    event CombatDebrisSignaled(
        uint256 indexed missionId, uint256 indexed targetPlanetId, uint128 metal, uint128 crystal
    );
    event FleetMissionReturnExposed(
        uint256 indexed missionId,
        address indexed owner,
        FleetMissionStatus indexed status,
        uint256 originPlanetId,
        uint256 targetPlanetId,
        uint64 returnAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event FleetMissionReturned(
        uint256 indexed missionId, address indexed owner, uint256 indexed planetId
    );
    event DebrisFieldUpdated(uint256 indexed planetId, uint128 metal, uint128 crystal);
    event InterplanetaryMissileAttack(
        address indexed attacker,
        uint256 indexed originPlanetId,
        uint256 indexed targetPlanetId,
        Defense primaryTarget,
        uint32 launched,
        uint32 intercepted,
        uint32 hits,
        uint32 destroyedPrimary
    );
    event RaidLootResolved(
        uint256 indexed targetPlanetId,
        uint256 cargoCapacity,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium,
        uint128 protectedMetal,
        uint128 protectedCrystal,
        uint128 protectedDeuterium
    );
    event ResourceTokenUpdated(
        Resource indexed resource, address indexed oldToken, address indexed newToken
    );
    event ResourceTokensUpdated(address metalToken, address crystalToken, address deuteriumToken);
    event ResourceReservesDeposited(
        address indexed depositor, uint128 metal, uint128 crystal, uint128 deuterium
    );
    event MarketResourceDeposited(
        address indexed player, uint256 indexed planetId, Resource indexed resource, uint128 amount
    );
    event MarketResourceWithdrawalRequested(
        address indexed player,
        uint256 indexed planetId,
        Resource indexed resource,
        uint128 amount,
        uint64 unlocksAt
    );
    event MarketResourceWithdrawalFinished(
        address indexed player, uint256 indexed planetId, Resource indexed resource, uint128 amount
    );
    event PlanetRenamed(address indexed player, uint256 indexed planetId, string name);
    event PlanetAbandoned(
        address indexed player,
        uint256 indexed planetId,
        uint16 galaxy,
        uint16 system,
        uint8 position
    );
    event FeesWithdrawn(address indexed to, uint256 amount);

    constructor(address admin) {
        _owner = admin;
        startPrice = DEFAULT_START_PRICE;
        nextPlanetId = 1;
        nextFleetId = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != _owner) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    function owner() external view returns (address) {
        return _owner;
    }

    function setStartPrice(uint256 nextPrice) external onlyOwner {
        uint256 oldPrice = startPrice;
        startPrice = nextPrice;
        emit StartPriceUpdated(oldPrice, nextPrice);
    }

    function withdrawFees(address payable to) external onlyOwner {
        uint256 amount = address(this).balance;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FeesWithdrawn(to, amount);
    }
}
