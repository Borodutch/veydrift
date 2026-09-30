// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftResourceReserves} from "../src/VeydriftResourceReserves.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftResearchHistory} from "../src/libraries/VeydriftResearchHistory.sol";
import {Technology} from "../src/libraries/VeydriftTypes.sol";

/// @dev Minimal facade retaining real game storage and both production completion paths.
contract ResearchHistoryHarness is VeydriftResourceReserves {
    address private immutable planetModule;

    constructor(address module) VeydriftResourceReserves(msg.sender) {
        planetModule = module;
    }

    function seedLevel(address player, Technology technology, uint16 level) external {
        _technologyLevels[player][technology] = level;
    }

    function queueResearch(address player, Technology technology, uint16 target, uint64 readyAt)
        external
    {
        researchQueues[player] =
            ResearchQueue(true, technology, target, readyAt, Resources(0, 0, 0));
    }

    function settle(address player, uint64 cutoffAt) external {
        _settleResearchDue(player, cutoffAt);
    }

    function finishResearch() external {
        (bool ok, bytes memory result) = planetModule.delegatecall(msg.data);
        if (!ok) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
    }

    // This focused fixture has no fleets. The production finish path still makes its normal call.
    function settleDuePlayerCombatArrivals(address) external view {
        require(msg.sender == address(this));
    }

    function levelAt(address player, Technology technology, uint64 cutoffAt)
        external
        view
        returns (uint16)
    {
        return VeydriftResearchHistory.levelAt(
            player,
            technology,
            _technologyLevels[player][technology],
            researchQueues[player],
            cutoffAt
        );
    }

    function storedLevel(address player, Technology technology) external view returns (uint16) {
        return _technologyLevels[player][technology];
    }

    function queueActive(address player) external view returns (bool) {
        return researchQueues[player].active;
    }
}

contract VeydriftResearchHistoryTest is Test {
    address private constant PLAYER = address(0x919);
    address private constant OTHER = address(0x920);
    ResearchHistoryHarness private history;

    function setUp() public {
        history = new ResearchHistoryHarness(address(new VeydriftPlanetManagementModule()));
        vm.warp(1_000);
    }

    function testDelayedResolutionExcludesUpgradeAlreadySettledAfterImpact() public {
        history.seedLevel(PLAYER, Technology.Weapons, 5);
        history.queueResearch(PLAYER, Technology.Weapons, 6, 200);
        // An unrelated mutation at t=1000 materializes and deletes the queue before combat resolves.
        history.settle(PLAYER, 1_000);
        assertFalse(history.queueActive(PLAYER));
        assertEq(history.storedLevel(PLAYER, Technology.Weapons), 6);
        assertEq(history.levelAt(PLAYER, Technology.Weapons, 150), 5);
        assertEq(history.levelAt(PLAYER, Technology.Weapons, 200), 6);
        assertEq(history.levelAt(PLAYER, Technology.Weapons, 999), 6);
    }

    function testDueBeforeImpactUsesScheduledReadyAtNotCompletionTransactionTime() public {
        history.seedLevel(PLAYER, Technology.Armor, 3);
        history.queueResearch(PLAYER, Technology.Armor, 4, 200);
        assertEq(history.levelAt(PLAYER, Technology.Armor, 199), 3);
        assertEq(history.levelAt(PLAYER, Technology.Armor, 200), 4);
        assertEq(history.levelAt(PLAYER, Technology.Armor, 300), 4);
        history.settle(PLAYER, 1_000);
        assertEq(history.levelAt(PLAYER, Technology.Armor, 199), 3);
        assertEq(history.levelAt(PLAYER, Technology.Armor, 200), 4);
        assertEq(history.levelAt(PLAYER, Technology.Armor, 300), 4);
    }

    function testActiveQueueAfterImpactStaysPendingAndOtherTechnologyDoesNotOverlay() public {
        history.seedLevel(PLAYER, Technology.Weapons, 8);
        history.seedLevel(PLAYER, Technology.Shielding, 2);
        history.queueResearch(PLAYER, Technology.Shielding, 3, 200);
        history.settle(PLAYER, 199);
        assertTrue(history.queueActive(PLAYER));
        assertEq(history.levelAt(PLAYER, Technology.Shielding, 199), 2);
        assertEq(history.levelAt(PLAYER, Technology.Shielding, 200), 3);
        assertEq(history.levelAt(PLAYER, Technology.Weapons, 300), 8);
    }

    function testExplicitFinishRecordsHistoryAndPreservesReadinessErrors() public {
        history.seedLevel(PLAYER, Technology.Shielding, 7);
        history.queueResearch(PLAYER, Technology.Shielding, 8, 1_100);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.QueueNotReady.selector, uint64(1_100))
        );
        vm.prank(PLAYER);
        history.finishResearch();
        vm.warp(2_000);
        vm.prank(PLAYER);
        history.finishResearch();
        assertFalse(history.queueActive(PLAYER));
        assertEq(history.storedLevel(PLAYER, Technology.Shielding), 8);
        assertEq(history.levelAt(PLAYER, Technology.Shielding, 1_099), 7);
        assertEq(history.levelAt(PLAYER, Technology.Shielding, 1_100), 8);
        vm.expectRevert(VeydriftGameStorage.QueueInactive.selector);
        vm.prank(PLAYER);
        history.finishResearch();
    }

    function testSeveralCompletedUpgradesAndPendingQueuePreserveEveryImpactInterval() public {
        history.seedLevel(PLAYER, Technology.Weapons, 4);
        for (uint16 i = 1; i <= 12; ++i) {
            uint64 readyAt = uint64(i) * 100;
            vm.warp(readyAt + 50);
            history.queueResearch(PLAYER, Technology.Weapons, 4 + i, readyAt);
            if (i % 2 == 0) {
                vm.prank(PLAYER);
                history.finishResearch();
            } else {
                history.settle(PLAYER, readyAt + 50);
            }
        }
        history.queueResearch(PLAYER, Technology.Weapons, 17, 1_300);
        for (uint16 i = 1; i <= 12; ++i) {
            uint64 readyAt = uint64(i) * 100;
            assertEq(history.levelAt(PLAYER, Technology.Weapons, readyAt - 1), 3 + i);
            assertEq(history.levelAt(PLAYER, Technology.Weapons, readyAt), 4 + i);
        }
        assertEq(history.levelAt(PLAYER, Technology.Weapons, 1_299), 16);
        assertEq(history.levelAt(PLAYER, Technology.Weapons, 1_300), 17);
        assertEq(history.levelAt(OTHER, Technology.Weapons, 1_300), 0);
        assertEq(history.levelAt(PLAYER, Technology.Armor, 1_300), 0);
    }

    function testLegacyBaselineIsExplicitlyNotReconstructedHistory() public {
        history.seedLevel(PLAYER, Technology.Armor, 9);
        assertEq(history.levelAt(PLAYER, Technology.Armor, 0), 9);
        history.queueResearch(PLAYER, Technology.Armor, 10, 200);
        history.settle(PLAYER, 1_000);
        assertEq(history.levelAt(PLAYER, Technology.Armor, 0), 9);
        assertEq(history.levelAt(PLAYER, Technology.Armor, 199), 9);
        assertEq(history.levelAt(PLAYER, Technology.Armor, 200), 10);
    }

    function testBackwardReadyAtRejectedAndEqualReadyAtUsesLatestLevel() public {
        history.queueResearch(PLAYER, Technology.Weapons, 1, 200);
        history.settle(PLAYER, 1_000);
        history.queueResearch(PLAYER, Technology.Weapons, 2, 199);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftResearchHistory.ResearchHistoryOutOfOrder.selector, uint64(200), uint64(199)
            )
        );
        history.settle(PLAYER, 1_000);
        assertTrue(history.queueActive(PLAYER));
        assertEq(history.storedLevel(PLAYER, Technology.Weapons), 1);
        history.queueResearch(PLAYER, Technology.Weapons, 2, 200);
        history.settle(PLAYER, 1_000);
        assertEq(history.levelAt(PLAYER, Technology.Weapons, 199), 0);
        assertEq(history.levelAt(PLAYER, Technology.Weapons, 200), 2);
    }

    function testRepeatedSettlementIsIdempotent() public {
        history.queueResearch(PLAYER, Technology.Weapons, 1, 200);
        history.settle(PLAYER, 1_000);
        history.settle(PLAYER, 1_000);
        assertEq(history.levelAt(PLAYER, Technology.Weapons, 199), 0);
        assertEq(history.levelAt(PLAYER, Technology.Weapons, 200), 1);
    }
}
