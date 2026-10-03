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
        Done,
        Prefixes
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

    // Separate namespace: State is embedded before existing Battle members.
    // Appending State would corrupt their offsets on upgrade.
    struct VersionState {
        bool corrected;
        mapping(uint8 => mapping(uint256 => uint256)) prefixes;
    }

    function versionState(State storage self) private pure returns (VersionState storage value) {
        bytes32 stateSlot;
        assembly ("memory-safe") { stateSlot := self.slot }
        bytes32 slot = keccak256(abi.encode("veydrift.storage.cohort-conservation.v2", stateSlot));
        assembly ("memory-safe") { value.slot := slot }
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
        startRoundVersion(self, seed, round, true);
    }

    function startRoundVersion(State storage self, uint256 seed, uint8 round, bool corrected)
        public
    {
        _mutable(self);
        versionState(self).corrected = corrected;
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
            else if (phase == Phase.Prefixes) _prefix(self, cursor);
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
            CombatCohort storage item = pool.cohorts[cursor.shooterIndex++];
            pool.total += item.count;
            pool.typeCounts[item.unit] += item.count;
        } else {
            cursor.shooterIndex = 0;
            if (cursor.firingSide == 0) {
                cursor.firingSide = 1;
            } else {
                cursor.firingSide = 0;
                cursor.phase = versionState(self).corrected ? Phase.Prefixes : Phase.Shooter;
            }
        }
    }

    /// @dev One comparison per work unit; independent of insertion/mission order.
    function _prefix(State storage self, Cursor memory cursor) private {
        Side storage pool = self.sides[cursor.firingSide];
        if (cursor.shooterIndex == pool.cohorts.length) {
            cursor.shooterIndex = 0;
            cursor.targetIndex = 0;
            if (cursor.firingSide == 0) {
                cursor.firingSide = 1;
            } else {
                cursor.firingSide = 0;
                cursor.phase = Phase.Shooter;
            }
            return;
        }
        VersionState storage v = versionState(self);
        if (cursor.targetIndex == 0) v.prefixes[cursor.firingSide][cursor.shooterIndex] = 0;
        if (pool.cohorts[cursor.targetIndex].key < pool.cohorts[cursor.shooterIndex].key) {
            v.prefixes[
                cursor.firingSide
            ][cursor.shooterIndex] += pool.cohorts[cursor.targetIndex].count;
        }
        if (++cursor.targetIndex == pool.cohorts.length) {
            cursor.targetIndex = 0;
            ++cursor.shooterIndex;
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
        CombatCohort storage shooter = pool.cohorts[cursor.shooterIndex];
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
            CombatCohort memory shooter = self.sides[cursor.firingSide].cohorts[cursor.shooterIndex];
            CombatCohort memory target = CombatCohort(uint256(unit), count, 0, 0, 0, unit);
            VeydriftCombatCohorts.FireContext memory ctx = VeydriftCombatCohorts.FireContext(
                targets.total, cursor.seed, cursor.round, cursor.firingSide == 0 ? 4 : 1
            );
            cursor.generated += versionState(self).corrected
                ? VeydriftCombatCohorts.rapidfireAtConserved(
                    shooter, target, cursor.incoming, cursor.chain, cursor.targetIndex, ctx
                )
                : VeydriftCombatCohorts.rapidfireAt(
                    shooter, target, cursor.incoming, cursor.chain, ctx
                );
        }
        // targetIndex doubles as the RF type prefix, resetting on every chain.
        if (versionState(self).corrected) cursor.targetIndex += count;
        if (++cursor.typeIndex == 24) {
            cursor.targetIndex = 0;
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
        CombatCohort memory target = targets.cohorts[index];
        // Losses are a capped sum, so neither insertion order nor early saturation
        // changes the result. Epoch tags avoid an unbounded per-round mapping reset.
        Loss storage lost = targets.losses[index];
        uint256 previous = lost.epoch == cursor.epoch ? lost.count : 0;
        if (previous == target.count) return;
        CombatCohort memory shooter = self.sides[cursor.firingSide].cohorts[cursor.shooterIndex];
        uint256 shots;
        uint256 killed;
        if (versionState(self).corrected) {
            uint256 prefix = versionState(self).prefixes[1 - cursor.firingSide][index];
            uint8 side = cursor.firingSide == 0 ? 4 : 1;
            shots = VeydriftCombatCohorts.distributeConserved(
                shooter.count,
                prefix,
                target.count,
                targets.total,
                cursor.seed,
                cursor.round,
                side,
                shooter.key,
                0
            )
            + VeydriftCombatCohorts.distributeConserved(
                cursor.extra,
                prefix,
                target.count,
                targets.total,
                cursor.seed,
                cursor.round,
                side,
                shooter.key,
                0
            );
            killed = VeydriftCombatCohorts.lossCount(
                target, shots, shooter.attack, cursor.seed, cursor.round, side, shooter.key
            );
        } else {
            shots = VeydriftCombatCohorts.distribute(
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
            + VeydriftCombatCohorts.distribute(
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
            killed = VeydriftCombatCohorts.legacyLossCount(
                target,
                shots,
                shooter.attack,
                cursor.seed,
                cursor.round,
                cursor.firingSide == 0 ? 4 : 1,
                shooter.key
            );
        }
        if (killed != 0) {
            uint256 sum = previous + killed;
            lost.epoch = cursor.epoch;
            lost.count = sum > target.count ? target.count : sum;
        }
    }
}
