// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftGameStorage} from "./VeydriftGameStorage.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {Building, Ship} from "./libraries/VeydriftTypes.sol";

interface IVeydriftSpaceDockGame {
    function planet(uint256 planetId) external view returns (VeydriftGameStorage.Planet memory);
    function buildingLevel(uint256 planetId, Building building) external view returns (uint16);
}

/// @notice OGame-style Space Dock wreckage and repair accounting for combat modules.
contract VeydriftSpaceDockSystem {
    using SafeCast for uint256;

    uint32 public constant MIN_QUEUE_SECONDS = 60;
    uint64 public constant WRECKAGE_TTL = 3 days;
    uint256 public constant MIN_WRECKAGE_VALUE = 150_000;
    uint16 public constant BPS = 10_000;

    struct WreckageField {
        bool active;
        uint64 expiresAt;
    }

    struct RepairQueue {
        bool active;
        Ship ship;
        uint32 quantity;
        uint64 readyAt;
    }

    IVeydriftSpaceDockGame public immutable game;
    address public owner;
    mapping(uint256 planetId => WreckageField field) public wreckageFields;
    mapping(uint256 planetId => RepairQueue queue) public repairQueues;
    mapping(uint256 planetId => uint16 level) public spaceDockLevels;
    mapping(uint256 planetId => mapping(Ship ship => uint32 count)) internal _repairableShips;
    mapping(uint256 planetId => mapping(Ship ship => uint32 count)) internal _repairedShips;

    error InvalidQuantity();
    error NoPlanet();
    error NotOwner();
    error NotPlanetOwner();
    error NoSpaceDock(uint256 planetId);
    error WreckageTooSmall(uint256 destroyedValue);
    error ShipNotRepairable(Ship ship);
    error WreckageExpired(uint64 expiresAt);
    error InsufficientWreckage(Ship ship, uint32 available, uint32 requested);
    error QueueActive();
    error QueueInactive();
    error QueueNotReady(uint64 readyAt);

    event WreckageRecorded(
        uint256 indexed planetId,
        Ship indexed ship,
        uint32 destroyed,
        uint32 repairable,
        uint64 expiresAt
    );
    event ShipRepairStarted(
        uint256 indexed planetId, Ship indexed ship, uint32 quantity, uint64 readyAt
    );
    event ShipRepairFinished(uint256 indexed planetId, Ship indexed ship, uint32 quantity);
    event SpaceDockLevelSet(uint256 indexed planetId, uint16 level);

    constructor(address gameAddress, address admin) {
        game = IVeydriftSpaceDockGame(gameAddress);
        owner = admin;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        owner = nextOwner;
    }

    function setSpaceDockLevel(uint256 planetId, uint16 level) external onlyOwner {
        _requirePlanet(planetId);
        spaceDockLevels[planetId] = level;
        emit SpaceDockLevelSet(planetId, level);
    }

    function spaceDockUpgradeCost(uint256 planetId)
        external
        view
        returns (VeydriftGameStorage.Resources memory)
    {
        (uint128 metal, uint128 crystal, uint128 deuterium) =
            VeydriftCatalog.spaceDockUpgradeCost(_spaceDockLevel(planetId));
        return VeydriftGameStorage.Resources(metal, crystal, deuterium);
    }

    /// @dev Combat modules call this after a qualifying battle over the planet or its moon.
    function recordCombatWreckage(uint256 planetId, Ship ship, uint32 destroyed)
        external
        onlyOwner
    {
        if (destroyed == 0) revert InvalidQuantity();
        if (!VeydriftCatalog.shipRepairableInSpaceDock(ship)) revert ShipNotRepairable(ship);
        _requirePlanet(planetId);
        uint16 spaceDockLevel = _spaceDockLevel(planetId);
        if (spaceDockLevel == 0) revert NoSpaceDock(planetId);

        uint256 destroyedValue = VeydriftCatalog.shipStructuralValue(ship) * destroyed;
        if (destroyedValue < MIN_WRECKAGE_VALUE) revert WreckageTooSmall(destroyedValue);

        uint32 repairable = ((uint256(destroyed)
                    * VeydriftCatalog.spaceDockRepairBps(spaceDockLevel)) / BPS)
        .toUint32();
        uint64 expiresAt = (uint256(_currentTimestamp()) + WRECKAGE_TTL).toUint64();
        wreckageFields[planetId] = WreckageField({active: true, expiresAt: expiresAt});
        _repairableShips[planetId][ship] += repairable;
        emit WreckageRecorded(planetId, ship, destroyed, repairable, expiresAt);
    }

    function startShipRepair(uint256 planetId, Ship ship, uint32 quantity) external {
        _requirePlanetOwner(planetId);
        if (quantity == 0) revert InvalidQuantity();
        if (repairQueues[planetId].active) revert QueueActive();
        _requireFreshWreckage(planetId);

        uint32 available = _repairableShips[planetId][ship];
        if (available < quantity) revert InsufficientWreckage(ship, available, quantity);

        _repairableShips[planetId][ship] = available - quantity;
        uint64 readyAt =
            (uint256(_currentTimestamp()) + _repairDuration(planetId, ship, quantity)).toUint64();
        repairQueues[planetId] =
            RepairQueue({active: true, ship: ship, quantity: quantity, readyAt: readyAt});
        emit ShipRepairStarted(planetId, ship, quantity, readyAt);
    }

    function finishShipRepair(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        RepairQueue memory queue = repairQueues[planetId];
        if (!queue.active) revert QueueInactive();
        if (_currentTimestamp() < queue.readyAt) revert QueueNotReady(queue.readyAt);

        delete repairQueues[planetId];
        _repairedShips[planetId][queue.ship] += queue.quantity;
        emit ShipRepairFinished(planetId, queue.ship, queue.quantity);
    }

    function repairableShipCount(uint256 planetId, Ship ship) external view returns (uint32) {
        return _repairableShips[planetId][ship];
    }

    function repairedShipCount(uint256 planetId, Ship ship) external view returns (uint32) {
        return _repairedShips[planetId][ship];
    }

    function spaceDockRepairBps(uint256 planetId) external view returns (uint16) {
        return VeydriftCatalog.spaceDockRepairBps(_spaceDockLevel(planetId));
    }

    function _requirePlanet(uint256 planetId)
        private
        view
        returns (VeydriftGameStorage.Planet memory planetRef)
    {
        planetRef = game.planet(planetId);
        if (planetRef.owner == address(0)) revert NoPlanet();
    }

    function _requirePlanetOwner(uint256 planetId) private view {
        VeydriftGameStorage.Planet memory planetRef = _requirePlanet(planetId);
        if (planetRef.owner != msg.sender) revert NotPlanetOwner();
    }

    function _requireFreshWreckage(uint256 planetId) private view {
        WreckageField memory field = wreckageFields[planetId];
        if (!field.active || field.expiresAt < _currentTimestamp()) {
            revert WreckageExpired(field.expiresAt);
        }
    }

    function _spaceDockLevel(uint256 planetId) private view returns (uint16) {
        return spaceDockLevels[planetId];
    }

    function _repairDuration(uint256 planetId, Ship ship, uint32 quantity)
        private
        view
        returns (uint256)
    {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(ship);
        return VeydriftFormulas.unitDuration(
            _spaceDockLevel(planetId),
            game.buildingLevel(planetId, Building.NaniteFactory),
            metal,
            crystal,
            deuterium,
            quantity,
            MIN_QUEUE_SECONDS
        );
    }

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}
