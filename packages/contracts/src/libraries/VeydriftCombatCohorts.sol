// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftCatalog} from "./VeydriftCatalog.sol";
import {Ship, Defense} from "./VeydriftTypes.sol";

/// @dev Unit 0..15 is a ship; 16..23 is a battlefield defense. Counts are side-wide,
/// not uint32 storage quantities. Identity never enters combat randomness.
struct CombatCohort {
    uint256 key;
    uint256 count;
    uint256 attack;
    uint256 shield;
    uint256 hull;
    uint8 unit;
}

library VeydriftCombatCohorts {
    bytes32 private constant DOMAIN = keccak256("veydrift.cohort-combat-random-stream.v1");

    function key(uint8 unit, uint256 attack, uint256 shield, uint256 hull)
        internal
        pure
        returns (uint256)
    {
        return uint256(keccak256(abi.encode(unit, attack, shield, hull)));
    }

    /// @dev Merge first, before any integer rounding or stochastic sampling. The
    /// at-most-one-cohort-per-input insertion loop is bounded by eligible groups/types.
    function canonicalize(CombatCohort[] memory input)
        internal
        pure
        returns (CombatCohort[] memory cohorts)
    {
        cohorts = new CombatCohort[](input.length);
        uint256 length;
        for (uint256 i; i < input.length; ++i) {
            CombatCohort memory item = input[i];
            if (item.count == 0) continue;
            item.key = key(item.unit, item.attack, item.shield, item.hull);
            uint256 j;
            while (j < length && cohorts[j].key < item.key) ++j;
            if (j < length && cohorts[j].key == item.key) {
                cohorts[j].count += item.count;
            } else {
                for (uint256 k = length; k > j; --k) {
                    cohorts[k] = cohorts[k - 1];
                }
                cohorts[j] = CombatCohort(
                    item.key, item.count, item.attack, item.shield, item.hull, item.unit
                );
                ++length;
            }
        }
        assembly ("memory-safe") { mstore(cohorts, length) }
    }

    function losses(
        CombatCohort[] memory firing,
        CombatCohort[] memory targets,
        uint256 seed,
        uint8 round,
        uint8 side
    ) internal pure returns (uint256[] memory lost) {
        lost = new uint256[](targets.length);
        uint256 total;
        for (uint256 i; i < targets.length; ++i) {
            total += targets[i].count;
        }
        if (total == 0) return lost;
        for (uint256 i; i < firing.length; ++i) {
            CombatCohort memory shooter = firing[i];
            if (shooter.attack == 0) continue;
            uint256 extra = extraShots(shooter, targets, total, seed, round, side);
            for (uint256 j; j < targets.length; ++j) {
                CombatCohort memory target = targets[j];
                uint256 shots = distribute(
                    shooter.count,
                    target.count,
                    total,
                    seed,
                    round,
                    side,
                    shooter.key,
                    target.key,
                    0
                )
                + distribute(
                    extra, target.count, total, seed, round, side, shooter.key, target.key, 0
                );
                uint256 killed =
                    lossCount(target, shots, shooter.attack, seed, round, side, shooter.key);
                lost[j] += killed;
                if (lost[j] > target.count) lost[j] = target.count;
            }
        }
    }

    struct FireContext {
        uint256 total;
        uint256 seed;
        uint8 round;
        uint8 side;
    }

    function extraShots(
        CombatCohort memory shooter,
        CombatCohort[] memory targets,
        uint256 total,
        uint256 seed,
        uint8 round,
        uint8 side
    ) internal pure returns (uint256 extra) {
        if (shooter.unit >= 16) return 0;
        FireContext memory ctx = FireContext(total, seed, round, side);
        // Rapid-fire continuation depends only on target type, not research.
        // Pool once so mixed-tech owners do not multiply the 64-chain work.
        uint256[24] memory counts;
        for (uint256 i; i < targets.length; ++i) {
            counts[targets[i].unit] += targets[i].count;
        }
        CombatCohort[] memory typePool = new CombatCohort[](24);
        uint256 typeCount;
        for (uint8 unit; unit < 24; ++unit) {
            if (counts[unit] == 0) continue;
            typePool[typeCount++] = CombatCohort(uint256(unit), counts[unit], 0, 0, 0, unit);
        }
        assembly ("memory-safe") { mstore(typePool, typeCount) }
        uint256 incoming = shooter.count;
        for (uint256 chain; chain < 64; ++chain) {
            uint256 generated;
            for (uint256 j; j < typePool.length; ++j) {
                generated += rapidfireAt(shooter, typePool[j], incoming, chain, ctx);
            }
            if (generated == 0) break;
            extra += generated;
            incoming = generated;
        }
    }

    function rapidfireAt(
        CombatCohort memory shooter,
        CombatCohort memory target,
        uint256 incoming,
        uint256 chain,
        FireContext memory ctx
    ) private pure returns (uint256) {
        uint16 rapidfire = target.unit < 16
            ? VeydriftCatalog.shipRapidfireAgainstShip(Ship(shooter.unit), Ship(target.unit))
            : VeydriftCatalog.shipRapidfireAgainstDefense(
                Ship(shooter.unit), Defense(target.unit - 16)
            );
        if (rapidfire <= 1) return 0;
        uint256 selected = distribute(
            incoming,
            target.count,
            ctx.total,
            ctx.seed,
            ctx.round,
            ctx.side,
            shooter.key,
            target.key,
            1 + chain
        );
        return sample(
            selected,
            uint256(rapidfire - 1) * 10_000 / rapidfire,
            ctx.seed,
            ctx.round,
            ctx.side,
            shooter.key,
            target.key,
            30_000 + chain
        );
    }

    function lossCount(
        CombatCohort memory target,
        uint256 shots,
        uint256 attack,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 firingKey
    ) internal pure returns (uint256) {
        if (shots == 0 || target.count == 0 || attack == 0 || target.hull == 0) {
            return 0;
        }
        uint256 targeted = shots < target.count ? shots : target.count;
        uint256 damage = attack * ((shots + targeted - 1) / targeted);
        if (attack <= target.shield / 100 || damage <= target.shield) return 0;
        uint256 hullDamage = damage - target.shield;
        if (hullDamage >= target.hull) return targeted;
        uint256 damageBps = hullDamage * 10_000 / target.hull;
        if (damageBps <= 3_000) return 0;
        return sample(targeted, damageBps, seed, round, side, firingKey, target.key, 65_536 + shots);
    }

    function distribute(
        uint256 shots,
        uint256 count,
        uint256 total,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 firingKey,
        uint256 targetKey,
        uint256 lane
    ) internal pure returns (uint256 assigned) {
        if (shots == 0 || count == 0 || total == 0) return 0;
        uint256 weighted = shots * count;
        assigned = weighted / total;
        if (stream(seed, round, side, firingKey, targetKey, lane) % total < weighted % total) {
            ++assigned;
        }
    }

    function sample(
        uint256 trials,
        uint256 chance,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 firingKey,
        uint256 targetKey,
        uint256 lane
    ) private pure returns (uint256 sampled) {
        if (chance >= 10_000) return trials;
        uint256 weighted = trials * chance;
        sampled = weighted / 10_000;
        if (stream(seed, round, side, firingKey, targetKey, lane) % 10_000 < weighted % 10_000) {
            ++sampled;
        }
    }

    function stream(
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 firingKey,
        uint256 targetKey,
        uint256 lane
    ) private pure returns (uint256) {
        return uint256(keccak256(abi.encode(DOMAIN, seed, round, side, firingKey, targetKey, lane)));
    }
}
