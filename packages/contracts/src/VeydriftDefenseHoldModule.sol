// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftGameStorage} from "./VeydriftGameStorage.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftDefenseHoldStorage} from "./libraries/VeydriftDefenseHoldStorage.sol";
import {Building, Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IVeydriftDefenseHoldAllianceSystem {
    function defenseHoldFuelContext(
        address viewer,
        uint256 defenderPlanetId,
        VeydriftGameStorage.MissionShips calldata ships,
        uint256 holdSeconds
    ) external view returns (bool canCoordinate, uint128 netHoldingFuelCost, uint128 depotSupport);
}

/// @notice Delegatecall target implementing OGame-style ACS Defend (DefenseHold): station a fleet at
///         a planet for a chosen hold window so it automatically defends any attack that lands while
///         it is holding, then flies home. Kept in its own module so the size-constrained gameplay
///         and combat modules stay within EIP-170.
contract VeydriftDefenseHoldModule is VeydriftResourceReserves {
    using SafeCast for uint256;

    constructor() VeydriftResourceReserves(address(0)) {}

    /// @notice Launch a DefenseHold mission. The fleet flies to `targetPlanetId` (owned by the sender
    ///         or a same-alliance member), holds for `holdSeconds` after arrival, and defends any
    ///         attack landing during the hold window before returning home. Holding fuel scales with
    ///         the hold duration and is offset by the defended planet's Alliance Depot.
    function launchDefenseHold(
        uint256 originPlanetId,
        uint256 targetPlanetId,
        MissionShips calldata ships,
        Resources calldata cargo,
        uint16 speedPercent,
        uint256 holdSeconds
    ) external returns (uint256 missionId) {
        _requirePlanetOwner(originPlanetId);
        if (originPlanetId == targetPlanetId) revert SamePlanet();
        if (_planets[targetPlanetId].owner == address(0)) revert NoPlanet();
        if (
            holdSeconds < VeydriftAntiRaidPrimitives.MIN_DEFENSE_HOLD_SECONDS
                || holdSeconds > VeydriftAntiRaidPrimitives.MAX_DEFENSE_HOLD_SECONDS
        ) {
            revert InvalidHoldWindow(holdSeconds);
        }
        // Lazy on-chain reconciliation (VEY-KANEO-477): settle the caller's due Colonize/combat fleet
        // arrivals BEFORE the pending-resolution gate, so a ready-but-unsettled arrival of the caller's
        // own fleet does not wrongly block launching a defense hold. Mirrors the prologue every other
        // mutating fleet path runs; genuinely pending (randomness-uncommitted) arrivals still revert.
        _settleDueColonizeArrivals(msg.sender);
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlanet(originPlanetId);
        _requireNoPendingMissionResolutionForPlanet(targetPlanetId);

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
        uint64 arrivalAt = (uint256(departureAt) + travelSeconds).toUint64();

        address allianceSystem = _allianceSystem;
        if (allianceSystem == address(0)) revert DefenseHoldNotAuthorized(targetPlanetId);
        (bool canCoordinate, uint128 netHoldingFuelCost, uint128 depotSupport) = IVeydriftDefenseHoldAllianceSystem(
                allianceSystem
            ).defenseHoldFuelContext(msg.sender, targetPlanetId, ships, holdSeconds);
        if (!canCoordinate) revert DefenseHoldNotAuthorized(targetPlanetId);
        if (depotSupport != 0) {
            _settleResources(targetPlanetId);
            _spend(targetPlanetId, Resources({metal: 0, crystal: 0, deuterium: depotSupport}));
        }
        fuelCost = _toUint128(uint256(fuelCost) + netHoldingFuelCost);

        uint256 committedCapacity =
            uint256(cargo.metal) + cargo.crystal + cargo.deuterium + fuelCost;
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

        // Arrive, hold for the chosen window, then fly home.
        uint64 holdUntil = (uint256(arrivalAt) + holdSeconds).toUint64();
        uint64 returnAt = (uint256(holdUntil) + travelSeconds).toUint64();
        missionId = nextFleetId++;
        activeFleetMissionCount[msg.sender] += 1;
        _fleetMissions[missionId] = FleetMission({
            status: FleetMissionStatus.Outbound,
            missionType: FleetMissionType.DefenseHold,
            owner: msg.sender,
            originPlanetId: originPlanetId,
            targetPlanetId: targetPlanetId,
            departureAt: departureAt,
            arrivalAt: arrivalAt,
            returnAt: returnAt,
            fuelCost: fuelCost,
            cargo: cargo,
            ships: ships,
            randomnessRequestId: 0,
            lootRatio: LootRatio({metalBps: 0, crystalBps: 0, deuteriumBps: 0})
        });

        VeydriftDefenseHoldStorage.beginHold(
            _stationedDefenseMissions[targetPlanetId],
            _stationedDefenseMissionIndex[targetPlanetId],
            _defenseHoldUntil,
            _fleetMissions,
            missionId,
            holdUntil
        );

        emit FleetMissionLaunched(
            missionId,
            msg.sender,
            FleetMissionType.DefenseHold,
            originPlanetId,
            targetPlanetId,
            arrivalAt,
            returnAt,
            0
        );
        emit FleetMissionCargo(missionId, cargo.metal, cargo.crystal, cargo.deuterium, fuelCost);
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

    /// @notice Send a stationed DefenseHold fleet home once its hold window has elapsed. The facade
    ///         routes only DefenseHold missions here; surviving ships fly back with their cargo.
    function resolveFleetMission(uint256 missionId) external {
        FleetMission storage mission = _fleetMissions[missionId];
        if (mission.status != FleetMissionStatus.Outbound) return;
        if (_currentTimestamp() < mission.arrivalAt) revert FleetNotArrived(mission.arrivalAt);

        uint64 holdUntil = _defenseHoldUntil[missionId];
        if (_currentTimestamp() < holdUntil) revert DefenseHoldStillActive(holdUntil);

        _settleResources(mission.targetPlanetId);
        mission.status = FleetMissionStatus.Returning;
        VeydriftDefenseHoldStorage.endHold(
            _stationedDefenseMissions[mission.targetPlanetId],
            _stationedDefenseMissionIndex[mission.targetPlanetId],
            _defenseHoldUntil,
            missionId
        );

        emit DefenseHoldEnded(missionId, mission.targetPlanetId, FleetMissionStatus.Returning);
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
    }

    // --- Shared launch/settlement helpers (mirrored from the gameplay module so this module is a
    //     self-contained delegatecall target with EIP-170 headroom). ---

    function _requirePlanetOwner(uint256 planetId) private view {
        Planet storage planetRef = _planets[planetId];
        if (planetRef.owner == address(0)) revert NoPlanet();
        if (planetRef.owner != msg.sender) revert NotPlanetOwner();
    }

    function _requireShips(uint256 planetId, Ship ship, uint32 quantity) private view {
        uint32 available = _shipCounts[planetId][ship];
        if (available < quantity) revert InsufficientShips(ship, available, quantity);
    }

    function _requireMissionShips(uint256 planetId, MissionShips calldata ships) private view {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 quantity = _missionShipQuantity(ships, ship);
            if (quantity != 0) _requireShips(planetId, ship, quantity);
            unchecked {
                ++i;
            }
        }
    }

    function _debitMissionShips(uint256 planetId, MissionShips calldata ships) private {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            _debitPlanetShips(planetId, ship, _missionShipQuantity(ships, ship));
            unchecked {
                ++i;
            }
        }
    }

    function _missionMovement(address player, MissionShips calldata ships)
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
