// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VeydriftGameStorage} from "../../src/VeydriftGameStorage.sol";
import {VeydriftCatalog} from "../../src/libraries/VeydriftCatalog.sol";
import {Defense, Ship} from "../../src/libraries/VeydriftTypes.sol";

library VeydriftCombatReferenceSimulator {
    using SafeCast for uint256;

    uint256 private constant BPS = 10_000;
    uint8 private constant BATTLE_MAX_ROUNDS = 6;
    uint16 private constant COMBAT_DEBRIS_BPS = 3_000;
    bytes32 private constant COMBAT_STREAM_DOMAIN =
        keccak256("veydrift.classic-combat-random-stream.v1");
    uint8 private constant MAX_RAPIDFIRE_CHAIN = 64;
    uint256 private constant TARGET_LANE_STRIDE = 32;
    uint256 private constant TARGET_LANE_PLANET_SHIP = 0;
    uint256 private constant TARGET_LANE_DEFENSE = 64;
    uint256 private constant TARGET_LANE_COUNTERPLAY_SHIP = 128;
    uint256 private constant TARGET_LANE_ATTACKER_SHIP = 4_096;

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
        uint256 counterplayLaneGroup;
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

            uint32[16] memory attackerRoundShips = _copyShips(result.attackerShips);
            uint32[16] memory joinedAttackerRoundShips = _copyShips(result.joinedAttackerShips);
            VeydriftGameStorage.Resources memory attackerRoundLosses =
                _applyAttackerGroupLosses(result, input, round);
            result.attackerLosses = _add(result.attackerLosses, attackerRoundLosses);

            VeydriftGameStorage.Resources memory defenderRoundLosses = _applyDefenderLosses(
                result,
                attackerRoundShips,
                input.attackerTech,
                input.defenderTech,
                input.counterplayTech,
                input.counterplayLaneGroup,
                input.seed,
                round
            );
            defenderRoundLosses = _add(
                defenderRoundLosses,
                _applyDefenderLosses(
                    result,
                    joinedAttackerRoundShips,
                    input.joinedAttackerTech,
                    input.defenderTech,
                    input.counterplayTech,
                    input.counterplayLaneGroup,
                    input.seed,
                    round
                )
            );
            result.defenderLosses = _add(result.defenderLosses, defenderRoundLosses);
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
            result.defenderLosses =
                _add(result.defenderLosses, _wipeSolarSatellites(result.defenderShips));
            result.defenderShips[uint8(Ship.SolarSatellite)] = 0;
            result.defenderShips[uint8(Ship.Crawler)] = 0;
        } else if (finalAttackers == 0 && finalDefenders != 0) {
            result.outcome = VeydriftGameStorage.BattleOutcome.DefenderWin;
        } else {
            result.outcome = VeydriftGameStorage.BattleOutcome.Draw;
        }
        result.debris = _battleDebris(result.attackerLosses, result.defenderLosses);
    }

    function _applyAttackerGroupLosses(
        BattleResult memory result,
        BattleInput memory input,
        uint8 round
    ) private pure returns (VeydriftGameStorage.Resources memory losses) {
        uint256 targetTotal = _attackerUnitTotal(result);
        losses = _add(
            losses,
            _applyAttackerLosses(
                result.attackerShips,
                result,
                input.defenderTech,
                input.counterplayTech,
                input.attackerTech,
                targetTotal,
                0,
                input.seed,
                round
            )
        );
        losses = _add(
            losses,
            _applyAttackerLosses(
                result.joinedAttackerShips,
                result,
                input.defenderTech,
                input.counterplayTech,
                input.joinedAttackerTech,
                targetTotal,
                1,
                input.seed,
                round
            )
        );
    }

    function _applyAttackerLosses(
        uint32[16] memory targets,
        BattleResult memory result,
        CombatTech memory firingTech,
        CombatTech memory counterplayTech,
        CombatTech memory targetTech,
        uint256 targetTotal,
        uint256 targetGroup,
        uint256 seed,
        uint8 round
    ) private pure returns (VeydriftGameStorage.Resources memory losses) {
        if (targetTotal == 0) return losses;

        for (uint8 i = 0; i < 16;) {
            if (!_isPlanetCombatShipId(i)) {
                unchecked {
                    ++i;
                }
                continue;
            }
            uint32 count = result.defenderShips[i];
            if (count != 0) {
                losses = _add(
                    losses,
                    _fireShipAtAttackers(
                        targets,
                        targetTotal,
                        targetGroup,
                        Ship(i),
                        count,
                        _attackerExtraShots(result, Ship(i), count, targetTotal, seed, round, 1, i),
                        firingTech,
                        targetTech,
                        seed,
                        round,
                        1,
                        i
                    )
                );
            }
            unchecked {
                ++i;
            }
        }
        for (uint8 i = 0; i < 8;) {
            uint32 count = result.defenderDefenses[i];
            if (count != 0) {
                losses = _add(
                    losses,
                    _fireDefenseAtAttackers(
                        targets,
                        targetTotal,
                        targetGroup,
                        Defense(i),
                        count,
                        firingTech,
                        targetTech,
                        seed,
                        round,
                        2,
                        i
                    )
                );
            }
            unchecked {
                ++i;
            }
        }
        for (uint8 i = 0; i < 16;) {
            if (!_isPlanetCombatShipId(i)) {
                unchecked {
                    ++i;
                }
                continue;
            }
            uint32 count = result.counterplayShips[i];
            if (count != 0) {
                losses = _add(
                    losses,
                    _fireShipAtAttackers(
                        targets,
                        targetTotal,
                        targetGroup,
                        Ship(i),
                        count,
                        _attackerExtraShots(result, Ship(i), count, targetTotal, seed, round, 3, i),
                        counterplayTech,
                        targetTech,
                        seed,
                        round,
                        3,
                        i
                    )
                );
            }
            unchecked {
                ++i;
            }
        }
    }

    function _wipeSolarSatellites(uint32[16] memory ships)
        private
        pure
        returns (VeydriftGameStorage.Resources memory losses)
    {
        losses.crystal = uint128(ships[uint8(Ship.SolarSatellite)]) * 2_000;
    }

    function _fireShipAtAttackers(
        uint32[16] memory targets,
        uint256 targetTotal,
        uint256 targetGroup,
        Ship firingShip,
        uint32 firingCount,
        uint256 extraShots,
        CombatTech memory firingTech,
        CombatTech memory targetTech,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private pure returns (VeydriftGameStorage.Resources memory losses) {
        uint256 attack = _combatScaled(
            VeydriftCatalog.shipBattleAttack(firingShip), firingTech.weapons
        );
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            uint32 targetCount = targets[i];
            if (targetCount != 0) {
                uint256 targetLane = _targetLane(TARGET_LANE_ATTACKER_SHIP, targetGroup, i);
                uint256 shots = _distributedTargetShots(
                    firingCount, targetCount, targetTotal, seed, round, side, unit, targetLane
                )
                + _distributedTargetShots(
                    extraShots, targetCount, targetTotal, seed, round, side, unit, targetLane
                );
                uint32 lost = _shipLossCount(
                    Ship(i), targetCount, shots, attack, targetTech, seed, round, side, targetLane
                );
                if (lost != 0) {
                    targets[i] = targetCount - lost;
                    losses = _add(losses, _multiply(_shipCost(Ship(i)), lost));
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _fireDefenseAtAttackers(
        uint32[16] memory targets,
        uint256 targetTotal,
        uint256 targetGroup,
        Defense firingDefense,
        uint32 firingCount,
        CombatTech memory firingTech,
        CombatTech memory targetTech,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private pure returns (VeydriftGameStorage.Resources memory losses) {
        uint256 attack = _combatScaled(
            VeydriftCatalog.defenseBattleAttack(firingDefense), firingTech.weapons
        );
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            uint32 targetCount = targets[i];
            if (targetCount != 0) {
                uint256 targetLane = _targetLane(TARGET_LANE_ATTACKER_SHIP, targetGroup, i);
                uint256 shots = _distributedTargetShots(
                    firingCount, targetCount, targetTotal, seed, round, side, unit, targetLane
                );
                uint32 lost = _shipLossCount(
                    Ship(i), targetCount, shots, attack, targetTech, seed, round, side, targetLane
                );
                if (lost != 0) {
                    targets[i] = targetCount - lost;
                    losses = _add(losses, _multiply(_shipCost(Ship(i)), lost));
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _applyDefenderLosses(
        BattleResult memory result,
        uint32[16] memory attackerRoundShips,
        CombatTech memory attackerTech,
        CombatTech memory defenderTech,
        CombatTech memory counterplayTech,
        uint256 counterplayLaneGroup,
        uint256 seed,
        uint8 round
    ) private pure returns (VeydriftGameStorage.Resources memory losses) {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            uint32 firingCount = attackerRoundShips[i];
            if (firingCount != 0) {
                losses = _add(
                    losses,
                    _fireShipAtDefenders(
                        result,
                        Ship(i),
                        firingCount,
                        attackerTech,
                        defenderTech,
                        counterplayTech,
                        counterplayLaneGroup,
                        seed,
                        round,
                        4,
                        i
                    )
                );
            }
            unchecked {
                ++i;
            }
        }
    }

    function _fireShipAtDefenders(
        BattleResult memory result,
        Ship firingShip,
        uint32 firingCount,
        CombatTech memory firingTech,
        CombatTech memory defenderTech,
        CombatTech memory counterplayTech,
        uint256 counterplayLaneGroup,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private pure returns (VeydriftGameStorage.Resources memory losses) {
        uint256 targetTotal = _defenderUnitTotal(result);
        if (targetTotal == 0) return losses;

        uint256 attack =
            _combatScaled(VeydriftCatalog.shipBattleAttack(firingShip), firingTech.weapons);
        uint256 extraShots = _defenderExtraShots(
            result, firingShip, firingCount, counterplayLaneGroup, seed, round, side, unit
        );
        losses = _add(
            losses,
            _fireAtDefenderShips(
                result.defenderShips,
                TARGET_LANE_PLANET_SHIP,
                0,
                firingCount,
                extraShots,
                targetTotal,
                attack,
                defenderTech,
                seed,
                round,
                side,
                unit
            )
        );
        _fireAtDefenses(
            result.defenderDefenses,
            firingCount,
            extraShots,
            targetTotal,
            attack,
            defenderTech,
            seed,
            round,
            side,
            unit
        );
        losses = _add(
            losses,
            _fireAtDefenderShips(
                result.counterplayShips,
                TARGET_LANE_COUNTERPLAY_SHIP,
                counterplayLaneGroup,
                firingCount,
                extraShots,
                targetTotal,
                attack,
                counterplayTech,
                seed,
                round,
                side,
                unit
            )
        );
    }

    function _fireAtDefenderShips(
        uint32[16] memory targets,
        uint256 laneBase,
        uint256 laneGroup,
        uint32 firingCount,
        uint256 extraShots,
        uint256 targetTotal,
        uint256 attack,
        CombatTech memory targetTech,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private pure returns (VeydriftGameStorage.Resources memory losses) {
        for (uint8 i = 0; i < 16;) {
            if (!_isPlanetCombatShipId(i)) {
                unchecked {
                    ++i;
                }
                continue;
            }
            uint32 count = targets[i];
            if (count != 0) {
                uint256 targetLane = _targetLane(laneBase, laneGroup, i);
                uint256 shots = _distributedTargetShots(
                    firingCount, count, targetTotal, seed, round, side, unit, targetLane
                )
                + _distributedTargetShots(
                    extraShots, count, targetTotal, seed, round, side, unit, targetLane
                );
                uint32 lost = _shipLossCount(
                    Ship(i), count, shots, attack, targetTech, seed, round, side, targetLane
                );
                if (lost != 0) {
                    targets[i] = count - lost;
                    losses = _add(losses, _multiply(_shipCost(Ship(i)), lost));
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _fireAtDefenses(
        uint32[8] memory targets,
        uint32 firingCount,
        uint256 extraShots,
        uint256 targetTotal,
        uint256 attack,
        CombatTech memory targetTech,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private pure {
        for (uint8 i = 0; i < 8;) {
            uint32 count = targets[i];
            if (count != 0) {
                uint256 targetLane = _targetLane(TARGET_LANE_DEFENSE, 0, i);
                uint256 shots = _distributedTargetShots(
                    firingCount, count, targetTotal, seed, round, side, unit, targetLane
                )
                + _distributedTargetShots(
                    extraShots, count, targetTotal, seed, round, side, unit, targetLane
                );
                uint32 lost = _defenseLossCount(
                    Defense(i), count, shots, attack, targetTech, seed, round, side, targetLane
                );
                if (lost != 0) {
                    targets[i] = count - lost;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _shipLossCount(
        Ship ship,
        uint32 count,
        uint256 shots,
        uint256 attack,
        CombatTech memory targetTech,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 unit
    ) private pure returns (uint32) {
        return _lossCount(
            count,
            shots,
            attack,
            _combatScaled(VeydriftCatalog.shipBattleShield(ship), targetTech.shielding),
            _combatScaled(VeydriftCatalog.shipBattleHull(ship), targetTech.armor),
            seed,
            round,
            side,
            unit
        );
    }

    function _defenseLossCount(
        Defense defense,
        uint32 count,
        uint256 shots,
        uint256 attack,
        CombatTech memory targetTech,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 unit
    ) private pure returns (uint32) {
        return _lossCount(
            count,
            shots,
            attack,
            _combatScaled(VeydriftCatalog.defenseBattleShield(defense), targetTech.shielding),
            _combatScaled(VeydriftCatalog.defenseBattleHull(defense), targetTech.armor),
            seed,
            round,
            side,
            unit
        );
    }

    function _lossCount(
        uint32 count,
        uint256 shots,
        uint256 attack,
        uint256 shield,
        uint256 hull,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 unit
    ) private pure returns (uint32) {
        if (count == 0 || shots == 0 || attack == 0 || hull == 0) return 0;

        uint256 targeted = shots < count ? shots : count;
        uint256 shotsPerTarget = (shots + targeted - 1) / targeted;
        uint256 damage = attack * shotsPerTarget;
        if (attack <= shield / 100 || damage <= shield) return 0;

        uint256 hullDamage = damage - shield;
        // targeted is capped by count, which is already uint32.
        // forge-lint: disable-next-line(unsafe-typecast)
        if (hullDamage >= hull) return uint32(targeted);

        uint256 damageBps = (hullDamage * BPS) / hull;
        if (damageBps <= 3_000) return 0;

        uint256 sampled = _sampleChance(targeted, damageBps, seed, round, side, unit, 0, shots);
        // sampled is capped to targeted, which is capped by count.
        // forge-lint: disable-next-line(unsafe-typecast)
        return sampled > targeted ? uint32(targeted) : uint32(sampled);
    }

    function _attackerExtraShots(
        BattleResult memory result,
        Ship firingShip,
        uint256 shots,
        uint256 targetTotal,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 firingUnit
    ) private pure returns (uint256 extraShots) {
        uint256 incoming = shots;
        for (uint8 chain = 0; chain < MAX_RAPIDFIRE_CHAIN;) {
            uint256 generated = _shipExtraShots(
                result.attackerShips,
                TARGET_LANE_ATTACKER_SHIP,
                0,
                firingShip,
                incoming,
                targetTotal,
                seed,
                round,
                side,
                firingUnit,
                chain
            )
            + _shipExtraShots(
                result.joinedAttackerShips,
                TARGET_LANE_ATTACKER_SHIP,
                1,
                firingShip,
                incoming,
                targetTotal,
                seed,
                round,
                side,
                firingUnit,
                chain
            );
            if (generated == 0) return extraShots;
            extraShots += generated;
            incoming = generated;
            unchecked {
                ++chain;
            }
        }
    }

    function _defenderExtraShots(
        BattleResult memory result,
        Ship firingShip,
        uint256 shots,
        uint256 counterplayLaneGroup,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 firingUnit
    ) private pure returns (uint256 extraShots) {
        uint256 targetTotal = _defenderUnitTotal(result);
        uint256 incoming = shots;
        for (uint8 chain = 0; chain < MAX_RAPIDFIRE_CHAIN;) {
            uint256 generated = _shipExtraShots(
                result.defenderShips,
                TARGET_LANE_PLANET_SHIP,
                0,
                firingShip,
                incoming,
                targetTotal,
                seed,
                round,
                side,
                firingUnit,
                chain
            );
            for (uint8 i = 0; i < 8;) {
                generated += _unitExtraShots(
                    result.defenderDefenses[i],
                    VeydriftCatalog.shipRapidfireAgainstDefense(firingShip, Defense(i)),
                    incoming,
                    targetTotal,
                    seed,
                    round,
                    side,
                    firingUnit,
                    _targetLane(TARGET_LANE_DEFENSE, 0, i),
                    chain
                );
                unchecked {
                    ++i;
                }
            }
            generated += _shipExtraShots(
                result.counterplayShips,
                TARGET_LANE_COUNTERPLAY_SHIP,
                counterplayLaneGroup,
                firingShip,
                incoming,
                targetTotal,
                seed,
                round,
                side,
                firingUnit,
                chain
            );
            if (generated == 0) return extraShots;
            extraShots += generated;
            incoming = generated;
            unchecked {
                ++chain;
            }
        }
    }

    function _shipExtraShots(
        uint32[16] memory ships,
        uint256 laneBase,
        uint256 laneGroup,
        Ship firingShip,
        uint256 incoming,
        uint256 targetTotal,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 firingUnit,
        uint8 chain
    ) private pure returns (uint256 generated) {
        for (uint8 shipId = 0; shipId < 16;) {
            if (!_isPlanetCombatShipId(shipId)) {
                unchecked {
                    ++shipId;
                }
                continue;
            }
            generated += _unitExtraShots(
                ships[shipId],
                VeydriftCatalog.shipRapidfireAgainstShip(firingShip, Ship(shipId)),
                incoming,
                targetTotal,
                seed,
                round,
                side,
                firingUnit,
                _targetLane(laneBase, laneGroup, shipId),
                chain
            );
            unchecked {
                ++shipId;
            }
        }
    }

    function _unitExtraShots(
        uint32 count,
        uint8 rapidfire,
        uint256 incoming,
        uint256 targetTotal,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 firingUnit,
        uint256 lane,
        uint8 chain
    ) private pure returns (uint256) {
        if (count == 0 || rapidfire <= 1) return 0;
        uint256 selected = _distributedTargetShots(
            incoming,
            count,
            targetTotal,
            seed,
            round,
            side,
            firingUnit,
            lane + (uint256(chain) + 1) * 8_192
        );
        return _sampleChance(
            selected,
            (uint256(rapidfire - 1) * BPS) / rapidfire,
            seed,
            round,
            side,
            firingUnit,
            lane,
            30_000 + chain
        );
    }

    function _distributedTargetShots(
        uint256 shots,
        uint32 targetCount,
        uint256 targetTotal,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 firingUnit,
        uint256 targetUnit
    ) private pure returns (uint256 assigned) {
        if (shots == 0 || targetCount == 0 || targetTotal == 0) return 0;
        uint256 weightedShots = shots * targetCount;
        assigned = weightedShots / targetTotal;
        if (
            _combatStream(seed, round, side, firingUnit, targetUnit, 0) % targetTotal
                < weightedShots % targetTotal
        ) {
            assigned += 1;
        }
    }

    function _sampleChance(
        uint256 trials,
        uint256 chanceBps,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 unit,
        uint256 targetUnit,
        uint256 lane
    ) private pure returns (uint256 sampled) {
        if (trials == 0 || chanceBps == 0) return 0;
        if (chanceBps >= BPS) return trials;

        uint256 scaled = trials * chanceBps;
        sampled = scaled / BPS;
        if (_combatStream(seed, round, side, unit, targetUnit, lane) % BPS < scaled % BPS) {
            sampled += 1;
        }
    }

    function _combatStream(
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 firingUnit,
        uint256 targetUnit,
        uint256 stream
    ) private pure returns (uint256) {
        return uint256(
            keccak256(
                abi.encode(COMBAT_STREAM_DOMAIN, seed, round, side, firingUnit, targetUnit, stream)
            )
        );
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
        return shipId <= uint8(Ship.Pathfinder) && shipId != uint8(Ship.SolarSatellite);
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

    function _targetLane(uint256 base, uint256 group, uint8 unit) private pure returns (uint256) {
        return base + group * TARGET_LANE_STRIDE + unit;
    }

    function _shipCost(Ship ship) private pure returns (VeydriftGameStorage.Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(ship);
        return VeydriftGameStorage.Resources(metal, crystal, deuterium);
    }

    function _multiply(VeydriftGameStorage.Resources memory resources, uint32 quantity)
        private
        pure
        returns (VeydriftGameStorage.Resources memory)
    {
        return VeydriftGameStorage.Resources({
            metal: uint128(uint256(resources.metal) * quantity),
            crystal: uint128(uint256(resources.crystal) * quantity),
            deuterium: uint128(uint256(resources.deuterium) * quantity)
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
