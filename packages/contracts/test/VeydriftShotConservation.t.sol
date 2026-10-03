// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CombatCohort, VeydriftCombatCohorts} from "../src/libraries/VeydriftCombatCohorts.sol";

/// @notice Small-unit oracle assigns actual individual shots, never ceiling/floor cohorts.
/// Deterministic shield/hull fixtures separate allocation correctness from RNG parity.
contract VeydriftShotConservationTest is Test {
    function testOneHundredShotsCannotBecomeOneHundredNinetyEight() public pure {
        CombatCohort memory target = CombatCohort(17, 99, 0, 100, 100, 0);
        // 98 units take one shield-absorbed hit; exactly one receives two and dies.
        assertEq(VeydriftCombatCohorts.lossCount(target, 100, 100, 1, 1, 4, 9), 1);
    }

    function testIndividualShotOracleAcrossBoundaries() public pure {
        for (uint256 count = 1; count <= 19; ++count) {
            for (uint256 shots; shots <= count * 3 + 1; ++shots) {
                for (uint256 lethalHits = 1; lethalHits <= 4; ++lethalHits) {
                    uint256[] memory hits = new uint256[](count);
                    uint256 cursor;
                    for (uint256 shot; shot < shots; ++shot) {
                        ++hits[cursor];
                        if (++cursor == count) cursor = 0;
                    }
                    uint256 expected;
                    uint256 assigned;
                    for (uint256 i; i < count; ++i) {
                        assigned += hits[i];
                        if (hits[i] >= lethalHits) ++expected;
                    }
                    assertEq(assigned, shots, "oracle conserves physical shots");
                    CombatCohort memory target =
                        CombatCohort(17, count, 0, (lethalHits - 1) * 100, 100, 0);
                    assertEq(
                        VeydriftCombatCohorts.lossCount(target, shots, 100, 7, 1, 4, 9),
                        expected,
                        "production must match individually assigned hits"
                    );
                }
            }
        }
    }

    function testEmptyInputsAndWideRemainder() public pure {
        CombatCohort memory target = CombatCohort(17, 0, 0, 100, 100, 0);
        assertEq(VeydriftCombatCohorts.lossCount(target, 100, 100, 1, 1, 4, 9), 0);
        target.count = uint256(type(uint32).max) * 8;
        assertEq(VeydriftCombatCohorts.lossCount(target, 0, 100, 1, 1, 4, 9), 0);
        assertEq(VeydriftCombatCohorts.lossCount(target, target.count + 1, 100, 1, 1, 4, 9), 1);
        assertEq(
            VeydriftCombatCohorts.lossCount(target, target.count * 2 - 1, 100, 1, 1, 4, 9),
            target.count - 1
        );
        assertEq(
            VeydriftCombatCohorts.lossCount(target, target.count * 2, 100, 1, 1, 4, 9), target.count
        );
        assertEq(VeydriftCombatCohorts.lossCount(target, target.count, 0, 1, 1, 4, 9), 0);
        target.hull = 0;
        assertEq(VeydriftCombatCohorts.lossCount(target, target.count, 100, 1, 1, 4, 9), 0);
    }
}
