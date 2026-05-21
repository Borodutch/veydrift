// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {Building, Defense, Ship, Technology} from "./libraries/VeydriftTypes.sol";

interface IVeydriftCombatSpaceDock {
    function recordCombatWreckage(uint256 planetId, Ship ship, uint32 destroyed) external;
}

/// @notice Delegatecall target for public-state fleet attack battle resolution.
contract VeydriftCombatModule is VeydriftResourceReserves {
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

    function resolveFleetMission(uint256 missionId) external {
        FleetMission storage mission = _fleetMissions[missionId];
        BattleSettlement memory settlement = _runBattle(missionId, mission);
        uint256 capacity = _missionCargoCapacity(mission.ships);

        if (settlement.outcome == BattleOutcome.AttackerWin && capacity != 0) {
            Resources memory loot = _raidResources(mission.targetPlanetId, capacity, mission.cargo);
            mission.cargo = _add(mission.cargo, loot);
        }

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
    }

    function _runBattle(uint256 missionId, FleetMission storage mission)
        private
        returns (BattleSettlement memory settlement)
    {
        settlement.seed = _battleSeed(missionId, mission);
        for (uint8 round = 1; round <= BATTLE_MAX_ROUNDS;) {
            BattleStats memory attacker = _attackerBattleStats(mission.ships, mission.owner);
            BattleStats memory defender = _defenderBattleStats(mission.targetPlanetId);

            if (attacker.units == 0 || defender.units == 0) break;

            settlement.attackerLosses = _add(
                settlement.attackerLosses,
                _applyAttackerLosses(
                    mission.ships, defender.attack, attacker.durability, settlement.seed, round
                )
            );
            settlement.defenderLosses = _add(
                settlement.defenderLosses,
                _applyDefenderLosses(
                    mission.targetPlanetId,
                    attacker.attack,
                    defender.durability,
                    settlement.seed,
                    round
                )
            );
            settlement.rounds = round;

            unchecked {
                ++round;
            }
        }

        BattleStats memory finalAttacker = _attackerBattleStats(mission.ships, mission.owner);
        BattleStats memory finalDefender = _defenderBattleStats(mission.targetPlanetId);
        if (finalAttacker.units != 0 && finalDefender.units == 0) {
            settlement.outcome = BattleOutcome.AttackerWin;
        } else if (finalAttacker.units == 0 && finalDefender.units != 0) {
            settlement.outcome = BattleOutcome.DefenderWin;
        } else {
            settlement.outcome = BattleOutcome.Draw;
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

    function _defenderBattleStats(uint256 planetId)
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
        stats.attack += _combatScaled(_shipAttack(ship), weapons) * count;
        stats.durability += _combatScaled(_shipHull(ship), armor + shielding) * count;
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
        stats.attack += _combatScaled(_defenseAttack(defense), weapons) * count;
        stats.durability += _combatScaled(_defenseHull(defense), armor + shielding) * count;
    }

    function _applyAttackerLosses(
        MissionShips storage ships,
        uint256 incomingDamage,
        uint256 durability,
        uint256 seed,
        uint8 round
    ) private returns (Resources memory losses) {
        uint256 lossBps = _lossBps(incomingDamage, durability);
        if (lossBps == 0) return losses;

        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 count = _missionShipQuantity(ships, ship);
            uint32 lost = _lossCount(count, lossBps, seed, round, 1, i);
            if (lost != 0) {
                _setMissionShipQuantity(ships, ship, count - lost);
                losses = _add(losses, _multiply(_shipCost(ship), lost));
            }
            unchecked {
                ++i;
            }
        }
    }

    function _applyDefenderLosses(
        uint256 planetId,
        uint256 incomingDamage,
        uint256 durability,
        uint256 seed,
        uint8 round
    ) private returns (Resources memory losses) {
        uint256 lossBps = _lossBps(incomingDamage, durability);
        if (lossBps == 0) return losses;

        for (uint8 i = 0; i <= MAX_SHIP_ID;) {
            Ship ship = Ship(i);
            uint32 count = _shipCounts[planetId][ship];
            uint32 lost = _lossCount(count, lossBps, seed, round, 2, i);
            if (lost != 0) {
                _shipCounts[planetId][ship] = count - lost;
                losses = _add(losses, _multiply(_shipCost(ship), lost));
                _recordCombatWreckage(planetId, ship, lost);
            }
            unchecked {
                ++i;
            }
        }
        for (uint8 i = 0; i <= MAX_DEFENSE_ID;) {
            Defense defense = Defense(i);
            uint32 count = _defenseCounts[planetId][defense];
            if (i <= uint8(Defense.LargeShieldDome)) {
                uint32 lost = _lossCount(count, lossBps, seed, round, 3, i);
                if (lost != 0) {
                    _defenseCounts[planetId][defense] = count - lost;
                    losses = _add(losses, _multiply(_defenseCost(defense), lost));
                }
            }
            unchecked {
                ++i;
            }
        }
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

    function _raidResources(uint256 targetPlanetId, uint256 capacity, Resources memory cargo)
        private
        returns (Resources memory raided)
    {
        uint256 cargoUsed = uint256(cargo.metal) + cargo.crystal + cargo.deuterium;
        if (cargoUsed >= capacity) return raided;
        capacity -= cargoUsed;

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

    function _lossBps(uint256 incomingDamage, uint256 durability) private pure returns (uint256) {
        if (incomingDamage == 0 || durability == 0) return 0;
        uint256 scaled = (incomingDamage * BPS) / durability;
        return scaled > BPS ? BPS : scaled;
    }

    function _lossCount(
        uint32 count,
        uint256 lossBps,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 unit
    ) private pure returns (uint32) {
        if (count == 0 || lossBps == 0) return 0;
        if (lossBps >= BPS) return count;

        uint256 scaled = uint256(count) * lossBps;
        // The quotient is bounded by count because lossBps is below BPS.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint32 lost = uint32(scaled / BPS);
        if (uint256(keccak256(abi.encode(seed, round, side, unit))) % BPS < scaled % BPS) {
            lost += 1;
        }
        return lost > count ? count : lost;
    }

    function _combatScaled(uint256 value, uint16 technologyLevel) private pure returns (uint256) {
        return (value * (BPS + uint256(technologyLevel) * 1_000)) / BPS;
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

    function _shipAttack(Ship ship) private pure returns (uint256) {
        uint256 attack = VeydriftCatalog.shipStructuralValue(ship) / 20;
        return attack == 0 ? 1 : attack;
    }

    function _shipHull(Ship ship) private pure returns (uint256) {
        return VeydriftCatalog.shipStructuralValue(ship) / 10;
    }

    function _defenseAttack(Defense defense) private pure returns (uint256) {
        if (VeydriftCatalog.isShieldDome(defense)) return 1;
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.defenseCost(defense);
        uint256 attack = (uint256(metal) + crystal + deuterium) / 20;
        return attack == 0 ? 1 : attack;
    }

    function _defenseHull(Defense defense) private pure returns (uint256) {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.defenseCost(defense);
        uint256 hull = (uint256(metal) + crystal + deuterium) / 10;
        return hull == 0 ? 1 : hull;
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
