// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftGameStorage} from "../../src/VeydriftGameStorage.sol";
import {VeydriftIndependentCohortMath} from "./VeydriftIndependentCohortMath.sol";
import {VeydriftCatalog} from "../../src/libraries/VeydriftCatalog.sol";
import {Defense, Ship} from "../../src/libraries/VeydriftTypes.sol";

library VeydriftCombatReferenceSimulator {
    using SafeCast for uint256;

    uint256 private constant BPS = 10_000;
    uint8 private constant BATTLE_MAX_ROUNDS = 6;
    uint16 private constant COMBAT_DEBRIS_BPS = 3_000;

    struct CombatTech {
        uint16 weapons;
        uint16 shielding;
        uint16 armor;
    }

    struct BattleInput {
        uint256 seed;
        uint32[16] attackerShips;
        uint32[16] joinedAttackerShips;
        uint32[16] defenderShips;
        uint32[16] counterplayShips;
        uint32[8] defenderDefenses;
        bool counterplayIntercept;
        CombatTech attackerTech;
        CombatTech joinedAttackerTech;
        CombatTech defenderTech;
        CombatTech counterplayTech;
    }

    struct BattleResult {
        VeydriftGameStorage.BattleOutcome outcome;
        uint8 rounds;
        uint32[16] attackerShips;
        uint32[16] joinedAttackerShips;
        uint32[16] defenderShips;
        uint32[16] counterplayShips;
        uint32[8] defenderDefenses;
        VeydriftGameStorage.Resources attackerLosses;
        VeydriftGameStorage.Resources defenderLosses;
        VeydriftGameStorage.Resources debris;
    }

    function run(BattleInput memory input) internal pure returns (BattleResult memory result) {
        result.attackerShips = _copyShips(input.attackerShips);
        result.joinedAttackerShips = _copyShips(input.joinedAttackerShips);
        result.defenderShips = _copyShips(input.defenderShips);
        result.counterplayShips = _copyShips(input.counterplayShips);
        result.defenderDefenses = _copyDefenses(input.defenderDefenses);

        uint32[8] memory destroyedDefenses;
        for (uint8 round = 1; round <= BATTLE_MAX_ROUNDS;) {
            if (_attackerUnitTotal(result) == 0 || _defenderUnitTotal(result) == 0) {
                break;
            }

            _cohortRound(result, input, round);
            _trackDestroyedDefenses(
                destroyedDefenses, result.defenderDefenses, input.defenderDefenses
            );
            result.rounds = round;

            unchecked {
                ++round;
            }
        }

        uint256 finalAttackers = _attackerUnitTotal(result);
        uint256 finalDefenders = _defenderUnitTotal(result);
        _repairDestroyedDefenses(result.defenderDefenses, destroyedDefenses, input.seed);
        if (finalAttackers != 0 && finalDefenders == 0) {
            result.outcome = VeydriftGameStorage.BattleOutcome.AttackerWin;
        } else if (finalAttackers == 0 && finalDefenders != 0) {
            result.outcome = VeydriftGameStorage.BattleOutcome.DefenderWin;
        } else {
            result.outcome = VeydriftGameStorage.BattleOutcome.Draw;
        }
        result.debris = _battleDebris(result.attackerLosses, result.defenderLosses);
    }

    function _cohortRound(BattleResult memory result, BattleInput memory input, uint8 round)
        private
        pure
    {
        VeydriftIndependentCohortMath.Cohort[] memory a =
            new VeydriftIndependentCohortMath.Cohort[](32);
        VeydriftIndependentCohortMath.Cohort[] memory d =
            new VeydriftIndependentCohortMath.Cohort[](40);
        for (uint8 i; i < 16; ++i) {
            a[i] = _unit(i, result.attackerShips[i], input.attackerTech);
            a[16 + i] = _unit(i, result.joinedAttackerShips[i], input.joinedAttackerTech);
            d[i] = _unit(i, result.defenderShips[i], input.defenderTech);
            d[24 + i] = _unit(i, result.counterplayShips[i], input.counterplayTech);
        }
        for (uint8 i; i < 8; ++i) {
            d[16 + i] = _unit(16 + i, result.defenderDefenses[i], input.defenderTech);
        }
        VeydriftIndependentCohortMath.Cohort[] memory ap =
            VeydriftIndependentCohortMath.canonicalize(a);
        VeydriftIndependentCohortMath.Cohort[] memory dp =
            VeydriftIndependentCohortMath.canonicalize(d);
        uint256[] memory al =
            _shares(a, ap, VeydriftIndependentCohortMath.losses(dp, ap, input.seed, round, 1));
        uint256[] memory dl =
            _shares(d, dp, VeydriftIndependentCohortMath.losses(ap, dp, input.seed, round, 4));
        for (uint8 i; i < 16; ++i) {
            result.attackerShips[i] -= uint32(al[i]);
            result.joinedAttackerShips[i] -= uint32(al[16 + i]);
            result.defenderShips[i] -= uint32(dl[i]);
            result.counterplayShips[i] -= uint32(dl[24 + i]);
            result.attackerLosses =
                _add(result.attackerLosses, _multiply(_shipCost(Ship(i)), al[i] + al[16 + i]));
            result.defenderLosses =
                _add(result.defenderLosses, _multiply(_shipCost(Ship(i)), dl[i] + dl[24 + i]));
        }
        for (uint8 i; i < 8; ++i) {
            result.defenderDefenses[i] -= uint32(dl[16 + i]);
        }
    }

    function _unit(uint8 unit, uint32 count, CombatTech memory tech)
        private
        pure
        returns (VeydriftIndependentCohortMath.Cohort memory c)
    {
        c.unit = unit;
        c.count = count;
        c.attack = _combatScaled(
            unit < 16
                ? VeydriftCatalog.shipBattleAttack(Ship(unit))
                : VeydriftCatalog.defenseBattleAttack(Defense(unit - 16)),
            tech.weapons
        );
        c.shield = _combatScaled(
            unit < 16
                ? VeydriftCatalog.shipBattleShield(Ship(unit))
                : VeydriftCatalog.defenseBattleShield(Defense(unit - 16)),
            tech.shielding
        );
        c.hull = _combatScaled(
            unit < 16
                ? VeydriftCatalog.shipBattleHull(Ship(unit))
                : VeydriftCatalog.defenseBattleHull(Defense(unit - 16)),
            tech.armor
        );
        c.key = uint256(keccak256(abi.encode(unit, c.attack, c.shield, c.hull)));
    }

    function _shares(
        VeydriftIndependentCohortMath.Cohort[] memory units,
        VeydriftIndependentCohortMath.Cohort[] memory pool,
        uint256[] memory lost
    ) private pure returns (uint256[] memory shares) {
        shares = new uint256[](units.length);
        for (uint256 c; c < pool.length; ++c) {
            uint256 allocated;
            uint256 best;
            uint256 remainder;
            for (uint256 i; i < units.length; ++i) {
                if (units[i].count == 0 || units[i].key != pool[c].key) continue;
                uint256 weighted = lost[c] * units[i].count;
                shares[i] = weighted / pool[c].count;
                allocated += shares[i];
                // Fixtures have exactly two owners per side: attacker 0xB0B < ally
                // 0xA77A; resident 0xDEF < counterplayer 0xC017. Equal remainders
                // therefore belong to the first owner, independent of roster order.
                if (weighted % pool[c].count > remainder) {
                    best = i;
                    remainder = weighted % pool[c].count;
                }
            }
            if (allocated < lost[c]) ++shares[best];
        }
    }

    function _trackDestroyedDefenses(
        uint32[8] memory destroyedDefenses,
        uint32[8] memory currentDefenses,
        uint32[8] memory startingDefenses
    ) private pure {
        for (uint8 i = 0; i < 8;) {
            uint32 destroyed = startingDefenses[i] - currentDefenses[i];
            if (destroyed > destroyedDefenses[i]) destroyedDefenses[i] = destroyed;
            unchecked {
                ++i;
            }
        }
    }

    function _repairDestroyedDefenses(
        uint32[8] memory defenses,
        uint32[8] memory destroyedDefenses,
        uint256 seed
    ) private pure {
        for (uint8 i = 0; i < 8;) {
            Defense defense = Defense(i);
            uint32 repaired = _repairedDefenseCount(defense, destroyedDefenses[i], seed);
            defenses[i] += repaired;
            unchecked {
                ++i;
            }
        }
    }

    function _repairedDefenseCount(Defense defense, uint32 destroyed, uint256 seed)
        private
        pure
        returns (uint32)
    {
        if (destroyed == 0) return 0;
        if (destroyed > 1) return (destroyed * 7) / 10;
        return ((seed + uint8(defense)) % 10 < 7) ? 1 : 0;
    }

    function _battleDebris(
        VeydriftGameStorage.Resources memory attackerLosses,
        VeydriftGameStorage.Resources memory defenderLosses
    ) private pure returns (VeydriftGameStorage.Resources memory debris) {
        debris.metal = _debrisAmount(attackerLosses.metal, defenderLosses.metal);
        debris.crystal = _debrisAmount(attackerLosses.crystal, defenderLosses.crystal);
    }

    function _debrisAmount(uint128 attackerLoss, uint128 defenderLoss)
        private
        pure
        returns (uint128)
    {
        return (((uint256(attackerLoss) + defenderLoss) * COMBAT_DEBRIS_BPS) / BPS).toUint128();
    }

    function _attackerUnitTotal(BattleResult memory result) private pure returns (uint256 total) {
        total = _shipUnitTotal(result.attackerShips) + _shipUnitTotal(result.joinedAttackerShips);
    }

    function _shipUnitTotal(uint32[16] memory ships) private pure returns (uint256 total) {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            total += ships[i];
            unchecked {
                ++i;
            }
        }
    }

    function _defenderUnitTotal(BattleResult memory result) private pure returns (uint256 total) {
        for (uint8 i = 0; i < 16;) {
            if (_isPlanetCombatShipId(i)) {
                total += result.defenderShips[i];
            }
            unchecked {
                ++i;
            }
        }
        for (uint8 i = 0; i < 16;) {
            if (_isPlanetCombatShipId(i)) {
                total += result.counterplayShips[i];
            }
            unchecked {
                ++i;
            }
        }
        for (uint8 i = 0; i < 8;) {
            total += result.defenderDefenses[i];
            unchecked {
                ++i;
            }
        }
    }

    function _isPlanetCombatShipId(uint8 shipId) private pure returns (bool) {
        return shipId <= uint8(Ship.Crawler);
    }

    function _copyShips(uint32[16] memory ships) private pure returns (uint32[16] memory copy) {
        for (uint8 i = 0; i < 16;) {
            copy[i] = ships[i];
            unchecked {
                ++i;
            }
        }
    }

    function _copyDefenses(uint32[8] memory defenses) private pure returns (uint32[8] memory copy) {
        for (uint8 i = 0; i < 8;) {
            copy[i] = defenses[i];
            unchecked {
                ++i;
            }
        }
    }

    function _combatScaled(uint256 value, uint16 technologyLevel) private pure returns (uint256) {
        return (value * (BPS + uint256(technologyLevel) * 1_000)) / BPS;
    }

    function _shipCost(Ship ship) private pure returns (VeydriftGameStorage.Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(ship);
        return VeydriftGameStorage.Resources(metal, crystal, deuterium);
    }

    function _multiply(VeydriftGameStorage.Resources memory resources, uint256 quantity)
        private
        pure
        returns (VeydriftGameStorage.Resources memory)
    {
        return VeydriftGameStorage.Resources({
            metal: (uint256(resources.metal) * quantity).toUint128(),
            crystal: (uint256(resources.crystal) * quantity).toUint128(),
            deuterium: (uint256(resources.deuterium) * quantity).toUint128()
        });
    }

    function _add(
        VeydriftGameStorage.Resources memory left,
        VeydriftGameStorage.Resources memory right
    ) private pure returns (VeydriftGameStorage.Resources memory) {
        return VeydriftGameStorage.Resources({
            metal: left.metal + right.metal,
            crystal: left.crystal + right.crystal,
            deuterium: left.deuterium + right.deuterium
        });
    }
}
