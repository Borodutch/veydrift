// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftGameStorage as G} from "../src/VeydriftGameStorage.sol";
import {Test} from "forge-std/Test.sol";
import {VeydriftResourceReserves} from "../src/VeydriftResourceReserves.sol";
import {VeydriftScoreSnapshot as S} from "../src/libraries/VeydriftScoreSnapshot.sol";
import {VeydriftLegacyCombatMutation as L} from "../src/libraries/VeydriftLegacyCombatMutation.sol";
import {Building, Defense, Ship, Technology} from "../src/libraries/VeydriftTypes.sol";

contract ScoreSnapshotHarness is VeydriftResourceReserves {
    constructor() VeydriftResourceReserves(address(this)) {}

    function seed(address player, uint256 id) external {
        _planets[id].owner = player;
        _registerOwnedPlanet(player, id);
        _buildingLevels[id][Building.MetalMine] = 3;
        _setPlanetShipCount(id, Ship.Battleship, 10);
        FleetMission storage m = _fleetMissions[id];
        m.owner = player;
        m.status = FleetMissionStatus.Returning;
        m.missionType = FleetMissionType.Transport;
        m.originPlanetId = id;
        m.targetPlanetId = id;
        m.ships.smallCargo = 5;
        _trackMissionResolution(id, m);
    }

    function begin(address player, uint256 id) external {
        S.begin(
            player, id, _ownedPlanetIds[player].length, _resolutionMissionIdsByPlayer[player].length
        );
    }

    function mutate(uint256 id) external {
        _snapshotPlanetScore(id);
        _buildingLevels[id][Building.MetalMine] = 30;
        _setPlanetShipCount(id, Ship.Battleship, 100);
        _setMoonShipCount(id, Ship.Deathstar, 20);
        _setPlanetDefenseCount(id, Defense.PlasmaTurret, 7);
        FleetMission storage m = _fleetMissions[id];
        _snapshotMissionScore(m);
        m.status = FleetMissionStatus.Returned;
        m.ships.smallCargo = 1;
        _untrackMissionResolution(id, m);
    }

    function remove(address player, uint256 id) external {
        _snapshotPlanetScore(id);
        delete _planets[id];
        _unregisterOwnedPlanet(player, id);
    }

    function frozen(address player, uint256 id) external view returns (uint256 total) {
        S.Snapshot storage s = S.layout().snapshots[id][player];
        for (uint256 i; i < s.planetLength; ++i) {
            uint256 p = S.originalId(id, player, true, _ownedPlanetIds[player], i);
            S.Saved storage saved = s.planets[p];
            total += saved.present
                ? saved.value
                : S.planetScore(
                    _buildingLevels[p], _defenseCounts[p], _shipCounts[p], _moonShipCounts[p]
                );
        }
        for (uint256 i; i < s.missionLength; ++i) {
            uint256 m = S.originalId(id, player, false, _resolutionMissionIdsByPlayer[player], i);
            total += S.originalMissionScore(id, player, _fleetMissions[m]);
        }
    }

    function score(address player) external view returns (uint256) {
        return _totalUserScore(player);
    }

    function finish(address player, uint256 id) external {
        S.finish(player, id);
    }

    function legacyMutation(MissionShips memory initial, MissionShips memory losses)
        external
        returns (MissionShips memory, uint256)
    {
        _fleetMissions[999].ships = initial;
        MissionShips storage ships = _fleetMissions[999].ships;
        assembly ("memory-safe") {
            sstore(add(ships.slot, 1), or(sload(add(ships.slot, 1)), shl(192, 0x1122334455667788)))
        }
        L.subtract(ships, losses);
        uint256 padding;
        assembly ("memory-safe") { padding := shr(192, sload(add(ships.slot, 1))) }
        return (ships, padding);
    }
}

contract VeydriftScoreSnapshotTest is Test {
    ScoreSnapshotHarness h;
    address constant P = address(1);

    function setUp() public {
        h = new ScoreSnapshotHarness();
        for (uint256 i = 1; i <= 6; ++i) {
            h.seed(P, i);
        }
    }

    function testSnapshotSurvivesMutationsSwapPopAppendAndReentry() public {
        uint256 beforeScore = h.score(P);
        assertEq(beforeScore, 6 * (1000 + 30 + 320 + 20));
        h.begin(P, 99);
        h.mutate(1);
        h.mutate(6);
        h.remove(P, 2);
        h.remove(P, 5);
        h.seed(P, 7);
        h.seed(P, 8);
        assertEq(h.frozen(P, 99), beforeScore, "COW lost original values or indices");
        assertNotEq(h.score(P), beforeScore);
        h.finish(P, 99);
        h.begin(P, 100);
        assertEq(h.frozen(P, 100), h.score(P), "new scan reused old COW values");
    }

    function testFuzzLegacyMutationPreservesEveryLaneAndPadding(
        uint32[14] memory initial,
        uint32[14] memory losses
    ) public {
        (G.MissionShips memory result, uint256 padding) = h.legacyMutation(
            abi.decode(abi.encode(initial), (G.MissionShips)),
            abi.decode(abi.encode(losses), (G.MissionShips))
        );
        uint32[14] memory actual = abi.decode(abi.encode(result), (uint32[14]));
        for (uint256 i; i < 14; ++i) {
            assertEq(actual[i], initial[i] > losses[i] ? initial[i] - losses[i] : 0);
        }
        assertEq(padding, 0x1122334455667788);
    }

    function testOnlyOverlappingPreparationWaitsNotGameplayOrOtherPlayers() public {
        h.begin(P, 99);
        vm.expectRevert(abi.encodeWithSelector(S.ScoreSnapshotPending.selector, 99));
        h.begin(P, 100);
        address other = address(2);
        h.seed(other, 1000);
        h.begin(other, 100);
        h.mutate(1);
        h.mutate(1000);
        assertEq(h.frozen(P, 99), 6 * (1000 + 30 + 320 + 20));
        assertEq(h.frozen(other, 100), 1000 + 30 + 320 + 20);
    }
}
