// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftCatalog} from "./libraries/VeydriftCatalog.sol";
import {VeydriftRaidStorage} from "./libraries/VeydriftRaidStorage.sol";
import {Ship} from "./libraries/VeydriftTypes.sol";

/// @notice Delegatecall target for post-battle raid settlement, split out of combat bytecode.
contract VeydriftCombatRaidModule is VeydriftResourceReserves {
    constructor() VeydriftResourceReserves(address(0)) {}

    function settleAttackGroupRaid(uint256 attackMissionId) external {
        // The combat module calls this through `address(this).call(...)` only after resolving an
        // arrived battle. Leaving it public through the proxy fallback lets anyone settle an
        // outbound attack early and credit its cargo without combat.
        if (msg.sender != address(this)) revert Unauthorized(msg.sender);
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

        (AttackBlockReason reason, uint16 plunderBps) =
            _attackProtectionPreview(mission.owner, mission.targetPlanetId, mission.targetIsMoon);
        // Bashing is enforced at launch, after which a within-cap attack must retain its
        // ordinary 50% raid settlement. Unlike score protection, it must not zero plunder
        // merely because the launch filled the rolling bashing window before impact.
        if (!mission.targetIsMoon && reason == AttackBlockReason.ScoreProtection) {
            plunderBps = 0;
        }
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
            case 0 { plunderBps := 5000 }
            default {
                reason := mload(ptr)
                plunderBps := mload(add(ptr, 64))
            }
        }
    }
}
