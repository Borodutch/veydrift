// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftRefereeBattle as Referee} from "./libraries/VeydriftRefereeBattle.sol";
import {VeydriftRefereeSettlement as S} from "./libraries/VeydriftRefereeSettlement.sol";
import {VeydriftStagedBattleStorage as Store} from "./libraries/VeydriftStagedBattleStorage.sol";
import {VeydriftCombatStats} from "./libraries/VeydriftCombatStats.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {Ship, Defense} from "./libraries/VeydriftTypes.sol";

interface IRefereeSettlementMoon {
    function applyMoonCombatDefenseChanges(uint256, uint256, bool) external;
}

/// @notice Trusted-referee result submission and permissionless bounded application.
/// The owner-configured resolver commits one immutable result per battle; anyone then applies the
/// root-authenticated per-row leaves. Disabled until configureBattleReferee sets a version.
contract VeydriftRefereeSettlementModule is VeydriftResourceReserves {
    constructor() VeydriftResourceReserves(address(0)) {}
    event BattleResultAdvanced(uint256 indexed battleId, uint256 nextIndex, bool economicsReady);
    event CombatMissionLosses(
        uint256 indexed battleId,
        uint256 indexed missionId,
        address indexed owner,
        uint8 side,
        uint8 unit,
        uint32 lost
    );

    event BattleResultSubmitted(
        uint256 indexed battleId,
        bytes32 indexed reportHash,
        bytes32 binding,
        bytes32 root,
        uint256 memberCount,
        uint8 rounds,
        uint256 side0,
        uint256 side1,
        uint8 outcome,
        uint32 version
    );

    event BattleResultReset(uint256 indexed battleId);
    event RefereeBattleVoided(uint256 indexed battleId);

    function configureBattleReferee(Referee.Version calldata version, address resolver)
        external
        onlyOwner
    {
        Referee.configure(version, resolver);
    }

    /// @notice Owner recovery: discards an accepted result before any leaf was applied, so the
    /// (possibly rotated) resolver can submit again. The frozen inputs and seed are unchanged.
    function resetBattleResult(uint256 id) external onlyOwner {
        S.Application storage a = S.layout().jobs[id];
        if (a.phase != S.Phase.Applying || a.nextIndex != 0) revert S.InvalidOutput();
        delete S.layout().jobs[id];
        emit BattleResultReset(id);
    }

    /// @notice Owner recovery for a battle that can never be revealed, replayed or applied: it
    /// ends with no fight, exactly like a protected battle (no casualties, loot, debris, moon
    /// chance or repairs; fleets return, holds stay) and the ordinary economics phases release
    /// the body lock and moon freeze. Once any leaf is applied the battle is upgrade-only.
    function voidRefereeBattle(uint256 id) external onlyOwner {
        Store.Battle storage b = Store.battle(id);
        if ((b.phase != 16 && b.phase != 17) || S.layout().jobs[id].nextIndex != 0) {
            revert S.InvalidOutput();
        }
        delete S.layout().jobs[id];
        Referee.layout().jobs[id].phase = Referee.Phase.Bypassed;
        b.blocked = true;
        b.phase = 11;
        ++b.workDone;
        emit RefereeBattleVoided(id);
    }

    /// @notice Bounded public referee input read: 0=status, 1=header, 2=row[index],
    /// 3=source[index], 4=(prospective version, resolver), 5=(engine, requestId, purpose).
    function refereeBattleRecord(uint256 id, uint8 kind, uint256 index)
        external
        view
        returns (bytes memory)
    {
        return Referee.record(id, kind, index);
    }

    /// @notice Leaf-hash binding for an AwaitingResult battle; zero before the seed is consumed.
    function battleResultBinding(uint256 id) external view returns (bytes32) {
        if (Referee.layout().jobs[id].phase != Referee.Phase.AwaitingResult) return 0;
        return S.chainRecord(id);
    }

    /// @dev Same per-round summary as staged combat's CombatRoundResolved: remaining units per side
    /// after the round and that round's ship losses, so existing battle reports render unchanged.
    struct RoundSummary {
        uint256 attackerUnits;
        uint256 defenderUnits;
        uint128 attackerLossMetal;
        uint128 attackerLossCrystal;
        uint128 defenderLossMetal;
        uint128 defenderLossCrystal;
    }

    /// @notice Resolver-only. Routed through the existing fallback, never decoded by the Game facade.
    function submitBattleResult(
        uint256 id,
        bytes32 root,
        uint256[2] calldata totals,
        bytes32 reportHash,
        RoundSummary[] calldata summary
    ) external {
        _requireGameNotPaused();
        address resolver = Referee.layout().resolver;
        if (resolver == address(0) || msg.sender != resolver) revert Unauthorized(msg.sender);
        Store.Battle storage b = Store.battle(id);
        uint256 last = summary.length;
        if (
            b.phase != 17 || last > 6
                || (last != 0
                    && (summary[last - 1].attackerUnits != totals[0]
                        || summary[last - 1].defenderUnits != totals[1]))
        ) revert S.InvalidOutput();
        // forge-lint: disable-next-line(unsafe-typecast)
        uint8 rounds = uint8(last);
        S.accept(id, root, rounds, totals, reportHash);
        ++b.workDone;
        for (uint256 i; i < last; ++i) {
            RoundSummary calldata r = summary[i];
            emit CombatRoundResolved(
                id,
                // At most six rounds (checked above).
                // forge-lint: disable-next-line(unsafe-typecast)
                uint8(i + 1),
                r.attackerUnits,
                r.defenderUnits,
                r.attackerLossMetal,
                r.attackerLossCrystal,
                r.defenderLossMetal,
                r.defenderLossCrystal
            );
        }
        S.Application storage a = S.layout().jobs[id];
        emit BattleResultSubmitted(
            id,
            reportHash,
            a.binding,
            root,
            a.memberCount,
            rounds,
            totals[0],
            totals[1],
            S.outcome(totals),
            Referee.layout().jobs[id].frozen.version
        );
    }

    /// @notice Complete immutable accepted summary; zero binding/root before acceptance.
    function battleResultSummary(uint256 id)
        external
        view
        returns (
            bytes32 binding,
            bytes32 reportHash,
            bytes32 root,
            uint256 members,
            uint8 rounds,
            uint256[2] memory totals,
            uint8 outcome,
            uint32 version
        )
    {
        S.Application storage a = S.layout().jobs[id];
        if (a.phase == S.Phase.Unaccepted) return (0, 0, 0, 0, 0, totals, 0, 0);
        return (
            a.binding,
            a.reportHash,
            a.root,
            a.memberCount,
            a.rounds,
            a.finalTotals,
            S.outcome(a.finalTotals),
            Referee.layout().jobs[id].frozen.version
        );
    }

    function battleResultProgress(uint256 id)
        external
        view
        returns (S.Phase, uint256, uint256, bytes32)
    {
        S.Application storage a = S.layout().jobs[id];
        return (a.phase, a.nextIndex, a.memberCount, a.expectedDigest);
    }

    function applyBattleResultLeaves(uint256 id, S.Leaf[] calldata leaves) external {
        _requireGameNotPaused();
        S.Application storage a = S.layout().jobs[id];
        Store.Battle storage b = Store.battle(id);
        if (
            a.phase != S.Phase.Applying || b.phase != 17 || leaves.length > 32
                || (leaves.length == 0 && a.nextIndex != a.memberCount)
        ) revert S.InvalidOutput();
        FleetMission storage attack = _fleetMissions[id];
        for (uint256 i; i < leaves.length; ++i) {
            S.Leaf calldata leaf = leaves[i];
            // Verify before inventory mutation. Any later failure rolls back this entire batch.
            S.consume(id, a, leaf);
            _apply(id, attack, b, leaf);
        }
        if (a.nextIndex == a.memberCount) {
            if (
                a.expectedDigest != S.tail(a) || a.appliedTotals[0] != a.finalTotals[0]
                    || a.appliedTotals[1] != a.finalTotals[1]
            ) revert S.InvalidOutput();
            a.phase = S.Phase.Economics;
            b.math.sides[0].total = a.finalTotals[0];
            b.math.sides[1].total = a.finalTotals[1];
            b.seed = Referee.layout().jobs[id].seed;
            b.round = a.rounds;
            _battleResolutionProgress[id].seed = b.seed;
            _battleResolutionProgress[id].rounds = a.rounds;
            b.phase = 11;
            b.cursor = 0;
            // Keep b.missions in original enrollment/raid order, including zero-ship sources.
        }
        ++b.workDone;
        emit BattleResultAdvanced(id, a.nextIndex, a.phase == S.Phase.Economics);
    }

    function _apply(
        uint256 id,
        FleetMission storage attack,
        Store.Battle storage b,
        S.Leaf calldata leaf
    ) private {
        if (leaf.source != 0) {
            FleetMission storage mission = _fleetMissions[leaf.source];
            if (
                !b.enrolled[leaf.source] || mission.owner != leaf.owner || leaf.unit >= 16
                    || leaf.unit == uint8(Ship.SolarSatellite) || leaf.unit == uint8(Ship.Crawler)
            ) revert S.InvalidOutput();
            if (leaf.lost != 0) {
                MissionShips memory ships = mission.ships;
                uint256 offset = leaf.unit > uint8(Ship.SolarSatellite) ? leaf.unit - 1 : leaf.unit;
                uint32 current;
                assembly ("memory-safe") { current := mload(add(ships, mul(offset, 32))) }
                // Floored at live inventory like staged combat: drift never deadlocks a battle.
                VeydriftCombatStats.setMissionShipQuantity(
                    mission.ships, Ship(leaf.unit), current > leaf.lost ? current - leaf.lost : 0
                );
            }
        } else {
            if (leaf.side != 1 || leaf.owner != _planets[attack.targetPlanetId].owner) {
                revert S.InvalidOutput();
            }
            if (leaf.lost != 0) _residentLoss(attack, leaf.unit, leaf.lost);
        }
        if (leaf.lost == 0) return;
        BattleResolutionProgress storage p = _battleResolutionProgress[id];
        if (leaf.unit < 16) {
            (uint128 metal, uint128 crystal, uint128 deuterium) =
                VeydriftCatalog.shipCost(Ship(leaf.unit));
            Resources memory cost = Resources(
                _toUint128(uint256(metal) * leaf.lost),
                _toUint128(uint256(crystal) * leaf.lost),
                _toUint128(uint256(deuterium) * leaf.lost)
            );
            if (leaf.side == 0) p.attackerLosses = _add(p.attackerLosses, cost);
            else p.defenderLosses = _add(p.defenderLosses, cost);
        } else {
            p.defenderDefenseDestroyed += uint256(leaf.lost) << (uint256(leaf.unit - 16) * 32);
        }
        ++b.lossEventCount;
        emit CombatMissionLosses(id, leaf.source, leaf.owner, leaf.side, leaf.unit, leaf.lost);
    }

    /// @dev Like staged combat, losses are floored at live inventory (the moon system floors its
    /// own defense counts), so inventory drift can never deadlock application.
    function _residentLoss(FleetMission storage attack, uint8 unit, uint32 lost) private {
        uint256 body = attack.targetPlanetId;
        if (unit < 16) {
            Ship ship = Ship(unit);
            uint32 current =
                attack.targetIsMoon ? _moonShipCounts[body][ship] : _shipCounts[body][ship];
            current = current > lost ? current - lost : 0;
            if (attack.targetIsMoon) _setMoonShipCount(body, ship, current);
            else _setPlanetShipCount(body, ship, current);
        } else if (attack.targetIsMoon) {
            IRefereeSettlementMoon(_moonSystem)
                .applyMoonCombatDefenseChanges(
                    body, uint256(lost) << (uint256(unit - 16) * 32), false
                );
        } else {
            Defense defense = Defense(unit - 16);
            uint32 current = _defenseCounts[body][defense];
            _setPlanetDefenseCount(body, defense, current > lost ? current - lost : 0);
        }
    }
}
