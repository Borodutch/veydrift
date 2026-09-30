// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ship, Defense} from "../../src/libraries/VeydriftTypes.sol";
import {VeydriftCatalog} from "../../src/libraries/VeydriftCatalog.sol";

/// @notice Test-only mathematical oracle. No production combat helper is imported.
/// Uses unordered distinct-stat buckets and direct rational rounding, rather than
/// the implementation's sorted insertion and rapid-fire target structs.
library VeydriftIndependentCohortMath {
    struct Cohort {
        uint256 key;
        uint256 count;
        uint256 attack;
        uint256 shield;
        uint256 hull;
        uint8 unit;
    }

    struct Context {
        uint256 seed;
        uint8 round;
        uint8 side;
    }

    function canonicalize(Cohort[] memory input) internal pure returns (Cohort[] memory pool) {
        pool = new Cohort[](input.length);
        uint256 n;
        for (uint256 i; i < input.length; ++i) {
            if (input[i].count == 0) continue;
            uint256 j;
            while (
                j < n
                    && (pool[j].unit != input[i].unit
                        || pool[j].attack != input[i].attack
                        || pool[j].shield != input[i].shield
                        || pool[j].hull != input[i].hull)
            ) ++j;
            if (j == n) {
                pool[n++] = Cohort(
                    input[i].key, 0, input[i].attack, input[i].shield, input[i].hull, input[i].unit
                );
            }
            pool[j].count += input[i].count;
        }
        assembly ("memory-safe") { mstore(pool, n) }
    }

    function losses(
        Cohort[] memory shooters,
        Cohort[] memory targets,
        uint256 seed,
        uint8 round,
        uint8 side
    ) internal pure returns (uint256[] memory result) {
        result = new uint256[](targets.length);
        uint256 total;
        uint256[24] memory types;
        for (uint256 i; i < targets.length; ++i) {
            total += targets[i].count;
            types[targets[i].unit] += targets[i].count;
        }
        if (total == 0) return result;
        Context memory ctx = Context(seed, round, side);
        for (uint256 i; i < shooters.length; ++i) {
            Cohort memory firing = shooters[i];
            if (firing.attack == 0) continue;
            uint256 extra = _rapidfire(firing, types, total, ctx);
            for (uint256 j; j < targets.length; ++j) {
                Cohort memory target = targets[j];
                uint256 shots = _round(
                    firing.count * target.count, total, ctx, firing.key, target.key, 0
                ) + _round(extra * target.count, total, ctx, firing.key, target.key, 0);
                result[j] += _destroyed(target, shots, firing, ctx);
                if (result[j] > target.count) result[j] = target.count;
            }
        }
    }

    function _rapidfire(
        Cohort memory firing,
        uint256[24] memory counts,
        uint256 total,
        Context memory ctx
    ) private pure returns (uint256 result) {
        if (firing.unit >= 16) return 0;
        uint256 shots = firing.count;
        for (uint256 depth; depth != 64; ++depth) {
            uint256 next;
            for (uint8 target; target < 24; ++target) {
                if (counts[target] == 0) continue;
                uint256 rf = target < 16
                    ? VeydriftCatalog.shipRapidfireAgainstShip(Ship(firing.unit), Ship(target))
                    : VeydriftCatalog.shipRapidfireAgainstDefense(
                        Ship(firing.unit), Defense(target - 16)
                    );
                if (rf < 2) continue;
                uint256 chosen =
                    _round(shots * counts[target], total, ctx, firing.key, target, depth + 1);
                next += _round(
                    chosen * ((rf - 1) * 10_000 / rf),
                    10_000,
                    ctx,
                    firing.key,
                    target,
                    depth + 30_000
                );
            }
            result += next;
            if (next == 0) break;
            shots = next;
        }
    }

    function _destroyed(
        Cohort memory target,
        uint256 shots,
        Cohort memory firing,
        Context memory ctx
    ) private pure returns (uint256) {
        if (shots == 0 || target.count == 0 || target.hull == 0) return 0;
        if (firing.attack <= target.shield / 100) return 0;
        uint256 exposed = shots > target.count ? target.count : shots;
        uint256 perUnit = shots / exposed + (shots % exposed == 0 ? 0 : 1);
        uint256 damage = perUnit * firing.attack;
        if (damage <= target.shield) return 0;
        damage -= target.shield;
        if (damage >= target.hull) return exposed;
        uint256 chance = 10_000 * damage / target.hull;
        if (chance <= 3000) return 0;
        return _round(exposed * chance, 10_000, ctx, firing.key, target.key, shots + 65_536);
    }

    function _round(
        uint256 numerator,
        uint256 denominator,
        Context memory ctx,
        uint256 firing,
        uint256 target,
        uint256 lane
    ) private pure returns (uint256) {
        uint256 random = uint256(
            keccak256(
                abi.encode(
                    keccak256("veydrift.cohort-combat-random-stream.v1"),
                    ctx.seed,
                    ctx.round,
                    ctx.side,
                    firing,
                    target,
                    lane
                )
            )
        );
        return numerator / denominator + (random % denominator < numerator % denominator ? 1 : 0);
    }
}
