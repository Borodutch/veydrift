// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage} from "../VeydriftGameStorage.sol";
import {VeydriftCatalog} from "./VeydriftCatalog.sol";
import {VeydriftMoonDefenseBacklog} from "./VeydriftMoonDefenseBacklog.sol";
import {VeydriftMoonShipBacklog} from "./VeydriftMoonShipBacklog.sol";
import {VeydriftMoonShipDependencies} from "./VeydriftMoonShipDependencies.sol";
import {Ship} from "./VeydriftTypes.sol";

interface IVeydriftMoonShipProductionGame {
    function moonResources(uint256 planetId)
        external
        view
        returns (VeydriftGameStorage.Resources memory);
    function spendMoonResources(uint256 planetId, VeydriftGameStorage.Resources calldata cost)
        external;
}

/// @notice Moon-only ship costs, prerequisite gates and queue enqueue live outside size-bound proxy.
/// @dev Called by MoonSystem only after ownership, pause, pending-combat and settlement checks.
library VeydriftMoonShipProduction {
    error InvalidQuantity();
    event MoonResourcesSettled(
        uint256 indexed planetId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium,
        uint64 settledAt
    );

    function start(
        address game,
        address player,
        uint256 planetId,
        uint16 shipyard,
        Ship ship,
        uint32 quantity,
        uint64 nowAt
    ) public {
        if (
            quantity == 0 || ship == Ship.SolarSatellite || ship == Ship.Crawler
                || ship == Ship.Pathfinder
        ) revert InvalidQuantity();
        VeydriftMoonShipDependencies.requireShip(game, player, ship, shipyard);
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(ship);
        VeydriftGameStorage.Resources memory unitCost =
            VeydriftGameStorage.Resources(metal, crystal, deuterium);
        VeydriftGameStorage.Resources memory totalCost =
            VeydriftMoonDefenseBacklog.multiply(unitCost, quantity);
        IVeydriftMoonShipProductionGame inventory = IVeydriftMoonShipProductionGame(game);
        VeydriftGameStorage.Resources memory available = inventory.moonResources(planetId);
        if (
            available.metal < totalCost.metal || available.crystal < totalCost.crystal
                || available.deuterium < totalCost.deuterium
        ) {
            revert VeydriftGameStorage.InsufficientResources(
                available.metal, available.crystal, available.deuterium
            );
        }
        inventory.spendMoonResources(planetId, totalCost);
        available = inventory.moonResources(planetId);
        emit MoonResourcesSettled(
            planetId, available.metal, available.crystal, available.deuterium, nowAt
        );
        VeydriftMoonShipBacklog.enqueue(
            planetId, ship, quantity, nowAt, unitCost, totalCost, 2500 * (uint256(shipyard) + 1)
        );
    }
}
