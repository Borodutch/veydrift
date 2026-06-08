// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftGameStorage} from "../VeydriftGameStorage.sol";

/// @notice Deployed helpers for player-selectable loot ratios that read or write game storage.
/// @dev Kept in a dedicated library that the size-constrained `VeydriftCombatModule` and
///      `VeydriftGame` link, but `VeydriftGameplayModule` intentionally does NOT import: linking a
///      library that exposes storage-reference functions measurably enlarges every importer under
///      the size-optimized (`optimizer_runs = 1`, `via_ir`) build, so the gameplay launch module is
///      kept clear of it to stay within EIP-170.
library VeydriftRaidStorage {
    using SafeCast for uint256;

    uint16 private constant BPS = 10_000;

    /// @notice Loot a target planet's resources into cargo, honoring an optional loot ratio.
    /// @dev Reads and decrements `target` in place (under the combat module's delegatecall storage
    ///      context) and returns the looted amounts. An all-zero ratio keeps the legacy greedy
    ///      metal->crystal->deuterium fill; otherwise capacity is allocated by the bps shares and
    ///      any unfillable remainder rolls over to the other resources in the same order.
    function raid(
        VeydriftGameStorage.Resources storage target,
        uint256 capacity,
        uint16 plunderRateBps,
        uint16 metalBps,
        uint16 crystalBps,
        uint16 deuteriumBps
    ) public returns (uint128 metal, uint128 crystal, uint128 deuterium) {
        uint256 metalCap = (uint256(target.metal) * plunderRateBps) / BPS;
        uint256 crystalCap = (uint256(target.crystal) * plunderRateBps) / BPS;
        uint256 deuteriumCap = (uint256(target.deuterium) * plunderRateBps) / BPS;

        uint256 m;
        uint256 c;
        uint256 d;
        // Phase 1: honor the requested capacity split (skipped for an all-zero ratio). Deuterium
        // absorbs the rounding remainder so the full capacity is targeted.
        if (uint256(metalBps) + crystalBps + deuteriumBps != 0) {
            uint256 metalTarget = (capacity * metalBps) / BPS;
            uint256 crystalTarget = (capacity * crystalBps) / BPS;
            m = _min(metalTarget, metalCap);
            c = _min(crystalTarget, crystalCap);
            d = _min(capacity - metalTarget - crystalTarget, deuteriumCap);
        }

        // Phase 2: roll unfilled capacity over with a greedy metal->crystal->deuterium fill. This is
        // also the sole pass for the zero-ratio default.
        uint256 remaining = capacity - m - c - d;
        uint256 give = _min(remaining, metalCap - m);
        m += give;
        remaining -= give;
        give = _min(remaining, crystalCap - c);
        c += give;
        remaining -= give;
        d += _min(remaining, deuteriumCap - d);

        metal = m.toUint128();
        crystal = c.toUint128();
        deuterium = d.toUint128();
        target.metal -= metal;
        target.crystal -= crystal;
        target.deuterium -= deuterium;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
