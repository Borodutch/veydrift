// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftStagedBattleStorage as Store} from "./libraries/VeydriftStagedBattleStorage.sol";
import {VeydriftScoreSnapshot as Scores} from "./libraries/VeydriftScoreSnapshot.sol";
import {VeydriftAntiRaidPrimitives as Rules} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {Technology} from "./libraries/VeydriftTypes.sol";

/// @notice Fixed-work protection preparation with copy-on-write score snapshots.
/// All non-score inputs and fixed-size technology scores are captured on the first call.
/// No gameplay mutation is blocked by score scanning; captures preserve the first-call basis.
contract VeydriftCombatProtectionModule is VeydriftResourceReserves {
    event CombatProtectionSnapshot(
        uint256 indexed battleId,
        uint256 attackerScore,
        uint256 defenderScore,
        bool blocked,
        uint16 plunderBps
    );

    constructor() VeydriftResourceReserves(address(0)) {}

    function prepare(uint256 id) external {
        Store.Battle storage b = Store.battle(id);
        FleetMission storage m = _fleetMissions[id];
        address defender = _planets[m.targetPlanetId].owner;
        if (defender == address(0)) revert NoPlanet();
        if (b.phase == 0) {
            uint256 lockId = Store.layout().bodyLock[m.targetPlanetId];
            if (lockId != 0 && lockId != id) {
                revert FleetMissionNotResolved(_fleetMissions[lockId].arrivalAt);
            }
            Store.layout().bodyLock[m.targetPlanetId] = id;
            b.battleId = id;
            b.linkedLength = _fleetCounterplayMissions[id].length;
            b.stationedLength = _stationedDefenseMissions[m.targetPlanetId].length;
            (bool same,, bool exception) = _attackProtectionAllianceContext(m.owner, defender);
            bool exempt = m.owner == defender || _isAttackProtectionExempt(m.owner, defender);
            b.blocked = (!exempt && same)
                || (m.targetIsMoon
                    && !_missionMoonExistsForOwner(id, m.targetPlanetId, defender, false));
            b.scoreException = exempt || exception
                || Rules.isInactive(playerLastActiveAt[defender], block.timestamp);
            Resources storage locked = _riftLockedResources[m.targetPlanetId];
            b.scoreRift = !m.targetIsMoon
                && (locked.metal != 0 || locked.crystal != 0 || locked.deuterium != 0);
            for (uint8 side; side < 2; ++side) {
                address player = side == 0 ? m.owner : defender;
                Scores.begin(
                    player,
                    id,
                    _ownedPlanetIds[player].length,
                    _resolutionMissionIdsByPlayer[player].length
                );
                for (uint8 u; u <= MAX_TECHNOLOGY_ID; ++u) {
                    b.scores[side] += uint256(_technologyLevels[player][Technology(u)]) * (u + 1)
                    * 15;
                }
            }
            b.phase = 14;
        }
        // Four fixed-size planets or sixteen fixed-size mission records per call. No copied
        // unbounded arrays, no rescans, and no cap on either player's planets or missions.
        for (uint256 work; work < 4 && b.scoreSide < 2; ++work) {
            address player = b.scoreSide == 0 ? m.owner : defender;
            Scores.Snapshot storage snapshot = Scores.layout().snapshots[id][player];
            if (b.scorePhase == 0) {
                if (b.scoreCursor == snapshot.planetLength) {
                    b.scoreCursor = 0;
                    b.scorePhase = 1;
                } else {
                    uint256 planetId = Scores.originalId(
                        id, player, true, _ownedPlanetIds[player], b.scoreCursor++
                    );
                    Scores.Saved storage saved = snapshot.planets[planetId];
                    b.scores[
                        b.scoreSide
                    ] += saved.present
                        ? saved.value
                        : Scores.planetScore(
                            _buildingLevels[planetId],
                            _defenseCounts[planetId],
                            _shipCounts[planetId],
                            _moonShipCounts[planetId]
                        );
                }
            } else {
                for (uint256 n; n < 4 && b.scoreCursor < snapshot.missionLength; ++n) {
                    uint256 memberId = Scores.originalId(
                        id, player, false, _resolutionMissionIdsByPlayer[player], b.scoreCursor++
                    );
                    b.scores[
                        b.scoreSide
                    ] += Scores.originalMissionScore(id, player, _fleetMissions[memberId]);
                }
                if (b.scoreCursor == snapshot.missionLength) {
                    ++b.scoreSide;
                    b.scorePhase = 0;
                    b.scoreCursor = 0;
                }
            }
        }
        if (b.scoreSide == 2) {
            bool protected =
                Rules.isScoreProtected(b.scores[0], b.scores[1], b.scoreException, false);
            b.blocked = b.blocked || (protected && !b.scoreRift);
            _battleRaidPlunderBps[id] = protected ? 0 : Rules.plunderBps();
            _battleRaidProtectionSnapshotted[id] = true;
            b.phase = 15;
            Scores.finish(m.owner, id);
            Scores.finish(defender, id);
            emit CombatProtectionSnapshot(
                id, b.scores[0], b.scores[1], b.blocked, _battleRaidPlunderBps[id]
            );
        }
        ++b.workDone;
    }
}
