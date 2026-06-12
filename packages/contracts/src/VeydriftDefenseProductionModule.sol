// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftDependencies} from "./libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {Building, Defense, Resource, Ship, Technology} from "./libraries/VeydriftTypes.sol";

/// @notice Delegatecall target for defense production and backlog management.
contract VeydriftDefenseProductionModule is VeydriftResourceReserves {
    using SafeCast for uint256;

    constructor() VeydriftResourceReserves(address(0)) {}

    function startDefenseProduction(uint256 planetId, Defense defense, uint32 quantity) external {
        _requirePlanetOwner(planetId);
        _settleDueColonizeArrivals(msg.sender);
        _settleDueCombatArrivals(msg.sender);
        if (quantity == 0) revert InvalidQuantity();
        DefenseQueue memory activeQueue = defenseQueues[planetId];

        _requireDefenseDependencies(planetId, defense);
        _requireDefenseCapacity(planetId, defense, quantity);
        _settleResources(planetId);

        Resources memory unitCost = _defenseCost(defense);
        Resources memory totalCost = _multiply(unitCost, quantity);
        _spend(planetId, totalCost);

        uint256 currentTime = _currentTimestamp();
        if (activeQueue.active && activeQueue.defense != defense) {
            DefenseQueue[] storage backlog = _defenseQueueBacklogs[planetId];
            uint256 baseReadyAt =
                backlog.length == 0 ? activeQueue.readyAt : backlog[backlog.length - 1].readyAt;
            if (baseReadyAt < currentTime) baseReadyAt = currentTime;

            uint64 readyAt =
                (baseReadyAt + _defenseDuration(planetId, unitCost, quantity)).toUint64();
            backlog.push(
                DefenseQueue({
                    active: true,
                    defense: defense,
                    quantity: quantity,
                    readyAt: readyAt,
                    cost: totalCost
                })
            );
            emit DefenseQueued(
                planetId,
                defense,
                quantity,
                readyAt,
                totalCost.metal,
                totalCost.crystal,
                totalCost.deuterium
            );
        } else {
            uint256 baseReadyAt = activeQueue.active && activeQueue.readyAt > currentTime
                ? activeQueue.readyAt
                : currentTime;
            uint64 readyAt =
                (baseReadyAt + _defenseDuration(planetId, unitCost, quantity)).toUint64();
            uint32 queuedQuantity = activeQueue.active ? activeQueue.quantity + quantity : quantity;
            Resources memory queuedCost =
                activeQueue.active ? _add(activeQueue.cost, totalCost) : totalCost;
            defenseQueues[planetId] = DefenseQueue({
                active: true,
                defense: defense,
                quantity: queuedQuantity,
                readyAt: readyAt,
                cost: queuedCost
            });

            emit DefenseQueued(
                planetId,
                defense,
                queuedQuantity,
                readyAt,
                queuedCost.metal,
                queuedCost.crystal,
                queuedCost.deuterium
            );
        }
    }

    function finishDefenseProduction(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlanet(planetId);
        DefenseQueue memory queue = defenseQueues[planetId];
        if (!queue.active) revert QueueInactive();
        if (_currentTimestamp() < queue.readyAt) revert QueueNotReady(queue.readyAt);

        _completeReadyDefenseProduction(planetId, queue);
    }

    function completeAttackTargetSnapshotQueues(uint256 planetId, uint64 cutoffAt) external {
        while (defenseQueues[planetId].active && defenseQueues[planetId].readyAt <= cutoffAt) {
            _completeReadyDefenseProduction(planetId, defenseQueues[planetId]);
        }
    }

    function _completeReadyDefenseProduction(uint256 planetId, DefenseQueue memory queue) private {
        uint32 total = _defenseCounts[planetId][queue.defense] + queue.quantity;
        _defenseCounts[planetId][queue.defense] = total;
        emit DefenseCompleted(planetId, queue.defense, queue.quantity, total);

        DefenseQueue[] storage backlog = _defenseQueueBacklogs[planetId];
        if (backlog.length == 0) {
            delete defenseQueues[planetId];
            return;
        }

        DefenseQueue memory promoted = backlog[0];
        defenseQueues[planetId] = promoted;
        for (uint256 i = 1; i < backlog.length;) {
            backlog[i - 1] = backlog[i];
            unchecked {
                ++i;
            }
        }
        backlog.pop();
        emit DefenseQueued(
            planetId,
            promoted.defense,
            promoted.quantity,
            promoted.readyAt,
            promoted.cost.metal,
            promoted.cost.crystal,
            promoted.cost.deuterium
        );
    }

    function _defenseCost(Defense defense) private pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.defenseCost(defense);
        return Resources(metal, crystal, deuterium);
    }

    function _defenseDuration(uint256 planetId, Resources memory unitCost, uint32 quantity)
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

    function _requireDefenseDependencies(uint256 planetId, Defense defense) private view {
        address player = _planets[planetId].owner;
        VeydriftDependencies.requireDefense(
            defense,
            _buildingLevels[planetId][Building.Shipyard],
            _buildingLevels[planetId][Building.MissileSilo],
            _technologyLevels[player][Technology.Energy],
            _technologyLevels[player][Technology.Laser],
            _technologyLevels[player][Technology.Ion],
            _technologyLevels[player][Technology.Weapons],
            _technologyLevels[player][Technology.Shielding],
            _technologyLevels[player][Technology.ImpulseDrive],
            _technologyLevels[player][Technology.Plasma]
        );
    }

    function _requireDefenseCapacity(uint256 planetId, Defense defense, uint32 quantity)
        private
        view
    {
        uint32 queuedQuantity = _queuedDefenseQuantity(planetId, defense);
        if (VeydriftCatalog.isShieldDome(defense)) {
            if (_defenseCounts[planetId][defense] + queuedQuantity + quantity > 1) {
                revert DefenseLimitReached(defense);
            }
        }

        uint8 slotsPerUnit = VeydriftCatalog.missileSlots(defense);
        if (slotsPerUnit == 0) return;

        uint32 usedSlots = _missileSiloSlotsUsed(planetId) + _queuedMissileSiloSlots(planetId);
        uint32 requestedSlots = uint32(slotsPerUnit) * quantity;
        uint32 capacity =
            VeydriftCatalog.missileSiloCapacity(_buildingLevels[planetId][Building.MissileSilo]);
        if (usedSlots + requestedSlots > capacity) {
            revert MissileSiloCapacityExceeded(usedSlots + requestedSlots, capacity);
        }
    }

    function _missileSiloSlotsUsed(uint256 planetId) private view returns (uint32) {
        return _defenseCounts[planetId][Defense.AntiBallisticMissile]
            + (_defenseCounts[planetId][Defense.InterplanetaryMissile] * 2);
    }

    function _queuedMissileSiloSlots(uint256 planetId) private view returns (uint32) {
        DefenseQueue memory queue = defenseQueues[planetId];
        uint32 usedSlots;
        if (queue.active) {
            usedSlots += uint32(VeydriftCatalog.missileSlots(queue.defense)) * queue.quantity;
        }

        DefenseQueue[] storage backlog = _defenseQueueBacklogs[planetId];
        for (uint256 i = 0; i < backlog.length;) {
            usedSlots += uint32(VeydriftCatalog.missileSlots(backlog[i].defense))
            * backlog[i].quantity;
            unchecked {
                ++i;
            }
        }
        return usedSlots;
    }

    function _queuedDefenseQuantity(uint256 planetId, Defense defense)
        private
        view
        returns (uint32)
    {
        uint32 quantity;
        DefenseQueue memory activeQueue = defenseQueues[planetId];
        if (activeQueue.active && activeQueue.defense == defense) {
            quantity += activeQueue.quantity;
        }

        DefenseQueue[] storage backlog = _defenseQueueBacklogs[planetId];
        for (uint256 i = 0; i < backlog.length;) {
            if (backlog[i].defense == defense) {
                quantity += backlog[i].quantity;
            }
            unchecked {
                ++i;
            }
        }
        return quantity;
    }

    function _requirePlanetOwner(uint256 planetId) private view {
        Planet storage planetRef = _planets[planetId];
        if (planetRef.owner == address(0)) revert NoPlanet();
        if (planetRef.owner != msg.sender) revert NotPlanetOwner();
    }

    function _multiply(Resources memory resources, uint32 quantity)
        private
        pure
        returns (Resources memory)
    {
        return Resources({
            metal: _toUint128(uint256(resources.metal) * quantity),
            crystal: _toUint128(uint256(resources.crystal) * quantity),
            deuterium: _toUint128(uint256(resources.deuterium) * quantity)
        });
    }

    function _settleResources(uint256 planetId) private {
        uint64 currentTime = _currentTimestamp();
        Planet storage planetRef = _planets[planetId];
        if (currentTime > planetRef.lastSettledAt) {
            uint256 elapsed = uint256(currentTime) - planetRef.lastSettledAt;
            (uint256 metalPerHour, uint256 crystalPerHour, uint256 deutPerHour) =
                _productionPerHour(planetId);
            Resources memory produced = Resources({
                metal: _toUint128((metalPerHour * elapsed) / 1 hours),
                crystal: _toUint128((crystalPerHour * elapsed) / 1 hours),
                deuterium: _toUint128((deutPerHour * elapsed) / 1 hours)
            });
            (, Resources memory added) =
                _cappedResourceIncrease(planetId, planetRef.resources, produced);
            added = _reserveLimitedIncrease(added);
            _increaseInternalResources(added);
            planetRef.resources = _add(planetRef.resources, added);
            planetRef.lastSettledAt = currentTime;
        }
        _settleDuePlanet(planetId);
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

    function _productionPerHour(uint256 planetId)
        private
        view
        returns (uint256 metalPerHour, uint256 crystalPerHour, uint256 deuteriumPerHour)
    {
        Planet storage planetRef = _planets[planetId];
        return VeydriftFormulas.productionPerHour(
            _buildingLevels[planetId][Building.MetalMine],
            _buildingLevels[planetId][Building.CrystalMine],
            _buildingLevels[planetId][Building.DeuteriumSynthesizer],
            _buildingLevels[planetId][Building.SolarPlant],
            _buildingLevels[planetId][Building.FusionReactor],
            _shipCounts[planetId][Ship.SolarSatellite],
            _shipCounts[planetId][Ship.Crawler],
            planetRef.temperature,
            _technologyLevels[planetRef.owner][Technology.Energy],
            planetRef.metalMultiplierBps,
            planetRef.crystalMultiplierBps,
            planetRef.deuteriumMultiplierBps
        );
    }

    function _cappedResourceIncrease(
        uint256 planetId,
        Resources memory currentResources,
        Resources memory produced
    ) private view returns (Resources memory capped, Resources memory added) {
        (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap) = _storageCaps(planetId);
        capped = Resources({
            metal: _addWithCap(currentResources.metal, produced.metal, metalCap),
            crystal: _addWithCap(currentResources.crystal, produced.crystal, crystalCap),
            deuterium: _addWithCap(currentResources.deuterium, produced.deuterium, deuteriumCap)
        });
        added = Resources({
            metal: capped.metal - currentResources.metal,
            crystal: capped.crystal - currentResources.crystal,
            deuterium: capped.deuterium - currentResources.deuterium
        });
    }

    function _storageCaps(uint256 planetId)
        private
        view
        returns (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap)
    {
        if (_planets[planetId].owner == address(0)) revert NoPlanet();
        return VeydriftFormulas.storageCaps(
            _buildingLevels[planetId][Building.MetalStorage],
            _buildingLevels[planetId][Building.CrystalStorage],
            _buildingLevels[planetId][Building.DeuteriumTank]
        );
    }

    function _addWithCap(uint128 current, uint128 addition, uint128 cap)
        private
        pure
        returns (uint128)
    {
        uint256 total = uint256(current) + addition;
        uint256 effectiveCap = current > cap ? current : cap;
        return _toUint128(total > effectiveCap ? effectiveCap : total);
    }

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}
