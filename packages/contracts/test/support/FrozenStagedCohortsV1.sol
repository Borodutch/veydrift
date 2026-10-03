// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Historical continuation fixture from 33573875f9f68e8afcab3f33cdcc60a7a4dbfc2c.
// Only type/import names are adapted; this deliberately preserves the v1 defect.
// It is NOT a corrected-model arithmetic oracle.

import {FrozenCohortV1, FrozenCombatCohortsV1} from "./FrozenCombatCohortsV1.sol";

/// @notice Persistent, work-budgeted implementation of the existing cohort round math.
/// @dev The caller owns attribution: counts stay frozen until the complete simultaneous
/// round finishes. Apply survivors with setCount before starting the next round.
library FrozenStagedCohortsV1 {
    enum Phase {
        Idle,
        ResetTypes,
        BuildTotals,
        Shooter,
        Rapidfire,
        Targets,
        Done
    }

    struct Loss {
        uint256 epoch;
        uint256 count;
    }

    struct Side {
        FrozenCohortV1[] cohorts;
        mapping(uint256 => uint256) indexPlusOne;
        uint256 total;
        uint256[24] typeCounts;
        mapping(uint256 => Loss) losses;
    }

    struct State {
        Side[2] sides;
        Phase phase;
        uint256 epoch;
        uint256 seed;
        uint8 round;
        uint8 firingSide;
        uint256 shooterIndex;
        uint256 targetIndex;
        uint8 typeIndex;
        uint8 chain;
        uint256 incoming;
        uint256 generated;
        uint256 extra;
        uint256 workDone;
    }

    // Transient scalar cursors only; State/storage layout and cohort/loss mappings stay unchanged.
    struct Cursor {
        Phase phase;
        uint256 epoch;
        uint256 seed;
        uint8 round;
        uint8 firingSide;
        uint256 shooterIndex;
        uint256 targetIndex;
        uint8 typeIndex;
        uint8 chain;
        uint256 incoming;
        uint256 generated;
        uint256 extra;
        uint256 workDone;
    }

    error RoundRunning();
    error InvalidSide();
    error InvalidUnit();

    function _mutable(State storage self) private view {
        if (self.phase != Phase.Idle && self.phase != Phase.Done) revert RoundRunning();
    }

    function add(State storage self, uint8 side, FrozenCohortV1 memory item)
        public
        returns (uint256 index)
    {
        _mutable(self);
        if (side > 1) revert InvalidSide();
        if (item.unit >= 24) revert InvalidUnit();
        item.key = FrozenCombatCohortsV1.key(item.unit, item.attack, item.shield, item.hull);
        Side storage pool = self.sides[side];
        uint256 existing = pool.indexPlusOne[item.key];
        if (existing == 0) {
            index = pool.cohorts.length;
            pool.cohorts.push(item);
            pool.indexPlusOne[item.key] = index + 1;
        } else {
            index = existing - 1;
            pool.cohorts[index].count += item.count;
        }
        pool.total += item.count;
        pool.typeCounts[item.unit] += item.count;
    }

    function setCount(State storage self, uint8 side, uint256 index, uint256 count) internal {
        _mutable(self);
        Side storage pool = self.sides[side];
        FrozenCohortV1 storage item = pool.cohorts[index];
        pool.total = pool.total - item.count + count;
        pool.typeCounts[item.unit] = pool.typeCounts[item.unit] - item.count + count;
        item.count = count;
    }

    function cohortCount(State storage self, uint8 side) internal view returns (uint256) {
        return self.sides[side].cohorts.length;
    }

    function cohort(State storage self, uint8 side, uint256 index)
        internal
        view
        returns (FrozenCohortV1 memory)
    {
        return self.sides[side].cohorts[index];
    }

    /// @dev side identifies the side losing ships, not the firing side.
    function loss(State storage self, uint8 side, uint256 index) internal view returns (uint256) {
        Loss storage item = self.sides[side].losses[index];
        return item.epoch == self.epoch ? item.count : 0;
    }

    function isDone(State storage self) internal view returns (bool) {
        return self.phase == Phase.Done;
    }

    function startRound(State storage self, uint256 seed, uint8 round) public {
        _mutable(self);
        ++self.epoch;
        self.seed = seed;
        self.round = round;
        self.firingSide = 0;
        self.shooterIndex = 0;
        self.targetIndex = 0;
        self.typeIndex = 0;
        self.chain = 0;
        self.incoming = 0;
        self.generated = 0;
        self.extra = 0;
        self.sides[0].total = 0;
        self.sides[1].total = 0;
        self.phase = Phase.ResetTypes;
    }

    /// @notice Executes at most maxWork elementary operations, checkpointing every cursor.
    /// @dev A setup operation resets one type or totals one cohort; a rapidfire operation
    /// evaluates one fixed-order type; a target operation evaluates one cohort. Control
    /// transitions also consume budget. Idle and finished states do not consume work.
    function step(State storage self, uint256 maxWork) public returns (bool done) {
        if (maxWork == 0 || self.phase == Phase.Done || self.phase == Phase.Idle) {
            return self.phase == Phase.Done;
        }
        // Persist once per bounded call, not on every elementary operation. There is no
        // callback to untrusted code; pure math helpers observe only the supplied values.
        Cursor memory cursor = Cursor({
            phase: self.phase,
            epoch: self.epoch,
            seed: self.seed,
            round: self.round,
            firingSide: self.firingSide,
            shooterIndex: self.shooterIndex,
            targetIndex: self.targetIndex,
            typeIndex: self.typeIndex,
            chain: self.chain,
            incoming: self.incoming,
            generated: self.generated,
            extra: self.extra,
            workDone: self.workDone
        });
        for (uint256 n; n < maxWork; ++n) {
            Phase phase = cursor.phase;
            if (phase == Phase.Done || phase == Phase.Idle) break;
            if (phase == Phase.ResetTypes) _resetType(self, cursor);
            else if (phase == Phase.BuildTotals) _buildTotal(self, cursor);
            else if (phase == Phase.Shooter) _shooter(self, cursor);
            else if (phase == Phase.Rapidfire) _rapidfire(self, cursor);
            else _target(self, cursor);
            ++cursor.workDone;
        }
        self.phase = cursor.phase;
        self.firingSide = cursor.firingSide;
        self.shooterIndex = cursor.shooterIndex;
        self.targetIndex = cursor.targetIndex;
        self.typeIndex = cursor.typeIndex;
        self.chain = cursor.chain;
        self.incoming = cursor.incoming;
        self.generated = cursor.generated;
        self.extra = cursor.extra;
        self.workDone = cursor.workDone;
        return cursor.phase == Phase.Done;
    }

    function _resetType(State storage self, Cursor memory cursor) private {
        self.sides[cursor.firingSide].typeCounts[cursor.typeIndex] = 0;
        if (++cursor.typeIndex == 24) {
            cursor.typeIndex = 0;
            if (cursor.firingSide == 0) {
                cursor.firingSide = 1;
            } else {
                cursor.firingSide = 0;
                cursor.phase = Phase.BuildTotals;
            }
        }
    }

    function _buildTotal(State storage self, Cursor memory cursor) private {
        Side storage pool = self.sides[cursor.firingSide];
        if (cursor.shooterIndex < pool.cohorts.length) {
            FrozenCohortV1 storage item = pool.cohorts[cursor.shooterIndex++];
            pool.total += item.count;
            pool.typeCounts[item.unit] += item.count;
        } else {
            cursor.shooterIndex = 0;
            if (cursor.firingSide == 0) {
                cursor.firingSide = 1;
            } else {
                cursor.firingSide = 0;
                cursor.phase = Phase.Shooter;
            }
        }
    }

    function _shooter(State storage self, Cursor memory cursor) private view {
        Side storage pool = self.sides[cursor.firingSide];
        if (
            cursor.shooterIndex == pool.cohorts.length
                || self.sides[1 - cursor.firingSide].total == 0
        ) {
            cursor.shooterIndex = 0;
            if (cursor.firingSide == 0) cursor.firingSide = 1;
            else cursor.phase = Phase.Done;
            return;
        }
        FrozenCohortV1 storage shooter = pool.cohorts[cursor.shooterIndex];
        if (shooter.count == 0 || shooter.attack == 0) {
            ++cursor.shooterIndex;
            return;
        }
        cursor.extra = 0;
        cursor.generated = 0;
        cursor.incoming = shooter.count;
        cursor.chain = 0;
        cursor.typeIndex = 0;
        cursor.targetIndex = 0;
        cursor.phase = shooter.unit < 16 ? Phase.Rapidfire : Phase.Targets;
    }

    function _rapidfire(State storage self, Cursor memory cursor) private view {
        Side storage targets = self.sides[1 - cursor.firingSide];
        uint8 unit = cursor.typeIndex;
        uint256 count = targets.typeCounts[unit];
        if (count != 0) {
            cursor.generated += FrozenCombatCohortsV1.rapidfireAt(
                self.sides[cursor.firingSide].cohorts[cursor.shooterIndex],
                FrozenCohortV1(uint256(unit), count, 0, 0, 0, unit),
                cursor.incoming,
                cursor.chain,
                FrozenCombatCohortsV1.FireContext(
                    targets.total, cursor.seed, cursor.round, cursor.firingSide == 0 ? 4 : 1
                )
            );
        }
        if (++cursor.typeIndex == 24) {
            cursor.extra += cursor.generated;
            if (cursor.generated == 0 || cursor.chain == 63) {
                cursor.phase = Phase.Targets;
            } else {
                cursor.incoming = cursor.generated;
                cursor.generated = 0;
                cursor.typeIndex = 0;
                ++cursor.chain;
            }
        }
    }

    function _target(State storage self, Cursor memory cursor) private {
        Side storage targets = self.sides[1 - cursor.firingSide];
        if (cursor.targetIndex == targets.cohorts.length) {
            ++cursor.shooterIndex;
            cursor.phase = Phase.Shooter;
            return;
        }
        uint256 index = cursor.targetIndex++;
        FrozenCohortV1 memory target = targets.cohorts[index];
        // Losses are a capped sum, so neither insertion order nor early saturation
        // changes the result. Epoch tags avoid an unbounded per-round mapping reset.
        Loss storage lost = targets.losses[index];
        uint256 previous = lost.epoch == cursor.epoch ? lost.count : 0;
        if (previous == target.count) return;
        FrozenCohortV1 memory shooter = self.sides[cursor.firingSide].cohorts[cursor.shooterIndex];
        uint256 shots = FrozenCombatCohortsV1.distribute(
            shooter.count,
            target.count,
            targets.total,
            cursor.seed,
            cursor.round,
            cursor.firingSide == 0 ? 4 : 1,
            shooter.key,
            target.key,
            0
        )
        + FrozenCombatCohortsV1.distribute(
            cursor.extra,
            target.count,
            targets.total,
            cursor.seed,
            cursor.round,
            cursor.firingSide == 0 ? 4 : 1,
            shooter.key,
            target.key,
            0
        );
        uint256 killed = FrozenCombatCohortsV1.lossCount(
            target,
            shots,
            shooter.attack,
            cursor.seed,
            cursor.round,
            cursor.firingSide == 0 ? 4 : 1,
            shooter.key
        );
        if (killed != 0) {
            uint256 sum = previous + killed;
            lost.epoch = cursor.epoch;
            lost.count = sum > target.count ? target.count : sum;
        }
    }
}
