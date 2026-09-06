// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftMoonIncarnation} from "./libraries/VeydriftMoonIncarnation.sol";
import {Building, Defense, Resource, Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IERC20ReserveToken {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IVeydriftAttackProtectionAllianceSystem {
    function attackLimitAllianceContext(address attacker, address defender)
        external
        view
        returns (
            uint256 attackerAllianceId,
            uint256 defenderAllianceId,
            bool sameAlliance,
            bool atWar,
            bool bashingWarException,
            bool scoreProtectionException
        );
}

interface IVeydriftProductionBonusAllianceSystem {
    function creditPaidInviteProduction(
        address invitee,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    ) external returns (VeydriftGameStorage.Resources memory bonus);
}

/// @notice Shared storage, ABI structs, events, and owner controls for VeydriftGame modules.
abstract contract VeydriftGameStorage is Initializable {
    uint256 public constant DEFAULT_START_PRICE = 0.05 ether;
    uint8 public constant MAX_BUILDING_ID = uint8(type(Building).max);
    uint8 public constant MAX_DEFENSE_ID = uint8(type(Defense).max);
    uint8 public constant MAX_SHIP_ID = uint8(type(Ship).max);
    uint8 public constant MAX_TECHNOLOGY_ID = uint8(type(Technology).max);
    uint8 public constant MAX_RESOURCE_ID = uint8(type(Resource).max);
    uint16 public constant MAX_LEVEL = 50;
    uint16 public constant BPS = 10_000;
    uint16 public constant QUEUE_UNIVERSE_SPEED = 1;
    uint16 public constant FLEET_UNIVERSE_SPEED = 1;
    uint32 public constant MIN_QUEUE_SECONDS = 1;
    uint32 public constant MIN_FLEET_TRAVEL_SECONDS = 10;
    /// @notice Canonical local route used only when recyclers harvest their origin planet's debris.
    /// @dev A non-zero distance keeps same-planet Harvest subject to normal fuel and travel math.
    uint32 internal constant LOCAL_HARVEST_DISTANCE = 5;
    uint32 public constant FLEET_RECALL_CUTOFF_SECONDS = 60;
    uint64 public constant MARKET_WITHDRAWAL_DELAY = 30 days;
    uint64 public constant RIFT_EXTRACTION_DELAY = 28 days;
    uint16 public constant MAX_GALAXY = 9;
    uint16 public constant MAX_SYSTEM = 499;
    uint8 public constant MAX_POSITION = 15;
    bytes32 public constant FIRST_PLANET_DOMAIN = keccak256("veydrift.first-planet.v1");
    bytes32 public constant PLANET_SEED_DOMAIN = keccak256("veydrift.planet.v1");
    bytes32 public constant ATTACK_BATTLE_DOMAIN = keccak256("veydrift.attack-battle.v1");
    uint8 public constant BATTLE_MAX_ROUNDS = 6;
    uint16 public constant RAID_LOOT_BPS = VeydriftAntiRaidPrimitives.BASE_RAID_LOOT_BPS;
    uint16 public constant RAID_PROTECTED_STORAGE_BPS =
        VeydriftAntiRaidPrimitives.PROTECTED_STORAGE_BPS;
    uint16 internal constant COMBAT_DEBRIS_BPS = 3_000;
    uint16 internal constant REFERRAL_INVITER_FEE_BPS = 5_000;
    /// @notice Referral and paid-alliance invitees produce twice the normal resources for one week.
    /// @dev This is a player-wide modifier; it composes with the planet, Energy, and Crawler rules.
    uint64 internal constant INVITEE_PRODUCTION_BOOST_DURATION = 7 days;

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

    /// @dev Immutable timing inputs for one ship/defense production batch. Stored separately from
    ///      the legacy queue structs so the deployed proxy layout and every pre-upgrade queue remain
    ///      intact. A zero `startedAt` marks a legacy queue: it keeps the original all-at-readyAt
    ///      settlement behavior instead of inventing a per-unit anchor.
    struct ProductionQueueTiming {
        uint64 startedAt;
        uint32 originalQuantity;
        uint256 unitWorkSeconds;
        uint256 rate;
    }

    struct ResearchQueue {
        bool active;
        Technology technology;
        uint16 targetLevel;
        uint64 readyAt;
        Resources cost;
    }

    struct EffectivePlanetState {
        uint64 asOf;
        Planet planet;
        uint16[16] buildingLevels;
        uint32[16] shipCounts;
        uint32[10] defenseCounts;
        uint16[15] technologyLevels;
        Resources storageCaps;
        uint256 metalPerHour;
        uint256 crystalPerHour;
        uint256 deuteriumPerHour;
        uint256 producedEnergy;
        uint256 requiredEnergy;
        uint256 energyScaleBps;
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
        MissileAttack,
        AcsAttack,
        DefenseHold
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

    enum AttackBlockReason {
        None,
        BashingLimit,
        ScoreProtection,
        SameAlliance
    }

    uint8 internal constant ATTACK_RELATION_STRONGER_FLAG = 1;
    uint8 internal constant ATTACK_RELATION_WEAKER_FLAG = 2;
    uint8 internal constant ATTACK_HONORABLE_FLAG = 4;
    uint8 internal constant ATTACK_BANDIT_FLAG = 8;
    uint8 internal constant ATTACK_INACTIVE_FLAG = 16;

    /// @notice Player-selected split of cargo capacity across looted resources.
    /// @dev Either all fields are zero (legacy greedy metal->crystal->deuterium order) or the three
    ///      bps values sum to exactly `BPS`. Unfillable shares roll over to the remaining resources
    ///      in metal->crystal->deuterium order.
    struct LootRatio {
        uint16 metalBps;
        uint16 crystalBps;
        uint16 deuteriumBps;
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
        uint32 bomber;
        uint32 destroyer;
        uint32 deathstar;
        uint32 battlecruiser;
        uint32 reaper;
        uint32 pathfinder;
    }

    /// @notice One caller-owned source planet's contribution to a single-destination transport batch.
    /// @dev Kept ABI-compatible with the normal Transport launch inputs so the batch path shares the
    ///      exact same fuel, cargo, fleet-slot, and mission-resolution rules as an individual mission.
    struct TransportBatchOrder {
        uint256 originPlanetId;
        MissionShips ships;
        Resources cargo;
        uint16 speedPercent;
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
        LootRatio lootRatio;
        bool originIsMoon;
        bool targetIsMoon;
    }

    struct AttackWindow {
        uint64 windowStartedAt;
        uint32 count;
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

    /// @notice A planet-scoped Rift extraction claim. The amount stays inside the
    /// game for the full extraction period, is not spendable by its owner, and is
    /// deliberately exposed to raids until the owner finalizes the surviving claim.
    struct RiftExtraction {
        bool active;
        uint128 amount;
        uint64 startedAt;
        uint64 unlocksAt;
    }

    /// @dev Append-only progress for gas-bounded multi-transaction combat resolution.
    struct BattleResolutionProgress {
        uint256 seed;
        Resources attackerLosses;
        Resources defenderLosses;
        uint256 defenderDefenseDestroyed;
        uint8 rounds;
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
    mapping(bytes32 attackKey => AttackWindow window) internal _attackWindows;
    mapping(bytes32 playerPairKey => bool enabled) internal _attackProtectionExemptions;
    address internal _allianceSystem;
    mapping(uint256 hostileMissionId => uint256[] missionIds) internal _fleetCounterplayMissions;
    address internal _randomnessEngine;
    mapping(address player => uint64 lastActiveAt) internal playerLastActiveAt;
    mapping(address player => int256 points) internal honorPoints;
    mapping(address player => uint256[] planetIds) internal _ownedPlanetIds;
    mapping(uint256 planetId => uint256 indexPlusOne) internal _ownedPlanetIndex;
    mapping(uint256 planetId => uint256[] missionIds) internal _resolutionMissionIdsByPlanet;
    mapping(address player => uint256[] missionIds) internal _resolutionMissionIdsByPlayer;
    mapping(uint256 planetId => mapping(uint256 missionId => uint256 indexPlusOne)) internal
        _resolutionMissionIndexByPlanet;
    mapping(address player => mapping(uint256 missionId => uint256 indexPlusOne)) internal
        _resolutionMissionIndexByPlayer;
    mapping(bytes32 systemKey => uint256[] missionIds) internal _phalanxMissionIdsBySystem;
    mapping(bytes32 systemKey => mapping(uint256 missionId => uint256 indexPlusOne)) internal
        _phalanxMissionIndexBySystem;
    mapping(uint256 planetId => DefenseQueue[] queue) internal _defenseQueueBacklogs;
    mapping(uint256 planetId => ShipQueue[] queue) internal _shipQueueBacklogs;
    mapping(uint256 planetId => Resources resources) internal _moonResources;
    mapping(uint256 planetId => mapping(Ship ship => uint32 count)) internal _moonShipCounts;
    // OGame-style ACS Defend (DefenseHold): fleets stationed at a planet for a chosen hold window
    // automatically defend any attack that lands while they are holding.
    mapping(uint256 defenderPlanetId => uint256[] missionIds) internal _stationedDefenseMissions;
    mapping(uint256 defenderPlanetId => mapping(uint256 missionId => uint256 indexPlusOne)) internal
        _stationedDefenseMissionIndex;
    mapping(uint256 missionId => uint64 holdUntil) internal _defenseHoldUntil;
    address internal _migrationSettlement;
    uint256 internal _gamePaused;
    // VEY-KANEO-758: append-only production timing metadata. Keying by immutable batch `readyAt`
    // keeps active/backlog promotion cheap and preserves same-second multi-unit boundaries.
    mapping(uint256 planetId => mapping(uint64 readyAt => ProductionQueueTiming timing)) internal
        _shipQueueTimings;
    mapping(uint256 planetId => mapping(uint64 readyAt => ProductionQueueTiming timing)) internal
        _defenseQueueTimings;
    // Rift V2 is planet-scoped: a player may extract each resource independently
    // from multiple stabilized planets. This is append-only to preserve the live
    // proxy layout and leaves the legacy single-withdrawal mapping readable.
    mapping(uint256 planetId => mapping(Resource resource => RiftExtraction extraction)) public
        riftExtractions;
    mapping(uint256 planetId => Resources resources) internal _riftLockedResources;
    // Append-only: exact player-wide invitee 2x production window. Its fixed seven-day start
    // is derived from this stored expiry, which also keeps migrated snapshots non-retroactive.
    mapping(address player => uint64 expiresAt) internal _inviteeProductionBoostExpiresAt;
    // Large battles resolve in the largest gas-safe chunks of complete rounds. Each round has an
    // isolated child-call revert boundary; progress is deleted as soon as final settlement completes.
    mapping(uint256 missionId => BattleResolutionProgress progress) internal
        _battleResolutionProgress;
    // Append-only moon-attack parity state. A mission records the exact moon generation that was
    // present at launch, preventing a destroyed moon's replacement at the same planet id from
    // inheriting in-flight ships, cargo, or attacks. The activation timestamp lets the first
    // post-upgrade moon attack conservatively inherit an active legacy shared bashing window.
    mapping(uint256 missionId => uint64 generation) internal _missionOriginMoonGeneration;
    mapping(uint256 missionId => uint64 generation) internal _missionTargetMoonGeneration;
    uint64 internal _moonAttackParityActivatedAt;
    mapping(uint256 missionId => bool recorded) internal _missionOriginMoonGenerationRecorded;
    mapping(uint256 missionId => bool recorded) internal _missionTargetMoonGenerationRecorded;
    // Append-only generation marker for the classic per-slot planet temperature rollout. Fresh
    // deployments initialize at V2; the live proxy starts at zero and is migrated once while
    // paused, preserving each planet's original centered temperature roll.
    uint8 internal _planetTemperatureGenerationVersion;
    // Append-only resumable migration progress. Bounded batches stay below Base's per-transaction
    // gas ceiling; a rolled-back implementation can later resume without remigrating any planet.
    uint256 internal _planetTemperatureMigrationCursor;
    uint256 internal _planetTemperatureMigratedCount;
    // Append-only pre-combat raid basis. Separate mappings preserve the already-deployed
    // BattleResolutionProgress value layout while carrying protection state across combat chunks.
    mapping(uint256 missionId => uint16 plunderBps) internal _battleRaidPlunderBps;
    mapping(uint256 missionId => bool snapshotted) internal _battleRaidProtectionSnapshotted;
    // Append-only payload for timed, one-way interplanetary missile missions. Existing historical
    // strikes were atomic and therefore leave no pending mission state to migrate.
    mapping(uint256 missionId => Defense primaryTarget) internal _missileMissionPrimaryTarget;
    mapping(uint256 missionId => uint32 quantity) internal _missileMissionQuantity;

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
    error UnpopulatedCoordinates();
    error PlanetLimitReached(uint256 limit);
    error InsufficientShips(Ship ship, uint32 available, uint32 required);
    error SamePlanet();
    error SelfAttack();
    error CargoNotAllowed();
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
    error RiftExtractionActive(uint256 planetId, Resource resource);
    error RiftExtractionInactive(uint256 planetId, Resource resource);
    error ResourceTokenNotConfigured(Resource resource);
    error LegacyWithdrawalDisabled();
    error WithdrawalActive(Resource resource);
    error WithdrawalInactive(Resource resource);
    error WithdrawalNotReady(uint64 unlocksAt);
    error TransferFailed();
    error Unauthorized(address account);
    error ReferralSignerUnset();
    error ReferralCommitmentInvalid();
    error ReferralCommitmentAlreadyClaimed(bytes32 commitment);
    error ReferralInviteInvalid(bytes32 commitment);
    error ReferralInviteAlreadyClaimed(address inviter, bytes32 commitment);
    error ReferralInviteExpired(bytes32 commitment, uint64 expiredAt);
    error ReferralInviteeAlreadyRedeemed(bytes32 commitment, address invitee);
    error ReferralSignatureInvalid();
    error ReferralSelfInvite();
    error ReferralRedemptionQuotaExceeded(bytes32 commitment, uint64 resetsAt);
    error InvalidResource(Resource resource);
    error ResourceTokenUnset(Resource resource);
    error ResourceTransferFailed(Resource resource, address token, uint256 amount);
    error InsufficientResourceReserve(Resource resource, uint256 required, uint256 available);
    error InvalidResourceTreasury();
    error InsufficientExcessResourceReserve(
        Resource resource,
        uint256 requested,
        uint256 liabilityRequirement,
        uint256 safetyMargin,
        uint256 available
    );
    error UnsupportedGameplayModule();
    error GameMustBePaused();
    error PlanetTemperatureMigrationPending();
    error PlanetTemperatureMigrationCompleted();
    error DefenseLimitReached(Defense defense);
    error MissileSiloCapacityExceeded(uint32 requiredSlots, uint32 availableSlots);
    error InvalidMissileTarget(Defense defense);
    error InterplanetaryMissileOutOfRange(uint16 originSystem, uint16 targetSystem, uint256 range);
    error AttackBashingLimitReached();
    error AttackScoreProtection();
    error SameAllianceAttack();
    error InvalidPlanetName();
    error CannotAbandonHomePlanet();
    error PlanetHasActiveQueues();
    error PlanetHasResources();
    error PlanetHasActiveFleetMissions();
    error AttackJoinCutoffPassed(uint64 cutoffAt);
    error CannotJoinOwnAttackTarget();
    error RandomnessEngineUnset();
    error InvalidLootRatio();
    error InvalidHoldWindow(uint256 holdSeconds);
    error DefenseHoldNotAuthorized(uint256 defenderPlanetId);
    error DefenseHoldStillActive(uint64 holdUntil);
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
    event InviteeProductionBoostActivated(address indexed player, uint64 expiresAt);
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
        uint256 indexed planetId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium,
        uint64 settledAt
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
    event ShipQueueTimingSet(
        uint256 indexed planetId,
        Ship indexed ship,
        uint64 indexed readyAt,
        uint64 startedAt,
        uint32 originalQuantity,
        uint256 unitWorkSeconds,
        uint256 rate
    );
    event DefenseQueueTimingSet(
        uint256 indexed planetId,
        Defense indexed defense,
        uint64 indexed readyAt,
        uint64 startedAt,
        uint32 originalQuantity,
        uint256 unitWorkSeconds,
        uint256 rate
    );
    event ResearchQueued(
        address indexed player,
        Technology indexed technology,
        uint16 targetLevel,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    /// @dev Versioned research-start event with the planet that paid the research cost.
    /// The legacy ResearchQueued event remains emitted for backwards compatibility.
    event ResearchQueuedV2(
        address indexed player,
        uint256 indexed planetId,
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
    event AttackMissionJoined(
        uint256 indexed attackMissionId,
        uint256 indexed joinedMissionId,
        address indexed participant,
        uint256 originPlanetId,
        uint256 targetPlanetId
    );
    event FleetMissionCargo(
        uint256 indexed missionId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium,
        uint128 fuelCost
    );
    event FleetMissionBodies(uint256 indexed missionId, bool originIsMoon, bool targetIsMoon);
    event FleetMissionLootRatio(
        uint256 indexed missionId, uint16 metalBps, uint16 crystalBps, uint16 deuteriumBps
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
    event RandomnessEngineUpdated(
        address indexed oldRandomnessEngine, address indexed newRandomnessEngine
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
    event CombatRoundResolved(
        uint256 indexed missionId,
        uint8 indexed round,
        uint256 attackerUnits,
        uint256 defenderUnits,
        uint128 attackerLossMetal,
        uint128 attackerLossCrystal,
        uint128 defenderLossMetal,
        uint128 defenderLossCrystal
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
    event PlanetShipCountChanged(uint256 indexed planetId, Ship indexed ship, uint32 total);
    event PlanetDefenseCountChanged(
        uint256 indexed planetId, Defense indexed defense, uint32 total
    );
    event MoonResourcesChanged(
        uint256 indexed planetId, uint128 metal, uint128 crystal, uint128 deuterium
    );
    event MoonShipCountChanged(uint256 indexed planetId, Ship indexed ship, uint32 total);
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
    event DefenseHoldStationed(
        uint256 indexed missionId,
        address indexed owner,
        uint256 indexed defenderPlanetId,
        uint256 originPlanetId,
        uint64 arrivalAt,
        uint64 holdUntil,
        uint64 returnAt
    );
    event DefenseHoldEnded(
        uint256 indexed missionId, uint256 indexed defenderPlanetId, FleetMissionStatus status
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
    event InterplanetaryMissileLaunched(
        uint256 indexed missionId, Defense primaryTarget, uint32 quantity
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
    event ExcessResourceReserveReleased(
        Resource indexed resource,
        address indexed treasury,
        uint256 amount,
        uint256 liabilityRequirement,
        uint256 safetyMargin,
        uint256 remainingBalance
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
    event RiftExtractionStarted(
        address indexed player,
        uint256 indexed planetId,
        Resource indexed resource,
        uint128 amount,
        uint64 startedAt,
        uint64 unlocksAt
    );
    event RiftExtractionLooted(
        address indexed attacker,
        uint256 indexed planetId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event RiftExtractionFinalized(
        address indexed player, uint256 indexed planetId, Resource indexed resource, uint128 amount
    );
    event AllianceBonusCreditedToPlanet(
        address indexed manager,
        uint256 indexed planetId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event PlanetRenamed(address indexed player, uint256 indexed planetId, string name);
    event PlanetTemperatureChanged(
        uint256 indexed planetId, int16 previousTemperature, int16 newTemperature
    );
    event PlanetTemperatureGenerationMigrated(uint256 planetCount);
    event PlanetAbandoned(
        address indexed player,
        uint256 indexed planetId,
        uint16 galaxy,
        uint16 system,
        uint8 position
    );
    event FeesWithdrawn(address indexed to, uint256 amount);

    constructor(address admin) {
        _initializeGameStorage(admin);
        _disableInitializers();
    }

    function __VeydriftGameStorage_init(address admin) internal onlyInitializing {
        _initializeGameStorage(admin);
    }

    function _initializeGameStorage(address admin) private {
        _owner = admin;
        startPrice = DEFAULT_START_PRICE;
        nextPlanetId = 1;
        nextFleetId = 1;
        _moonAttackParityActivatedAt = uint64(block.timestamp);
        _planetTemperatureGenerationVersion = 2;
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

    function setAttackProtectionExemption(address attacker, address defender, bool enabled)
        external
        onlyOwner
    {
        _attackProtectionExemptions[_playerPairKey(attacker, defender)] = enabled;
    }

    function _attackBattlePurposeHash(uint256 missionId) internal view returns (bytes32) {
        return keccak256(abi.encode(ATTACK_BATTLE_DOMAIN, block.chainid, missionId));
    }

    function _playerPairKey(address attacker, address defender) internal pure returns (bytes32) {
        return keccak256(abi.encode(attacker, defender));
    }

    function _requireGameNotPaused() internal view {
        if (_gamePaused != 0) revert Unauthorized(msg.sender);
    }

    function _touchPlayer(address player) internal {
        _requireGameNotPaused();
        uint64 currentTime = uint64(block.timestamp);
        if (playerLastActiveAt[player] == currentTime) return;
        playerLastActiveAt[player] = currentTime;
    }

    function _activateInviteeProductionBoost(address player) internal {
        uint64 expiresAt = uint64(block.timestamp) + INVITEE_PRODUCTION_BOOST_DURATION;
        _inviteeProductionBoostExpiresAt[player] = expiresAt;
        emit InviteeProductionBoostActivated(player, expiresAt);
    }

    function _registerOwnedPlanet(address player, uint256 planetId) internal {
        if (_ownedPlanetIndex[planetId] != 0) return;
        _ownedPlanetIds[player].push(planetId);
        _ownedPlanetIndex[planetId] = _ownedPlanetIds[player].length;
    }

    function _unregisterOwnedPlanet(address player, uint256 planetId) internal {
        uint256 indexPlusOne = _ownedPlanetIndex[planetId];
        if (indexPlusOne == 0) return;

        uint256[] storage planetIds = _ownedPlanetIds[player];
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = planetIds.length - 1;
        if (index != lastIndex) {
            uint256 movedPlanetId = planetIds[lastIndex];
            planetIds[index] = movedPlanetId;
            _ownedPlanetIndex[movedPlanetId] = indexPlusOne;
        }
        planetIds.pop();
        delete _ownedPlanetIndex[planetId];
    }

    /// @dev Canonical topic0 hashes for the two count-changed events. Both are emitted through the
    ///      shared `_writeUnitCount` sink below so the LOG3 bytecode exists once per module rather
    ///      than once per event, keeping the size-critical combat module within the EIP-170 limit.
    ///      The events stay declared above so the ABI and off-chain decoders are unchanged.
    bytes32 private constant _SHIP_COUNT_CHANGED_TOPIC =
        keccak256("PlanetShipCountChanged(uint256,uint8,uint32)");
    bytes32 private constant _DEFENSE_COUNT_CHANGED_TOPIC =
        keccak256("PlanetDefenseCountChanged(uint256,uint8,uint32)");
    bytes32 private constant _MOON_SHIP_COUNT_CHANGED_TOPIC =
        keccak256("MoonShipCountChanged(uint256,uint8,uint32)");

    /// @dev Writes `total` into a `mapping(uint256 planetId => mapping(uintEnum unit => uint32))` at
    ///      `baseSlot` and emits a matching `(planetId indexed, unit indexed, uint32 total)` log. The
    ///      storage slot is derived exactly as Solidity derives `m[planetId][unitId]`
    ///      (`keccak(unitId . keccak(planetId . baseSlot))`) and the log is identical to a Solidity
    ///      `emit` of the matching event. Folding the store + log here means the nested-mapping write
    ///      and the LOG3 bytecode each exist once, rather than once per ship/defense setter — the
    ///      headroom the size-critical combat module needs to stay within EIP-170.
    function _writeUnitCount(
        uint256 baseSlot,
        bytes32 topic0,
        uint256 planetId,
        uint256 unitId,
        uint32 total
    ) private {
        assembly ("memory-safe") {
            mstore(0x00, planetId)
            mstore(0x20, baseSlot)
            mstore(0x20, keccak256(0x00, 0x40))
            mstore(0x00, unitId)
            sstore(keccak256(0x00, 0x40), total)
            mstore(0x00, total)
            log3(0x00, 0x20, topic0, planetId, unitId)
        }
    }

    /// @dev Overwrites a planet's stored ship count and emits the resulting total. This is the single
    ///      ship-count mutation sink: every ship state change routes through here so indexers can
    ///      track ship state without polling, and the event-emitting bytecode exists only once.
    function _setPlanetShipCount(uint256 planetId, Ship ship, uint32 total) internal {
        uint256 baseSlot;
        assembly {
            baseSlot := _shipCounts.slot
        }
        _writeUnitCount(baseSlot, _SHIP_COUNT_CHANGED_TOPIC, planetId, uint256(uint8(ship)), total);
    }

    /// @dev Adds `quantity` ships to a planet and emits the resulting total. No-op when `quantity` is 0.
    function _creditPlanetShips(uint256 planetId, Ship ship, uint32 quantity) internal {
        if (quantity == 0) return;
        _setPlanetShipCount(planetId, ship, _shipCounts[planetId][ship] + quantity);
    }

    /// @dev Removes `quantity` ships from a planet and emits the resulting total. No-op when `quantity`
    ///      is 0. Reverts on underflow like a checked `-=`, so callers must validate availability first.
    function _debitPlanetShips(uint256 planetId, Ship ship, uint32 quantity) internal {
        if (quantity == 0) return;
        _setPlanetShipCount(planetId, ship, _shipCounts[planetId][ship] - quantity);
    }

    function _setMoonShipCount(uint256 planetId, Ship ship, uint32 total) internal {
        uint256 baseSlot;
        assembly {
            baseSlot := _moonShipCounts.slot
        }
        _writeUnitCount(
            baseSlot, _MOON_SHIP_COUNT_CHANGED_TOPIC, planetId, uint256(uint8(ship)), total
        );
    }

    function _creditMoonShips(uint256 planetId, Ship ship, uint32 quantity) internal {
        if (quantity == 0) return;
        _setMoonShipCount(planetId, ship, _moonShipCounts[planetId][ship] + quantity);
    }

    function _debitMoonShips(uint256 planetId, Ship ship, uint32 quantity) internal {
        if (quantity == 0) return;
        _setMoonShipCount(planetId, ship, _moonShipCounts[planetId][ship] - quantity);
    }

    /// @dev Overwrites a planet's stored defense count and emits the resulting total. Single
    ///      defense-count mutation sink, mirroring `_setPlanetShipCount`.
    function _setPlanetDefenseCount(uint256 planetId, Defense defense, uint32 total) internal {
        uint256 baseSlot;
        assembly {
            baseSlot := _defenseCounts.slot
        }
        _writeUnitCount(
            baseSlot, _DEFENSE_COUNT_CHANGED_TOPIC, planetId, uint256(uint8(defense)), total
        );
    }

    /// @dev Adds `quantity` defenses to a planet and emits the resulting total. No-op when 0.
    function _creditPlanetDefenses(uint256 planetId, Defense defense, uint32 quantity) internal {
        if (quantity == 0) return;
        _setPlanetDefenseCount(planetId, defense, _defenseCounts[planetId][defense] + quantity);
    }

    /// @dev Removes `quantity` defenses from a planet and emits the resulting total. No-op when 0.
    ///      Reverts on underflow like a checked `-=`, so callers must validate availability first.
    function _debitPlanetDefenses(uint256 planetId, Defense defense, uint32 quantity) internal {
        if (quantity == 0) return;
        _setPlanetDefenseCount(planetId, defense, _defenseCounts[planetId][defense] - quantity);
    }

    /// @dev Single authoritative resource-balance sink. Emits the planet's post-mutation
    ///      `{metal,crystal,deuterium,settledAt}`. Every discrete resource mutation (cost spend,
    ///      cargo/loot credit, raid debit, collect, starting balance) routes through here so the
    ///      backend indexer tracks balances from events alone — never an on-the-fly `previewResources`
    ///      RPC read. Production accrued purely by elapsed time carries no discrete delta and is
    ///      derived off-chain from the last emitted `settledAt`; this event fires whenever the stored
    ///      balance changes by anything other than passive time, always carrying the final values and a
    ///      `settledAt == block.timestamp` baseline. Funnelling through one `internal` helper keeps the
    ///      emitting bytecode to a single copy per module, mirroring `_setPlanetShipCount`.
    function _emitPlanetSettled(uint256 planetId) internal {
        Planet storage planetRef = _planets[planetId];
        Resources storage balance = planetRef.resources;
        emit PlanetSettled(
            planetId, balance.metal, balance.crystal, balance.deuterium, planetRef.lastSettledAt
        );
    }

    function _emitMoonResourcesChanged(uint256 planetId) internal {
        Resources storage balance = _moonResources[planetId];
        emit MoonResourcesChanged(planetId, balance.metal, balance.crystal, balance.deuterium);
    }

    function _recordAttack(address attacker, uint256 targetPlanetId) internal {
        _recordAttack(attacker, targetPlanetId, false);
    }

    function _recordAttack(address attacker, uint256 targetPlanetId, bool targetIsMoon) internal {
        address defender = _attackDefender(targetPlanetId);
        bool defenderInactive =
            VeydriftAntiRaidPrimitives.isInactive(playerLastActiveAt[defender], block.timestamp);
        if (_isAttackProtectionExempt(attacker, defender) || defenderInactive) {
            return;
        }

        bytes32 legacyWindowKey = _attackWindowKey(attacker, defender, targetPlanetId);
        AttackWindow storage legacyWindow = _attackWindows[legacyWindowKey];
        // If the pre-cutover shared window was active at activation, keep both bodies on that
        // single window until it naturally expires. This makes the transition observable and
        // exactly reproducible by the indexed UI instead of forking the count mid-window.
        bytes32 windowKey = targetIsMoon && !_legacyMoonAttackWindowActive(legacyWindow)
            ? _attackWindowKey(attacker, defender, targetPlanetId, true)
            : legacyWindowKey;
        AttackWindow storage window = _attackWindows[windowKey];
        uint64 currentTime = uint64(block.timestamp);
        if (
            window.windowStartedAt == 0
                || currentTime
                    >= window.windowStartedAt + VeydriftAntiRaidPrimitives.BASHING_WINDOW_SECONDS
        ) {
            window.windowStartedAt = currentTime;
            window.count = 1;
        } else {
            window.count += 1;
        }
    }

    function _attackProtectionStatus(address attacker, uint256 targetPlanetId)
        internal
        view
        returns (AttackBlockReason reason, uint8 flags, uint16 plunderBps)
    {
        return _attackProtectionStatus(attacker, targetPlanetId, false);
    }

    function _attackProtectionStatus(address attacker, uint256 targetPlanetId, bool targetIsMoon)
        internal
        view
        returns (AttackBlockReason reason, uint8 flags, uint16 plunderBps)
    {
        address defender = _attackDefender(targetPlanetId);
        uint256 attackerScore = _totalUserScore(attacker);
        uint256 defenderScore = _totalUserScore(defender);
        bool defenderInactive =
            VeydriftAntiRaidPrimitives.isInactive(playerLastActiveAt[defender], block.timestamp);
        if (defenderInactive) flags |= ATTACK_INACTIVE_FLAG;

        bool defenderBandit =
            honorPoints[defender] <= VeydriftAntiRaidPrimitives.BANDIT_HONOR_THRESHOLD;
        bool honorable = VeydriftAntiRaidPrimitives.isHonorableTarget(
            attackerScore, defenderScore, honorPoints[defender], defenderInactive
        );
        if (defenderBandit) flags |= ATTACK_BANDIT_FLAG;
        else if (honorable) flags |= ATTACK_HONORABLE_FLAG;
        plunderBps = VeydriftAntiRaidPrimitives.plunderBps();
        flags |= _attackRelationFlags(attackerScore, defenderScore);

        if (attacker == defender || _isAttackProtectionExempt(attacker, defender)) {
            return (AttackBlockReason.None, flags, plunderBps);
        }
        (bool sameAlliance, bool bashingWarException, bool scoreProtectionException) =
            _attackProtectionAllianceContext(attacker, defender);
        if (sameAlliance) return (AttackBlockReason.SameAlliance, flags, plunderBps);
        if (VeydriftAntiRaidPrimitives.isScoreProtected(
                attackerScore, defenderScore, scoreProtectionException, defenderInactive
            )) {
            return (AttackBlockReason.ScoreProtection, flags, plunderBps);
        }
        if (VeydriftAntiRaidPrimitives.isBashingLimitReached(
                _currentBodyAttackCount(attacker, defender, targetPlanetId, targetIsMoon),
                bashingWarException || defenderInactive
            )) {
            return (AttackBlockReason.BashingLimit, flags, plunderBps);
        }
    }

    function _attackRelationFlags(uint256 attackerScore, uint256 defenderScore)
        internal
        pure
        returns (uint8)
    {
        uint32 attackerRatio = VeydriftAntiRaidPrimitives.newbieProtectionRatioBps(attackerScore);
        uint32 defenderRatio = VeydriftAntiRaidPrimitives.newbieProtectionRatioBps(defenderScore);
        if (defenderRatio != 0 && attackerScore * BPS > defenderScore * defenderRatio) {
            return ATTACK_RELATION_WEAKER_FLAG;
        }
        if (attackerRatio != 0 && defenderScore * BPS > attackerScore * attackerRatio) {
            return ATTACK_RELATION_STRONGER_FLAG;
        }
        return 0;
    }

    function _currentAttackCount(bytes32 windowKey) internal view returns (uint32) {
        AttackWindow memory window = _attackWindows[windowKey];
        uint64 currentTime = uint64(block.timestamp);
        if (
            window.windowStartedAt == 0
                || currentTime
                    >= window.windowStartedAt + VeydriftAntiRaidPrimitives.BASHING_WINDOW_SECONDS
        ) {
            return 0;
        }
        return window.count;
    }

    function _isAttackProtectionExempt(address attacker, address defender)
        internal
        view
        returns (bool)
    {
        return _attackProtectionExemptions[_playerPairKey(attacker, defender)];
    }

    function _attackProtectionAllianceContext(address attacker, address defender)
        internal
        view
        returns (bool sameAlliance, bool bashingWarException, bool scoreProtectionException)
    {
        address allianceSystem = _allianceSystem;
        if (allianceSystem == address(0)) return (false, false, false);
        (,, sameAlliance,, bashingWarException, scoreProtectionException) =
            IVeydriftAttackProtectionAllianceSystem(allianceSystem)
                .attackLimitAllianceContext(attacker, defender);
    }

    function _attackDefender(uint256 targetPlanetId) internal view returns (address) {
        address defender = _planets[targetPlanetId].owner;
        if (defender == address(0)) revert NoPlanet();
        return defender;
    }

    function _attackWindowKey(address attacker, address defender, uint256 targetPlanetId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(attacker, defender, targetPlanetId));
    }

    /// @dev Planet windows retain their historical key exactly. Moon windows use a distinct domain
    ///      so attacking either body never consumes the other body's bashing allowance.
    function _attackWindowKey(
        address attacker,
        address defender,
        uint256 targetPlanetId,
        bool targetIsMoon
    ) internal pure returns (bytes32) {
        return targetIsMoon
            ? keccak256(
                abi.encode("VEYDRIFT_MOON_ATTACK_WINDOW", attacker, defender, targetPlanetId)
            )
            : _attackWindowKey(attacker, defender, targetPlanetId);
    }

    function _currentBodyAttackCount(
        address attacker,
        address defender,
        uint256 targetPlanetId,
        bool targetIsMoon
    ) internal view returns (uint32 count) {
        AttackWindow storage legacyWindow = _attackWindows[
            _attackWindowKey(attacker, defender, targetPlanetId)
        ];
        if (targetIsMoon && _legacyMoonAttackWindowActive(legacyWindow)) {
            return _currentAttackCount(_attackWindowKey(attacker, defender, targetPlanetId));
        }
        count =
            _currentAttackCount(_attackWindowKey(attacker, defender, targetPlanetId, targetIsMoon));
        return count;
    }

    function _legacyMoonAttackWindowActive(AttackWindow storage legacyWindow)
        internal
        view
        returns (bool)
    {
        uint64 currentTime = uint64(block.timestamp);
        return _moonAttackParityActivatedAt != 0 && legacyWindow.windowStartedAt != 0
            && legacyWindow.windowStartedAt <= _moonAttackParityActivatedAt
            && currentTime
                < uint256(legacyWindow.windowStartedAt)
                    + VeydriftAntiRaidPrimitives.BASHING_WINDOW_SECONDS;
    }

    function _recordMissionMoonIncarnations(
        uint256 missionId,
        uint256 originPlanetId,
        uint256 targetPlanetId,
        bool originIsMoon,
        bool targetIsMoon
    ) internal {
        VeydriftMoonIncarnation.recordMission(
            _missionOriginMoonGeneration,
            _missionTargetMoonGeneration,
            _missionOriginMoonGenerationRecorded,
            _missionTargetMoonGenerationRecorded,
            _moonSystem,
            missionId,
            originPlanetId,
            targetPlanetId,
            originIsMoon,
            targetIsMoon
        );
    }

    function _missionMoonExistsForOwner(
        uint256 missionId,
        uint256 planetId,
        address owner_,
        bool origin
    ) internal view returns (bool) {
        uint64 expected = origin
            ? _missionOriginMoonGeneration[missionId]
            : _missionTargetMoonGeneration[missionId];
        bool generationRecorded = origin
            ? _missionOriginMoonGenerationRecorded[missionId]
            : _missionTargetMoonGenerationRecorded[missionId];
        // The linked decoder keeps timestamp and legacy-generation compatibility checks identical
        // without embedding the MoonSystem's wide tuple decode in every game module.
        return VeydriftMoonIncarnation.existsForMissionOwner(
            _moonSystem,
            planetId,
            owner_,
            _fleetMissions[missionId].departureAt,
            expected,
            generationRecorded
        );
    }

    function _totalUserScore(address player) internal view returns (uint256 score) {
        for (uint8 id = 0; id <= MAX_TECHNOLOGY_ID;) {
            score += uint256(_technologyLevels[player][Technology(id)]) * (id + 1) * 15;
            unchecked {
                ++id;
            }
        }
        uint256[] storage planetIds = _ownedPlanetIds[player];
        for (uint256 planetIndex = 0; planetIndex < planetIds.length;) {
            uint256 planetId = planetIds[planetIndex];
            score += 1_000;
            for (uint8 id = 0; id <= MAX_BUILDING_ID;) {
                score += uint256(_buildingLevels[planetId][Building(id)]) * (id + 1) * 10;
                unchecked {
                    ++id;
                }
            }
            for (uint8 id = 0; id <= MAX_DEFENSE_ID;) {
                score += uint256(_defenseCounts[planetId][Defense(id)]) * (id + 1) * 2;
                unchecked {
                    ++id;
                }
            }
            for (uint8 id = 0; id <= MAX_SHIP_ID;) {
                score += (uint256(_shipCounts[planetId][Ship(id)])
                        + uint256(_moonShipCounts[planetId][Ship(id)])) * (id + 1) * 4;
                unchecked {
                    ++id;
                }
            }
            unchecked {
                ++planetIndex;
            }
        }

        uint256[] storage missionIds = _resolutionMissionIdsByPlayer[player];
        for (uint256 missionIndex = 0; missionIndex < missionIds.length;) {
            FleetMission storage mission = _fleetMissions[missionIds[missionIndex]];
            if (
                mission.owner == player && mission.missionType <= FleetMissionType.Colonize
                    && (mission.status == FleetMissionStatus.Outbound
                        || mission.status == FleetMissionStatus.Returning)
            ) {
                score += _missionShipScore(mission.ships);
            }
            unchecked {
                ++missionIndex;
            }
        }
    }

    function _missionShipScore(MissionShips storage ships) private view returns (uint256) {
        return uint256(ships.smallCargo) * 4 + uint256(ships.lightFighter) * 8
            + uint256(ships.recycler) * 12 + uint256(ships.colonyShip) * 16
            + uint256(ships.largeCargo) * 20 + uint256(ships.heavyFighter) * 24
            + uint256(ships.cruiser) * 28 + uint256(ships.battleship) * 32 + uint256(ships.bomber)
            * 36 + uint256(ships.destroyer) * 44 + uint256(ships.deathstar) * 48
            + uint256(ships.battlecruiser) * 52 + uint256(ships.reaper) * 56
            + uint256(ships.pathfinder) * 60;
    }

    function withdrawFees(address payable to) external onlyOwner {
        uint256 amount = address(this).balance;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FeesWithdrawn(to, amount);
    }
}
