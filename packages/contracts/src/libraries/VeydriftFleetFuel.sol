// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage} from "../VeydriftGameStorage.sol";
import {VeydriftAntiRaidPrimitives} from "./VeydriftAntiRaidPrimitives.sol";
import {VeydriftCatalog} from "./VeydriftCatalog.sol";
import {Ship} from "./VeydriftTypes.sol";

library VeydriftFleetFuel {
    function missionMovement(
        VeydriftGameStorage.MissionShips memory ships,
        uint16 combustionDrive,
        uint16 impulseDrive,
        uint16 hyperspaceDrive
    ) public pure returns (uint256 capacity, uint256 slowestSpeed) {
        slowestSpeed = type(uint256).max;
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 quantity = _missionShipQuantity(ships, ship);
            if (quantity != 0) {
                (uint256 cargoCapacity,, uint256 speed) = VeydriftCatalog.shipMovementStats(
                    ship, combustionDrive, impulseDrive, hyperspaceDrive
                );
                unchecked {
                    capacity += uint256(quantity) * cargoCapacity;
                }
                if (speed < slowestSpeed) slowestSpeed = speed;
            }
            unchecked {
                ++i;
            }
        }
        if (slowestSpeed == type(uint256).max) slowestSpeed = 0;
    }

    function ogameMissionFuelCost(
        VeydriftGameStorage.MissionShips memory ships,
        uint16 combustionDrive,
        uint16 impulseDrive,
        uint16 hyperspaceDrive,
        uint256 distance,
        uint16 speedPercent,
        uint256 slowestSpeed
    ) public pure returns (uint256) {
        uint256 numerator;
        bool hasFuel;
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 quantity = _missionShipQuantity(ships, ship);
            if (quantity != 0) {
                (, uint256 fuel, uint256 speed) = VeydriftCatalog.shipMovementStats(
                    ship, combustionDrive, impulseDrive, hyperspaceDrive
                );
                if (fuel != 0) {
                    hasFuel = true;
                    numerator += VeydriftAntiRaidPrimitives.ogameFuelNumerator(
                        fuel, quantity, distance, speed, slowestSpeed, speedPercent
                    );
                }
            }
            unchecked {
                ++i;
            }
        }
        return VeydriftAntiRaidPrimitives.ogameFuelCostFromNumerator(numerator, hasFuel);
    }

    function _missionShipQuantity(VeydriftGameStorage.MissionShips memory ships, Ship ship)
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
