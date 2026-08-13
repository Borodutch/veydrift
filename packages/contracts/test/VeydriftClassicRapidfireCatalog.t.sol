// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {Defense, Ship} from "../src/libraries/VeydriftTypes.sol";

/// @notice Pins the complete OGame-style rapidfire matrix used by Veydrift.
/// @dev The classic core is extended only for Veydrift's Reaper, Pathfinder, and Crawler.
///      Espionage Probe lanes are excluded because Veydrift does not implement that ship.
contract VeydriftClassicRapidfireCatalogTest is Test {
    function testClassicRapidfireMatrixMatchesEveryShipAndDefenseLane() public pure {
        uint256 shipLanes;
        uint256 defenseLanes;

        for (uint8 attacker; attacker < 16; ++attacker) {
            for (uint8 defender; defender < 16; ++defender) {
                uint16 expected = _expectedShipRapidfire(Ship(attacker), Ship(defender));
                uint16 actual =
                    VeydriftCatalog.shipRapidfireAgainstShip(Ship(attacker), Ship(defender));
                assertEq(actual, expected, "ship rapidfire matrix");
                if (actual > 1) ++shipLanes;
            }

            for (uint8 defender; defender < 8; ++defender) {
                uint16 expected = _expectedDefenseRapidfire(Ship(attacker), Defense(defender));
                uint16 actual =
                    VeydriftCatalog.shipRapidfireAgainstDefense(Ship(attacker), Defense(defender));
                assertEq(actual, expected, "defense rapidfire matrix");
                if (actual > 1) ++defenseLanes;
            }
        }

        assertEq(shipLanes, 56, "complete ship rapidfire lane count");
        assertEq(defenseLanes, 14, "complete defense rapidfire lane count");
    }

    function _expectedShipRapidfire(Ship attacker, Ship defender) private pure returns (uint16) {
        if (attacker == Ship.Deathstar) return _expectedDeathstarRapidfire(defender);
        if (_isMobile(attacker) && _isStationarySupport(defender)) return 5;

        if (attacker == Ship.HeavyFighter && defender == Ship.SmallCargo) return 3;
        if (attacker == Ship.Cruiser && defender == Ship.LightFighter) return 6;
        if (attacker == Ship.Battleship && defender == Ship.Pathfinder) return 5;
        if (attacker == Ship.Destroyer && defender == Ship.Battlecruiser) return 2;
        if (attacker == Ship.Battlecruiser && defender == Ship.SmallCargo) return 3;
        if (attacker == Ship.Battlecruiser && defender == Ship.LargeCargo) return 3;
        if (
            attacker == Ship.Battlecruiser
                && (defender == Ship.HeavyFighter || defender == Ship.Cruiser)
        ) return 4;
        if (attacker == Ship.Battlecruiser && defender == Ship.Battleship) return 7;
        if (attacker == Ship.Reaper && defender == Ship.Battleship) return 7;
        if (attacker == Ship.Reaper && defender == Ship.Bomber) return 4;
        if (attacker == Ship.Reaper && defender == Ship.Destroyer) return 3;
        if (attacker == Ship.Pathfinder && defender == Ship.LightFighter) return 3;
        if (attacker == Ship.Pathfinder && defender == Ship.HeavyFighter) return 2;
        if (attacker == Ship.Pathfinder && defender == Ship.Cruiser) return 3;
        return 1;
    }

    function _expectedDefenseRapidfire(Ship attacker, Defense defender)
        private
        pure
        returns (uint16)
    {
        if (attacker == Ship.Cruiser && defender == Defense.RocketLauncher) {
            return 10;
        }
        if (attacker == Ship.Bomber && defender == Defense.RocketLauncher) return 20;
        if (attacker == Ship.Bomber && defender == Defense.LightLaser) return 20;
        if (attacker == Ship.Bomber && defender == Defense.HeavyLaser) return 10;
        if (attacker == Ship.Bomber && defender == Defense.GaussCannon) return 5;
        if (attacker == Ship.Bomber && defender == Defense.IonCannon) return 10;
        if (attacker == Ship.Bomber && defender == Defense.PlasmaTurret) return 5;
        if (attacker == Ship.Destroyer && defender == Defense.LightLaser) return 10;
        if (attacker == Ship.Deathstar && defender == Defense.RocketLauncher) return 200;
        if (attacker == Ship.Deathstar && defender == Defense.LightLaser) return 200;
        if (attacker == Ship.Deathstar && defender == Defense.HeavyLaser) return 100;
        if (attacker == Ship.Deathstar && defender == Defense.GaussCannon) return 50;
        if (attacker == Ship.Deathstar && defender == Defense.IonCannon) return 100;
        if (attacker == Ship.Reaper && defender == Defense.IonCannon) return 2;
        return 1;
    }

    function _expectedDeathstarRapidfire(Ship defender) private pure returns (uint16) {
        if (
            defender == Ship.SmallCargo || defender == Ship.Recycler || defender == Ship.ColonyShip
                || defender == Ship.LargeCargo
        ) return 250;
        if (defender == Ship.LightFighter) return 200;
        if (defender == Ship.HeavyFighter) return 100;
        if (defender == Ship.Cruiser) return 33;
        if (defender == Ship.Battleship) return 30;
        if (defender == Ship.Bomber) return 25;
        if (defender == Ship.SolarSatellite || defender == Ship.Crawler) return 1_250;
        if (defender == Ship.Destroyer) return 5;
        if (defender == Ship.Battlecruiser) return 15;
        if (defender == Ship.Reaper) return 10;
        if (defender == Ship.Pathfinder) return 30;
        return 1;
    }

    function _isMobile(Ship ship) private pure returns (bool) {
        return ship != Ship.SolarSatellite && ship != Ship.Crawler && ship != Ship.Deathstar;
    }

    function _isStationarySupport(Ship ship) private pure returns (bool) {
        return ship == Ship.SolarSatellite || ship == Ship.Crawler;
    }
}
