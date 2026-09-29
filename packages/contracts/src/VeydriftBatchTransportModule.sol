// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {Technology, Ship, Defense, ProductionOrder} from "./libraries/VeydriftTypes.sol";

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

/// @notice Bounded, atomic multi-origin transport entrypoint for the Game proxy.
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

    constructor() VeydriftResourceReserves(address(0)) {}

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
    function prepareFleetChronology(uint256 id, bool returning) external returns (bool) {
        FleetMission storage m = _fleetMissions[id];
        // Unregistered pre-upgrade missions keep legacy completion liveness. Their interactions
        // with new missions carry the explicitly accepted mixed-generation ordering limitation.
        if (!_chronologyRegistered[id]) {
            if (returning) {
                _requireNoPendingMissionResolutionForPlanet(m.originPlanetId);
            } else if (
                m.missionType != FleetMissionType.Colonize
                    && m.missionType != FleetMissionType.MissileAttack
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
        for (uint256 operations; operations < 12 && i < ids.length; ++operations) {
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
        scan.cursor = i;
        scan.generation = _scanGeneration(body);
        if (i != ids.length) return false;
        if (scan.blocker != 0) {
            FleetMission storage earlier = _fleetMissions[scan.blocker];
            if (
                !returning
                    && (earlier.status == FleetMissionStatus.Returning
                        || earlier.status == FleetMissionStatus.Recalled)
            ) {
                // Exactly one earlier return per preparatory call. Its own guard runs through the
                // same ordering, and never recursively auto-resolves another return.
                IVeydriftMoonArrivalResolver(address(this)).completeFleetMissionReturn(scan.blocker);
                return false;
            }
            revert FleetMissionNotResolved(scan.blockerAt);
        }
        delete _chronologyScans[id];
        if (
            !returning && m.missionType != FleetMissionType.MissileAttack
                && m.missionType != FleetMissionType.Colonize
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
                FleetMissionType.Transport,
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
