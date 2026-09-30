// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage as G} from "../VeydriftGameStorage.sol";
import {Ship, Defense} from "./VeydriftTypes.sol";

/// @notice Bounded by-impact production settlement for a locked combat target.
/// @dev The caller MUST lock queue/count mutations until complete. Between calls the backlogs
/// contain consumed entries or partially compacted duplicates and must not be used normally.
/// A State belongs to exactly one preparation; inventory snapshots require advance to return true.
library VeydriftCombatPreparation {
    struct State {
        uint256 planetId;
        uint256 shipConsumed;
        uint256 shipCompacted;
        uint256 defenseConsumed;
        uint256 defenseCompacted;
        uint64 cutoffAt;
        uint8 phase; // 0 ships, 1 copy, 2 pop, 3 defenses, 4 copy, 5 pop, 6 complete
        bool initialized;
    }

    error PreparationContextChanged();

    event ShipCompleted(uint256 indexed planetId, Ship indexed ship, uint32 quantity, uint32 total);
    event DefenseCompleted(
        uint256 indexed planetId, Defense indexed defense, uint32 quantity, uint32 total
    );
    event ShipQueued(
        uint256 indexed planetId,
        Ship indexed ship,
        uint32 quantity,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event DefenseQueued(
        uint256 indexed planetId,
        Defense indexed defense,
        uint32 quantity,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event ShipQueueTimingSet(
        uint256 indexed planetId,
        Ship indexed ship,
        uint64 indexed readyAt,
        uint64 startedAt,
        uint32 originalQuantity,
        uint256 unitWorkSeconds,
        uint256 rate
    );
    event DefenseQueueTimingSet(
        uint256 indexed planetId,
        Defense indexed defense,
        uint64 indexed readyAt,
        uint64 startedAt,
        uint32 originalQuantity,
        uint256 unitWorkSeconds,
        uint256 rate
    );

    /// @dev Each iteration does one fixed-size settlement/promotion, copy, pop or phase transition.
    /// Consumed prefixes are compacted once, making total work linear rather than quadratic.
    /// The caller must bound maxWork for its transaction budget (64 is the tested chunk size).
    function advance(
        State storage state,
        uint256 planetId,
        G.ShipQueue storage shipQueue,
        G.DefenseQueue storage defenseQueue,
        G.ShipQueue[] storage shipBacklog,
        G.DefenseQueue[] storage defenseBacklog,
        mapping(uint64 => G.ProductionQueueTiming) storage shipTimings,
        mapping(uint64 => G.ProductionQueueTiming) storage defenseTimings,
        mapping(Ship => uint32) storage shipCounts,
        mapping(Defense => uint32) storage defenseCounts,
        uint64 cutoffAt,
        uint256 maxWork
    ) public returns (bool complete, uint256 workUsed) {
        if (state.initialized) {
            if (state.planetId != planetId || state.cutoffAt != cutoffAt) {
                revert PreparationContextChanged();
            }
        } else if (maxWork != 0) {
            state.initialized = true;
            state.planetId = planetId;
            state.cutoffAt = cutoffAt;
        }
        while (workUsed < maxWork && state.phase < 6) {
            if (state.phase == 0) {
                if (_ships(state, shipQueue, shipBacklog, shipTimings, shipCounts)) {
                    state.phase = 1;
                }
            } else if (state.phase == 1) {
                if (state.shipConsumed == 0) {
                    state.phase = 3;
                } else if (state.shipConsumed + state.shipCompacted < shipBacklog.length) {
                    shipBacklog[state.shipCompacted] =
                        shipBacklog[state.shipConsumed + state.shipCompacted];
                    ++state.shipCompacted;
                } else {
                    state.phase = 2;
                }
            } else if (state.phase == 2) {
                if (shipBacklog.length > state.shipCompacted) shipBacklog.pop();
                else state.phase = 3;
            } else if (state.phase == 3) {
                if (_defenses(state, defenseQueue, defenseBacklog, defenseTimings, defenseCounts)) {
                    state.phase = 4;
                }
            } else if (state.phase == 4) {
                if (state.defenseConsumed == 0) {
                    state.phase = 6;
                } else if (state.defenseConsumed + state.defenseCompacted < defenseBacklog.length) {
                    defenseBacklog[state.defenseCompacted] =
                        defenseBacklog[state.defenseConsumed + state.defenseCompacted];
                    ++state.defenseCompacted;
                } else {
                    state.phase = 5;
                }
            } else {
                if (defenseBacklog.length > state.defenseCompacted) defenseBacklog.pop();
                else state.phase = 6;
            }
            ++workUsed;
        }
        return (state.phase == 6, workUsed);
    }

    function _ships(
        State storage state,
        G.ShipQueue storage active,
        G.ShipQueue[] storage backlog,
        mapping(uint64 => G.ProductionQueueTiming) storage timings,
        mapping(Ship => uint32) storage counts
    ) private returns (bool) {
        if (!active.active) return true;
        (bool due, uint32 delta) = _newlyCompleted(
            active.readyAt, active.quantity, timings[active.readyAt], state.cutoffAt
        );
        if (!due) return true;
        uint32 total = counts[active.ship] + delta;
        counts[active.ship] = total;
        emit ShipCompleted(state.planetId, active.ship, delta, total);
        if (delta != active.quantity) {
            _subtractCost(active.cost, active.quantity, delta);
            active.quantity -= delta;
            return true;
        }
        delete timings[active.readyAt];
        if (state.shipConsumed == backlog.length) {
            _clearShip(active);
            return true;
        }
        G.ShipQueue memory next = backlog[state.shipConsumed++];
        active.active = next.active;
        active.ship = next.ship;
        active.quantity = next.quantity;
        active.readyAt = next.readyAt;
        active.cost = next.cost;
        emit ShipQueued(
            state.planetId,
            next.ship,
            next.quantity,
            next.readyAt,
            next.cost.metal,
            next.cost.crystal,
            next.cost.deuterium
        );
        G.ProductionQueueTiming memory timing = timings[next.readyAt];
        if (timing.startedAt != 0) {
            emit ShipQueueTimingSet(
                state.planetId,
                next.ship,
                next.readyAt,
                timing.startedAt,
                timing.originalQuantity,
                timing.unitWorkSeconds,
                timing.rate
            );
        }
        return false;
    }

    function _defenses(
        State storage state,
        G.DefenseQueue storage active,
        G.DefenseQueue[] storage backlog,
        mapping(uint64 => G.ProductionQueueTiming) storage timings,
        mapping(Defense => uint32) storage counts
    ) private returns (bool) {
        if (!active.active) return true;
        (bool due, uint32 delta) = _newlyCompleted(
            active.readyAt, active.quantity, timings[active.readyAt], state.cutoffAt
        );
        if (!due) return true;
        uint32 total = counts[active.defense] + delta;
        counts[active.defense] = total;
        emit DefenseCompleted(state.planetId, active.defense, delta, total);
        if (delta != active.quantity) {
            _subtractCost(active.cost, active.quantity, delta);
            active.quantity -= delta;
            return true;
        }
        delete timings[active.readyAt];
        if (state.defenseConsumed == backlog.length) {
            _clearDefense(active);
            return true;
        }
        G.DefenseQueue memory next = backlog[state.defenseConsumed++];
        active.active = next.active;
        active.defense = next.defense;
        active.quantity = next.quantity;
        active.readyAt = next.readyAt;
        active.cost = next.cost;
        emit DefenseQueued(
            state.planetId,
            next.defense,
            next.quantity,
            next.readyAt,
            next.cost.metal,
            next.cost.crystal,
            next.cost.deuterium
        );
        G.ProductionQueueTiming memory timing = timings[next.readyAt];
        if (timing.startedAt != 0) {
            emit DefenseQueueTimingSet(
                state.planetId,
                next.defense,
                next.readyAt,
                timing.startedAt,
                timing.originalQuantity,
                timing.unitWorkSeconds,
                timing.rate
            );
        }
        return false;
    }

    /// @dev Mirrors the ordinary production paths, including all-at-readyAt legacy queues.
    function _newlyCompleted(
        uint64 readyAt,
        uint32 remaining,
        G.ProductionQueueTiming memory timing,
        uint64 cutoffAt
    ) private pure returns (bool due, uint32 delta) {
        if (timing.startedAt == 0) return (cutoffAt >= readyAt, remaining);
        uint32 previouslyCompleted =
            timing.originalQuantity >= remaining ? timing.originalQuantity - remaining : 0;
        uint32 completed;
        if (cutoffAt >= timing.startedAt) {
            if (cutoffAt >= readyAt || timing.unitWorkSeconds == 0) {
                completed = timing.originalQuantity;
            } else {
                uint256 produced =
                    (uint256(cutoffAt - timing.startedAt) * timing.rate) / timing.unitWorkSeconds;
                if (produced >= timing.originalQuantity) {
                    completed = timing.originalQuantity;
                } else {
                    // produced is strictly below the uint32 originalQuantity bound.
                    // forge-lint: disable-next-line(unsafe-typecast)
                    completed = uint32(produced);
                }
            }
        }
        if (completed <= previouslyCompleted) return (false, 0);
        delta = completed - previouslyCompleted;
        if (delta > remaining) delta = remaining;
        return (true, delta);
    }

    function _subtractCost(G.Resources storage cost, uint32 remaining, uint32 delta) private {
        cost.metal -= uint128(uint256(cost.metal) * delta / remaining);
        cost.crystal -= uint128(uint256(cost.crystal) * delta / remaining);
        cost.deuterium -= uint128(uint256(cost.deuterium) * delta / remaining);
    }

    // Solidity cannot delete a local storage reference; explicitly clear the fixed-size value.
    function _clearShip(G.ShipQueue storage queue) private {
        queue.active = false;
        queue.ship = Ship(0);
        queue.quantity = 0;
        queue.readyAt = 0;
        delete queue.cost;
    }

    function _clearDefense(G.DefenseQueue storage queue) private {
        queue.active = false;
        queue.defense = Defense(0);
        queue.quantity = 0;
        queue.readyAt = 0;
        delete queue.cost;
    }
}
