// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ProductionOrder, Defense, Ship} from "./VeydriftTypes.sol";
import {VeydriftMoonShipBacklog} from "./VeydriftMoonShipBacklog.sol";

/// @notice Typed, bounded MoonSystem self-delegation preserves the original acting player.
library VeydriftMoonProductionBatch {
    error InvalidQuantity();
    uint8 private constant MAX_ORDERS = 4;
    uint8 private constant MAX_BACKLOG = 16;

    function execute(
        uint256 planetId,
        ProductionOrder[] calldata orders,
        uint256 defenseBacklogLength
    ) public {
        if (orders.length == 0 || orders.length > MAX_ORDERS) {
            revert InvalidQuantity();
        }
        for (uint256 i; i < orders.length; ++i) {
            ProductionOrder calldata order = orders[i];
            if (order.quantity == 0) revert InvalidQuantity();
            bytes memory data;
            if (order.kind == 0 && order.itemId <= uint8(Ship.Crawler)) {
                if (VeydriftMoonShipBacklog.backlogLength(planetId) >= MAX_BACKLOG) {
                    revert InvalidQuantity();
                }
                data = abi.encodeWithSelector(
                    bytes4(keccak256("startMoonShipProduction(uint256,uint8,uint32)")),
                    planetId,
                    Ship(order.itemId),
                    order.quantity
                );
            } else if (order.kind == 1 && order.itemId <= uint8(Defense.InterplanetaryMissile)) {
                if (defenseBacklogLength >= MAX_BACKLOG) revert InvalidQuantity();
                data = abi.encodeWithSelector(
                    bytes4(keccak256("startMoonDefenseProduction(uint256,uint8,uint32)")),
                    planetId,
                    Defense(order.itemId),
                    order.quantity
                );
                if (defenseBacklogLength < MAX_BACKLOG) ++defenseBacklogLength;
            } else {
                revert InvalidQuantity();
            }
            (bool ok, bytes memory reason) = address(this).delegatecall(data);
            if (!ok) assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
        }
    }
}
