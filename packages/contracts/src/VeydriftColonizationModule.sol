// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {VeydriftPlanetGeneration} from "./libraries/VeydriftPlanetGeneration.sol";
import {Building, Ship, Technology} from "./libraries/VeydriftTypes.sol";

/// @notice Delegatecall target for delayed colony fleet mission launch and resolution.
contract VeydriftColonizationModule is VeydriftResourceReserves {
    using SafeCast for uint256;

    constructor() VeydriftResourceReserves(address(0)) {}

    function createColonyAtNextSlot(uint256 originPlanetId, uint256 salt)
        external
        returns (uint256)
    {
        _validateColonyCreation(originPlanetId);
        (uint16 galaxy, uint16 system, uint8 position) = _nextColonyCoordinates(msg.sender, salt);
        return _launchColonyMission(originPlanetId, galaxy, system, position);
    }

    function createColony(uint256 originPlanetId, uint16 galaxy, uint16 system, uint8 position)
        external
        returns (uint256)
    {
        _validateColonyCreation(originPlanetId);
        return _launchColonyMission(originPlanetId, galaxy, system, position);
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
        uint8 position
    ) private returns (uint256 missionId) {
        bytes32 coordinates = _coordinateKey(galaxy, system, position);
        if (occupiedCoordinates[coordinates]) revert CoordinatesOccupied();

        _settleResources(originPlanetId);
        uint256 travelDistance =
            _planetDistanceToCoordinates(originPlanetId, galaxy, system, position);
        uint128 fuelCost = _toUint128(VeydriftAntiRaidPrimitives.missionFuelCost(1, travelDistance));
        _spend(originPlanetId, Resources({metal: 0, crystal: 0, deuterium: fuelCost}));
        _shipCounts[originPlanetId][Ship.ColonyShip] -= 1;

        uint64 departureAt = _currentTimestamp();
        uint256 travelSeconds = VeydriftAntiRaidPrimitives.travelSeconds(travelDistance);
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
            cargo: Resources({metal: 0, crystal: 0, deuterium: 0}),
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
        emit FleetMissionCargo(missionId, 0, 0, 0, fuelCost);
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
        uint256 systemDistance = origin.system > system
            ? uint256(origin.system - system)
            : uint256(system - origin.system);
        uint256 positionDistance = origin.position > position
            ? uint256(origin.position - position)
            : uint256(position - origin.position);
        return galaxyDistance * uint256(MAX_SYSTEM) * uint256(MAX_POSITION) + systemDistance
            * uint256(MAX_POSITION) + positionDistance;
    }

    function _encodeColonyTarget(uint16 galaxy, uint16 system, uint8 position)
        private
        view
        returns (uint256)
    {
        _coordinateKey(galaxy, system, position);
        return (uint256(galaxy) << 24) | (uint256(system) << 8) | uint256(position);
    }

    function _decodeColonyTarget(uint256 target)
        private
        view
        returns (uint16 galaxy, uint16 system, uint8 position)
    {
        galaxy = (target >> 24).toUint16();
        system = ((target >> 8) & 0xffff).toUint16();
        position = (target & 0xff).toUint8();
        _coordinateKey(galaxy, system, position);
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
