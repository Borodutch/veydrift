// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage} from "../VeydriftGameStorage.sol";
import {Ship} from "./VeydriftTypes.sol";

interface IVeydriftMoonGateInventory {
    function moonShipCount(uint256 planetId, Ship ship) external view returns (uint32);
    function moveMoonGateShips(
        uint256 originPlanetId,
        uint256 destinationPlanetId,
        address owner,
        VeydriftGameStorage.MissionShips calldata ships
    ) external;
}

/// @notice Moon gate ship manifest validation; called after both owned gates are prepared.
library VeydriftMoonGateShips {
    error InvalidQuantity();

    function move(
        address game,
        uint256 originPlanetId,
        uint256 destinationPlanetId,
        address player,
        VeydriftGameStorage.MissionShips calldata ships
    ) public {
        IVeydriftMoonGateInventory inventory = IVeydriftMoonGateInventory(game);
        uint256 total;
        for (uint8 i; i <= uint8(Ship.Pathfinder); ++i) {
            Ship ship = Ship(i);
            if (ship == Ship.SolarSatellite) continue;
            uint32 quantity = _quantity(ships, ship);
            if (quantity == 0) continue;
            uint32 available = inventory.moonShipCount(originPlanetId, ship);
            if (available < quantity) {
                revert VeydriftGameStorage.InsufficientShips(ship, available, quantity);
            }
            total += quantity;
        }
        if (total == 0) revert InvalidQuantity();
        inventory.moveMoonGateShips(originPlanetId, destinationPlanetId, player, ships);
    }

    function _quantity(VeydriftGameStorage.MissionShips calldata ships, Ship ship)
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
}
