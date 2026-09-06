// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {Defense, Technology} from "./libraries/VeydriftTypes.sol";

interface IVeydriftMissileTargetQueueSettler {
    function completeAttackTargetSnapshotQueues(uint256 planetId, uint64 cutoffAt) external;
}

/// @notice Delegatecall target for timed, one-way interplanetary missile missions.
contract VeydriftMissileModule is VeydriftResourceReserves {
    bytes4 private constant ATTACK_PROTECTION_STATUS_SELECTOR = 0x8a6b2246;

    constructor() VeydriftResourceReserves(address(0)) {}

    function launchInterplanetaryMissileAttack(
        uint256 originPlanetId,
        uint256 targetPlanetId,
        Defense primaryTarget,
        uint32 quantity
    ) external returns (uint256 missionId) {
        _touchPlayer(msg.sender);
        Planet storage origin = _planets[originPlanetId];
        if (origin.owner == address(0)) revert NoPlanet();
        if (origin.owner != msg.sender) revert NotPlanetOwner();
        if (originPlanetId == targetPlanetId) revert SamePlanet();
        Planet storage target = _planets[targetPlanetId];
        if (target.owner == address(0)) revert NoPlanet();
        _settleDueCombatArrivals(msg.sender);
        _requireNoPendingMissionResolutionForPlanet(originPlanetId);
        _requireNoPendingMissionResolutionForPlanet(targetPlanetId);
        // Complete ready origin production before checking inventory. Target interception and damage
        // are deliberately deferred until arrival, when queues are settled only through impactAt.
        _settleDuePlanet(originPlanetId);
        if (primaryTarget > Defense.LargeShieldDome) revert InvalidMissileTarget(primaryTarget);
        _enforceAttackProtection(msg.sender, targetPlanetId);

        uint256 systemDistance = _systemDistance(origin.system, target.system);
        uint256 range = _interplanetaryMissileRange(msg.sender);
        if (origin.galaxy != target.galaxy || systemDistance > range) {
            revert InterplanetaryMissileOutOfRange(origin.system, target.system, range);
        }

        uint32 available = _defenseCounts[originPlanetId][Defense.InterplanetaryMissile];
        if (quantity == 0 || available < quantity) revert InvalidQuantity();
        _debitPlanetDefenses(originPlanetId, Defense.InterplanetaryMissile, quantity);

        uint64 departureAt = _currentTimestamp();
        uint64 arrivalAt =
            uint64(uint256(departureAt) + _interplanetaryMissileTravelSeconds(systemDistance));
        missionId = nextFleetId++;
        _fleetMissions[missionId] = FleetMission({
            status: FleetMissionStatus.Outbound,
            missionType: FleetMissionType.MissileAttack,
            owner: msg.sender,
            originPlanetId: originPlanetId,
            targetPlanetId: targetPlanetId,
            departureAt: departureAt,
            arrivalAt: arrivalAt,
            returnAt: arrivalAt,
            fuelCost: 0,
            cargo: Resources({metal: 0, crystal: 0, deuterium: 0}),
            ships: MissionShips({
                smallCargo: 0,
                lightFighter: 0,
                recycler: 0,
                colonyShip: 0,
                largeCargo: 0,
                heavyFighter: 0,
                cruiser: 0,
                battleship: 0,
                bomber: 0,
                destroyer: 0,
                deathstar: 0,
                battlecruiser: 0,
                reaper: 0,
                pathfinder: 0
            }),
            randomnessRequestId: 0,
            lootRatio: LootRatio({metalBps: 0, crystalBps: 0, deuteriumBps: 0}),
            originIsMoon: false,
            targetIsMoon: false
        });
        _missileMissionPrimaryTarget[missionId] = primaryTarget;
        _missileMissionQuantity[missionId] = quantity;
        _addMissileArrival(targetPlanetId, missionId);

        emit FleetMissionLaunched(
            missionId,
            msg.sender,
            FleetMissionType.MissileAttack,
            originPlanetId,
            targetPlanetId,
            arrivalAt,
            arrivalAt,
            0
        );
        emit FleetMissionCargo(missionId, 0, 0, 0, 0);
        emit FleetMissionShips(missionId, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        emit InterplanetaryMissileLaunched(missionId, primaryTarget, quantity);
    }

    function resolveFleetMission(uint256 missionId) external {
        _requireGameNotPaused();
        FleetMission storage mission = _fleetMissions[missionId];
        if (mission.status != FleetMissionStatus.Outbound) return;
        if (mission.missionType != FleetMissionType.MissileAttack) {
            revert InvalidMissionType(mission.missionType);
        }
        if (_currentTimestamp() < mission.arrivalAt) revert FleetNotArrived(mission.arrivalAt);

        _requireEarliestPendingMissionForPlanet(missionId, mission.targetPlanetId);

        IVeydriftMissileTargetQueueSettler(address(this))
            .completeAttackTargetSnapshotQueues(mission.targetPlanetId, mission.arrivalAt);
        Defense primaryTarget = _missileMissionPrimaryTarget[missionId];
        uint32 quantity = _missileMissionQuantity[missionId];
        uint32 antiBallistic = _defenseCounts[mission.targetPlanetId][Defense.AntiBallisticMissile];
        uint32 intercepted = antiBallistic < quantity ? antiBallistic : quantity;
        _debitPlanetDefenses(mission.targetPlanetId, Defense.AntiBallisticMissile, intercepted);

        uint32 hits = quantity - intercepted;
        uint32 targetDefense = _defenseCounts[mission.targetPlanetId][primaryTarget];
        uint32 destroyedPrimary = targetDefense < hits ? targetDefense : hits;
        _debitPlanetDefenses(mission.targetPlanetId, primaryTarget, destroyedPrimary);

        mission.status = FleetMissionStatus.Resolved;
        _removeMissileArrival(mission.targetPlanetId, missionId);
        // The historical impact event predates timed missions and its indexer fallback subtracts
        // launched IPMs when no authoritative origin total exists in the same transaction. Repeat
        // the unchanged post-launch total here so new two-transaction strikes cannot be debited twice.
        emit PlanetDefenseCountChanged(
            mission.originPlanetId,
            Defense.InterplanetaryMissile,
            _defenseCounts[mission.originPlanetId][Defense.InterplanetaryMissile]
        );
        emit InterplanetaryMissileAttack(
            mission.owner,
            mission.originPlanetId,
            mission.targetPlanetId,
            primaryTarget,
            quantity,
            intercepted,
            hits,
            destroyedPrimary
        );
        emit FleetMissionResolved(
            missionId, msg.sender, FleetMissionType.MissileAttack, mission.arrivalAt
        );
    }

    function _addMissileArrival(uint256 planetId, uint256 missionId) private {
        uint256[] storage heap = _missileArrivalHeapByPlanet[planetId];
        if (_missileArrivalHeapIndexByPlanet[planetId][missionId] != 0) return;
        uint256 previousHead = heap.length == 0 ? 0 : heap[0];
        heap.push(missionId);
        uint256 index = heap.length - 1;
        _missileArrivalHeapIndexByPlanet[planetId][missionId] = index + 1;
        while (index != 0) {
            uint256 parent = (index - 1) / 2;
            if (!_missileArrivalPrecedes(heap[index], heap[parent])) break;
            _swapMissileArrivals(planetId, heap, index, parent);
            index = parent;
        }
        _replaceMissileArrivalHead(planetId, previousHead, heap[0]);
    }

    function _removeMissileArrival(uint256 planetId, uint256 missionId) private {
        uint256 indexPlusOne = _missileArrivalHeapIndexByPlanet[planetId][missionId];
        if (indexPlusOne == 0) return;
        uint256[] storage heap = _missileArrivalHeapByPlanet[planetId];
        uint256 previousHead = heap[0];
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = heap.length - 1;
        delete _missileArrivalHeapIndexByPlanet[planetId][missionId];
        if (index == lastIndex) {
            heap.pop();
            _replaceMissileArrivalHead(planetId, previousHead, heap.length == 0 ? 0 : heap[0]);
            return;
        }

        uint256 movedMissionId = heap[lastIndex];
        heap[index] = movedMissionId;
        heap.pop();
        _missileArrivalHeapIndexByPlanet[planetId][movedMissionId] = index + 1;

        if (index != 0) {
            uint256 parent = (index - 1) / 2;
            if (_missileArrivalPrecedes(heap[index], heap[parent])) {
                while (index != 0) {
                    parent = (index - 1) / 2;
                    if (!_missileArrivalPrecedes(heap[index], heap[parent])) break;
                    _swapMissileArrivals(planetId, heap, index, parent);
                    index = parent;
                }
                return;
            }
        }

        while (true) {
            uint256 left = index * 2 + 1;
            if (left >= heap.length) break;
            uint256 right = left + 1;
            uint256 next = right < heap.length && _missileArrivalPrecedes(heap[right], heap[left])
                ? right
                : left;
            if (!_missileArrivalPrecedes(heap[next], heap[index])) break;
            _swapMissileArrivals(planetId, heap, index, next);
            index = next;
        }
        _replaceMissileArrivalHead(planetId, previousHead, heap[0]);
    }

    /// @dev The shared resolution list retains exactly one missile per target: the heap head. This
    /// keeps every legacy guard fleet-slot-bounded while preserving its existing ordering logic.
    function _replaceMissileArrivalHead(uint256 planetId, uint256 previousHead, uint256 nextHead)
        private
    {
        if (previousHead == nextHead) return;
        if (previousHead != 0) _removeResolutionMissionForPlanet(planetId, previousHead);
        if (nextHead != 0) _addResolutionMissionForPlanet(planetId, nextHead);
    }

    function _swapMissileArrivals(
        uint256 planetId,
        uint256[] storage heap,
        uint256 first,
        uint256 second
    ) private {
        uint256 firstMissionId = heap[first];
        uint256 secondMissionId = heap[second];
        heap[first] = secondMissionId;
        heap[second] = firstMissionId;
        _missileArrivalHeapIndexByPlanet[planetId][secondMissionId] = first + 1;
        _missileArrivalHeapIndexByPlanet[planetId][firstMissionId] = second + 1;
    }

    function _missileArrivalPrecedes(uint256 firstMissionId, uint256 secondMissionId)
        private
        view
        returns (bool)
    {
        uint64 firstArrival = _fleetMissions[firstMissionId].arrivalAt;
        uint64 secondArrival = _fleetMissions[secondMissionId].arrivalAt;
        return firstArrival < secondArrival
            || (firstArrival == secondArrival && firstMissionId < secondMissionId);
    }

    function _enforceAttackProtection(address attacker, uint256 targetPlanetId) private view {
        if (_planets[targetPlanetId].owner == attacker) revert SelfAttack();
        (bool ok, bytes memory data) = address(this)
            .staticcall(
                abi.encodeWithSelector(ATTACK_PROTECTION_STATUS_SELECTOR, attacker, targetPlanetId)
            );
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(data, 32), mload(data))
            }
        }
        if (data.length < 32) return;
        AttackBlockReason reason = abi.decode(data, (AttackBlockReason));
        if (reason == AttackBlockReason.ScoreProtection) revert AttackScoreProtection();
        if (reason == AttackBlockReason.SameAlliance) revert SameAllianceAttack();
    }

    function _interplanetaryMissileRange(address attacker) private view returns (uint256) {
        uint16 impulseDrive = _technologyLevels[attacker][Technology.ImpulseDrive];
        if (impulseDrive == 0) return 0;
        return uint256(impulseDrive) * 5 - 1;
    }

    function _systemDistance(uint16 originSystem, uint16 targetSystem)
        private
        pure
        returns (uint256)
    {
        return originSystem > targetSystem
            ? uint256(originSystem - targetSystem)
            : uint256(targetSystem - originSystem);
    }

    function _interplanetaryMissileTravelSeconds(uint256 systemDistance)
        private
        pure
        returns (uint256)
    {
        uint256 baseSeconds = 30 + 60 * systemDistance;
        return (baseSeconds + FLEET_UNIVERSE_SPEED / 2) / FLEET_UNIVERSE_SPEED;
    }

    function _currentTimestamp() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}
