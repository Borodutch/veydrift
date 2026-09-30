// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftDefenseHoldStorage} from "../src/libraries/VeydriftDefenseHoldStorage.sol";

contract DefenseHoldLinkHarness {
    uint256[] private stationed;
    uint256[] private linked;
    mapping(uint256 => VeydriftGameStorage.FleetMission) private missions;
    mapping(uint256 => uint64) private until;

    function add(uint256 id, uint64 arrival, uint64 end, bool moon, bool outbound) external {
        stationed.push(id);
        missions[id].missionType = VeydriftGameStorage.FleetMissionType.DefenseHold;
        missions[id].status = outbound
            ? VeydriftGameStorage.FleetMissionStatus.Outbound
            : VeydriftGameStorage.FleetMissionStatus.Returning;
        missions[id].arrivalAt = arrival;
        missions[id].targetIsMoon = moon;
        until[id] = end;
    }

    function link(uint64 impact, bool moon) external returns (uint256[] memory) {
        VeydriftDefenseHoldStorage.linkQualifiedDefenders(
            stationed, linked, missions, until, impact, moon
        );
        return linked;
    }
}

contract VeydriftDefenseHoldLinkParityTest is Test {
    function testRepeatedResolverLinksEachQualifiedHoldExactlyOnce() public {
        DefenseHoldLinkHarness h = new DefenseHoldLinkHarness();
        h.add(1, 100, 300, false, true);
        h.add(2, 200, 300, false, true);
        h.add(3, 100, 199, false, true);
        h.add(4, 201, 300, false, true);
        h.add(5, 100, 300, true, true);
        h.add(6, 100, 300, false, false);
        uint256[] memory first = h.link(200, false);
        assertEq(first.length, 2);
        assertEq(first[0], 1);
        assertEq(first[1], 2);
        for (uint256 round; round < 6; ++round) {
            assertEq(h.link(200, false), first);
        }
    }

    function testMoonAndInclusiveHoldEndQualification() public {
        DefenseHoldLinkHarness h = new DefenseHoldLinkHarness();
        h.add(1, 100, 200, false, true);
        h.add(2, 100, 200, true, true);
        uint256[] memory linked = h.link(200, true);
        assertEq(linked.length, 1);
        assertEq(linked[0], 2);
        assertEq(h.link(200, true), linked);
    }
}
