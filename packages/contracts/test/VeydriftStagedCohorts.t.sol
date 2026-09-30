// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CombatCohort, VeydriftCombatCohorts} from "../src/libraries/VeydriftCombatCohorts.sol";
import {VeydriftStagedCohorts} from "../src/libraries/VeydriftStagedCohorts.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {Ship, Defense} from "../src/libraries/VeydriftTypes.sol";

contract StagedCohortHarness {
    using VeydriftStagedCohorts for VeydriftStagedCohorts.State;
    VeydriftStagedCohorts.State private state;

    function add(uint8 side, CombatCohort memory c) external returns (uint256) {
        return state.add(side, c);
    }

    function start(uint256 seed, uint8 round) external {
        state.startRound(seed, round);
    }

    function step(uint256 work) external returns (bool) {
        return state.step(work);
    }

    function count(uint8 side) external view returns (uint256) {
        return state.cohortCount(side);
    }

    function cohort(uint8 side, uint256 i) external view returns (CombatCohort memory) {
        return state.cohort(side, i);
    }

    function loss(uint8 side, uint256 i) external view returns (uint256) {
        return state.loss(side, i);
    }

    function setCount(uint8 side, uint256 i, uint256 n) external {
        state.setCount(side, i, n);
    }

    function workDone() external view returns (uint256) {
        return state.workDone;
    }

    function phase() external view returns (VeydriftStagedCohorts.Phase) {
        return state.phase;
    }

    function total(uint8 side) external view returns (uint256) {
        return state.sides[side].total;
    }

    function typeCount(uint8 side, uint8 unit) external view returns (uint256) {
        return state.sides[side].typeCounts[unit];
    }

    function cursor() external view returns (bytes32) {
        return keccak256(
            abi.encode(
                state.phase,
                state.firingSide,
                state.shooterIndex,
                state.targetIndex,
                state.typeIndex,
                state.chain
            )
        );
    }

    function chain() external view returns (uint8) {
        return state.chain;
    }
}

/// @dev Independently implements ABI hashing, rounding, chain continuation and damage.
/// Uses only catalog constants, never production cohort arithmetic helpers.
contract StagedIndependentOracle {
    bytes32 private constant DOMAIN = keccak256("veydrift.cohort-combat-random-stream.v1");

    struct Context {
        uint256 seed;
        uint8 round;
        uint8 side;
        uint256 firingKey;
    }

    function draw(Context memory c, uint256 target, uint256 lane) private pure returns (uint256) {
        return
            uint256(
                keccak256(abi.encode(DOMAIN, c.seed, c.round, c.side, c.firingKey, target, lane))
            );
    }

    function rounded(
        uint256 n,
        uint256 weight,
        uint256 denominator,
        Context memory c,
        uint256 target,
        uint256 lane
    ) private pure returns (uint256) {
        if (n == 0 || weight == 0 || denominator == 0) return 0;
        uint256 product = n * weight;
        return product / denominator
            + (draw(c, target, lane) % denominator < product % denominator ? 1 : 0);
    }

    function losses(
        CombatCohort[] memory firing,
        CombatCohort[] memory targets,
        uint256 seed,
        uint8 round,
        uint8 side
    ) external pure returns (uint256[] memory lost) {
        lost = new uint256[](targets.length);
        uint256 total;
        uint256[24] memory counts;
        for (uint256 j; j < targets.length; ++j) {
            total += targets[j].count;
            counts[targets[j].unit] += targets[j].count;
        }
        if (total == 0) return lost;
        for (uint256 i; i < firing.length; ++i) {
            CombatCohort memory s = firing[i];
            if (s.attack == 0) continue;
            Context memory ctx = Context(seed, round, side, s.key);
            uint256 incoming = s.count;
            uint256 extra;
            if (s.unit < 16) {
                for (uint256 chain; chain < 64; ++chain) {
                    uint256 generated;
                    for (uint8 kind; kind < 24; ++kind) {
                        uint256 rf = kind < 16
                            ? VeydriftCatalog.shipRapidfireAgainstShip(Ship(s.unit), Ship(kind))
                            : VeydriftCatalog.shipRapidfireAgainstDefense(
                                Ship(s.unit), Defense(kind - 16)
                            );
                        if (rf <= 1 || counts[kind] == 0) continue;
                        uint256 selected =
                            rounded(incoming, counts[kind], total, ctx, kind, 1 + chain);
                        generated += rounded(
                            selected, (rf - 1) * 10_000 / rf, 10_000, ctx, kind, 30_000 + chain
                        );
                    }
                    if (generated == 0) break;
                    extra += generated;
                    incoming = generated;
                }
            }
            for (uint256 j; j < targets.length; ++j) {
                CombatCohort memory t = targets[j];
                uint256 shots = rounded(s.count, t.count, total, ctx, t.key, 0)
                    + rounded(extra, t.count, total, ctx, t.key, 0);
                if (shots == 0 || t.count == 0 || t.hull == 0) continue;
                uint256 hit = shots < t.count ? shots : t.count;
                uint256 damage = s.attack * ((shots + hit - 1) / hit);
                if (s.attack <= t.shield / 100 || damage <= t.shield) continue;
                uint256 hullDamage = damage - t.shield;
                uint256 killed;
                if (hullDamage >= t.hull) {
                    killed = hit;
                } else {
                    uint256 chance = hullDamage * 10_000 / t.hull;
                    if (chance > 3_000) {
                        killed = rounded(hit, chance, 10_000, ctx, t.key, 65_536 + shots);
                    }
                }
                lost[j] += killed;
                if (lost[j] > t.count) lost[j] = t.count;
            }
        }
    }
}

contract VeydriftStagedCohortsTest is Test {
    StagedIndependentOracle private oracle;
    StagedCohortHarness private large;

    function unit(uint8 kind, uint256 n, uint256 tech)
        private
        pure
        returns (CombatCohort memory c)
    {
        c.unit = kind;
        c.count = n;
        c.attack =
            (kind < 16
                        ? VeydriftCatalog.shipBattleAttack(Ship(kind))
                        : VeydriftCatalog.defenseBattleAttack(Defense(kind - 16))) * (10 + tech)
                / 10;
        c.shield =
            (kind < 16
                        ? VeydriftCatalog.shipBattleShield(Ship(kind))
                        : VeydriftCatalog.defenseBattleShield(Defense(kind - 16))) * (11 + tech)
                / 10;
        c.hull =
            (kind < 16
                        ? VeydriftCatalog.shipBattleHull(Ship(kind))
                        : VeydriftCatalog.defenseBattleHull(Defense(kind - 16))) * (12 + tech) / 10;
        c.key = uint256(keccak256(abi.encode(c.unit, c.attack, c.shield, c.hull)));
    }

    function setUp() public {
        oracle = new StagedIndependentOracle();
        large = new StagedCohortHarness();
        // Identical full dimensions to the existing failing pure-math gas fixture:
        // seven distinct owners with all 14 mobile types, resident all16 + defenses.
        for (uint256 owner; owner < 7; ++owner) {
            for (uint8 kind; kind < 16; ++kind) {
                if (kind == uint8(Ship.SolarSatellite) || kind == uint8(Ship.Crawler)) continue;
                large.add(0, unit(kind, 1000, 8 + owner));
                large.add(1, unit(kind, 1000, 8 + owner));
            }
        }
        for (uint8 kind; kind < 24; ++kind) {
            bool dome = kind == 16 + uint8(Defense.SmallShieldDome)
                || kind == 16 + uint8(Defense.LargeShieldDome);
            large.add(1, unit(kind, dome ? 1 : 1000, 8));
        }
        large.start(94880, 1);
    }

    function snapshot(StagedCohortHarness h, uint8 side)
        private
        view
        returns (CombatCohort[] memory a)
    {
        a = new CombatCohort[](h.count(side));
        for (uint256 i; i < a.length; ++i) {
            a[i] = h.cohort(side, i);
        }
    }

    function finish(StagedCohortHarness h, uint256 chunk)
        private
        returns (uint256 maximumGas, uint256 calls)
    {
        while (h.phase() != VeydriftStagedCohorts.Phase.Done) {
            uint256 previous = h.workDone();
            bytes32 cursor = h.cursor();
            // Cold accesses even without --isolate; use --isolate for committed
            // storage gas accounting across each top-level external harness call.
            vm.cool(address(h));
            uint256 gasBefore = gasleft();
            bool done = h.step{gas: 15_000_000}(chunk);
            uint256 used = gasBefore - gasleft();
            if (used > maximumGas) maximumGas = used;
            assertLe(used, 15_000_000);
            assertGt(h.workDone(), previous, "successful call must checkpoint work");
            assertLe(h.workDone() - previous, chunk, "work budget exceeded");
            if (!done) assertNotEq(h.cursor(), cursor, "cursor must durably advance");
            ++calls;
            assertLt(calls, 100_000, "bounded fixture must finish");
        }
    }

    function verify(StagedCohortHarness h, uint256 seed, uint8 round, bool independent)
        private
        view
    {
        CombatCohort[] memory a = snapshot(h, 0);
        CombatCohort[] memory d = snapshot(h, 1);
        uint256[] memory dl = VeydriftCombatCohorts.losses(a, d, seed, round, 4);
        uint256[] memory al = VeydriftCombatCohorts.losses(d, a, seed, round, 1);
        if (independent) {
            assertEq(dl, independentLosses(a, d, seed, round, 4));
            assertEq(al, independentLosses(d, a, seed, round, 1));
        }
        for (uint256 i; i < a.length; ++i) {
            assertEq(h.loss(0, i), al[i]);
        }
        for (uint256 i; i < d.length; ++i) {
            assertEq(h.loss(1, i), dl[i]);
        }
    }

    // The deliberately allocation-heavy independent ABI oracle is evaluated one
    // firing cohort per call, then summed/capped independently. This is only test
    // oracle chunking: the real staged execution retains its unchanged 15M cap.
    function independentLosses(
        CombatCohort[] memory firing,
        CombatCohort[] memory targets,
        uint256 seed,
        uint8 round,
        uint8 side
    ) private view returns (uint256[] memory result) {
        result = new uint256[](targets.length);
        CombatCohort[] memory one = new CombatCohort[](1);
        for (uint256 i; i < firing.length; ++i) {
            one[0] = firing[i];
            uint256[] memory part = oracle.losses(one, targets, seed, round, side);
            for (uint256 j; j < result.length; ++j) {
                result[j] += part[j];
                if (result[j] > targets[j].count) result[j] = targets[j].count;
            }
        }
    }

    function small(bool reverse, bool split) private returns (StagedCohortHarness h) {
        h = new StagedCohortHarness();
        for (uint8 side; side < 2; ++side) {
            for (uint256 i; i < 6; ++i) {
                uint256 j = reverse ? 5 - i : i;
                uint8[3] memory kinds = side == 0
                    ? [uint8(Ship.Cruiser), uint8(Ship.Battlecruiser), uint8(Ship.Bomber)]
                    : [uint8(Ship.LightFighter), uint8(Ship.SmallCargo), uint8(Ship.Battleship)];
                CombatCohort memory c = unit(kinds[j % 3], 53 + j * 31, 8 + j / 3);
                if (split) {
                    uint256 n = c.count;
                    c.count = n / 3;
                    h.add(side, c);
                    c.count = n - c.count;
                    h.add(side, c);
                } else {
                    h.add(side, c);
                }
            }
        }
    }

    function testSeedsChunksOrdersAndMixedOwnerIndependentParity() public {
        uint256[4] memory chunks = [uint256(1), 7, 64, 257];
        for (uint256 seed; seed < 4; ++seed) {
            StagedCohortHarness baseline = small(false, false);
            baseline.start(seed * 7919, 3);
            finish(baseline, 257);
            verify(baseline, seed * 7919, 3, true);
            for (uint256 k; k < chunks.length; ++k) {
                StagedCohortHarness h = small(true, true);
                h.start(seed * 7919, 3);
                finish(h, chunks[k]);
                verify(h, seed * 7919, 3, true);
                for (uint8 side; side < 2; ++side) {
                    for (uint256 i; i < 6; ++i) {
                        assertEq(h.cohort(side, i).key, baseline.cohort(side, 5 - i).key);
                        assertEq(h.loss(side, i), baseline.loss(side, 5 - i));
                    }
                }
            }
        }
    }

    function testFullSevenOwnerAllMobileAndDefensesBoundedCalls() public {
        assertEq(large.count(0), 98);
        assertEq(large.count(1), 108);
        (uint256 maximumGas, uint256 calls) = finish(large, 128);
        assertGt(calls, 1);
        emit log_named_uint("full roster maximum bounded-call gas", maximumGas);
        emit log_named_uint("full roster calls", calls);
        // Existing pure math parity fits the driver budget; independent arithmetic
        // receives a separate full-roster test transaction below.
        verify(large, 94880, 1, false);
    }

    function testFullRosterIndependentReferenceParity() public view {
        CombatCohort[] memory a = snapshot(large, 0);
        CombatCohort[] memory d = snapshot(large, 1);
        assertEq(
            VeydriftCombatCohorts.losses(a, d, 94880, 1, 4), independentLosses(a, d, 94880, 1, 4)
        );
        assertEq(
            VeydriftCombatCohorts.losses(d, a, 94880, 1, 1), independentLosses(d, a, 94880, 1, 1)
        );
    }

    function testEpochResetSurvivorsAndSixRounds() public {
        StagedCohortHarness h = small(false, false);
        for (uint8 round = 1; round <= 6; ++round) {
            h.start(9817, round);
            for (uint8 side; side < 2; ++side) {
                for (uint256 i; i < h.count(side); ++i) {
                    assertEq(h.loss(side, i), 0);
                }
            }
            finish(h, 31);
            verify(h, 9817, round, true);
            for (uint8 side; side < 2; ++side) {
                uint256 sum;
                for (uint256 i; i < h.count(side); ++i) {
                    uint256 survivors = h.cohort(side, i).count - h.loss(side, i);
                    h.setCount(side, i, survivors);
                    sum += survivors;
                }
                assertEq(h.total(side), sum);
            }
        }
    }

    function testZeroWorkIdleDoneAndMutationGuards() public {
        StagedCohortHarness h = new StagedCohortHarness();
        assertFalse(h.step(1));
        h.add(0, unit(uint8(Ship.Cruiser), 0, 8));
        h.start(7, 1);
        bytes32 beforeCursor = h.cursor();
        assertFalse(h.step(0));
        assertEq(h.workDone(), 0);
        assertEq(h.cursor(), beforeCursor);
        CombatCohort memory candidate = unit(uint8(Ship.LightFighter), 1, 8);
        vm.expectRevert(VeydriftStagedCohorts.RoundRunning.selector);
        h.add(1, candidate);
        vm.expectRevert(VeydriftStagedCohorts.RoundRunning.selector);
        h.setCount(0, 0, 1);
        vm.expectRevert(VeydriftStagedCohorts.RoundRunning.selector);
        h.start(8, 2);
        finish(h, 1);
        assertEq(h.loss(0, 0), 0);
        uint256 doneWork = h.workDone();
        assertTrue(h.step(100));
        assertEq(h.workDone(), doneWork);
    }

    function testKeyAggregationIgnoresSuppliedKeyAndWideCounts() public {
        StagedCohortHarness h = new StagedCohortHarness();
        CombatCohort memory c = unit(uint8(Ship.Cruiser), type(uint32).max, 8);
        for (uint256 i; i < 7; ++i) {
            c.key = i;
            assertEq(h.add(0, c), 0);
        }
        assertEq(h.count(0), 1);
        assertEq(h.cohort(0, 0).count, uint256(type(uint32).max) * 7);
        assertEq(h.typeCount(0, c.unit), uint256(type(uint32).max) * 7);
    }

    function testRapidfireChain64CursorIsResumable() public {
        StagedCohortHarness h = new StagedCohortHarness();
        h.add(0, unit(uint8(Ship.Deathstar), 1000, 8));
        h.add(1, unit(uint8(Ship.LightFighter), 1000, 8));
        h.start(51, 1);
        uint256 steps;
        while (h.phase() != VeydriftStagedCohorts.Phase.Rapidfire) {
            h.step(1);
            ++steps;
            assertLt(steps, 100);
        }
        // 63 complete chains, one type at a time, survive separate external calls.
        for (uint256 i; i < 63; ++i) {
            h.step(24);
            assertEq(h.chain(), i + 1);
        }
        assertEq(uint8(h.phase()), uint8(VeydriftStagedCohorts.Phase.Rapidfire));
        h.step(23);
        assertEq(uint8(h.phase()), uint8(VeydriftStagedCohorts.Phase.Rapidfire));
        h.step(1);
        assertEq(uint8(h.phase()), uint8(VeydriftStagedCohorts.Phase.Targets));
        finish(h, 1);
        verify(h, 51, 1, true);
    }
}
