// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftArrivalProgress} from "./libraries/VeydriftArrivalProgress.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftStagedBattleStorage as Store} from "./libraries/VeydriftStagedBattleStorage.sol";
import {
    Technology,
    Ship,
    Defense,
    ProductionOrder,
    MissionResolutionItem,
    MissionResolutionOutcome
} from "./libraries/VeydriftTypes.sol";

interface IVeydriftChronologyProduction {
    function settleProductionUntil(uint256 planetId, uint64 cutoffAt) external;
    function completeAttackTargetSnapshotQueues(uint256 planetId, uint64 cutoffAt) external;
    function settleMoonShipProductionUntil(uint256 planetId, uint64 cutoffAt) external;
}

interface IVeydriftMoonArrivalResolver {
    function resolveFleetMission(uint256 missionId) external;
    function completeFleetMissionReturn(uint256 missionId) external;
    function launchInterplanetaryMissileAttack(uint256, uint256, Defense, uint32)
        external
        returns (uint256);
}

/// @notice Bounded, atomic multi-origin transport and deploy entrypoints for the Game proxy.
/// @dev This module deliberately re-enters the proxy through its canonical single-mission selector
///      with `delegatecall`. That retains the original player as `msg.sender` and gives every child
///      exactly the same settlement, ship, fuel, resolution, and event semantics as a normal launch.
contract VeydriftBatchTransportModule is VeydriftResourceReserves {
    uint8 private constant MAX_TRANSPORT_BATCH_ORDERS = 15;
    uint8 private constant MAX_PRODUCTION_ORDERS = 15;
    uint8 private constant MAX_PRODUCTION_BACKLOG = 16;
    bytes4 private constant LAUNCH_FLEET_MISSION_SELECTOR = bytes4(
        keccak256(
            "launchFleetMission(uint256,uint256,uint8,(uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32,uint32),(uint128,uint128,uint128),uint16,uint256)"
        )
    );

    address private immutable _resolutionGameplay;
    address private immutable _resolutionColonization;
    address private immutable _resolutionDefenseHold;
    address private immutable _resolutionPlanetManagement;

    constructor(
        address gameplay,
        address colonization,
        address defenseHold,
        address planetManagement
    ) VeydriftResourceReserves(address(0)) {
        _resolutionGameplay = gameplay;
        _resolutionColonization = colonization;
        _resolutionDefenseHold = defenseHold;
        _resolutionPlanetManagement = planetManagement;
    }

    function resolveFleetMission(uint256 missionId) external virtual {
        _requireGameNotPaused();
        FleetMission storage mission = _fleetMissions[missionId];
        // Already settled (e.g. by a concurrent batch or manual resolver): no-op, never revert.
        if (mission.status != FleetMissionStatus.Outbound) return;
        FleetMissionType missionType = mission.missionType;
        uint256 lockId = Store.layout().bodyLock[mission.targetPlanetId];
        if (lockId != 0 && lockId != missionId) {
            revert FleetMissionNotResolved(_fleetMissions[lockId].arrivalAt);
        }
        // A staged body snapshot is immutable once preparation begins. Chronology runs first.
        if (Store.battle(missionId).phase == 0 && !prepareFleetChronology(missionId, false)) {
            return;
        }
        if (
            missionType == FleetMissionType.Colonize
                || ((missionType == FleetMissionType.Transport
                        || missionType == FleetMissionType.Deploy)
                    && mission.targetIsMoon)
        ) {
            _dispatchResolution(_resolutionColonization);
        }
        if (missionType == FleetMissionType.DefenseHold) {
            _dispatchResolution(_resolutionDefenseHold);
        }
        if (missionType == FleetMissionType.MissileAttack) {
            _dispatchResolution(_resolutionPlanetManagement);
        }
        _dispatchResolution(_resolutionGameplay);
    }

    function _dispatchResolution(address module) private {
        (bool ok, bytes memory result) = module.delegatecall(msg.data);
        if (!ok) assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        assembly ("memory-safe") { return(add(result, 32), mload(result)) }
    }

    // Count bounds calldata/results; the shared execution envelope additionally bounds all nested
    // lazy/production/chronology/combat work, not merely the number of requested mission IDs.
    uint256 private constant MAX_RESOLUTION_ITEMS = 32;
    uint256 private constant MAX_ITEM_GAS = 15_000_000;
    uint256 private constant MAX_BATCH_WORK_GAS = 15_500_000;
    uint256 private constant MIN_ITEM_GAS = 100_000;

    event FleetMissionBatchItem(
        uint256 indexed index,
        uint256 indexed missionId,
        uint8 leg,
        MissionResolutionOutcome outcome,
        bytes4 errorSelector
    );

    /// @notice Best-effort typed resolution. Each child retains sender and canonical chronology.
    /// @dev Progress means canonical preparation/rounds changed, not that this leg settled.
    /// executionGasUsed measures this module's body, including failed work and outcome events;
    /// it excludes intrinsic gas, proxy dispatch, ABI return encoding/copy and caller overhead.
    function resolveFleetMissionBatch(MissionResolutionItem[] calldata items)
        external
        returns (MissionResolutionOutcome[] memory outcomes, uint256 executionGasUsed)
    {
        uint256 measurementStart = gasleft();
        _requireGameNotPaused();
        uint256 count = items.length;
        if (count == 0 || count > MAX_RESOLUTION_ITEMS) revert InvalidQuantity();
        outcomes = new MissionResolutionOutcome[](count);
        uint256 startedWith = gasleft();
        for (uint256 i; i < count; ++i) {
            MissionResolutionItem calldata item = items[i];
            (MissionResolutionOutcome outcome, bytes4 reason) =
                _resolveBatchItem(item, count - i, startedWith);
            outcomes[i] = outcome;
            emit FleetMissionBatchItem(i, item.missionId, item.leg, outcome, reason);
        }
        executionGasUsed = measurementStart - gasleft();
    }

    function _resolveBatchItem(
        MissionResolutionItem calldata item,
        uint256 remaining,
        uint256 startedWith
    ) private returns (MissionResolutionOutcome outcome, bytes4 reason) {
        FleetMission storage m = _fleetMissions[item.missionId];
        FleetMissionStatus status = m.status;
        if (item.leg > 1 || status == FleetMissionStatus.None) {
            return (MissionResolutionOutcome.Invalid, 0);
        }
        if (item.leg == 0 && status != FleetMissionStatus.Outbound) {
            return (MissionResolutionOutcome.AlreadySettled, 0);
        }
        if (item.leg == 1) {
            if (status == FleetMissionStatus.Returned || status == FleetMissionStatus.Resolved) {
                return (MissionResolutionOutcome.AlreadySettled, 0);
            }
            if (status == FleetMissionStatus.Outbound) {
                return (MissionResolutionOutcome.Pending, 0);
            }
        }
        uint64 dueAt = item.leg == 1
            ? m.returnAt
            : (m.missionType == FleetMissionType.DefenseHold
                    ? _defenseHoldUntil[item.missionId]
                    : m.arrivalAt);
        // Same scheduled block clock as canonical chronology, including hold expiry.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < dueAt) return (MissionResolutionOutcome.NotDue, 0);

        // Fixed-size reads only. An existing prerequisite's own bounded scan may advance while
        // our scan remains unchanged; a newly discovered prerequisite changes our blocker.
        uint256 prerequisite = _chronologyScans[item.missionId].blocker;
        bytes32 beforeProgress = _resolutionProgress(item.missionId, prerequisite);
        uint256 available = gasleft();
        uint256 spent = startedWith - available;
        // Reserve covers EIP-150 forwarding loss, cold per-item status reads, every remaining
        // outcome/event and the facade's bounded result copy. Low caller gas may still revert the
        // outer transaction: callers must estimate exact calldata, never infer receipt = settled.
        uint256 reserve = 60_000 + remaining * 12_000;
        if (spent >= MAX_BATCH_WORK_GAS || available <= reserve + MIN_ITEM_GAS) {
            return (MissionResolutionOutcome.GasLimited, 0);
        }
        uint256 allowance = available - reserve;
        uint256 workLeft = MAX_BATCH_WORK_GAS - spent;
        if (allowance > workLeft) allowance = workLeft;
        if (allowance > MAX_ITEM_GAS) allowance = MAX_ITEM_GAS;
        // Explicit EIP-150 allowance: delegatecall must not consume the parent's outcome reserve.
        uint256 eip150 = available - available / 64;
        if (allowance > eip150) allowance = eip150;
        if (allowance < MIN_ITEM_GAS) return (MissionResolutionOutcome.GasLimited, 0);
        bytes memory data = abi.encodeWithSelector(
            item.leg == 0
                ? IVeydriftMoonArrivalResolver.resolveFleetMission.selector
                : IVeydriftMoonArrivalResolver.completeFleetMissionReturn.selector,
            item.missionId
        );
        bool ok;
        // Never allocate/copy unbounded returndata from an unsuccessful child (including OOG).
        assembly ("memory-safe") {
            ok := delegatecall(allowance, address(), add(data, 32), mload(data), 0, 0)
            if and(iszero(ok), gt(returndatasize(), 3)) {
                returndatacopy(0, 0, 4)
                reason := mload(0)
            }
        }
        if (!ok) return (MissionResolutionOutcome.Failed, reason);
        bool settled = item.leg == 0
            ? m.status != FleetMissionStatus.Outbound
            : m.status == FleetMissionStatus.Returned;
        if (settled) return (MissionResolutionOutcome.Settled, 0);
        return (
            beforeProgress != _resolutionProgress(item.missionId, prerequisite)
                ? MissionResolutionOutcome.Progress
                : MissionResolutionOutcome.Pending,
            0
        );
    }

    /// @dev Only persisted canonical scan fields, prerequisite status and combat rounds count.
    /// No fleet arrays, resource structs, gas-spent heuristics or temporary writes are observed.
    function _resolutionProgress(uint256 id, uint256 prerequisite) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                _chronologyScans[id],
                _battleResolutionProgress[id].rounds,
                Store.battle(id).workDone,
                Store.battle(id).math.workDone,
                _chronologyScans[prerequisite],
                _fleetMissions[prerequisite].status
            )
        );
    }

    /// @dev Called atomically by every new allocation, never by legacy settlement. No activation
    /// transaction, historical scan, or caller-selected inventory exists.
    function registerFleetChronology(uint256 id) external {
        if (msg.sender != address(this)) revert Unauthorized(msg.sender);
        if (_chronologyRegistered[id]) revert InvalidId();
        FleetMission storage m = _fleetMissions[id];
        if (id + 1 != nextFleetId || m.status != FleetMissionStatus.Outbound) revert InvalidId();
        _registerChronologyMission(id);
    }

    function _registerChronologyMission(uint256 id) internal {
        FleetMission storage m = _fleetMissions[id];
        _chronologyRegistered[id] = true;
        // Registration is real durable work; initialize once at launch, avoiding a cold
        // zero-to-nonzero counter write on the first bounded impact scan.
        VeydriftArrivalProgress.advanceMission(id, 1);
        _chronologyMissionsByPlayer[m.owner].push(id);
        address targetOwner = _planets[m.targetPlanetId].owner;
        if (targetOwner != address(0) && targetOwner != m.owner) {
            _chronologyMissionsByPlayer[targetOwner].push(id);
        }
        uint256 origin = _body(m.originPlanetId, m.originIsMoon);
        uint256 target = _body(m.targetPlanetId, m.targetIsMoon);
        _chronologyMissionsByBody[origin].push(id);
        if (target != origin) _chronologyMissionsByBody[target].push(id);
        // A destroyed/replaced moon returns to its parent. Reserve that possible destination
        // from the outset; the event predicate selects only the actual current destination.
        uint256 fallbackBody = _body(m.originPlanetId, false);
        if (m.originIsMoon && fallbackBody != target) {
            _chronologyMissionsByBody[fallbackBody].push(id);
        }
        // Moon combat also creates debris in the parent field. Mirror only this inventory
        // relation: predicates below introduce cross-body dependencies only with Harvest,
        // never between otherwise independent moon/planet fleets.
        if (
            m.missionType == FleetMissionType.Harvest
                || (m.missionType == FleetMissionType.Attack && m.targetIsMoon)
        ) {
            uint256 debrisPeer = _body(m.targetPlanetId, !m.targetIsMoon);
            if (
                debrisPeer != origin && debrisPeer != target
                    && (!m.originIsMoon || debrisPeer != fallbackBody)
            ) _chronologyMissionsByBody[debrisPeer].push(id);
        }
    }

    /// @dev One ordering implementation serves permissionless arrivals, returns, and lazy callers.
    /// Returns false only for bounded preparatory work. A complete scan rejects an earlier event.
    function prepareFleetChronology(uint256 id, bool returning) public returns (bool) {
        FleetMission storage m = _fleetMissions[id];
        // Unregistered pre-upgrade missions keep legacy completion liveness. Their interactions
        // with new missions carry the explicitly accepted mixed-generation ordering limitation.
        if (!_chronologyRegistered[id]) {
            if (returning) {
                _requireNoPendingMissionResolutionForPlanet(m.originPlanetId);
            } else if (
                m.missionType != FleetMissionType.Colonize
                    && m.missionType != FleetMissionType.MissileAttack
                    && !(m.missionType == FleetMissionType.Attack
                        && _battleResolutionProgress[id].rounds == 0)
            ) {
                _settleScheduledTarget(
                    m,
                    m.missionType == FleetMissionType.DefenseHold
                        ? _defenseHoldUntil[id]
                        : m.arrivalAt
                );
            }
            return true;
        }
        (uint256 body, uint64 at, uint8 kind) = _currentEvent(id, returning);
        // Scheduled mission deadlines intentionally use the canonical block clock.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < at) {
            if (!returning && m.missionType == FleetMissionType.DefenseHold) {
                revert DefenseHoldStillActive(at);
            }
            revert FleetNotArrived(at);
        }
        if (
            !returning && _linked(m)
                && _fleetMissions[m.randomnessRequestId].status == FleetMissionStatus.Outbound
        ) {
            return false;
        }
        ChronologyScan storage scan = _chronologyScans[id];
        uint256 generation = _scanGeneration(body);
        if (scan.generation != generation) delete _chronologyScans[id];
        if (scan.blocker != 0) {
            (uint64 stillEarlier,) = _earlierEvent(scan.blocker, body, id, at, kind);
            // A previous blocker may have settled or moved later. Re-scan the prefix to find
            // the next blocker instead of retaining its obsolete minimum.
            if (stillEarlier != scan.blockerAt) delete _chronologyScans[id];
        }
        uint256[] storage ids = _chronologyMissionsByBody[body];
        uint256 i = scan.cursor;
        uint256 operations;
        for (; operations < 12 && i < ids.length; ++operations) {
            if (!_active(_fleetMissions[ids[i]])) {
                ids[i] = ids[ids.length - 1];
                ids.pop();
                ++_chronologyBodyGeneration[body];
                continue;
            }
            (uint64 candidateAt, uint8 candidateKind) = _earlierEvent(ids[i], body, id, at, kind);
            if (
                candidateAt != 0
                    && (scan.blocker == 0
                        || _before(
                            candidateAt,
                            candidateKind,
                            ids[i],
                            scan.blockerAt,
                            scan.blockerKind,
                            scan.blocker
                        ))
            ) {
                scan.blocker = ids[i];
                scan.blockerAt = candidateAt;
                scan.blockerKind = candidateKind;
            }
            ++i;
        }
        VeydriftArrivalProgress.advanceMission(id, operations);
        scan.cursor = i;
        scan.generation = _scanGeneration(body);
        if (i != ids.length) return false;
        // Split substantial cold scans from missile impact; retain the <=4-record fast path.
        // The cached next call has no scan work. The500k spam regression stays unchanged.
        if (
            !returning && m.missionType == FleetMissionType.MissileAttack && operations > 4
                && scan.blocker == 0
        ) return false;
        if (scan.blocker != 0) {
            FleetMission storage earlier = _fleetMissions[scan.blocker];
            if (
                !returning
                    && (earlier.status == FleetMissionStatus.Returning
                        || earlier.status == FleetMissionStatus.Recalled)
            ) {
                // Exactly one earlier return per preparatory call. Its own guard runs through the
                // same ordering, and never recursively auto-resolves another return.
                uint256 previousWork = VeydriftArrivalProgress.missionWork(scan.blocker);
                FleetMissionStatus previousStatus = earlier.status;
                IVeydriftMoonArrivalResolver(address(this)).completeFleetMissionReturn(scan.blocker);
                // A nested bounded return may advance without changing status. Count only proven
                // work/state changes, never a successful but unchanged child call.
                if (
                    earlier.status != previousStatus
                        || VeydriftArrivalProgress.missionWork(scan.blocker) > previousWork
                ) {
                    VeydriftArrivalProgress.advanceMission(id, 1);
                }
                return false;
            }
            revert FleetMissionNotResolved(scan.blockerAt);
        }
        delete _chronologyScans[id];
        if (
            !returning && m.missionType != FleetMissionType.MissileAttack
                && m.missionType != FleetMissionType.Colonize
                && !(m.missionType == FleetMissionType.Attack
                    && _battleResolutionProgress[id].rounds == 0)
        ) _settleScheduledTarget(m, at);
        // Ordinary settlement removes events or moves them later. Newly allocated IDs are
        // appended and scanned before completion. Recalls invalidate their origin-body epochs
        // (including zero-duration ties); moon destruction invalidates destination proofs globally.
        return true;
    }

    function _settleScheduledTarget(FleetMission storage m, uint64 at) private {
        if (m.targetIsMoon) {
            if (_moonSystem == address(0)) return;
            (bool ok, bytes memory version) =
                _moonSystem.staticcall(abi.encodeWithSignature("moonShipProductionVersion()"));
            if (ok && version.length >= 32) {
                if (abi.decode(version, (uint8)) != 1) revert InvalidQuantity();
                IVeydriftChronologyProduction(_moonSystem)
                    .settleMoonShipProductionUntil(m.targetPlanetId, at);
            }
        } else {
            IVeydriftChronologyProduction(address(this)).settleProductionUntil(m.targetPlanetId, at);
            IVeydriftChronologyProduction(address(this))
                .completeAttackTargetSnapshotQueues(m.targetPlanetId, at);
        }
    }

    /// @notice Ordering eligibility only; callers additionally simulate for randomness/gas gates.
    /// A bounded view fails closed until the body proof is complete. The third word is always
    /// true: this implementation supports funded progress immediately, with no backfill gate.
    function fleetMissionEligibility(uint256 id)
        external
        view
        returns (bool eligible, uint256 blocker, bool orderingReady)
    {
        FleetMission storage m = _fleetMissions[id];
        if (!_active(m)) return (false, 0, true);
        bool returning = m.status != FleetMissionStatus.Outbound;
        (uint256 body, uint64 at, uint8 kind) = _currentEvent(id, returning);
        // Eligibility uses the same canonical deadline as the state-changing preparer.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < at) return (false, 0, true);
        if (
            !returning && _linked(m)
                && _fleetMissions[m.randomnessRequestId].status == FleetMissionStatus.Outbound
        ) return (false, m.randomnessRequestId, true);
        if (!_chronologyRegistered[id]) {
            return (
                !returning
                    || _earliestPendingMissionArrivalForPlanet(m.originPlanetId)
                        == type(uint64).max,
                0,
                true
            );
        }
        uint256[] storage ids = _chronologyMissionsByBody[body];
        ChronologyScan storage scan = _chronologyScans[id];
        uint256 start;
        if (scan.generation == _scanGeneration(body)) {
            start = scan.cursor;
            blocker = scan.blocker;
        }
        if (blocker != 0) {
            (uint64 stillEarlier,) = _earlierEvent(blocker, body, id, at, kind);
            if (stillEarlier != 0) return (false, blocker, true);
            start = 0;
        }
        uint256 end = start + 256;
        if (end > ids.length) end = ids.length;
        for (uint256 i = start; i < end; ++i) {
            (uint64 candidateAt,) = _earlierEvent(ids[i], body, id, at, kind);
            if (candidateAt != 0) return (false, ids[i], true);
        }
        return (end == ids.length, 0, true);
    }

    function _currentEvent(uint256 id, bool returning)
        private
        view
        returns (uint256 body, uint64 at, uint8 kind)
    {
        FleetMission storage m = _fleetMissions[id];
        if (returning) return (_returnBody(id, m), m.returnAt, 1);
        if (m.missionType == FleetMissionType.DefenseHold) {
            return (_body(m.targetPlanetId, m.targetIsMoon), _defenseHoldUntil[id], 2);
        }
        return (_body(m.targetPlanetId, m.targetIsMoon), m.arrivalAt, 0);
    }

    function _earlierEvent(uint256 other, uint256 body, uint256 id, uint64 at, uint8 kind)
        private
        view
        returns (uint64 eventAt, uint8 eventKind)
    {
        if (other == id) return (0, 0);
        FleetMission storage m = _fleetMissions[other];
        if (!_active(m)) return (0, 0);
        FleetMission storage current = _fleetMissions[id];
        bool sharesDebris = kind == 0 && m.targetPlanetId == current.targetPlanetId
            && ((current.missionType == FleetMissionType.Harvest
                    && m.missionType == FleetMissionType.Attack)
                || (current.missionType == FleetMissionType.Attack
                    && m.missionType == FleetMissionType.Harvest));
        if (
            m.status == FleetMissionStatus.Outbound && !_linked(m)
                && (_body(m.targetPlanetId, m.targetIsMoon) == body || sharesDebris)
        ) {
            uint8 arrivalKind = m.missionType == FleetMissionType.DefenseHold ? 2 : 0;
            uint64 arrival = arrivalKind == 2 ? _defenseHoldUntil[other] : m.arrivalAt;
            if (arrival != 0 && _before(arrival, arrivalKind, other, at, kind, id)) {
                eventAt = arrival;
                eventKind = arrivalKind;
            }
        }
        // Outbound round trips reserve their scheduled home event even before survivors are known.
        // Linked fleets are one battle event at target, but each has its own origin return dependency.
        // Deploy normally has no return; a missing/replaced target moon instead preserves the
        // fleet and cargo for its scheduled return. Match the moon-arrival resolver predicate.
        if (
            m.returnAt != 0 && m.missionType != FleetMissionType.MissileAttack
                && (m.status != FleetMissionStatus.Outbound
                    || m.missionType != FleetMissionType.Deploy
                    || (m.targetIsMoon
                        && !_missionMoonExistsForOwner(
                            other, m.targetPlanetId, _planets[m.targetPlanetId].owner, false
                        ))) && _returnBody(other, m) == body
                && _before(m.returnAt, 1, other, at, kind, id)
                && (eventAt == 0 || _before(m.returnAt, 1, other, eventAt, eventKind, other))
        ) {
            eventAt = m.returnAt;
            eventKind = 1;
        }
    }

    function _returnBody(uint256 id, FleetMission storage m) private view returns (uint256) {
        bool moon =
            m.originIsMoon && _missionMoonExistsForOwner(id, m.originPlanetId, m.owner, true);
        return _body(m.originPlanetId, moon);
    }

    function _scanGeneration(uint256 body) private view returns (uint256) {
        return
            uint256(keccak256(abi.encode(_chronologyGeneration, _chronologyBodyGeneration[body])));
    }

    function _body(uint256 planet, bool moon) private pure returns (uint256) {
        // Colonization targets encode coordinates in the high bit; hashing avoids overflow
        // and keeps those virtual destinations distinct from real planet/moon IDs.
        return uint256(keccak256(abi.encode(planet, moon)));
    }

    function _active(FleetMission storage m) private view returns (bool) {
        return m.status == FleetMissionStatus.Outbound || m.status == FleetMissionStatus.Returning
            || m.status == FleetMissionStatus.Recalled;
    }

    function _linked(FleetMission storage m) private view returns (bool) {
        return m.missionType == FleetMissionType.AcsAttack
            || m.missionType == FleetMissionType.AcsDefend
            || m.missionType == FleetMissionType.Intercept;
    }

    function _before(uint64 a, uint8 ak, uint256 aid, uint64 b, uint8 bk, uint256 bid)
        private
        pure
        returns (bool)
    {
        return a < b || (a == b && (ak < bk || (ak == bk && aid < bid)));
    }

    /// @dev Prospective inventory, bounded independently of historical fleet count.
    /// Every leg enters the same facade guard; no lazy path directly credits a fleet around ordering.
    function settleDuePlayerCombatArrivals(address player) external {
        // Legacy indexes are incomplete but remain useful for lazy completion. Never backfill
        // them into the prospective inventory or let missing legacy membership block new work.
        uint256[] storage legacy = _resolutionMissionIdsByPlayer[player];
        uint256 cursorLegacy = _chronologyLegacyCursor[player];
        uint256 legacyCount = legacy.length < 12 ? legacy.length : 12;
        for (uint256 i; i < legacyCount && legacy.length != 0; ++i) {
            if (cursorLegacy >= legacy.length) cursorLegacy = 0;
            uint256 legacyId = legacy[cursorLegacy++];
            if (!_chronologyRegistered[legacyId]) _settleLazyMission(legacyId);
        }
        _chronologyLegacyCursor[player] = cursorLegacy;
        uint256[] storage ids = _chronologyMissionsByPlayer[player];
        uint256 cursor = _chronologyPlayerCursor[player];
        uint256 count = ids.length < 12 ? ids.length : 12;
        uint256[] memory due = new uint256[](count);
        uint256[] memory visited = new uint256[](count);
        uint256 visitedCount;
        uint256 dueCount;
        // Swap-and-pop may move an already visited tail across a wrapped cursor. Count unique
        // entries, not slots, so small inventories cannot repeatedly skip the same pending leg.
        for (
            uint256 operation;
            operation < 24 && visitedCount < count && ids.length != 0;
            ++operation
        ) {
            if (cursor >= ids.length) {
                cursor = 0;
            }
            uint256 id = ids[cursor];
            bool seen;
            for (uint256 j; j < visitedCount; ++j) {
                if (visited[j] == id) {
                    seen = true;
                    break;
                }
            }
            if (seen) {
                ++cursor;
                continue;
            }
            visited[visitedCount++] = id;
            if (!_active(_fleetMissions[id])) {
                ids[cursor] = ids[ids.length - 1];
                ids.pop();
                continue;
            }
            (uint64 at, uint8 kind) = _lazyEvent(id);
            // Lazy settlement must not execute before the scheduled block-clock deadline.
            // forge-lint: disable-next-line(block-timestamp)
            if (block.timestamp >= at) {
                uint256 position = dueCount;
                // At most 12 candidates: bounded insertion sort, independent of historical IDs.
                while (position != 0) {
                    (uint64 priorAt, uint8 priorKind) = _lazyEvent(due[position - 1]);
                    if (!_before(at, kind, id, priorAt, priorKind, due[position - 1])) break;
                    due[position] = due[position - 1];
                    --position;
                }
                due[position] = id;
                ++dueCount;
            }
            ++cursor;
        }
        _chronologyPlayerCursor[player] = cursor;
        for (uint256 i; i < dueCount; ++i) {
            _settleLazyMission(due[i]);
        }
    }

    function _settleLazyMission(uint256 id) private {
        FleetMission storage m = _fleetMissions[id];
        (uint64 at,) = _lazyEvent(id);
        // Legacy lazy completion preserves the existing block-clock deadline.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < at) return;
        if (m.status == FleetMissionStatus.Outbound) {
            try IVeydriftMoonArrivalResolver(address(this)).resolveFleetMission(id) {} catch {}
        } else if (
            m.status == FleetMissionStatus.Returning || m.status == FleetMissionStatus.Recalled
        ) {
            try IVeydriftMoonArrivalResolver(address(this)).completeFleetMissionReturn(id) {}
                catch {}
        }
    }

    function _lazyEvent(uint256 id) private view returns (uint64 at, uint8 kind) {
        FleetMission storage m = _fleetMissions[id];
        if (m.status != FleetMissionStatus.Outbound) return (m.returnAt, 1);
        if (m.missionType == FleetMissionType.DefenseHold) return (_defenseHoldUntil[id], 2);
        return (m.arrivalAt, 0);
    }

    /// @notice Typed production on one planet, preserving sender and the exact single-action gates.
    function startProductionBatch(uint256 planetId, ProductionOrder[] calldata orders) external {
        if (orders.length == 0 || orders.length > MAX_PRODUCTION_ORDERS) revert InvalidQuantity();
        for (uint256 i; i < orders.length; ++i) {
            ProductionOrder calldata order = orders[i];
            if (order.quantity == 0) revert InvalidQuantity();
            bytes memory data;
            if (order.kind == 0 && order.itemId <= uint8(Ship.Crawler)) {
                data = abi.encodeWithSelector(
                    bytes4(keccak256("startShipProduction(uint256,uint8,uint32)")),
                    planetId,
                    Ship(order.itemId),
                    order.quantity
                );
            } else if (order.kind == 1 && order.itemId <= uint8(Defense.InterplanetaryMissile)) {
                data = abi.encodeWithSelector(
                    bytes4(keccak256("startDefenseProduction(uint256,uint8,uint32)")),
                    planetId,
                    Defense(order.itemId),
                    order.quantity
                );
            } else {
                revert InvalidId();
            }
            (bool ok, bytes memory reason) = address(this).delegatecall(data);
            if (!ok) assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
            // Children settle ready entries before enqueueing. Check the actual resulting backlog;
            // a stale precheck would reject affordable orders behind a fully ready queue.
            if (order.kind == 0 && _shipQueueBacklogs[planetId].length > MAX_PRODUCTION_BACKLOG) {
                revert InvalidQuantity();
            }
            if (order.kind == 1 && _defenseQueueBacklogs[planetId].length > MAX_PRODUCTION_BACKLOG)
            {
                revert InvalidQuantity();
            }
        }
    }

    function launchTransportBatch(uint256 targetPlanetId, TransportBatchOrder[] calldata orders)
        external
        returns (uint256[] memory missionIds)
    {
        return _launchFleetBatch(targetPlanetId, orders, FleetMissionType.Transport);
    }

    function launchDeployBatch(uint256 targetPlanetId, TransportBatchOrder[] calldata orders)
        external
        returns (uint256[] memory missionIds)
    {
        return _launchFleetBatch(targetPlanetId, orders, FleetMissionType.Deploy);
    }

    function _launchFleetBatch(
        uint256 targetPlanetId,
        TransportBatchOrder[] calldata orders,
        FleetMissionType missionType
    ) private returns (uint256[] memory missionIds) {
        uint256 count = orders.length;
        if (count == 0 || count > MAX_TRANSPORT_BATCH_ORDERS) revert InvalidQuantity();

        Planet storage target = _planets[targetPlanetId];
        if (target.owner == address(0)) revert NoPlanet();
        if (target.owner != _actingPlayer()) revert NotPlanetOwner();

        uint256 fleetSlots = VeydriftAntiRaidPrimitives.fleetSlotLimit(
            _technologyLevels[_actingPlayer()][Technology.Computer]
        );
        if (activeFleetMissionCount[_actingPlayer()] + count > fleetSlots) {
            revert FleetSlotLimitReached(fleetSlots);
        }

        missionIds = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            TransportBatchOrder calldata order = orders[i];
            if (order.originPlanetId == targetPlanetId) revert SamePlanet();
            for (uint256 prior = 0; prior < i; ++prior) {
                if (orders[prior].originPlanetId == order.originPlanetId) revert InvalidQuantity();
            }

            bytes memory data = abi.encodeWithSelector(
                LAUNCH_FLEET_MISSION_SELECTOR,
                order.originPlanetId,
                targetPlanetId,
                missionType,
                order.ships,
                order.cargo,
                order.speedPercent,
                0
            );
            (bool ok, bytes memory result) = address(this).delegatecall(data);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(result, 32), mload(result))
                }
            }
            missionIds[i] = abi.decode(result, (uint256));
        }
    }
}
