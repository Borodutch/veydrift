// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {Technology, Ship, Defense, ProductionOrder} from "./libraries/VeydriftTypes.sol";

interface IVeydriftMoonArrivalResolver {
    function resolveFleetMission(uint256 missionId) external;
    function launchInterplanetaryMissileAttack(uint256, uint256, Defense, uint32)
        external
        returns (uint256);
}

/// @notice Bounded, atomic multi-origin transport entrypoint for the Game proxy.
/// @dev This module deliberately re-enters the proxy through its canonical single-mission selector
///      with `delegatecall`. That retains the original player as `msg.sender` and gives every child
///      exactly the same settlement, ship, fuel, resolution, and event semantics as a normal launch.
contract VeydriftBatchTransportModule is VeydriftResourceReserves {
    uint8 private constant MAX_TRANSPORT_BATCH_ORDERS = 15;
    uint8 private constant MAX_PRODUCTION_ORDERS = 15;
    uint8 private constant MAX_PRODUCTION_BACKLOG = 16;
    bytes4 private constant LAUNCH_FLEET_MISSION_SELECTOR = bytes4(
        keccak256(
            "launchFleetMission(uint256,uint256,uint8,(uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32),(uint128,uint128,uint128),uint16,uint256)"
        )
    );

    constructor() VeydriftResourceReserves(address(0)) {}

    /// @dev The pre-existing bounded arrival index also covers ordinary attacks, but its missile
    ///      helper intentionally permits attack/attack reversal. Moon manufacturing cannot: once
    ///      a later cutoff credits ships, an earlier battle cannot reconstruct historical inventory.
    function prepareMoonAttackArrival(uint256 missionId) external returns (bool) {
        FleetMission storage mission = _fleetMissions[missionId];
        // A planet-only fight cannot affect Moon manufacturing without a live Moon queue.
        if (!mission.targetIsMoon && !_hasMoonShipQueue(mission.targetPlanetId)) return true;
        if (
            IVeydriftMoonArrivalResolver(address(this))
                    .launchInterplanetaryMissileAttack(
                        missionId, mission.targetPlanetId, Defense.RocketLauncher, 0
                    ) == 0
        ) return false;
        uint256 earliest = _arrivalOrderIndexByPlanet[mission.targetPlanetId].headMissionId;
        if (earliest != 0 && earliest != missionId) {
            uint64 earlierAt = _fleetMissions[earliest].arrivalAt;
            if (
                earlierAt < mission.arrivalAt
                    || (earlierAt == mission.arrivalAt && earliest < missionId)
            ) {
                revert FleetMissionNotResolved(earlierAt);
            }
        }
        return true;
    }

    /// @dev Resolve all due arrivals in impact order before the existing lazy resolver iterates
    ///      its mission-id snapshot. Earlier transports/deploys must land before a later battle.
    ///      Heap ordering bounds sorting to O(n log n); unseeded attacks stay pending.
    function settleDuePlayerCombatArrivals(address player) external {
        uint256[] memory ids = _resolutionMissionIdsByPlayer[player];
        uint256 count;
        uint64 nowAt = uint64(block.timestamp);
        bool moonOrderingRequired;
        for (uint256 i; i < ids.length; ++i) {
            FleetMission storage mission = _fleetMissions[ids[i]];
            if (
                mission.status == FleetMissionStatus.Outbound
                    && mission.missionType == FleetMissionType.Attack && mission.arrivalAt <= nowAt
                    && (mission.targetIsMoon || _hasMoonShipQueue(mission.targetPlanetId))
            ) {
                moonOrderingRequired = true;
                break;
            }
        }
        if (!moonOrderingRequired) return;
        for (uint256 i; i < ids.length; ++i) {
            FleetMission storage mission = _fleetMissions[ids[i]];
            if (
                mission.status == FleetMissionStatus.Outbound
                    && (mission.missionType == FleetMissionType.Transport
                        || mission.missionType == FleetMissionType.Deploy
                        || mission.missionType == FleetMissionType.Attack
                        || mission.missionType == FleetMissionType.Harvest
                        || mission.missionType == FleetMissionType.MissileAttack)
                    && mission.arrivalAt <= nowAt
            ) ids[count++] = ids[i];
        }
        for (uint256 start = count / 2; start > 0;) {
            _siftLaterArrival(ids, --start, count);
        }
        for (uint256 end = count; end > 1;) {
            --end;
            (ids[0], ids[end]) = (ids[end], ids[0]);
            _siftLaterArrival(ids, 0, end);
        }
        for (uint256 i; i < count; ++i) {
            try IVeydriftMoonArrivalResolver(address(this)).resolveFleetMission(ids[i]) {} catch {}
        }
    }

    function _siftLaterArrival(uint256[] memory ids, uint256 root, uint256 end) private view {
        while (root * 2 + 1 < end) {
            uint256 child = root * 2 + 1;
            if (child + 1 < end && _arrivalEarlier(ids[child], ids[child + 1])) ++child;
            if (!_arrivalEarlier(ids[root], ids[child])) break;
            (ids[root], ids[child]) = (ids[child], ids[root]);
            root = child;
        }
    }

    function _arrivalEarlier(uint256 a, uint256 b) private view returns (bool) {
        uint64 first = _fleetMissions[a].arrivalAt;
        uint64 second = _fleetMissions[b].arrivalAt;
        return first < second || (first == second && a < b);
    }

    function _hasMoonShipQueue(uint256 planetId) private view returns (bool) {
        if (_moonSystem == address(0)) return false;
        (bool ok, bytes memory active) = _moonSystem.staticcall(
            abi.encodeWithSignature("activeMoonShipQueue(uint256)", planetId)
        );
        if (!ok || active.length < 32) return false;
        uint256 activeFlag;
        assembly ("memory-safe") { activeFlag := mload(add(active, 32)) }
        return activeFlag != 0;
    }

    /// @notice Typed production on one planet, preserving sender and the exact single-action gates.
    function startProductionBatch(uint256 planetId, ProductionOrder[] calldata orders) external {
        if (orders.length == 0 || orders.length > MAX_PRODUCTION_ORDERS) revert InvalidQuantity();
        for (uint256 i; i < orders.length; ++i) {
            ProductionOrder calldata order = orders[i];
            if (order.quantity == 0) revert InvalidQuantity();
            bytes memory data;
            if (order.kind == 0 && order.itemId <= uint8(Ship.Crawler)) {
                data = abi.encodeWithSelector(
                    bytes4(keccak256("startShipProduction(uint256,uint8,uint32)")),
                    planetId,
                    Ship(order.itemId),
                    order.quantity
                );
            } else if (order.kind == 1 && order.itemId <= uint8(Defense.InterplanetaryMissile)) {
                data = abi.encodeWithSelector(
                    bytes4(keccak256("startDefenseProduction(uint256,uint8,uint32)")),
                    planetId,
                    Defense(order.itemId),
                    order.quantity
                );
            } else {
                revert InvalidId();
            }
            (bool ok, bytes memory reason) = address(this).delegatecall(data);
            if (!ok) assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
            // Children settle ready entries before enqueueing. Check the actual resulting backlog;
            // a stale precheck would reject affordable orders behind a fully ready queue.
            if (order.kind == 0 && _shipQueueBacklogs[planetId].length > MAX_PRODUCTION_BACKLOG) {
                revert InvalidQuantity();
            }
            if (order.kind == 1 && _defenseQueueBacklogs[planetId].length > MAX_PRODUCTION_BACKLOG)
            {
                revert InvalidQuantity();
            }
        }
    }

    function launchTransportBatch(uint256 targetPlanetId, TransportBatchOrder[] calldata orders)
        external
        returns (uint256[] memory missionIds)
    {
        uint256 count = orders.length;
        if (count == 0 || count > MAX_TRANSPORT_BATCH_ORDERS) revert InvalidQuantity();

        Planet storage target = _planets[targetPlanetId];
        if (target.owner == address(0)) revert NoPlanet();
        if (target.owner != _actingPlayer()) revert NotPlanetOwner();

        uint256 fleetSlots = VeydriftAntiRaidPrimitives.fleetSlotLimit(
            _technologyLevels[_actingPlayer()][Technology.Computer]
        );
        if (activeFleetMissionCount[_actingPlayer()] + count > fleetSlots) {
            revert FleetSlotLimitReached(fleetSlots);
        }

        missionIds = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            TransportBatchOrder calldata order = orders[i];
            if (order.originPlanetId == targetPlanetId) revert SamePlanet();
            for (uint256 prior = 0; prior < i; ++prior) {
                if (orders[prior].originPlanetId == order.originPlanetId) revert InvalidQuantity();
            }

            bytes memory data = abi.encodeWithSelector(
                LAUNCH_FLEET_MISSION_SELECTOR,
                order.originPlanetId,
                targetPlanetId,
                FleetMissionType.Transport,
                order.ships,
                order.cargo,
                order.speedPercent,
                0
            );
            (bool ok, bytes memory result) = address(this).delegatecall(data);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(result, 32), mload(result))
                }
            }
            missionIds[i] = abi.decode(result, (uint256));
        }
    }
}
