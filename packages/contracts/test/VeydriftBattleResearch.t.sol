// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Test} from "forge-std/Test.sol";
import {VeydriftResourceReserves} from "../src/VeydriftResourceReserves.sol";
import {VeydriftBattleResearch as R} from "../src/libraries/VeydriftBattleResearch.sol";
import {VeydriftCombatStats as Stats} from "../src/libraries/VeydriftCombatStats.sol";
import {CombatCohort} from "../src/libraries/VeydriftCombatCohorts.sol";
import {Ship, Technology} from "../src/libraries/VeydriftTypes.sol";

contract BattleResearchHarness is VeydriftResourceReserves {
    constructor() VeydriftResourceReserves(msg.sender) {}

    function mark(uint256 id) external {
        R.markLaunchedAttack(id);
    }

    function marked(uint256 id) external view returns (bool) {
        return R.impactTimed(id);
    }

    function seed(address owner, uint16 w, uint16 s, uint16 a) external {
        _technologyLevels[owner][Technology.Weapons] = w;
        _technologyLevels[owner][Technology.Shielding] = s;
        _technologyLevels[owner][Technology.Armor] = a;
    }

    function queue(address owner, Technology t, uint16 level, uint64 at) external {
        researchQueues[owner] = ResearchQueue(true, t, level, at, Resources(0, 0, 0));
    }

    function capture(uint256 leader, address owner, uint64 impact)
        external
        returns (R.Levels memory)
    {
        return R.capture(
            leader,
            owner,
            impact,
            _technologyLevels[owner][Technology.Weapons],
            _technologyLevels[owner][Technology.Shielding],
            _technologyLevels[owner][Technology.Armor],
            researchQueues[owner]
        );
    }

    function cohort(uint256 leader, address owner, uint64 impact)
        external
        returns (CombatCohort memory)
    {
        return Stats.battleCohort(
            leader,
            owner,
            uint8(Ship.LightFighter),
            100,
            impact,
            _technologyLevels[owner][Technology.Weapons],
            _technologyLevels[owner][Technology.Shielding],
            _technologyLevels[owner][Technology.Armor],
            researchQueues[owner]
        );
    }

    function trackImported(uint256 id, address owner) external {
        _fleetMissions[id].missionType = FleetMissionType.Attack;
        _fleetMissions[id].status = FleetMissionStatus.Outbound;
        _fleetMissions[id].owner = owner;
        _fleetMissions[id].targetPlanetId = 2;
        _trackMissionResolution(id, _fleetMissions[id]);
    }
}

contract VeydriftBattleResearchTest is Test {
    BattleResearchHarness h;

    function setUp() public {
        h = new BattleResearchHarness();
    }

    function testSevenOwnersAllThreeTechnologiesQueueBoundariesAndCoherentCohorts() public {
        for (uint256 i; i < 7; ++i) {
            address owner = address(SafeCast.toUint160(i + 1));
            for (uint256 t; t < 3; ++t) {
                h.seed(
                    owner,
                    SafeCast.toUint16(2 + i),
                    SafeCast.toUint16(3 + i),
                    SafeCast.toUint16(4 + i)
                );
                Technology technology =
                    t == 0 ? Technology.Weapons : t == 1 ? Technology.Shielding : Technology.Armor;
                uint64 at = SafeCast.toUint64(199 + i % 3);
                h.queue(owner, technology, SafeCast.toUint16(20 + i), at);
                uint256 leader = 1000 + i * 10 + t;
                h.mark(leader);
                R.Levels memory fresh = h.capture(leader, owner, 200);
                uint16 expected =
                    at <= 200 ? SafeCast.toUint16(20 + i) : SafeCast.toUint16(2 + i + t);
                assertEq(t == 0 ? fresh.weapons : t == 1 ? fresh.shielding : fresh.armor, expected);
                R.Levels memory old = h.capture(leader + 10000, owner, 200);
                assertEq(old.weapons, 2 + i);
                assertEq(old.shielding, 3 + i);
                assertEq(old.armor, 4 + i);
                CombatCohort memory before = h.cohort(leader + 10000, owner, 200);
                h.seed(owner, 99, 98, 97);
                CombatCohort memory after_ = h.cohort(leader + 10000, owner, 200);
                assertEq(before.attack, after_.attack);
                assertEq(before.shield, after_.shield);
                assertEq(before.hull, after_.hull);
            }
        }
    }

    function testTrackingImportedOldAndMarkedLinkedMemberCannotRelabelLeader() public {
        h.trackImported(99, address(1));
        assertFalse(h.marked(99));
        h.mark(100);
        h.seed(address(1), 5, 6, 7);
        h.queue(address(1), Technology.Armor, 30, 100);
        R.Levels memory l = h.capture(99, address(1), 200);
        assertEq(l.armor, 7);
        assertTrue(h.marked(100));
        assertFalse(h.marked(99));
    }
}
