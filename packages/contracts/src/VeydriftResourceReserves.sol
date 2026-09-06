// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftGameStorage, IERC20ReserveToken} from "./VeydriftGameStorage.sol";
import {Building, Resource, Technology} from "./libraries/VeydriftTypes.sol";

/// @dev Self-call surface used by the lazy reconcile to drain a planet's ready ship/defense
///      production queues. The facade exposes `completeAttackTargetSnapshotQueues` (self-only) and
///      fans it out to the colonization (ship) and defense-production (defense) module impls.
interface IVeydriftUnitQueueSettler {
    function completeAttackTargetSnapshotQueues(uint256 planetId, uint64 cutoffAt) external;
}

/// @dev Self-call surface used by the lazy fleet reconcile to resolve a player's due Colonize
///      arrivals (VEY-KANEO-468 Phase 2a). The facade exposes `settleDuePlayerColonizeArrivals`
///      (self-only) and fans it out to the colonization module impl, which owns Colonize resolution.
interface IVeydriftColonizeArrivalSettler {
    function settleDuePlayerColonizeArrivals(address player) external;
}

/// @dev Self-call surface used by the lazy fleet reconcile to resolve a player's due Attack/Harvest
///      combat arrivals (VEY-KANEO-468 Phase 2b). The facade exposes `settleDuePlayerCombatArrivals`
///      (self-only) and fans it out to the planet-management module impl. Combat resolution is gated
///      on asynchronous randomness, so each per-mission resolve is wrapped in try/catch: when the
///      battle seed is not yet committed the resolve reverts and is skipped (mission stays pending),
///      and the residual `_requireNoPendingMissionResolution*` gate still protects the action.
interface IVeydriftCombatArrivalSettler {
    function settleDuePlayerCombatArrivals(address player) external;
}

/// @notice ERC-20 reserve backing and internal resource accounting shared by gameplay modules.
abstract contract VeydriftResourceReserves is VeydriftGameStorage {
    using SafeCast for uint256;

    constructor(address admin) VeydriftGameStorage(admin) {}

    /// @notice Lazy on-chain reconciliation for a planet (VEY-KANEO-468): applies every completion
    ///         whose `readyAt` has elapsed as of now for `planetId` and its owner — ready research
    ///         (player scoped) and ready ship/defense production (planet scoped) — without requiring
    ///         a dedicated finish tx. Idempotent and bounded: each drain advances one ready queue
    ///         entry per iteration and stops at the first not-yet-ready entry.
    /// @dev A single self-call into `completeAttackTargetSnapshotQueues` fans the work out to the
    ///      colonization (research + ship) and defense-production (defense) module impls — so the
    ///      reconcile bodies live once, and every caller pays only a cheap external call. The facade
    ///      gates that entrypoint to `msg.sender == address(this)`, and the drain impls never re-enter
    ///      settlement, so this cannot recurse. Callers invoke this after settling resource production
    ///      (`_settleResourcesUntil`), so a completion landing mid-window does not retroactively
    ///      rescale the settled window. Building completion stays folded into `_settleResourcesUpTo`.
    function _settleDuePlanet(uint256 planetId) internal {
        IVeydriftUnitQueueSettler(address(this))
            .completeAttackTargetSnapshotQueues(planetId, uint64(block.timestamp));
    }

    /// @notice Lazy fleet reconcile, Colonize leg (VEY-KANEO-468 Phase 2a): resolves every Colonize
    ///         mission `player` owns whose `arrivalAt` has elapsed, the moment any mutating call
    ///         touches `player` — no keeper/resolve tx required.
    /// @dev A single self-call into the (self-only) facade entrypoint fans out to the colonization
    ///      module impl, so the enumeration/resolution body lives once and each prologue pays only a
    ///      cheap external call. Safe to call from any action prologue: Colonize is enumerable
    ///      (tracked in `_resolutionMissionIdsByPlayer`), deterministic (no combat randomness), and
    ///      additive (Colonize never gated mutating calls — VEY-417). `resolveFleetMission` for
    ///      Colonize is idempotent and does not re-enter settlement, so this cannot recurse. Must NOT
    ///      be called from inside `_settleResources`/`_settleDuePlanet` — keep it in prologues only.
    function _settleDueColonizeArrivals(address player) internal {
        IVeydriftColonizeArrivalSettler(address(this)).settleDuePlayerColonizeArrivals(player);
    }

    /// @notice Lazy fleet reconcile, combat leg (VEY-KANEO-468 Phase 2b): resolves every Attack/Harvest
    ///         mission `player` owns (as attacker or as the targeted defender) whose `arrivalAt` has
    ///         elapsed AND whose battle randomness is committed — the moment any mutating call touches
    ///         `player` — with no keeper/resolve tx. Randomness-blocked arrivals are skipped and stay
    ///         pending; the caller's residual `_requireNoPendingMissionResolution*` gate still reverts
    ///         only for those (the brief window before `RandomnessCommitterService` commits the seed).
    /// @dev A single self-call into the (self-only) facade entrypoint fans out to the planet-management
    ///      module impl, so the enumeration/resolution body lives once. Both attacker and defender are
    ///      enumerable via `_resolutionMissionIdsByPlayer` (tracked at launch for origin AND target
    ///      owner). `resolveFleetMission` is idempotent (no-op once status != Outbound) and the combat
    ///      module's internal settles never re-enter a fleet reconcile, so this is bounded and
    ///      recursion-free. Must NOT be called from inside `_settleResources`/`_settleDuePlanet` —
    ///      keep it in action prologues only.
    function _settleDueCombatArrivals(address player) internal {
        IVeydriftCombatArrivalSettler(address(this)).settleDuePlayerCombatArrivals(player);
    }

    /// @notice Full per-planet action reconcile for delegatecall modules. Applies due building
    ///         construction, resources, research, ship, and defense queues through the main facade.
    function _settleActionPlanet(uint256 planetId) internal {
        IVeydriftUnitQueueSettler(address(this))
            .completeAttackTargetSnapshotQueues(planetId, type(uint64).max);
    }

    /// @dev Credits only the actual canonical production delta accepted for the commander. The
    /// alliance system decides whether the invitee currently belongs to the issuing alliance and
    /// carries fractional bps dust. The additional treasury amount is a separate reserve liability;
    /// it never reduces the commander's planet balance. If player-first settlement exhausts a
    /// reserve, the invite system returns only the newly backed portion and defers the remainder.
    function _creditAllianceProductionBonus(uint256 planetId, Resources memory produced) internal {
        address allianceSystem = _allianceSystem;
        if (
            allianceSystem == address(0)
                || (produced.metal == 0 && produced.crystal == 0 && produced.deuterium == 0)
        ) return;
        address invitee = _planets[planetId].owner;
        Resources memory bonus;
        assembly ("memory-safe") {
            let pointer := mload(0x40)
            mstore(pointer, shl(224, 0xdb6161f8))
            mstore(add(pointer, 4), invitee)
            mstore(add(pointer, 36), mload(produced))
            mstore(add(pointer, 68), mload(add(produced, 32)))
            mstore(add(pointer, 100), mload(add(produced, 64)))
            if iszero(call(gas(), allianceSystem, 0, pointer, 132, bonus, 96)) {
                returndatacopy(pointer, 0, returndatasize())
                revert(pointer, returndatasize())
            }
        }
        _increaseInternalResources(bonus);
    }

    function _recordShipQueueTiming(
        uint256 planetId,
        ShipQueue memory queue,
        uint64 startedAt,
        Resources memory unitCost
    ) internal {
        ProductionQueueTiming memory timing = _newProductionQueueTiming(
            planetId, startedAt, queue.quantity, unitCost
        );
        _shipQueueTimings[planetId][queue.readyAt] = timing;
        _emitShipQueueTiming(planetId, queue, timing);
    }

    function _recordDefenseQueueTiming(
        uint256 planetId,
        DefenseQueue memory queue,
        uint64 startedAt,
        Resources memory unitCost
    ) internal {
        ProductionQueueTiming memory timing = _newProductionQueueTiming(
            planetId, startedAt, queue.quantity, unitCost
        );
        _defenseQueueTimings[planetId][queue.readyAt] = timing;
        _emitDefenseQueueTiming(planetId, queue, timing);
    }

    function _emitShipQueueTiming(uint256 planetId, ShipQueue memory queue) internal {
        _emitShipQueueTiming(planetId, queue, _shipQueueTimings[planetId][queue.readyAt]);
    }

    function _emitDefenseQueueTiming(uint256 planetId, DefenseQueue memory queue) internal {
        _emitDefenseQueueTiming(planetId, queue, _defenseQueueTimings[planetId][queue.readyAt]);
    }

    function _completedProductionQuantity(
        uint64 readyAt,
        ProductionQueueTiming memory timing,
        uint64 cutoffAt
    ) internal pure returns (uint32) {
        if (timing.startedAt == 0) {
            return cutoffAt >= readyAt ? timing.originalQuantity : 0;
        }
        if (cutoffAt < timing.startedAt) return 0;
        if (cutoffAt >= readyAt || timing.unitWorkSeconds == 0) {
            return timing.originalQuantity;
        }

        uint256 elapsed = uint256(cutoffAt) - timing.startedAt;
        if (elapsed == 0) return 0;
        uint256 completed = (elapsed * timing.rate) / timing.unitWorkSeconds;
        return completed >= timing.originalQuantity ? timing.originalQuantity : completed.toUint32();
    }

    function _nextProductionUnitAt(
        uint64 readyAt,
        ProductionQueueTiming memory timing,
        uint32 settledQuantity
    ) internal pure returns (uint64) {
        if (timing.startedAt == 0 || settledQuantity >= timing.originalQuantity) return readyAt;
        if (timing.unitWorkSeconds == 0) return timing.startedAt + MIN_QUEUE_SECONDS;

        uint256 numerator = timing.unitWorkSeconds * (uint256(settledQuantity) + 1);
        uint256 elapsed = (numerator + timing.rate - 1) / timing.rate;
        if (elapsed < MIN_QUEUE_SECONDS) elapsed = MIN_QUEUE_SECONDS;
        uint256 boundary = uint256(timing.startedAt) + elapsed;
        return boundary >= readyAt ? readyAt : boundary.toUint64();
    }

    function _newProductionQueueTiming(
        uint256 planetId,
        uint64 startedAt,
        uint32 quantity,
        Resources memory unitCost
    ) private view returns (ProductionQueueTiming memory) {
        uint256 rate = 2500 * (uint256(_buildingLevels[planetId][Building.Shipyard]) + 1)
            * (2 ** _buildingLevels[planetId][Building.NaniteFactory]) * QUEUE_UNIVERSE_SPEED;
        return ProductionQueueTiming({
            startedAt: startedAt,
            originalQuantity: quantity,
            unitWorkSeconds: (uint256(unitCost.metal) + uint256(unitCost.crystal)) * 1 hours,
            rate: rate
        });
    }

    function _emitShipQueueTiming(
        uint256 planetId,
        ShipQueue memory queue,
        ProductionQueueTiming memory timing
    ) private {
        if (timing.startedAt == 0) return;
        emit ShipQueueTimingSet(
            planetId,
            queue.ship,
            queue.readyAt,
            timing.startedAt,
            timing.originalQuantity,
            timing.unitWorkSeconds,
            timing.rate
        );
    }

    function _emitDefenseQueueTiming(
        uint256 planetId,
        DefenseQueue memory queue,
        ProductionQueueTiming memory timing
    ) private {
        if (timing.startedAt == 0) return;
        emit DefenseQueueTimingSet(
            planetId,
            queue.defense,
            queue.readyAt,
            timing.startedAt,
            timing.originalQuantity,
            timing.unitWorkSeconds,
            timing.rate
        );
    }

    /// @dev Applies a player's research level once a settle observes its queue elapsed by `cutoffAt`.
    ///      Research is single-queue/player-scoped with no backlog, so one application suffices. This
    ///      is the body of the (now redundant) `finishResearch` entrypoint, generalized to a cutoff so
    ///      an attack's impact-time snapshot settles the defender's by-impact research before combat
    ///      reads tech levels. Called from the colonization queue-settler so it has a single home.
    function _settleResearchDue(address player, uint64 cutoffAt) internal {
        ResearchQueue memory queue = researchQueues[player];
        if (queue.active && cutoffAt >= queue.readyAt) {
            delete researchQueues[player];
            _technologyLevels[player][queue.technology] = queue.targetLevel;
            emit ResearchCompleted(player, queue.technology, queue.targetLevel);
        }
    }

    function setResourceTokens(address metalToken, address crystalToken, address deuteriumToken)
        external
        onlyOwner
    {
        if (metalToken == address(0)) revert ResourceTokenUnset(Resource.Metal);
        if (crystalToken == address(0)) revert ResourceTokenUnset(Resource.Crystal);
        if (deuteriumToken == address(0)) revert ResourceTokenUnset(Resource.Deuterium);

        _resourceTokens[Resource.Metal] = IERC20ReserveToken(metalToken);
        _resourceTokens[Resource.Crystal] = IERC20ReserveToken(crystalToken);
        _resourceTokens[Resource.Deuterium] = IERC20ReserveToken(deuteriumToken);
        _requireCurrentReserveBacking();

        emit ResourceTokensUpdated(metalToken, crystalToken, deuteriumToken);
    }

    function setResourceToken(Resource resource, address token) external onlyOwner {
        _requireReserveResourceId(resource);
        if (token == address(0)) revert ResourceTokenUnset(resource);
        address oldToken = address(_resourceTokens[resource]);
        _resourceTokens[resource] = IERC20ReserveToken(token);
        _requireCurrentReserveBacking();
        emit ResourceTokenUpdated(resource, oldToken, token);
    }

    function depositResourceReserves(Resources calldata amount) external onlyOwner {
        _transferReserveIn(Resource.Metal, amount.metal);
        _transferReserveIn(Resource.Crystal, amount.crystal);
        _transferReserveIn(Resource.Deuterium, amount.deuterium);
        emit ResourceReservesDeposited(msg.sender, amount.metal, amount.crystal, amount.deuterium);
    }

    function resourceToken(Resource resource) external view returns (address) {
        return address(_requireReserveResource(resource));
    }

    function totalInternalResources() external view returns (Resources memory) {
        return _totalInternalResources;
    }

    function lockedWithdrawalResources() external view returns (Resources memory) {
        return _lockedWithdrawalResources;
    }

    function resourceReserveBalance(Resource resource) public view returns (uint256) {
        IERC20ReserveToken token = _requireReserveResource(resource);
        return token.balanceOf(address(this));
    }

    function resourceReserveRequirement() public view returns (Resources memory) {
        return _add(_totalInternalResources, _lockedWithdrawalResources);
    }

    function resourceReserveAvailable() public view returns (Resources memory) {
        Resources memory required = resourceReserveRequirement();
        return Resources({
            metal: _toUint128(_availableReserve(Resource.Metal, required.metal)),
            crystal: _toUint128(_availableReserve(Resource.Crystal, required.crystal)),
            deuterium: _toUint128(_availableReserve(Resource.Deuterium, required.deuterium))
        });
    }

    function _transferReserveIn(Resource resource, uint128 amount) internal {
        if (amount == 0) return;
        IERC20ReserveToken token = _requireReserveResource(resource);
        uint256 beforeBalance = token.balanceOf(address(this));
        if (!token.transferFrom(msg.sender, address(this), amount)) {
            revert ResourceTransferFailed(resource, address(token), amount);
        }
        uint256 afterBalance = token.balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance < amount) {
            revert ResourceTransferFailed(resource, address(token), amount);
        }
    }

    function _increaseInternalResources(Resources memory amount) internal {
        _requireReserveCapacity(amount);
        _totalInternalResources = _add(_totalInternalResources, amount);
    }

    function _decreaseInternalResources(Resources memory amount) internal {
        _totalInternalResources = Resources({
            metal: _totalInternalResources.metal - amount.metal,
            crystal: _totalInternalResources.crystal - amount.crystal,
            deuterium: _totalInternalResources.deuterium - amount.deuterium
        });
    }

    function _add(Resources memory a, Resources memory b) internal pure returns (Resources memory) {
        return Resources({
            metal: a.metal + b.metal,
            crystal: a.crystal + b.crystal,
            deuterium: a.deuterium + b.deuterium
        });
    }

    function _reserveLimitedIncrease(Resources memory amount)
        internal
        view
        returns (Resources memory)
    {
        Resources memory required = resourceReserveRequirement();
        return Resources({
            metal: _toUint128(
                _min(amount.metal, _availableReserve(Resource.Metal, required.metal))
            ),
            crystal: _toUint128(
                _min(amount.crystal, _availableReserve(Resource.Crystal, required.crystal))
            ),
            deuterium: _toUint128(
                _min(amount.deuterium, _availableReserve(Resource.Deuterium, required.deuterium))
            )
        });
    }

    function _requireReserveCapacity(Resources memory increase) internal view {
        Resources memory required = resourceReserveRequirement();
        _requireResourceReserve(Resource.Metal, required.metal, increase.metal);
        _requireResourceReserve(Resource.Crystal, required.crystal, increase.crystal);
        _requireResourceReserve(Resource.Deuterium, required.deuterium, increase.deuterium);
    }

    function _requireNoPendingMissionResolutionForPlanet(uint256 planetId) internal view {
        uint256 missionId = _pendingMissionResolutionForPlanet(planetId);
        if (missionId != 0) revert FleetMissionNotResolved(_fleetMissions[missionId].arrivalAt);
    }

    function _requireNoPendingMissionResolutionForPlayer(address player) internal view {
        uint256 missionId = _pendingMissionResolutionForPlayer(player);
        if (missionId != 0) revert FleetMissionNotResolved(_fleetMissions[missionId].arrivalAt);
    }

    /// @dev Missile/attack defense mutations execute in canonical timestamp/id order. Once a
    ///      missile is due it also takes priority over non-combat arrivals: those paths settle the
    ///      target through the current timestamp and could otherwise complete defenses that did not
    ///      exist at the missile's historical impact time.
    function _requireEarliestPendingMissionForPlanet(uint256 missionId, uint256 planetId)
        internal
        view
    {
        FleetMission storage current = _fleetMissions[missionId];
        uint256[] storage missionIds = _resolutionMissionIdsByPlanet[planetId];
        for (uint256 index = 0; index < missionIds.length;) {
            uint256 otherMissionId = missionIds[index];
            FleetMission storage other = _fleetMissions[otherMissionId];
            if (otherMissionId != missionId && _isPendingResolutionMission(other)) {
                bool otherPrecedesCurrent = other.arrivalAt < current.arrivalAt
                    || (other.arrivalAt == current.arrivalAt && otherMissionId < missionId);
                if (other.missionType == FleetMissionType.MissileAttack) {
                    if (
                        (current.missionType != FleetMissionType.MissileAttack
                                && current.missionType != FleetMissionType.Attack)
                            || otherPrecedesCurrent
                    ) revert FleetMissionNotResolved(other.arrivalAt);
                } else if (
                    current.missionType == FleetMissionType.MissileAttack
                        && other.missionType == FleetMissionType.Attack && otherPrecedesCurrent
                ) {
                    revert FleetMissionNotResolved(other.arrivalAt);
                }
            }
            unchecked {
                ++index;
            }
        }
    }

    /// @dev A planet cannot disappear while another player still has an outbound arrival targeting
    ///      it. Besides preserving impact semantics, this keeps defender-side resolution indexes
    ///      removable without adding a historical-owner storage slot.
    function _requireNoInboundMissionForPlanet(uint256 planetId) internal view {
        uint256[] storage missionIds = _resolutionMissionIdsByPlanet[planetId];
        for (uint256 index = 0; index < missionIds.length;) {
            FleetMission storage mission = _fleetMissions[missionIds[index]];
            if (
                mission.status == FleetMissionStatus.Outbound && mission.targetPlanetId == planetId
                    && mission.originPlanetId != planetId
            ) revert PlanetHasActiveFleetMissions();
            unchecked {
                ++index;
            }
        }
    }

    /// @notice Earliest arrival timestamp among the planet's missions that have arrived but are not
    ///         yet resolved, or `type(uint64).max` when none are pending.
    /// @dev Used by passive resource collection to settle production only up to (and never across) an
    ///      unresolved arrival, so combat/loot snapshots taken at `arrivalAt` stay correct while the
    ///      owner is never frozen out of collecting what already accrued.
    function _earliestPendingMissionArrivalForPlanet(uint256 planetId)
        internal
        view
        returns (uint64 earliestArrival)
    {
        earliestArrival = type(uint64).max;
        uint256[] storage missionIds = _resolutionMissionIdsByPlanet[planetId];
        for (uint256 index = 0; index < missionIds.length;) {
            FleetMission storage mission = _fleetMissions[missionIds[index]];
            if (_isPendingResolutionMission(mission) && mission.arrivalAt < earliestArrival) {
                earliestArrival = mission.arrivalAt;
            }
            unchecked {
                ++index;
            }
        }
    }

    function _trackMissionResolution(uint256 missionId, FleetMission storage mission) internal {
        if (!_isResolutionTrackedMissionType(mission.missionType)) return;

        _addResolutionMissionForPlanet(mission.originPlanetId, missionId);
        _addResolutionMissionForPlayer(mission.owner, missionId);

        if (mission.missionType == FleetMissionType.Colonize) return;

        if (mission.targetPlanetId != mission.originPlanetId) {
            _addResolutionMissionForPlanet(mission.targetPlanetId, missionId);
        }
        address targetOwner = _planets[mission.targetPlanetId].owner;
        if (targetOwner != address(0) && targetOwner != mission.owner) {
            _addResolutionMissionForPlayer(targetOwner, missionId);
        }
    }

    function _trackCounterplayMissionResolution(
        uint256 hostileMissionId,
        FleetMission storage mission
    ) internal {
        _addResolutionMissionForPlanet(mission.originPlanetId, hostileMissionId);
        if (mission.targetPlanetId != mission.originPlanetId) {
            _addResolutionMissionForPlanet(mission.targetPlanetId, hostileMissionId);
        }
        _addResolutionMissionForPlayer(mission.owner, hostileMissionId);

        address targetOwner = _planets[mission.targetPlanetId].owner;
        if (targetOwner != address(0) && targetOwner != mission.owner) {
            _addResolutionMissionForPlayer(targetOwner, hostileMissionId);
        }
    }

    function _untrackMissionResolution(uint256 missionId, FleetMission storage mission) internal {
        if (!_isResolutionTrackedMissionType(mission.missionType)) return;

        _untrackDirectMissionResolution(missionId, mission);
        _untrackLinkedCounterplayMissionResolutions(missionId);
    }

    function _untrackCounterplayMissionResolution(
        uint256 hostileMissionId,
        FleetMission storage mission
    ) internal {
        _removeResolutionMissionForPlanet(mission.originPlanetId, hostileMissionId);
        if (mission.targetPlanetId != mission.originPlanetId) {
            _removeResolutionMissionForPlanet(mission.targetPlanetId, hostileMissionId);
        }
        _removeResolutionMissionForPlayer(mission.owner, hostileMissionId);

        address targetOwner = _planets[mission.targetPlanetId].owner;
        if (targetOwner != address(0) && targetOwner != mission.owner) {
            _removeResolutionMissionForPlayer(targetOwner, hostileMissionId);
        }
    }

    function _untrackDirectMissionResolution(uint256 missionId, FleetMission storage mission)
        internal
    {
        if (!_isResolutionTrackedMissionType(mission.missionType)) return;

        _removeResolutionMissionForPlanet(mission.originPlanetId, missionId);
        _removeResolutionMissionForPlayer(mission.owner, missionId);

        if (mission.missionType != FleetMissionType.Colonize) {
            if (mission.targetPlanetId != mission.originPlanetId) {
                _removeResolutionMissionForPlanet(mission.targetPlanetId, missionId);
            }
            address targetOwner = _planets[mission.targetPlanetId].owner;
            if (targetOwner != address(0) && targetOwner != mission.owner) {
                _removeResolutionMissionForPlayer(targetOwner, missionId);
            }
        }
    }

    function _requireResourceReserve(Resource resource, uint128 currentRequired, uint128 increase)
        internal
        view
    {
        if (increase == 0) return;
        _requireResourceReserveBalance(resource, uint256(currentRequired) + uint256(increase));
    }

    function _availableReserve(Resource resource, uint128 currentRequired)
        internal
        view
        returns (uint256)
    {
        if (!_isReserveTokenConfigured(resource)) return 0;
        uint256 available = resourceReserveBalance(resource);
        return available <= currentRequired ? 0 : available - currentRequired;
    }

    function _requireCurrentReserveBacking() internal view {
        Resources memory required = resourceReserveRequirement();
        _requireResourceReserveBalance(Resource.Metal, required.metal);
        _requireResourceReserveBalance(Resource.Crystal, required.crystal);
        _requireResourceReserveBalance(Resource.Deuterium, required.deuterium);
    }

    function _requireResourceReserveBalance(Resource resource, uint256 required) internal view {
        uint256 available = resourceReserveBalance(resource);
        if (available < required) {
            revert InsufficientResourceReserve(resource, required, available);
        }
    }

    function _isReserveTokenConfigured(Resource resource) internal view returns (bool) {
        _requireReserveResourceId(resource);
        return address(_resourceTokens[resource]) != address(0);
    }

    function _requireReserveResource(Resource resource) internal view returns (IERC20ReserveToken) {
        _requireReserveResourceId(resource);
        IERC20ReserveToken token = _resourceTokens[resource];
        if (address(token) == address(0)) revert ResourceTokenUnset(resource);
        return token;
    }

    function _requireReserveResourceId(Resource resource) internal pure {
        if (
            resource != Resource.Metal && resource != Resource.Crystal
                && resource != Resource.Deuterium
        ) {
            revert InvalidResource(resource);
        }
    }

    function _toUint128(uint256 value) internal pure returns (uint128) {
        if (value > type(uint128).max) revert LevelTooHigh();
        return value.toUint128();
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _pendingMissionResolutionForPlanet(uint256 planetId) private view returns (uint256) {
        uint256[] storage missionIds = _resolutionMissionIdsByPlanet[planetId];
        for (uint256 index = 0; index < missionIds.length;) {
            uint256 missionId = missionIds[index];
            FleetMission storage mission = _fleetMissions[missionId];
            if (_isPendingResolutionMission(mission)) {
                return missionId;
            }
            unchecked {
                ++index;
            }
        }
        return 0;
    }

    function _pendingMissionResolutionForPlayer(address player) private view returns (uint256) {
        uint256[] storage missionIds = _resolutionMissionIdsByPlayer[player];
        for (uint256 index = 0; index < missionIds.length;) {
            uint256 missionId = missionIds[index];
            FleetMission storage mission = _fleetMissions[missionId];
            if (_isPendingResolutionMission(mission)) {
                return missionId;
            }
            unchecked {
                ++index;
            }
        }
        return 0;
    }

    /// @dev Attack, Harvest, and MissileAttack gate settlement: their resolution mutates an involved
    ///      planet at `arrivalAt` (combat, debris, or defenses), so production/body
    ///      mutations must not settle across an unresolved planet or moon arrival. Colonize is excluded —
    ///      resolving a
    ///      Colonize neither reads nor mutates the origin planet (it only creates a brand-new colony
    ///      at the target from cargo snapshotted at launch). An unresolved, overdue Colonize is tracked
    ///      against its origin planet/owner, so including it here froze the owner out of every action
    ///      (settle, build, research, launch) until the off-chain resolver caught up — see VEY-417.
    function _isPendingResolutionMission(FleetMission storage mission)
        internal
        view
        returns (bool)
    {
        return mission.status == FleetMissionStatus.Outbound
            && (mission.missionType == FleetMissionType.Harvest
                || mission.missionType == FleetMissionType.Attack
                || mission.missionType == FleetMissionType.MissileAttack)
            // forge-lint: disable-next-line(block-timestamp)
            && block.timestamp >= mission.arrivalAt;
    }

    function _isResolutionTrackedMissionType(FleetMissionType missionType)
        internal
        pure
        returns (bool)
    {
        // Transport/Deploy/Colonize/Attack/Harvest are enum values 0..4. MissileAttack is also a
        // directly resolved arrival, while the remaining trailing types are linked counterplay.
        return
            missionType <= FleetMissionType.Harvest || missionType == FleetMissionType.MissileAttack;
    }

    function _addResolutionMissionForPlanet(uint256 planetId, uint256 missionId) private {
        if (_resolutionMissionIndexByPlanet[planetId][missionId] != 0) return;
        _resolutionMissionIdsByPlanet[planetId].push(missionId);
        _resolutionMissionIndexByPlanet[planetId][missionId] =
        _resolutionMissionIdsByPlanet[planetId].length;
    }

    function _removeResolutionMissionForPlanet(uint256 planetId, uint256 missionId) private {
        uint256 indexPlusOne = _resolutionMissionIndexByPlanet[planetId][missionId];
        if (indexPlusOne == 0) return;

        uint256[] storage missionIds = _resolutionMissionIdsByPlanet[planetId];
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = missionIds.length - 1;
        if (index != lastIndex) {
            uint256 movedMissionId = missionIds[lastIndex];
            missionIds[index] = movedMissionId;
            _resolutionMissionIndexByPlanet[planetId][movedMissionId] = indexPlusOne;
        }
        missionIds.pop();
        delete _resolutionMissionIndexByPlanet[planetId][missionId];
    }

    function _addResolutionMissionForPlayer(address player, uint256 missionId) private {
        if (_resolutionMissionIndexByPlayer[player][missionId] != 0) return;
        _resolutionMissionIdsByPlayer[player].push(missionId);
        _resolutionMissionIndexByPlayer[player][missionId] =
        _resolutionMissionIdsByPlayer[player].length;
    }

    function _removeResolutionMissionForPlayer(address player, uint256 missionId) private {
        uint256 indexPlusOne = _resolutionMissionIndexByPlayer[player][missionId];
        if (indexPlusOne == 0) return;

        uint256[] storage missionIds = _resolutionMissionIdsByPlayer[player];
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = missionIds.length - 1;
        if (index != lastIndex) {
            uint256 movedMissionId = missionIds[lastIndex];
            missionIds[index] = movedMissionId;
            _resolutionMissionIndexByPlayer[player][movedMissionId] = indexPlusOne;
        }
        missionIds.pop();
        delete _resolutionMissionIndexByPlayer[player][missionId];
    }

    function _untrackLinkedCounterplayMissionResolutions(uint256 hostileMissionId) private {
        uint256[] storage counterplayMissionIds = _fleetCounterplayMissions[hostileMissionId];
        for (uint256 index = 0; index < counterplayMissionIds.length;) {
            _untrackCounterplayMissionResolution(
                hostileMissionId, _fleetMissions[counterplayMissionIds[index]]
            );
            unchecked {
                ++index;
            }
        }
    }
}
