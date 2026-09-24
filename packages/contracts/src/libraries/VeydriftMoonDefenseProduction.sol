// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage} from "../VeydriftGameStorage.sol";
import {VeydriftCatalog} from "./VeydriftCatalog.sol";
import {VeydriftDependencies} from "./VeydriftDependencies.sol";
import {VeydriftFormulas} from "./VeydriftFormulas.sol";
import {VeydriftMoonDefenseBacklog} from "./VeydriftMoonDefenseBacklog.sol";
import {Defense, Technology} from "./VeydriftTypes.sol";

interface IVeydriftMoonDefenseProductionGame {
    function moonResources(uint256 planetId)
        external
        view
        returns (VeydriftGameStorage.Resources memory);
    function spendMoonResources(uint256 planetId, VeydriftGameStorage.Resources calldata cost)
        external;
    function technologyLevel(address player, Technology technology) external view returns (uint16);
}

/// @notice Canonical moon defense enqueue, extracted to keep the UUPS runtime below EIP-170.
/// @dev MoonSystem verifies owner, pause, pending battle and due queues before entering.
library VeydriftMoonDefenseProduction {
    error InvalidQuantity();
    event MoonResourcesSettled(
        uint256 indexed planetId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium,
        uint64 settledAt
    );

    function start(
        mapping(uint256 planetId => VeydriftMoonDefenseBacklog.Entry queue) storage activeQueues,
        mapping(uint256 planetId => mapping(Defense defense => uint32 count)) storage counts,
        address game,
        address player,
        uint256 planetId,
        uint16 shipyard,
        Defense defense,
        uint32 quantity,
        uint64 nowAt
    ) public {
        if (quantity == 0) revert InvalidQuantity();
        IVeydriftMoonDefenseProductionGame inventory = IVeydriftMoonDefenseProductionGame(game);
        VeydriftDependencies.requireDefense(
            defense,
            shipyard,
            0,
            inventory.technologyLevel(player, Technology.Energy),
            inventory.technologyLevel(player, Technology.Laser),
            inventory.technologyLevel(player, Technology.Ion),
            inventory.technologyLevel(player, Technology.Weapons),
            inventory.technologyLevel(player, Technology.Shielding),
            inventory.technologyLevel(player, Technology.ImpulseDrive),
            inventory.technologyLevel(player, Technology.Plasma)
        );
        VeydriftMoonDefenseBacklog.requireCapacity(
            activeQueues, counts, planetId, defense, quantity
        );
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.defenseCost(defense);
        VeydriftGameStorage.Resources memory unitCost =
            VeydriftGameStorage.Resources(metal, crystal, deuterium);
        VeydriftGameStorage.Resources memory totalCost =
            VeydriftMoonDefenseBacklog.multiply(unitCost, quantity);
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
        VeydriftMoonDefenseBacklog.enqueue(
            activeQueues,
            planetId,
            defense,
            quantity,
            VeydriftFormulas.unitDuration(shipyard, 0, metal, crystal, deuterium, quantity, 1, 1),
            nowAt,
            totalCost
        );
    }
}
