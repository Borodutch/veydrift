// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Reset-aware ordering progress, separate from the existing packed slot-74 index.
/// Raw canonical reader ABI: mapping(planetId => {uint256 generation; uint256 workDone;})
/// at SLOT. Counters survive index invalidation; no inherited layout change.
library VeydriftArrivalProgress {
    bytes32 internal constant SLOT = keccak256("veydrift.storage.arrival-progress.v1");

    struct Progress {
        uint256 generation;
        uint256 workDone;
    }

    struct Layout {
        mapping(uint256 => Progress) planets;
        // Append-only per-mission chronology work, including return-leg preparation.
        mapping(uint256 => uint256) missions;
    }

    function get(uint256 planetId) internal view returns (Progress storage p) {
        bytes32 slot = SLOT;
        Layout storage l;
        assembly ("memory-safe") { l.slot := slot }
        return l.planets[planetId];
    }

    function missionWork(uint256 id) internal view returns (uint256) {
        bytes32 slot = SLOT;
        Layout storage l;
        assembly ("memory-safe") { l.slot := slot }
        return l.missions[id];
    }

    function advanceMission(uint256 id, uint256 operations) internal {
        if (operations == 0) return;
        bytes32 slot = SLOT;
        Layout storage l;
        assembly ("memory-safe") { l.slot := slot }
        l.missions[id] += operations;
    }

    function invalidate(uint256 planetId) internal {
        ++get(planetId).generation;
    }

    function advance(uint256 planetId, uint256 operations) internal {
        get(planetId).workDone += operations;
    }
}
