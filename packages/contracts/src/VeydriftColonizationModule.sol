// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftDependencies} from "./libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {VeydriftPlanetGeneration} from "./libraries/VeydriftPlanetGeneration.sol";
import {Building, Defense, Ship, Technology} from "./libraries/VeydriftTypes.sol";

/// @notice Delegatecall target for delayed colony fleet mission launch and resolution.
contract VeydriftColonizationModule is VeydriftResourceReserves {
    using SafeCast for uint256;

    uint256 private constant COLONIZATION_COORDINATE_FLAG = 1 << 255;
    uint256 private constant COLONIZATION_GALAXY_SHIFT = 24;
    uint256 private constant COLONIZATION_SYSTEM_SHIFT = 8;
    uint256 private constant COLONIZATION_COORDINATE_MASK = 0xffff;
    uint256 private constant COLONIZATION_POSITION_MASK = 0xff;
    constructor() VeydriftResourceReserves(address(0)) {}

    function setSpaceDockSystem(address nextSpaceDockSystem) external onlyOwner {
        _spaceDockSystem = nextSpaceDockSystem;
    }

    function startShipProduction(uint256 planetId, Ship ship, uint32 quantity) external {
        _requirePlanetOwner(planetId);
        _requireNoPendingMissionResolutionForPlanet(planetId);
        _validateShipProduction(planetId, ship, quantity);
        _settleResources(planetId);

        Resources memory unitCost = _shipCost(ship);
        Resources memory totalCost = _multiply(unitCost, quantity);
        _spend(planetId, totalCost);

        uint64 readyAt =
            (uint256(_currentTimestamp()) + _shipDuration(planetId, unitCost, quantity)).toUint64();
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

    function startDefenseProduction(uint256 planetId, Defense defense, uint32 quantity) external {
        _requirePlanetOwner(planetId);
        if (quantity == 0) revert InvalidQuantity();
        DefenseQueue memory activeQueue = defenseQueues[planetId];
        if (activeQueue.active && activeQueue.defense != defense) revert QueueActive();

        _requireDefenseDependencies(planetId, defense);
        _requireDefenseCapacity(planetId, defense, quantity);
        _settleResources(planetId);

        Resources memory unitCost = _defenseCost(defense);
        Resources memory totalCost = _multiply(unitCost, quantity);
        _spend(planetId, totalCost);

        uint256 currentTime = _currentTimestamp();
        uint256 baseReadyAt = activeQueue.active && activeQueue.readyAt > currentTime
            ? activeQueue.readyAt
            : currentTime;
        uint64 readyAt = (baseReadyAt + _defenseDuration(planetId, unitCost, quantity)).toUint64();
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

    function createColonyAtNextSlot(uint256 originPlanetId, uint256 salt)
        external
        returns (uint256)
    {
        _validateColonyCreation(originPlanetId);
        (uint16 galaxy, uint16 system, uint8 position) = _nextColonyCoordinates(msg.sender, salt);
        return _launchColonyMission(
            originPlanetId,
            galaxy,
            system,
            position,
            Resources({metal: 0, crystal: 0, deuterium: 0}),
            VeydriftAntiRaidPrimitives.FULL_MISSION_SPEED_PERCENT
        );
    }

    function createColony(uint256 originPlanetId, uint16 galaxy, uint16 system, uint8 position)
        external
        returns (uint256)
    {
        _validateColonyCreation(originPlanetId);
        return _launchColonyMission(
            originPlanetId,
            galaxy,
            system,
            position,
            Resources({metal: 0, crystal: 0, deuterium: 0}),
            VeydriftAntiRaidPrimitives.FULL_MISSION_SPEED_PERCENT
        );
    }

    function launchFleetMission(
        uint256 originPlanetId,
        uint256 targetPlanetId,
        FleetMissionType missionType,
        MissionShips calldata ships,
        Resources calldata cargo,
        uint256 randomnessRequestId
    ) external returns (uint256 missionId) {
        missionId = _launchColonizeFleetMission(
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
        missionId = _launchColonizeFleetMission(
            originPlanetId,
            targetPlanetId,
            missionType,
            ships,
            cargo,
            speedPercent,
            randomnessRequestId
        );
    }

    function _launchColonizeFleetMission(
        uint256 originPlanetId,
        uint256 targetPlanetId,
        FleetMissionType missionType,
        MissionShips calldata ships,
        Resources calldata cargo,
        uint16 speedPercent,
        uint256 randomnessRequestId
    ) private returns (uint256 missionId) {
        if (missionType != FleetMissionType.Colonize) {
            revert InvalidMissionType(missionType);
        }
        if (randomnessRequestId != 0) revert InvalidId();
        _validateColonyCreation(originPlanetId);
        if (ships.colonyShip != 1 || _missionShipTotal(ships) != 1) revert InvalidQuantity();

        (uint16 galaxy, uint16 system, uint8 position) = _decodeColonyTarget(targetPlanetId);
        missionId =
            _launchColonyMission(originPlanetId, galaxy, system, position, cargo, speedPercent);
    }

    function resolveFleetMission(uint256 missionId) external {
        FleetMission storage mission = _fleetMissions[missionId];
        if (mission.status != FleetMissionStatus.Outbound) return;
        if (mission.missionType != FleetMissionType.Colonize) {
            revert InvalidMissionType(mission.missionType);
        }
        if (_currentTimestamp() < mission.arrivalAt) revert FleetNotArrived(mission.arrivalAt);

        (uint16 galaxy, uint16 system, uint8 position) = _decodeColonyTarget(mission.targetPlanetId);
        uint256 limit = 1 + _technologyLevels[mission.owner][Technology.Astrophysics];
        if (
            occupiedCoordinates[_coordinateKey(galaxy, system, position)]
                || planetCountOf[mission.owner] >= limit
        ) {
            mission.status = FleetMissionStatus.Returning;
        } else {
            _createColony(
                mission.owner, mission.originPlanetId, galaxy, system, position, mission.cargo
            );
            mission.cargo = Resources({metal: 0, crystal: 0, deuterium: 0});
            mission.status = FleetMissionStatus.Resolved;
            mission.returnAt = _currentTimestamp();
            activeFleetMissionCount[mission.owner] -= 1;
        }
        _untrackDirectMissionResolution(missionId, mission);

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

    function _validateColonyCreation(uint256 originPlanetId) private view {
        _requirePlanetOwner(originPlanetId);
        _requireNoPendingMissionResolutionForPlanet(originPlanetId);
        uint256 limit = 1 + _technologyLevels[msg.sender][Technology.Astrophysics];
        if (planetCountOf[msg.sender] >= limit) revert PlanetLimitReached(limit);
        uint256 fleetSlots = VeydriftAntiRaidPrimitives.fleetSlotLimit(
            _technologyLevels[msg.sender][Technology.Computer]
        );
        if (activeFleetMissionCount[msg.sender] >= fleetSlots) {
            revert FleetSlotLimitReached(fleetSlots);
        }
        _requireShips(originPlanetId, Ship.ColonyShip, 1);
    }

    function _launchColonyMission(
        uint256 originPlanetId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        Resources memory cargo,
        uint16 speedPercent
    ) private returns (uint256 missionId) {
        bytes32 coordinates = _coordinateKey(galaxy, system, position);
        if (occupiedCoordinates[coordinates]) revert CoordinatesOccupied();

        _settleResources(originPlanetId);
        uint256 travelDistance =
            _planetDistanceToCoordinates(originPlanetId, galaxy, system, position);
        (uint256 capacity, uint256 fuelConsumption, uint256 speed) = VeydriftCatalog.shipMovementStats(
            Ship.ColonyShip,
            _technologyLevels[msg.sender][Technology.CombustionDrive],
            _technologyLevels[msg.sender][Technology.ImpulseDrive],
            _technologyLevels[msg.sender][Technology.HyperspaceDrive]
        );
        uint128 fuelCost = _toUint128(
            VeydriftAntiRaidPrimitives.missionFuelCost(
                fuelConsumption, travelDistance, speedPercent
            )
        );
        uint256 committedCapacity =
            uint256(cargo.metal) + uint256(cargo.crystal) + uint256(cargo.deuterium) + fuelCost;
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
        _shipCounts[originPlanetId][Ship.ColonyShip] -= 1;

        uint64 departureAt = _currentTimestamp();
        uint256 travelSeconds = VeydriftAntiRaidPrimitives.travelSeconds(
            travelDistance, speed, speedPercent, FLEET_UNIVERSE_SPEED
        );
        uint64 arrivalAt = (uint256(departureAt) + travelSeconds).toUint64();
        uint64 returnAt = (uint256(arrivalAt) + travelSeconds).toUint64();
        missionId = nextFleetId++;
        activeFleetMissionCount[msg.sender] += 1;
        MissionShips memory ships;
        ships.colonyShip = 1;
        uint256 targetPlanetId = _encodeColonyTarget(galaxy, system, position);
        _fleetMissions[missionId] = FleetMission({
            status: FleetMissionStatus.Outbound,
            missionType: FleetMissionType.Colonize,
            owner: msg.sender,
            originPlanetId: originPlanetId,
            targetPlanetId: targetPlanetId,
            departureAt: departureAt,
            arrivalAt: arrivalAt,
            returnAt: returnAt,
            fuelCost: fuelCost,
            cargo: cargo,
            ships: ships,
            randomnessRequestId: 0
        });
        emit FleetMissionLaunched(
            missionId,
            msg.sender,
            FleetMissionType.Colonize,
            originPlanetId,
            targetPlanetId,
            arrivalAt,
            returnAt,
            0
        );
        emit FleetMissionCargo(missionId, cargo.metal, cargo.crystal, cargo.deuterium, fuelCost);
        emit FleetMissionShips(missionId, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }

    function _createColony(
        address owner,
        uint256 originPlanetId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        Resources memory cargo
    ) private returns (uint256 colonyPlanetId) {
        bytes32 coordinates = _coordinateKey(galaxy, system, position);
        if (occupiedCoordinates[coordinates]) revert CoordinatesOccupied();

        colonyPlanetId = nextPlanetId++;
        occupiedCoordinates[coordinates] = true;
        planetCountOf[owner] += 1;
        _registerOwnedPlanet(owner, colonyPlanetId);

        bytes32 seed = _planetSeed(galaxy, system, position);
        uint16 fields = uint16(160 + (uint256(seed) % 80));
        int16 temperature = VeydriftPlanetGeneration.slotTemperature(
            position, (uint256(seed) >> 16) % 21, (uint256(seed) >> 24) % 21
        );
        (uint16 metalMultiplier, uint16 crystalMultiplier, uint16 deuteriumMultiplier) =
            VeydriftFormulas.planetMultipliers(temperature, fields);
        _planets[colonyPlanetId] = Planet({
            owner: owner,
            galaxy: galaxy,
            system: system,
            position: position,
            fields: fields,
            temperature: temperature,
            metalMultiplierBps: metalMultiplier,
            crystalMultiplierBps: crystalMultiplier,
            deuteriumMultiplierBps: deuteriumMultiplier,
            lastSettledAt: _currentTimestamp(),
            resources: cargo
        });
        emit ColonyCreated(
            owner, originPlanetId, colonyPlanetId, galaxy, system, position, fields, temperature
        );
    }

    function _nextColonyCoordinates(address player, uint256 salt)
        private
        view
        returns (uint16 galaxy, uint16 system, uint8 position)
    {
        for (uint256 attempt = 0; attempt < 64; attempt++) {
            bytes32 seed = keccak256(
                abi.encode(
                    PLANET_SEED_DOMAIN, block.chainid, player, salt, planetCountOf[player], attempt
                )
            );
            galaxy = uint16((uint256(seed) % MAX_GALAXY) + 1);
            system = uint16(((uint256(seed) >> 16) % MAX_SYSTEM) + 1);
            position = uint8(((uint256(seed) >> 32) % MAX_POSITION) + 1);
            if (!occupiedCoordinates[_coordinateKey(galaxy, system, position)]) {
                return (galaxy, system, position);
            }
        }
        revert CoordinatesExhausted();
    }

    function _planetDistanceToCoordinates(
        uint256 originPlanetId,
        uint16 galaxy,
        uint16 system,
        uint8 position
    ) private view returns (uint256) {
        Planet storage origin = _planets[originPlanetId];
        if (origin.owner == address(0)) revert NoPlanet();
        uint256 galaxyDistance = origin.galaxy > galaxy
            ? uint256(origin.galaxy - galaxy)
            : uint256(galaxy - origin.galaxy);
        if (galaxyDistance != 0) return galaxyDistance * 20_000;
        uint256 systemDistance = origin.system > system
            ? uint256(origin.system - system)
            : uint256(system - origin.system);
        if (systemDistance != 0) return 2_700 + systemDistance * 95;
        uint256 positionDistance = origin.position > position
            ? uint256(origin.position - position)
            : uint256(position - origin.position);
        if (positionDistance != 0) return 1_000 + positionDistance * 5;
        return 0;
    }

    function _encodeColonyTarget(uint16 galaxy, uint16 system, uint8 position)
        private
        view
        returns (uint256)
    {
        _coordinateKey(galaxy, system, position);
        return COLONIZATION_COORDINATE_FLAG | (uint256(galaxy) << COLONIZATION_GALAXY_SHIFT)
            | (uint256(system) << COLONIZATION_SYSTEM_SHIFT) | uint256(position);
    }

    function _decodeColonyTarget(uint256 target)
        private
        view
        returns (uint16 galaxy, uint16 system, uint8 position)
    {
        if ((target & COLONIZATION_COORDINATE_FLAG) == 0) revert InvalidCoordinates();
        galaxy = ((target >> COLONIZATION_GALAXY_SHIFT) & COLONIZATION_COORDINATE_MASK).toUint16();
        system = ((target >> COLONIZATION_SYSTEM_SHIFT) & COLONIZATION_COORDINATE_MASK).toUint16();
        position = (target & COLONIZATION_POSITION_MASK).toUint8();
        _coordinateKey(galaxy, system, position);
    }

    function _missionShipTotal(MissionShips memory ships) private pure returns (uint256) {
        return uint256(ships.smallCargo) + ships.lightFighter + ships.recycler + ships.colonyShip
            + ships.largeCargo + ships.heavyFighter + ships.cruiser + ships.battleship
            + ships.bomber + ships.destroyer + ships.deathstar + ships.battlecruiser + ships.reaper
            + ships.pathfinder;
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

    function _validateShipProduction(uint256 planetId, Ship ship, uint32 quantity) private view {
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
        DefenseQueue memory activeQueue = defenseQueues[planetId];
        uint32 queuedQuantity =
            activeQueue.active && activeQueue.defense == defense ? activeQueue.quantity : 0;
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
        if (!queue.active) return 0;
        return uint32(VeydriftCatalog.missileSlots(queue.defense)) * queue.quantity;
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
        if (currentTime <= planetRef.lastSettledAt) return;

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

    function _coordinateKey(uint16 galaxy, uint16 system, uint8 position)
        private
        view
        returns (bytes32)
    {
        return VeydriftPlanetGeneration.coordinateKey(
            block.chainid, galaxy, system, position, MAX_GALAXY, MAX_SYSTEM, MAX_POSITION
        );
    }

    function _planetSeed(uint16 galaxy, uint16 system, uint8 position)
        private
        view
        returns (bytes32)
    {
        return VeydriftPlanetGeneration.planetSeed(
            PLANET_SEED_DOMAIN,
            block.chainid,
            galaxy,
            system,
            position,
            MAX_GALAXY,
            MAX_SYSTEM,
            MAX_POSITION
        );
    }

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}
