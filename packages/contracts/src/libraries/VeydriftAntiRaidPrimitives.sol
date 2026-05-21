// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Shared public-state anti-raid constants and pure helpers.
/// @dev These primitives are deliberately contract-side so UI/backend code can preview rules
/// but cannot become the authority for raid safety.
library VeydriftAntiRaidPrimitives {
    uint16 public constant BPS = 10_000;

    uint8 public constant BASE_FLEET_SLOTS = 1;
    uint8 public constant FLEET_SLOTS_PER_COMPUTER_LEVEL = 1;
    uint32 public constant MIN_FLEET_TRAVEL_SECONDS = 5 minutes;
    uint32 public constant MIN_RECALL_SECONDS = 60;
    uint16 public constant RECALL_FUEL_REFUND_BPS = 0;

    uint16 public constant BASE_RAID_LOOT_BPS = 1_000;
    uint16 public constant PROTECTED_STORAGE_BPS = 5_000;
    uint16 public constant WRECK_FIELD_RECOVERY_BPS = 3_000;
    uint16 public constant DEFENSE_REPAIR_BPS = 7_000;

    uint32 public constant HOSTILE_MISSION_REVEAL_SECONDS = 30 minutes;
    uint32 public constant ACS_DEFEND_JOIN_CUTOFF_SECONDS = 5 minutes;
    uint32 public constant ATTACK_COOLDOWN_SECONDS = 15 minutes;
    uint32 public constant BASHING_WINDOW_SECONDS = 24 hours;
    uint8 public constant MAX_ATTACKS_PER_BASHING_WINDOW = 6;

    uint256 public constant NEWBIE_PROTECTION_MIN_DEFENDER_SCORE = 5_000;
    uint16 public constant NEWBIE_PROTECTION_MAX_ATTACKER_SCORE_BPS = 50_000;

    function fleetSlotLimit(uint16 computerLevel) internal pure returns (uint256) {
        return BASE_FLEET_SLOTS + uint256(computerLevel) * FLEET_SLOTS_PER_COMPUTER_LEVEL;
    }

    function travelSeconds(uint256 distance) internal pure returns (uint256) {
        return MIN_FLEET_TRAVEL_SECONDS + distance;
    }

    function missionFuelCost(uint256 shipCount, uint256 distance) internal pure returns (uint256) {
        if (shipCount == 0) return 0;
        return shipCount + (shipCount * distance) / BPS;
    }

    function recallReturnSeconds(uint256 elapsedOutboundSeconds) internal pure returns (uint256) {
        return
            elapsedOutboundSeconds < MIN_RECALL_SECONDS
                ? MIN_RECALL_SECONDS
                : elapsedOutboundSeconds;
    }

    function recallFuelRefund(uint256 fuelCost) internal pure returns (uint256) {
        return (fuelCost * RECALL_FUEL_REFUND_BPS) / BPS;
    }

    function raidableResource(
        uint256 balance,
        uint256 cargoRemaining,
        uint256 protectedAmount,
        uint16 lootCapBps
    ) internal pure returns (uint256) {
        if (cargoRemaining == 0 || balance <= protectedAmount || lootCapBps == 0) return 0;
        uint256 exposed = balance - protectedAmount;
        uint256 loot = (exposed * lootCapBps) / BPS;
        return loot > cargoRemaining ? cargoRemaining : loot;
    }

    function protectedStorageAmount(uint256 storageCap) internal pure returns (uint256) {
        return (storageCap * PROTECTED_STORAGE_BPS) / BPS;
    }

    function shouldRevealHostileMission(uint256 nowTimestamp, uint256 arrivalAt)
        internal
        pure
        returns (bool)
    {
        return nowTimestamp + HOSTILE_MISSION_REVEAL_SECONDS >= arrivalAt;
    }

    function canJoinAcsDefense(uint256 nowTimestamp, uint256 arrivalAt)
        internal
        pure
        returns (bool)
    {
        return nowTimestamp + ACS_DEFEND_JOIN_CUTOFF_SECONDS < arrivalAt;
    }

    function isAttackCooldownActive(uint256 lastAttackAt, uint256 nowTimestamp)
        internal
        pure
        returns (bool)
    {
        return lastAttackAt != 0 && nowTimestamp < lastAttackAt + ATTACK_COOLDOWN_SECONDS;
    }

    function isBashingLimitReached(uint256 attacksInWindow, bool warException)
        internal
        pure
        returns (bool)
    {
        return !warException && attacksInWindow >= MAX_ATTACKS_PER_BASHING_WINDOW;
    }

    function isScoreProtected(
        uint256 attackerScore,
        uint256 defenderScore,
        bool warOrAllianceException
    ) internal pure returns (bool) {
        if (warOrAllianceException) return false;
        if (defenderScore >= NEWBIE_PROTECTION_MIN_DEFENDER_SCORE) return false;
        return attackerScore * BPS > defenderScore * NEWBIE_PROTECTION_MAX_ATTACKER_SCORE_BPS;
    }

    function wreckFieldRecovery(uint256 destroyedStructuralValue) internal pure returns (uint256) {
        return (destroyedStructuralValue * WRECK_FIELD_RECOVERY_BPS) / BPS;
    }

    function repairedDefenseCount(uint256 destroyedDefenseCount) internal pure returns (uint256) {
        return (destroyedDefenseCount * DEFENSE_REPAIR_BPS) / BPS;
    }
}
