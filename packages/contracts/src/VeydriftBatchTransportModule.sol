// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {Technology, Ship, Defense, ProductionOrder} from "./libraries/VeydriftTypes.sol";

/// @notice Bounded, atomic multi-origin transport entrypoint for the Game proxy.
/// @dev This module deliberately re-enters the proxy through its canonical single-mission selector
///      with `delegatecall`. That retains the original player as `msg.sender` and gives every child
///      exactly the same settlement, ship, fuel, resolution, and event semantics as a normal launch.
contract VeydriftBatchTransportModule is VeydriftResourceReserves {
    uint8 private constant MAX_TRANSPORT_BATCH_ORDERS = 15;
    uint8 private constant MAX_PRODUCTION_ORDERS = 4;
    uint8 private constant MAX_PRODUCTION_BACKLOG = 16;
    bytes4 private constant LAUNCH_FLEET_MISSION_SELECTOR = bytes4(
        keccak256(
            "launchFleetMission(uint256,uint256,uint8,(uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32),(uint128,uint128,uint128),uint16,uint256)"
        )
    );

    constructor() VeydriftResourceReserves(address(0)) {}

    /// @notice Typed production on one planet, preserving sender and the exact single-action gates.
    function startProductionBatch(uint256 planetId, ProductionOrder[] calldata orders) external {
        if (orders.length == 0 || orders.length > MAX_PRODUCTION_ORDERS) revert InvalidQuantity();
        for (uint256 i; i < orders.length; ++i) {
            ProductionOrder calldata order = orders[i];
            if (order.quantity == 0) revert InvalidQuantity();
            bytes memory data;
            if (order.kind == 0 && order.itemId <= uint8(Ship.Crawler)) {
                if (_shipQueueBacklogs[planetId].length >= MAX_PRODUCTION_BACKLOG) {
                    revert InvalidQuantity();
                }
                data = abi.encodeWithSelector(
                    bytes4(keccak256("startShipProduction(uint256,uint8,uint32)")),
                    planetId,
                    Ship(order.itemId),
                    order.quantity
                );
            } else if (order.kind == 1 && order.itemId <= uint8(Defense.InterplanetaryMissile)) {
                if (_defenseQueueBacklogs[planetId].length >= MAX_PRODUCTION_BACKLOG) {
                    revert InvalidQuantity();
                }
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
