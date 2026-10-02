// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftRaidStorage} from "./libraries/VeydriftRaidStorage.sol";
import {VeydriftStagedBattleStorage as Store} from "./libraries/VeydriftStagedBattleStorage.sol";
import {Ship} from "./libraries/VeydriftTypes.sol";

/// @notice Delegatecall target for post-battle raid settlement, split out of combat bytecode.
contract VeydriftCombatRaidModule is VeydriftResourceReserves {
    error MissingRaidProtectionSnapshot(uint256 missionId);

    constructor() VeydriftResourceReserves(address(0)) {}

    function settleAttackGroupRaid(uint256 attackMissionId) external {
        // The combat module calls this through `address(this).call(...)` only after resolving an
        // arrived battle. Leaving it public through the proxy fallback lets anyone settle an
        // outbound attack early and credit its cargo without combat.
        if (msg.sender != address(this)) revert Unauthorized(msg.sender);
        if (!_battleRaidProtectionSnapshotted[attackMissionId]) {
            revert MissingRaidProtectionSnapshot(attackMissionId);
        }
        if (Store.battle(attackMissionId).phase != 0) {
            _stagedRaid(attackMissionId);
            return;
        }
        uint16 plunderBps = _battleRaidPlunderBps[attackMissionId];
        FleetMission storage mission = _fleetMissions[attackMissionId];
        uint256 totalCapacity =
            _remainingCargoCapacity(mission.ships, mission.cargo, mission.fuelCost);
        uint256[] storage linkedMissionIds = _fleetCounterplayMissions[attackMissionId];
        for (uint256 i = 0; i < linkedMissionIds.length;) {
            FleetMission storage joined = _fleetMissions[linkedMissionIds[i]];
            if (_isQualifiedJoinedAttack(attackMissionId, joined)) {
                totalCapacity += _remainingCargoCapacity(
                    joined.ships, joined.cargo, joined.fuelCost
                );
            }
            unchecked {
                ++i;
            }
        }
        if (totalCapacity == 0) return;

        Resources memory loot = mission.targetIsMoon
            ? _raidMoonResources(
                mission.targetPlanetId, totalCapacity, plunderBps, mission.lootRatio
            )
            : _raidResources(mission.targetPlanetId, totalCapacity, plunderBps, mission.lootRatio);
        if (!mission.targetIsMoon) {
            uint256 used = uint256(loot.metal) + loot.crystal + loot.deuterium;
            if (used < totalCapacity) {
                loot = _add(
                    loot,
                    _raidRiftResources(
                        mission.owner,
                        mission.targetPlanetId,
                        totalCapacity - used,
                        mission.lootRatio
                    )
                );
            }
        }
        _distributeAttackGroupLoot(attackMissionId, mission, loot, totalCapacity);
    }

    event CombatMissionLoot(
        uint256 indexed battleId,
        uint256 indexed missionId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );

    function _stagedRaid(uint256 id) private {
        Store.Battle storage b = Store.battle(id);
        FleetMission storage attack = _fleetMissions[id];
        if (b.prepared) return;
        if (b.blocked || b.math.sides[0].total == 0 || b.math.sides[1].total != 0) {
            b.prepared = true;
            return;
        }
        if (b.raidPhase == 0) {
            if (b.returnCursor < b.missions.length) {
                uint256 memberId = b.missions[b.returnCursor++];
                FleetMission storage member = _fleetMissions[memberId];
                if (memberId == id || member.missionType == FleetMissionType.AcsAttack) {
                    uint256 capacity =
                        _remainingCargoCapacity(member.ships, member.cargo, member.fuelCost);
                    b.capacities[memberId] = capacity;
                    b.totalCapacity += capacity;
                }
            } else {
                b.raidPhase = 1;
                b.returnCursor = 0;
            }
        } else if (b.raidPhase == 1) {
            if (b.totalCapacity == 0) {
                b.prepared = true;
                return;
            }
            Resources memory loot = attack.targetIsMoon
                ? _raidMoonResources(
                    attack.targetPlanetId,
                    b.totalCapacity,
                    _battleRaidPlunderBps[id],
                    attack.lootRatio
                )
                : _raidResources(
                    attack.targetPlanetId,
                    b.totalCapacity,
                    _battleRaidPlunderBps[id],
                    attack.lootRatio
                );
            uint256 used = uint256(loot.metal) + loot.crystal + loot.deuterium;
            if (!attack.targetIsMoon && used < b.totalCapacity) {
                loot = _add(
                    loot,
                    _raidRiftResources(
                        attack.owner,
                        attack.targetPlanetId,
                        b.totalCapacity - used,
                        attack.lootRatio
                    )
                );
            }
            b.lootMetal = loot.metal;
            b.lootCrystal = loot.crystal;
            b.lootDeuterium = loot.deuterium;
            b.raidPhase = 2;
        } else {
            if (b.returnCursor == b.missions.length) {
                b.prepared = true;
                return;
            }
            uint256 memberId = b.missions[b.returnCursor++];
            uint256 capacity = b.capacities[memberId];
            if (capacity == 0) return;
            Resources memory share;
            share.metal = _toUint128(uint256(b.lootMetal) * capacity / b.totalCapacity);
            share.crystal = _toUint128(uint256(b.lootCrystal) * capacity / b.totalCapacity);
            share.deuterium = _toUint128(uint256(b.lootDeuterium) * capacity / b.totalCapacity);
            b.lootMetal -= share.metal;
            b.lootCrystal -= share.crystal;
            b.lootDeuterium -= share.deuterium;
            b.totalCapacity -= capacity;
            _fleetMissions[memberId].cargo = _add(_fleetMissions[memberId].cargo, share);
            ++b.lootEventCount;
            emit CombatMissionLoot(id, memberId, share.metal, share.crystal, share.deuterium);
        }
    }

    function _raidRiftResources(
        address attacker,
        uint256 planetId,
        uint256 capacity,
        LootRatio memory ratio
    ) private returns (Resources memory raided) {
        (bool ok, bytes memory data) = address(this)
            .call(
                abi.encodeWithSelector(
                    0x054f9f8c,
                    attacker,
                    planetId,
                    capacity,
                    ratio.metalBps,
                    ratio.crystalBps,
                    ratio.deuteriumBps
                )
            );
        if (!ok) assembly ("memory-safe") { revert(add(data, 32), mload(data)) }
        return abi.decode(data, (Resources));
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
        uint256[] storage ids = _fleetCounterplayMissions[attackMissionId];
        for (uint256 i = 0; i < ids.length;) {
            FleetMission storage joined = _fleetMissions[ids[i]];
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
        uint256 capacity = _remainingCargoCapacity(
            recipient.ships, recipient.cargo, recipient.fuelCost
        );
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
        return (remaining, capacity >= remainingCapacity ? 0 : remainingCapacity - capacity);
    }

    function _raidResources(
        uint256 planetId,
        uint256 capacity,
        uint16 plunderBps,
        LootRatio memory ratio
    ) private returns (Resources memory raided) {
        (raided.metal, raided.crystal, raided.deuterium) = VeydriftRaidStorage.raid(
            _planets[planetId],
            planetId,
            capacity,
            plunderBps,
            ratio.metalBps,
            ratio.crystalBps,
            ratio.deuteriumBps
        );
    }

    function _raidMoonResources(
        uint256 planetId,
        uint256 capacity,
        uint16 plunderBps,
        LootRatio memory ratio
    ) private returns (Resources memory raided) {
        (raided.metal, raided.crystal, raided.deuterium) =
            VeydriftRaidStorage.raidMoon(
                _moonResources[planetId],
                planetId,
                capacity,
                plunderBps,
                ratio.metalBps,
                ratio.crystalBps,
                ratio.deuteriumBps
            );
    }

    function _remainingCargoCapacity(
        MissionShips memory ships,
        Resources memory cargo,
        uint128 fuelCost
    ) private pure returns (uint256) {
        uint256 capacity;
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            capacity += uint256(_missionShipQuantity(ships, ship))
            * VeydriftCatalog.shipCargoCapacity(ship);
            unchecked {
                ++i;
            }
        }
        uint256 used = uint256(cargo.metal) + cargo.crystal + cargo.deuterium + fuelCost;
        return capacity > used ? capacity - used : 0;
    }

    function _missionShipQuantity(MissionShips memory ships, Ship ship)
        private
        pure
        returns (uint32 quantity)
    {
        uint8 id = uint8(ship);
        if (id == uint8(Ship.SolarSatellite) || id > uint8(Ship.Pathfinder)) return 0;
        if (id > uint8(Ship.SolarSatellite)) id -= 1;
        assembly ("memory-safe") { quantity := mload(add(ships, shl(5, id))) }
    }

    function _isQualifiedJoinedAttack(uint256 attackMissionId, FleetMission storage joined)
        private
        view
        returns (bool)
    {
        FleetMission storage attack = _fleetMissions[attackMissionId];
        return joined.status == FleetMissionStatus.Outbound && joined.arrivalAt <= attack.arrivalAt
            && joined.randomnessRequestId == attackMissionId
            && joined.targetPlanetId == attack.targetPlanetId
            && joined.missionType == FleetMissionType.AcsAttack;
    }
}
