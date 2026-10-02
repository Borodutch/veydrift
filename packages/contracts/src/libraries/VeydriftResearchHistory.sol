// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage} from "../VeydriftGameStorage.sol";
import {Technology} from "./VeydriftTypes.sol";

/// @notice Research levels at scheduled impact time, independent of when queues are settled.
/// @dev Namespaced storage preserves the existing game/module storage layout. History starts with
///      the first completion observed by this library, NOT at game genesis. Its prior stored level
///      is the baseline for earlier cutoffs; without checkpoints the current stored level is used.
///      Already-deleted pre-upgrade queues (and imported historical levels) cannot be reconstructed.
library VeydriftResearchHistory {
    bytes32 private constant STORAGE_SLOT = keccak256("veydrift.storage.ResearchHistory.v1");

    struct Checkpoint {
        uint64 readyAt;
        uint16 level;
    }

    struct History {
        uint16 baseline;
        Checkpoint[] checkpoints;
    }

    struct Layout {
        mapping(address player => mapping(Technology technology => History)) histories;
    }

    error ResearchHistoryOutOfOrder(uint64 previousReadyAt, uint64 readyAt);

    /// @dev A player has one research queue: the next queue starts only after settling the previous
    ///      one, so readyAt is nondecreasing. Equal timestamps are valid; the last level wins.
    function recordCompletion(
        address player,
        Technology technology,
        uint16 priorLevel,
        uint16 completedLevel,
        uint64 readyAt
    ) internal {
        History storage history = _layout().histories[player][technology];
        uint256 length = history.checkpoints.length;
        if (length == 0) {
            history.baseline = priorLevel;
        } else {
            uint64 previousReadyAt = history.checkpoints[length - 1].readyAt;
            if (readyAt < previousReadyAt) {
                revert ResearchHistoryOutOfOrder(previousReadyAt, readyAt);
            }
        }
        history.checkpoints.push(Checkpoint({readyAt: readyAt, level: completedLevel}));
    }

    /// @notice Includes completions at cutoffAt and an active, matching queue due by that cutoff.
    /// @dev O(log checkpoints). The queue overlay also covers a ready queue not yet materialized.
    function levelAt(
        address player,
        Technology technology,
        uint16 currentLevel,
        VeydriftGameStorage.ResearchQueue memory queue,
        uint64 cutoffAt
    ) internal view returns (uint16 level) {
        History storage history = _layout().histories[player][technology];
        uint256 length = history.checkpoints.length;
        level = length == 0 ? currentLevel : history.baseline;
        uint256 low;
        uint256 high = length;
        while (low < high) {
            uint256 mid = low + (high - low) / 2;
            if (history.checkpoints[mid].readyAt <= cutoffAt) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        if (low != 0) level = history.checkpoints[low - 1].level;
        if (queue.active && queue.technology == technology && queue.readyAt <= cutoffAt) {
            level = queue.targetLevel;
        }
    }

    function _layout() private pure returns (Layout storage layout) {
        bytes32 slot = STORAGE_SLOT;
        assembly ("memory-safe") {
            layout.slot := slot
        }
    }
}
