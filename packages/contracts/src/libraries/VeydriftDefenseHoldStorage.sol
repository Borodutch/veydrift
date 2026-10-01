// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage} from "../VeydriftGameStorage.sol";

/// @notice Deployed helper for OGame-style ACS Defend (DefenseHold) stationing bookkeeping.
/// @dev Public functions execute under the caller's delegatecall storage context (like the other
///      Veydrift `*Storage` libraries) so the size-constrained game modules stay within EIP-170.
///      Events are emitted here; under delegatecall they are attributed to the game proxy address
///      with the same topic hashes the game contract declares, so indexers see them unchanged.
library VeydriftDefenseHoldStorage {
    event DefenseHoldStationed(
        uint256 indexed missionId,
        address indexed owner,
        uint256 indexed defenderPlanetId,
        uint256 originPlanetId,
        uint64 arrivalAt,
        uint64 holdUntil,
        uint64 returnAt
    );

    /// @notice Station a freshly launched DefenseHold fleet at its target planet for `holdUntil`.
    function beginHold(
        uint256[] storage stationedMissionIds,
        mapping(uint256 missionId => uint256 indexPlusOne) storage indexByMission,
        mapping(uint256 missionId => uint64 holdUntil) storage defenseHoldUntil,
        mapping(uint256 missionId => VeydriftGameStorage.FleetMission mission) storage missions,
        uint256 missionId,
        uint64 holdUntil
    ) public {
        defenseHoldUntil[missionId] = holdUntil;
        if (indexByMission[missionId] == 0) {
            stationedMissionIds.push(missionId);
            indexByMission[missionId] = stationedMissionIds.length;
        }
        VeydriftGameStorage.FleetMission storage mission = missions[missionId];
        emit DefenseHoldStationed(
            missionId,
            mission.owner,
            mission.targetPlanetId,
            mission.originPlanetId,
            mission.arrivalAt,
            holdUntil,
            mission.returnAt
        );
    }

    /// @notice Remove a DefenseHold fleet from a planet's roster (hold elapsed or recalled before
    ///         arrival) using swap-and-pop and clear its hold.
    function endHold(
        uint256[] storage stationedMissionIds,
        mapping(uint256 missionId => uint256 indexPlusOne) storage indexByMission,
        mapping(uint256 missionId => uint64 holdUntil) storage defenseHoldUntil,
        uint256 missionId
    ) public {
        uint256 indexPlusOne = indexByMission[missionId];
        if (indexPlusOne != 0) {
            uint256 index = indexPlusOne - 1;
            uint256 lastIndex = stationedMissionIds.length - 1;
            if (index != lastIndex) {
                uint256 movedMissionId = stationedMissionIds[lastIndex];
                stationedMissionIds[index] = movedMissionId;
                indexByMission[movedMissionId] = indexPlusOne;
            }
            stationedMissionIds.pop();
            delete indexByMission[missionId];
        }
        defenseHoldUntil[missionId] = 0;
    }
}
