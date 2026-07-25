// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftDependencies} from "./libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {Building, Ship, Technology} from "./libraries/VeydriftTypes.sol";

/// @notice Delegatecall target for ship production, FIFO backlog, and per-unit lazy settlement.
contract VeydriftShipProductionModule is VeydriftResourceReserves {
    using SafeCast for uint256;

    constructor() VeydriftResourceReserves(address(0)) {}

    function startShipProduction(uint256 planetId, Ship ship, uint32 quantity) external {
        _requirePlanetOwner(planetId);
        _settleDueColonizeArrivals(msg.sender);
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlanet(planetId);
        _settleResources(planetId);
        _validateShipProduction(planetId, ship, quantity);

        Resources memory unitCost = _shipCost(ship);
        Resources memory totalCost = _multiply(unitCost, quantity);
        _spend(planetId, totalCost);

        ShipQueue memory activeQueue = shipQueues[planetId];
        uint256 baseReadyAt = _currentTimestamp();
        if (activeQueue.active) {
            ShipQueue[] storage backlog = _shipQueueBacklogs[planetId];
            baseReadyAt =
                backlog.length == 0 ? activeQueue.readyAt : backlog[backlog.length - 1].readyAt;
            if (baseReadyAt < _currentTimestamp()) baseReadyAt = _currentTimestamp();
        }

        uint64 readyAt = (baseReadyAt + _shipDuration(planetId, unitCost, quantity)).toUint64();
        ShipQueue memory queued = ShipQueue({
            active: true, ship: ship, quantity: quantity, readyAt: readyAt, cost: totalCost
        });
        if (activeQueue.active) {
            _shipQueueBacklogs[planetId].push(queued);
        } else {
            shipQueues[planetId] = queued;
        }
        _emitShipQueued(planetId, queued);
        _recordShipQueueTiming(planetId, queued, baseReadyAt.toUint64(), unitCost);
    }

    function finishShipProduction(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        _requireNoPendingMissionResolutionForPlanet(planetId);
        ShipQueue memory queue = shipQueues[planetId];
        if (!queue.active) revert QueueInactive();
        if (_settleShipProductionUntil(planetId, _currentTimestamp()) == 0) {
            ProductionQueueTiming memory timing = _shipQueueTimings[planetId][queue.readyAt];
            uint32 settledQuantity = timing.startedAt == 0
                || timing.originalQuantity < queue.quantity
                ? 0
                : timing.originalQuantity - queue.quantity;
            revert QueueNotReady(_nextProductionUnitAt(queue.readyAt, timing, settledQuantity));
        }
    }

    function completeAttackTargetSnapshotQueues(uint256 planetId, uint64 cutoffAt) external {
        _settleShipProductionUntil(planetId, cutoffAt);
    }

    function _settleShipProductionUntil(uint256 planetId, uint64 cutoffAt)
        private
        returns (uint32 settledUnits)
    {
        while (shipQueues[planetId].active) {
            ShipQueue memory queue = shipQueues[planetId];
            ProductionQueueTiming memory timing = _shipQueueTimings[planetId][queue.readyAt];
            uint32 newlyCompleted = queue.quantity;
            if (timing.startedAt == 0) {
                if (cutoffAt < queue.readyAt) break;
            } else {
                uint32 previouslyCompleted = timing.originalQuantity >= queue.quantity
                    ? timing.originalQuantity - queue.quantity
                    : 0;
                uint32 completedAsOf = _completedProductionQuantity(queue.readyAt, timing, cutoffAt);
                if (completedAsOf <= previouslyCompleted) break;
                newlyCompleted = completedAsOf - previouslyCompleted;
                if (newlyCompleted > queue.quantity) newlyCompleted = queue.quantity;
            }

            settledUnits += newlyCompleted;
            _creditCompletedShips(planetId, queue.ship, newlyCompleted);
            if (newlyCompleted == queue.quantity) {
                delete _shipQueueTimings[planetId][queue.readyAt];
                _promoteShipQueue(planetId);
                continue;
            }

            ShipQueue storage active = shipQueues[planetId];
            active.cost
            .metal -= uint128((uint256(active.cost.metal) * newlyCompleted) / active.quantity);
            active.cost
            .crystal -= uint128((uint256(active.cost.crystal) * newlyCompleted) / active.quantity);
            active.cost
            .deuterium -= uint128(
                (uint256(active.cost.deuterium) * newlyCompleted) / active.quantity
            );
            active.quantity -= newlyCompleted;
            break;
        }
    }

    function _creditCompletedShips(uint256 planetId, Ship ship, uint32 quantity) private {
        uint32 total = _shipCounts[planetId][ship] + quantity;
        _shipCounts[planetId][ship] = total;
        emit ShipCompleted(planetId, ship, quantity, total);
    }

    function _promoteShipQueue(uint256 planetId) private {
        ShipQueue[] storage backlog = _shipQueueBacklogs[planetId];
        if (backlog.length == 0) {
            delete shipQueues[planetId];
            return;
        }

        ShipQueue memory promoted = backlog[0];
        shipQueues[planetId] = promoted;
        for (uint256 i = 1; i < backlog.length;) {
            backlog[i - 1] = backlog[i];
            unchecked {
                ++i;
            }
        }
        backlog.pop();
        _emitShipQueued(planetId, promoted);
        _emitShipQueueTiming(planetId, promoted);
    }

    function _emitShipQueued(uint256 planetId, ShipQueue memory queue) private {
        emit ShipQueued(
            planetId,
            queue.ship,
            queue.quantity,
            queue.readyAt,
            queue.cost.metal,
            queue.cost.crystal,
            queue.cost.deuterium
        );
    }

    function _requirePlanetOwner(uint256 planetId) private view {
        Planet storage planetRef = _planets[planetId];
        if (planetRef.owner == address(0)) revert NoPlanet();
        if (planetRef.owner != msg.sender) revert NotPlanetOwner();
    }

    function _validateShipProduction(uint256 planetId, Ship ship, uint32 quantity) private view {
        if (quantity == 0) revert InvalidQuantity();
        address player = _planets[planetId].owner;
        VeydriftDependencies.requireShip(
            ship,
            _buildingLevels[planetId][Building.Shipyard],
            _technologyLevels[player][Technology.CombustionDrive],
            _technologyLevels[player][Technology.ImpulseDrive],
            _technologyLevels[player][Technology.HyperspaceDrive],
            _technologyLevels[player][Technology.Hyperspace],
            _technologyLevels[player][Technology.Graviton],
            _technologyLevels[player][Technology.Energy],
            _technologyLevels[player][Technology.Laser],
            _technologyLevels[player][Technology.Ion],
            _technologyLevels[player][Technology.Shielding],
            _technologyLevels[player][Technology.Armor],
            _technologyLevels[player][Technology.Plasma]
        );
    }

    function _shipDuration(uint256 planetId, Resources memory unitCost, uint32 quantity)
        private
        view
        returns (uint256)
    {
        return VeydriftFormulas.unitDuration(
            _buildingLevels[planetId][Building.Shipyard],
            _buildingLevels[planetId][Building.NaniteFactory],
            unitCost.metal,
            unitCost.crystal,
            unitCost.deuterium,
            quantity,
            QUEUE_UNIVERSE_SPEED,
            MIN_QUEUE_SECONDS
        );
    }

    function _shipCost(Ship ship) private pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(ship);
        return Resources(metal, crystal, deuterium);
    }

    function _multiply(Resources memory resources, uint32 quantity)
        private
        pure
        returns (Resources memory)
    {
        return Resources({
            metal: (uint256(resources.metal) * quantity).toUint128(),
            crystal: (uint256(resources.crystal) * quantity).toUint128(),
            deuterium: (uint256(resources.deuterium) * quantity).toUint128()
        });
    }

    function _settleResources(uint256 planetId) private {
        _settleActionPlanet(planetId);
    }

    function _spend(uint256 planetId, Resources memory cost) private {
        _settleResources(planetId);
        Resources storage available = _planets[planetId].resources;
        if (
            available.metal < cost.metal || available.crystal < cost.crystal
                || available.deuterium < cost.deuterium
        ) {
            revert InsufficientResources(available.metal, available.crystal, available.deuterium);
        }
        available.metal -= cost.metal;
        available.crystal -= cost.crystal;
        available.deuterium -= cost.deuterium;
        _decreaseInternalResources(cost);
        _emitPlanetSettled(planetId);
    }

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}
