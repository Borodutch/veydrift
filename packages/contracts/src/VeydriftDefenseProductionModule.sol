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

    function spendMoonResources(uint256 planetId, Resources calldata cost) external {
        if (msg.sender != _moonSystem) revert Unauthorized(msg.sender);
        Resources storage available = _moonResources[planetId];
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
        _emitMoonResourcesChanged(planetId);
    }

    function grantMoonResources(uint256 planetId, Resources calldata amount) external {
        if (msg.sender != _moonSystem) revert Unauthorized(msg.sender);
        _moonResources[planetId] = _add(_moonResources[planetId], amount);
        _increaseInternalResources(amount);
        _emitMoonResourcesChanged(planetId);
    }

    function setMoonShipCount(uint256 planetId, Ship ship, uint32 total) external {
        if (msg.sender != _moonSystem) revert Unauthorized(msg.sender);
        _setMoonShipCount(planetId, ship, total);
    }

    function moveMoonGateShips(
        uint256 originPlanetId,
        uint256 destinationPlanetId,
        address owner_,
        MissionShips calldata ships
    ) external {
        if (msg.sender != _moonSystem) revert Unauthorized(msg.sender);
        if (
            _planets[originPlanetId].owner != owner_
                || _planets[destinationPlanetId].owner != owner_
        ) {
            revert NotPlanetOwner();
        }
        uint256 shipTotal;
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            if (ship != Ship.SolarSatellite) {
                uint32 quantity = _missionShipQuantity(ships, ship);
                if (quantity != 0) {
                    uint32 available = _moonShipCounts[originPlanetId][ship];
                    if (available < quantity) revert InsufficientShips(ship, available, quantity);
                    shipTotal += quantity;
                    _debitMoonShips(originPlanetId, ship, quantity);
                    _creditMoonShips(destinationPlanetId, ship, quantity);
                }
            }
            unchecked {
                ++i;
            }
        }
        if (shipTotal == 0) revert InvalidQuantity();
    }

    function clearMoonState(uint256 planetId) external {
        if (msg.sender != _moonSystem) revert Unauthorized(msg.sender);
        Resources memory resources = _moonResources[planetId];
        if (resources.metal != 0 || resources.crystal != 0 || resources.deuterium != 0) {
            delete _moonResources[planetId];
            _decreaseInternalResources(resources);
            _emitMoonResourcesChanged(planetId);
        }
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            if (_moonShipCounts[planetId][ship] != 0) {
                _setMoonShipCount(planetId, ship, 0);
            }
            unchecked {
                ++i;
            }
        }
    }

    function resolveFleetMission(uint256 missionId) external {
        FleetMission storage mission = _fleetMissions[missionId];
        if (mission.status != FleetMissionStatus.Outbound) return;
        if (_currentTimestamp() < mission.arrivalAt) revert FleetNotArrived(mission.arrivalAt);

        address targetOwner = _planets[mission.targetPlanetId].owner;
        if (!_missionMoonExistsForOwner(missionId, mission.targetPlanetId, targetOwner, false)) {
            // The target moon disappeared in flight. Keep cargo and ships on the mission and send
            // the fleet home instead of writing ghost state that a future moon could inherit.
            mission.status = FleetMissionStatus.Returning;
            emit FleetMissionResolved(missionId, msg.sender, mission.missionType, mission.returnAt);
            emit FleetMissionReturnExposed(
                missionId,
                mission.owner,
                FleetMissionStatus.Returning,
                mission.originPlanetId,
                mission.targetPlanetId,
                mission.returnAt,
                mission.cargo.metal,
                mission.cargo.crystal,
                mission.cargo.deuterium
            );
            return;
        }

        _moonResources[mission.targetPlanetId] =
            _add(_moonResources[mission.targetPlanetId], mission.cargo);
        _emitMoonResourcesChanged(mission.targetPlanetId);
        if (mission.missionType == FleetMissionType.Transport) {
            mission.cargo = Resources({metal: 0, crystal: 0, deuterium: 0});
            mission.status = FleetMissionStatus.Returning;
        } else {
            _creditMoonMissionShips(mission.targetPlanetId, mission.ships);
            mission.status = FleetMissionStatus.Resolved;
            mission.returnAt = _currentTimestamp();
            activeFleetMissionCount[mission.owner] -= 1;
            _untrackMissionResolution(missionId, mission);
        }

        emit FleetMissionResolved(missionId, msg.sender, mission.missionType, mission.returnAt);
        if (mission.status == FleetMissionStatus.Returning) {
            emit FleetMissionReturnExposed(
                missionId,
                mission.owner,
                FleetMissionStatus.Returning,
                mission.originPlanetId,
                mission.targetPlanetId,
                mission.returnAt,
                mission.cargo.metal,
                mission.cargo.crystal,
                mission.cargo.deuterium
            );
        }
    }

    function untrackResolvedFleetMission(uint256 missionId) external {
        if (msg.sender != address(this)) revert Unauthorized(msg.sender);
        _untrackMissionResolution(missionId, _fleetMissions[missionId]);
    }

    function startDefenseProduction(uint256 planetId, Defense defense, uint32 quantity) external {
        _requirePlanetOwner(planetId);
        _settleDueColonizeArrivals(msg.sender);
        _settleDueCombatArrivals(msg.sender);
        if (quantity == 0) revert InvalidQuantity();
        _settleResources(planetId);
        DefenseQueue memory activeQueue = defenseQueues[planetId];

        _requireDefenseDependencies(planetId, defense);
        _requireDefenseCapacity(planetId, defense, quantity);

        Resources memory unitCost = _defenseCost(defense);
        Resources memory totalCost = _multiply(unitCost, quantity);
        _spend(planetId, totalCost);

        uint256 currentTime = _currentTimestamp();
        DefenseQueue[] storage backlog = _defenseQueueBacklogs[planetId];
        if (activeQueue.active) {
            uint256 baseReadyAt =
                backlog.length == 0 ? activeQueue.readyAt : backlog[backlog.length - 1].readyAt;
            if (baseReadyAt < currentTime) baseReadyAt = currentTime;

            uint64 readyAt =
                (baseReadyAt + _defenseDuration(planetId, unitCost, quantity)).toUint64();
            DefenseQueue memory queued = DefenseQueue({
                active: true,
                defense: defense,
                quantity: quantity,
                readyAt: readyAt,
                cost: totalCost
            });
            backlog.push(queued);
            emit DefenseQueued(
                planetId,
                defense,
                quantity,
                readyAt,
                totalCost.metal,
                totalCost.crystal,
                totalCost.deuterium
            );
            _recordDefenseQueueTiming(planetId, queued, baseReadyAt.toUint64(), unitCost);
        } else {
            uint256 baseReadyAt = currentTime;
            uint64 readyAt =
                (baseReadyAt + _defenseDuration(planetId, unitCost, quantity)).toUint64();
            DefenseQueue memory queued = DefenseQueue({
                active: true,
                defense: defense,
                quantity: quantity,
                readyAt: readyAt,
                cost: totalCost
            });
            defenseQueues[planetId] = queued;

            emit DefenseQueued(
                planetId,
                defense,
                quantity,
                readyAt,
                totalCost.metal,
                totalCost.crystal,
                totalCost.deuterium
            );
            _recordDefenseQueueTiming(planetId, queued, baseReadyAt.toUint64(), unitCost);
        }
    }

    function finishDefenseProduction(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlanet(planetId);
        DefenseQueue memory queue = defenseQueues[planetId];
        if (!queue.active) revert QueueInactive();
        uint64 nowAt = _currentTimestamp();
        if (_settleDefenseProductionUntil(planetId, nowAt) == 0) {
            ProductionQueueTiming memory timing = _defenseQueueTimings[planetId][queue.readyAt];
            uint32 settledQuantity = timing.startedAt == 0
                || timing.originalQuantity < queue.quantity
                ? 0
                : timing.originalQuantity - queue.quantity;
            revert QueueNotReady(_nextProductionUnitAt(queue.readyAt, timing, settledQuantity));
        }
    }

    function completeAttackTargetSnapshotQueues(uint256 planetId, uint64 cutoffAt) external {
        _settleDefenseProductionUntil(planetId, cutoffAt);
    }

    function _completeReadyDefenseProduction(uint256 planetId, DefenseQueue memory queue) private {
        uint32 total = _defenseCounts[planetId][queue.defense] + queue.quantity;
        _defenseCounts[planetId][queue.defense] = total;
        emit DefenseCompleted(planetId, queue.defense, queue.quantity, total);
        delete _defenseQueueTimings[planetId][queue.readyAt];

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
        _emitDefenseQueueTiming(planetId, promoted);
    }

    function _settleDefenseProductionUntil(uint256 planetId, uint64 cutoffAt)
        private
        returns (uint32 settledUnits)
    {
        while (defenseQueues[planetId].active) {
            DefenseQueue memory queue = defenseQueues[planetId];
            ProductionQueueTiming memory timing = _defenseQueueTimings[planetId][queue.readyAt];
            uint32 newlyCompleted;

            if (timing.startedAt == 0) {
                if (cutoffAt < queue.readyAt) break;
                newlyCompleted = queue.quantity;
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
            if (newlyCompleted == queue.quantity) {
                _completeReadyDefenseProduction(planetId, queue);
                continue;
            }

            DefenseQueue storage active = defenseQueues[planetId];
            Resources memory completedCost =
                _productionCostPortion(active.cost, active.quantity, newlyCompleted);
            active.quantity -= newlyCompleted;
            active.cost.metal -= completedCost.metal;
            active.cost.crystal -= completedCost.crystal;
            active.cost.deuterium -= completedCost.deuterium;

            uint32 total = _defenseCounts[planetId][queue.defense] + newlyCompleted;
            _defenseCounts[planetId][queue.defense] = total;
            emit DefenseCompleted(planetId, queue.defense, newlyCompleted, total);
            break;
        }
    }

    function _productionCostPortion(
        Resources memory remainingCost,
        uint32 remainingQuantity,
        uint32 quantity
    ) private pure returns (Resources memory) {
        return Resources({
            metal: uint128((uint256(remainingCost.metal) * quantity) / remainingQuantity),
            crystal: uint128((uint256(remainingCost.crystal) * quantity) / remainingQuantity),
            deuterium: uint128((uint256(remainingCost.deuterium) * quantity) / remainingQuantity)
        });
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

    function _creditMoonMissionShips(uint256 planetId, MissionShips memory ships) private {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            _creditMoonShips(planetId, ship, _missionShipQuantityMem(ships, ship));
            unchecked {
                ++i;
            }
        }
    }

    function _missionShipQuantity(MissionShips calldata ships, Ship ship)
        private
        pure
        returns (uint32)
    {
        if (ship == Ship.SmallCargo) return ships.smallCargo;
        if (ship == Ship.LightFighter) return ships.lightFighter;
        if (ship == Ship.Recycler) return ships.recycler;
        if (ship == Ship.ColonyShip) return ships.colonyShip;
        if (ship == Ship.LargeCargo) return ships.largeCargo;
        if (ship == Ship.HeavyFighter) return ships.heavyFighter;
        if (ship == Ship.Cruiser) return ships.cruiser;
        if (ship == Ship.Battleship) return ships.battleship;
        if (ship == Ship.Bomber) return ships.bomber;
        if (ship == Ship.Destroyer) return ships.destroyer;
        if (ship == Ship.Deathstar) return ships.deathstar;
        if (ship == Ship.Battlecruiser) return ships.battlecruiser;
        if (ship == Ship.Reaper) return ships.reaper;
        if (ship == Ship.Pathfinder) return ships.pathfinder;
        return 0;
    }

    function _missionShipQuantityMem(MissionShips memory ships, Ship ship)
        private
        pure
        returns (uint32)
    {
        if (ship == Ship.SmallCargo) return ships.smallCargo;
        if (ship == Ship.LightFighter) return ships.lightFighter;
        if (ship == Ship.Recycler) return ships.recycler;
        if (ship == Ship.ColonyShip) return ships.colonyShip;
        if (ship == Ship.LargeCargo) return ships.largeCargo;
        if (ship == Ship.HeavyFighter) return ships.heavyFighter;
        if (ship == Ship.Cruiser) return ships.cruiser;
        if (ship == Ship.Battleship) return ships.battleship;
        if (ship == Ship.Bomber) return ships.bomber;
        if (ship == Ship.Destroyer) return ships.destroyer;
        if (ship == Ship.Deathstar) return ships.deathstar;
        if (ship == Ship.Battlecruiser) return ships.battlecruiser;
        if (ship == Ship.Reaper) return ships.reaper;
        if (ship == Ship.Pathfinder) return ships.pathfinder;
        return 0;
    }
}
