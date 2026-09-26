// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ProductionOrder, Defense, Ship} from "./VeydriftTypes.sol";
import {VeydriftMoonShipBacklog} from "./VeydriftMoonShipBacklog.sol";
import {VeydriftMoonDefenseBacklog} from "./VeydriftMoonDefenseBacklog.sol";

/// @notice Typed, bounded MoonSystem self-delegation preserves the original acting player.
library VeydriftMoonProductionBatch {
    error InvalidQuantity();
    uint8 private constant MAX_ORDERS = 15;
    uint8 private constant MAX_BACKLOG = 16;

    function execute(uint256 planetId, ProductionOrder[] calldata orders) public {
        if (orders.length == 0 || orders.length > MAX_ORDERS) {
            revert InvalidQuantity();
        }
        for (uint256 i; i < orders.length; ++i) {
            ProductionOrder calldata order = orders[i];
            if (order.quantity == 0) revert InvalidQuantity();
            bytes memory data;
            if (order.kind == 0 && order.itemId <= uint8(Ship.Crawler)) {
                data = abi.encodeWithSelector(
                    bytes4(keccak256("startMoonShipProduction(uint256,uint8,uint32)")),
                    planetId,
                    Ship(order.itemId),
                    order.quantity
                );
            } else if (order.kind == 1 && order.itemId <= uint8(Defense.InterplanetaryMissile)) {
                data = abi.encodeWithSelector(
                    bytes4(keccak256("startMoonDefenseProduction(uint256,uint8,uint32)")),
                    planetId,
                    Defense(order.itemId),
                    order.quantity
                );
            } else {
                revert InvalidQuantity();
            }
            (bool ok, bytes memory reason) = address(this).delegatecall(data);
            if (!ok) assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
            if (order.kind == 0 && VeydriftMoonShipBacklog.backlogLength(planetId) > MAX_BACKLOG) {
                revert InvalidQuantity();
            }
            if (
                order.kind == 1 && VeydriftMoonDefenseBacklog.entries(planetId).length > MAX_BACKLOG
            ) {
                revert InvalidQuantity();
            }
        }
    }
}
