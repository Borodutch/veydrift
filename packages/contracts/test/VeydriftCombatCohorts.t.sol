// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CombatCohort, VeydriftCombatCohorts} from "../src/libraries/VeydriftCombatCohorts.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {Ship} from "../src/libraries/VeydriftTypes.sol";

contract VeydriftCombatCohortsTest is Test {
    function unit(Ship ship, uint256 count, uint16 weapons, uint16 shielding, uint16 armor)
        private
        pure
        returns (CombatCohort memory c)
    {
        c.unit = uint8(ship);
        c.count = count;
        c.attack = VeydriftCatalog.shipBattleAttack(ship) * (10 + uint256(weapons)) / 10;
        c.shield = VeydriftCatalog.shipBattleShield(ship) * (10 + uint256(shielding)) / 10;
        c.hull = VeydriftCatalog.shipBattleHull(ship) * (10 + uint256(armor)) / 10;
        c.key = VeydriftCombatCohorts.key(c.unit, c.attack, c.shield, c.hull);
    }

    function testFiringAndSurvivalUseExactOwnerStats() public pure {
        CombatCohort memory weak = unit(Ship.Cruiser, 100, 8, 8, 8);
        CombatCohort memory strong = unit(Ship.Cruiser, 100, 10, 9, 10);
        // These are hand-derived survivability boundaries, independent of RNG and
        // catalog attack matchup: a hit above weak hull+shield, below strong's.
        uint256 attack = weak.shield + weak.hull;
        assertEq(VeydriftCombatCohorts.lossCount(weak, 100, attack, 7, 1, 4, 9), 100);
        assertLt(VeydriftCombatCohorts.lossCount(strong, 100, attack, 7, 1, 4, 9), 100);
        // Below 1% shield threshold cannot damage the owner's cohort.
        assertEq(VeydriftCombatCohorts.lossCount(strong, 10000, strong.shield / 100, 7, 1, 4, 9), 0);
    }
}
