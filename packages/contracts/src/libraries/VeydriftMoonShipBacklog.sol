// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftGameStorage} from "../VeydriftGameStorage.sol";
import {Ship} from "./VeydriftTypes.sol";

/// @notice Independent moon ship lane; namespaced storage leaves the live Moon proxy layout intact.
library VeydriftMoonShipBacklog {
    using SafeCast for uint256;

    bytes32 private constant STORAGE_SLOT = keccak256("veydrift.storage.MoonShipBacklog.v1");
    uint8 internal constant MAX_BACKLOG = 16;

    struct Entry {
        bool active;
        Ship ship;
        uint32 quantity;
        uint64 readyAt;
        VeydriftGameStorage.Resources cost;
        uint64 startedAt;
        uint32 originalQuantity;
        uint256 unitWorkSeconds;
        uint256 rate;
    }

    struct Layout {
        mapping(uint256 planetId => Entry active) active;
        mapping(uint256 planetId => Entry[] entries) backlog;
    }

    event MoonShipQueued(
        uint256 indexed planetId,
        Ship indexed ship,
        uint32 quantity,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event MoonShipCompleted(
        uint256 indexed planetId, Ship indexed ship, uint32 quantity, uint32 total
    );

    function active(uint256 planetId) public view returns (Entry memory) {
        return _layout().active[planetId];
    }

    function entries(uint256 planetId) public view returns (Entry[] memory) {
        return _layout().backlog[planetId];
    }

    function backlogLength(uint256 planetId) public view returns (uint256) {
        return _layout().backlog[planetId].length;
    }

    function enqueue(
        uint256 planetId,
        Ship ship,
        uint32 quantity,
        uint64 nowAt,
        VeydriftGameStorage.Resources memory unitCost,
        VeydriftGameStorage.Resources memory totalCost,
        uint256 rate
    ) public {
        Layout storage layout = _layout();
        Entry storage activeQueue = layout.active[planetId];
        Entry[] storage backlog = layout.backlog[planetId];
        if (activeQueue.active && backlog.length >= MAX_BACKLOG) {
            revert VeydriftGameStorage.InvalidQuantity();
        }
        uint64 start = activeQueue.active
            ? (backlog.length == 0 ? activeQueue.readyAt : backlog[backlog.length - 1].readyAt)
            : nowAt;
        if (start < nowAt) start = nowAt;
        uint256 work = (uint256(unitCost.metal) + unitCost.crystal) * 1 hours;
        uint256 duration = (work * quantity + rate - 1) / rate;
        if (duration == 0) duration = 1;
        Entry memory queued = Entry({
            active: true,
            ship: ship,
            quantity: quantity,
            readyAt: (uint256(start) + duration).toUint64(),
            cost: totalCost,
            startedAt: start,
            originalQuantity: quantity,
            unitWorkSeconds: work,
            rate: rate
        });
        if (activeQueue.active) backlog.push(queued);
        else layout.active[planetId] = queued;
        _emitQueued(planetId, queued);
    }

    /// @dev Only caller MoonSystem may pass its authorized Game pointer. Historical combat impact
    ///      uses cutoffAt rather than block.timestamp, and a later call drains the remaining units.
    function settle(uint256 planetId, uint64 cutoffAt, address game) public {
        Layout storage layout = _layout();
        while (layout.active[planetId].active) {
            Entry memory queue = layout.active[planetId];
            if (cutoffAt < queue.startedAt) return;
            uint256 produced = cutoffAt >= queue.readyAt || queue.unitWorkSeconds == 0
                ? queue.originalQuantity
                : (uint256(cutoffAt - queue.startedAt) * queue.rate) / queue.unitWorkSeconds;
            uint32 completed =
                produced >= queue.originalQuantity ? queue.originalQuantity : produced.toUint32();
            uint32 prior = queue.originalQuantity - queue.quantity;
            if (completed <= prior) return;
            uint32 delta = completed - prior;
            if (delta > queue.quantity) delta = queue.quantity;
            uint32 total =
                IVeydriftMoonShipInventory(game).moonShipCount(planetId, queue.ship) + delta;
            IVeydriftMoonShipInventory(game).setMoonShipCount(planetId, queue.ship, total);
            emit MoonShipCompleted(planetId, queue.ship, delta, total);
            if (delta != queue.quantity) {
                Entry storage remaining = layout.active[planetId];
                remaining.quantity -= delta;
                remaining.cost
                .metal -= uint128((uint256(remaining.cost.metal) * delta) / queue.quantity);
                remaining.cost
                .crystal -= uint128((uint256(remaining.cost.crystal) * delta) / queue.quantity);
                remaining.cost
                .deuterium -= uint128((uint256(remaining.cost.deuterium) * delta) / queue.quantity);
                return;
            }
            Entry[] storage backlog = layout.backlog[planetId];
            if (backlog.length == 0) {
                delete layout.active[planetId];
                return;
            }
            Entry memory promoted = backlog[0];
            layout.active[planetId] = promoted;
            for (uint256 i = 1; i < backlog.length; ++i) {
                backlog[i - 1] = backlog[i];
            }
            backlog.pop();
            _emitQueued(planetId, promoted);
        }
    }

    function clear(uint256 planetId) public {
        Layout storage layout = _layout();
        delete layout.active[planetId];
        delete layout.backlog[planetId];
    }

    function _emitQueued(uint256 planetId, Entry memory queue) private {
        emit MoonShipQueued(
            planetId,
            queue.ship,
            queue.quantity,
            queue.readyAt,
            queue.cost.metal,
            queue.cost.crystal,
            queue.cost.deuterium
        );
    }

    function _layout() private pure returns (Layout storage layout) {
        bytes32 slot = STORAGE_SLOT;
        assembly { layout.slot := slot }
    }
}

interface IVeydriftMoonShipInventory {
    function moonShipCount(uint256 planetId, Ship ship) external view returns (uint32);
    function setMoonShipCount(uint256 planetId, Ship ship, uint32 total) external;
}
