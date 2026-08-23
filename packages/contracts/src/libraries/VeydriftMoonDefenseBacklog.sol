// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftGameStorage} from "../VeydriftGameStorage.sol";
import {VeydriftCatalog} from "./VeydriftCatalog.sol";
import {Defense} from "./VeydriftTypes.sol";
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

    struct Layout {
        mapping(uint256 planetId => Entry[] queue) queues;
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
