// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftFleetFuel} from "./libraries/VeydriftFleetFuel.sol";
import {Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IVeydriftAcsAttackProtection {
    function enforceBodyAttackProtection(address attacker, uint256 planetId, bool targetIsMoon)
        external
        view;
}

/// @notice Delegatecall target for joining an outbound ACS attack from either a planet or moon.
/// @dev Kept separate from the size-constrained gameplay module. The legacy planet-only selector
///      remains available while `joinBodyAttackMission` adds explicit origin-body attribution.
contract VeydriftAcsAttackModule is VeydriftResourceReserves {
    using SafeCast for uint256;

    struct AcsJoinTiming {
        uint128 fuelCost;
        uint64 departureAt;
        uint64 returnAt;
    }

    constructor() VeydriftResourceReserves(address(0)) {}

    function joinAttackMission(
        uint256 originPlanetId,
        uint256 attackMissionId,
        uint256 expectedTargetPlanetId,
        MissionShips calldata ships,
        Resources calldata cargo
    ) external returns (uint256 missionId) {
        return _joinBodyAttackMission(
            originPlanetId, attackMissionId, expectedTargetPlanetId, ships, cargo, false
        );
    }

    function joinBodyAttackMission(
        uint256 originPlanetId,
        uint256 attackMissionId,
        uint256 expectedTargetPlanetId,
        MissionShips calldata ships,
        Resources calldata cargo,
        bool originIsMoon
    ) external returns (uint256 missionId) {
        return _joinBodyAttackMission(
            originPlanetId, attackMissionId, expectedTargetPlanetId, ships, cargo, originIsMoon
        );
    }

    function _joinBodyAttackMission(
        uint256 originPlanetId,
        uint256 attackMissionId,
        uint256 expectedTargetPlanetId,
        MissionShips calldata ships,
        Resources calldata cargo,
        bool originIsMoon
    ) private returns (uint256 missionId) {
        FleetMission storage attack = _requireJoinableAttack(
            originPlanetId, attackMissionId, expectedTargetPlanetId, originIsMoon
        );
        AcsJoinTiming memory timing =
            _prepareJoinFleet(originPlanetId, originIsMoon, ships, cargo, attack);
        return _recordJoinedMission(
            originPlanetId, attackMissionId, originIsMoon, ships, cargo, attack, timing
        );
    }

    function _requireJoinableAttack(
        uint256 originPlanetId,
        uint256 attackMissionId,
        uint256 expectedTargetPlanetId,
        bool originIsMoon
    ) private returns (FleetMission storage attack) {
        _requireOwnedBody(originPlanetId, originIsMoon);
        attack = _fleetMissions[attackMissionId];
        if (
            attack.status != FleetMissionStatus.Outbound
                || attack.missionType != FleetMissionType.Attack
        ) {
            revert InvalidMissionType(FleetMissionType.AcsAttack);
        }
        if (attack.targetPlanetId != expectedTargetPlanetId) revert InvalidId();

        _settleDueColonizeArrivals(msg.sender);
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlanet(originPlanetId);
        _requireNoPendingMissionResolutionForPlanet(attack.targetPlanetId);

        uint64 cutoffAt =
            attack.arrivalAt - VeydriftAntiRaidPrimitives.ACS_DEFEND_JOIN_CUTOFF_SECONDS;
        if (_currentTimestamp() >= cutoffAt) revert AttackJoinCutoffPassed(cutoffAt);
        _requireAttackTargetBody(attack.targetPlanetId, attack.targetIsMoon);
        if (
            attack.targetIsMoon
                && !_missionMoonExistsForOwner(
                    attackMissionId,
                    attack.targetPlanetId,
                    _planets[attack.targetPlanetId].owner,
                    false
                )
        ) revert InvalidId();
        IVeydriftAcsAttackProtection(address(this))
            .enforceBodyAttackProtection(msg.sender, attack.targetPlanetId, attack.targetIsMoon);
    }

    function _prepareJoinFleet(
        uint256 originPlanetId,
        bool originIsMoon,
        MissionShips calldata ships,
        Resources calldata cargo,
        FleetMission storage attack
    ) private returns (AcsJoinTiming memory timing) {
        uint256 fleetSlots = VeydriftAntiRaidPrimitives.fleetSlotLimit(
            _technologyLevels[msg.sender][Technology.Computer]
        );
        if (activeFleetMissionCount[msg.sender] >= fleetSlots) {
            revert FleetSlotLimitReached(fleetSlots);
        }

        (uint256 capacity, uint256 slowestSpeed) = _missionMovement(msg.sender, ships);
        if (capacity == 0) revert InvalidQuantity();
        _requireBodyMissionShips(originPlanetId, originIsMoon, ships);
        if (!originIsMoon) _settleActionPlanet(originPlanetId);

        uint256 travelDistance = originPlanetId == attack.targetPlanetId
            ? 5
            : _planetDistance(originPlanetId, attack.targetPlanetId);
        timing.fuelCost = _toUint128(
            VeydriftFleetFuel.ogameMissionFuelCost(
                ships,
                _technologyLevels[msg.sender][Technology.CombustionDrive],
                _technologyLevels[msg.sender][Technology.ImpulseDrive],
                _technologyLevels[msg.sender][Technology.HyperspaceDrive],
                travelDistance,
                VeydriftAntiRaidPrimitives.FULL_MISSION_SPEED_PERCENT,
                slowestSpeed
            )
        );
        timing.departureAt = _currentTimestamp();
        uint256 travelSeconds = VeydriftAntiRaidPrimitives.travelSeconds(
            travelDistance,
            slowestSpeed,
            VeydriftAntiRaidPrimitives.FULL_MISSION_SPEED_PERCENT,
            FLEET_UNIVERSE_SPEED
        );
        uint64 naturalArrivalAt = (uint256(timing.departureAt) + travelSeconds).toUint64();
        if (naturalArrivalAt > attack.arrivalAt) revert FleetAlreadyArrived();

        uint256 cargoTotal = uint256(cargo.metal) + cargo.crystal + cargo.deuterium;
        uint256 committedCapacity = cargoTotal + timing.fuelCost;
        if (committedCapacity > capacity) {
            revert CargoCapacityExceeded(capacity, committedCapacity);
        }

        _spendBodyResources(
            originPlanetId,
            originIsMoon,
            Resources({
                metal: cargo.metal,
                crystal: cargo.crystal,
                deuterium: _toUint128(uint256(cargo.deuterium) + timing.fuelCost)
            })
        );
        _increaseInternalResources(cargo);
        _debitBodyMissionShips(originPlanetId, originIsMoon, ships);

        timing.returnAt = (uint256(attack.arrivalAt) + travelSeconds).toUint64();
    }

    function _recordJoinedMission(
        uint256 originPlanetId,
        uint256 attackMissionId,
        bool originIsMoon,
        MissionShips calldata ships,
        Resources calldata cargo,
        FleetMission storage attack,
        AcsJoinTiming memory timing
    ) private returns (uint256 missionId) {
        missionId = nextFleetId++;
        activeFleetMissionCount[msg.sender] += 1;
        _fleetMissions[missionId] = FleetMission({
            status: FleetMissionStatus.Outbound,
            missionType: FleetMissionType.AcsAttack,
            owner: msg.sender,
            originPlanetId: originPlanetId,
            targetPlanetId: attack.targetPlanetId,
            departureAt: timing.departureAt,
            arrivalAt: attack.arrivalAt,
            returnAt: timing.returnAt,
            fuelCost: timing.fuelCost,
            cargo: cargo,
            ships: ships,
            randomnessRequestId: attackMissionId,
            lootRatio: LootRatio({metalBps: 0, crystalBps: 0, deuteriumBps: 0}),
            originIsMoon: originIsMoon,
            targetIsMoon: attack.targetIsMoon
        });
        _recordMissionMoonIncarnations(
            missionId, originPlanetId, attack.targetPlanetId, originIsMoon, attack.targetIsMoon
        );
        _fleetCounterplayMissions[attackMissionId].push(missionId);
        _trackCounterplayMissionResolution(attackMissionId, _fleetMissions[missionId]);

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
            timing.returnAt,
            attackMissionId
        );
        emit FleetMissionCargo(
            missionId, cargo.metal, cargo.crystal, cargo.deuterium, timing.fuelCost
        );
        emit FleetMissionBodies(missionId, originIsMoon, attack.targetIsMoon);
        _emitFleetMissionShips(missionId, ships);
    }

    function _requireOwnedBody(uint256 planetId, bool isMoon) private view {
        address owner_ = _planets[planetId].owner;
        if (owner_ == address(0)) revert NoPlanet();
        if (owner_ != msg.sender) revert NotPlanetOwner();
        if (isMoon && !_moonExistsForOwner(planetId, owner_)) revert NoPlanet();
    }

    function _requireAttackTargetBody(uint256 planetId, bool isMoon) private view {
        address owner_ = _planets[planetId].owner;
        if (owner_ == address(0)) revert NoPlanet();
        if (isMoon && !_moonExistsForOwner(planetId, owner_)) revert NoPlanet();
    }

    function _moonExistsForOwner(uint256 planetId, address owner_) private view returns (bool) {
        (bool ok, bytes memory data) =
            _moonSystem.staticcall(abi.encodeWithSignature("moon(uint256)", planetId));
        if (!ok || data.length < 96) return false;
        (bool exists,, address moonOwner,,,,) =
            abi.decode(data, (bool, uint256, address, uint16, uint16, uint64, uint64));
        return exists && moonOwner == owner_;
    }

    function _requireBodyMissionShips(uint256 planetId, bool isMoon, MissionShips calldata ships)
        private
        view
    {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 quantity = _missionShipQuantity(ships, ship);
            uint32 available =
                isMoon ? _moonShipCounts[planetId][ship] : _shipCounts[planetId][ship];
            if (available < quantity) revert InsufficientShips(ship, available, quantity);
            unchecked {
                ++i;
            }
        }
    }

    function _debitBodyMissionShips(uint256 planetId, bool isMoon, MissionShips calldata ships)
        private
    {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 quantity = _missionShipQuantity(ships, ship);
            if (isMoon) {
                if (quantity != 0) _debitMoonShips(planetId, ship, quantity);
            } else {
                _debitPlanetShips(planetId, ship, quantity);
            }
            unchecked {
                ++i;
            }
        }
    }

    function _missionMovement(address player, MissionShips calldata ships)
        private
        view
        returns (uint256 capacity, uint256 slowestSpeed)
    {
        MissionShips memory missionShips = ships;
        return VeydriftFleetFuel.missionMovement(
            missionShips,
            _technologyLevels[player][Technology.CombustionDrive],
            _technologyLevels[player][Technology.ImpulseDrive],
            _technologyLevels[player][Technology.HyperspaceDrive]
        );
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
        uint256 galaxyDistance = _absoluteDifference(origin.galaxy, destination.galaxy);
        if (galaxyDistance != 0) return galaxyDistance * 20_000;
        uint256 systemDistance = _absoluteDifference(origin.system, destination.system);
        if (systemDistance != 0) return 2_700 + systemDistance * 95;
        uint256 positionDistance = _absoluteDifference(origin.position, destination.position);
        if (positionDistance != 0) return 1_000 + positionDistance * 5;
        return 0;
    }

    function _spendBodyResources(uint256 planetId, bool isMoon, Resources memory cost) private {
        Resources storage available;
        if (isMoon) {
            available = _moonResources[planetId];
        } else {
            _settleActionPlanet(planetId);
            available = _planets[planetId].resources;
        }
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
        if (isMoon) {
            _emitMoonResourcesChanged(planetId);
        } else {
            _emitPlanetSettled(planetId);
        }
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

    function _absoluteDifference(uint256 left, uint256 right) private pure returns (uint256) {
        return left > right ? left - right : right - left;
    }

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}
