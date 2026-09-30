// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftStagedCombatModule} from "./VeydriftStagedCombatModule.sol";
import {
    VeydriftLegacyCombatModule,
    VeydriftLegacyCombatRapidfire
} from "./VeydriftLegacyCombatModule.sol";
import {VeydriftStagedBattleStorage as Store} from "./libraries/VeydriftStagedBattleStorage.sol";
import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftGameStorage} from "./VeydriftGameStorage.sol";
import {CombatCohort, VeydriftCombatCohorts} from "./libraries/VeydriftCombatCohorts.sol";
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
    function cohortRoundLosses(
        CombatCohort[] calldata attackers,
        CombatCohort[] calldata defenders,
        uint256 seed,
        uint8 round
    )
        external
        pure
        returns (
            CombatCohort[] memory attackPool,
            CombatCohort[] memory defensePool,
            uint256[] memory attackerLosses,
            uint256[] memory defenderLosses
        );

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
    function cohortRoundLosses(
        CombatCohort[] calldata attackers,
        CombatCohort[] calldata defenders,
        uint256 seed,
        uint8 round
    )
        external
        pure
        returns (
            CombatCohort[] memory attackPool,
            CombatCohort[] memory defensePool,
            uint256[] memory attackerLosses,
            uint256[] memory defenderLosses
        )
    {
        attackPool = VeydriftCombatCohorts.canonicalize(attackers);
        defensePool = VeydriftCombatCohorts.canonicalize(defenders);
        attackerLosses = VeydriftCombatCohorts.losses(defensePool, attackPool, seed, round, 1);
        defenderLosses = VeydriftCombatCohorts.losses(attackPool, defensePool, seed, round, 4);
    }

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

/// @notice Version router: unstarted battles use persistent cohorts; saved legacy rounds
/// continue under the deployed pre-cohort algorithm instead of changing semantics mid-battle.
contract VeydriftCombatModule is VeydriftResourceReserves {
    address private immutable _stagedModule;
    address private immutable _legacyModule;

    constructor(address rapidfireModule, address stagedModule, address legacyModule)
        VeydriftResourceReserves(address(0))
    {
        if (
            rapidfireModule == address(0) || stagedModule == address(0)
                || legacyModule == address(0)
        ) {
            revert UnsupportedGameplayModule();
        }
        _stagedModule = stagedModule;
        _legacyModule = legacyModule;
    }

    function resolveFleetMissionCombatRound(uint256 missionId) external returns (bool) {
        address module = Store.battle(missionId).phase == 0
            && _battleResolutionProgress[missionId].rounds != 0
            ? _legacyModule
            : _stagedModule;
        (bool ok, bytes memory data) = module.delegatecall(msg.data);
        if (!ok) assembly ("memory-safe") { revert(add(data, 32), mload(data)) }
        return abi.decode(data, (bool));
    }
}
