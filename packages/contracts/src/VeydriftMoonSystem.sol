// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftGameStorage} from "./VeydriftGameStorage.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftDependencies} from "./libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {MoonBuilding, Technology} from "./libraries/VeydriftTypes.sol";

interface IVeydriftMoonGame {
    function planet(uint256 planetId) external view returns (VeydriftGameStorage.Planet memory);
    function spendMoonResources(uint256 planetId, VeydriftGameStorage.Resources calldata cost)
        external;
    function technologyLevel(address player, Technology technology) external view returns (uint16);
}

interface IVeydriftRandomnessEngine {
    function requestRandomness(bytes32 purposeHash) external returns (uint256 requestId);
    function consumeRandomness(uint256 requestId, bytes32 purposeHash)
        external
        view
        returns (uint256 randomWord);
}

/// @notice Moon state and moon-only Veydrift structures kept outside VeydriftGame's size-bound core.
contract VeydriftMoonSystem {
    using SafeCast for uint256;

    uint16 public constant MAX_LEVEL = 50;
    uint16 public constant QUEUE_UNIVERSE_SPEED = 1;
    uint32 public constant MIN_QUEUE_SECONDS = 1;
    uint16 public constant MAX_GALAXY = 9;
    uint16 public constant MAX_SYSTEM = 499;
    bytes32 public constant MOON_SEED_DOMAIN = keccak256("veydrift.moon.v1");
    bytes32 public constant MOON_CHANCE_DOMAIN = keccak256("veydrift.moon-chance.v1");
    uint16 public constant BPS = 10_000;
    uint256 public constant MOON_CHANCE_DEBRIS_UNIT = 100_000;
    uint16 public constant MAX_MOON_CHANCE_BPS = 2_000;

    struct Moon {
        bool exists;
        uint256 planetId;
        address owner;
        uint16 fields;
        uint16 diameterKm;
        uint64 createdAt;
        uint64 jumpGateReadyAt;
    }

    struct MoonBuildingConstruction {
        bool active;
        MoonBuilding building;
        uint16 targetLevel;
        uint64 readyAt;
        VeydriftGameStorage.Resources cost;
    }

    struct MoonChanceOutcome {
        bool active;
        bool finalized;
        bool moonCreated;
        uint256 battleId;
        uint256 targetPlanetId;
        address defender;
        uint128 metalDebris;
        uint128 crystalDebris;
        uint16 chanceBps;
        uint256 randomnessRequestId;
        bytes32 purposeHash;
        uint256 randomWord;
        uint16 moonFields;
        uint16 moonDiameterKm;
        uint64 requestedAt;
        uint64 finalizedAt;
    }

    IVeydriftMoonGame public immutable game;
    IVeydriftRandomnessEngine public immutable randomness;
    address public owner;
    address public moonChanceReporter;
    uint256 public nextMoonChanceId = 1;
    mapping(uint256 planetId => Moon moon) internal _moons;
    mapping(uint256 planetId => mapping(MoonBuilding building => uint16 level)) internal
        _moonBuildingLevels;
    mapping(uint256 planetId => MoonBuildingConstruction construction) public
        moonBuildingConstructions;
    mapping(uint256 outcomeId => MoonChanceOutcome outcome) internal _moonChanceOutcomes;
    mapping(uint256 requestId => uint256 outcomeId) public moonChanceOutcomeByRequestId;
    mapping(bytes32 battleKey => uint256 outcomeId) public moonChanceOutcomeByBattle;

    error ConstructionActive();
    error ConstructionInactive();
    error ConstructionNotReady(uint64 readyAt);
    error InvalidCoordinates();
    error LevelTooHigh();
    error MissingDependency(bytes32 dependency);
    error MoonAlreadyExists(uint256 planetId);
    error MoonFieldCapacityReached();
    error NoMoon(uint256 planetId);
    error NoPlanet();
    error NotMoonOwner();
    error NotPlanetOwner();
    error SensorPhalanxOutOfRange(uint16 originSystem, uint16 targetSystem, uint256 range);
    error JumpGateMissing(uint256 planetId);
    error JumpGateNotReady(uint256 planetId, uint64 readyAt);
    error MoonChanceAlreadyRecorded(uint256 battleId, uint256 targetPlanetId);
    error MoonChanceAlreadyFinalized(uint256 outcomeId);
    error MoonChanceTooSmall(uint256 debris);
    error NotMoonChanceReporter(address account);
    error NotOwner(address account);
    error SameMoon();
    error UnknownMoonChanceOutcome(uint256 outcomeId);
    error ZeroAddress();

    event MoonCreated(
        address indexed owner,
        uint256 indexed planetId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        uint16 fields,
        uint16 diameterKm
    );
    event MoonBuildingStarted(
        uint256 indexed planetId,
        MoonBuilding indexed building,
        uint16 targetLevel,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event MoonBuildingCompleted(
        uint256 indexed planetId, MoonBuilding indexed building, uint16 level
    );
    event SensorPhalanxScanned(
        uint256 indexed moonPlanetId, uint16 indexed galaxy, uint16 indexed system, uint256 range
    );
    event JumpGateJumped(
        address indexed player,
        uint256 indexed originMoonPlanetId,
        uint256 indexed destinationMoonPlanetId,
        uint64 nextReadyAt
    );
    event MoonChanceReporterUpdated(address indexed oldReporter, address indexed newReporter);
    event MoonChanceSkippedExistingMoon(
        uint256 indexed battleId,
        uint256 indexed targetPlanetId,
        uint128 metalDebris,
        uint128 crystalDebris
    );
    event MoonChanceRequested(
        uint256 indexed outcomeId,
        uint256 indexed battleId,
        uint256 indexed targetPlanetId,
        address defender,
        uint128 metalDebris,
        uint128 crystalDebris,
        uint16 chanceBps,
        uint256 randomnessRequestId,
        bytes32 purposeHash
    );
    event MoonChanceFinalized(
        uint256 indexed outcomeId,
        uint256 indexed battleId,
        uint256 indexed targetPlanetId,
        uint16 chanceBps,
        bool moonCreated,
        uint256 randomWord,
        uint16 moonFields,
        uint16 moonDiameterKm
    );

    constructor(address gameAddress, address randomnessAddress) {
        if (gameAddress == address(0) || randomnessAddress == address(0)) revert ZeroAddress();
        game = IVeydriftMoonGame(gameAddress);
        randomness = IVeydriftRandomnessEngine(randomnessAddress);
        owner = msg.sender;
        moonChanceReporter = gameAddress;
        emit MoonChanceReporterUpdated(address(0), gameAddress);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    modifier onlyMoonChanceReporter() {
        if (msg.sender != moonChanceReporter) revert NotMoonChanceReporter(msg.sender);
        _;
    }

    function setMoonChanceReporter(address nextReporter) external onlyOwner {
        if (nextReporter == address(0)) revert ZeroAddress();
        address oldReporter = moonChanceReporter;
        moonChanceReporter = nextReporter;
        emit MoonChanceReporterUpdated(oldReporter, nextReporter);
    }

    function createMoon(uint256 planetId) external returns (Moon memory createdMoon) {
        VeydriftGameStorage.Planet memory planetRef = _requirePlanetOwner(planetId);
        if (_moons[planetId].exists) revert MoonAlreadyExists(planetId);

        uint256 seed =
            uint256(keccak256(abi.encodePacked(MOON_SEED_DOMAIN, block.chainid, planetId)));
        createdMoon = _createMoon(planetId, planetRef, msg.sender, seed);
    }

    function requestMoonChanceFromBattle(
        uint256 battleId,
        uint256 targetPlanetId,
        uint128 metalDebris,
        uint128 crystalDebris
    ) external onlyMoonChanceReporter returns (uint256 outcomeId, uint256 requestId) {
        VeydriftGameStorage.Planet memory planetRef = game.planet(targetPlanetId);
        if (planetRef.owner == address(0)) revert NoPlanet();

        bytes32 battleKey = _moonChanceBattleKey(battleId, targetPlanetId);
        if (moonChanceOutcomeByBattle[battleKey] != 0) {
            revert MoonChanceAlreadyRecorded(battleId, targetPlanetId);
        }

        if (_moons[targetPlanetId].exists) {
            moonChanceOutcomeByBattle[battleKey] = type(uint256).max;
            emit MoonChanceSkippedExistingMoon(battleId, targetPlanetId, metalDebris, crystalDebris);
            return (0, 0);
        }

        uint16 chanceBps = moonChanceBps(metalDebris, crystalDebris);
        if (chanceBps == 0) revert MoonChanceTooSmall(uint256(metalDebris) + crystalDebris);

        outcomeId = nextMoonChanceId++;
        bytes32 purposeHash = moonChancePurposeHash(
            outcomeId, battleId, targetPlanetId, metalDebris, crystalDebris, chanceBps
        );
        requestId = randomness.requestRandomness(purposeHash);

        _moonChanceOutcomes[outcomeId] = MoonChanceOutcome({
            active: true,
            finalized: false,
            moonCreated: false,
            battleId: battleId,
            targetPlanetId: targetPlanetId,
            defender: planetRef.owner,
            metalDebris: metalDebris,
            crystalDebris: crystalDebris,
            chanceBps: chanceBps,
            randomnessRequestId: requestId,
            purposeHash: purposeHash,
            randomWord: 0,
            moonFields: 0,
            moonDiameterKm: 0,
            requestedAt: _currentTimestamp(),
            finalizedAt: 0
        });
        moonChanceOutcomeByRequestId[requestId] = outcomeId;
        moonChanceOutcomeByBattle[battleKey] = outcomeId;

        emit MoonChanceRequested(
            outcomeId,
            battleId,
            targetPlanetId,
            planetRef.owner,
            metalDebris,
            crystalDebris,
            chanceBps,
            requestId,
            purposeHash
        );
    }

    function finalizeMoonChance(uint256 outcomeId) external returns (bool moonCreated) {
        MoonChanceOutcome storage outcome = _moonChanceOutcomes[outcomeId];
        if (!outcome.active) revert UnknownMoonChanceOutcome(outcomeId);
        if (outcome.finalized) revert MoonChanceAlreadyFinalized(outcomeId);

        uint256 randomWord =
            randomness.consumeRandomness(outcome.randomnessRequestId, outcome.purposeHash);
        outcome.finalized = true;
        outcome.randomWord = randomWord;
        outcome.finalizedAt = _currentTimestamp();

        uint256 moonSeed = _moonOutcomeSeed(outcome.targetPlanetId, outcome.purposeHash, randomWord);
        uint16 fields = _moonFields(moonSeed);
        uint16 diameterKm = _moonDiameter(moonSeed);
        if (!_moons[outcome.targetPlanetId].exists && randomWord % BPS < outcome.chanceBps) {
            VeydriftGameStorage.Planet memory planetRef = game.planet(outcome.targetPlanetId);
            _createMoon(outcome.targetPlanetId, planetRef, outcome.defender, moonSeed);
            outcome.moonCreated = true;
            outcome.moonFields = fields;
            outcome.moonDiameterKm = diameterKm;
            moonCreated = true;
        }

        emit MoonChanceFinalized(
            outcomeId,
            outcome.battleId,
            outcome.targetPlanetId,
            outcome.chanceBps,
            moonCreated,
            randomWord,
            outcome.moonFields,
            outcome.moonDiameterKm
        );
    }

    function startMoonBuildingUpgrade(uint256 planetId, MoonBuilding building) external {
        _requireMoonOwner(planetId);
        if (moonBuildingConstructions[planetId].active) revert ConstructionActive();

        uint16 currentLevel = _moonBuildingLevels[planetId][building];
        if (currentLevel >= MAX_LEVEL) revert LevelTooHigh();
        if (_moonUsedFields(planetId) >= _moons[planetId].fields) {
            revert MoonFieldCapacityReached();
        }

        _requireMoonBuildingDependencies(planetId, building);
        VeydriftGameStorage.Resources memory cost = moonBuildingUpgradeCost(planetId, building);
        game.spendMoonResources(planetId, cost);

        uint64 readyAt = (uint256(_currentTimestamp()) + _moonBuildingDuration(cost)).toUint64();
        uint16 targetLevel = currentLevel + 1;
        moonBuildingConstructions[planetId] = MoonBuildingConstruction({
            active: true, building: building, targetLevel: targetLevel, readyAt: readyAt, cost: cost
        });

        emit MoonBuildingStarted(
            planetId, building, targetLevel, readyAt, cost.metal, cost.crystal, cost.deuterium
        );
    }

    function finishMoonBuildingUpgrade(uint256 planetId) external {
        _requireMoonOwner(planetId);
        MoonBuildingConstruction memory construction = moonBuildingConstructions[planetId];
        if (!construction.active) revert ConstructionInactive();
        if (_currentTimestamp() < construction.readyAt) {
            revert ConstructionNotReady(construction.readyAt);
        }

        delete moonBuildingConstructions[planetId];
        _moonBuildingLevels[planetId][construction.building] = construction.targetLevel;
        if (construction.building == MoonBuilding.LunarBase) {
            _moons[planetId].fields += 3;
        }
        emit MoonBuildingCompleted(planetId, construction.building, construction.targetLevel);
    }

    function scanSystem(uint256 moonPlanetId, uint16 galaxy, uint16 system) external {
        _requireMoonOwner(moonPlanetId);
        VeydriftGameStorage.Planet memory origin = game.planet(moonPlanetId);
        validateSystem(galaxy, system);
        uint256 range = sensorPhalanxRange(moonPlanetId);
        if (range == 0 || galaxy != origin.galaxy || _systemDistance(origin.system, system) > range)
        {
            revert SensorPhalanxOutOfRange(origin.system, system, range);
        }

        emit SensorPhalanxScanned(moonPlanetId, galaxy, system, range);
    }

    function jumpGateJump(uint256 originMoonPlanetId, uint256 destinationMoonPlanetId) external {
        if (originMoonPlanetId == destinationMoonPlanetId) revert SameMoon();
        _requireMoonOwner(originMoonPlanetId);
        _requireMoonOwner(destinationMoonPlanetId);
        _requireJumpGate(originMoonPlanetId);
        _requireJumpGate(destinationMoonPlanetId);

        uint64 currentTime = _currentTimestamp();
        uint64 originReadyAt = _moons[originMoonPlanetId].jumpGateReadyAt;
        uint64 destinationReadyAt = _moons[destinationMoonPlanetId].jumpGateReadyAt;
        if (originReadyAt > currentTime) {
            revert JumpGateNotReady(originMoonPlanetId, originReadyAt);
        }
        if (destinationReadyAt > currentTime) {
            revert JumpGateNotReady(destinationMoonPlanetId, destinationReadyAt);
        }

        uint64 nextReadyAt = (uint256(currentTime) + 1 hours).toUint64();
        _moons[originMoonPlanetId].jumpGateReadyAt = nextReadyAt;
        _moons[destinationMoonPlanetId].jumpGateReadyAt = nextReadyAt;
        emit JumpGateJumped(msg.sender, originMoonPlanetId, destinationMoonPlanetId, nextReadyAt);
    }

    function moon(uint256 planetId) external view returns (Moon memory) {
        return _moons[planetId];
    }

    function moonChanceRandomness(uint256 outcomeId)
        external
        view
        returns (uint256 requestId, bytes32 purposeHash, bool finalized, uint256 randomWord)
    {
        MoonChanceOutcome storage outcome = _moonChanceOutcomes[outcomeId];
        return
            (
                outcome.randomnessRequestId,
                outcome.purposeHash,
                outcome.finalized,
                outcome.randomWord
            );
    }

    function moonChanceResult(uint256 outcomeId)
        external
        view
        returns (
            uint256 battleId,
            uint256 targetPlanetId,
            address defender,
            uint16 chanceBps,
            bool moonCreated,
            uint16 moonFields,
            uint16 moonDiameterKm
        )
    {
        MoonChanceOutcome storage outcome = _moonChanceOutcomes[outcomeId];
        return (
            outcome.battleId,
            outcome.targetPlanetId,
            outcome.defender,
            outcome.chanceBps,
            outcome.moonCreated,
            outcome.moonFields,
            outcome.moonDiameterKm
        );
    }

    function activeMoonBuildingConstruction(uint256 planetId)
        external
        view
        returns (MoonBuildingConstruction memory)
    {
        return moonBuildingConstructions[planetId];
    }

    function moonBuildingLevel(uint256 planetId, MoonBuilding building)
        external
        view
        returns (uint16)
    {
        return _moonBuildingLevels[planetId][building];
    }

    function moonBuildingUpgradeCost(uint256 planetId, MoonBuilding building)
        public
        view
        returns (VeydriftGameStorage.Resources memory)
    {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.moonBuildingUpgradeCost(
            building, _moonBuildingLevels[planetId][building]
        );
        return VeydriftGameStorage.Resources(metal, crystal, deuterium);
    }

    function sensorPhalanxRange(uint256 planetId) public view returns (uint256) {
        uint256 level = _moonBuildingLevels[planetId][MoonBuilding.SensorPhalanx];
        if (level == 0) return 0;
        return (level * level) - 1;
    }

    function moonChanceBps(uint128 metalDebris, uint128 crystalDebris)
        public
        pure
        returns (uint16)
    {
        uint256 debris = uint256(metalDebris) + crystalDebris;
        uint256 debrisUnits = debris / MOON_CHANCE_DEBRIS_UNIT;
        uint256 chanceBps = debrisUnits * 100;
        if (chanceBps > MAX_MOON_CHANCE_BPS) return MAX_MOON_CHANCE_BPS;
        return chanceBps.toUint16();
    }

    function moonChancePurposeHash(
        uint256 outcomeId,
        uint256 battleId,
        uint256 targetPlanetId,
        uint128 metalDebris,
        uint128 crystalDebris,
        uint16 chanceBps
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                MOON_CHANCE_DOMAIN,
                block.chainid,
                address(this),
                outcomeId,
                battleId,
                targetPlanetId,
                metalDebris,
                crystalDebris,
                chanceBps
            )
        );
    }

    function _requirePlanetOwner(uint256 planetId)
        private
        view
        returns (VeydriftGameStorage.Planet memory planetRef)
    {
        planetRef = game.planet(planetId);
        if (planetRef.owner == address(0)) revert NoPlanet();
        if (planetRef.owner != msg.sender) revert NotPlanetOwner();
    }

    function _requireMoonOwner(uint256 planetId) private view {
        Moon storage moonRef = _moons[planetId];
        if (!moonRef.exists) revert NoMoon(planetId);
        if (moonRef.owner != msg.sender) revert NotMoonOwner();
    }

    function _requireJumpGate(uint256 planetId) private view {
        if (_moonBuildingLevels[planetId][MoonBuilding.JumpGate] == 0) {
            revert JumpGateMissing(planetId);
        }
    }

    function _requireMoonBuildingDependencies(uint256 planetId, MoonBuilding building)
        private
        view
    {
        try VeydriftDependencies.requireMoonBuilding(
            building,
            _moonBuildingLevels[planetId][MoonBuilding.LunarBase],
            game.technologyLevel(msg.sender, Technology.Hyperspace)
        ) {}
        catch (bytes memory reason) {
            _bubbleMissingDependency(reason);
        }
    }

    function _bubbleMissingDependency(bytes memory reason) private pure {
        if (reason.length < 68) {
            assembly {
                revert(add(reason, 32), mload(reason))
            }
        }

        bytes4 selector;
        bytes32 dependency;
        assembly {
            selector := mload(add(reason, 32))
            dependency := mload(add(reason, 68))
        }
        if (selector == VeydriftDependencies.MissingDependency.selector) {
            revert MissingDependency(dependency);
        }
        assembly {
            revert(add(reason, 32), mload(reason))
        }
    }

    function _moonBuildingDuration(VeydriftGameStorage.Resources memory cost)
        private
        pure
        returns (uint256)
    {
        return VeydriftFormulas.buildingDuration(
            0, 0, cost.metal, cost.crystal, QUEUE_UNIVERSE_SPEED, MIN_QUEUE_SECONDS
        );
    }

    function _moonUsedFields(uint256 planetId) private view returns (uint256 used) {
        for (uint8 i = 0; i <= uint8(type(MoonBuilding).max); i++) {
            used += _moonBuildingLevels[planetId][MoonBuilding(i)];
        }
    }

    function _createMoon(
        uint256 planetId,
        VeydriftGameStorage.Planet memory planetRef,
        address moonOwner,
        uint256 randomWord
    ) private returns (Moon memory createdMoon) {
        uint16 fields = _moonFields(randomWord);
        uint16 diameterKm = _moonDiameter(randomWord);
        createdMoon = Moon({
            exists: true,
            planetId: planetId,
            owner: moonOwner,
            fields: fields,
            diameterKm: diameterKm,
            createdAt: _currentTimestamp(),
            jumpGateReadyAt: 0
        });
        _moons[planetId] = createdMoon;

        emit MoonCreated(
            moonOwner,
            planetId,
            planetRef.galaxy,
            planetRef.system,
            planetRef.position,
            fields,
            diameterKm
        );
    }

    function _moonChanceBattleKey(uint256 battleId, uint256 targetPlanetId)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(battleId, targetPlanetId));
    }

    function _moonOutcomeSeed(uint256 targetPlanetId, bytes32 purposeHash, uint256 randomWord)
        private
        pure
        returns (uint256)
    {
        return
            uint256(
                keccak256(abi.encode(MOON_CHANCE_DOMAIN, targetPlanetId, purposeHash, randomWord))
            );
    }

    function _moonFields(uint256 randomWord) private pure returns (uint16) {
        return uint16(1 + (randomWord % 3));
    }

    function _moonDiameter(uint256 randomWord) private pure returns (uint16) {
        return uint16(3_400 + (randomWord % 5_101));
    }

    function validateSystem(uint16 galaxy, uint16 system) private pure {
        if (galaxy == 0 || galaxy > MAX_GALAXY || system == 0 || system > MAX_SYSTEM) {
            revert InvalidCoordinates();
        }
    }

    function _systemDistance(uint16 left, uint16 right) private pure returns (uint256) {
        return left > right ? left - right : right - left;
    }

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}
