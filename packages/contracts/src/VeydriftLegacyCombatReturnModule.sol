// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftDefenseHoldStorage} from "./libraries/VeydriftDefenseHoldStorage.sol";

/// @notice Legacy-only terminal bookkeeping. Does not reconstruct rosters, alter RNG or switch
/// combat models. Living holds remain stationed; wiped members release cargo, slots and indices.
contract VeydriftLegacyCombatReturnModule is VeydriftResourceReserves {
    constructor() VeydriftResourceReserves(address(0)) {}

    function returnLinkedMissions(uint256 id) external {
        _returnLinkedMissions(id, _fleetMissions[id]);
    }

    function _returnLinkedMissions(uint256 hostileMissionId, FleetMission storage hostile) private {
        _returnJoinedAttackMissions(hostileMissionId, hostile);
        _returnCounterplayMissions(hostileMissionId, hostile);
    }

    function _returnJoinedAttackMissions(uint256 attackMissionId, FleetMission storage attack)
        private
    {
        uint256[] storage linkedMissionIds = _fleetCounterplayMissions[attackMissionId];
        for (uint256 i = 0; i < linkedMissionIds.length;) {
            uint256 joinedMissionId = linkedMissionIds[i];
            FleetMission storage joined = _fleetMissions[joinedMissionId];
            if (_isQualifiedJoinedAttack(attackMissionId, joined)) {
                if (_missionShipTotal(joined.ships) == 0) {
                    joined.status = FleetMissionStatus.Resolved;
                    joined.returnAt = uint64(block.timestamp);
                    activeFleetMissionCount[joined.owner] -= 1;
                    _decreaseInternalResources(joined.cargo);
                    delete joined.cargo;
                    _untrackMissionResolution(joinedMissionId, joined);
                } else {
                    joined.status = FleetMissionStatus.Returning;
                    joined.returnAt = uint64(
                        block.timestamp + (uint256(joined.returnAt) - uint256(attack.arrivalAt))
                    );
                    _emitFleetMissionReturnExposed(
                        joinedMissionId, joined, FleetMissionStatus.Returning
                    );
                }
                emit FleetMissionResolved(
                    joinedMissionId, msg.sender, joined.missionType, joined.returnAt
                );
            }
            unchecked {
                ++i;
            }
        }
    }

    function _returnCounterplayMissions(uint256 hostileMissionId, FleetMission storage hostile)
        private
    {
        uint256[] storage counterplayMissionIds = _fleetCounterplayMissions[hostileMissionId];
        for (uint256 i = 0; i < counterplayMissionIds.length;) {
            uint256 counterplayMissionId = counterplayMissionIds[i];
            FleetMission storage counterplay = _fleetMissions[counterplayMissionId];
            // DefenseHold fleets keep holding after a battle to defend any further attack in their
            // window; they are sent home by their owner once the hold elapses, not here.
            if (
                _isQualifiedCounterplay(hostileMissionId, counterplay)
                    && (counterplay.missionType != FleetMissionType.DefenseHold
                        || _missionShipTotal(counterplay.ships) == 0)
            ) {
                if (_missionShipTotal(counterplay.ships) == 0) {
                    counterplay.status = FleetMissionStatus.Resolved;
                    counterplay.returnAt = uint64(block.timestamp);
                    activeFleetMissionCount[counterplay.owner] -= 1;
                    _decreaseInternalResources(counterplay.cargo);
                    delete counterplay.cargo;
                    if (counterplay.missionType == FleetMissionType.DefenseHold) {
                        VeydriftDefenseHoldStorage.endHold(
                            _stationedDefenseMissions[counterplay.targetPlanetId],
                            _stationedDefenseMissionIndex[counterplay.targetPlanetId],
                            _defenseHoldUntil,
                            counterplayMissionId
                        );
                    }
                    _untrackMissionResolution(counterplayMissionId, counterplay);
                } else {
                    counterplay.status = FleetMissionStatus.Returning;
                    counterplay.returnAt = uint64(
                        block.timestamp
                            + (uint256(counterplay.returnAt) - uint256(hostile.arrivalAt))
                    );
                    _emitFleetMissionReturnExposed(
                        counterplayMissionId, counterplay, FleetMissionStatus.Returning
                    );
                }
                emit FleetMissionResolved(
                    counterplayMissionId, msg.sender, counterplay.missionType, counterplay.returnAt
                );
            }
            unchecked {
                ++i;
            }
        }
    }

    function _isQualifiedCounterplay(uint256 hostileMissionId, FleetMission storage counterplay)
        private
        view
        returns (bool)
    {
        // DefenseHold fleets stationed over this attack are linked into the counterplay roster at
        // resolution time, so they qualify here and fight exactly like reactive counterplay.
        return counterplay.status == FleetMissionStatus.Outbound
            && counterplay.arrivalAt <= _fleetMissions[hostileMissionId].arrivalAt
            && (counterplay.missionType == FleetMissionType.AcsDefend
                || counterplay.missionType == FleetMissionType.Intercept
                || counterplay.missionType == FleetMissionType.DefenseHold);
    }

    function _isQualifiedJoinedAttack(uint256 attackMissionId, FleetMission storage joined)
        private
        view
        returns (bool)
    {
        return joined.status == FleetMissionStatus.Outbound
            && joined.arrivalAt <= _fleetMissions[attackMissionId].arrivalAt
            && joined.randomnessRequestId == attackMissionId
            && joined.targetPlanetId == _fleetMissions[attackMissionId].targetPlanetId
            && joined.missionType == FleetMissionType.AcsAttack;
    }

    function _missionShipTotal(MissionShips memory ships) private pure returns (uint256) {
        return uint256(ships.smallCargo) + ships.lightFighter + ships.recycler + ships.colonyShip
            + ships.largeCargo + ships.heavyFighter + ships.cruiser + ships.battleship
            + ships.bomber + ships.destroyer + ships.deathstar + ships.battlecruiser + ships.reaper
            + ships.pathfinder;
    }

    function _emitFleetMissionReturnExposed(
        uint256 missionId,
        FleetMission storage mission,
        FleetMissionStatus status
    ) private {
        emit FleetMissionReturnExposed(
            missionId,
            mission.owner,
            status,
            mission.originPlanetId,
            mission.targetPlanetId,
            mission.returnAt,
            mission.cargo.metal,
            mission.cargo.crystal,
            mission.cargo.deuterium
        );
    }
}
