// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftCombatModule} from "../src/VeydriftCombatModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {Resource, Ship} from "../src/libraries/VeydriftTypes.sol";

contract AllianceMockResourceToken {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved < amount || balanceOf[from] < amount) return false;

        allowance[from][msg.sender] = approved - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract VeydriftAllianceSystemTest is Test {
    address internal admin = address(0xA11CE);
    address internal leader = address(0xB0B);
    address internal member = address(0xCAFE);
    address internal enemy = address(0xE11A);

    VeydriftGame internal game;
    VeydriftAllianceSystem internal alliances;
    AllianceMockResourceToken internal metalToken;
    AllianceMockResourceToken internal crystalToken;
    AllianceMockResourceToken internal deuteriumToken;

    function setUp() public {
        game = new VeydriftGame(
            admin, address(new VeydriftGameplayModule(address(new VeydriftCombatModule())))
        );
        alliances = new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)));
        metalToken = new AllianceMockResourceToken();
        crystalToken = new AllianceMockResourceToken();
        deuteriumToken = new AllianceMockResourceToken();
        _fundGameReserves(1_000_000_000);
        vm.deal(leader, 1 ether);
        vm.deal(member, 1 ether);
        vm.deal(enemy, 1 ether);
        _start(leader);
        _start(member);
        _start(enemy);
    }

    function testAllianceCreationInvitesRolesAndPublicMembers() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "ipfs://union");

        VeydriftAllianceSystem.Alliance memory profile = alliances.allianceProfile(allianceId);
        VeydriftAllianceSystem.Membership memory leaderMembership = alliances.allianceOf(leader);
        assertEq(profile.active, true);
        assertEq(profile.tag, "VDFT");
        assertEq(profile.name, "Veydrift Union");
        assertEq(profile.metadataURI, "ipfs://union");
        assertEq(profile.memberCount, 1);
        assertEq(uint8(leaderMembership.role), uint8(VeydriftAllianceSystem.AllianceRole.Leader));
        assertEq(alliances.allianceMemberAt(allianceId, 0), leader);

        vm.prank(leader);
        alliances.inviteMember(allianceId, member);
        VeydriftAllianceSystem.Invite memory invite = alliances.allianceInvite(member, allianceId);
        assertEq(invite.active, true);
        assertEq(invite.inviter, leader);

        vm.prank(member);
        alliances.acceptInvite(allianceId);

        profile = alliances.allianceProfile(allianceId);
        VeydriftAllianceSystem.Membership memory memberMembership = alliances.allianceOf(member);
        assertEq(profile.memberCount, 2);
        assertEq(uint8(memberMembership.role), uint8(VeydriftAllianceSystem.AllianceRole.Member));
        assertEq(alliances.allianceMembers(allianceId).length, 2);

        vm.prank(leader);
        alliances.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Officer);
        memberMembership = alliances.allianceOf(member);
        assertEq(uint8(memberMembership.role), uint8(VeydriftAllianceSystem.AllianceRole.Officer));
    }

    function testDiplomacyFeedsAttackLimitContext() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("ALLY", "Alliance", "");

        vm.prank(enemy);
        uint256 enemyAllianceId = alliances.createAlliance("WAR", "War Target", "");

        (uint256 attackerAllianceId, uint256 defenderAllianceId, bool sameAlliance, bool atWar,,) =
            alliances.attackLimitAllianceContext(leader, enemy);
        assertEq(attackerAllianceId, allianceId);
        assertEq(defenderAllianceId, enemyAllianceId);
        assertFalse(sameAlliance);
        assertFalse(atWar);

        vm.prank(leader);
        alliances.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );

        bool bashingWarException;
        bool scoreProtectionException;
        (,,, atWar, bashingWarException, scoreProtectionException) =
            alliances.attackLimitAllianceContext(leader, enemy);
        assertTrue(atWar);
        assertTrue(bashingWarException);
        assertTrue(scoreProtectionException);
    }

    function testAllianceDefenseIntentUsesHostileMissionCutoff() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("ACS", "Defense Wing", "");

        vm.prank(leader);
        alliances.inviteMember(allianceId, member);
        vm.prank(member);
        alliances.acceptInvite(allianceId);

        uint256 enemyPlanetId = game.homePlanetOf(enemy);
        uint256 leaderPlanetId = game.homePlanetOf(leader);
        _setShipCount(enemyPlanetId, Ship.LightFighter, 1);
        _setResources(enemyPlanetId, 500, 500, 10_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.lightFighter = 1;

        vm.prank(enemy);
        uint256 missionId = game.launchFleetMission(
            enemyPlanetId,
            leaderPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        assertTrue(alliances.canCoordinateDefense(member, leaderPlanetId, missionId));

        vm.prank(leader);
        uint256 intentId = alliances.openDefenseIntent(leaderPlanetId, missionId);

        VeydriftAllianceSystem.DefenseIntent memory intent = alliances.defenseIntent(intentId);
        (,,,,,, uint64 arrivalAt,,,,) = game.fleetMission(missionId);
        assertEq(intent.active, true);
        assertEq(intent.allianceId, allianceId);
        assertEq(intent.hostileMissionId, missionId);
        assertEq(intent.joinCutoffAt, arrivalAt - 5 minutes);
    }

    function _start(address player) internal {
        vm.prank(player);
        game.startPlanet{value: 0.05 ether}();
    }

    function _fundGameReserves(uint256 amount) internal {
        metalToken.mint(address(game), amount);
        crystalToken.mint(address(game), amount);
        deuteriumToken.mint(address(game), amount);
        vm.prank(admin);
        game.setResourceTokens(address(metalToken), address(crystalToken), address(deuteriumToken));
    }

    function _setShipCount(uint256 planetId, Ship ship, uint32 count) internal {
        bytes32 outerSlot = keccak256(abi.encode(planetId, uint256(22)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(ship)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(count)));
    }

    function _setResources(uint256 planetId, uint128 metal, uint128 crystal, uint128 deuterium)
        internal
    {
        uint256 planetBase = uint256(keccak256(abi.encode(planetId, uint256(4))));
        vm.store(address(game), bytes32(planetBase + 2), _packResourcesHead(metal, crystal));
        vm.store(address(game), bytes32(planetBase + 3), bytes32(uint256(deuterium)));
        vm.store(address(game), bytes32(uint256(14)), _packResourcesHead(metal, crystal));
        vm.store(address(game), bytes32(uint256(15)), bytes32(uint256(deuterium)));
    }

    function _packResourcesHead(uint128 metal, uint128 crystal) internal pure returns (bytes32) {
        return bytes32((uint256(crystal) << 128) | uint256(metal));
    }
}
