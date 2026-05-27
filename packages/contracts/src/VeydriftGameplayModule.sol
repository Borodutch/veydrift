// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage} from "./VeydriftGameStorage.sol";
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftDependencies} from "./libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {IVeydriftAttackRandomnessEngine} from "./interfaces/IVeydriftAttackRandomnessEngine.sol";
import {Building, Defense, Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IVeydriftCounterplayAllianceSystem {
    function counterplayDefenseFuelContext(
        address viewer,
        uint256 defenderPlanetId,
        uint256 hostileMissionId,
        VeydriftGameStorage.MissionShips calldata ships,
        uint256 holdSeconds
    ) external view returns (bool canCoordinate, uint128 netHoldingFuelCost, uint128 depotSupport);
}

/// @notice Delegatecall target for stateful gameplay paths that would push VeydriftGame over EIP-170.
contract VeydriftGameplayModule is VeydriftResourceReserves {
    address private immutable _combatModule;

    constructor(address combatModule) VeydriftResourceReserves(address(0)) {
        _combatModule = combatModule;
    }

    function attackProtectionStatus(address attacker, uint256 targetPlanetId)
        external
        view
        returns (AttackBlockReason)
    {
        address defender = _attackDefender(targetPlanetId);
        return _attackBlockReason(
            attacker,
            defender,
            _currentAttackCount(_attackWindowKey(attacker, defender, targetPlanetId))
        );
    }

    function startShipProduction(uint256 planetId, Ship ship, uint32 quantity) external {
        _requirePlanetOwner(planetId);
        _requireNoPendingMissionResolutionForPlanet(planetId);
        _validateShipProduction(planetId, ship, quantity);
        _settleResources(planetId);

        Resources memory unitCost = _shipCost(ship);
        Resources memory totalCost = _multiply(unitCost, quantity);
        _spend(planetId, totalCost);

        uint64 readyAt;
        unchecked {
            readyAt = uint64(_currentTimestamp() + _shipDuration(planetId, unitCost, quantity));
        }
        shipQueues[planetId] = ShipQueue({
            active: true, ship: ship, quantity: quantity, readyAt: readyAt, cost: totalCost
        });
        emit ShipQueued(
            planetId,
            ship,
            quantity,
            readyAt,
            totalCost.metal,
            totalCost.crystal,
            totalCost.deuterium
        );
    }

    function finishShipProduction(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        _requireNoPendingMissionResolutionForPlanet(planetId);
        ShipQueue memory queue = shipQueues[planetId];
        if (!queue.active) revert QueueInactive();
        if (_currentTimestamp() < queue.readyAt) revert QueueNotReady(queue.readyAt);

        delete shipQueues[planetId];
        uint32 total = _shipCounts[planetId][queue.ship] + queue.quantity;
        _shipCounts[planetId][queue.ship] = total;
        emit ShipCompleted(planetId, queue.ship, queue.quantity, total);
    }

    function finishDefenseProduction(uint256 planetId) external {
        _requirePlanetOwner(planetId);
        _requireNoPendingMissionResolutionForPlanet(planetId);
        DefenseQueue memory queue = defenseQueues[planetId];
        if (!queue.active) revert QueueInactive();
        if (_currentTimestamp() < queue.readyAt) revert QueueNotReady(queue.readyAt);

        delete defenseQueues[planetId];
        uint32 total = _defenseCounts[planetId][queue.defense] + queue.quantity;
        _defenseCounts[planetId][queue.defense] = total;
        emit DefenseCompleted(planetId, queue.defense, queue.quantity, total);
    }

    function setSpaceDockSystem(address nextSpaceDockSystem) external onlyOwner {
        _spaceDockSystem = nextSpaceDockSystem;
    }

    function launchFleetMission(
        uint256 originPlanetId,
        uint256 targetPlanetId,
        FleetMissionType missionType,
        MissionShips calldata ships,
        Resources calldata cargo,
        uint256 randomnessRequestId
    ) external returns (uint256 missionId) {
        return _launchFleetMission(
            originPlanetId,
            targetPlanetId,
            missionType,
            ships,
            cargo,
            VeydriftAntiRaidPrimitives.FULL_MISSION_SPEED_PERCENT,
            randomnessRequestId
        );
    }

    function launchFleetMission(
        uint256 originPlanetId,
        uint256 targetPlanetId,
        FleetMissionType missionType,
        MissionShips calldata ships,
        Resources calldata cargo,
        uint16 speedPercent,
        uint256 randomnessRequestId
    ) external returns (uint256 missionId) {
        return _launchFleetMission(
            originPlanetId,
            targetPlanetId,
            missionType,
            ships,
            cargo,
            speedPercent,
            randomnessRequestId
        );
    }

    function joinAttackMission(
        uint256 originPlanetId,
        uint256 attackMissionId,
        uint256 expectedTargetPlanetId,
        MissionShips calldata ships,
        Resources calldata cargo
    ) external returns (uint256 missionId) {
        return _joinAttackMission(
            originPlanetId, attackMissionId, expectedTargetPlanetId, ships, cargo
        );
    }

    function _launchFleetMission(
        uint256 originPlanetId,
        uint256 targetPlanetId,
        FleetMissionType missionType,
        MissionShips calldata ships,
        Resources calldata cargo,
        uint16 speedPercent,
        uint256 randomnessRequestId
    ) private returns (uint256 missionId) {
        if (!VeydriftAntiRaidPrimitives.isValidMissionSpeed(speedPercent)) {
            revert InvalidQuantity();
        }
        _requirePlanetOwner(originPlanetId);
        uint256 hostileMissionId;
        bool counterplayMission =
            missionType == FleetMissionType.AcsDefend || missionType == FleetMissionType.Intercept;
        if (counterplayMission) {
            hostileMissionId = targetPlanetId;
            FleetMission storage hostile = _fleetMissions[hostileMissionId];
            if (
                hostile.status != FleetMissionStatus.Outbound
                    || hostile.missionType != FleetMissionType.Attack
            ) {
                revert InvalidMissionType(missionType);
            }
            targetPlanetId = hostile.targetPlanetId;
        }
        if (!counterplayMission && originPlanetId == targetPlanetId) revert SamePlanet();
        if (_planets[targetPlanetId].owner == address(0)) revert NoPlanet();
        _requireNoPendingMissionResolutionForPlanet(originPlanetId);
        _requireNoPendingMissionResolutionForPlanet(targetPlanetId);
        if (
            missionType == FleetMissionType.MissileAttack
                || missionType == FleetMissionType.AcsAttack
        ) {
            revert InvalidMissionType(missionType);
        }
        if (missionType == FleetMissionType.Attack) {
            _enforceAttackProtection(msg.sender, targetPlanetId);
        }
        uint256 fleetSlots = VeydriftAntiRaidPrimitives.fleetSlotLimit(
            _technologyLevels[msg.sender][Technology.Computer]
        );
        if (activeFleetMissionCount[msg.sender] >= fleetSlots) {
            revert FleetSlotLimitReached(fleetSlots);
        }

        (uint256 capacity, uint256 fleetFuelConsumption, uint256 slowestSpeed) =
            _missionMovement(msg.sender, ships);
        if (capacity == 0) revert InvalidQuantity();
        if (missionType == FleetMissionType.Harvest) {
            if (ships.recycler == 0) revert InvalidQuantity();
            DebrisField storage field = _debrisFields[targetPlanetId];
            if (field.metal == 0 && field.crystal == 0) revert DebrisFieldEmpty();
        }
        _requireMissionShips(originPlanetId, ships);

        if (
            missionType == FleetMissionType.Transport || missionType == FleetMissionType.Deploy
                || missionType == FleetMissionType.Colonize
        ) {
            _requirePlanetOwner(targetPlanetId);
        }

        _settleResources(originPlanetId);
        uint256 travelDistance = _planetDistance(originPlanetId, targetPlanetId);
        uint128 fuelCost = _toUint128(
            VeydriftAntiRaidPrimitives.missionFuelCost(
                fleetFuelConsumption, travelDistance, speedPercent
            )
        );
        uint64 departureAt = _currentTimestamp();
        uint256 travelSeconds = VeydriftAntiRaidPrimitives.travelSeconds(
            travelDistance, slowestSpeed, speedPercent, FLEET_UNIVERSE_SPEED
        );
        uint64 arrivalAt;
        unchecked {
            arrivalAt = uint64(uint256(departureAt) + travelSeconds);
        }
        if (counterplayMission) {
            FleetMission storage hostile = _fleetMissions[hostileMissionId];
            if (arrivalAt > hostile.arrivalAt) {
                revert FleetAlreadyArrived();
            }
            (bool canCoordinate, uint128 netHoldingFuelCost, uint128 depotSupport) = IVeydriftCounterplayAllianceSystem(
                    _allianceSystem
                )
                .counterplayDefenseFuelContext(
                    msg.sender,
                    targetPlanetId,
                    hostileMissionId,
                    ships,
                    hostile.arrivalAt - arrivalAt
                );
            if (!canCoordinate) {
                revert InvalidQuantity();
            }
            if (depotSupport != 0) {
                _settleResources(targetPlanetId);
                _spend(targetPlanetId, Resources({metal: 0, crystal: 0, deuterium: depotSupport}));
            }
            fuelCost = _toUint128(uint256(fuelCost) + netHoldingFuelCost);
            arrivalAt = hostile.arrivalAt;
            randomnessRequestId = hostileMissionId;
        }
        uint256 cargoTotal =
            uint256(cargo.metal) + uint256(cargo.crystal) + uint256(cargo.deuterium);
        uint256 committedCapacity = cargoTotal + fuelCost;
        if (committedCapacity > capacity) {
            revert CargoCapacityExceeded(capacity, committedCapacity);
        }
        _spend(
            originPlanetId,
            Resources({
                metal: cargo.metal,
                crystal: cargo.crystal,
                deuterium: _toUint128(uint256(cargo.deuterium) + fuelCost)
            })
        );
        _increaseInternalResources(cargo);
        _debitMissionShips(originPlanetId, ships);

        uint64 returnAt;
        unchecked {
            returnAt = uint64(uint256(arrivalAt) + travelSeconds);
        }
        missionId = nextFleetId++;
        if (missionType == FleetMissionType.Attack) {
            randomnessRequestId = _requestAttackBattleRandomness(missionId);
        }
        activeFleetMissionCount[msg.sender] += 1;
        _fleetMissions[missionId] = FleetMission({
            status: FleetMissionStatus.Outbound,
            missionType: missionType,
            owner: msg.sender,
            originPlanetId: originPlanetId,
            targetPlanetId: targetPlanetId,
            departureAt: departureAt,
            arrivalAt: arrivalAt,
            returnAt: returnAt,
            fuelCost: fuelCost,
            cargo: cargo,
            ships: ships,
            randomnessRequestId: randomnessRequestId
        });
        if (missionType == FleetMissionType.Attack) {
            _recordAttack(msg.sender, targetPlanetId);
        } else if (counterplayMission) {
            _fleetCounterplayMissions[hostileMissionId].push(missionId);
        }

        emit FleetMissionLaunched(
            missionId,
            msg.sender,
            missionType,
            originPlanetId,
            targetPlanetId,
            arrivalAt,
            returnAt,
            randomnessRequestId
        );
        emit FleetMissionCargo(missionId, cargo.metal, cargo.crystal, cargo.deuterium, fuelCost);
        _emitFleetMissionShips(missionId, ships);
    }

    function _joinAttackMission(
        uint256 originPlanetId,
        uint256 attackMissionId,
        uint256 expectedTargetPlanetId,
        MissionShips calldata ships,
        Resources calldata cargo
    ) private returns (uint256 missionId) {
        _requirePlanetOwner(originPlanetId);
        FleetMission storage attack = _fleetMissions[attackMissionId];
        if (
            attack.status != FleetMissionStatus.Outbound
                || attack.missionType != FleetMissionType.Attack
        ) {
            revert InvalidMissionType(FleetMissionType.AcsAttack);
        }
        if (attack.targetPlanetId != expectedTargetPlanetId) revert InvalidId();
        _requireNoPendingMissionResolutionForPlanet(originPlanetId);
        _requireNoPendingMissionResolutionForPlanet(attack.targetPlanetId);

        uint64 cutoffAt =
            attack.arrivalAt - VeydriftAntiRaidPrimitives.ACS_DEFEND_JOIN_CUTOFF_SECONDS;
        if (_currentTimestamp() >= cutoffAt) revert AttackJoinCutoffPassed(cutoffAt);
        _enforceAttackProtection(msg.sender, attack.targetPlanetId);

        uint256 fleetSlots = VeydriftAntiRaidPrimitives.fleetSlotLimit(
            _technologyLevels[msg.sender][Technology.Computer]
        );
        if (activeFleetMissionCount[msg.sender] >= fleetSlots) {
            revert FleetSlotLimitReached(fleetSlots);
        }

        (uint256 capacity, uint256 fleetFuelConsumption, uint256 slowestSpeed) =
            _missionMovement(msg.sender, ships);
        if (capacity == 0) revert InvalidQuantity();
        _requireMissionShips(originPlanetId, ships);

        _settleResources(originPlanetId);
        uint256 travelDistance = _planetDistance(originPlanetId, attack.targetPlanetId);
        uint128 fuelCost = _toUint128(
            VeydriftAntiRaidPrimitives.missionFuelCost(
                fleetFuelConsumption,
                travelDistance,
                VeydriftAntiRaidPrimitives.FULL_MISSION_SPEED_PERCENT
            )
        );
        uint64 departureAt = _currentTimestamp();
        uint256 travelSeconds = VeydriftAntiRaidPrimitives.travelSeconds(
            travelDistance,
            slowestSpeed,
            VeydriftAntiRaidPrimitives.FULL_MISSION_SPEED_PERCENT,
            FLEET_UNIVERSE_SPEED
        );
        uint64 naturalArrivalAt;
        unchecked {
            naturalArrivalAt = uint64(uint256(departureAt) + travelSeconds);
        }
        if (naturalArrivalAt > attack.arrivalAt) revert FleetAlreadyArrived();
        uint256 cargoTotal =
            uint256(cargo.metal) + uint256(cargo.crystal) + uint256(cargo.deuterium);
        uint256 committedCapacity = cargoTotal + fuelCost;
        if (committedCapacity > capacity) {
            revert CargoCapacityExceeded(capacity, committedCapacity);
        }

        _spend(
            originPlanetId,
            Resources({
                metal: cargo.metal,
                crystal: cargo.crystal,
                deuterium: _toUint128(uint256(cargo.deuterium) + fuelCost)
            })
        );
        _increaseInternalResources(cargo);
        _debitMissionShips(originPlanetId, ships);

        uint64 returnAt;
        unchecked {
            returnAt = uint64(uint256(attack.arrivalAt) + travelSeconds);
        }
        missionId = nextFleetId++;
        activeFleetMissionCount[msg.sender] += 1;
        _fleetMissions[missionId] = FleetMission({
            status: FleetMissionStatus.Outbound,
            missionType: FleetMissionType.AcsAttack,
            owner: msg.sender,
            originPlanetId: originPlanetId,
            targetPlanetId: attack.targetPlanetId,
            departureAt: departureAt,
            arrivalAt: attack.arrivalAt,
            returnAt: returnAt,
            fuelCost: fuelCost,
            cargo: cargo,
            ships: ships,
            randomnessRequestId: attackMissionId
        });
        _fleetCounterplayMissions[attackMissionId].push(missionId);

        emit AttackMissionJoined(
            attackMissionId, missionId, msg.sender, originPlanetId, attack.targetPlanetId
        );
        emit FleetMissionLaunched(
            missionId,
            msg.sender,
            FleetMissionType.AcsAttack,
            originPlanetId,
            attack.targetPlanetId,
            attack.arrivalAt,
            returnAt,
            attackMissionId
        );
        emit FleetMissionCargo(missionId, cargo.metal, cargo.crystal, cargo.deuterium, fuelCost);
        _emitFleetMissionShips(missionId, ships);
    }

    function _requestAttackBattleRandomness(uint256 missionId) private returns (uint256 requestId) {
        address randomnessEngine = _randomnessEngine;
        if (randomnessEngine == address(0)) revert RandomnessEngineUnset();
        return IVeydriftAttackRandomnessEngine(randomnessEngine)
            .requestRandomness(_attackBattlePurposeHash(missionId));
    }

    function _emitFleetMissionShips(uint256 missionId, MissionShips calldata ships) private {
        emit FleetMissionShips(
            missionId,
            ships.smallCargo,
            ships.lightFighter,
            ships.recycler,
            ships.colonyShip,
            ships.largeCargo,
            ships.heavyFighter,
            ships.cruiser,
            ships.battleship,
            ships.bomber,
            ships.destroyer,
            ships.deathstar,
            ships.battlecruiser,
            ships.reaper,
            ships.pathfinder
        );
    }

    function recallFleetMission(uint256 missionId) external {
        FleetMission storage mission = _fleetMissions[missionId];
        _requireActiveMissionOwner(mission);
        if (mission.status == FleetMissionStatus.Returning) revert FleetAlreadyReturning();
        if (mission.status == FleetMissionStatus.Recalled) revert FleetAlreadyReturning();
        if (mission.status != FleetMissionStatus.Outbound) {
            revert FleetMissionNotResolved(mission.returnAt);
        }
        _requireNoPendingMissionResolutionForPlanet(mission.originPlanetId);
        _requireNoPendingMissionResolutionForPlanet(mission.targetPlanetId);
        if (_currentTimestamp() >= mission.arrivalAt) revert FleetAlreadyArrived();
        uint64 recallDeadline = mission.arrivalAt - FLEET_RECALL_CUTOFF_SECONDS;
        if (_currentTimestamp() > recallDeadline) revert FleetRecallCutoffPassed(recallDeadline);

        _settleResources(mission.originPlanetId);
        uint128 recallCost = _fleetRecallCost(mission.fuelCost);
        _spend(mission.originPlanetId, Resources({metal: 0, crystal: 0, deuterium: recallCost}));

        uint64 elapsed = uint64(
            VeydriftAntiRaidPrimitives.recallReturnSeconds(
                _currentTimestamp() - mission.departureAt
            )
        );
        mission.status = FleetMissionStatus.Recalled;
        mission.returnAt = uint64(_currentTimestamp() + elapsed);

        emit FleetMissionRecalled(missionId, msg.sender, mission.returnAt, recallCost);
        emit FleetMissionReturnExposed(
            missionId,
            msg.sender,
            FleetMissionStatus.Recalled,
            mission.originPlanetId,
            mission.targetPlanetId,
            mission.returnAt,
            mission.cargo.metal,
            mission.cargo.crystal,
            mission.cargo.deuterium
        );
    }

    function resolveFleetMission(uint256 missionId) external {
        FleetMission storage mission = _fleetMissions[missionId];
        if (mission.status != FleetMissionStatus.Outbound) return;
        if (_currentTimestamp() < mission.arrivalAt) revert FleetNotArrived(mission.arrivalAt);

        _settleResources(mission.targetPlanetId);
        if (mission.missionType == FleetMissionType.Transport) {
            _planets[mission.targetPlanetId].resources =
                _add(_planets[mission.targetPlanetId].resources, mission.cargo);
            mission.cargo = Resources({metal: 0, crystal: 0, deuterium: 0});
            mission.status = FleetMissionStatus.Returning;
        } else if (mission.missionType == FleetMissionType.Deploy) {
            _planets[mission.targetPlanetId].resources =
                _add(_planets[mission.targetPlanetId].resources, mission.cargo);
            _creditMissionShips(mission.targetPlanetId, mission.ships);
            mission.status = FleetMissionStatus.Resolved;
            mission.returnAt = _currentTimestamp();
            activeFleetMissionCount[mission.owner] -= 1;
        } else if (
            mission.missionType == FleetMissionType.Attack
                || mission.missionType == FleetMissionType.Harvest
        ) {
            _delegateToCombatModule();
        } else {
            if (_fleetMissions[mission.randomnessRequestId].status == FleetMissionStatus.Outbound) {
                return;
            }
            mission.status = FleetMissionStatus.Returning;
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

    function launchInterplanetaryMissileAttack(uint256, uint256, Defense, uint32) external {
        _delegateToCombatModule();
    }

    function _validateShipProduction(uint256 planetId, Ship ship, uint32 quantity) private view {
        _requirePlanetOwner(planetId);
        if (quantity == 0) revert InvalidQuantity();
        if (shipQueues[planetId].active) revert QueueActive();
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

    function _requirePlanetOwner(uint256 planetId) private view {
        Planet storage planetRef = _planets[planetId];
        if (planetRef.owner == address(0)) revert NoPlanet();
        if (planetRef.owner != msg.sender) revert NotPlanetOwner();
    }

    function _requireShips(uint256 planetId, Ship ship, uint32 quantity) private view {
        uint32 available = _shipCounts[planetId][ship];
        if (available < quantity) revert InsufficientShips(ship, available, quantity);
    }

    function _settleResources(uint256 planetId) private {
        uint64 currentTime = _currentTimestamp();
        Planet storage planetRef = _planets[planetId];
        if (currentTime <= planetRef.lastSettledAt) {
            return;
        }

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
            _technologyLevels[planetRef.owner][Technology.Energy],
            planetRef.metalMultiplierBps,
            planetRef.crystalMultiplierBps,
            planetRef.deuteriumMultiplierBps
        );
    }

    function _spend(uint256 planetId, Resources memory cost) private {
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

    function _defenseCost(Defense defense) private pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.defenseCost(defense);
        return Resources(metal, crystal, deuterium);
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

    function _enforceAttackProtection(address attacker, uint256 targetPlanetId) private view {
        address defender = _attackDefender(targetPlanetId);
        if (defender == attacker) revert SelfAttack();
        AttackBlockReason reason = _attackBlockReason(
            attacker,
            defender,
            _currentAttackCount(_attackWindowKey(attacker, defender, targetPlanetId))
        );
        if (reason == AttackBlockReason.BashingLimit) revert AttackBashingLimitReached();
        if (reason == AttackBlockReason.ScoreProtection) revert AttackScoreProtection();
    }

    function _recordAttack(address attacker, uint256 targetPlanetId) private {
        address defender = _attackDefender(targetPlanetId);
        if (_isAttackProtectionExempt(attacker, defender)) return;

        bytes32 windowKey = _attackWindowKey(attacker, defender, targetPlanetId);
        AttackWindow storage window = _attackWindows[windowKey];
        uint64 currentTime = _currentTimestamp();
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

    function _attackBlockReason(address attacker, address defender, uint32 attacksInWindow)
        private
        view
        returns (AttackBlockReason)
    {
        if (attacker == defender || _isAttackProtectionExempt(attacker, defender)) {
            return AttackBlockReason.None;
        }
        if (VeydriftAntiRaidPrimitives.isBashingLimitReached(attacksInWindow, false)) {
            return AttackBlockReason.BashingLimit;
        }
        if (VeydriftAntiRaidPrimitives.isScoreProtected(
                _totalUserScore(attacker), _totalUserScore(defender), false
            )) {
            return AttackBlockReason.ScoreProtection;
        }
        return AttackBlockReason.None;
    }

    function _currentAttackCount(bytes32 windowKey) private view returns (uint32) {
        AttackWindow memory window = _attackWindows[windowKey];
        uint64 currentTime = _currentTimestamp();
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
        private
        view
        returns (bool)
    {
        return _attackProtectionExemptions[_playerPairKey(attacker, defender)];
    }

    function _attackDefender(uint256 targetPlanetId) private view returns (address) {
        address defender = _planets[targetPlanetId].owner;
        if (defender == address(0)) revert NoPlanet();
        return defender;
    }

    function _attackWindowKey(address attacker, address defender, uint256 targetPlanetId)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(attacker, defender, targetPlanetId));
    }

    function _requireActiveMissionOwner(FleetMission storage mission) private view {
        if (
            mission.status == FleetMissionStatus.None
                || mission.status == FleetMissionStatus.Returned
        ) {
            revert FleetInactive();
        }
        if (mission.owner != msg.sender) revert FleetNotOwner();
    }

    function _requireMissionShips(uint256 planetId, MissionShips memory ships) private view {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 quantity = _missionShipQuantity(ships, ship);
            if (quantity != 0) _requireShips(planetId, ship, quantity);
            unchecked {
                ++i;
            }
        }
    }

    function _debitMissionShips(uint256 planetId, MissionShips memory ships) private {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 quantity = _missionShipQuantity(ships, ship);
            if (quantity != 0) _shipCounts[planetId][ship] -= quantity;
            unchecked {
                ++i;
            }
        }
    }

    function _creditMissionShips(uint256 planetId, MissionShips memory ships) private {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 quantity = _missionShipQuantity(ships, ship);
            if (quantity != 0) _shipCounts[planetId][ship] += quantity;
            unchecked {
                ++i;
            }
        }
    }

    function _missionMovement(address player, MissionShips memory ships)
        private
        view
        returns (uint256 capacity, uint256 fuelConsumption, uint256 slowestSpeed)
    {
        uint16 combustionDrive = _technologyLevels[player][Technology.CombustionDrive];
        uint16 impulseDrive = _technologyLevels[player][Technology.ImpulseDrive];
        uint16 hyperspaceDrive = _technologyLevels[player][Technology.HyperspaceDrive];
        slowestSpeed = type(uint256).max;
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 quantity = _missionShipQuantity(ships, ship);
            if (quantity != 0) {
                (uint256 cargoCapacity, uint256 fuel, uint256 speed) = VeydriftCatalog.shipMovementStats(
                    ship, combustionDrive, impulseDrive, hyperspaceDrive
                );
                unchecked {
                    capacity += uint256(quantity) * cargoCapacity;
                    fuelConsumption += uint256(quantity) * fuel;
                }
                if (speed < slowestSpeed) slowestSpeed = speed;
            }
            unchecked {
                ++i;
            }
        }
        if (slowestSpeed == type(uint256).max) slowestSpeed = 0;
    }

    function _fleetRecallCost(uint128 fuelCost) private pure returns (uint128) {
        if (fuelCost == 0) return 0;
        uint128 cost = _toUint128((uint256(fuelCost) * FLEET_RECALL_COST_BPS) / BPS);
        return cost == 0 ? 1 : cost;
    }

    function _missionShipQuantity(MissionShips memory ships, Ship ship)
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

    function _totalUserScore(address player) private view returns (uint256 score) {
        for (uint8 id = 0; id <= MAX_TECHNOLOGY_ID;) {
            score += uint256(_technologyLevels[player][Technology(id)]) * (id + 1) * 15;
            unchecked {
                ++id;
            }
        }
        for (uint256 planetId = 1; planetId < nextPlanetId;) {
            if (_planets[planetId].owner == player) {
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
                    score += uint256(_shipCounts[planetId][Ship(id)]) * (id + 1) * 4;
                    unchecked {
                        ++id;
                    }
                }
            }
            unchecked {
                ++planetId;
            }
        }
    }

    function _delegateToCombatModule() private {
        address module = _combatModule;
        (bool ok, bytes memory result) = module.delegatecall(msg.data);
        if (ok) return;
        if (result.length != 0) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        revert UnsupportedGameplayModule();
    }

    function _planetDistance(uint256 originPlanetId, uint256 destinationPlanetId)
        private
        view
        returns (uint256)
    {
        Planet storage origin = _planets[originPlanetId];
        Planet storage destination = _planets[destinationPlanetId];
        uint256 galaxyDistance = origin.galaxy > destination.galaxy
            ? uint256(origin.galaxy - destination.galaxy)
            : uint256(destination.galaxy - origin.galaxy);
        if (galaxyDistance != 0) return galaxyDistance * 20_000;
        uint256 systemDistance = origin.system > destination.system
            ? uint256(origin.system - destination.system)
            : uint256(destination.system - origin.system);
        if (systemDistance != 0) return 2_700 + systemDistance * 95;
        uint256 positionDistance = origin.position > destination.position
            ? uint256(origin.position - destination.position)
            : uint256(destination.position - origin.position);
        if (positionDistance != 0) return 1_000 + positionDistance * 5;
        return 0;
    }

    function _max(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a : b;
    }

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}
