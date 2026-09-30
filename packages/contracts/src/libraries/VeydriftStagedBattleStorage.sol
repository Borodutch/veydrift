// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftCombatPreparation} from "./VeydriftCombatPreparation.sol";
import {VeydriftStagedCohorts} from "./VeydriftStagedCohorts.sol";

/// @dev Append-compatible namespaced state. Never delete a battle's dynamic state in one call.
library VeydriftStagedBattleStorage {
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
        VeydriftStagedCohorts.State math;
        Member[] members;
        uint256[] missions;
        mapping(uint256 => bool) enrolled;
        mapping(uint8 => mapping(uint256 => uint256[])) cohortMembers;
        mapping(uint256 => uint256) capacities;
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
