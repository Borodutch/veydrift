// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {VeydriftGameStorage as G} from "../src/VeydriftGameStorage.sol";
import {VeydriftCombatPreparation as P} from "../src/libraries/VeydriftCombatPreparation.sol";
import {Ship, Defense} from "../src/libraries/VeydriftTypes.sol";

contract CombatPreparationHarness {
    P.State public progress;
    G.ShipQueue internal ship;
    G.DefenseQueue internal defense;
    G.ShipQueue[] internal ships;
    G.DefenseQueue[] internal defenses;
    mapping(uint64 => G.ProductionQueueTiming) internal shipTimings;
    mapping(uint64 => G.ProductionQueueTiming) internal defenseTimings;
    mapping(Ship => uint32) public shipCounts;
    mapping(Defense => uint32) public defenseCounts;

    function seed(uint256 start, uint256 count) external {
        for (uint256 i = start; i < start + count; ++i) {
            G.Resources memory cost =
                G.Resources(uint128(i + 101), uint128(i + 53), uint128(i + 17));
            G.ShipQueue memory s =
                G.ShipQueue(true, Ship.LightFighter, 10, uint64(110 + i * 10), cost);
            G.DefenseQueue memory d =
                G.DefenseQueue(true, Defense.RocketLauncher, 10, s.readyAt, cost);
            G.ProductionQueueTiming memory t =
                G.ProductionQueueTiming(uint64(100 + i * 10), 10, 7, 7);
            if (i == 0) {
                ship = s;
                defense = d;
            } else {
                ships.push(s);
                defenses.push(d);
            }
            shipTimings[s.readyAt] = t;
            defenseTimings[s.readyAt] = t;
        }
    }

    function custom(
        uint32 remaining,
        uint64 readyAt,
        G.Resources calldata cost,
        G.ProductionQueueTiming calldata queueTiming
    ) external {
        ship = G.ShipQueue(true, Ship.LightFighter, remaining, readyAt, cost);
        defense = G.DefenseQueue(true, Defense.RocketLauncher, remaining, readyAt, cost);
        shipTimings[readyAt] = queueTiming;
        defenseTimings[readyAt] = queueTiming;
    }

    function advance(uint256 planetId, uint64 cutoff, uint256 work)
        external
        returns (bool, uint256)
    {
        return P.advance(
            progress,
            planetId,
            ship,
            defense,
            ships,
            defenses,
            shipTimings,
            defenseTimings,
            shipCounts,
            defenseCounts,
            cutoff,
            work
        );
    }

    function activeQueues() external view returns (G.ShipQueue memory, G.DefenseQueue memory) {
        return (ship, defense);
    }

    function lengths() external view returns (uint256, uint256) {
        return (ships.length, defenses.length);
    }

    function entry(uint256 index)
        external
        view
        returns (G.ShipQueue memory, G.DefenseQueue memory)
    {
        return (ships[index], defenses[index]);
    }

    function timing(uint64 readyAt)
        external
        view
        returns (G.ProductionQueueTiming memory, G.ProductionQueueTiming memory)
    {
        return (shipTimings[readyAt], defenseTimings[readyAt]);
    }

    function phase() external view returns (uint8) {
        return progress.phase;
    }
}

contract VeydriftCombatPreparationTest is Test {
    CombatPreparationHarness private h;
    uint256 private maxAdvanceGas;

    function setUp() public {
        h = new CombatPreparationHarness();
    }

    function _advance(uint64 cutoff, uint256 work) private returns (bool complete, uint256 used) {
        vm.cool(address(h)); // Each chunk models a fresh transaction, not fixture-warmed storage.
        uint256 gasBefore = gasleft();
        (complete, used) = h.advance{gas: 15_000_000}(42, cutoff, work);
        uint256 spent = gasBefore - gasleft();
        if (spent > maxAdvanceGas) maxAdvanceGas = spent;
        assertLt(spent + 21_000, 15_000_000, "advance exceeds transaction gas budget");
        assertLe(used, work);
        if (!complete && work != 0) assertEq(used, work);
    }

    function _finish(uint64 cutoff, uint256 work) private returns (uint256 operations) {
        for (uint256 calls; calls < 20_000; ++calls) {
            (bool done, uint256 used) = _advance(cutoff, work);
            operations += used;
            if (done) {
                emit log_named_uint(
                    "maximum cold advance gas including base transaction", maxAdvanceGas + 21_000
                );
                return operations;
            }
        }
        fail("preparation failed to make bounded progress");
    }

    function _seedThousands() private {
        // Fixture setup is not an advance transaction; production backlog has no new size cap.
        // Exclude fixture writes from the test-runner aggregate gas ceiling, not from advance.
        vm.pauseGasMetering();
        for (uint256 i; i < 3_001; i += 100) {
            h.seed(i, i + 100 > 3_001 ? 3_001 - i : 100);
        }
        vm.resumeGasMetering();
    }

    function testThousandsRetainEntireFutureBacklogAndPartialCosts() public {
        _seedThousands();
        // 1500 full batches, then 5 units from batch 1500, regardless of present wall clock.
        vm.warp(1_000_000);
        uint256 operations = _finish(15_105, 64);
        assertLt(operations, 13_000, "must be linear, not per-promotion shifting");
        assertEq(h.shipCounts(Ship.LightFighter), 15_005);
        assertEq(h.defenseCounts(Defense.RocketLauncher), 15_005);
        (G.ShipQueue memory s, G.DefenseQueue memory d) = h.activeQueues();
        assertEq(s.quantity, 5);
        assertEq(d.quantity, 5);
        assertEq(s.readyAt, 15_110);
        assertEq(d.readyAt, 15_110);
        assertEq(s.cost.metal, 801);
        assertEq(s.cost.crystal, 777);
        assertEq(s.cost.deuterium, 759);
        assertEq(abi.encode(s.cost), abi.encode(d.cost));
        (uint256 sl, uint256 dl) = h.lengths();
        assertEq(sl, 1500);
        assertEq(dl, 1500);
        for (uint256 i; i < sl; ++i) {
            (s, d) = h.entry(i);
            assertEq(s.readyAt, 15_120 + i * 10);
            assertEq(d.readyAt, s.readyAt);
            assertEq(s.quantity, 10);
            assertEq(d.quantity, 10);
            assertEq(s.cost.metal, 1602 + i);
            assertEq(d.cost.metal, s.cost.metal);
            (G.ProductionQueueTiming memory st, G.ProductionQueueTiming memory dt) =
                h.timing(s.readyAt);
            assertEq(st.startedAt, s.readyAt - 10);
            assertEq(dt.startedAt, st.startedAt);
        }
        (G.ProductionQueueTiming memory oldTiming,) = h.timing(110);
        assertEq(oldTiming.startedAt, 0);
        (oldTiming,) = h.timing(15_110);
        assertEq(oldTiming.originalQuantity, 10);
        (bool complete, uint256 used) = _advance(15_105, 64);
        assertTrue(complete);
        assertEq(used, 0);
        assertEq(h.shipCounts(Ship.LightFighter), 15_005);
    }

    function testThousandsAllDueDrainAndClearEveryTiming() public {
        _seedThousands();
        uint256 operations = _finish(40_000, 64);
        assertLt(operations, 13_000);
        assertEq(h.shipCounts(Ship.LightFighter), 30_010);
        assertEq(h.defenseCounts(Defense.RocketLauncher), 30_010);
        (G.ShipQueue memory s, G.DefenseQueue memory d) = h.activeQueues();
        assertFalse(s.active);
        assertFalse(d.active);
        assertEq(s.quantity, 0);
        assertEq(d.quantity, 0);
        assertEq(s.cost.metal, 0);
        assertEq(d.cost.deuterium, 0);
        (uint256 sl, uint256 dl) = h.lengths();
        assertEq(sl, 0);
        assertEq(dl, 0);
        for (uint64 readyAt = 110; readyAt <= 30_110; readyAt += 10) {
            (G.ProductionQueueTiming memory st, G.ProductionQueueTiming memory dt) =
                h.timing(readyAt);
            assertEq(abi.encode(st), abi.encode(G.ProductionQueueTiming(0, 0, 0, 0)));
            assertEq(abi.encode(dt), abi.encode(st));
        }
    }

    function testSingleWorkYieldsThroughAllPhasesAndPreservesEventOrder() public {
        h.seed(0, 6);
        vm.recordLogs();
        uint256 seen;
        bool done;
        while (!done) {
            seen |= 1 << h.phase();
            (done,) = _advance(125, 1);
        }
        assertEq(seen, 63, "every intermediate phase must resume");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 14); // per lane: completed, queued, timing x2, partial completed
        bytes32 completedShip = keccak256("ShipCompleted(uint256,uint8,uint32,uint32)");
        bytes32 queuedShip =
            keccak256("ShipQueued(uint256,uint8,uint32,uint64,uint128,uint128,uint128)");
        bytes32 timingShip =
            keccak256("ShipQueueTimingSet(uint256,uint8,uint64,uint64,uint32,uint256,uint256)");
        assertEq(logs[0].topics[0], completedShip);
        assertEq(logs[1].topics[0], queuedShip);
        assertEq(logs[2].topics[0], timingShip);
        assertEq(logs[0].data, abi.encode(uint32(10), uint32(10)));
        assertEq(logs[6].data, abi.encode(uint32(5), uint32(25)));
        assertEq(logs[7].topics[0], keccak256("DefenseCompleted(uint256,uint8,uint32,uint32)"));
        assertEq(
            logs[8].topics[0],
            keccak256("DefenseQueued(uint256,uint8,uint32,uint64,uint128,uint128,uint128)")
        );
        assertEq(
            logs[9].topics[0],
            keccak256("DefenseQueueTimingSet(uint256,uint8,uint64,uint64,uint32,uint256,uint256)")
        );
        assertEq(logs[13].data, abi.encode(uint32(5), uint32(25)));
        (uint256 sl, uint256 dl) = h.lengths();
        assertEq(sl, 3);
        assertEq(dl, 3);
    }

    function testLegacyNotReadyDoesNotCreditAndReadyCompletes() public {
        h.custom(7, 200, G.Resources(101, 53, 17), G.ProductionQueueTiming(0, 0, 0, 0));
        _finish(199, 1);
        assertEq(h.shipCounts(Ship.LightFighter), 0);
        (G.ShipQueue memory s,) = h.activeQueues();
        assertEq(s.quantity, 7);
        h = new CombatPreparationHarness();
        h.custom(7, 200, G.Resources(101, 53, 17), G.ProductionQueueTiming(0, 0, 0, 0));
        _finish(200, 1);
        assertEq(h.shipCounts(Ship.LightFighter), 7);
        assertEq(h.defenseCounts(Defense.RocketLauncher), 7);
    }

    function testPriorSettlementAndFloorMathAtImpact() public {
        h.custom(7, 200, G.Resources(101, 53, 17), G.ProductionQueueTiming(100, 10, 7, 3));
        _finish(112, 1); // floor(12 * 3 / 7) = 5, prior = 3, delta = 2
        assertEq(h.shipCounts(Ship.LightFighter), 2);
        assertEq(h.defenseCounts(Defense.RocketLauncher), 2);
        (G.ShipQueue memory s, G.DefenseQueue memory d) = h.activeQueues();
        assertEq(s.quantity, 5);
        assertEq(d.quantity, 5);
        assertEq(s.cost.metal, 73);
        assertEq(s.cost.crystal, 38);
        assertEq(s.cost.deuterium, 13);
        assertEq(abi.encode(s.cost), abi.encode(d.cost));
    }

    function testZeroWorkDoesNotStartAndContextCannotChange() public {
        h.seed(0, 4);
        (bool done, uint256 used) = _advance(115, 0);
        assertFalse(done);
        assertEq(used, 0);
        _advance(125, 1); // zero work did not bind 115
        vm.expectRevert(P.PreparationContextChanged.selector);
        h.advance(42, 126, 1);
        vm.expectRevert(P.PreparationContextChanged.selector);
        h.advance(43, 125, 1);
        _finish(125, 1);
    }

    function testFuzzByImpactMath(
        uint32 remainingInput,
        uint32 originalInput,
        uint64 elapsedInput,
        uint64 workInput,
        uint64 rateInput,
        uint128 metal
    ) public {
        uint32 original = uint32(bound(originalInput, 1, 100_000));
        uint32 remaining = uint32(bound(remainingInput, 1, original));
        uint64 elapsed = uint64(bound(elapsedInput, 0, 1000));
        uint64 work = uint64(bound(workInput, 0, 1_000_000));
        uint64 rate = uint64(bound(rateInput, 1, 1_000_000));
        h.custom(
            remaining,
            1100,
            G.Resources(metal, 53, 17),
            G.ProductionQueueTiming(100, original, work, rate)
        );
        uint256 produced = elapsed == 1000 || work == 0 ? original : uint256(elapsed) * rate / work;
        if (produced > original) produced = original;
        uint256 prior = original - remaining;
        uint32 delta = produced > prior ? uint32(produced - prior) : 0;
        _finish(100 + elapsed, 1);
        assertEq(h.shipCounts(Ship.LightFighter), delta);
        assertEq(h.defenseCounts(Defense.RocketLauncher), delta);
        (G.ShipQueue memory s, G.DefenseQueue memory d) = h.activeQueues();
        assertEq(s.quantity, remaining - delta);
        assertEq(d.quantity, remaining - delta);
        assertEq(s.cost.metal, uint256(metal) - uint256(metal) * delta / remaining);
        assertEq(d.cost.metal, s.cost.metal);
    }
}
