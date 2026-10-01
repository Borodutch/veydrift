// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
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

    function settle(address owner, uint64 at) external {
        _settleResearchDue(owner, at);
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

    function testOldDeletedQueueAmbiguityExplicitlyUsesStoredNotInventedHistory() public {
        address owner = address(1);
        h.seed(owner, 6, 7, 8); // old implementation already deleted the level-5 -> 6 queue
        R.Levels memory l = h.capture(1, owner, 150);
        assertEq(l.weapons, 6);
        assertEq(l.shielding, 7);
        assertEq(l.armor, 8);
        assertFalse(h.marked(1));
    }

    function testOldLeaderIgnoresEveryDueQueueAndCheckpointWhileNewUsesImpact() public {
        for (uint256 i; i < 3; ++i) {
            address owner = address(uint160(i + 1));
            h.seed(owner, 5, 6, 7);
            h.queue(owner, Technology.Weapons, 9, uint64(199 + i));
            h.mark(100 + i);
            R.Levels memory old = h.capture(1, owner, 200);
            R.Levels memory fresh = h.capture(100 + i, owner, 200);
            assertEq(old.weapons, 5);
            assertEq(fresh.weapons, i < 2 ? 9 : 5);
            h.settle(owner, 1000);
            h.mark(200 + i);
            fresh = h.capture(200 + i, owner, 200);
            assertEq(fresh.weapons, i < 2 ? 9 : 5);
            old = h.capture(2, owner, 200);
            assertEq(old.weapons, 9, "old uses current stored even when history differs");
        }
    }

    function testSevenOwnersAllThreeTechnologiesQueueBoundariesAndCoherentCohorts() public {
        for (uint256 i; i < 7; ++i) {
            address owner = address(uint160(i + 1));
            for (uint256 t; t < 3; ++t) {
                h.seed(owner, uint16(2 + i), uint16(3 + i), uint16(4 + i));
                Technology technology =
                    t == 0 ? Technology.Weapons : t == 1 ? Technology.Shielding : Technology.Armor;
                uint64 at = uint64(199 + i % 3);
                h.queue(owner, technology, uint16(20 + i), at);
                uint256 leader = 1000 + i * 10 + t;
                h.mark(leader);
                R.Levels memory fresh = h.capture(leader, owner, 200);
                uint16 expected = at <= 200 ? uint16(20 + i) : uint16(2 + i + t);
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
