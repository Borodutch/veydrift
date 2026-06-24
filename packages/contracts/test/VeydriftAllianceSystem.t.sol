// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
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

/// @dev A trivial post-upgrade implementation used to prove the live alliance
/// proxy can be moved to a new UUPS implementation that still exposes
/// `transferAllianceOwnership` while preserving all existing storage.
contract VeydriftAllianceSystemV2 is VeydriftAllianceSystem {
    constructor(IVeydriftAllianceGame gameContract) VeydriftAllianceSystem(gameContract) {}

    function upgradeVersion() external pure returns (string memory) {
        return "v2";
    }
}

contract VeydriftAllianceSystemTest is Test {
    address internal admin = address(0xA11CE);
    address internal leader = address(0xB0B);
    address internal member = address(0xCAFE);
    address internal enemy = address(0xE11A);
    address internal recruit = address(0xBEEF);
    address internal fulfiller = address(0xF17F);

    VeydriftGame internal game;
    VeydriftAllianceSystem internal alliances;
    AllianceMockResourceToken internal metalToken;
    AllianceMockResourceToken internal crystalToken;
    AllianceMockResourceToken internal deuteriumToken;

    function setUp() public {
        VeydriftCombatModule combatModule =
            new VeydriftCombatModule(address(new VeydriftCombatRapidfire()));
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftAttackProtectionModule attackProtectionModule = new VeydriftAttackProtectionModule();
        VeydriftColonizationModule colonizationModule = new VeydriftColonizationModule();
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();
        game = new VeydriftGame(
            admin,
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule),
            address(defenseHoldModule)
        );
        RandomnessEngine randomness = new RandomnessEngine(admin, fulfiller);
        vm.prank(admin);
        randomness.setPrecommitRequired(false);
        alliances = new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)));
        metalToken = new AllianceMockResourceToken();
        crystalToken = new AllianceMockResourceToken();
        deuteriumToken = new AllianceMockResourceToken();
        _fundGameReserves(1_000_000_000);
        vm.startPrank(admin);
        game.setRandomnessEngine(address(randomness));
        randomness.setRequesterAuthorization(address(game), true);
        vm.stopPrank();
        vm.deal(leader, 1 ether);
        vm.deal(member, 1 ether);
        vm.deal(enemy, 1 ether);
        vm.deal(recruit, 1 ether);
        _start(leader);
        _start(member);
        _start(enemy);
        _start(recruit);
    }

    function testAllianceCreationInvitesRolesAndPublicMembers() public {
        vm.prank(leader);
        uint256 allianceId =
            alliances.createAlliance("VDFT", "Veydrift Union", "Discord: https://discord.gg/vdft");

        VeydriftAllianceSystem.Alliance memory profile = alliances.allianceProfile(allianceId);
        VeydriftAllianceSystem.Membership memory leaderMembership = alliances.allianceOf(leader);
        assertEq(profile.active, true);
        assertEq(profile.tag, "VDFT");
        assertEq(profile.name, "Veydrift Union");
        assertEq(profile.description, "Discord: https://discord.gg/vdft");
        assertEq(profile.memberCount, 1);
        assertEq(uint8(leaderMembership.role), uint8(VeydriftAllianceSystem.AllianceRole.Owner));
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

    function testAllianceDirectoryJoinRequestsAndProfileUpdates() public {
        vm.prank(leader);
        uint256 allianceId =
            alliances.createAlliance("VDFT", "Veydrift Union", "Discord: https://discord.gg/vdft");
        vm.prank(enemy);
        uint256 enemyAllianceId = alliances.createAlliance("RIVL", "Rivals", "Rival charter");

        uint256[] memory ids = alliances.allianceIds();
        assertEq(ids.length, 2);
        assertEq(ids[0], allianceId);
        assertEq(ids[1], enemyAllianceId);

        vm.prank(leader);
        alliances.updateAllianceProfile(allianceId, "VDF", "Veydrift Directorate", "Line 1\nLine 2");
        VeydriftAllianceSystem.Alliance memory profile = alliances.allianceProfile(allianceId);
        assertEq(profile.tag, "VDF");
        assertEq(profile.name, "Veydrift Directorate");
        assertEq(profile.description, "Line 1\nLine 2");

        vm.prank(recruit);
        alliances.requestJoinAlliance(allianceId);
        VeydriftAllianceSystem.JoinRequest memory request =
            alliances.allianceJoinRequest(recruit, allianceId);
        assertEq(request.active, true);
        assertEq(request.requester, recruit);
        assertEq(alliances.allianceJoinRequests(allianceId).length, 1);
        assertEq(alliances.allianceJoinRequests(allianceId)[0], recruit);

        vm.prank(member);
        vm.expectRevert();
        alliances.approveJoinRequest(allianceId, recruit);

        vm.prank(leader);
        alliances.approveJoinRequest(allianceId, recruit);
        VeydriftAllianceSystem.Membership memory recruitMembership = alliances.allianceOf(recruit);
        assertEq(uint8(recruitMembership.role), uint8(VeydriftAllianceSystem.AllianceRole.Member));
        assertEq(alliances.allianceJoinRequests(allianceId).length, 0);

        vm.prank(member);
        alliances.requestJoinAlliance(enemyAllianceId);
        vm.prank(member);
        alliances.cancelJoinRequest(enemyAllianceId);
        assertEq(alliances.allianceJoinRequests(enemyAllianceId).length, 0);
    }

    function testProxyInitializationImportsAllianceRosterAndDiplomacy() public {
        VeydriftAllianceSystem proxied = VeydriftAllianceSystem(
            address(
                new ERC1967Proxy(
                    address(new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)))),
                    abi.encodeCall(
                        VeydriftAllianceSystem.initialize,
                        (IVeydriftAllianceGame(address(game)), admin)
                    )
                )
            )
        );

        assertEq(proxied.owner(), admin);
        assertEq(address(proxied.game()), address(game));
        assertEq(proxied.nextAllianceId(), 1);
        assertEq(proxied.nextDefenseIntentId(), 1);

        address[] memory eggsMembers = new address[](2);
        eggsMembers[0] = leader;
        eggsMembers[1] = member;
        VeydriftAllianceSystem.AllianceRole[] memory eggsRoles =
            new VeydriftAllianceSystem.AllianceRole[](2);
        eggsRoles[0] = VeydriftAllianceSystem.AllianceRole.Owner;
        eggsRoles[1] = VeydriftAllianceSystem.AllianceRole.Officer;
        uint64[] memory eggsJoinedAt = new uint64[](2);
        eggsJoinedAt[0] = 1_700_000_001;
        eggsJoinedAt[1] = 1_700_000_002;

        vm.prank(admin);
        proxied.importAllianceSnapshot(
            7,
            VeydriftAllianceSystem.Alliance({
                active: true,
                tag: "EGGS",
                name: "Eggs Alliance",
                description: "$EGGS testnet roster",
                owner: leader,
                createdAt: 1_700_000_000,
                memberCount: 2
            }),
            eggsMembers,
            eggsRoles,
            eggsJoinedAt
        );

        address[] memory rivalMembers = new address[](1);
        rivalMembers[0] = enemy;
        VeydriftAllianceSystem.AllianceRole[] memory rivalRoles =
            new VeydriftAllianceSystem.AllianceRole[](1);
        rivalRoles[0] = VeydriftAllianceSystem.AllianceRole.Owner;
        uint64[] memory rivalJoinedAt = new uint64[](1);
        rivalJoinedAt[0] = 1_700_000_003;

        vm.prank(admin);
        proxied.importAllianceSnapshot(
            8,
            VeydriftAllianceSystem.Alliance({
                active: true,
                tag: "RIVL",
                name: "Rivals",
                description: "War target",
                owner: enemy,
                createdAt: 1_700_000_003,
                memberCount: 1
            }),
            rivalMembers,
            rivalRoles,
            rivalJoinedAt
        );

        vm.prank(admin);
        proxied.importDiplomacy(7, 8, VeydriftAllianceSystem.DiplomacyStatus.War);

        VeydriftAllianceSystem.Alliance memory eggs = proxied.allianceProfile(7);
        VeydriftAllianceSystem.Membership memory leaderMembership = proxied.allianceOf(leader);
        VeydriftAllianceSystem.Membership memory memberMembership = proxied.allianceOf(member);
        assertEq(eggs.tag, "EGGS");
        assertEq(eggs.memberCount, 2);
        assertEq(proxied.nextAllianceId(), 9);
        assertEq(uint8(leaderMembership.role), uint8(VeydriftAllianceSystem.AllianceRole.Owner));
        assertEq(leaderMembership.joinedAt, 1_700_000_001);
        assertEq(uint8(memberMembership.role), uint8(VeydriftAllianceSystem.AllianceRole.Officer));
        assertEq(memberMembership.joinedAt, 1_700_000_002);
        assertEq(proxied.allianceMembers(7).length, 2);
        assertEq(
            uint8(proxied.diplomacyStatus(7, 8)), uint8(VeydriftAllianceSystem.DiplomacyStatus.War)
        );
        assertEq(
            uint8(proxied.diplomacyStatus(8, 7)), uint8(VeydriftAllianceSystem.DiplomacyStatus.War)
        );
    }

    function testJoinRequestApprovalRevertReasonsForStaleAndIneligibleApplicants() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");

        vm.prank(enemy);
        uint256 enemyAllianceId = alliances.createAlliance("RIVL", "Rivals", "");

        vm.prank(recruit);
        alliances.requestJoinAlliance(allianceId);

        vm.prank(leader);
        alliances.approveJoinRequest(allianceId, recruit);
        VeydriftAllianceSystem.Membership memory recruitMembership = alliances.allianceOf(recruit);
        assertEq(uint8(recruitMembership.role), uint8(VeydriftAllianceSystem.AllianceRole.Member));

        vm.prank(leader);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.InvalidJoinRequest.selector, recruit, allianceId
            )
        );
        alliances.approveJoinRequest(allianceId, recruit);

        vm.prank(member);
        alliances.requestJoinAlliance(allianceId);

        vm.prank(member);
        alliances.cancelJoinRequest(allianceId);

        vm.prank(leader);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.InvalidJoinRequest.selector, member, allianceId
            )
        );
        alliances.approveJoinRequest(allianceId, member);

        vm.prank(member);
        alliances.requestJoinAlliance(allianceId);

        vm.prank(enemy);
        alliances.inviteMember(enemyAllianceId, member);
        vm.prank(member);
        alliances.acceptInvite(enemyAllianceId);

        vm.prank(leader);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.AlreadyInAlliance.selector, member, enemyAllianceId
            )
        );
        alliances.approveJoinRequest(allianceId, member);

        vm.prank(enemy);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftAllianceSystem.NotAuthorized.selector, enemy, allianceId)
        );
        alliances.approveJoinRequest(allianceId, member);
    }

    function testOfficerCanDismissStaleJoinRequest() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");

        vm.prank(enemy);
        uint256 enemyAllianceId = alliances.createAlliance("RIVL", "Rivals", "");

        _inviteAndAccept(allianceId, member);
        vm.prank(leader);
        alliances.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Officer);

        vm.prank(recruit);
        alliances.requestJoinAlliance(allianceId);
        assertEq(alliances.allianceJoinRequests(allianceId).length, 1);

        vm.prank(enemy);
        alliances.inviteMember(enemyAllianceId, recruit);
        vm.prank(recruit);
        alliances.acceptInvite(enemyAllianceId);

        vm.prank(member);
        alliances.dismissJoinRequest(allianceId, recruit);

        assertEq(alliances.allianceJoinRequests(allianceId).length, 0);
        VeydriftAllianceSystem.JoinRequest memory request =
            alliances.allianceJoinRequest(recruit, allianceId);
        assertEq(request.active, false);

        vm.prank(leader);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.InvalidJoinRequest.selector, recruit, allianceId
            )
        );
        alliances.approveJoinRequest(allianceId, recruit);
    }

    function testJoinRequestDismissalRequiresOfficer() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");

        vm.prank(recruit);
        alliances.requestJoinAlliance(allianceId);

        vm.prank(enemy);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftAllianceSystem.NotAuthorized.selector, enemy, allianceId)
        );
        alliances.dismissJoinRequest(allianceId, recruit);

        vm.prank(leader);
        alliances.dismissJoinRequest(allianceId, recruit);
        assertEq(alliances.allianceJoinRequests(allianceId).length, 0);
    }

    function testOwnerOfficerMemberPermissionBoundaries() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "discord.gg/vdft");

        vm.prank(member);
        vm.expectRevert();
        alliances.inviteMember(allianceId, enemy);

        _inviteAndAccept(allianceId, member);
        _inviteAndAccept(allianceId, enemy);

        vm.prank(leader);
        alliances.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Officer);

        vm.prank(member);
        vm.expectRevert();
        alliances.updateAllianceProfile(allianceId, "BAD", "Bad Update", "");

        vm.prank(member);
        alliances.inviteMember(allianceId, recruit);
        vm.prank(recruit);
        alliances.acceptInvite(allianceId);

        vm.prank(member);
        alliances.kickMember(allianceId, recruit);
        assertEq(
            uint8(alliances.allianceOf(recruit).role),
            uint8(VeydriftAllianceSystem.AllianceRole.None)
        );

        vm.prank(leader);
        alliances.setMemberRole(allianceId, enemy, VeydriftAllianceSystem.AllianceRole.Officer);

        vm.prank(member);
        vm.expectRevert();
        alliances.kickMember(allianceId, enemy);

        vm.prank(member);
        vm.expectRevert();
        alliances.setMemberRole(allianceId, enemy, VeydriftAllianceSystem.AllianceRole.Member);

        vm.prank(leader);
        vm.expectRevert();
        alliances.setMemberRole(allianceId, leader, VeydriftAllianceSystem.AllianceRole.Member);

        vm.prank(leader);
        vm.expectRevert();
        alliances.setMemberRole(allianceId, enemy, VeydriftAllianceSystem.AllianceRole.Owner);

        vm.prank(leader);
        alliances.setMemberRole(allianceId, enemy, VeydriftAllianceSystem.AllianceRole.Member);
        assertEq(
            uint8(alliances.allianceOf(enemy).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Member)
        );

        vm.prank(member);
        alliances.kickMember(allianceId, enemy);
        assertEq(
            uint8(alliances.allianceOf(enemy).role), uint8(VeydriftAllianceSystem.AllianceRole.None)
        );
    }

    function testOwnerCanBatchUpdateMemberRoles() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");
        _inviteAndAccept(allianceId, member);
        _inviteAndAccept(allianceId, enemy);
        _inviteAndAccept(allianceId, recruit);

        address[] memory officers = new address[](2);
        officers[0] = member;
        officers[1] = enemy;

        vm.prank(leader);
        alliances.setMembersRole(allianceId, officers, VeydriftAllianceSystem.AllianceRole.Officer);

        assertEq(
            uint8(alliances.allianceOf(member).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Officer)
        );
        assertEq(
            uint8(alliances.allianceOf(enemy).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Officer)
        );
        assertEq(
            uint8(alliances.allianceOf(recruit).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Member)
        );

        address[] memory members = new address[](1);
        members[0] = member;

        vm.prank(leader);
        alliances.setMembersRole(allianceId, members, VeydriftAllianceSystem.AllianceRole.Member);

        assertEq(
            uint8(alliances.allianceOf(member).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Member)
        );
    }

    function testBatchRoleUpdatePreservesOwnerProtection() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");
        _inviteAndAccept(allianceId, member);

        address[] memory targets = new address[](2);
        targets[0] = member;
        targets[1] = leader;

        vm.prank(leader);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.NotAuthorized.selector, leader, allianceId
            )
        );
        alliances.setMembersRole(allianceId, targets, VeydriftAllianceSystem.AllianceRole.Officer);

        assertEq(
            uint8(alliances.allianceOf(member).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Member)
        );
        assertEq(
            uint8(alliances.allianceOf(leader).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Owner)
        );
    }

    function testOfficerCanBatchKickMembers() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");
        _inviteAndAccept(allianceId, member);
        _inviteAndAccept(allianceId, enemy);
        _inviteAndAccept(allianceId, recruit);

        vm.prank(leader);
        alliances.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Officer);

        address[] memory targets = new address[](2);
        targets[0] = enemy;
        targets[1] = recruit;

        vm.prank(member);
        alliances.kickMembers(allianceId, targets);

        assertEq(
            uint8(alliances.allianceOf(enemy).role), uint8(VeydriftAllianceSystem.AllianceRole.None)
        );
        assertEq(
            uint8(alliances.allianceOf(recruit).role),
            uint8(VeydriftAllianceSystem.AllianceRole.None)
        );
        assertEq(alliances.allianceProfile(allianceId).memberCount, 2);
    }

    function testBatchKickIsAtomicWhenTargetCannotBeRemoved() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");
        _inviteAndAccept(allianceId, member);
        _inviteAndAccept(allianceId, enemy);
        _inviteAndAccept(allianceId, recruit);

        vm.startPrank(leader);
        alliances.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Officer);
        alliances.setMemberRole(allianceId, enemy, VeydriftAllianceSystem.AllianceRole.Officer);
        vm.stopPrank();

        address[] memory targets = new address[](2);
        targets[0] = recruit;
        targets[1] = enemy;

        vm.prank(member);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.NotAuthorized.selector, member, allianceId
            )
        );
        alliances.kickMembers(allianceId, targets);

        assertEq(
            uint8(alliances.allianceOf(recruit).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Member)
        );
        assertEq(
            uint8(alliances.allianceOf(enemy).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Officer)
        );
        assertEq(alliances.allianceProfile(allianceId).memberCount, 4);
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

    function testOnlyOwnerCanDeclareWarAndOfficerCanEndWar() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("ALLY", "Alliance", "");
        _inviteAndAccept(allianceId, member);

        vm.prank(enemy);
        uint256 enemyAllianceId = alliances.createAlliance("WAR", "War Target", "");

        vm.prank(leader);
        alliances.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Officer);

        vm.prank(member);
        vm.expectRevert();
        alliances.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );

        vm.prank(leader);
        alliances.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Member);
        vm.prank(member);
        vm.expectRevert();
        alliances.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );

        vm.prank(enemy);
        vm.expectRevert();
        alliances.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );

        vm.expectEmit(true, true, false, true);
        emit VeydriftAllianceSystem.AllianceDiplomacyUpdated(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );
        vm.prank(leader);
        alliances.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );
        assertEq(
            uint8(alliances.diplomacyStatus(allianceId, enemyAllianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.War)
        );
        assertEq(
            uint8(alliances.diplomacyStatus(enemyAllianceId, allianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.War)
        );

        vm.prank(member);
        vm.expectRevert();
        alliances.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.None
        );

        vm.prank(leader);
        alliances.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Officer);
        vm.expectEmit(true, true, false, true);
        emit VeydriftAllianceSystem.AllianceDiplomacyUpdated(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.None
        );
        vm.prank(member);
        alliances.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.None
        );
        assertEq(
            uint8(alliances.diplomacyStatus(allianceId, enemyAllianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.None)
        );
    }

    function testTransferAllianceOwnershipPromotesOfficer() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");

        _inviteAndAccept(allianceId, member);
        vm.prank(leader);
        alliances.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Officer);

        vm.expectEmit(true, true, true, true);
        emit VeydriftAllianceSystem.AllianceOwnershipTransferred(allianceId, leader, member);
        vm.prank(leader);
        alliances.transferAllianceOwnership(allianceId, member);

        assertEq(alliances.allianceProfile(allianceId).owner, member);
        assertEq(
            uint8(alliances.allianceOf(member).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Owner)
        );
        assertEq(
            uint8(alliances.allianceOf(leader).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Officer)
        );

        // The new owner can now manage roles; the former owner can no longer.
        vm.prank(leader);
        vm.expectRevert();
        alliances.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Member);

        vm.prank(member);
        alliances.setMemberRole(allianceId, leader, VeydriftAllianceSystem.AllianceRole.Member);
        assertEq(
            uint8(alliances.allianceOf(leader).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Member)
        );
    }

    function testTransferAllianceOwnershipRejectsInvalidTargets() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");

        _inviteAndAccept(allianceId, member);

        // Officers cannot transfer ownership.
        vm.prank(leader);
        alliances.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Officer);
        vm.prank(member);
        vm.expectRevert();
        alliances.transferAllianceOwnership(allianceId, leader);

        // Owner cannot transfer to themselves.
        vm.prank(leader);
        vm.expectRevert();
        alliances.transferAllianceOwnership(allianceId, leader);

        // Target must be a member of this alliance.
        vm.prank(leader);
        vm.expectRevert();
        alliances.transferAllianceOwnership(allianceId, enemy);

        // Target must be an officer, not a plain member.
        _inviteAndAccept(allianceId, recruit);
        vm.prank(leader);
        vm.expectRevert();
        alliances.transferAllianceOwnership(allianceId, recruit);
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
        _setShipCount(enemyPlanetId, Ship.SmallCargo, 1);
        _setResources(enemyPlanetId, 500, 500, 10_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

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

    function testTransferAllianceOwnershipHandsOwnerToOfficer() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "discord.gg/vdft");
        _inviteAndAccept(allianceId, member);
        vm.prank(leader);
        alliances.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Officer);

        vm.expectEmit(true, true, true, true, address(alliances));
        emit VeydriftAllianceSystem.AllianceOwnershipTransferred(allianceId, leader, member);
        vm.prank(leader);
        alliances.transferAllianceOwnership(allianceId, member);

        assertEq(alliances.allianceProfile(allianceId).owner, member);
        assertEq(
            uint8(alliances.allianceOf(member).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Owner)
        );
        assertEq(
            uint8(alliances.allianceOf(leader).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Officer)
        );
        assertEq(alliances.allianceProfile(allianceId).memberCount, 2);

        // The new owner now holds owner-only authority; the demoted owner does not.
        vm.prank(member);
        alliances.setMemberRole(allianceId, leader, VeydriftAllianceSystem.AllianceRole.Member);
        assertEq(
            uint8(alliances.allianceOf(leader).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Member)
        );

        vm.prank(leader);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.NotAuthorized.selector, leader, allianceId
            )
        );
        alliances.transferAllianceOwnership(allianceId, member);
    }

    function testTransferAllianceOwnershipRejectsInvalidHandoffs() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");
        _inviteAndAccept(allianceId, member);

        // Officers and members cannot initiate the handoff.
        vm.prank(member);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.NotAuthorized.selector, member, allianceId
            )
        );
        alliances.transferAllianceOwnership(allianceId, leader);

        // The target must already be a member of the alliance.
        vm.prank(leader);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.NotAllianceMember.selector, recruit, allianceId
            )
        );
        alliances.transferAllianceOwnership(allianceId, recruit);

        // A plain member (not an officer) cannot receive ownership.
        vm.prank(leader);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.NewOwnerMustBeOfficer.selector, member, allianceId
            )
        );
        alliances.transferAllianceOwnership(allianceId, member);

        // Transferring to the current owner (self) is rejected.
        vm.prank(leader);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.NotAuthorized.selector, leader, allianceId
            )
        );
        alliances.transferAllianceOwnership(allianceId, leader);

        // Zero address is not a member, so it is rejected as well.
        vm.prank(leader);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.NotAllianceMember.selector, address(0), allianceId
            )
        );
        alliances.transferAllianceOwnership(allianceId, address(0));
    }

    function testUupsUpgradePreservesStateAndEnablesOwnershipHandoff() public {
        VeydriftAllianceSystem proxied = VeydriftAllianceSystem(
            address(
                new ERC1967Proxy(
                    address(new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)))),
                    abi.encodeCall(
                        VeydriftAllianceSystem.initialize,
                        (IVeydriftAllianceGame(address(game)), admin)
                    )
                )
            )
        );

        vm.prank(leader);
        uint256 allianceId = proxied.createAlliance("VDFT", "Veydrift Union", "discord.gg/vdft");
        vm.prank(leader);
        proxied.inviteMember(allianceId, member);
        vm.prank(member);
        proxied.acceptInvite(allianceId);
        vm.prank(leader);
        proxied.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Officer);

        // Upgrade the proxy to a fresh implementation. Storage must survive.
        VeydriftAllianceSystemV2 newImplementation =
            new VeydriftAllianceSystemV2(IVeydriftAllianceGame(address(game)));
        vm.prank(admin);
        proxied.upgradeToAndCall(address(newImplementation), "");

        assertEq(VeydriftAllianceSystemV2(address(proxied)).upgradeVersion(), "v2");
        assertEq(proxied.owner(), admin);
        assertEq(proxied.allianceProfile(allianceId).owner, leader);
        assertEq(proxied.allianceProfile(allianceId).memberCount, 2);
        assertEq(
            uint8(proxied.allianceOf(member).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Officer)
        );

        // The newly upgraded implementation exposes the ownership handoff.
        vm.prank(leader);
        proxied.transferAllianceOwnership(allianceId, member);

        assertEq(proxied.allianceProfile(allianceId).owner, member);
        assertEq(
            uint8(proxied.allianceOf(member).role), uint8(VeydriftAllianceSystem.AllianceRole.Owner)
        );
        assertEq(
            uint8(proxied.allianceOf(leader).role),
            uint8(VeydriftAllianceSystem.AllianceRole.Officer)
        );
    }

    function testUpgradeAuthorizationRemainsOwnerGated() public {
        VeydriftAllianceSystem proxied = VeydriftAllianceSystem(
            address(
                new ERC1967Proxy(
                    address(new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)))),
                    abi.encodeCall(
                        VeydriftAllianceSystem.initialize,
                        (IVeydriftAllianceGame(address(game)), admin)
                    )
                )
            )
        );
        VeydriftAllianceSystemV2 newImplementation =
            new VeydriftAllianceSystemV2(IVeydriftAllianceGame(address(game)));

        vm.prank(leader);
        vm.expectRevert(abi.encodeWithSelector(VeydriftAllianceSystem.NotOwner.selector, leader));
        proxied.upgradeToAndCall(address(newImplementation), "");
    }

    function _start(address player) internal {
        vm.prank(player);
        game.startPlanet{value: 0.05 ether}();
    }

    function _inviteAndAccept(uint256 allianceId, address player) internal {
        vm.prank(leader);
        alliances.inviteMember(allianceId, player);
        vm.prank(player);
        alliances.acceptInvite(allianceId);
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
