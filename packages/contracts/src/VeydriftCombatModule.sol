// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftAntiRaidPrimitives} from "./libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {Building, Defense, Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IVeydriftCombatSpaceDock {
    function recordCombatWreckage(uint256 planetId, Ship ship, uint32 destroyed) external;
}

interface IVeydriftCombatMoonSystem {
    function requestMoonChanceFromBattle(
        uint256 battleId,
        uint256 targetPlanetId,
        uint128 metalDebris,
        uint128 crystalDebris
    ) external returns (uint256 outcomeId, uint256 requestId);
}

/// @notice Delegatecall target for public-state fleet attack battle resolution.
contract VeydriftCombatModule is VeydriftResourceReserves {
    uint256 private constant MOON_CHANCE_DEBRIS_UNIT = 100_000;

    struct BattleStats {
        uint256 attack;
        uint256 durability;
        uint256 units;
    }

    struct BattleSettlement {
        BattleOutcome outcome;
        uint8 rounds;
        uint256 seed;
        Resources attackerLosses;
        Resources defenderLosses;
    }

    constructor() VeydriftResourceReserves(address(0)) {}

    function launchInterplanetaryMissileAttack(
        uint256 originPlanetId,
        uint256 targetPlanetId,
        Defense primaryTarget,
        uint32 quantity
    ) external {
        Planet storage origin = _planets[originPlanetId];
        if (origin.owner == address(0)) revert NoPlanet();
        if (origin.owner != msg.sender) revert NotPlanetOwner();
        if (originPlanetId == targetPlanetId) revert SamePlanet();
        Planet storage target = _planets[targetPlanetId];
        if (target.owner == address(0)) revert NoPlanet();
        _requireNoPendingMissionResolutionForPlanet(originPlanetId);
        _requireNoPendingMissionResolutionForPlanet(targetPlanetId);
        if (primaryTarget > Defense.LargeShieldDome) revert InvalidMissileTarget(primaryTarget);

        uint256 range = _interplanetaryMissileRange(msg.sender);
        if (
            origin.galaxy != target.galaxy
                || _systemDistanceForMissiles(origin.system, target.system) > range
        ) {
            revert InterplanetaryMissileOutOfRange(origin.system, target.system, range);
        }

        uint32 available = _defenseCounts[originPlanetId][Defense.InterplanetaryMissile];
        if (quantity == 0 || available < quantity) revert InvalidQuantity();
        _defenseCounts[originPlanetId][Defense.InterplanetaryMissile] = available - quantity;

        uint32 antiBallistic = _defenseCounts[targetPlanetId][Defense.AntiBallisticMissile];
        uint32 intercepted = antiBallistic < quantity ? antiBallistic : quantity;
        _defenseCounts[targetPlanetId][Defense.AntiBallisticMissile] = antiBallistic - intercepted;

        uint32 hits = quantity - intercepted;
        uint32 targetDefense = _defenseCounts[targetPlanetId][primaryTarget];
        uint32 destroyedPrimary = targetDefense < hits ? targetDefense : hits;
        _defenseCounts[targetPlanetId][primaryTarget] = targetDefense - destroyedPrimary;

        emit InterplanetaryMissileAttack(
            msg.sender,
            originPlanetId,
            targetPlanetId,
            primaryTarget,
            quantity,
            intercepted,
            hits,
            destroyedPrimary
        );
    }

    function _interplanetaryMissileRange(address attacker) private view returns (uint256) {
        uint16 impulseDrive = _technologyLevels[attacker][Technology.ImpulseDrive];
        if (impulseDrive == 0) return 0;
        return uint256(impulseDrive) * 5 - 1;
    }

    function _systemDistanceForMissiles(uint16 originSystem, uint16 targetSystem)
        private
        pure
        returns (uint256)
    {
        return originSystem > targetSystem
            ? uint256(originSystem - targetSystem)
            : uint256(targetSystem - originSystem);
    }

    function resolveFleetMission(uint256 missionId) external {
        FleetMission storage mission = _fleetMissions[missionId];
        if (mission.missionType == FleetMissionType.Harvest) {
            _harvestDebris(mission);
            mission.status = FleetMissionStatus.Returning;
            return;
        }

        BattleSettlement memory settlement = _runBattle(missionId, mission);

        if (settlement.outcome == BattleOutcome.AttackerWin) {
            _raidResourcesForAttackGroup(missionId, mission);
        }
        _returnLinkedMissions(missionId, mission);

        bool returning = _missionShipTotal(mission.ships) != 0;
        if (returning) {
            mission.status = FleetMissionStatus.Returning;
        } else {
            mission.status = FleetMissionStatus.Resolved;
            mission.returnAt = uint64(block.timestamp);
            activeFleetMissionCount[mission.owner] -= 1;
            _decreaseInternalResources(mission.cargo);
            mission.cargo = Resources({metal: 0, crystal: 0, deuterium: 0});
        }

        Resources memory debris = _reserveLimitedIncrease(
            _battleDebris(settlement.attackerLosses, settlement.defenderLosses)
        );
        if (debris.metal != 0 || debris.crystal != 0) {
            DebrisField storage field = _debrisFields[mission.targetPlanetId];
            field.metal += debris.metal;
            field.crystal += debris.crystal;
            _increaseInternalResources(debris);
            _emitDebrisFieldUpdated(mission.targetPlanetId);
        }
        emit AttackBattleResolved(
            missionId,
            mission.owner,
            mission.targetPlanetId,
            settlement.outcome,
            settlement.rounds,
            settlement.seed,
            mission.cargo.metal,
            mission.cargo.crystal,
            mission.cargo.deuterium
        );
        emit CombatLosses(
            missionId,
            settlement.attackerLosses.metal,
            settlement.attackerLosses.crystal,
            settlement.attackerLosses.deuterium,
            settlement.defenderLosses.metal,
            settlement.defenderLosses.crystal,
            settlement.defenderLosses.deuterium
        );
        emit CombatDebrisSignaled(missionId, mission.targetPlanetId, debris.metal, debris.crystal);
        _requestMoonChanceFromBattle(missionId, mission.targetPlanetId, debris);
    }

    function _runBattle(uint256 missionId, FleetMission storage mission)
        private
        returns (BattleSettlement memory settlement)
    {
        settlement.seed = _battleSeed(missionId, mission);
        for (uint8 round = 1; round <= BATTLE_MAX_ROUNDS;) {
            BattleStats memory attacker = _attackerGroupBattleStats(missionId, mission);
            BattleStats memory defender = _defenderBattleStats(missionId, mission.targetPlanetId);

            if (attacker.units == 0 || defender.units == 0) break;

            MissionShips memory attackerRoundShips = mission.ships;
            settlement.attackerLosses = _add(
                settlement.attackerLosses,
                _applyAttackerGroupLosses(missionId, mission, settlement.seed, round)
            );
            settlement.defenderLosses = _add(
                settlement.defenderLosses,
                _applyDefenderGroupLosses(
                    missionId,
                    mission.targetPlanetId,
                    attackerRoundShips,
                    mission.owner,
                    settlement.seed,
                    round
                )
            );
            settlement.rounds = round;

            unchecked {
                ++round;
            }
        }

        BattleStats memory finalAttacker = _attackerGroupBattleStats(missionId, mission);
        BattleStats memory finalDefender = _defenderBattleStats(missionId, mission.targetPlanetId);
        if (finalAttacker.units != 0 && finalDefender.units == 0) {
            settlement.outcome = BattleOutcome.AttackerWin;
        } else if (finalAttacker.units == 0 && finalDefender.units != 0) {
            settlement.outcome = BattleOutcome.DefenderWin;
        } else {
            settlement.outcome = BattleOutcome.Draw;
        }
    }

    function _attackerGroupBattleStats(uint256 attackMissionId, FleetMission storage mission)
        private
        view
        returns (BattleStats memory stats)
    {
        stats = _attackerBattleStats(mission.ships, mission.owner);
        uint256[] storage linkedMissionIds = _fleetCounterplayMissions[attackMissionId];
        for (uint256 i = 0; i < linkedMissionIds.length;) {
            FleetMission storage joined = _fleetMissions[linkedMissionIds[i]];
            if (_isQualifiedJoinedAttack(attackMissionId, joined)) {
                BattleStats memory joinedStats = _attackerBattleStats(joined.ships, joined.owner);
                stats.attack += joinedStats.attack;
                stats.durability += joinedStats.durability;
                stats.units += joinedStats.units;
            }
            unchecked {
                ++i;
            }
        }
    }

    function _attackerBattleStats(MissionShips memory ships, address owner)
        private
        view
        returns (BattleStats memory stats)
    {
        uint16 weapons = _technologyLevels[owner][Technology.Weapons];
        uint16 shielding = _technologyLevels[owner][Technology.Shielding];
        uint16 armor = _technologyLevels[owner][Technology.Armor];
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 count = _missionShipQuantity(ships, ship);
            if (count != 0) _addShipStats(stats, ship, count, weapons, shielding, armor);
            unchecked {
                ++i;
            }
        }
    }

    function _defenderBattleStats(uint256 hostileMissionId, uint256 planetId)
        private
        view
        returns (BattleStats memory stats)
    {
        address owner = _planets[planetId].owner;
        uint16 weapons = _technologyLevels[owner][Technology.Weapons];
        uint16 shielding = _technologyLevels[owner][Technology.Shielding];
        uint16 armor = _technologyLevels[owner][Technology.Armor];
        for (uint8 i = 0; i <= MAX_SHIP_ID;) {
            Ship ship = Ship(i);
            uint32 count = _shipCounts[planetId][ship];
            if (count != 0) _addShipStats(stats, ship, count, weapons, shielding, armor);
            unchecked {
                ++i;
            }
        }
        for (uint8 i = 0; i <= MAX_DEFENSE_ID;) {
            Defense defense = Defense(i);
            uint32 count = _defenseCounts[planetId][defense];
            if (count != 0 && i <= uint8(Defense.LargeShieldDome)) {
                _addDefenseStats(stats, defense, count, weapons, shielding, armor);
            }
            unchecked {
                ++i;
            }
        }
        uint256[] storage counterplayMissionIds = _fleetCounterplayMissions[hostileMissionId];
        for (uint256 i = 0; i < counterplayMissionIds.length;) {
            uint256 counterplayMissionId = counterplayMissionIds[i];
            FleetMission storage counterplay = _fleetMissions[counterplayMissionId];
            if (_isQualifiedCounterplay(hostileMissionId, counterplay)) {
                uint16 allyWeapons = _technologyLevels[counterplay.owner][Technology.Weapons];
                uint16 allyShielding = _technologyLevels[counterplay.owner][Technology.Shielding];
                uint16 allyArmor = _technologyLevels[counterplay.owner][Technology.Armor];
                for (uint8 shipId = 0; shipId <= uint8(Ship.Pathfinder);) {
                    Ship ship = Ship(shipId);
                    uint32 count = _missionShipQuantity(counterplay.ships, ship);
                    if (count != 0) {
                        _addShipStats(stats, ship, count, allyWeapons, allyShielding, allyArmor);
                    }
                    unchecked {
                        ++shipId;
                    }
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _addShipStats(
        BattleStats memory stats,
        Ship ship,
        uint32 count,
        uint16 weapons,
        uint16 shielding,
        uint16 armor
    ) private pure {
        stats.units += count;
        stats.attack += _combatScaled(VeydriftCatalog.shipBattleAttack(ship), weapons) * count;
        stats.durability += (_combatScaled(VeydriftCatalog.shipBattleHull(ship), armor)
                + _combatScaled(VeydriftCatalog.shipBattleShield(ship), shielding)) * count;
    }

    function _addDefenseStats(
        BattleStats memory stats,
        Defense defense,
        uint32 count,
        uint16 weapons,
        uint16 shielding,
        uint16 armor
    ) private pure {
        stats.units += count;
        stats.attack += _combatScaled(VeydriftCatalog.defenseBattleAttack(defense), weapons) * count;
        stats.durability += (_combatScaled(VeydriftCatalog.defenseBattleHull(defense), armor)
                + _combatScaled(VeydriftCatalog.defenseBattleShield(defense), shielding)) * count;
    }

    function _applyAttackerLosses(
        MissionShips storage ships,
        address attackerOwner,
        uint256 hostileMissionId,
        uint256 targetPlanetId,
        uint256 seed,
        uint8 round
    ) private returns (Resources memory losses) {
        address defender = _planets[targetPlanetId].owner;
        uint16 weapons = _technologyLevels[defender][Technology.Weapons];
        for (uint8 i = 0; i <= MAX_SHIP_ID;) {
            Ship ship = Ship(i);
            uint32 count = _shipCounts[targetPlanetId][ship];
            if (count != 0) {
                losses = _add(
                    losses,
                    _fireShipAtAttackers(
                        ships, attackerOwner, ship, count, weapons, seed, round, 1, i
                    )
                );
            }
            unchecked {
                ++i;
            }
        }
        for (uint8 i = 0; i <= uint8(Defense.LargeShieldDome);) {
            Defense defense = Defense(i);
            uint32 count = _defenseCounts[targetPlanetId][defense];
            if (count != 0) {
                losses = _add(
                    losses,
                    _fireDefenseAtAttackers(
                        ships, attackerOwner, defense, count, weapons, seed, round, 2, i
                    )
                );
            }
            unchecked {
                ++i;
            }
        }
        uint256[] storage counterplayMissionIds = _fleetCounterplayMissions[hostileMissionId];
        for (uint256 i = 0; i < counterplayMissionIds.length;) {
            uint256 counterplayMissionId = counterplayMissionIds[i];
            FleetMission storage counterplay = _fleetMissions[counterplayMissionId];
            if (_isQualifiedCounterplay(hostileMissionId, counterplay)) {
                uint16 allyWeapons = _technologyLevels[counterplay.owner][Technology.Weapons];
                for (uint8 shipId = 0; shipId <= uint8(Ship.Pathfinder);) {
                    Ship ship = Ship(shipId);
                    uint32 count = _missionShipQuantity(counterplay.ships, ship);
                    if (count != 0) {
                        losses = _add(
                            losses,
                            _fireShipAtAttackers(
                                ships,
                                attackerOwner,
                                ship,
                                count,
                                allyWeapons,
                                seed,
                                round,
                                3,
                                shipId
                            )
                        );
                    }
                    unchecked {
                        ++shipId;
                    }
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _fireShipAtAttackers(
        MissionShips storage targets,
        address targetOwner,
        Ship firingShip,
        uint32 firingCount,
        uint16 firingWeapons,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private returns (Resources memory losses) {
        uint256 groups = _missionShipGroupCount(targets);
        if (groups == 0) return losses;

        Ship targetShip = _missionShipByOrdinal(
            targets, uint256(keccak256(abi.encode(seed, round, side, unit))) % groups
        );
        uint32 targetCount = _missionShipQuantity(targets, targetShip);
        uint32 lost = _classicShipLossCount(
            targetShip,
            targetCount,
            uint256(firingCount) * VeydriftCatalog.shipRapidfireAgainstShip(firingShip, targetShip),
            _combatScaled(VeydriftCatalog.shipBattleAttack(firingShip), firingWeapons),
            targetOwner,
            seed,
            round,
            side,
            unit
        );
        if (lost == 0) return losses;

        _setMissionShipQuantity(targets, targetShip, targetCount - lost);
        return _multiply(_shipCost(targetShip), lost);
    }

    function _fireDefenseAtAttackers(
        MissionShips storage targets,
        address targetOwner,
        Defense firingDefense,
        uint32 firingCount,
        uint16 firingWeapons,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private returns (Resources memory losses) {
        uint256 groups = _missionShipGroupCount(targets);
        if (groups == 0) return losses;

        Ship targetShip = _missionShipByOrdinal(
            targets, uint256(keccak256(abi.encode(seed, round, side, unit))) % groups
        );
        uint32 targetCount = _missionShipQuantity(targets, targetShip);
        uint32 lost = _classicShipLossCount(
            targetShip,
            targetCount,
            firingCount,
            _combatScaled(VeydriftCatalog.defenseBattleAttack(firingDefense), firingWeapons),
            targetOwner,
            seed,
            round,
            side,
            unit
        );
        if (lost == 0) return losses;

        _setMissionShipQuantity(targets, targetShip, targetCount - lost);
        return _multiply(_shipCost(targetShip), lost);
    }

    function _fireShipAtDefenders(
        uint256 hostileMissionId,
        uint256 planetId,
        Ship firingShip,
        uint32 firingCount,
        uint16 firingWeapons,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private returns (Resources memory losses) {
        uint256 groups = _defenderGroupCount(hostileMissionId, planetId);
        if (groups == 0) return losses;

        uint256 ordinal = uint256(keccak256(abi.encode(seed, round, side, unit))) % groups;
        uint256 attack = _combatScaled(VeydriftCatalog.shipBattleAttack(firingShip), firingWeapons);
        return _applyShipFireToDefenderTarget(
            hostileMissionId,
            planetId,
            firingShip,
            firingCount,
            attack,
            ordinal,
            seed,
            round,
            side,
            unit
        );
    }

    function _applyShipFireToDefenderTarget(
        uint256 hostileMissionId,
        uint256 planetId,
        Ship firingShip,
        uint32 firingCount,
        uint256 attack,
        uint256 ordinal,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private returns (Resources memory losses) {
        for (uint8 i = 0; i <= MAX_SHIP_ID;) {
            Ship ship = Ship(i);
            uint32 count = _shipCounts[planetId][ship];
            if (count != 0) {
                if (ordinal == 0) {
                    uint32 lost = _classicPlanetShipLossCount(
                        planetId,
                        ship,
                        count,
                        uint256(firingCount)
                            * VeydriftCatalog.shipRapidfireAgainstShip(firingShip, ship),
                        attack,
                        seed,
                        round,
                        side,
                        unit
                    );
                    if (lost != 0) {
                        _shipCounts[planetId][ship] = count - lost;
                        _recordCombatWreckage(planetId, ship, lost);
                        return _multiply(_shipCost(ship), lost);
                    }
                    return losses;
                }
                unchecked {
                    --ordinal;
                }
            }
            unchecked {
                ++i;
            }
        }
        for (uint8 i = 0; i <= uint8(Defense.LargeShieldDome);) {
            Defense defense = Defense(i);
            uint32 count = _defenseCounts[planetId][defense];
            if (count != 0) {
                if (ordinal == 0) {
                    uint32 lost = _classicDefenseLossCount(
                        planetId,
                        defense,
                        count,
                        uint256(firingCount)
                            * VeydriftCatalog.shipRapidfireAgainstDefense(firingShip, defense),
                        attack,
                        seed,
                        round,
                        side,
                        unit
                    );
                    if (lost != 0) {
                        _defenseCounts[planetId][defense] = count - lost;
                        return _multiply(_defenseCost(defense), lost);
                    }
                    return losses;
                }
                unchecked {
                    --ordinal;
                }
            }
            unchecked {
                ++i;
            }
        }
        return _applyShipFireToCounterplayTarget(
            hostileMissionId, firingShip, firingCount, attack, ordinal, seed, round, side, unit
        );
    }

    function _applyShipFireToCounterplayTarget(
        uint256 hostileMissionId,
        Ship firingShip,
        uint32 firingCount,
        uint256 attack,
        uint256 ordinal,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private returns (Resources memory losses) {
        uint256[] storage counterplayMissionIds = _fleetCounterplayMissions[hostileMissionId];
        for (uint256 i = 0; i < counterplayMissionIds.length;) {
            uint256 counterplayMissionId = counterplayMissionIds[i];
            FleetMission storage counterplay = _fleetMissions[counterplayMissionId];
            if (_isQualifiedCounterplay(hostileMissionId, counterplay)) {
                for (uint8 shipId = 0; shipId <= uint8(Ship.Pathfinder);) {
                    Ship targetShip = Ship(shipId);
                    uint32 count = _missionShipQuantity(counterplay.ships, targetShip);
                    if (count != 0) {
                        if (ordinal == 0) {
                            uint32 lost = _classicShipLossCount(
                                targetShip,
                                count,
                                uint256(firingCount)
                                    * VeydriftCatalog.shipRapidfireAgainstShip(
                                        firingShip, targetShip
                                    ),
                                attack,
                                counterplay.owner,
                                seed,
                                round,
                                side,
                                unit
                            );
                            if (lost != 0) {
                                _setMissionShipQuantity(counterplay.ships, targetShip, count - lost);
                                return _multiply(_shipCost(targetShip), lost);
                            }
                            return losses;
                        }
                        unchecked {
                            --ordinal;
                        }
                    }
                    unchecked {
                        ++shipId;
                    }
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _applyAttackerGroupLosses(
        uint256 attackMissionId,
        FleetMission storage mission,
        uint256 seed,
        uint8 round
    ) private returns (Resources memory losses) {
        losses = _applyAttackerLosses(
            mission.ships, mission.owner, attackMissionId, mission.targetPlanetId, seed, round
        );

        uint256[] storage linkedMissionIds = _fleetCounterplayMissions[attackMissionId];
        for (uint256 i = 0; i < linkedMissionIds.length;) {
            uint256 joinedMissionId = linkedMissionIds[i];
            FleetMission storage joined = _fleetMissions[joinedMissionId];
            if (_isQualifiedJoinedAttack(attackMissionId, joined)) {
                losses = _add(
                    losses,
                    _applyAttackerLosses(
                        joined.ships,
                        joined.owner,
                        attackMissionId,
                        mission.targetPlanetId,
                        seed,
                        round
                    )
                );
            }
            unchecked {
                ++i;
            }
        }
    }

    function _applyDefenderGroupLosses(
        uint256 attackMissionId,
        uint256 planetId,
        MissionShips memory attackerRoundShips,
        address attackerOwner,
        uint256 seed,
        uint8 round
    ) private returns (Resources memory losses) {
        losses = _applyDefenderLosses(
            attackMissionId, planetId, attackerRoundShips, attackerOwner, seed, round
        );

        uint256[] storage linkedMissionIds = _fleetCounterplayMissions[attackMissionId];
        for (uint256 i = 0; i < linkedMissionIds.length;) {
            uint256 joinedMissionId = linkedMissionIds[i];
            FleetMission storage joined = _fleetMissions[joinedMissionId];
            if (_isQualifiedJoinedAttack(attackMissionId, joined)) {
                losses = _add(
                    losses,
                    _applyDefenderLosses(
                        attackMissionId, planetId, joined.ships, joined.owner, seed, round
                    )
                );
            }
            unchecked {
                ++i;
            }
        }
    }

    function _applyDefenderLosses(
        uint256 hostileMissionId,
        uint256 planetId,
        MissionShips memory attackerRoundShips,
        address attackerOwner,
        uint256 seed,
        uint8 round
    ) private returns (Resources memory losses) {
        uint16 weapons = _technologyLevels[attackerOwner][Technology.Weapons];
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 count = _missionShipQuantity(attackerRoundShips, ship);
            if (count != 0) {
                losses = _add(
                    losses,
                    _fireShipAtDefenders(
                        hostileMissionId, planetId, ship, count, weapons, seed, round, 4, i
                    )
                );
            }
            unchecked {
                ++i;
            }
        }
    }

    function _classicPlanetShipLossCount(
        uint256 planetId,
        Ship ship,
        uint32 count,
        uint256 shots,
        uint256 attack,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private view returns (uint32) {
        address owner = _planets[planetId].owner;
        return _classicShipLossCount(ship, count, shots, attack, owner, seed, round, side, unit);
    }

    function _classicShipLossCount(
        Ship ship,
        uint32 count,
        uint256 shots,
        uint256 attack,
        address owner,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private view returns (uint32) {
        uint16 shielding = _technologyLevels[owner][Technology.Shielding];
        uint16 armor = _technologyLevels[owner][Technology.Armor];
        return _classicLossCount(
            count,
            shots,
            attack,
            _combatScaled(VeydriftCatalog.shipBattleShield(ship), shielding),
            _combatScaled(VeydriftCatalog.shipBattleHull(ship), armor),
            seed,
            round,
            side,
            unit
        );
    }

    function _classicDefenseLossCount(
        uint256 planetId,
        Defense defense,
        uint32 count,
        uint256 shots,
        uint256 attack,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private view returns (uint32) {
        address owner = _planets[planetId].owner;
        uint16 shielding = _technologyLevels[owner][Technology.Shielding];
        uint16 armor = _technologyLevels[owner][Technology.Armor];
        return _classicLossCount(
            count,
            shots,
            attack,
            _combatScaled(VeydriftCatalog.defenseBattleShield(defense), shielding),
            _combatScaled(VeydriftCatalog.defenseBattleHull(defense), armor),
            seed,
            round,
            side,
            unit
        );
    }

    function _classicLossCount(
        uint32 count,
        uint256 shots,
        uint256 attack,
        uint256 shield,
        uint256 hull,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private pure returns (uint32) {
        if (count == 0 || shots == 0 || attack == 0 || hull == 0) return 0;

        uint256 targeted = shots < count ? shots : count;
        uint256 shotsPerTarget = (shots + targeted - 1) / targeted;
        uint256 damage = attack * shotsPerTarget;
        if (damage <= shield || damage <= shield / 100) return 0;

        uint256 hullDamage = damage - shield;
        // targeted is capped by count, which is already uint32.
        // forge-lint: disable-next-line(unsafe-typecast)
        if (hullDamage >= hull) return uint32(targeted);

        uint256 damageBps = (hullDamage * BPS) / hull;
        if (damageBps <= 3_000) return 0;

        uint256 scaled = targeted * damageBps;
        // scaled / BPS is bounded by targeted, which is capped by uint32 count.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint32 lost = uint32(scaled / BPS);
        if (uint256(keccak256(abi.encode(seed, round, side, unit, shots))) % BPS < scaled % BPS) {
            lost += 1;
        }
        // targeted is capped by count, which is already uint32.
        // forge-lint: disable-next-line(unsafe-typecast)
        return lost > targeted ? uint32(targeted) : lost;
    }

    function _missionShipGroupCount(MissionShips storage ships)
        private
        pure
        returns (uint256 groups)
    {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            if (_missionShipQuantity(ships, Ship(i)) != 0) groups += 1;
            unchecked {
                ++i;
            }
        }
    }

    function _missionShipByOrdinal(MissionShips storage ships, uint256 ordinal)
        private
        pure
        returns (Ship)
    {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            if (_missionShipQuantity(ships, ship) != 0) {
                if (ordinal == 0) return ship;
                unchecked {
                    --ordinal;
                }
            }
            unchecked {
                ++i;
            }
        }
        return Ship.SmallCargo;
    }

    function _defenderGroupCount(uint256 hostileMissionId, uint256 planetId)
        private
        view
        returns (uint256 groups)
    {
        for (uint8 i = 0; i <= MAX_SHIP_ID;) {
            if (_shipCounts[planetId][Ship(i)] != 0) groups += 1;
            unchecked {
                ++i;
            }
        }
        for (uint8 i = 0; i <= uint8(Defense.LargeShieldDome);) {
            if (_defenseCounts[planetId][Defense(i)] != 0) groups += 1;
            unchecked {
                ++i;
            }
        }
        uint256[] storage counterplayMissionIds = _fleetCounterplayMissions[hostileMissionId];
        for (uint256 i = 0; i < counterplayMissionIds.length;) {
            FleetMission storage counterplay = _fleetMissions[counterplayMissionIds[i]];
            if (_isQualifiedCounterplay(hostileMissionId, counterplay)) {
                for (uint8 shipId = 0; shipId <= uint8(Ship.Pathfinder);) {
                    if (_missionShipQuantity(counterplay.ships, Ship(shipId)) != 0) groups += 1;
                    unchecked {
                        ++shipId;
                    }
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _returnLinkedMissions(uint256 hostileMissionId, FleetMission storage hostile) private {
        _returnJoinedAttackMissions(hostileMissionId, hostile);
        _returnCounterplayMissions(hostileMissionId, hostile);
    }

    function _returnJoinedAttackMissions(uint256 attackMissionId, FleetMission storage attack)
        private
    {
        uint256[] storage linkedMissionIds = _fleetCounterplayMissions[attackMissionId];
        for (uint256 i = 0; i < linkedMissionIds.length;) {
            uint256 joinedMissionId = linkedMissionIds[i];
            FleetMission storage joined = _fleetMissions[joinedMissionId];
            if (_isQualifiedJoinedAttack(attackMissionId, joined)) {
                if (_missionShipTotal(joined.ships) == 0) {
                    joined.status = FleetMissionStatus.Resolved;
                    joined.returnAt = uint64(block.timestamp);
                    activeFleetMissionCount[joined.owner] -= 1;
                    _decreaseInternalResources(joined.cargo);
                    joined.cargo = Resources({metal: 0, crystal: 0, deuterium: 0});
                } else {
                    joined.status = FleetMissionStatus.Returning;
                    joined.returnAt = uint64(
                        block.timestamp
                            + VeydriftAntiRaidPrimitives.travelSeconds(
                                _planetDistance(attack.targetPlanetId, joined.originPlanetId)
                            )
                    );
                    emit FleetMissionReturnExposed(
                        joinedMissionId,
                        joined.owner,
                        FleetMissionStatus.Returning,
                        joined.originPlanetId,
                        joined.targetPlanetId,
                        joined.returnAt,
                        joined.cargo.metal,
                        joined.cargo.crystal,
                        joined.cargo.deuterium
                    );
                }
                emit FleetMissionResolved(
                    joinedMissionId, msg.sender, joined.missionType, joined.returnAt
                );
            }
            unchecked {
                ++i;
            }
        }
    }

    function _returnCounterplayMissions(uint256 hostileMissionId, FleetMission storage hostile)
        private
    {
        uint256[] storage counterplayMissionIds = _fleetCounterplayMissions[hostileMissionId];
        for (uint256 i = 0; i < counterplayMissionIds.length;) {
            uint256 counterplayMissionId = counterplayMissionIds[i];
            FleetMission storage counterplay = _fleetMissions[counterplayMissionId];
            if (_isQualifiedCounterplay(hostileMissionId, counterplay)) {
                if (_missionShipTotal(counterplay.ships) == 0) {
                    counterplay.status = FleetMissionStatus.Resolved;
                    counterplay.returnAt = uint64(block.timestamp);
                    activeFleetMissionCount[counterplay.owner] -= 1;
                    _decreaseInternalResources(counterplay.cargo);
                    counterplay.cargo = Resources({metal: 0, crystal: 0, deuterium: 0});
                } else {
                    counterplay.status = FleetMissionStatus.Returning;
                    counterplay.returnAt = uint64(
                        block.timestamp
                            + VeydriftAntiRaidPrimitives.travelSeconds(
                                _planetDistance(hostile.targetPlanetId, counterplay.originPlanetId)
                            )
                    );
                    emit FleetMissionReturnExposed(
                        counterplayMissionId,
                        counterplay.owner,
                        FleetMissionStatus.Returning,
                        counterplay.originPlanetId,
                        counterplay.targetPlanetId,
                        counterplay.returnAt,
                        counterplay.cargo.metal,
                        counterplay.cargo.crystal,
                        counterplay.cargo.deuterium
                    );
                }
                emit FleetMissionResolved(
                    counterplayMissionId, msg.sender, counterplay.missionType, counterplay.returnAt
                );
            }
            unchecked {
                ++i;
            }
        }
    }

    function _isQualifiedCounterplay(uint256 hostileMissionId, FleetMission storage counterplay)
        private
        view
        returns (bool)
    {
        return counterplay.status == FleetMissionStatus.Outbound
            && counterplay.arrivalAt <= _fleetMissions[hostileMissionId].arrivalAt
            && (counterplay.missionType == FleetMissionType.AcsDefend
                || counterplay.missionType == FleetMissionType.Intercept);
    }

    function _isQualifiedJoinedAttack(uint256 attackMissionId, FleetMission storage joined)
        private
        view
        returns (bool)
    {
        return joined.status == FleetMissionStatus.Outbound
            && joined.arrivalAt <= _fleetMissions[attackMissionId].arrivalAt
            && joined.randomnessRequestId == attackMissionId
            && joined.targetPlanetId == _fleetMissions[attackMissionId].targetPlanetId
            && joined.missionType == FleetMissionType.AcsAttack;
    }

    function _recordCombatWreckage(uint256 planetId, Ship ship, uint32 destroyed) private {
        address spaceDockSystem = _spaceDockSystem;
        if (spaceDockSystem == address(0)) return;

        try IVeydriftCombatSpaceDock(spaceDockSystem)
            .recordCombatWreckage(planetId, ship, destroyed) {}
            catch {}
    }

    function _emitDebrisFieldUpdated(uint256 planetId) private {
        DebrisField storage field = _debrisFields[planetId];
        emit DebrisFieldUpdated(planetId, field.metal, field.crystal);
    }

    function _requestMoonChanceFromBattle(
        uint256 missionId,
        uint256 targetPlanetId,
        Resources memory debris
    ) private {
        if (_moonSystem == address(0)) return;
        if (uint256(debris.metal) + debris.crystal < MOON_CHANCE_DEBRIS_UNIT) return;

        IVeydriftCombatMoonSystem(_moonSystem)
            .requestMoonChanceFromBattle(missionId, targetPlanetId, debris.metal, debris.crystal);
    }

    function _harvestDebris(FleetMission storage mission) private {
        DebrisField storage field = _debrisFields[mission.targetPlanetId];
        uint256 capacity = _missionCargoCapacity(mission.ships);
        uint256 cargoTotal =
            uint256(mission.cargo.metal) + mission.cargo.crystal + mission.cargo.deuterium;
        if (capacity <= cargoTotal || (field.metal == 0 && field.crystal == 0)) return;

        capacity -= cargoTotal;
        uint128 metal = _toUint128(_min(field.metal, capacity));
        field.metal -= metal;
        capacity -= metal;

        uint128 crystal = _toUint128(_min(field.crystal, capacity));
        field.crystal -= crystal;

        mission.cargo.metal += metal;
        mission.cargo.crystal += crystal;
        _emitDebrisFieldUpdated(mission.targetPlanetId);
    }

    function _setMissionShipQuantity(MissionShips storage ships, Ship ship, uint32 quantity)
        private
    {
        if (ship == Ship.SmallCargo) ships.smallCargo = quantity;
        else if (ship == Ship.LightFighter) ships.lightFighter = quantity;
        else if (ship == Ship.Recycler) ships.recycler = quantity;
        else if (ship == Ship.ColonyShip) ships.colonyShip = quantity;
        else if (ship == Ship.LargeCargo) ships.largeCargo = quantity;
        else if (ship == Ship.HeavyFighter) ships.heavyFighter = quantity;
        else if (ship == Ship.Cruiser) ships.cruiser = quantity;
        else if (ship == Ship.Battleship) ships.battleship = quantity;
        else if (ship == Ship.Bomber) ships.bomber = quantity;
        else if (ship == Ship.Destroyer) ships.destroyer = quantity;
        else if (ship == Ship.Deathstar) ships.deathstar = quantity;
        else if (ship == Ship.Battlecruiser) ships.battlecruiser = quantity;
        else if (ship == Ship.Reaper) ships.reaper = quantity;
        else if (ship == Ship.Pathfinder) ships.pathfinder = quantity;
    }

    function _raidResourcesForAttackGroup(uint256 attackMissionId, FleetMission storage mission)
        private
    {
        uint256 totalCapacity = _remainingCargoCapacity(mission.ships, mission.cargo);
        uint256[] storage linkedMissionIds = _fleetCounterplayMissions[attackMissionId];
        for (uint256 i = 0; i < linkedMissionIds.length;) {
            FleetMission storage joined = _fleetMissions[linkedMissionIds[i]];
            if (_isQualifiedJoinedAttack(attackMissionId, joined)) {
                totalCapacity += _remainingCargoCapacity(joined.ships, joined.cargo);
            }
            unchecked {
                ++i;
            }
        }
        if (totalCapacity == 0) return;

        Resources memory loot = _raidResources(mission.targetPlanetId, totalCapacity);
        _distributeAttackGroupLoot(attackMissionId, mission, loot, totalCapacity);
    }

    function _distributeAttackGroupLoot(
        uint256 attackMissionId,
        FleetMission storage mission,
        Resources memory loot,
        uint256 totalCapacity
    ) private {
        Resources memory remaining = loot;
        uint256 remainingCapacity = totalCapacity;
        (remaining, remainingCapacity) = _assignLootShare(mission, remaining, remainingCapacity);

        uint256[] storage linkedMissionIds = _fleetCounterplayMissions[attackMissionId];
        for (uint256 i = 0; i < linkedMissionIds.length;) {
            FleetMission storage joined = _fleetMissions[linkedMissionIds[i]];
            if (_isQualifiedJoinedAttack(attackMissionId, joined)) {
                (remaining, remainingCapacity) =
                    _assignLootShare(joined, remaining, remainingCapacity);
            }
            unchecked {
                ++i;
            }
        }
    }

    function _assignLootShare(
        FleetMission storage recipient,
        Resources memory remaining,
        uint256 remainingCapacity
    ) private returns (Resources memory, uint256) {
        uint256 capacity = _remainingCargoCapacity(recipient.ships, recipient.cargo);
        if (capacity == 0 || remainingCapacity == 0) return (remaining, remainingCapacity);

        Resources memory share;
        if (capacity >= remainingCapacity) {
            share = remaining;
            remaining = Resources({metal: 0, crystal: 0, deuterium: 0});
        } else {
            share = Resources({
                metal: _toUint128((uint256(remaining.metal) * capacity) / remainingCapacity),
                crystal: _toUint128((uint256(remaining.crystal) * capacity) / remainingCapacity),
                deuterium: _toUint128((uint256(remaining.deuterium) * capacity) / remainingCapacity)
            });
            remaining.metal -= share.metal;
            remaining.crystal -= share.crystal;
            remaining.deuterium -= share.deuterium;
        }

        recipient.cargo = _add(recipient.cargo, share);
        remainingCapacity = capacity >= remainingCapacity ? 0 : remainingCapacity - capacity;
        return (remaining, remainingCapacity);
    }

    function _remainingCargoCapacity(MissionShips memory ships, Resources memory cargo)
        private
        pure
        returns (uint256)
    {
        uint256 capacity = _missionCargoCapacity(ships);
        uint256 used = uint256(cargo.metal) + cargo.crystal + cargo.deuterium;
        return capacity > used ? capacity - used : 0;
    }

    function _raidResources(uint256 targetPlanetId, uint256 capacity)
        private
        returns (Resources memory raided)
    {
        Resources storage target = _planets[targetPlanetId].resources;
        (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap) = _storageCaps(targetPlanetId);
        uint128 metal = _lootable(target.metal, metalCap, capacity);
        capacity -= metal;
        uint128 crystal = _lootable(target.crystal, crystalCap, capacity);
        capacity -= crystal;
        uint128 deuterium = _lootable(target.deuterium, deuteriumCap, capacity);
        target.metal -= metal;
        target.crystal -= crystal;
        target.deuterium -= deuterium;
        return Resources({metal: metal, crystal: crystal, deuterium: deuterium});
    }

    function _battleSeed(uint256 missionId, FleetMission storage mission)
        private
        view
        returns (uint256)
    {
        return uint256(
            keccak256(
                abi.encode(
                    ATTACK_BATTLE_DOMAIN,
                    block.chainid,
                    missionId,
                    mission.owner,
                    mission.originPlanetId,
                    mission.targetPlanetId,
                    mission.randomnessRequestId
                )
            )
        );
    }

    function _battleDebris(Resources memory attackerLosses, Resources memory defenderLosses)
        private
        pure
        returns (Resources memory debris)
    {
        debris.metal = _toUint128(
            ((uint256(attackerLosses.metal) + defenderLosses.metal) * COMBAT_DEBRIS_BPS) / BPS
        );
        debris.crystal = _toUint128(
            ((uint256(attackerLosses.crystal) + defenderLosses.crystal) * COMBAT_DEBRIS_BPS) / BPS
        );
    }

    function _storageCaps(uint256 planetId)
        private
        view
        returns (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap)
    {
        if (_planets[planetId].owner == address(0)) revert NoPlanet();
        return VeydriftFormulas.storageCaps(
            _buildingLevels[planetId][Building.MetalStorage],
            _buildingLevels[planetId][Building.CrystalStorage],
            _buildingLevels[planetId][Building.DeuteriumTank]
        );
    }

    function _lootable(uint128 available, uint128 storageCap, uint256 capacity)
        private
        pure
        returns (uint128)
    {
        uint256 protectedAmount = (uint256(storageCap) * RAID_PROTECTED_STORAGE_BPS) / BPS;
        if (available <= protectedAmount) return 0;
        uint256 loot = ((uint256(available) - protectedAmount) * RAID_LOOT_BPS) / BPS;
        return _toUint128(_min(loot, capacity));
    }

    function _combatScaled(uint256 value, uint16 technologyLevel) private pure returns (uint256) {
        return (value * (BPS + uint256(technologyLevel) * 1_000)) / BPS;
    }

    function _planetDistance(uint256 originPlanetId, uint256 destinationPlanetId)
        private
        view
        returns (uint256)
    {
        Planet storage origin = _planets[originPlanetId];
        Planet storage destination = _planets[destinationPlanetId];
        if (origin.owner == address(0) || destination.owner == address(0)) revert NoPlanet();
        uint256 galaxyDistance = origin.galaxy > destination.galaxy
            ? uint256(origin.galaxy - destination.galaxy)
            : uint256(destination.galaxy - origin.galaxy);
        uint256 systemDistance = origin.system > destination.system
            ? uint256(origin.system - destination.system)
            : uint256(destination.system - origin.system);
        uint256 positionDistance = origin.position > destination.position
            ? uint256(origin.position - destination.position)
            : uint256(destination.position - origin.position);
        return galaxyDistance * uint256(MAX_SYSTEM) * uint256(MAX_POSITION) + systemDistance
            * uint256(MAX_POSITION) + positionDistance;
    }

    function _missionCargoCapacity(MissionShips memory ships) private pure returns (uint256) {
        return uint256(ships.smallCargo) * VeydriftCatalog.shipCargoCapacity(Ship.SmallCargo)
            + uint256(ships.recycler) * VeydriftCatalog.shipCargoCapacity(Ship.Recycler)
            + uint256(ships.colonyShip) * VeydriftCatalog.shipCargoCapacity(Ship.ColonyShip)
            + uint256(ships.largeCargo) * VeydriftCatalog.shipCargoCapacity(Ship.LargeCargo)
            + uint256(ships.pathfinder) * VeydriftCatalog.shipCargoCapacity(Ship.Pathfinder);
    }

    function _missionShipTotal(MissionShips memory ships) private pure returns (uint256) {
        return uint256(ships.smallCargo) + ships.lightFighter + ships.recycler + ships.colonyShip
            + ships.largeCargo + ships.heavyFighter + ships.cruiser + ships.battleship
            + ships.bomber + ships.destroyer + ships.deathstar + ships.battlecruiser + ships.reaper
            + ships.pathfinder;
    }

    function _missionShipQuantity(MissionShips memory ships, Ship ship)
        private
        pure
        returns (uint32)
    {
        if (ship == Ship.SmallCargo) return ships.smallCargo;
        if (ship == Ship.LightFighter) return ships.lightFighter;
        if (ship == Ship.Recycler) return ships.recycler;
        if (ship == Ship.ColonyShip) return ships.colonyShip;
        if (ship == Ship.LargeCargo) return ships.largeCargo;
        if (ship == Ship.HeavyFighter) return ships.heavyFighter;
        if (ship == Ship.Cruiser) return ships.cruiser;
        if (ship == Ship.Battleship) return ships.battleship;
        if (ship == Ship.Bomber) return ships.bomber;
        if (ship == Ship.Destroyer) return ships.destroyer;
        if (ship == Ship.Deathstar) return ships.deathstar;
        if (ship == Ship.Battlecruiser) return ships.battlecruiser;
        if (ship == Ship.Reaper) return ships.reaper;
        if (ship == Ship.Pathfinder) return ships.pathfinder;
        return 0;
    }

    function _shipCost(Ship ship) private pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(ship);
        return Resources(metal, crystal, deuterium);
    }

    function _defenseCost(Defense defense) private pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.defenseCost(defense);
        return Resources(metal, crystal, deuterium);
    }

    function _multiply(Resources memory resources, uint32 quantity)
        private
        pure
        returns (Resources memory)
    {
        return Resources({
            metal: _toUint128(uint256(resources.metal) * quantity),
            crystal: _toUint128(uint256(resources.crystal) * quantity),
            deuterium: _toUint128(uint256(resources.deuterium) * quantity)
        });
    }
}
