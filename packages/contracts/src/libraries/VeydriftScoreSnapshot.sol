// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftGameStorage as G} from "../VeydriftGameStorage.sol";
import {Building, Defense, Ship} from "./VeydriftTypes.sol";

/// @notice Copy-on-write snapshots for bounded protection scans. Gameplay writes are never locked.
/// A player can share one in-progress scan; only a second scan involving that player must wait.
/// Snapshot arrays retain their original indices across swap/pop and append; components retain
/// their first pre-write score. Every capture has fixed work, irrespective of account size.
library VeydriftScoreSnapshot {
    bytes32 private constant SLOT = keccak256("veydrift.storage.score-snapshot.v1");

    struct Saved {
        bool present;
        uint256 value;
    }

    struct Snapshot {
        uint256 planetLength;
        uint256 missionLength;
        mapping(uint256 => Saved) planets;
        mapping(uint256 => Saved) missions;
        mapping(uint256 => Saved) planetIndices;
        mapping(uint256 => Saved) missionIndices;
    }

    struct Layout {
        mapping(address => uint256) active;
        mapping(uint256 => mapping(address => Snapshot)) snapshots;
    }
    error ScoreSnapshotPending(uint256 battleId);

    function layout() internal pure returns (Layout storage s) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") { s.slot := slot }
    }

    function begin(address player, uint256 id, uint256 planets, uint256 missions) public {
        Layout storage l = layout();
        uint256 active = l.active[player];
        if (active != 0 && active != id) revert ScoreSnapshotPending(active);
        l.active[player] = id;
        Snapshot storage s = l.snapshots[id][player];
        s.planetLength = planets;
        s.missionLength = missions;
    }

    function finish(address player, uint256 id) public {
        if (layout().active[player] == id) delete layout().active[player];
    }

    function captureIndices(address player, bool planet, uint256[] storage ids, uint256 index)
        public
    {
        uint256 active = layout().active[player];
        if (active == 0) return;
        Snapshot storage s = layout().snapshots[active][player];
        uint256 length = planet ? s.planetLength : s.missionLength;
        mapping(uint256 => Saved) storage entries = planet ? s.planetIndices : s.missionIndices;
        uint256 last = ids.length - 1;
        if (index < length && !entries[index].present) entries[index] = Saved(true, ids[index]);
        if (last < length && !entries[last].present) entries[last] = Saved(true, ids[last]);
    }

    /// @dev Shared swap/pop sink; address(0) identifies non-score (planet-arrival) indices.
    function removeIndex(
        address player,
        bool planet,
        uint256[] storage ids,
        mapping(uint256 => uint256) storage indices,
        uint256 id
    ) public {
        uint256 indexPlusOne = indices[id];
        if (indexPlusOne == 0) return;
        uint256 index = indexPlusOne - 1;
        if (player != address(0)) captureIndices(player, planet, ids, index);
        uint256 last = ids.length - 1;
        if (index != last) {
            uint256 moved = ids[last];
            ids[index] = moved;
            indices[moved] = indexPlusOne;
        }
        ids.pop();
        delete indices[id];
    }

    function originalId(
        uint256 battle,
        address player,
        bool planet,
        uint256[] storage ids,
        uint256 index
    ) public view returns (uint256) {
        Snapshot storage s = layout().snapshots[battle][player];
        Saved storage saved = planet ? s.planetIndices[index] : s.missionIndices[index];
        return saved.present ? saved.value : ids[index];
    }

    function planetScore(
        mapping(Building => uint16) storage buildings,
        mapping(Defense => uint32) storage defenses,
        mapping(Ship => uint32) storage ships,
        mapping(Ship => uint32) storage moonShips
    ) public view returns (uint256 score) {
        score = 1000;
        for (uint8 u; u <= uint8(Building.InterdimensionalRiftStabilizer); ++u) {
            score += uint256(buildings[Building(u)]) * (u + 1) * 10;
        }
        for (uint8 u; u <= uint8(Defense.InterplanetaryMissile); ++u) {
            score += uint256(defenses[Defense(u)]) * (u + 1) * 2;
        }
        for (uint8 u; u <= uint8(Ship.Crawler); ++u) {
            score += (uint256(ships[Ship(u)]) + moonShips[Ship(u)]) * (u + 1) * 4;
        }
    }

    function capturePlanet(
        uint256 id,
        mapping(uint256 => G.Planet) storage planets,
        mapping(uint256 => mapping(Building => uint16)) storage buildings,
        mapping(uint256 => mapping(Defense => uint32)) storage defenses,
        mapping(uint256 => mapping(Ship => uint32)) storage ships,
        mapping(uint256 => mapping(Ship => uint32)) storage moonShips
    ) public {
        address player = planets[id].owner;
        uint256 active = layout().active[player];
        if (active == 0) return;
        Saved storage saved = layout().snapshots[active][player].planets[id];
        if (!saved.present) {
            saved.value = planetScore(buildings[id], defenses[id], ships[id], moonShips[id]);
            saved.present = true;
        }
    }

    function missionScore(G.FleetMission storage m) public view returns (uint256) {
        if (
            m.missionType > G.FleetMissionType.Colonize
                || (m.status != G.FleetMissionStatus.Outbound
                    && m.status != G.FleetMissionStatus.Returning)
        ) return 0;
        G.MissionShips storage s = m.ships;
        return uint256(s.smallCargo) * 4 + uint256(s.lightFighter) * 8 + uint256(s.recycler) * 12
            + uint256(s.colonyShip) * 16 + uint256(s.largeCargo) * 20 + uint256(s.heavyFighter) * 24
            + uint256(s.cruiser) * 28 + uint256(s.battleship) * 32 + uint256(s.bomber) * 36
            + uint256(s.destroyer) * 44 + uint256(s.deathstar) * 48 + uint256(s.battlecruiser) * 52
            + uint256(s.reaper) * 56 + uint256(s.pathfinder) * 60;
    }

    function captureMission(G.FleetMission storage m) public {
        uint256 active = layout().active[m.owner];
        if (active == 0) return;
        uint256 key;
        assembly ("memory-safe") { key := m.slot }
        Saved storage saved = layout().snapshots[active][m.owner].missions[key];
        if (!saved.present) {
            saved.value = missionScore(m);
            saved.present = true;
        }
    }

    function originalMissionScore(uint256 battle, address player, G.FleetMission storage m)
        public
        view
        returns (uint256)
    {
        if (m.owner != player) return 0;
        uint256 key;
        assembly ("memory-safe") { key := m.slot }
        Saved storage saved = layout().snapshots[battle][player].missions[key];
        return saved.present ? saved.value : missionScore(m);
    }
}
