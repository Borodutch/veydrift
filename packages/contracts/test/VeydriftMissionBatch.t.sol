// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {FleetChronologyHarness} from "./VeydriftFleetChronology.t.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {MissionResolutionItem, MissionResolutionOutcome} from "../src/libraries/VeydriftTypes.sol";

contract BatchResolutionHarness is FleetChronologyHarness {
    function setPaused() external {
        _gamePaused = 1;
    }

    // Gas poison is isolated without mocking the batch itself or weakening the real guard.
    function completeFleetMissionReturn(uint256 id) external override {
        if (id == 999) assembly ("memory-safe") { invalid() }
        if (prepareFleetChronology(id, true)) {
            _fleetMissions[id].status = FleetMissionStatus.Returned;
        }
    }
}

contract VeydriftMissionBatchTest is Test {
    BatchResolutionHarness h;

    function setUp() public {
        h = new BatchResolutionHarness();
        vm.warp(1000);
    }

    function _seed(uint256 id, bool returning, uint256 origin, uint256 target, uint64 at) private {
        h.seed(
            id,
            returning
                ? VeydriftGameStorage.FleetMissionType.Transport
                : VeydriftGameStorage.FleetMissionType.Attack,
            returning
                ? VeydriftGameStorage.FleetMissionStatus.Returning
                : VeydriftGameStorage.FleetMissionStatus.Outbound,
            origin,
            target,
            at,
            at
        );
    }

    function _items(uint256 a, uint8 al, uint256 b, uint8 bl)
        private
        pure
        returns (MissionResolutionItem[] memory x)
    {
        x = new MissionResolutionItem[](2);
        x[0] = MissionResolutionItem(a, al);
        x[1] = MissionResolutionItem(b, bl);
    }

    function testObservableFailureSelectorAndOutcomeForEveryOccurrence() public {
        _seed(1, false, 2, 1, 800);
        _seed(2, true, 1, 3, 900);
        vm.recordLogs();
        h.resolveFleetMissionBatch(_items(2, 1, 0, 0));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 2);
        assertEq(
            logs[0].topics[0],
            keccak256("FleetMissionBatchItem(uint256,uint256,uint8,uint8,bytes4)")
        );
        assertEq(uint256(logs[0].topics[1]), 0);
        assertEq(uint256(logs[0].topics[2]), 2);
        (uint8 leg, uint8 outcome, bytes4 reason) = abi.decode(logs[0].data, (uint8, uint8, bytes4));
        assertEq(leg, 1);
        assertEq(outcome, 5);
        assertEq(reason, VeydriftGameStorage.FleetMissionNotResolved.selector);
        assertEq(uint256(logs[1].topics[1]), 1);
    }

    function testLinkedArrivalStaysPendingUntilLeadSettles() public {
        _seed(1, false, 2, 1, 800);
        h.seed(
            2,
            VeydriftGameStorage.FleetMissionType.AcsAttack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            3,
            1,
            800,
            1200
        );
        h.link(2, 1);
        (MissionResolutionOutcome[] memory o,) = h.resolveFleetMissionBatch(_items(2, 0, 1, 0));
        assertEq(uint8(o[0]), 1);
        assertEq(uint8(o[1]), 0);
        (o,) = h.resolveFleetMissionBatch(_items(2, 0, 2, 0));
        assertEq(uint8(o[0]), 0);
        assertEq(uint8(o[1]), 2);
    }

    function testReverseArrayCannotSkipEarlierAttackAndUnrelatedBodyProgresses() public {
        _seed(1, false, 2, 1, 800);
        _seed(2, true, 1, 3, 900);
        _seed(3, true, 4, 5, 900);
        (MissionResolutionOutcome[] memory o,) = h.resolveFleetMissionBatch(_items(2, 1, 3, 1));
        assertEq(uint8(o[0]), uint8(MissionResolutionOutcome.Failed));
        assertEq(uint8(o[1]), uint8(MissionResolutionOutcome.Settled));
        assertEq(uint8(h.status(2)), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        (o,) = h.resolveFleetMissionBatch(_items(1, 0, 2, 1));
        assertEq(uint8(o[0]), 0);
        assertEq(uint8(o[1]), 0);
    }

    function testReverseEarlierReturnBecomesPreparationNotFalseArrivalSuccess() public {
        _seed(1, true, 1, 3, 800);
        _seed(2, false, 2, 1, 900);
        (MissionResolutionOutcome[] memory o,) = h.resolveFleetMissionBatch(_items(2, 0, 1, 1));
        assertEq(uint8(o[0]), uint8(MissionResolutionOutcome.Progress));
        assertEq(uint8(o[1]), uint8(MissionResolutionOutcome.AlreadySettled));
        assertEq(uint8(h.status(2)), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
    }

    function testSameTimestampArrivalWinsEvenWithLargerId() public {
        _seed(1, true, 1, 3, 900);
        _seed(2, false, 2, 1, 900);
        (MissionResolutionOutcome[] memory o,) = h.resolveFleetMissionBatch(_items(1, 1, 2, 0));
        assertEq(uint8(o[0]), uint8(MissionResolutionOutcome.Failed));
        assertEq(uint8(o[1]), 0);
    }

    function testDuplicatesInvalidNotDueStaleAndPendingReturn() public {
        _seed(1, true, 1, 3, 900);
        _seed(2, false, 4, 5, 1100);
        MissionResolutionItem[] memory x = new MissionResolutionItem[](7);
        x[0] = MissionResolutionItem(1, 1);
        x[1] = x[0];
        x[2] = MissionResolutionItem(1, 0);
        x[3] = MissionResolutionItem(2, 0);
        x[4] = MissionResolutionItem(2, 1);
        x[5] = MissionResolutionItem(0, 0);
        x[6] = MissionResolutionItem(1, 2);
        (MissionResolutionOutcome[] memory o,) = h.resolveFleetMissionBatch(x);
        assertEq(uint8(o[0]), 0);
        assertEq(uint8(o[1]), 2);
        assertEq(uint8(o[2]), 2);
        assertEq(uint8(o[3]), 4);
        assertEq(uint8(o[4]), 1);
        assertEq(uint8(o[5]), 3);
        assertEq(uint8(o[6]), 3);
    }

    function testEmptyOversizeAndPauseAtomic() public {
        vm.expectRevert(VeydriftGameStorage.InvalidQuantity.selector);
        h.resolveFleetMissionBatch(new MissionResolutionItem[](0));
        vm.expectRevert(VeydriftGameStorage.InvalidQuantity.selector);
        h.resolveFleetMissionBatch(new MissionResolutionItem[](33));
        h.setPaused();
        vm.expectRevert();
        h.resolveFleetMissionBatch(_items(0, 0, 0, 0));
    }

    function testOutOfGasChildRollsBackAndNextIndependentReturnProgresses() public {
        _seed(999, true, 1, 2, 900);
        _seed(1, true, 3, 4, 900);
        uint256 beforeGas = gasleft();
        (MissionResolutionOutcome[] memory o,) =
            h.resolveFleetMissionBatch{gas: 16_500_000}(_items(999, 1, 1, 1));
        emit log_named_uint("poison plus independent execution gas", beforeGas - gasleft());
        assertEq(uint8(o[0]), 5);
        assertEq(uint8(o[1]), 0);
        assertEq(uint8(h.status(999)), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
    }

    function testMaximumCountGasPoisonStillEmitsEveryOutcomeWithinEnvelope() public {
        _seed(999, true, 1, 2, 900);
        MissionResolutionItem[] memory items = new MissionResolutionItem[](32);
        for (uint256 i; i < 32; ++i) {
            items[i] = MissionResolutionItem(999, 1);
        }
        vm.recordLogs();
        uint256 beforeGas = gasleft();
        (MissionResolutionOutcome[] memory outcomes,) =
            h.resolveFleetMissionBatch{gas: 16_500_000}(items);
        uint256 used = beforeGas - gasleft();
        assertEq(vm.getRecordedLogs().length, 32);
        emit log_named_uint("32 poison occurrences maximum execution gas", used);
        assertLt(used, 16_000_000);
        assertEq(outcomes.length, 32);
        assertEq(uint8(outcomes[0]), 5);
        assertEq(uint8(outcomes[31]), 6);
    }

    function testLowGasReportsUnattemptedItemsNotSuccess() public {
        _seed(999, true, 1, 2, 900);
        _seed(1, true, 3, 4, 900);
        (MissionResolutionOutcome[] memory o,) =
            h.resolveFleetMissionBatch{gas: 200_000}(_items(999, 1, 1, 1));
        assertTrue(
            o[1] == MissionResolutionOutcome.GasLimited || o[1] == MissionResolutionOutcome.Settled
        );
        assertTrue(o[0] != MissionResolutionOutcome.Settled);
    }

    function testTinyGasSuccessfulCallHasMeasurementButNoProductiveOutcome() public {
        _seed(1, true, 1, 2, 900);
        _seed(2, true, 3, 4, 900);
        (MissionResolutionOutcome[] memory o, uint256 measured) =
            h.resolveFleetMissionBatch{gas: 100_000}(_items(1, 1, 2, 1));
        assertGt(measured, 0);
        assertLt(measured, 100_000);
        assertEq(uint8(o[0]), uint8(MissionResolutionOutcome.GasLimited));
        assertEq(uint8(o[1]), uint8(MissionResolutionOutcome.GasLimited));
        assertEq(uint8(h.status(1)), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
    }

    function testMeasuredCheapSettlementExcludesWrapperOverhead() public {
        _seed(1, true, 1, 2, 900);
        _seed(2, true, 3, 4, 900);
        uint256 beforeGas = gasleft();
        (MissionResolutionOutcome[] memory o, uint256 measured) =
            h.resolveFleetMissionBatch(_items(1, 1, 2, 1));
        uint256 total = beforeGas - gasleft();
        // --isolate applies refunds; restore them for a conservative pre-refund bound.
        Vm.Gas memory callGas = vm.lastCallGas();
        assertGe(callGas.gasRefunded, 0);
        uint256 refund = uint256(uint64(callGas.gasRefunded));
        uint256 gross = callGas.gasTotalUsed + refund;
        assertGt(measured, 0);
        assertLt(measured, gross);
        // Non-isolated calls may already report gross gas; allow that refund double count.
        assertLt(gross - measured, 30_000 + refund);
        assertGt(total, 0);
        assertEq(uint8(o[0]), uint8(MissionResolutionOutcome.Settled));
        assertEq(uint8(o[1]), uint8(MissionResolutionOutcome.Settled));
        emit log_named_uint("cheap measured execution gas", measured);
    }

    function testBoundedScanIsProgressButRepeatedLinkedNoOpIsPending() public {
        for (uint256 id = 1; id <= 25; ++id) {
            _seed(id, false, id + 100, 1, 900);
        }
        (MissionResolutionOutcome[] memory o, uint256 measured) =
            h.resolveFleetMissionBatch(_items(1, 0, 1, 0));
        assertEq(uint8(o[0]), uint8(MissionResolutionOutcome.Progress));
        assertEq(uint8(o[1]), uint8(MissionResolutionOutcome.Progress));
        assertEq(h.cursor(1), 24);
        assertGt(measured, 0);
        h.seed(
            26,
            VeydriftGameStorage.FleetMissionType.AcsAttack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            200,
            1,
            900,
            1200
        );
        h.link(26, 1);
        (o, measured) = h.resolveFleetMissionBatch(_items(26, 0, 26, 0));
        assertEq(uint8(o[0]), uint8(MissionResolutionOutcome.Pending));
        assertEq(uint8(o[1]), uint8(MissionResolutionOutcome.Pending));
        assertGt(measured, 0); // Spending gas alone never means useful progress.
    }

    function testUnchangedBlockerTracksPrerequisiteScanAndReturnProgress() public {
        _seed(1, true, 1, 3, 800);
        _seed(2, false, 2, 1, 900);
        for (uint256 id = 3; id <= 27; ++id) {
            _seed(id, false, id + 100, 1, 950);
        }
        MissionResolutionItem[] memory items = new MissionResolutionItem[](1);
        items[0] = MissionResolutionItem(2, 0);
        // Two scans of the requested arrival, then three scans of its earlier return.
        for (uint256 i; i < 5; ++i) {
            (MissionResolutionOutcome[] memory o, uint256 measured) =
                h.resolveFleetMissionBatch(items);
            assertEq(uint8(o[0]), uint8(MissionResolutionOutcome.Progress));
            assertGt(measured, 0);
        }
        assertEq(uint8(h.status(1)), uint8(VeydriftGameStorage.FleetMissionStatus.Returned));
        assertEq(uint8(h.status(2)), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
    }

    function testLegacyBoundaryNotBackfilledByBatch() public {
        _seed(1, true, 1, 3, 800);
        h.legacy(1);
        _seed(2, false, 2, 1, 900);
        (MissionResolutionOutcome[] memory o,) = h.resolveFleetMissionBatch(_items(2, 0, 1, 1));
        assertEq(uint8(o[0]), 0);
        assertEq(uint8(o[1]), 0);
        assertFalse(h.registered(1));
        assertTrue(h.registered(2));
    }

    function testMoonResolutionDoesNotClearPlanetDependency() public {
        _seed(1, false, 2, 1, 900);
        _seed(2, false, 3, 1, 900);
        h.link(2, 1);
        h.targetMoon(1);
        // Independent planet return does not depend on the moon attack.
        _seed(3, true, 1, 4, 950);
        (MissionResolutionOutcome[] memory o,) = h.resolveFleetMissionBatch(_items(1, 0, 3, 1));
        assertEq(uint8(o[0]), 0);
        // second planet attack remains a genuine dependency, not an unrelated moon one.
        assertEq(uint8(o[1]), 5);
    }
}
