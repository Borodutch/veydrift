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
        assertEq(VeydriftAntiRaidPrimitives.missionFuelCost(3, 20_000), 9);
        assertEq(VeydriftAntiRaidPrimitives.recallReturnSeconds(12), 60);
        assertEq(VeydriftAntiRaidPrimitives.recallReturnSeconds(90), 90);
        assertEq(VeydriftAntiRaidPrimitives.recallFuelRefund(100), 0);
    }

    function testRaidLootCapsAndProtectedStorage() public pure {
        uint256 protectedAmount = VeydriftAntiRaidPrimitives.protectedStorageAmount(10_000);
        assertEq(protectedAmount, 5_000);

        assertEq(
            VeydriftAntiRaidPrimitives.raidableResource(
                8_000, 10_000, protectedAmount, VeydriftAntiRaidPrimitives.BASE_RAID_LOOT_BPS
            ),
            300
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
            0
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

        assertTrue(VeydriftAntiRaidPrimitives.isScoreProtected(50_001, 1_000, false));
        assertFalse(VeydriftAntiRaidPrimitives.isScoreProtected(50_001, 1_000, true));
        assertFalse(VeydriftAntiRaidPrimitives.isScoreProtected(10_000, 10_000, false));
    }

    function testDefenderRecoveryPrimitives() public pure {
        assertEq(VeydriftAntiRaidPrimitives.wreckFieldRecovery(10_000), 3_000);
        assertEq(VeydriftAntiRaidPrimitives.repairedDefenseCount(10), 7);
    }
}
