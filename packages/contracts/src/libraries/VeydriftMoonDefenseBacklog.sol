// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage} from "../VeydriftGameStorage.sol";
import {VeydriftCatalog} from "./VeydriftCatalog.sol";
import {Defense} from "./VeydriftTypes.sol";
import {VeydriftMoonSystem} from "../VeydriftMoonSystem.sol";
import {MoonBuilding} from "./VeydriftTypes.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Namespaced FIFO storage and iteration for the size-constrained Moon proxy.
/// @dev Public library calls execute by delegatecall, so entries live in the Moon proxy while the
///      shifting/iteration bytecode stays outside the EIP-170-limited Moon implementation.
library VeydriftMoonDefenseBacklog {
    using SafeCast for uint256;

    error LevelTooHigh();
    bytes32 private constant STORAGE_SLOT = keccak256("veydrift.storage.MoonDefenseBacklog.v1");

    struct Entry {
        bool active;
        Defense defense;
        uint32 quantity;
        uint64 readyAt;
        VeydriftGameStorage.Resources cost;
    }

    struct CombatPreparation {
        uint256 consumed;
        uint256 compacted;
        uint64 impact;
        uint8 phase; // 0 settle/promote, 1 copy, 2 pop, 3 complete
        bool frozen;
    }

    struct Layout {
        mapping(uint256 planetId => Entry[] queue) queues;
        mapping(uint256 planetId => CombatPreparation preparation) combat;
    }

    error MoonCombatFrozen(uint256 planetId);
    error MoonCombatNotPrepared(uint256 planetId);
    error MoonCombatImpactChanged();
    error InvalidWorkBudget();

    function frozen(uint256 planetId) internal view returns (bool) {
        return _layout().combat[planetId].frozen;
    }

    function requireUnfrozen(uint256 planetId) internal view {
        if (frozen(planetId)) revert MoonCombatFrozen(planetId);
    }

    function requirePrepared(uint256 planetId) internal view {
        if (_layout().combat[planetId].phase != 3) revert MoonCombatNotPrepared(planetId);
    }

    function combatActive(uint256 planetId) public view returns (bool) {
        if (!frozen(planetId)) return false;
        requirePrepared(planetId);
        return true;
    }

    function requireImpact(uint256 planetId, uint64 impact) public view {
        CombatPreparation storage state = _layout().combat[planetId];
        if (state.frozen && state.impact != impact) revert MoonCombatImpactChanged();
    }

    /// @return started True only on the first call; the caller settles the fixed-size building
    /// and capped ship lane once, using this same impact (never the current wall clock).
    function begin(uint256 planetId, uint64 impact, uint256 maxWork) public returns (bool started) {
        if (maxWork == 0) revert InvalidWorkBudget();
        requireImpact(planetId, impact);
        CombatPreparation storage state = _layout().combat[planetId];
        if (state.frozen) return false;
        state.frozen = true;
        state.impact = impact;
        return true;
    }

    /// @dev One iteration settles/promotes one entry, copies one entry, pops one entry or
    /// advances a phase. Mutations stay frozen while the physical FIFO is partially compacted.
    function prepare(
        mapping(uint256 planetId => Entry queue) storage activeQueues,
        mapping(uint256 planetId => mapping(Defense defense => uint32 count)) storage counts,
        uint256 planetId,
        uint256 maxWork
    ) public returns (bool complete) {
        CombatPreparation storage state = _layout().combat[planetId];
        Entry[] storage queue = _layout().queues[planetId];
        for (uint256 work; work < maxWork && state.phase < 3; ++work) {
            if (state.phase == 0) {
                Entry memory active = activeQueues[planetId];
                if (!active.active || active.readyAt > state.impact) {
                    state.phase = 1;
                    continue;
                }
                uint32 total = counts[planetId][active.defense] + active.quantity;
                counts[planetId][active.defense] = total;
                emit MoonDefenseCountChanged(planetId, active.defense, total);
                emit MoonDefenseCompleted(planetId, active.defense, active.quantity, total);
                if (state.consumed == queue.length) {
                    delete activeQueues[planetId];
                    state.phase = 1;
                } else {
                    Entry memory next = queue[state.consumed++];
                    activeQueues[planetId] = next;
                    emit MoonDefenseQueued(
                        planetId,
                        next.defense,
                        next.quantity,
                        next.readyAt,
                        next.cost.metal,
                        next.cost.crystal,
                        next.cost.deuterium
                    );
                }
            } else if (state.phase == 1) {
                if (state.consumed == 0) {
                    state.phase = 3;
                } else if (state.consumed + state.compacted < queue.length) {
                    queue[state.compacted] = queue[state.consumed + state.compacted];
                    ++state.compacted;
                } else {
                    state.phase = 2;
                }
            } else {
                if (queue.length > state.compacted) queue.pop();
                else state.phase = 3;
            }
        }
        return state.phase == 3;
    }

    /// @dev Fixed-size namespace cleanup; never walks a queue.
    function release(uint256 planetId) public {
        if (frozen(planetId)) requirePrepared(planetId);
        delete _layout().combat[planetId];
    }

    event MoonDefenseQueued(
        uint256 indexed planetId,
        Defense indexed defense,
        uint32 quantity,
        uint64 readyAt,
        uint128 metalCost,
        uint128 crystalCost,
        uint128 deuteriumCost
    );
    event MoonDefenseCompleted(
        uint256 indexed planetId, Defense indexed defense, uint32 quantity, uint32 total
    );
    event MoonDefenseCountChanged(uint256 indexed planetId, Defense indexed defense, uint32 total);

    function enqueue(
        mapping(uint256 planetId => Entry queue) storage activeQueues,
        uint256 planetId,
        Defense defense,
        uint32 quantity,
        uint256 duration,
        uint64 nowAt,
        VeydriftGameStorage.Resources memory cost
    ) public returns (uint64 readyAt) {
        Entry storage active = activeQueues[planetId];
        Entry[] storage backlog = _layout().queues[planetId];
        uint256 baseReadyAt = active.active
            ? (backlog.length == 0 ? active.readyAt : backlog[backlog.length - 1].readyAt)
            : nowAt;
        if (baseReadyAt < nowAt) baseReadyAt = nowAt;
        readyAt = (baseReadyAt + duration).toUint64();
        Entry memory queued = Entry(true, defense, quantity, readyAt, cost);
        if (active.active) backlog.push(queued);
        else activeQueues[planetId] = queued;
        emit MoonDefenseQueued(
            planetId, defense, quantity, readyAt, cost.metal, cost.crystal, cost.deuterium
        );
    }

    function settle(
        mapping(uint256 planetId => Entry queue) storage activeQueues,
        mapping(uint256 planetId => mapping(Defense defense => uint32 count)) storage counts,
        uint256 planetId,
        uint64 nowAt
    ) public {
        while (activeQueues[planetId].active) {
            Entry memory active = activeQueues[planetId];
            if (nowAt < active.readyAt) return;
            uint32 total = counts[planetId][active.defense] + active.quantity;
            counts[planetId][active.defense] = total;
            emit MoonDefenseCountChanged(planetId, active.defense, total);
            emit MoonDefenseCompleted(planetId, active.defense, active.quantity, total);

            Entry memory promoted = _popFirst(planetId);
            if (!promoted.active) {
                delete activeQueues[planetId];
                return;
            }
            activeQueues[planetId] = promoted;
            emit MoonDefenseQueued(
                planetId,
                promoted.defense,
                promoted.quantity,
                promoted.readyAt,
                promoted.cost.metal,
                promoted.cost.crystal,
                promoted.cost.deuterium
            );
        }
    }

    event MoonBuildingCompleted(
        uint256 indexed planetId, MoonBuilding indexed building, uint16 level
    );

    function settleBuildingUntil(
        mapping(uint256 => VeydriftMoonSystem.MoonBuildingConstruction) storage constructions,
        mapping(uint256 => mapping(MoonBuilding => uint16)) storage levels,
        mapping(uint256 => VeydriftMoonSystem.Moon) storage moons,
        uint256 planetId,
        uint64 cutoffAt
    ) public {
        VeydriftMoonSystem.MoonBuildingConstruction memory construction = constructions[planetId];
        if (!construction.active || cutoffAt < construction.readyAt) return;
        delete constructions[planetId];
        levels[planetId][construction.building] = construction.targetLevel;
        if (construction.building == MoonBuilding.LunarBase) {
            unchecked {
                moons[planetId].fields += 3;
            }
        }
        emit MoonBuildingCompleted(planetId, construction.building, construction.targetLevel);
    }

    function clearCounts(
        mapping(uint256 planetId => mapping(Defense defense => uint32 count)) storage counts,
        uint256 planetId
    ) public {
        for (uint8 i; i <= uint8(type(Defense).max); ++i) {
            delete counts[planetId][Defense(i)];
        }
    }

    /// @notice Fixed eight-type combat delta application; keeps linked Moon runtime size bounded.
    function applyChanges(
        mapping(uint256 planetId => mapping(Defense defense => uint32 count)) storage counts,
        uint256 planetId,
        uint256 changes,
        bool repair
    ) public {
        for (uint8 i; i <= uint8(Defense.LargeShieldDome); ++i) {
            Defense defense = Defense(i);
            // Extract one packed uint32 lane, intentionally discarding subsequent lanes.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint32 changed = uint32(changes >> (uint256(i) * 32));
            if (changed == 0) continue;
            uint32 current = counts[planetId][defense];
            uint32 total = repair ? current + changed : current > changed ? current - changed : 0;
            counts[planetId][defense] = total;
            emit MoonDefenseCountChanged(planetId, defense, total);
        }
    }

    function entries(uint256 planetId) public view returns (Entry[] memory) {
        return _layout().queues[planetId];
    }

    function packed(
        mapping(uint256 planetId => Entry queue) storage activeQueues,
        mapping(uint256 planetId => mapping(Defense defense => uint32 count)) storage counts,
        uint256 planetId,
        uint64 nowAt
    ) public view returns (uint256 valuePacked) {
        for (uint8 i = 0; i <= uint8(Defense.LargeShieldDome);) {
            valuePacked += uint256(counts[planetId][Defense(i)]) << (uint256(i) * 32);
            unchecked {
                ++i;
            }
        }
        if (frozen(planetId)) {
            requirePrepared(planetId);
            return valuePacked;
        }
        Entry storage active = activeQueues[planetId];
        if (active.active && active.readyAt <= nowAt) {
            valuePacked += uint256(active.quantity) << (uint256(uint8(active.defense)) * 32);
        }
        Entry[] storage queue = _layout().queues[planetId];
        for (uint256 i = 0; i < queue.length;) {
            Entry storage entry = queue[i];
            if (entry.active && entry.readyAt <= nowAt) {
                valuePacked += uint256(entry.quantity) << (uint256(uint8(entry.defense)) * 32);
            }
            unchecked {
                ++i;
            }
        }
    }

    function queuedQuantity(
        mapping(uint256 planetId => Entry queue) storage activeQueues,
        uint256 planetId,
        Defense defense
    ) public view returns (uint32 quantity) {
        Entry storage active = activeQueues[planetId];
        if (active.active && active.defense == defense) quantity += active.quantity;
        Entry[] storage queue = _layout().queues[planetId];
        for (uint256 i = 0; i < queue.length;) {
            if (queue[i].active && queue[i].defense == defense) quantity += queue[i].quantity;
            unchecked {
                ++i;
            }
        }
    }

    function requireCapacity(
        mapping(uint256 planetId => Entry queue) storage activeQueues,
        mapping(uint256 planetId => mapping(Defense defense => uint32 count)) storage counts,
        uint256 planetId,
        Defense defense,
        uint32 quantity
    ) public view {
        if (!VeydriftCatalog.isShieldDome(defense)) return;
        if (
            counts[planetId][defense] + queuedQuantity(activeQueues, planetId, defense) + quantity
                > 1
        ) {
            revert LevelTooHigh();
        }
    }

    function multiply(VeydriftGameStorage.Resources memory resources, uint32 quantity)
        public
        pure
        returns (VeydriftGameStorage.Resources memory)
    {
        return VeydriftGameStorage.Resources({
            metal: (uint256(resources.metal) * quantity).toUint128(),
            crystal: (uint256(resources.crystal) * quantity).toUint128(),
            deuterium: (uint256(resources.deuterium) * quantity).toUint128()
        });
    }

    function clear(uint256 planetId) public {
        delete _layout().queues[planetId];
    }

    function _popFirst(uint256 planetId) private returns (Entry memory first) {
        Entry[] storage queue = _layout().queues[planetId];
        if (queue.length == 0) return first;
        first = queue[0];
        for (uint256 i = 1; i < queue.length;) {
            queue[i - 1] = queue[i];
            unchecked {
                ++i;
            }
        }
        queue.pop();
    }

    function _layout() private pure returns (Layout storage layout) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            layout.slot := slot
        }
    }
}
