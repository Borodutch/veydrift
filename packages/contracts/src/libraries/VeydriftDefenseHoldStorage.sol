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

    /// @notice Append every DefenseHold fleet that is holding over `attackArrivalAt` into the
    ///         attack's counterplay roster so the existing battle machinery fights them alongside
    ///         the planet's own ships and defenses. This is the on-chain realization of "station a
    ///         fleet for a hold window, defend any attack that lands during it".
    function linkQualifiedDefenders(
        uint256[] storage stationedMissionIds,
        uint256[] storage counterplayMissionIds,
        mapping(
            uint256 missionId => VeydriftGameStorage.FleetMission mission
        ) storage missions,
        mapping(uint256 missionId => uint64 holdUntil) storage defenseHoldUntil,
        uint64 attackArrivalAt,
        bool attackTargetIsMoon
    ) public {
        for (uint256 i = 0; i < stationedMissionIds.length;) {
            uint256 stationedMissionId = stationedMissionIds[i];
            VeydriftGameStorage.FleetMission storage stationed = missions[stationedMissionId];
            if (
                stationed.status == VeydriftGameStorage.FleetMissionStatus.Outbound
                    && stationed.missionType == VeydriftGameStorage.FleetMissionType.DefenseHold
                    && stationed.targetIsMoon == attackTargetIsMoon
                    && stationed.arrivalAt <= attackArrivalAt
                    && defenseHoldUntil[stationedMissionId] >= attackArrivalAt
            ) {
                counterplayMissionIds.push(stationedMissionId);
            }
            unchecked {
                ++i;
            }
        }
    }
}
