// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage} from "../VeydriftGameStorage.sol";
import {VeydriftAntiRaidPrimitives} from "./VeydriftAntiRaidPrimitives.sol";

/// @notice Deployed body-aware bashing-window writer for the size-constrained DefenseHold module.
/// @dev The public library call executes by delegatecall and mutates the Game proxy's mappings.
library VeydriftBodyAttackWindow {
    function record(
        mapping(uint256 planetId => VeydriftGameStorage.Planet planet) storage planets,
        mapping(
            bytes32 attackKey => VeydriftGameStorage.AttackWindow window
        ) storage attackWindows,
        mapping(bytes32 playerPairKey => bool enabled) storage attackProtectionExemptions,
        mapping(address player => uint64 lastActiveAt) storage playerLastActiveAt,
        uint64 moonAttackParityActivatedAt,
        address attacker,
        uint256 targetPlanetId,
        bool targetIsMoon
    ) public {
        address defender = planets[targetPlanetId].owner;
        if (defender == address(0)) revert VeydriftGameStorage.NoPlanet();
        bool defenderInactive =
            VeydriftAntiRaidPrimitives.isInactive(playerLastActiveAt[defender], block.timestamp);
        if (
            attackProtectionExemptions[keccak256(abi.encode(attacker, defender))]
                || defenderInactive
        ) return;

        bytes32 legacyWindowKey = keccak256(abi.encode(attacker, defender, targetPlanetId));
        VeydriftGameStorage.AttackWindow storage legacyWindow = attackWindows[legacyWindowKey];
        uint64 currentTime = uint64(block.timestamp);
        bool legacyWindowActive = moonAttackParityActivatedAt != 0
            && legacyWindow.windowStartedAt != 0
            && legacyWindow.windowStartedAt <= moonAttackParityActivatedAt
            && currentTime
                < uint256(legacyWindow.windowStartedAt)
                    + VeydriftAntiRaidPrimitives.BASHING_WINDOW_SECONDS;
        bytes32 windowKey = targetIsMoon && !legacyWindowActive
            ? keccak256(
                abi.encode("VEYDRIFT_MOON_ATTACK_WINDOW", attacker, defender, targetPlanetId)
            )
            : legacyWindowKey;
        VeydriftGameStorage.AttackWindow storage window = attackWindows[windowKey];
        if (
            window.windowStartedAt == 0
                || currentTime
                    >= window.windowStartedAt + VeydriftAntiRaidPrimitives.BASHING_WINDOW_SECONDS
        ) {
            window.windowStartedAt = currentTime;
            window.count = 1;
        } else {
            window.count += 1;
        }
    }
}
