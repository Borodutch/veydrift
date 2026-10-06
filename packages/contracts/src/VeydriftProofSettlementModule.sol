// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftProofBattle as Proof} from "./libraries/VeydriftProofBattle.sol";
import {VeydriftProofSettlement as S} from "./libraries/VeydriftProofSettlement.sol";
import {VeydriftStagedBattleStorage as Store} from "./libraries/VeydriftStagedBattleStorage.sol";
import {VeydriftCombatStats} from "./libraries/VeydriftCombatStats.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {Ship, Defense} from "./libraries/VeydriftTypes.sol";

interface IProofSettlementMoon {
    function moonDefensePacked(uint256) external view returns (uint256);
    function applyMoonCombatDefenseChanges(uint256, uint256, bool) external;
}

/// @notice Permissionless bounded application ONLY after authenticated acceptance.
/// No reachable production acceptance function exists in this checkpoint.
contract VeydriftProofSettlementModule is VeydriftResourceReserves {
    constructor() VeydriftResourceReserves(address(0)) {}
    event ProofOutputAdvanced(uint256 indexed battleId, uint256 nextIndex, bool economicsReady);
    event CombatMissionLosses(
        uint256 indexed battleId,
        uint256 indexed missionId,
        address indexed owner,
        uint8 side,
        uint8 unit,
        uint32 lost
    );

    function proofSettlementProgress(uint256 id)
        external
        view
        returns (S.Phase, uint256, uint256, bytes32)
    {
        S.Application storage a = S.layout().jobs[id];
        return (a.phase, a.nextIndex, a.memberCount, a.expectedDigest);
    }

    function applyProofBattleLeaves(uint256 id, S.Leaf[] calldata leaves) external {
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
            S.consume(a, leaf);
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
            b.seed = Proof.layout().jobs[id].seed;
            b.round = a.rounds;
            _battleResolutionProgress[id].seed = b.seed;
            _battleResolutionProgress[id].rounds = a.rounds;
            b.phase = 11;
            b.cursor = 0;
            // Keep b.missions in original enrollment/raid order, including zero-ship sources.
        }
        ++b.workDone;
        emit ProofOutputAdvanced(id, a.nextIndex, a.phase == S.Phase.Economics);
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
                if (current < leaf.lost) revert S.InsufficientLiveInventory();
                VeydriftCombatStats.setMissionShipQuantity(
                    mission.ships, Ship(leaf.unit), current - leaf.lost
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

    function _residentLoss(FleetMission storage attack, uint8 unit, uint32 lost) private {
        uint256 body = attack.targetPlanetId;
        if (unit < 16) {
            Ship ship = Ship(unit);
            uint32 current =
                attack.targetIsMoon ? _moonShipCounts[body][ship] : _shipCounts[body][ship];
            if (current < lost) revert S.InsufficientLiveInventory();
            if (attack.targetIsMoon) _setMoonShipCount(body, ship, current - lost);
            else _setPlanetShipCount(body, ship, current - lost);
        } else {
            Defense defense = Defense(unit - 16);
            if (attack.targetIsMoon) {
                uint256 packed = IProofSettlementMoon(_moonSystem).moonDefensePacked(body);
                uint32 current = uint32(packed >> (uint256(unit - 16) * 32));
                if (current < lost) revert S.InsufficientLiveInventory();
                IProofSettlementMoon(_moonSystem)
                    .applyMoonCombatDefenseChanges(
                        body, uint256(lost) << (uint256(unit - 16) * 32), false
                    );
            } else {
                uint32 current = _defenseCounts[body][defense];
                if (current < lost) revert S.InsufficientLiveInventory();
                _setPlanetDefenseCount(body, defense, current - lost);
            }
        }
    }
}
