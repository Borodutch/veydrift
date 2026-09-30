// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CombatCohort, VeydriftCombatCohorts} from "./VeydriftCombatCohorts.sol";

/// @notice Persistent, work-budgeted implementation of the existing cohort round math.
/// @dev The caller owns attribution: counts stay frozen until the complete simultaneous
/// round finishes. Apply survivors with setCount before starting the next round.
library VeydriftStagedCohorts {
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
        CombatCohort[] cohorts;
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

    error RoundRunning();
    error InvalidSide();
    error InvalidUnit();

    function _mutable(State storage self) private view {
        if (self.phase != Phase.Idle && self.phase != Phase.Done) revert RoundRunning();
    }

    function add(State storage self, uint8 side, CombatCohort memory item)
        public
        returns (uint256 index)
    {
        _mutable(self);
        if (side > 1) revert InvalidSide();
        if (item.unit >= 24) revert InvalidUnit();
        item.key = VeydriftCombatCohorts.key(item.unit, item.attack, item.shield, item.hull);
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
        CombatCohort storage item = pool.cohorts[index];
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
        returns (CombatCohort memory)
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
        for (uint256 n; n < maxWork; ++n) {
            Phase p = self.phase;
            if (p == Phase.Done || p == Phase.Idle) break;
            if (p == Phase.ResetTypes) _resetType(self);
            else if (p == Phase.BuildTotals) _buildTotal(self);
            else if (p == Phase.Shooter) _shooter(self);
            else if (p == Phase.Rapidfire) _rapidfire(self);
            else _target(self);
            ++self.workDone;
        }
        return self.phase == Phase.Done;
    }

    function _resetType(State storage self) private {
        self.sides[self.firingSide].typeCounts[self.typeIndex] = 0;
        if (++self.typeIndex == 24) {
            self.typeIndex = 0;
            if (self.firingSide == 0) {
                self.firingSide = 1;
            } else {
                self.firingSide = 0;
                self.phase = Phase.BuildTotals;
            }
        }
    }

    function _buildTotal(State storage self) private {
        Side storage pool = self.sides[self.firingSide];
        if (self.shooterIndex < pool.cohorts.length) {
            CombatCohort storage item = pool.cohorts[self.shooterIndex++];
            pool.total += item.count;
            pool.typeCounts[item.unit] += item.count;
        } else {
            self.shooterIndex = 0;
            if (self.firingSide == 0) {
                self.firingSide = 1;
            } else {
                self.firingSide = 0;
                self.phase = Phase.Shooter;
            }
        }
    }

    function _shooter(State storage self) private {
        Side storage pool = self.sides[self.firingSide];
        if (self.shooterIndex == pool.cohorts.length || self.sides[1 - self.firingSide].total == 0)
        {
            self.shooterIndex = 0;
            if (self.firingSide == 0) self.firingSide = 1;
            else self.phase = Phase.Done;
            return;
        }
        CombatCohort storage shooter = pool.cohorts[self.shooterIndex];
        if (shooter.count == 0 || shooter.attack == 0) {
            ++self.shooterIndex;
            return;
        }
        self.extra = 0;
        self.generated = 0;
        self.incoming = shooter.count;
        self.chain = 0;
        self.typeIndex = 0;
        self.targetIndex = 0;
        self.phase = shooter.unit < 16 ? Phase.Rapidfire : Phase.Targets;
    }

    function _rapidfire(State storage self) private {
        Side storage targets = self.sides[1 - self.firingSide];
        uint8 unit = self.typeIndex;
        uint256 count = targets.typeCounts[unit];
        if (count != 0) {
            self.generated += VeydriftCombatCohorts.rapidfireAt(
                self.sides[self.firingSide].cohorts[self.shooterIndex],
                CombatCohort(uint256(unit), count, 0, 0, 0, unit),
                self.incoming,
                self.chain,
                VeydriftCombatCohorts.FireContext(
                    targets.total, self.seed, self.round, self.firingSide == 0 ? 4 : 1
                )
            );
        }
        if (++self.typeIndex == 24) {
            self.extra += self.generated;
            if (self.generated == 0 || self.chain == 63) {
                self.phase = Phase.Targets;
            } else {
                self.incoming = self.generated;
                self.generated = 0;
                self.typeIndex = 0;
                ++self.chain;
            }
        }
    }

    function _target(State storage self) private {
        Side storage targets = self.sides[1 - self.firingSide];
        if (self.targetIndex == targets.cohorts.length) {
            ++self.shooterIndex;
            self.phase = Phase.Shooter;
            return;
        }
        uint256 index = self.targetIndex++;
        CombatCohort memory target = targets.cohorts[index];
        // Losses are a capped sum, so neither insertion order nor early saturation
        // changes the result. Epoch tags avoid an unbounded per-round mapping reset.
        Loss storage lost = targets.losses[index];
        uint256 previous = lost.epoch == self.epoch ? lost.count : 0;
        if (previous == target.count) return;
        CombatCohort memory shooter = self.sides[self.firingSide].cohorts[self.shooterIndex];
        uint256 shots = VeydriftCombatCohorts.distribute(
            shooter.count,
            target.count,
            targets.total,
            self.seed,
            self.round,
            self.firingSide == 0 ? 4 : 1,
            shooter.key,
            target.key,
            0
        )
        + VeydriftCombatCohorts.distribute(
            self.extra,
            target.count,
            targets.total,
            self.seed,
            self.round,
            self.firingSide == 0 ? 4 : 1,
            shooter.key,
            target.key,
            0
        );
        uint256 killed = VeydriftCombatCohorts.lossCount(
            target,
            shots,
            shooter.attack,
            self.seed,
            self.round,
            self.firingSide == 0 ? 4 : 1,
            shooter.key
        );
        if (killed != 0) {
            uint256 sum = previous + killed;
            lost.epoch = self.epoch;
            lost.count = sum > target.count ? target.count : sum;
        }
    }
}
