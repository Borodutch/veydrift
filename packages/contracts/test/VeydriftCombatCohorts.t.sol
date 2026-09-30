// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CombatCohort, VeydriftCombatCohorts} from "../src/libraries/VeydriftCombatCohorts.sol";
import {VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {Ship, Defense} from "../src/libraries/VeydriftTypes.sol";

contract VeydriftCombatCohortsTest is Test {
    VeydriftCombatRapidfire private math;

    function setUp() public {
        math = new VeydriftCombatRapidfire();
    }

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

    function composition(bool attack) private pure returns (CombatCohort[] memory c) {
        c = new CombatCohort[](3);
        c[0] = unit(attack ? Ship.Cruiser : Ship.LightFighter, 791, 8, 8, 8);
        c[1] = unit(attack ? Ship.Battlecruiser : Ship.SmallCargo, 317, 8, 8, 8);
        c[2] = unit(attack ? Ship.Bomber : Ship.Battleship, 41, 8, 8, 8);
    }

    function partition(CombatCohort[] memory c, uint256 groups, bool reverse)
        private
        pure
        returns (CombatCohort[] memory split)
    {
        split = new CombatCohort[](c.length * groups);
        for (uint256 i; i < c.length; ++i) {
            for (uint256 g; g < groups; ++g) {
                uint256 index = i * groups + g;
                if (reverse) index = split.length - 1 - index;
                // Explicit copy: mutating a memory struct alias would alter the baseline.
                split[index] = CombatCohort(
                    c[i].key,
                    c[i].count / groups + (g < c[i].count % groups ? 1 : 0),
                    c[i].attack,
                    c[i].shield,
                    c[i].hull,
                    c[i].unit
                );
            }
        }
    }

    function outcome(CombatCohort[] memory attackers, CombatCohort[] memory defenders, uint256 seed)
        private
        view
        returns (bytes32)
    {
        for (uint8 round = 1; round <= 6; ++round) {
            (
                CombatCohort[] memory a,
                CombatCohort[] memory d,
                uint256[] memory al,
                uint256[] memory dl
            ) = math.cohortRoundLosses(attackers, defenders, seed, round);
            for (uint256 i; i < a.length; ++i) {
                a[i].count -= al[i];
            }
            for (uint256 i; i < d.length; ++i) {
                d[i].count -= dl[i];
            }
            attackers = a;
            defenders = d;
        }
        return keccak256(abi.encode(attackers, defenders));
    }

    function testSameSeedAttackDefensePartitionAndOrderParity() public view {
        for (uint256 seed; seed < 16; ++seed) {
            bytes32 solo = outcome(composition(true), composition(false), seed);
            assertEq(
                solo,
                outcome(
                    partition(composition(true), 7, false),
                    partition(composition(false), 9, false),
                    seed
                )
            );
            assertEq(
                solo,
                outcome(
                    partition(composition(true), 7, true),
                    partition(composition(false), 9, true),
                    seed
                )
            );
        }
    }

    function testMixedTechKeepsDistinctEffectiveStats() public view {
        CombatCohort[] memory input = new CombatCohort[](3);
        input[0] = unit(Ship.Cruiser, 20, 8, 8, 8);
        input[1] = unit(Ship.Cruiser, 30, 10, 9, 10);
        input[2] = unit(Ship.Cruiser, 40, 8, 8, 8);
        (CombatCohort[] memory pool,,,) = math.cohortRoundLosses(input, composition(false), 123, 1);
        assertEq(pool.length, 2);
        uint256 total;
        for (uint256 i; i < pool.length; ++i) {
            total += pool[i].count;
            if (pool[i].key == input[0].key) {
                assertEq(pool[i].count, 60);
                assertEq(pool[i].attack, input[0].attack);
                assertEq(pool[i].shield, input[0].shield);
                assertEq(pool[i].hull, input[0].hull);
            } else {
                assertEq(pool[i].key, input[1].key);
                assertEq(pool[i].count, 30);
                assertEq(pool[i].attack, input[1].attack);
                assertEq(pool[i].shield, input[1].shield);
                assertEq(pool[i].hull, input[1].hull);
            }
        }
        assertEq(total, 90);
    }

    function testAggregateCountsExceedUint32WithoutTruncation() public view {
        CombatCohort[] memory input = new CombatCohort[](7);
        for (uint256 i; i < input.length; ++i) {
            input[i] = unit(Ship.LightFighter, type(uint32).max, 8, 8, 8);
        }
        (CombatCohort[] memory pool,,,) = math.cohortRoundLosses(input, composition(false), 7, 1);
        assertEq(pool.length, 1);
        assertEq(pool[0].count, uint256(type(uint32).max) * 7);
    }

    function testMixedTechOrderAndPartitionParity() public view {
        CombatCohort[] memory mixed = composition(true);
        mixed[1] = unit(Ship.Battlecruiser, 317, 10, 9, 10);
        bytes32 combined = outcome(mixed, composition(false), 94881);
        assertEq(
            combined,
            outcome(partition(mixed, 7, true), partition(composition(false), 8, true), 94881)
        );
    }

    function testZeroAndTotalLossesAreBounded() public view {
        CombatCohort[] memory attackers = new CombatCohort[](1);
        CombatCohort[] memory defenders = new CombatCohort[](1);
        attackers[0] = unit(Ship.Deathstar, 1000, 10, 9, 10);
        defenders[0] = unit(Ship.SmallCargo, 3, 8, 8, 8);
        (,, uint256[] memory al, uint256[] memory dl) =
            math.cohortRoundLosses(attackers, defenders, 11, 1);
        assertEq(al[0], 0);
        assertEq(dl[0], 3);
        defenders[0].count = 0;
        (,,, dl) = math.cohortRoundLosses(attackers, defenders, 11, 1);
        assertEq(dl.length, 0);
    }

    function testSevenMixedTechOwnersPerSideGasIsBounded() public {
        CombatCohort[] memory a = new CombatCohort[](21);
        CombatCohort[] memory d = new CombatCohort[](21);
        for (uint16 g; g < 7; ++g) {
            a[g * 3] = unit(Ship.Cruiser, 791, 8 + g, 8 + g, 8 + g);
            a[g * 3 + 1] = unit(Ship.Battlecruiser, 317, 8 + g, 8 + g, 8 + g);
            a[g * 3 + 2] = unit(Ship.Bomber, 41, 8 + g, 8 + g, 8 + g);
            d[g * 3] = unit(Ship.LightFighter, 791, 8 + g, 8 + g, 8 + g);
            d[g * 3 + 1] = unit(Ship.SmallCargo, 317, 8 + g, 8 + g, 8 + g);
            d[g * 3 + 2] = unit(Ship.Battleship, 41, 8 + g, 8 + g, 8 + g);
        }
        uint256 beforeGas = gasleft();
        math.cohortRoundLosses(a, d, 94880, 1);
        uint256 used = beforeGas - gasleft();
        emit log_named_uint("seven mixed-tech owners pure math gas", used);
        assertLt(used, 15_000_000, "pure math leaves no Base transaction headroom");
    }

    function testCanonicalizeDoesNotMutateOwnerCounts() public pure {
        CombatCohort[] memory input = new CombatCohort[](2);
        input[0] = unit(Ship.Cruiser, 20, 8, 8, 8);
        input[1] = unit(Ship.Cruiser, 30, 8, 8, 8);
        CombatCohort[] memory pool = VeydriftCombatCohorts.canonicalize(input);
        assertEq(pool[0].count, 50);
        assertEq(input[0].count, 20);
        assertEq(input[1].count, 30);
    }

    function testFiringAndSurvivalUseExactOwnerStats() public pure {
        CombatCohort memory weak = unit(Ship.Cruiser, 100, 8, 8, 8);
        CombatCohort memory strong = unit(Ship.Cruiser, 100, 10, 9, 10);
        // These are hand-derived survivability boundaries, independent of RNG and
        // catalog attack matchup: a hit above weak hull+shield, below strong's.
        uint256 attack = weak.shield + weak.hull;
        assertEq(VeydriftCombatCohorts.lossCount(weak, 100, attack, 7, 1, 4, 9), 100);
        assertLt(VeydriftCombatCohorts.lossCount(strong, 100, attack, 7, 1, 4, 9), 100);
        assertEq(strong.attack, VeydriftCatalog.shipBattleAttack(Ship.Cruiser) * 2);
        assertEq(weak.attack, VeydriftCatalog.shipBattleAttack(Ship.Cruiser) * 18 / 10);
        // Below 1% shield threshold cannot damage the owner's cohort.
        assertEq(VeydriftCombatCohorts.lossCount(strong, 10000, strong.shield / 100, 7, 1, 4, 9), 0);
    }

    function testSevenMixedTechOwnersAllMobileTypesAndResidentDefenseGasCap() public {
        CombatCohort[] memory attackers = new CombatCohort[](7 * 14);
        CombatCohort[] memory defenders = new CombatCohort[](7 * 14 + 24);
        uint256 index;
        for (uint16 owner; owner < 7; ++owner) {
            for (uint8 kind; kind < 16; ++kind) {
                if (kind == uint8(Ship.SolarSatellite) || kind == uint8(Ship.Crawler)) continue;
                attackers[index] = unit(Ship(kind), 1000, 8 + owner, 8 + owner, 8 + owner);
                defenders[index] = unit(Ship(kind), 1000, 8 + owner, 8 + owner, 8 + owner);
                ++index;
            }
        }
        for (uint8 kind; kind < 16; ++kind) {
            defenders[index++] = unit(Ship(kind), 1000, 8, 8, 8);
        }
        for (uint8 kind; kind < 8; ++kind) {
            uint256 attack = VeydriftCatalog.defenseBattleAttack(Defense(kind)) * 18 / 10;
            uint256 shield = VeydriftCatalog.defenseBattleShield(Defense(kind)) * 18 / 10;
            uint256 hull = VeydriftCatalog.defenseBattleHull(Defense(kind)) * 18 / 10;
            defenders[index++] = CombatCohort(
                VeydriftCombatCohorts.key(kind + 16, attack, shield, hull),
                kind == uint8(Defense.SmallShieldDome) || kind == uint8(Defense.LargeShieldDome)
                    ? 1
                    : 1000,
                attack,
                shield,
                hull,
                kind + 16
            );
        }
        uint256 beforeGas = gasleft();
        math.cohortRoundLosses(attackers, defenders, 94880, 1);
        uint256 used = beforeGas - gasleft();
        emit log_named_uint(
            "seven owners all mobile types and resident defenses pure math gas", used
        );
        assertLt(used, 15_000_000, "pure math leaves no Base transaction headroom");
    }
}
