// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftAntiRaidPrimitives} from "../src/libraries/VeydriftAntiRaidPrimitives.sol";

contract VeydriftAntiRaidPrimitivesTest is Test {
    function testFleetSlotTravelFuelAndRecallPrimitives() public pure {
        assertEq(VeydriftAntiRaidPrimitives.fleetSlotLimit(0), 1);
        assertEq(VeydriftAntiRaidPrimitives.fleetSlotLimit(7), 8);
        assertEq(VeydriftAntiRaidPrimitives.travelSeconds(42), 5 minutes + 42);
        assertEq(VeydriftAntiRaidPrimitives.missionFuelCost(3, 0), 3);
        assertEq(VeydriftAntiRaidPrimitives.missionFuelCost(3, 33), 3);
        assertEq(VeydriftAntiRaidPrimitives.missionFuelCost(3, 20_000), 9);
        assertEq(VeydriftAntiRaidPrimitives.recallReturnSeconds(12), 60);
        assertEq(VeydriftAntiRaidPrimitives.recallReturnSeconds(90), 90);
        assertEq(VeydriftAntiRaidPrimitives.recallFuelRefund(100), 0);
    }

    function testRaidLootCapsAndProtectedStorage() public pure {
        uint256 protectedAmount = VeydriftAntiRaidPrimitives.protectedStorageAmount(10_000);
        assertEq(protectedAmount, 0);

        assertEq(
            VeydriftAntiRaidPrimitives.raidableResource(
                8_000, 10_000, protectedAmount, VeydriftAntiRaidPrimitives.BASE_RAID_LOOT_BPS
            ),
            4_000
        );
        assertEq(
            VeydriftAntiRaidPrimitives.raidableResource(
                8_000, 250, protectedAmount, VeydriftAntiRaidPrimitives.BASE_RAID_LOOT_BPS
            ),
            250
        );
        assertEq(
            VeydriftAntiRaidPrimitives.raidableResource(
                4_999, 10_000, protectedAmount, VeydriftAntiRaidPrimitives.BASE_RAID_LOOT_BPS
            ),
            2_499
        );
        assertEq(
            VeydriftAntiRaidPrimitives.raidableResource(
                8_000, 10_000, protectedAmount, VeydriftAntiRaidPrimitives.HONORABLE_RAID_LOOT_BPS
            ),
            6_000
        );
        assertEq(
            VeydriftAntiRaidPrimitives.raidableResource(
                8_000, 10_000, protectedAmount, VeydriftAntiRaidPrimitives.BANDIT_RAID_LOOT_BPS
            ),
            8_000
        );
    }

    function testVisibilityAcsBashingAndScoreProtectionPrimitives() public pure {
        assertFalse(VeydriftAntiRaidPrimitives.shouldRevealHostileMission(1 hours, 2 hours));
        assertTrue(VeydriftAntiRaidPrimitives.shouldRevealHostileMission(91 minutes, 2 hours));

        assertTrue(VeydriftAntiRaidPrimitives.canJoinAcsDefense(1 hours, 2 hours));
        assertFalse(VeydriftAntiRaidPrimitives.canJoinAcsDefense(116 minutes, 2 hours));

        assertTrue(VeydriftAntiRaidPrimitives.isAttackCooldownActive(1 hours, 70 minutes));
        assertFalse(VeydriftAntiRaidPrimitives.isAttackCooldownActive(1 hours, 80 minutes));

        assertTrue(VeydriftAntiRaidPrimitives.isBashingLimitReached(6, false));
        assertFalse(VeydriftAntiRaidPrimitives.isBashingLimitReached(6, true));

        assertEq(VeydriftAntiRaidPrimitives.newbieProtectionRatioBps(49_999), 50_000);
        assertEq(VeydriftAntiRaidPrimitives.newbieProtectionRatioBps(50_000), 100_000);
        assertEq(VeydriftAntiRaidPrimitives.newbieProtectionRatioBps(500_000), 0);

        assertTrue(VeydriftAntiRaidPrimitives.isScoreProtected(250_001, 49_999, false, false));
        assertTrue(VeydriftAntiRaidPrimitives.isScoreProtected(500_001, 50_000, false, false));
        assertFalse(VeydriftAntiRaidPrimitives.isScoreProtected(500_001, 50_000, true, false));
        assertFalse(VeydriftAntiRaidPrimitives.isScoreProtected(500_001, 50_000, false, true));
        assertFalse(VeydriftAntiRaidPrimitives.isScoreProtected(10_000, 10_000, false, false));

        assertTrue(VeydriftAntiRaidPrimitives.isInactive(1 hours, 8 days));
        assertFalse(VeydriftAntiRaidPrimitives.isInactive(1 hours, 2 hours));
        assertEq(VeydriftAntiRaidPrimitives.plunderBps(false, false), 5_000);
        assertEq(VeydriftAntiRaidPrimitives.plunderBps(true, false), 7_500);
        assertEq(VeydriftAntiRaidPrimitives.plunderBps(true, true), 10_000);
        assertTrue(VeydriftAntiRaidPrimitives.isHonorableTarget(100_000, 50_000, 0, false));
        assertTrue(VeydriftAntiRaidPrimitives.isHonorableTarget(100_000, 1_000, -500, false));
        assertFalse(VeydriftAntiRaidPrimitives.isHonorableTarget(100_000, 1_000, 0, false));
        assertFalse(VeydriftAntiRaidPrimitives.isHonorableTarget(100_000, 50_000, 0, true));
    }

    function testDefenderRecoveryPrimitives() public pure {
        assertEq(VeydriftAntiRaidPrimitives.wreckFieldRecovery(10_000), 3_000);
        assertEq(VeydriftAntiRaidPrimitives.repairedDefenseCount(10), 7);
    }
}
