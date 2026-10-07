// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftGameStorage as G} from "../../src/VeydriftGameStorage.sol";
import {VeydriftProofSettlement as S} from "../../src/libraries/VeydriftProofSettlement.sol";
import {
    VeydriftStagedBattleStorage as Store
} from "../../src/libraries/VeydriftStagedBattleStorage.sol";
import {VeydriftCombatStats} from "../../src/libraries/VeydriftCombatStats.sol";
import {Ship} from "../../src/libraries/VeydriftTypes.sol";

/// TEST ONLY trusted state injector, temporarily etched by test then removed before proxy calls.
/// Not a verifier, never part of production deployment graph.
contract ProofSettlementHarness is G {
    constructor() G(address(1)) {}

    function creditDebris(uint256 body, uint128 metal, uint128 crystal) external {
        _debrisFields[body].metal += metal;
        _debrisFields[body].crystal += crystal;
        _totalInternalResources.metal += metal;
        _totalInternalResources.crystal += crystal;
    }

    function seedHeld(uint256 attack, uint256 id, uint256 target, address defender, uint64 arrival)
        external
    {
        FleetMission storage m = _fleetMissions[id];
        m.status = FleetMissionStatus.Outbound;
        m.missionType = FleetMissionType.DefenseHold;
        m.owner = defender;
        m.originPlanetId = target;
        m.targetPlanetId = target;
        m.arrivalAt = arrival;
        m.returnAt = arrival + 200;
        m.ships.smallCargo = 2;
        m.cargo = Resources(11, 13, 17);
        _totalInternalResources.metal += 11;
        _totalInternalResources.crystal += 13;
        _totalInternalResources.deuterium += 17;
        _defenseHoldUntil[id] = arrival + 100;
        _stationedDefenseMissions[target].push(id);
        _stationedDefenseMissionIndex[target][id] = _stationedDefenseMissions[target].length;
        _fleetCounterplayMissions[attack].push(id);
        ++activeFleetMissionCount[defender];
    }

    function heldState(uint256 target) external view returns (uint256, uint64, uint64) {
        return
            (
                _stationedDefenseMissions[target].length,
                _defenseHoldUntil[100],
                _defenseHoldUntil[101]
            );
    }

    function creditCargo(uint256 id) external {
        _fleetMissions[id].cargo = Resources(11, 13, 17);
        _totalInternalResources.metal += 11;
        _totalInternalResources.crystal += 13;
        _totalInternalResources.deuterium += 17;
    }

    function lockReserves(uint128 metal, uint128 crystal, uint128 deuterium) external {
        _lockedWithdrawalResources = Resources(metal, crystal, deuterium);
    }

    function raidMissions(uint256 id) external view returns (uint256[] memory) {
        return Store.battle(id).missions;
    }

    function raidCapacities(uint256 id, uint256 first, uint256 second)
        external
        view
        returns (uint256, uint256)
    {
        return (Store.battle(id).capacities[first], Store.battle(id).capacities[second]);
    }

    function settlementCursor(uint256 id) external view returns (uint64, uint256, uint8, uint256) {
        Store.Battle storage b = Store.battle(id);
        return (b.returnSettlementAt, b.returnCursor, b.raidPhase, b.totalCapacity);
    }

    function resolutionIndexes(uint256 id) external view returns (uint256, uint256, uint256) {
        FleetMission storage m = _fleetMissions[id];
        return (
            _resolutionMissionIndexByPlanet[m.originPlanetId][id],
            _resolutionMissionIndexByPlanet[m.targetPlanetId][id],
            _resolutionMissionIndexByPlayer[m.owner][id]
        );
    }

    // Synthetic live pool fixture. Preserve the actual frozen plunder rate and liabilities.
    function oneUnitRaidPool(uint256 id) external {
        uint128 rate = _battleRaidPlunderBps[id];
        require(rate > 0);
        Resources storage pool = _planets[_fleetMissions[id].targetPlanetId].resources;
        uint128 metal = (9999 + rate) / rate;
        _totalInternalResources.metal = _totalInternalResources.metal - pool.metal + metal;
        _totalInternalResources.crystal -= pool.crystal;
        _totalInternalResources.deuterium -= pool.deuterium;
        pool.metal = metal;
        pool.crystal = 0;
        pool.deuterium = 0;
    }

    function binding(uint256 id) external view returns (bytes32) {
        return S.chainRecord(id);
    }

    function acceptTrusted(
        uint256 id,
        bytes32 root,
        uint256 members,
        uint8 rounds,
        uint256[2] memory totals
    ) external {
        S.accept(id, root, members, rounds, totals);
    }

    function missionCount(uint256 id, Ship unit, uint32 n) external {
        VeydriftCombatStats.setMissionShipQuantity(_fleetMissions[id].ships, unit, n);
    }

    function ships(uint256 id) external view returns (MissionShips memory) {
        return _fleetMissions[id].ships;
    }

    function locked(uint256 body) external view returns (uint256) {
        return Store.layout().bodyLock[body];
    }
}
