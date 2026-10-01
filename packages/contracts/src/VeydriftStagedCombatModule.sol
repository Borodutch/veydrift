// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftBattleResearch} from "./libraries/VeydriftBattleResearch.sol";
import {VeydriftCombatProtectionModule} from "./VeydriftCombatProtectionModule.sol";
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftCombatAttribution} from "./libraries/VeydriftCombatAttribution.sol";
import {VeydriftCombatStats} from "./libraries/VeydriftCombatStats.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {CombatCohort, VeydriftCombatCohorts} from "./libraries/VeydriftCombatCohorts.sol";
import {VeydriftStagedCohorts as Math} from "./libraries/VeydriftStagedCohorts.sol";
import {VeydriftStagedBattleStorage as Store} from "./libraries/VeydriftStagedBattleStorage.sol";
import {VeydriftCombatPreparation} from "./libraries/VeydriftCombatPreparation.sol";
import {VeydriftResearchHistory} from "./libraries/VeydriftResearchHistory.sol";
import {VeydriftDefenseHoldStorage} from "./libraries/VeydriftDefenseHoldStorage.sol";
import {Building, Defense, Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IVeydriftCombatMoonSystem {
    function requestMoonChanceFromBattle(uint256, uint256, uint128, uint128)
        external
        returns (uint256, uint256);
    function moonDefensePacked(uint256) external view returns (uint256);
    function applyMoonCombatDefenseChanges(uint256, uint256, bool) external;
}

interface IVeydriftCombatRapidfire {
    function repairedDefenseCounts(uint256, uint256) external pure returns (uint256);
}

interface IStagedProduction {
    function settleProductionUntil(uint256, uint64) external;
}

interface IStagedMoonProduction {
    function prepareMoonCombat(uint256, uint64, uint256) external returns (bool);
    function releaseMoonCombat(uint256) external;
}

contract VeydriftStagedCombatModule is VeydriftResourceReserves {
    uint256 private constant MOON_CHANCE_DEBRIS_UNIT = 100_000;
    address private immutable _rapidfireModule;
    address private immutable _protectionModule;
    event CombatEvidenceComplete(
        uint256 indexed battleId,
        uint256 snapshotCount,
        uint256 lossEventCount,
        uint256 lootEventCount,
        uint256 repairEventCount
    );
    event CombatMemberSnapshot(
        uint256 indexed battleId,
        uint256 indexed missionId,
        address indexed owner,
        uint8 side,
        uint8 unit,
        uint32 count
    );
    event CombatDefenseRepair(uint256 indexed battleId, uint8 unit, uint32 count);
    event CombatStageAdvanced(uint256 indexed missionId, uint8 phase, uint256 cursor, uint8 round);
    event CombatMissionLosses(
        uint256 indexed battleId,
        uint256 indexed missionId,
        address indexed owner,
        uint8 side,
        uint8 unit,
        uint32 lost
    );

    constructor(address rapidfire) VeydriftResourceReserves(address(0)) {
        _rapidfireModule = rapidfire;
        _protectionModule = address(new VeydriftCombatProtectionModule());
    }

    // Phases: preparation, resident/leader/linked/held enrollment, round math,
    // proportional floors, remainder selection, member apply, cohort apply, returns, complete.
    function resolveFleetMissionCombatRound(uint256 id) external returns (bool) {
        Store.Battle storage b = Store.battle(id);
        FleetMission storage m = _fleetMissions[id];
        if (b.phase == 0 || b.phase == 14) {
            (bool ok, bytes memory result) = _protectionModule.delegatecall(
                abi.encodeCall(VeydriftCombatProtectionModule.prepare, (id))
            );
            if (!ok) assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
            emit CombatStageAdvanced(id, b.phase, b.workDone, 0);
            return false;
        }
        if (b.phase == 15) {
            if (!b.blocked) b.seed = _battleSeed(id, m);
            _battleResolutionProgress[id].seed = b.seed;
            b.phase = b.blocked ? 3 : 1;
            if (!m.targetIsMoon) {
                BuildingConstruction memory construction = buildingConstructions[m.targetPlanetId];
                if (construction.active && construction.readyAt <= m.arrivalAt) {
                    IStagedProduction(address(this))
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
                IStagedProduction(address(this))
                    .settleProductionUntil(m.targetPlanetId, m.arrivalAt);
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
                        if (!IStagedMoonProduction(_moonSystem)
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
                if (_isQualifiedJoinedAttack(id, member)) {
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
                if (b.blocked || b.math.sides[0].total == 0 || b.math.sides[1].total == 0) {
                    b.phase = 11;
                } else {
                    b.round = 1;
                    Math.startRound(b.math, b.seed, 1);
                    b.phase = 6;
                }
            }
        } else if (b.phase == 6) {
            if (Math.step(b.math, 128)) {
                b.phase = 7;
                b.side = 0;
                b.cohortCursor = 0;
                b.memberCursor = 0;
            }
        } else if (b.phase >= 7 && b.phase <= 10) {
            // At most32 constant-size attribution/application operations; stop at the next
            // round or raid boundary. Same sequence/ties/accounting, fewer paid chunks and
            // retain the unchanged64-stage lazy budget; resolver envelopes remain capped at15M.
            for (uint256 operation; operation < 32 && b.phase >= 7 && b.phase <= 10; ++operation) {
                if (b.phase == 7) VeydriftCombatAttribution.floors(b);
                else if (b.phase == 8) VeydriftCombatAttribution.remainder(b);
                else if (b.phase == 9) _applyMember(id, b, m);
                else _applyCohort(id, b);
            }
        } else if (b.phase == 11) {
            // Raid integration is separately bounded by its own persistent cursor.
            (bool ok, bytes memory data) =
                address(this).call(abi.encodeWithSelector(0x41dfa622, id));
            if (!ok) assembly ("memory-safe") { revert(add(data, 32), mload(data)) }
            if (b.prepared) {
                b.phase = 12;
                b.returnSettlementAt = uint64(block.timestamp);
                b.returnCursor = 0;
                b.cursor = 0;
            }
        } else if (b.phase == 12) {
            if (b.returnCursor < b.missions.length) {
                uint256 memberId = b.missions[b.returnCursor++];
                if (memberId != id) _returnMember(memberId, id, m);
            } else if (b.cursor < b.linkedLength) {
                // Fixed-cost index removals; unlike member settlement this cannot enroll or
                // process a fleet manifest. The explicit record bound also covers cold writes.
                for (uint256 scanned; scanned < 32 && b.cursor < b.linkedLength; ++scanned) {
                    _untrackStagedCounterplay(
                        id, _fleetMissions[_fleetCounterplayMissions[id][b.cursor++]]
                    );
                }
            } else {
                _finish(id, b, m);
                return true;
            }
        } else {
            return true;
        }
        ++b.workDone;
        emit CombatStageAdvanced(id, b.phase, b.workDone, _battleResolutionProgress[id].rounds);
        return false;
    }

    function _qualifiedDefender(uint256 id, uint256 memberId) private view returns (bool) {
        FleetMission storage a = _fleetMissions[id];
        FleetMission storage d = _fleetMissions[memberId];
        if (
            !_isQualifiedCounterplay(id, d) || d.targetPlanetId != a.targetPlanetId
                || d.targetIsMoon != a.targetIsMoon
        ) return false;
        return
            d.missionType != FleetMissionType.DefenseHold
                || _defenseHoldUntil[memberId] >= a.arrivalAt;
    }

    function _enrollMission(Store.Battle storage b, uint256 id, uint8 side, uint64 impact) private {
        if (b.enrolled[id]) return;
        b.enrolled[id] = true;
        b.missions.push(id);
        if (b.blocked) return;
        FleetMission storage m = _fleetMissions[id];
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
        CombatCohort memory c = VeydriftCombatStats.battleCohort(
            b.battleId,
            owner,
            unit,
            count,
            impact,
            _technologyLevels[owner][Technology.Weapons],
            _technologyLevels[owner][Technology.Shielding],
            _technologyLevels[owner][Technology.Armor],
            researchQueues[owner]
        );
        uint256 index = Math.add(b.math, side, c);
        b.cohortMembers[side][index].push(b.members.length);
        b.members.push(Store.Member(id, owner, index, count, 0, 0, unit, side));
        ++b.snapshotCount;
        emit CombatMemberSnapshot(b.battleId, id, owner, side, unit, count);
    }

    function _applyMember(uint256 id, Store.Battle storage b, FleetMission storage attack) private {
        if (b.cursor == b.members.length) {
            b.phase = 10;
            b.side = 0;
            b.cohortCursor = 0;
            return;
        }
        Store.Member storage member = b.members[b.cursor++];
        uint32 lost = member.share;
        if (lost == 0) return;
        member.count -= lost;
        if (member.missionId != 0) {
            VeydriftCombatStats.setMissionShipQuantity(
                _fleetMissions[member.missionId].ships, Ship(member.unit), member.count
            );
        } else if (member.unit < 16) {
            if (attack.targetIsMoon) {
                _setMoonShipCount(attack.targetPlanetId, Ship(member.unit), member.count);
            } else {
                _setPlanetShipCount(attack.targetPlanetId, Ship(member.unit), member.count);
            }
        } else {
            uint256 changes = uint256(lost) << (uint256(member.unit - 16) * 32);
            _applyDefenseChanges(attack.targetPlanetId, attack.targetIsMoon, changes, false);
            _battleResolutionProgress[id].defenderDefenseDestroyed += changes;
        }
        if (member.unit < 16) {
            Resources memory resources = _multiply(_shipCost(Ship(member.unit)), lost);
            BattleResolutionProgress storage p = _battleResolutionProgress[id];
            if (member.side == 0) {
                p.attackerLosses = _add(p.attackerLosses, resources);
                b.roundAttackerMetal += resources.metal;
                b.roundAttackerCrystal += resources.crystal;
            } else {
                p.defenderLosses = _add(p.defenderLosses, resources);
                b.roundDefenderMetal += resources.metal;
                b.roundDefenderCrystal += resources.crystal;
            }
        }
        ++b.lossEventCount;
        emit CombatMissionLosses(id, member.missionId, member.owner, member.side, member.unit, lost);
    }

    function _applyCohort(uint256 id, Store.Battle storage b) private {
        if (b.cohortCursor < Math.cohortCount(b.math, b.side)) {
            uint256 i = b.cohortCursor++;
            Math.setCount(
                b.math,
                b.side,
                i,
                b.math.sides[b.side].cohorts[i].count - Math.loss(b.math, b.side, i)
            );
            return;
        }
        if (b.side == 0) {
            b.side = 1;
            b.cohortCursor = 0;
            return;
        }
        _battleResolutionProgress[id].rounds = b.round;
        emit CombatRoundResolved(
            id,
            b.round,
            b.math.sides[0].total,
            b.math.sides[1].total,
            b.roundAttackerMetal,
            b.roundAttackerCrystal,
            b.roundDefenderMetal,
            b.roundDefenderCrystal
        );
        b.roundAttackerMetal = 0;
        b.roundAttackerCrystal = 0;
        b.roundDefenderMetal = 0;
        b.roundDefenderCrystal = 0;
        if (
            b.round == BATTLE_MAX_ROUNDS || b.math.sides[0].total == 0 || b.math.sides[1].total == 0
        ) {
            b.phase = 11;
        } else {
            ++b.round;
            Math.startRound(b.math, b.seed, b.round);
            b.phase = 6;
        }
    }

    function _untrackStagedCounterplay(uint256 id, FleetMission storage member) private {
        FleetMission storage leader = _fleetMissions[id];
        if (
            member.originPlanetId != leader.originPlanetId
                && member.originPlanetId != leader.targetPlanetId
        ) _removeResolutionMissionForPlanet(member.originPlanetId, id);
        address defender = _planets[leader.targetPlanetId].owner;
        if (member.owner != leader.owner && member.owner != defender) {
            _removeResolutionMissionForPlayer(member.owner, id);
        }
    }

    function _returnMember(uint256 memberId, uint256 id, FleetMission storage attack) private {
        FleetMission storage m = _fleetMissions[memberId];
        if (m.status != FleetMissionStatus.Outbound) return;
        bool alive = _missionShipTotal(m.ships) != 0;
        if (m.missionType == FleetMissionType.DefenseHold && alive) return;
        if (!alive) {
            if (m.missionType == FleetMissionType.DefenseHold) {
                VeydriftDefenseHoldStorage.endHold(
                    _stationedDefenseMissions[m.targetPlanetId],
                    _stationedDefenseMissionIndex[m.targetPlanetId],
                    _defenseHoldUntil,
                    memberId
                );
            }
            m.status = FleetMissionStatus.Resolved;
            m.returnAt = Store.battle(id).returnSettlementAt;
            --activeFleetMissionCount[m.owner];
            _decreaseInternalResources(m.cargo);
            delete m.cargo;
            _untrackMissionResolution(memberId, m);
        } else {
            m.status = FleetMissionStatus.Returning;
            if (memberId != id) {
                m.returnAt = uint64(
                    uint256(Store.battle(id).returnSettlementAt)
                        + (uint256(m.returnAt) - attack.arrivalAt)
                );
            }
            if (memberId != id) {
                _emitFleetMissionReturnExposed(memberId, m, FleetMissionStatus.Returning);
            }
        }
        if (memberId != id) {
            emit FleetMissionResolved(memberId, msg.sender, m.missionType, m.returnAt);
        }
    }

    function _finish(uint256 id, Store.Battle storage b, FleetMission storage m) private {
        BattleResolutionProgress memory p = _battleResolutionProgress[id];
        _returnMember(id, id, m);
        if (!b.blocked) {
            _repairDestroyedDefenses(m, p.defenderDefenseDestroyed, b.seed);
            uint256 repaired = IVeydriftCombatRapidfire(_rapidfireModule)
                .repairedDefenseCounts(p.defenderDefenseDestroyed, b.seed);
            for (uint8 u; u < 8; ++u) {
                // Extract one packed uint32 repair lane; higher lanes are intentionally discarded.
                // forge-lint: disable-next-line(unsafe-typecast)
                uint32 n = uint32(repaired >> (uint256(u) * 32));
                if (n != 0) {
                    ++b.repairEventCount;
                    emit CombatDefenseRepair(id, u + 16, n);
                }
            }
            Resources memory debris =
                _reserveLimitedIncrease(_battleDebris(p.attackerLosses, p.defenderLosses));
            if (debris.metal != 0 || debris.crystal != 0) {
                _debrisFields[m.targetPlanetId].metal += debris.metal;
                _debrisFields[m.targetPlanetId].crystal += debris.crystal;
                _increaseInternalResources(debris);
                _emitDebrisFieldUpdated(m.targetPlanetId);
            }
            BattleOutcome outcome = b.math.sides[0].total != 0 && b.math.sides[1].total == 0
                ? BattleOutcome.AttackerWin
                : b.math.sides[0].total == 0 && b.math.sides[1].total != 0
                    ? BattleOutcome.DefenderWin
                    : BattleOutcome.Draw;
            emit AttackBattleResolved(
                id,
                m.owner,
                m.targetPlanetId,
                outcome,
                p.rounds,
                b.seed,
                m.cargo.metal,
                m.cargo.crystal,
                m.cargo.deuterium
            );
            emit CombatLosses(
                id,
                p.attackerLosses.metal,
                p.attackerLosses.crystal,
                p.attackerLosses.deuterium,
                p.defenderLosses.metal,
                p.defenderLosses.crystal,
                p.defenderLosses.deuterium
            );
            emit CombatDebrisSignaled(id, m.targetPlanetId, debris.metal, debris.crystal);
            _requestMoonChanceFromBattle(id, m.targetPlanetId, debris);
        }
        if (!b.blocked && m.targetIsMoon && _moonSystem != address(0)) {
            (bool versioned, bytes memory version) =
                _moonSystem.staticcall(abi.encodeWithSignature("moonShipProductionVersion()"));
            if (versioned && version.length >= 32) {
                IStagedMoonProduction(_moonSystem).releaseMoonCombat(m.targetPlanetId);
            }
        }
        b.phase = 13;
        ++b.workDone;
        emit CombatStageAdvanced(id, 13, b.workDone, p.rounds);
        delete Store.layout().bodyLock[m.targetPlanetId];
        delete _battleResolutionProgress[id];
        delete _battleRaidPlunderBps[id];
        delete _battleRaidProtectionSnapshotted[id];
        emit CombatEvidenceComplete(
            id, b.snapshotCount, b.lossEventCount, b.lootEventCount, b.repairEventCount
        );
    }

    function _applyDefenseChanges(uint256 planetId, bool isMoon, uint256 changes, bool repair)
        private
    {
        if (isMoon) {
            IVeydriftCombatMoonSystem(_moonSystem)
                .applyMoonCombatDefenseChanges(planetId, changes, repair);
            return;
        }
        for (uint8 i = 0; i <= uint8(Defense.LargeShieldDome);) {
            // changes stores eight uint32 lanes, one for each battlefield defense.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint32 changed = uint32(changes >> (uint256(i) * 32));
            if (changed != 0) {
                Defense defense = Defense(i);
                uint32 current = _defenseCounts[planetId][defense];
                uint32 total =
                    repair ? current + changed : current > changed ? current - changed : 0;
                _setPlanetDefenseCount(planetId, defense, total);
            }
            unchecked {
                ++i;
            }
        }
    }

    function _defenseSnapshot(uint256 planetId, bool isMoon)
        private
        view
        returns (uint32[8] memory defenses)
    {
        address moonSystem = _moonSystem;
        if (isMoon) {
            uint256 packed = IVeydriftCombatMoonSystem(moonSystem).moonDefensePacked(planetId);
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

    function _repairDestroyedDefenses(
        FleetMission storage mission,
        uint256 destroyedDefenses,
        uint256 seed
    ) private {
        uint256 repairedDefenses = IVeydriftCombatRapidfire(_rapidfireModule)
            .repairedDefenseCounts(destroyedDefenses, seed);
        _applyDefenseChanges(mission.targetPlanetId, mission.targetIsMoon, repairedDefenses, true);
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
            && joined.targetIsMoon == _fleetMissions[attackMissionId].targetIsMoon
            && joined.missionType == FleetMissionType.AcsAttack;
    }

    function _emitDebrisFieldUpdated(uint256 planetId) private {
        DebrisField storage field = _debrisFields[planetId];
        emit DebrisFieldUpdated(planetId, field.metal, field.crystal);
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

    function _requestMoonChanceFromBattle(
        uint256 missionId,
        uint256 targetPlanetId,
        Resources memory debris
    ) private {
        if (_moonSystem == address(0)) return;
        if (uint256(debris.metal) + debris.crystal < MOON_CHANCE_DEBRIS_UNIT) return;

        try IVeydriftCombatMoonSystem(_moonSystem)
            .requestMoonChanceFromBattle(
                missionId, targetPlanetId, debris.metal, debris.crystal
            ) returns (
            uint256, uint256
        ) {}
            catch {}
    }

    function _battleSeed(uint256 missionId, FleetMission storage mission)
        private
        view
        returns (uint256)
    {
        uint256 randomWord = _consumeAttackBattleRandomness(
            mission.randomnessRequestId, _attackBattlePurposeHash(missionId)
        );
        return uint256(
            keccak256(
                abi.encode(
                    ATTACK_BATTLE_DOMAIN,
                    block.chainid,
                    missionId,
                    mission.randomnessRequestId,
                    mission.owner,
                    mission.targetPlanetId,
                    mission.arrivalAt,
                    randomWord
                )
            )
        );
    }

    function _consumeAttackBattleRandomness(uint256 requestId, bytes32 purposeHash)
        private
        view
        returns (uint256 randomWord)
    {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0x38d367a300000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), requestId)
            mstore(add(ptr, 0x24), purposeHash)
            if iszero(staticcall(gas(), sload(_randomnessEngine.slot), ptr, 0x44, ptr, 0x20)) {
                returndatacopy(ptr, 0, returndatasize())
                revert(ptr, returndatasize())
            }
            randomWord := mload(ptr)
        }
    }

    function _battleDebris(Resources memory attackerLosses, Resources memory defenderLosses)
        private
        pure
        returns (Resources memory debris)
    {
        debris.metal = _toUint128(
            ((uint256(attackerLosses.metal) + defenderLosses.metal) * COMBAT_DEBRIS_BPS) / BPS
        );
        debris.crystal = _toUint128(
            ((uint256(attackerLosses.crystal) + defenderLosses.crystal) * COMBAT_DEBRIS_BPS) / BPS
        );
    }

    function _attackProtectionPreview(address attacker, uint256 targetPlanetId, bool targetIsMoon)
        private
        view
        returns (AttackBlockReason reason, uint16 plunderBps)
    {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0xdca08aaf))
            mstore(add(ptr, 4), attacker)
            mstore(add(ptr, 36), targetPlanetId)
            mstore(add(ptr, 68), targetIsMoon)
            switch staticcall(gas(), address(), ptr, 100, ptr, 96)
            case 0 {
                returndatacopy(ptr, 0, returndatasize())
                revert(ptr, returndatasize())
            }
            default {
                reason := mload(ptr)
                plunderBps := mload(add(ptr, 64))
            }
        }
    }

    function _combatScaled(uint256 value, uint16 technologyLevel) private pure returns (uint256) {
        return (value * (BPS + uint256(technologyLevel) * 1_000)) / BPS;
    }

    function _missionShipTotal(MissionShips memory ships) private pure returns (uint256) {
        return uint256(ships.smallCargo) + ships.lightFighter + ships.recycler + ships.colonyShip
            + ships.largeCargo + ships.heavyFighter + ships.cruiser + ships.battleship
            + ships.bomber + ships.destroyer + ships.deathstar + ships.battlecruiser + ships.reaper
            + ships.pathfinder;
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

    function _shipCost(Ship ship) private pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(ship);
        return Resources(metal, crystal, deuterium);
    }

    function _multiply(Resources memory resources, uint32 quantity)
        private
        pure
        returns (Resources memory)
    {
        return Resources({
            metal: _toUint128(uint256(resources.metal) * quantity),
            crystal: _toUint128(uint256(resources.crystal) * quantity),
            deuterium: _toUint128(uint256(resources.deuterium) * quantity)
        });
    }
}
