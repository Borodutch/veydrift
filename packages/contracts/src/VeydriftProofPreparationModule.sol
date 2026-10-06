// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftCombatProtectionModule} from "./VeydriftCombatProtectionModule.sol";
import {VeydriftProofBattle as Proof} from "./libraries/VeydriftProofBattle.sol";
import {VeydriftStagedBattleStorage as Store} from "./libraries/VeydriftStagedBattleStorage.sol";
import {VeydriftBattleResearch} from "./libraries/VeydriftBattleResearch.sol";
import {VeydriftCombatStats} from "./libraries/VeydriftCombatStats.sol";
import {VeydriftCombatPreparation} from "./libraries/VeydriftCombatPreparation.sol";
import {Building, Defense, Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IProofProduction {
    function settleProductionUntil(uint256, uint64) external;
}

interface IProofMoonProduction {
    function prepareMoonCombat(uint256, uint64, uint256) external returns (bool);
}

interface IProofMoonDefense {
    function moonDefensePacked(uint256) external view returns (uint256);
}

/// @notice Inactive prospective path; no result/settlement application.
contract VeydriftProofPreparationModule is VeydriftResourceReserves {
    address private immutable _protectionModule;
    event CombatStageAdvanced(uint256 indexed missionId, uint8 phase, uint256 cursor, uint8 round);

    constructor(address protection) VeydriftResourceReserves(address(0)) {
        _protectionModule = protection;
    }

    function resolveFleetMissionCombatRound(uint256 id) external returns (bool) {
        Store.Battle storage b = Store.battle(id);
        FleetMission storage m = _fleetMissions[id];
        if (!Proof.active(id) || m.missionType != FleetMissionType.Attack) {
            revert Proof.InvalidProofLifecycle();
        }
        if (b.phase >= 16) {
            if (b.phase == 16 && Proof.awaitProof(id)) {
                b.phase = 17;
                ++b.workDone;
                emit CombatStageAdvanced(id, b.phase, b.workDone, 0);
            }
            return false;
        }

        if (b.phase == 0 || b.phase == 14) {
            (bool ok, bytes memory result) = _protectionModule.delegatecall(
                abi.encodeCall(VeydriftCombatProtectionModule.prepare, (id))
            );
            if (!ok) assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
            if (b.phase == 15 && b.blocked) Proof.bypass(id);
            emit CombatStageAdvanced(id, b.phase, b.workDone, 0);
            return false;
        }
        if (b.phase == 15) {
            b.phase = 1;
            if (!m.targetIsMoon) {
                BuildingConstruction memory construction = buildingConstructions[m.targetPlanetId];
                if (construction.active && construction.readyAt <= m.arrivalAt) {
                    IProofProduction(address(this))
                        .settleProductionUntil(m.targetPlanetId, construction.readyAt);
                    delete buildingConstructions[m.targetPlanetId];
                    _snapshotPlanetScore(m.targetPlanetId);
                    _buildingLevels[m.targetPlanetId][construction.building] =
                    construction.targetLevel;
                    if (construction.building == Building.Terraformer) {
                        _planets[m.targetPlanetId].fields += 5;
                    }
                    emit BuildingCompleted(
                        m.targetPlanetId, construction.building, construction.targetLevel
                    );
                }
                IProofProduction(address(this)).settleProductionUntil(m.targetPlanetId, m.arrivalAt);
            }
            ++b.workDone;
            emit CombatStageAdvanced(id, b.phase, b.workDone, 0);
            return false;
        }
        if (b.phase == 1) {
            _snapshotPlanetScore(m.targetPlanetId);
            bool done = true;
            if (!m.targetIsMoon) {
                (done,) = VeydriftCombatPreparation.advance(
                    b.preparation,
                    m.targetPlanetId,
                    shipQueues[m.targetPlanetId],
                    defenseQueues[m.targetPlanetId],
                    _shipQueueBacklogs[m.targetPlanetId],
                    _defenseQueueBacklogs[m.targetPlanetId],
                    _shipQueueTimings[m.targetPlanetId],
                    _defenseQueueTimings[m.targetPlanetId],
                    _shipCounts[m.targetPlanetId],
                    _defenseCounts[m.targetPlanetId],
                    m.arrivalAt,
                    32
                );
            }
            if (done) {
                if (m.targetIsMoon && _moonSystem != address(0)) {
                    (bool versioned, bytes memory version) = _moonSystem.staticcall(
                        abi.encodeWithSignature("moonShipProductionVersion()")
                    );
                    if (versioned && version.length >= 32) {
                        if (!IProofMoonProduction(_moonSystem)
                                .prepareMoonCombat(m.targetPlanetId, m.arrivalAt, 32)) {
                            ++b.workDone;
                            emit CombatStageAdvanced(id, b.phase, b.workDone, 0);
                            return false;
                        }
                    }
                }
                if (VeydriftBattleResearch.impactTimed(id)) {
                    VeydriftCombatStats.settleResearch(
                        researchQueues,
                        _technologyLevels,
                        _planets[m.targetPlanetId].owner,
                        m.arrivalAt
                    );
                }
                {
                    Proof.begin(
                        id,
                        abi.encode(
                            m.targetPlanetId,
                            m.targetIsMoon,
                            _missionTargetMoonGeneration[id],
                            _missionTargetMoonGenerationRecorded[id],
                            m.arrivalAt,
                            _planets[m.targetPlanetId].owner,
                            b.blocked,
                            b.linkedLength,
                            b.stationedLength,
                            _planets[m.targetPlanetId].resources,
                            _riftLockedResources[m.targetPlanetId],
                            _battleRaidPlunderBps[id]
                        )
                    );
                }
                b.phase = 2;
            }
        } else if (b.phase == 2) {
            uint8 unit = uint8(b.cursor++);
            uint32 count;
            if (unit < 16) {
                count = m.targetIsMoon
                    ? _moonShipCounts[m.targetPlanetId][Ship(unit)]
                    : _shipCounts[m.targetPlanetId][Ship(unit)];
            } else {
                uint32[8] memory defenses = _defenseSnapshot(m.targetPlanetId, m.targetIsMoon);
                count = defenses[unit - 16];
            }
            _enrollUnit(b, 0, _planets[m.targetPlanetId].owner, 1, unit, count, m.arrivalAt);
            if (b.cursor == 24) {
                b.cursor = 0;
                b.phase = 3;
            }
        } else if (b.phase == 3) {
            _enrollMission(b, id, 0, m.arrivalAt);
            b.phase = 4;
        } else if (b.phase == 4) {
            // Bound cheap historical scans separately from expensive full-manifest enrollment.
            // Never skip an eligible member: the first new enrollment ends this call's scan.
            for (uint256 scanned; scanned < 32 && b.cursor < b.linkedLength; ++scanned) {
                uint256 linked = _fleetCounterplayMissions[id][b.cursor++];
                if (b.enrolled[linked]) continue;
                FleetMission storage member = _fleetMissions[linked];
                if (_isQualifiedJoinedAttack(id, linked, member)) {
                    _enrollMission(b, linked, 0, m.arrivalAt);
                    break;
                } else if (_qualifiedDefender(id, linked)) {
                    _enrollMission(b, linked, 1, m.arrivalAt);
                    break;
                }
            }
            if (b.cursor == b.linkedLength) {
                b.cursor = 0;
                b.phase = 5;
            }
        } else if (b.phase == 5) {
            if (b.cursor < b.stationedLength) {
                uint256 held = _stationedDefenseMissions[m.targetPlanetId][b.cursor++];
                if (_qualifiedDefender(id, held)) _enrollMission(b, held, 1, m.arrivalAt);
            } else {
                b.cursor = 0;
                Proof.seal(id);
                b.phase = 16;
            }
        } else {
            revert Proof.InvalidProofLifecycle();
        }
        ++b.workDone;
        emit CombatStageAdvanced(id, b.phase, b.workDone, 0);
        return false;
    }

    function _qualifiedDefender(uint256 id, uint256 memberId) private view returns (bool) {
        FleetMission storage a = _fleetMissions[id];
        FleetMission storage d = _fleetMissions[memberId];
        if (
            !_isQualifiedCounterplay(id, d) || d.targetPlanetId != a.targetPlanetId
                || d.targetIsMoon != a.targetIsMoon
        ) return false;
        if (d.missionType != FleetMissionType.DefenseHold && d.randomnessRequestId != id) {
            return false;
        }
        if (
            d.targetIsMoon
                && !_missionMoonExistsForOwner(
                    memberId, d.targetPlanetId, _planets[d.targetPlanetId].owner, false
                )
        ) return false;
        return
            d.missionType != FleetMissionType.DefenseHold
                || _defenseHoldUntil[memberId] >= a.arrivalAt;
    }

    function _enrollMission(Store.Battle storage b, uint256 id, uint8 side, uint64 impact) private {
        if (b.enrolled[id]) return;
        b.enrolled[id] = true;
        b.missions.push(id);
        FleetMission storage m = _fleetMissions[id];
        Proof.source(b.battleId, id, m);
        for (uint8 unit; unit < 16; ++unit) {
            _enrollUnit(
                b, id, m.owner, side, unit, _missionShipQuantity(m.ships, Ship(unit)), impact
            );
        }
    }

    function _enrollUnit(
        Store.Battle storage b,
        uint256 id,
        address owner,
        uint8 side,
        uint8 unit,
        uint32 count,
        uint64 impact
    ) private {
        if (count == 0) return;
        if (Proof.active(b.battleId)) {
            VeydriftBattleResearch.Levels memory levels = VeydriftBattleResearch.capture(
                b.battleId,
                owner,
                impact,
                _technologyLevels[owner][Technology.Weapons],
                _technologyLevels[owner][Technology.Shielding],
                _technologyLevels[owner][Technology.Armor],
                researchQueues[owner]
            );
            Proof.enroll(
                b.battleId,
                Proof.Row(
                    id, owner, count, side, unit, levels.weapons, levels.shielding, levels.armor
                )
            );
            ++b.snapshotCount;
            return;
        }
        revert Proof.InvalidProofLifecycle();
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

    function _isQualifiedJoinedAttack(
        uint256 attackMissionId,
        uint256 memberId,
        FleetMission storage joined
    ) private view returns (bool) {
        if (
            joined.targetIsMoon
                && !_missionMoonExistsForOwner(
                    memberId, joined.targetPlanetId, _planets[joined.targetPlanetId].owner, false
                )
        ) return false;
        return joined.status == FleetMissionStatus.Outbound
            && joined.arrivalAt <= _fleetMissions[attackMissionId].arrivalAt
            && joined.randomnessRequestId == attackMissionId
            && joined.targetPlanetId == _fleetMissions[attackMissionId].targetPlanetId
            && joined.targetIsMoon == _fleetMissions[attackMissionId].targetIsMoon
            && joined.missionType == FleetMissionType.AcsAttack;
    }

    function _defenseSnapshot(uint256 planetId, bool isMoon)
        private
        view
        returns (uint32[8] memory defenses)
    {
        address moonSystem = _moonSystem;
        if (isMoon) {
            uint256 packed = IProofMoonDefense(moonSystem).moonDefensePacked(planetId);
            for (uint8 i = 0; i <= uint8(Defense.LargeShieldDome);) {
                // packed stores eight uint32 lanes, one for each battlefield defense.
                // forge-lint: disable-next-line(unsafe-typecast)
                defenses[i] = uint32(packed >> (uint256(i) * 32));
                unchecked {
                    ++i;
                }
            }
            return defenses;
        }
        for (uint8 i = 0; i <= uint8(Defense.LargeShieldDome);) {
            Defense defense = Defense(i);
            defenses[i] = _defenseCounts[planetId][defense];
            unchecked {
                ++i;
            }
        }
    }

    function _missionShipQuantity(MissionShips memory ships, Ship ship)
        private
        pure
        returns (uint32 quantity)
    {
        uint256 offset = _missionShipMemoryOffset(ship);
        if (offset == type(uint256).max) return 0;
        assembly ("memory-safe") {
            quantity := mload(add(ships, offset))
        }
    }

    function _missionShipMemoryOffset(Ship ship) private pure returns (uint256) {
        uint8 id = uint8(ship);
        if (id == uint8(Ship.SolarSatellite) || id > uint8(Ship.Pathfinder)) {
            return type(uint256).max;
        }
        if (id > uint8(Ship.SolarSatellite)) id -= 1;
        return uint256(id) << 5;
    }
}
