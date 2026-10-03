// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {
    CombatCohort,
    VeydriftCombatCohorts as Production
} from "../src/libraries/VeydriftCombatCohorts.sol";
import {Ship} from "../src/libraries/VeydriftTypes.sol";
import {
    VeydriftIndependentCohortMath as Reference
} from "./support/VeydriftIndependentCohortMath.sol";

/// Small finite oracle enumerates actual shots, NOT quotient/remainder hit groups.
/// Only the test adapter imports production. Reference support imports no combat arithmetic.
contract VeydriftIndependentShotOracleTest is Test {
    function draw(
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 firing,
        uint256 target,
        uint256 lane
    ) private pure returns (uint256) {
        return uint256(
            keccak256(
                abi.encode(
                    keccak256("veydrift.cohort-combat-random-stream.v1"),
                    seed,
                    round,
                    side,
                    firing,
                    target,
                    lane
                )
            )
        );
    }

    function enumeratedLoss(CombatCohort memory t, uint256 shots, uint256 attack, uint256 seed)
        private
        pure
        returns (uint256 lost)
    {
        if (shots == 0 || t.count == 0 || t.hull == 0 || attack <= t.shield / 100) return 0;
        uint256[] memory hits = new uint256[](t.count);
        for (uint256 shot; shot < shots; ++shot) {
            ++hits[shot % t.count];
        }
        uint256 minimum = type(uint256).max;
        for (uint256 i; i < hits.length; ++i) {
            if (hits[i] != 0 && hits[i] < minimum) minimum = hits[i];
        }
        uint256[2] memory probabilitySum;
        for (uint256 i; i < hits.length; ++i) {
            uint256 damage;
            for (uint256 hit; hit < hits[i]; ++hit) {
                damage += attack;
            }
            if (damage <= t.shield) continue;
            damage -= t.shield;
            if (damage >= t.hull) {
                ++lost;
                continue;
            }
            uint256 bps = damage * 10_000 / t.hull;
            if (bps <= 3000) continue;
            probabilitySum[hits[i] == minimum ? 0 : 1] += bps;
        }
        for (uint256 group; group < 2; ++group) {
            // Aggregate subgroup sampling is part of the model, not independent
            // Bernoulli sampling per ship. Enumerated hits determine group membership.
            uint256 lane = (group == 0 ? 65_536 : 131_072) + shots;
            lost += probabilitySum[group] / 10_000;
            if (draw(seed, 2, 4, 37, t.key, lane) % 10_000 < probabilitySum[group] % 10_000) {
                ++lost;
            }
        }
    }

    function compare(CombatCohort memory target, uint256 shots, uint256 attack, uint256 seed)
        private
        pure
    {
        uint256 expected = enumeratedLoss(target, shots, attack, seed);
        Reference.Cohort memory t = Reference.Cohort(
            target.key, target.count, target.attack, target.shield, target.hull, target.unit
        );
        assertEq(
            Reference.destroyed(t, shots, attack, Reference.Context(seed, 2, 4), 37),
            expected,
            "independent aggregate reference disagrees with individual shots"
        );
        assertEq(
            Production.lossCount(target, shots, attack, seed, 2, 4, 37),
            expected,
            "production disagrees with individual shots"
        );
    }

    function testAdjacentShotCountsAcross256Seeds() public pure {
        CombatCohort memory t = CombatCohort(19, 99, 0, 10, 100, 16);
        for (uint256 seed = 1; seed <= 256; ++seed) {
            // Single hit = 31%; doubled hit = 72%: both RNG lanes matter.
            compare(t, 100, 41, seed);
            compare(t, 99, 41, seed);
            t.count = 100;
            compare(t, 99, 41, seed);
            compare(t, 100, 41, seed);
            t.count = 99;
        }
    }

    function testHandDerivedShieldHullAndExplosionBoundaries() public pure {
        CombatCohort memory t = CombatCohort(19, 7, 0, 100, 1000, 16);
        // 1% shield bounce applies per shot even when 700 hits would otherwise kill.
        compare(t, 700, 1, 5);
        assertEq(enumeratedLoss(t, 700, 1, 5), 0);
        compare(t, 7, 100, 5); // exactly shield
        compare(t, 7, 400, 5); // exactly 30% hull damage: no explosions
        assertEq(enumeratedLoss(t, 7, 400, 5), 0);
        for (uint256 seed = 1; seed <= 32; ++seed) {
            compare(t, 7, 401, seed); // 30.1%: stochastic
            compare(t, 8, 550, seed); // one deterministic high-hit kill, low stochastic
            compare(t, 15, 225, seed); // both subgroups stochastic, 2/3 hits
            compare(t, 7, 1099, seed); // just below hull
        }
        compare(t, 7, 1100, 5);
        assertEq(enumeratedLoss(t, 7, 1100, 5), 7);
        compare(t, 0, 1100, 5);
        t.count = 0;
        compare(t, 10, 1100, 5);
        t.count = 7;
        t.hull = 0;
        compare(t, 10, 1100, 5);
    }

    function testFuzzEnumeratedHits(
        uint32 seed,
        uint8 rawCount,
        uint16 rawShots,
        uint16 rawAttack,
        uint16 rawShield,
        uint16 rawHull
    ) public pure {
        CombatCohort memory t = CombatCohort(
            19,
            uint256(rawCount) % 31 + 1,
            0,
            uint256(rawShield) % 1001,
            uint256(rawHull) % 2001,
            16
        );
        compare(t, uint256(rawShots) % 257, uint256(rawAttack) % 2001, seed);
    }

    // Count each shot's offset-grid point in a cohort's half-open interval.
    // This avoids copying the cumulative floor/difference formula being tested.
    function enumeratedAllocation(
        uint256 shots,
        uint256 prefix,
        uint256 count,
        uint256 total,
        uint256 seed,
        uint256 lane
    ) private pure returns (uint256 n) {
        uint256 offset = draw(seed, 2, 4, 37, 0, lane) % total;
        for (uint256 shot; shot < shots; ++shot) {
            uint256 point = shot * total + offset;
            if (point >= shots * prefix && point < shots * (prefix + count)) ++n;
        }
    }

    function testSharedDrawAllocationConservesEveryShot() public pure {
        uint256[5] memory counts = [uint256(1), 7, 0, 13, 2];
        for (uint256 seed = 1; seed <= 32; ++seed) {
            for (uint256 shots; shots <= 51; ++shots) {
                uint256 prefix;
                uint256 assigned;
                for (uint256 i; i < counts.length; ++i) {
                    uint256 expected = enumeratedAllocation(shots, prefix, counts[i], 23, seed, 0);
                    uint256 actual = Reference.assigned(
                        shots, prefix, counts[i], 23, Reference.Context(seed, 2, 4), 37, 0
                    );
                    assertEq(actual, expected, "independent allocation enumeration");
                    assigned += actual;
                    prefix += counts[i];
                }
                assertEq(assigned, shots, "globally conserved");
            }
        }
    }

    function testWideReferenceAllocationAboveUint32() public pure {
        uint256 n = uint256(type(uint32).max) * 3;
        uint256 a = Reference.assigned(n + 1, 0, n, n * 2, Reference.Context(3, 2, 4), 37, 0);
        uint256 b = Reference.assigned(n + 1, n, n, n * 2, Reference.Context(3, 2, 4), 37, 0);
        assertEq(a + b, n + 1);
        assertGt(a, type(uint32).max);
    }

    function testMixedTargetReferenceParityAndPermutation() public pure {
        CombatCohort[] memory firing = new CombatCohort[](1);
        // Cruiser RF against light fighters/rocket launchers, no RF against Reaper.
        firing[0] = CombatCohort(37, 17, 400, 50, 2700, uint8(Ship.Cruiser));
        CombatCohort[] memory targets = new CombatCohort[](4);
        targets[0] = CombatCohort(22, 13, 0, 10, 400, uint8(Ship.LightFighter));
        targets[1] = CombatCohort(55, 9, 0, 20, 500, uint8(Ship.LightFighter));
        targets[2] = CombatCohort(11, 7, 0, 200, 1500, uint8(Ship.Reaper));
        targets[3] = CombatCohort(99, 21, 0, 20, 200, 16);
        Reference.Cohort[] memory rf = new Reference.Cohort[](1);
        rf[0] = Reference.Cohort(37, 17, 400, 50, 2700, uint8(Ship.Cruiser));
        for (uint256 seed = 1; seed <= 32; ++seed) {
            Reference.Cohort[] memory rt = new Reference.Cohort[](targets.length);
            for (uint256 j; j < targets.length; ++j) {
                CombatCohort memory t = targets[j];
                rt[j] = Reference.Cohort(t.key, t.count, t.attack, t.shield, t.hull, t.unit);
            }
            uint256[] memory expected = Reference.losses(rf, rt, seed, 2, 4);
            uint256[] memory actual = Production.losses(firing, targets, seed, 2, 4);
            assertEq(actual, expected, "RF and ascending-key allocation reference");
            CombatCohort[] memory reversed = new CombatCohort[](targets.length);
            for (uint256 j; j < targets.length; ++j) {
                reversed[j] = targets[targets.length - 1 - j];
            }
            uint256[] memory reverseLoss = Production.losses(firing, reversed, seed, 2, 4);
            for (uint256 j; j < targets.length; ++j) {
                assertEq(reverseLoss[j], actual[targets.length - 1 - j]);
            }
        }
    }
}
