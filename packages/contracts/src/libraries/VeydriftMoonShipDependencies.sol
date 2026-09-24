// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftDependencies} from "./VeydriftDependencies.sol";
import {Ship, Technology} from "./VeydriftTypes.sol";

interface IVeydriftMoonShipTechnology {
    function technologyLevel(address player, Technology technology) external view returns (uint16);
}

/// @notice Moon shipyard uses the same exact ship research gates as planetary production.
library VeydriftMoonShipDependencies {
    function requireShip(address game, address player, Ship ship, uint16 shipyard) public view {
        IVeydriftMoonShipTechnology research = IVeydriftMoonShipTechnology(game);
        VeydriftDependencies.requireShip(
            ship,
            shipyard,
            research.technologyLevel(player, Technology.CombustionDrive),
            research.technologyLevel(player, Technology.ImpulseDrive),
            research.technologyLevel(player, Technology.HyperspaceDrive),
            research.technologyLevel(player, Technology.Hyperspace),
            research.technologyLevel(player, Technology.Graviton),
            research.technologyLevel(player, Technology.Energy),
            research.technologyLevel(player, Technology.Laser),
            research.technologyLevel(player, Technology.Ion),
            research.technologyLevel(player, Technology.Shielding),
            research.technologyLevel(player, Technology.Armor),
            research.technologyLevel(player, Technology.Plasma)
        );
    }
}
