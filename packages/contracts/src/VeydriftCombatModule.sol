// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftGameStorage} from "./VeydriftGameStorage.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {Building, Defense, Ship, Technology} from "./libraries/VeydriftTypes.sol";

struct FleetBattleGroup {
    uint256 missionId;
    address owner;
    uint256 laneGroup;
    VeydriftGameStorage.MissionShips ships;
}

struct DefenderBattleGroup {
    VeydriftGameStorage.MissionShips planetShips;
    uint32 solarSatellites;
    uint32 crawlers;
    uint32[8] defenses;
    FleetBattleGroup[] counterplay;
    uint256 units;
}

interface IVeydriftCombatMoonSystem {
    function requestMoonChanceFromBattle(
        uint256 battleId,
        uint256 targetPlanetId,
        uint128 metalDebris,
        uint128 crystalDebris
    ) external returns (uint256 outcomeId, uint256 requestId);

    function moonDefensePacked(uint256 planetId) external view returns (uint256);

    function applyMoonCombatDefenseChanges(uint256 planetId, uint256 changes, bool repair) external;
}

interface IVeydriftCombatRapidfire {
    function fleetExtraShots(
        FleetBattleGroup[] calldata targetPool,
        Ship firingShip,
        uint256 shots,
        uint256 targetTotal,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 firingUnit
    ) external pure returns (uint256);

    function defenderExtraShots(
        DefenderBattleGroup calldata targetPool,
        Ship firingShip,
        uint256 shots,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 firingUnit
    ) external pure returns (uint256);

    function deterministicLossCount(
        uint32 count,
        uint256 shots,
        uint256 attack,
        uint256 shield,
        uint256 hull,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 unit
    ) external pure returns (uint32);

    function distributedTargetShots(
        uint256 shots,
        uint32 targetCount,
        uint256 targetTotal,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 firingUnit,
        uint256 targetUnit
    ) external pure returns (uint256);

    function repairedDefenseCounts(uint256 destroyedDefenses, uint256 seed)
        external
        pure
        returns (uint256);
}

contract VeydriftCombatRapidfire is IVeydriftCombatRapidfire {
    uint16 private constant BPS = 10_000;
    uint8 private constant MAX_RAPIDFIRE_CHAIN = 64;
    bytes32 private constant COMBAT_STREAM_DOMAIN =
        keccak256("veydrift.classic-combat-random-stream.v1");
    uint256 private constant TARGET_LANE_STRIDE = 32;
    uint256 private constant TARGET_LANE_PLANET_SHIP = 0;
    uint256 private constant TARGET_LANE_DEFENSE = 64;
    uint256 private constant TARGET_LANE_COUNTERPLAY_SHIP = 128;
    uint256 private constant TARGET_LANE_ATTACKER_SHIP = 4_096;

    function fleetExtraShots(
        FleetBattleGroup[] calldata targetPool,
        Ship firingShip,
        uint256 shots,
        uint256 targetTotal,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 firingUnit
    ) external pure returns (uint256 extraShots) {
        uint256 incoming = shots;
        for (uint8 chain = 0; chain < MAX_RAPIDFIRE_CHAIN;) {
            uint256 generated;
            for (uint256 groupIndex = 0; groupIndex < targetPool.length;) {
                FleetBattleGroup calldata group = targetPool[groupIndex];
                for (uint8 shipId = 0; shipId <= uint8(Ship.Pathfinder);) {
                    uint32 count = _missionShipQuantity(group.ships, Ship(shipId));
                    generated += _shipRapidfireExtraShots(
                        count,
                        VeydriftCatalog.shipRapidfireAgainstShip(firingShip, Ship(shipId)),
                        incoming,
                        targetTotal,
                        seed,
                        round,
                        side,
                        firingUnit,
                        _targetLane(TARGET_LANE_ATTACKER_SHIP, group.laneGroup, shipId),
                        chain
                    );
                    unchecked {
                        ++shipId;
                    }
                }
                unchecked {
                    ++groupIndex;
                }
            }
            if (generated == 0) return extraShots;
            extraShots += generated;
            incoming = generated;
            unchecked {
                ++chain;
            }
        }
    }

    function defenderExtraShots(
        DefenderBattleGroup calldata targetPool,
        Ship firingShip,
        uint256 shots,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 firingUnit
    ) external pure returns (uint256 extraShots) {
        uint256 incoming = shots;
        for (uint8 chain = 0; chain < MAX_RAPIDFIRE_CHAIN;) {
            uint256 generated = _shipRapidfireExtraShots(
                targetPool.planetShips,
                TARGET_LANE_PLANET_SHIP,
                0,
                firingShip,
                incoming,
                targetPool.units,
                seed,
                round,
                side,
                firingUnit,
                chain
            );
            generated += _shipRapidfireExtraShots(
                targetPool.solarSatellites,
                VeydriftCatalog.shipRapidfireAgainstShip(firingShip, Ship.SolarSatellite),
                incoming,
                targetPool.units,
                seed,
                round,
                side,
                firingUnit,
                _targetLane(TARGET_LANE_PLANET_SHIP, 0, uint8(Ship.SolarSatellite)),
                chain
            );
            generated += _shipRapidfireExtraShots(
                targetPool.crawlers,
                VeydriftCatalog.shipRapidfireAgainstShip(firingShip, Ship.Crawler),
                incoming,
                targetPool.units,
                seed,
                round,
                side,
                firingUnit,
                _targetLane(TARGET_LANE_PLANET_SHIP, 0, uint8(Ship.Crawler)),
                chain
            );
            for (uint8 i = 0; i <= uint8(Defense.LargeShieldDome);) {
                generated += _shipRapidfireExtraShots(
                    targetPool.defenses[i],
                    VeydriftCatalog.shipRapidfireAgainstDefense(firingShip, Defense(i)),
                    incoming,
                    targetPool.units,
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
            for (uint256 groupIndex = 0; groupIndex < targetPool.counterplay.length;) {
                generated += _shipRapidfireExtraShots(
                    targetPool.counterplay[groupIndex].ships,
                    TARGET_LANE_COUNTERPLAY_SHIP,
                    targetPool.counterplay[groupIndex].laneGroup,
                    firingShip,
                    incoming,
                    targetPool.units,
                    seed,
                    round,
                    side,
                    firingUnit,
                    chain
                );
                unchecked {
                    ++groupIndex;
                }
            }
            if (generated == 0) return extraShots;
            extraShots += generated;
            incoming = generated;
            unchecked {
                ++chain;
            }
        }
    }

    function deterministicLossCount(
        uint32 count,
        uint256 shots,
        uint256 attack,
        uint256 shield,
        uint256 hull,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 unit
    ) external pure returns (uint32) {
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
        // targeted is capped by count, which is already uint32.
        // forge-lint: disable-next-line(unsafe-typecast)
        return sampled > targeted ? uint32(targeted) : uint32(sampled);
    }

    function distributedTargetShots(
        uint256 shots,
        uint32 targetCount,
        uint256 targetTotal,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 firingUnit,
        uint256 targetUnit
    ) external pure returns (uint256) {
        return _distributedTargetShots(
            shots, targetCount, targetTotal, seed, round, side, firingUnit, targetUnit
        );
    }

    function repairedDefenseCounts(uint256 destroyedDefenses, uint256 seed)
        external
        pure
        returns (uint256)
    {
        return VeydriftCatalog.repairedDefenseCounts(destroyedDefenses, seed);
    }

    function _shipRapidfireExtraShots(
        VeydriftGameStorage.MissionShips calldata ships,
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
        for (uint8 shipId = 0; shipId <= uint8(Ship.Pathfinder);) {
            uint32 count = _missionShipQuantity(ships, Ship(shipId));
            generated += _shipRapidfireExtraShots(
                count,
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

    function _shipRapidfireExtraShots(
        uint32 count,
        uint16 rapidfire,
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

    function _targetLane(uint256 base, uint256 group, uint8 unit) private pure returns (uint256) {
        return base + group * TARGET_LANE_STRIDE + unit;
    }

    function _missionShipQuantity(VeydriftGameStorage.MissionShips calldata ships, Ship ship)
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
}

/// @notice Delegatecall target for public-state fleet attack battle resolution.
contract VeydriftCombatModule is VeydriftResourceReserves {
    uint256 private constant MOON_CHANCE_DEBRIS_UNIT = 100_000;
    bytes32 private constant COMBAT_STREAM_DOMAIN =
        keccak256("veydrift.classic-combat-random-stream.v1");
    uint256 private constant TARGET_LANE_STRIDE = 32;
    uint256 private constant TARGET_LANE_PLANET_SHIP = 0;
    uint256 private constant TARGET_LANE_DEFENSE = 64;
    uint256 private constant TARGET_LANE_COUNTERPLAY_SHIP = 128;
    uint256 private constant TARGET_LANE_ATTACKER_SHIP = 4_096;

    struct BattleSettlement {
        BattleOutcome outcome;
        uint8 rounds;
        uint256 seed;
        Resources attackerLosses;
        Resources defenderLosses;
    }

    struct DefenderLosses {
        Resources resources;
        uint256 defenseDestroyed;
    }

    struct BattleRoundSnapshot {
        FleetBattleGroup[] attackers;
        DefenderBattleGroup defender;
        uint256 attackerUnits;
    }

    struct FleetRoundLosses {
        uint256 missionId;
        MissionShips ships;
        Resources resources;
    }

    struct DefenderRoundLosses {
        MissionShips planetShips;
        uint32 solarSatellites;
        uint32 crawlers;
        uint256 defenseDestroyed;
        FleetRoundLosses[] counterplay;
        Resources resources;
    }

    struct BattleRoundLosses {
        FleetRoundLosses[] attackers;
        DefenderRoundLosses defender;
    }

    address private immutable _rapidfireModule;

    constructor(address rapidfireModule) VeydriftResourceReserves(address(0)) {
        if (rapidfireModule == address(0)) revert UnsupportedGameplayModule();
        _rapidfireModule = rapidfireModule;
    }

    function resolveFleetMissionCombatRound(uint256 missionId) external returns (bool complete) {
        FleetMission storage mission = _fleetMissions[missionId];
        if (_battleResolutionProgress[missionId].rounds == 0) {
            if (
                mission.targetIsMoon
                    && !_missionMoonExistsForOwner(
                        missionId,
                        mission.targetPlanetId,
                        _planets[mission.targetPlanetId].owner,
                        false
                    )
            ) {
                _returnLinkedMissions(missionId, mission);
                mission.status = FleetMissionStatus.Returning;
                return true;
            }

            // Attack protection is rechecked once, before the first combat round, to close the
            // launch->impact gap. It must not be re-evaluated between gas-bounded rounds after
            // casualties have already changed both players' scores.
            (AttackBlockReason protectionReason,) = _attackProtectionPreview(
                mission.owner, mission.targetPlanetId, mission.targetIsMoon
            );
            Resources storage locked = _riftLockedResources[mission.targetPlanetId];
            bool hasLiveRift = !mission.targetIsMoon
                && (locked.metal != 0 || locked.crystal != 0 || locked.deuterium != 0);
            if (
                protectionReason == AttackBlockReason.SameAlliance
                    || (protectionReason == AttackBlockReason.ScoreProtection && !hasLiveRift)
            ) {
                _returnLinkedMissions(missionId, mission);
                mission.status = FleetMissionStatus.Returning;
                return true;
            }
        }

        (BattleSettlement memory settlement, bool battleComplete) = _runBattle(missionId, mission);
        if (!battleComplete) return false;

        if (settlement.outcome == BattleOutcome.AttackerWin) {
            _settleAttackGroupRaid(missionId);
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
            delete mission.cargo;
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
        complete = true;
    }

    function _runBattle(uint256 missionId, FleetMission storage mission)
        private
        returns (BattleSettlement memory settlement, bool complete)
    {
        BattleResolutionProgress storage progress = _battleResolutionProgress[missionId];
        if (progress.rounds == 0) progress.seed = _battleSeed(missionId, mission);
        settlement.seed = progress.seed;

        BattleRoundSnapshot memory snapshot = _battleRoundSnapshot(missionId, mission);
        uint256 finalAttacker = snapshot.attackerUnits;
        uint256 finalDefender = snapshot.defender.units;
        if (finalAttacker != 0 && finalDefender != 0 && progress.rounds < BATTLE_MAX_ROUNDS) {
            uint8 round = progress.rounds + 1;
            BattleRoundLosses memory roundLosses =
                _battleRoundLosses(snapshot, mission, settlement.seed, round);
            Resources memory attackerRoundLosses = _applyAttackerRoundLosses(roundLosses.attackers);
            DefenderLosses memory defenderRoundLosses =
                _applyDefenderRoundLosses(mission, roundLosses.defender);

            progress.attackerLosses = _add(progress.attackerLosses, attackerRoundLosses);
            progress.defenderLosses = _add(progress.defenderLosses, defenderRoundLosses.resources);
            progress.defenderDefenseDestroyed += defenderRoundLosses.defenseDestroyed;
            progress.rounds = round;

            BattleRoundSnapshot memory afterSnapshot = _battleRoundSnapshot(missionId, mission);
            finalAttacker = afterSnapshot.attackerUnits;
            finalDefender = afterSnapshot.defender.units;
            emit CombatRoundResolved(
                missionId,
                round,
                finalAttacker,
                finalDefender,
                attackerRoundLosses.metal,
                attackerRoundLosses.crystal,
                defenderRoundLosses.resources.metal,
                defenderRoundLosses.resources.crystal
            );
            if (finalAttacker != 0 && finalDefender != 0 && round < BATTLE_MAX_ROUNDS) {
                return (settlement, false);
            }
        }

        settlement.rounds = progress.rounds;
        settlement.attackerLosses = progress.attackerLosses;
        settlement.defenderLosses = progress.defenderLosses;
        _repairDestroyedDefenses(mission, progress.defenderDefenseDestroyed, settlement.seed);
        if (finalAttacker != 0 && finalDefender == 0) {
            settlement.outcome = BattleOutcome.AttackerWin;
        } else if (finalAttacker == 0 && finalDefender != 0) {
            settlement.outcome = BattleOutcome.DefenderWin;
        } else {
            settlement.outcome = BattleOutcome.Draw;
        }
        delete _battleResolutionProgress[missionId];
        complete = true;
    }

    function _battleRoundSnapshot(uint256 attackMissionId, FleetMission storage mission)
        private
        view
        returns (BattleRoundSnapshot memory snapshot)
    {
        uint256[] storage linkedMissionIds = _fleetCounterplayMissions[attackMissionId];
        snapshot.attackers = new FleetBattleGroup[](
            1 + _qualifiedJoinedAttackCount(attackMissionId, linkedMissionIds)
        );
        snapshot.attackers[0] = FleetBattleGroup({
            missionId: attackMissionId, owner: mission.owner, laneGroup: 0, ships: mission.ships
        });
        snapshot.attackerUnits = _missionShipTotal(mission.ships);

        uint256 attackerIndex = 1;
        for (uint256 i = 0; i < linkedMissionIds.length;) {
            uint256 joinedMissionId = linkedMissionIds[i];
            FleetMission storage joined = _fleetMissions[joinedMissionId];
            if (_isQualifiedJoinedAttack(attackMissionId, joined)) {
                snapshot.attackers[attackerIndex] = FleetBattleGroup({
                    missionId: joinedMissionId,
                    owner: joined.owner,
                    laneGroup: i + 1,
                    ships: joined.ships
                });
                snapshot.attackerUnits += _missionShipTotal(joined.ships);
                unchecked {
                    ++attackerIndex;
                }
            }
            unchecked {
                ++i;
            }
        }

        snapshot.defender.planetShips =
            _bodyShipSnapshot(mission.targetPlanetId, mission.targetIsMoon);
        if (!mission.targetIsMoon) {
            snapshot.defender.solarSatellites =
                _shipCounts[mission.targetPlanetId][Ship.SolarSatellite];
            snapshot.defender.crawlers = _shipCounts[mission.targetPlanetId][Ship.Crawler];
        }
        snapshot.defender.defenses = _defenseSnapshot(mission.targetPlanetId, mission.targetIsMoon);
        snapshot.defender.units = _missionShipTotal(snapshot.defender.planetShips)
            + snapshot.defender.solarSatellites + snapshot.defender.crawlers
            + _defenseSnapshotTotal(snapshot.defender.defenses);
        snapshot.defender.counterplay =
            new FleetBattleGroup[](_qualifiedCounterplayCount(attackMissionId, linkedMissionIds));

        uint256 counterplayIndex;
        for (uint256 i = 0; i < linkedMissionIds.length;) {
            uint256 counterplayMissionId = linkedMissionIds[i];
            FleetMission storage counterplay = _fleetMissions[counterplayMissionId];
            if (_isQualifiedCounterplay(attackMissionId, counterplay)) {
                snapshot.defender.counterplay[counterplayIndex] = FleetBattleGroup({
                    missionId: counterplayMissionId,
                    owner: counterplay.owner,
                    laneGroup: i,
                    ships: counterplay.ships
                });
                snapshot.defender.units += _missionShipTotal(counterplay.ships);
                unchecked {
                    ++counterplayIndex;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _battleRoundLosses(
        BattleRoundSnapshot memory snapshot,
        FleetMission storage mission,
        uint256 seed,
        uint8 round
    ) private view returns (BattleRoundLosses memory losses) {
        losses.attackers = new FleetRoundLosses[](snapshot.attackers.length);
        for (uint256 i = 0; i < snapshot.attackers.length;) {
            losses.attackers[i].missionId = snapshot.attackers[i].missionId;
            unchecked {
                ++i;
            }
        }
        losses.defender.counterplay = new FleetRoundLosses[](snapshot.defender.counterplay.length);
        for (uint256 i = 0; i < snapshot.defender.counterplay.length;) {
            losses.defender.counterplay[i].missionId = snapshot.defender.counterplay[i].missionId;
            unchecked {
                ++i;
            }
        }

        _snapshotDefendersFireAtAttackers(
            snapshot, mission.targetPlanetId, seed, round, losses.attackers
        );
        _snapshotAttackersFireAtDefenders(
            snapshot, mission.targetPlanetId, seed, round, losses.defender
        );
    }

    function _snapshotDefendersFireAtAttackers(
        BattleRoundSnapshot memory snapshot,
        uint256 planetId,
        uint256 seed,
        uint8 round,
        FleetRoundLosses[] memory attackerLosses
    ) private view {
        address defender = _planets[planetId].owner;
        uint16 weapons = _technologyLevels[defender][Technology.Weapons];
        for (uint256 targetIndex = 0; targetIndex < snapshot.attackers.length;) {
            FleetBattleGroup memory target = snapshot.attackers[targetIndex];
            for (uint8 i = 0; i <= MAX_SHIP_ID;) {
                Ship ship = Ship(i);
                uint32 count = _missionShipQuantity(snapshot.defender.planetShips, ship);
                if (count != 0) {
                    _addShipFireAtFleetLosses(
                        attackerLosses[targetIndex],
                        snapshot.attackers,
                        target,
                        snapshot.attackerUnits,
                        ship,
                        count,
                        weapons,
                        seed,
                        round,
                        1,
                        i
                    );
                }
                unchecked {
                    ++i;
                }
            }
            for (uint8 i = 0; i <= uint8(Defense.LargeShieldDome);) {
                Defense defense = Defense(i);
                uint32 count = snapshot.defender.defenses[i];
                if (count != 0) {
                    _addDefenseFireAtFleetLosses(
                        attackerLosses[targetIndex],
                        target,
                        snapshot.attackerUnits,
                        defense,
                        count,
                        weapons,
                        seed,
                        round,
                        2,
                        i
                    );
                }
                unchecked {
                    ++i;
                }
            }
            for (uint256 i = 0; i < snapshot.defender.counterplay.length;) {
                FleetBattleGroup memory firingGroup = snapshot.defender.counterplay[i];
                uint16 allyWeapons = _technologyLevels[firingGroup.owner][Technology.Weapons];
                for (uint8 shipId = 0; shipId <= uint8(Ship.Pathfinder);) {
                    Ship ship = Ship(shipId);
                    uint32 count = _missionShipQuantity(firingGroup.ships, ship);
                    if (count != 0) {
                        _addShipFireAtFleetLosses(
                            attackerLosses[targetIndex],
                            snapshot.attackers,
                            target,
                            snapshot.attackerUnits,
                            ship,
                            count,
                            allyWeapons,
                            seed,
                            round,
                            3,
                            shipId
                        );
                    }
                    unchecked {
                        ++shipId;
                    }
                }
                unchecked {
                    ++i;
                }
            }
            unchecked {
                ++targetIndex;
            }
        }
    }

    function _snapshotAttackersFireAtDefenders(
        BattleRoundSnapshot memory snapshot,
        uint256 targetPlanetId,
        uint256 seed,
        uint8 round,
        DefenderRoundLosses memory defenderLosses
    ) private view {
        for (uint256 attackerIndex = 0; attackerIndex < snapshot.attackers.length;) {
            FleetBattleGroup memory attacker = snapshot.attackers[attackerIndex];
            uint16 weapons = _technologyLevels[attacker.owner][Technology.Weapons];
            for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
                Ship ship = Ship(i);
                uint32 count = _missionShipQuantity(attacker.ships, ship);
                if (count != 0) {
                    _addShipFireAtDefenderLosses(
                        defenderLosses,
                        snapshot.defender,
                        targetPlanetId,
                        ship,
                        count,
                        weapons,
                        seed,
                        round,
                        4,
                        i
                    );
                }
                unchecked {
                    ++i;
                }
            }
            unchecked {
                ++attackerIndex;
            }
        }
    }

    function _addShipFireAtFleetLosses(
        FleetRoundLosses memory losses,
        FleetBattleGroup[] memory targetPool,
        FleetBattleGroup memory target,
        uint256 targetTotal,
        Ship firingShip,
        uint32 firingCount,
        uint16 firingWeapons,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private view {
        if (targetTotal == 0) return;

        uint256 attack = _combatScaled(VeydriftCatalog.shipBattleAttack(firingShip), firingWeapons);
        uint256 extraShots = IVeydriftCombatRapidfire(_rapidfireModule)
            .fleetExtraShots(
                targetPool, firingShip, firingCount, targetTotal, seed, round, side, unit
            );
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship targetShip = Ship(i);
            uint32 targetCount = _missionShipQuantity(target.ships, targetShip);
            if (targetCount != 0) {
                uint256 targetLane = _targetLane(TARGET_LANE_ATTACKER_SHIP, target.laneGroup, i);
                uint256 shots = _distributedTargetShots(
                    firingCount, targetCount, targetTotal, seed, round, side, unit, targetLane
                )
                + _distributedTargetShots(
                    extraShots, targetCount, targetTotal, seed, round, side, unit, targetLane
                );
                uint32 lost = _deterministicShipLossCount(
                    targetShip,
                    targetCount,
                    shots,
                    attack,
                    target.owner,
                    seed,
                    round,
                    side,
                    targetLane
                );
                _addFleetShipLoss(losses, target.ships, targetShip, lost);
            }
            unchecked {
                ++i;
            }
        }
    }

    function _addDefenseFireAtFleetLosses(
        FleetRoundLosses memory losses,
        FleetBattleGroup memory target,
        uint256 targetTotal,
        Defense firingDefense,
        uint32 firingCount,
        uint16 firingWeapons,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private view {
        if (targetTotal == 0) return;

        uint256 attack =
            _combatScaled(VeydriftCatalog.defenseBattleAttack(firingDefense), firingWeapons);
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship targetShip = Ship(i);
            uint32 targetCount = _missionShipQuantity(target.ships, targetShip);
            if (targetCount != 0) {
                uint256 targetLane = _targetLane(TARGET_LANE_ATTACKER_SHIP, target.laneGroup, i);
                uint256 shots = _distributedTargetShots(
                    firingCount, targetCount, targetTotal, seed, round, side, unit, targetLane
                );
                uint32 lost = _deterministicShipLossCount(
                    targetShip,
                    targetCount,
                    shots,
                    attack,
                    target.owner,
                    seed,
                    round,
                    side,
                    targetLane
                );
                _addFleetShipLoss(losses, target.ships, targetShip, lost);
            }
            unchecked {
                ++i;
            }
        }
    }

    function _addShipFireAtDefenderLosses(
        DefenderRoundLosses memory losses,
        DefenderBattleGroup memory target,
        uint256 targetPlanetId,
        Ship firingShip,
        uint32 firingCount,
        uint16 firingWeapons,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private view {
        if (target.units == 0) return;

        uint256 attack = _combatScaled(VeydriftCatalog.shipBattleAttack(firingShip), firingWeapons);
        uint256 extraShots = IVeydriftCombatRapidfire(_rapidfireModule)
            .defenderExtraShots(target, firingShip, firingCount, seed, round, side, unit);
        for (uint8 i = 0; i <= MAX_SHIP_ID;) {
            Ship ship = Ship(i);
            uint32 count = _missionShipQuantity(target.planetShips, ship);
            if (count != 0) {
                uint256 targetLane = _targetLane(TARGET_LANE_PLANET_SHIP, 0, i);
                uint256 shots = _distributedTargetShots(
                    firingCount, count, target.units, seed, round, side, unit, targetLane
                )
                + _distributedTargetShots(
                    extraShots, count, target.units, seed, round, side, unit, targetLane
                );
                uint32 lost = _deterministicBodyShipLossCount(
                    targetPlanetId, ship, count, shots, attack, seed, round, side, targetLane
                );
                _addDefenderPlanetShipLoss(losses, target.planetShips, ship, lost);
            }
            unchecked {
                ++i;
            }
        }
        _addShipFireAtStationarySupportLosses(
            losses,
            target,
            targetPlanetId,
            firingCount,
            attack,
            extraShots,
            Ship.SolarSatellite,
            target.solarSatellites,
            seed,
            round,
            side,
            unit
        );
        _addShipFireAtStationarySupportLosses(
            losses,
            target,
            targetPlanetId,
            firingCount,
            attack,
            extraShots,
            Ship.Crawler,
            target.crawlers,
            seed,
            round,
            side,
            unit
        );
        for (uint8 i = 0; i <= uint8(Defense.LargeShieldDome);) {
            Defense defense = Defense(i);
            uint32 count = target.defenses[i];
            if (count != 0) {
                uint256 targetLane = _targetLane(TARGET_LANE_DEFENSE, 0, i);
                uint256 shots = _distributedTargetShots(
                    firingCount, count, target.units, seed, round, side, unit, targetLane
                )
                + _distributedTargetShots(
                    extraShots, count, target.units, seed, round, side, unit, targetLane
                );
                uint32 lost = _deterministicDefenseLossCount(
                    targetPlanetId, defense, count, shots, attack, seed, round, side, targetLane
                );
                _addDefenderDefenseLoss(losses, target.defenses, i, lost);
            }
            unchecked {
                ++i;
            }
        }
        for (uint256 i = 0; i < target.counterplay.length;) {
            FleetBattleGroup memory counterplay = target.counterplay[i];
            for (uint8 shipId = 0; shipId <= uint8(Ship.Pathfinder);) {
                Ship targetShip = Ship(shipId);
                uint32 count = _missionShipQuantity(counterplay.ships, targetShip);
                if (count != 0) {
                    uint256 targetLane =
                        _targetLane(TARGET_LANE_COUNTERPLAY_SHIP, counterplay.laneGroup, shipId);
                    uint256 shots = _distributedTargetShots(
                        firingCount, count, target.units, seed, round, side, unit, targetLane
                    )
                    + _distributedTargetShots(
                        extraShots, count, target.units, seed, round, side, unit, targetLane
                    );
                    uint32 lost = _deterministicShipLossCount(
                        targetShip,
                        count,
                        shots,
                        attack,
                        counterplay.owner,
                        seed,
                        round,
                        side,
                        targetLane
                    );
                    _addFleetShipLoss(losses.counterplay[i], counterplay.ships, targetShip, lost);
                }
                unchecked {
                    ++shipId;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function _addShipFireAtStationarySupportLosses(
        DefenderRoundLosses memory losses,
        DefenderBattleGroup memory target,
        uint256 targetPlanetId,
        uint32 firingCount,
        uint256 attack,
        uint256 extraShots,
        Ship supportShip,
        uint32 supportCount,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private view {
        if (supportCount == 0) return;
        uint256 targetLane = _targetLane(TARGET_LANE_PLANET_SHIP, 0, uint8(supportShip));
        uint256 shots = _distributedTargetShots(
            firingCount, supportCount, target.units, seed, round, side, unit, targetLane
        )
        + _distributedTargetShots(
            extraShots, supportCount, target.units, seed, round, side, unit, targetLane
        );
        uint32 lost = _deterministicBodyShipLossCount(
            targetPlanetId, supportShip, supportCount, shots, attack, seed, round, side, targetLane
        );
        _addDefenderStationarySupportLoss(losses, supportShip, supportCount, lost);
    }

    function _addFleetShipLoss(
        FleetRoundLosses memory losses,
        MissionShips memory snapshot,
        Ship ship,
        uint32 lost
    ) private pure {
        if (lost == 0) return;
        uint32 available = _missionShipQuantity(snapshot, ship);
        uint32 alreadyLost = _missionShipQuantity(losses.ships, ship);
        if (alreadyLost >= available) return;
        uint32 remaining = available - alreadyLost;
        if (lost > remaining) lost = remaining;
        _setMissionShipQuantityMemory(losses.ships, ship, alreadyLost + lost);
        losses.resources = _add(losses.resources, _multiply(_shipCost(ship), lost));
    }

    function _addDefenderPlanetShipLoss(
        DefenderRoundLosses memory losses,
        MissionShips memory snapshot,
        Ship ship,
        uint32 lost
    ) private pure {
        if (lost == 0) return;
        uint32 available = _missionShipQuantity(snapshot, ship);
        uint32 alreadyLost = _missionShipQuantity(losses.planetShips, ship);
        if (alreadyLost >= available) return;
        uint32 remaining = available - alreadyLost;
        if (lost > remaining) lost = remaining;
        _setMissionShipQuantityMemory(losses.planetShips, ship, alreadyLost + lost);
        losses.resources = _add(losses.resources, _multiply(_shipCost(ship), lost));
    }

    function _addDefenderStationarySupportLoss(
        DefenderRoundLosses memory losses,
        Ship ship,
        uint32 available,
        uint32 lost
    ) private pure {
        if (lost == 0) return;
        uint32 alreadyLost = ship == Ship.SolarSatellite ? losses.solarSatellites : losses.crawlers;
        if (alreadyLost >= available) return;
        uint32 remaining = available - alreadyLost;
        if (lost > remaining) lost = remaining;
        if (ship == Ship.SolarSatellite) losses.solarSatellites = alreadyLost + lost;
        else losses.crawlers = alreadyLost + lost;
        losses.resources = _add(losses.resources, _multiply(_shipCost(ship), lost));
    }

    function _addDefenderDefenseLoss(
        DefenderRoundLosses memory losses,
        uint32[8] memory snapshot,
        uint8 defenseId,
        uint32 lost
    ) private pure {
        if (lost == 0) return;
        uint256 shift = uint256(defenseId) * 32;
        uint32 available = snapshot[defenseId];
        // defenseDestroyed stores eight uint32 lanes, one for each battlefield defense.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint32 alreadyLost = uint32(losses.defenseDestroyed >> shift);
        if (alreadyLost >= available) return;
        uint32 remaining = available - alreadyLost;
        if (lost > remaining) lost = remaining;
        losses.defenseDestroyed += uint256(lost) << shift;
    }

    function _applyAttackerRoundLosses(FleetRoundLosses[] memory losses)
        private
        returns (Resources memory resources)
    {
        for (uint256 i = 0; i < losses.length;) {
            FleetMission storage mission = _fleetMissions[losses[i].missionId];
            _applyMissionShipLosses(mission.ships, losses[i].ships);
            resources = _add(resources, losses[i].resources);
            unchecked {
                ++i;
            }
        }
    }

    function _applyDefenderRoundLosses(
        FleetMission storage mission,
        DefenderRoundLosses memory losses
    ) private returns (DefenderLosses memory applied) {
        _applyBodyShipLosses(mission.targetPlanetId, mission.targetIsMoon, losses.planetShips);
        if (!mission.targetIsMoon) _applyStationarySupportLosses(mission.targetPlanetId, losses);
        _applyDefenseChanges(
            mission.targetPlanetId, mission.targetIsMoon, losses.defenseDestroyed, false
        );
        applied.resources = losses.resources;
        for (uint256 i = 0; i < losses.counterplay.length;) {
            FleetMission storage counterplay = _fleetMissions[losses.counterplay[i].missionId];
            _applyMissionShipLosses(counterplay.ships, losses.counterplay[i].ships);
            applied.resources = _add(applied.resources, losses.counterplay[i].resources);
            unchecked {
                ++i;
            }
        }
        applied.defenseDestroyed = losses.defenseDestroyed;
    }

    function _applyMissionShipLosses(MissionShips storage ships, MissionShips memory losses)
        private
    {
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 lost = _missionShipQuantity(losses, ship);
            if (lost != 0) {
                uint32 count = _missionShipQuantity(ships, ship);
                _setMissionShipQuantity(ships, ship, count > lost ? count - lost : 0);
            }
            unchecked {
                ++i;
            }
        }
    }

    function _applyBodyShipLosses(uint256 planetId, bool isMoon, MissionShips memory losses)
        private
    {
        for (uint8 i = 0; i <= MAX_SHIP_ID;) {
            Ship ship = Ship(i);
            uint32 lost = _missionShipQuantity(losses, ship);
            if (lost != 0) {
                uint32 count =
                    isMoon ? _moonShipCounts[planetId][ship] : _shipCounts[planetId][ship];
                uint32 remaining = count > lost ? count - lost : 0;
                if (isMoon) _setMoonShipCount(planetId, ship, remaining);
                else _setPlanetShipCount(planetId, ship, remaining);
            }
            unchecked {
                ++i;
            }
        }
    }

    function _applyStationarySupportLosses(uint256 planetId, DefenderRoundLosses memory losses)
        private
    {
        if (losses.solarSatellites != 0) {
            uint32 count = _shipCounts[planetId][Ship.SolarSatellite];
            _setPlanetShipCount(
                planetId,
                Ship.SolarSatellite,
                count > losses.solarSatellites ? count - losses.solarSatellites : 0
            );
        }
        if (losses.crawlers != 0) {
            uint32 count = _shipCounts[planetId][Ship.Crawler];
            _setPlanetShipCount(
                planetId, Ship.Crawler, count > losses.crawlers ? count - losses.crawlers : 0
            );
        }
    }

    function _applyDefenseChanges(uint256 planetId, bool isMoon, uint256 changes, bool repair)
        private
    {
        if (isMoon) {
            IVeydriftCombatMoonSystem(_moonSystem)
                .applyMoonCombatDefenseChanges(planetId, changes, repair);
            return;
        }
        for (uint8 i = 0; i <= uint8(Defense.LargeShieldDome);) {
            // changes stores eight uint32 lanes, one for each battlefield defense.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint32 changed = uint32(changes >> (uint256(i) * 32));
            if (changed != 0) {
                Defense defense = Defense(i);
                uint32 current = _defenseCounts[planetId][defense];
                uint32 total =
                    repair ? current + changed : current > changed ? current - changed : 0;
                _setPlanetDefenseCount(planetId, defense, total);
            }
            unchecked {
                ++i;
            }
        }
    }

    function _qualifiedJoinedAttackCount(
        uint256 attackMissionId,
        uint256[] storage linkedMissionIds
    ) private view returns (uint256 count) {
        for (uint256 i = 0; i < linkedMissionIds.length;) {
            if (_isQualifiedJoinedAttack(attackMissionId, _fleetMissions[linkedMissionIds[i]])) {
                count += 1;
            }
            unchecked {
                ++i;
            }
        }
    }

    function _qualifiedCounterplayCount(
        uint256 hostileMissionId,
        uint256[] storage linkedMissionIds
    ) private view returns (uint256 count) {
        for (uint256 i = 0; i < linkedMissionIds.length;) {
            if (_isQualifiedCounterplay(hostileMissionId, _fleetMissions[linkedMissionIds[i]])) {
                count += 1;
            }
            unchecked {
                ++i;
            }
        }
    }

    function _bodyShipSnapshot(uint256 planetId, bool isMoon)
        private
        view
        returns (MissionShips memory ships)
    {
        for (uint8 i = 0; i <= MAX_SHIP_ID;) {
            Ship ship = Ship(i);
            _setMissionShipQuantityMemory(
                ships, ship, isMoon ? _moonShipCounts[planetId][ship] : _shipCounts[planetId][ship]
            );
            unchecked {
                ++i;
            }
        }
    }

    function _defenseSnapshot(uint256 planetId, bool isMoon)
        private
        view
        returns (uint32[8] memory defenses)
    {
        address moonSystem = _moonSystem;
        if (isMoon) {
            uint256 packed = IVeydriftCombatMoonSystem(moonSystem).moonDefensePacked(planetId);
            for (uint8 i = 0; i <= uint8(Defense.LargeShieldDome);) {
                // packed stores eight uint32 lanes, one for each battlefield defense.
                // forge-lint: disable-next-line(unsafe-typecast)
                defenses[i] = uint32(packed >> (uint256(i) * 32));
                unchecked {
                    ++i;
                }
            }
            return defenses;
        }
        for (uint8 i = 0; i <= uint8(Defense.LargeShieldDome);) {
            Defense defense = Defense(i);
            defenses[i] = _defenseCounts[planetId][defense];
            unchecked {
                ++i;
            }
        }
    }

    function _defenseSnapshotTotal(uint32[8] memory defenses) private pure returns (uint256 total) {
        for (uint8 i = 0; i <= uint8(Defense.LargeShieldDome);) {
            total += defenses[i];
            unchecked {
                ++i;
            }
        }
    }

    function _repairDestroyedDefenses(
        FleetMission storage mission,
        uint256 destroyedDefenses,
        uint256 seed
    ) private {
        uint256 repairedDefenses = IVeydriftCombatRapidfire(_rapidfireModule)
            .repairedDefenseCounts(destroyedDefenses, seed);
        _applyDefenseChanges(mission.targetPlanetId, mission.targetIsMoon, repairedDefenses, true);
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
    ) private view returns (uint256) {
        return IVeydriftCombatRapidfire(_rapidfireModule)
            .distributedTargetShots(
                shots, targetCount, targetTotal, seed, round, side, firingUnit, targetUnit
            );
    }

    function _deterministicBodyShipLossCount(
        uint256 planetId,
        Ship ship,
        uint32 count,
        uint256 shots,
        uint256 attack,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 unit
    ) private view returns (uint32) {
        address owner = _planets[planetId].owner;
        return
            _deterministicShipLossCount(ship, count, shots, attack, owner, seed, round, side, unit);
    }

    function _deterministicShipLossCount(
        Ship ship,
        uint32 count,
        uint256 shots,
        uint256 attack,
        address owner,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 unit
    ) private view returns (uint32) {
        uint16 shielding = _technologyLevels[owner][Technology.Shielding];
        uint16 armor = _technologyLevels[owner][Technology.Armor];
        return _deterministicLossCount(
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

    function _deterministicDefenseLossCount(
        uint256 planetId,
        Defense defense,
        uint32 count,
        uint256 shots,
        uint256 attack,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 unit
    ) private view returns (uint32) {
        address owner = _planets[planetId].owner;
        uint16 shielding = _technologyLevels[owner][Technology.Shielding];
        uint16 armor = _technologyLevels[owner][Technology.Armor];
        return _deterministicLossCount(
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

    function _deterministicLossCount(
        uint32 count,
        uint256 shots,
        uint256 attack,
        uint256 shield,
        uint256 hull,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint256 unit
    ) private view returns (uint32) {
        return IVeydriftCombatRapidfire(_rapidfireModule)
            .deterministicLossCount(count, shots, attack, shield, hull, seed, round, side, unit);
    }

    function _targetLane(uint256 base, uint256 group, uint8 unit) private pure returns (uint256) {
        return base + group * TARGET_LANE_STRIDE + unit;
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
                    delete joined.cargo;
                } else {
                    joined.status = FleetMissionStatus.Returning;
                    joined.returnAt = uint64(
                        block.timestamp + (uint256(joined.returnAt) - uint256(attack.arrivalAt))
                    );
                    _emitFleetMissionReturnExposed(
                        joinedMissionId, joined, FleetMissionStatus.Returning
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
            // DefenseHold fleets keep holding after a battle to defend any further attack in their
            // window; they are sent home by their owner once the hold elapses, not here.
            if (
                counterplay.missionType != FleetMissionType.DefenseHold
                    && _isQualifiedCounterplay(hostileMissionId, counterplay)
            ) {
                if (_missionShipTotal(counterplay.ships) == 0) {
                    counterplay.status = FleetMissionStatus.Resolved;
                    counterplay.returnAt = uint64(block.timestamp);
                    activeFleetMissionCount[counterplay.owner] -= 1;
                    _decreaseInternalResources(counterplay.cargo);
                    delete counterplay.cargo;
                } else {
                    counterplay.status = FleetMissionStatus.Returning;
                    counterplay.returnAt = uint64(
                        block.timestamp
                            + (uint256(counterplay.returnAt) - uint256(hostile.arrivalAt))
                    );
                    _emitFleetMissionReturnExposed(
                        counterplayMissionId, counterplay, FleetMissionStatus.Returning
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
        // DefenseHold fleets stationed over this attack are linked into the counterplay roster at
        // resolution time, so they qualify here and fight exactly like reactive counterplay.
        return counterplay.status == FleetMissionStatus.Outbound
            && counterplay.arrivalAt <= _fleetMissions[hostileMissionId].arrivalAt
            && (counterplay.missionType == FleetMissionType.AcsDefend
                || counterplay.missionType == FleetMissionType.Intercept
                || counterplay.missionType == FleetMissionType.DefenseHold);
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

    function _emitDebrisFieldUpdated(uint256 planetId) private {
        DebrisField storage field = _debrisFields[planetId];
        emit DebrisFieldUpdated(planetId, field.metal, field.crystal);
    }

    function _emitFleetMissionReturnExposed(
        uint256 missionId,
        FleetMission storage mission,
        FleetMissionStatus status
    ) private {
        emit FleetMissionReturnExposed(
            missionId,
            mission.owner,
            status,
            mission.originPlanetId,
            mission.targetPlanetId,
            mission.returnAt,
            mission.cargo.metal,
            mission.cargo.crystal,
            mission.cargo.deuterium
        );
    }

    function _requestMoonChanceFromBattle(
        uint256 missionId,
        uint256 targetPlanetId,
        Resources memory debris
    ) private {
        if (_moonSystem == address(0)) return;
        if (uint256(debris.metal) + debris.crystal < MOON_CHANCE_DEBRIS_UNIT) return;

        try IVeydriftCombatMoonSystem(_moonSystem)
            .requestMoonChanceFromBattle(
                missionId, targetPlanetId, debris.metal, debris.crystal
            ) returns (
            uint256, uint256
        ) {}
            catch {}
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

    function _setMissionShipQuantityMemory(MissionShips memory ships, Ship ship, uint32 quantity)
        private
        pure
    {
        uint256 offset = _missionShipMemoryOffset(ship);
        if (offset == type(uint256).max) return;
        assembly ("memory-safe") {
            mstore(add(ships, offset), quantity)
        }
    }

    function _settleAttackGroupRaid(uint256 missionId) private {
        (bool ok, bytes memory data) =
            address(this).call(abi.encodeWithSelector(0x41dfa622, missionId));
        if (!ok) assembly ("memory-safe") { revert(add(data, 32), mload(data)) }
    }

    function _battleSeed(uint256 missionId, FleetMission storage mission)
        private
        view
        returns (uint256)
    {
        uint256 randomWord = _consumeAttackBattleRandomness(
            mission.randomnessRequestId, _attackBattlePurposeHash(missionId)
        );
        return uint256(
            keccak256(
                abi.encode(
                    ATTACK_BATTLE_DOMAIN,
                    block.chainid,
                    missionId,
                    mission.randomnessRequestId,
                    mission.owner,
                    mission.targetPlanetId,
                    mission.arrivalAt,
                    randomWord
                )
            )
        );
    }

    function _consumeAttackBattleRandomness(uint256 requestId, bytes32 purposeHash)
        private
        view
        returns (uint256 randomWord)
    {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, 0x38d367a300000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), requestId)
            mstore(add(ptr, 0x24), purposeHash)
            if iszero(staticcall(gas(), sload(_randomnessEngine.slot), ptr, 0x44, ptr, 0x20)) {
                returndatacopy(ptr, 0, returndatasize())
                revert(ptr, returndatasize())
            }
            randomWord := mload(ptr)
        }
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

    function _attackProtectionPreview(address attacker, uint256 targetPlanetId, bool targetIsMoon)
        private
        view
        returns (AttackBlockReason reason, uint16 plunderBps)
    {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, shl(224, 0xdca08aaf))
            mstore(add(ptr, 4), attacker)
            mstore(add(ptr, 36), targetPlanetId)
            mstore(add(ptr, 68), targetIsMoon)
            switch staticcall(gas(), address(), ptr, 100, ptr, 96)
            case 0 {
                plunderBps := 5000
            }
            default {
                reason := mload(ptr)
                plunderBps := mload(add(ptr, 64))
            }
        }
    }

    function _combatScaled(uint256 value, uint16 technologyLevel) private pure returns (uint256) {
        return (value * (BPS + uint256(technologyLevel) * 1_000)) / BPS;
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
        returns (uint32 quantity)
    {
        uint256 offset = _missionShipMemoryOffset(ship);
        if (offset == type(uint256).max) return 0;
        assembly ("memory-safe") {
            quantity := mload(add(ships, offset))
        }
    }

    function _missionShipMemoryOffset(Ship ship) private pure returns (uint256) {
        uint8 id = uint8(ship);
        if (id == uint8(Ship.SolarSatellite) || id > uint8(Ship.Pathfinder)) {
            return type(uint256).max;
        }
        if (id > uint8(Ship.SolarSatellite)) id -= 1;
        return uint256(id) << 5;
    }

    function _shipCost(Ship ship) private pure returns (Resources memory) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(ship);
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
