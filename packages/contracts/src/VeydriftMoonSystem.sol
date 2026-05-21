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

/// @notice Moon state and moon-only OGame structures kept outside VeydriftGame's size-bound core.
contract VeydriftMoonSystem {
    using SafeCast for uint256;

    uint16 public constant MAX_LEVEL = 50;
    uint32 public constant MIN_QUEUE_SECONDS = 60;
    uint16 public constant MAX_GALAXY = 9;
    uint16 public constant MAX_SYSTEM = 499;
    bytes32 public constant MOON_SEED_DOMAIN = keccak256("veydrift.moon.v1");

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

    IVeydriftMoonGame public immutable game;
    mapping(uint256 planetId => Moon moon) internal _moons;
    mapping(uint256 planetId => mapping(MoonBuilding building => uint16 level)) internal
        _moonBuildingLevels;
    mapping(uint256 planetId => MoonBuildingConstruction construction) public
        moonBuildingConstructions;

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
    error SameMoon();

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

    constructor(address gameAddress) {
        game = IVeydriftMoonGame(gameAddress);
    }

    function createMoon(uint256 planetId) external returns (Moon memory createdMoon) {
        VeydriftGameStorage.Planet memory planetRef = _requirePlanetOwner(planetId);
        if (_moons[planetId].exists) revert MoonAlreadyExists(planetId);

        uint16 diameterKm = _moonDiameter(planetId);
        createdMoon = Moon({
            exists: true,
            planetId: planetId,
            owner: msg.sender,
            fields: _moonFields(0),
            diameterKm: diameterKm,
            createdAt: _currentTimestamp(),
            jumpGateReadyAt: 0
        });
        _moons[planetId] = createdMoon;

        emit MoonCreated(
            msg.sender,
            planetId,
            planetRef.galaxy,
            planetRef.system,
            planetRef.position,
            createdMoon.fields,
            diameterKm
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
            _moons[planetId].fields = _moonFields(construction.targetLevel);
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
        return VeydriftFormulas.buildingDuration(0, 0, cost.metal, cost.crystal, MIN_QUEUE_SECONDS);
    }

    function _moonUsedFields(uint256 planetId) private view returns (uint256 used) {
        for (uint8 i = 0; i <= uint8(type(MoonBuilding).max); i++) {
            used += _moonBuildingLevels[planetId][MoonBuilding(i)];
        }
    }

    function _moonFields(uint16 lunarBaseLevel) private pure returns (uint16) {
        return 1 + lunarBaseLevel * 3;
    }

    function _moonDiameter(uint256 planetId) private view returns (uint16) {
        bytes32 seed = keccak256(abi.encodePacked(MOON_SEED_DOMAIN, block.chainid, planetId));
        return uint16(3_400 + (uint256(seed) % 5_101));
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
