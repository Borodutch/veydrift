// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Historical continuation fixture from 33573875f9f68e8afcab3f33cdcc60a7a4dbfc2c.
// Only type/import names are adapted; this deliberately preserves the v1 defect.
// It is NOT a corrected-model arithmetic oracle.

import {VeydriftCombatPreparation} from "../../src/libraries/VeydriftCombatPreparation.sol";
import {FrozenStagedCohortsV1} from "./FrozenStagedCohortsV1.sol";

/// @dev Append-compatible namespaced state. Never delete a battle's dynamic state in one call.
library FrozenStagedBattleStorageV1 {
    bytes32 private constant SLOT = keccak256("veydrift.storage.staged-battle.v1");

    struct Member {
        uint256 missionId;
        address owner;
        uint256 cohortIndex;
        uint32 count;
        uint32 share;
        uint256 remainder;
        uint8 unit;
        uint8 side;
    }

    struct Battle {
        uint8 phase;
        uint8 round;
        uint8 side;
        uint256 cursor;
        uint256 linkedLength;
        uint256 stationedLength;
        uint256 seed;
        uint256 battleId;
        uint256 snapshotCount;
        uint256 lossEventCount;
        uint256 lootEventCount;
        uint256 repairEventCount;
        uint128 roundAttackerMetal;
        uint128 roundAttackerCrystal;
        uint128 roundDefenderMetal;
        uint128 roundDefenderCrystal;
        uint256 workDone;
        uint256 cohortCursor;
        uint256 memberCursor;
        uint256 allocated;
        uint256 left;
        uint256 best;
        uint256 bestRemainder;
        uint256 returnCursor;
        uint256 totalCapacity;
        uint8 raidPhase;
        uint128 lootMetal;
        uint128 lootCrystal;
        uint128 lootDeuterium;
        bool prepared;
        bool blocked;
        VeydriftCombatPreparation.State preparation;
        FrozenStagedCohortsV1.State math;
        Member[] members;
        uint256[] missions;
        mapping(uint256 => bool) enrolled;
        mapping(uint8 => mapping(uint256 => uint256[])) cohortMembers;
        mapping(uint256 => uint256) capacities;
        // One settlement epoch for every linked return, independent of continuation timing/order.
        uint64 returnSettlementAt;
        uint8 scoreSide;
        uint8 scorePhase;
        bool scoreException;
        bool scoreRift;
        uint256 scoreCursor;
        uint256[2] scores;
    }

    struct Layout {
        mapping(uint256 => Battle) battles;
        mapping(uint256 => uint256) bodyLock;
    }

    function layout() internal pure returns (Layout storage state) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") { state.slot := slot }
    }

    function battle(uint256 id) internal view returns (Battle storage state) {
        state = layout().battles[id];
    }
}
