// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftAllianceWarProtection} from "../src/VeydriftAllianceWarProtection.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftShipProductionModule} from "../src/VeydriftShipProductionModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftFirstPlanetSettlementModule} from "../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {
    IVeydriftPaidInviteAlliance,
    VeydriftPaidAllianceInvites
} from "../src/VeydriftPaidAllianceInvites.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {Building, Resource, Ship} from "../src/libraries/VeydriftTypes.sol";

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

/// @dev Test-only implementation that models diplomacy state already present on
/// the live proxy before a corrective implementation is installed.
contract VeydriftAllianceSystemStateHarness is VeydriftAllianceSystem {
    constructor(IVeydriftAllianceGame gameContract) VeydriftAllianceSystem(gameContract) {}

    function seedDiplomacyDirection(
        uint256 allianceId,
        uint256 otherAllianceId,
        DiplomacyStatus status
    ) external {
        _diplomacy[allianceId][otherAllianceId] = status;
    }

    function seedWarStartedAt(uint256 allianceId, uint256 otherAllianceId, uint64 startedAt)
        external
    {
        _warStartedAts[allianceId][otherAllianceId] = startedAt;
    }

    function storedWarStartedAt(uint256 allianceId, uint256 otherAllianceId)
        external
        view
        returns (uint64)
    {
        return _warStartedAts[allianceId][otherAllianceId];
    }

    function storedWarDeclarer(uint256 allianceId, uint256 otherAllianceId)
        external
        view
        returns (uint256)
    {
        return _warDeclarers[allianceId][otherAllianceId];
    }
}

contract VeydriftAllianceSystemTest is Test {
    address internal admin = address(0xA11CE);
    address internal leader = address(0xB0B);
    address internal member = address(0xCAFE);
    address internal enemy = address(0xE11A);
    address internal recruit = address(0xBEEF);
    address internal fulfiller = address(0xF17F);
    address internal newCommander = address(0x818);
    uint256 internal inviteSignerKey = 0x818818;

    VeydriftGame internal game;
    VeydriftAllianceSystem internal alliances;
    VeydriftAllianceWarProtection internal warProtection;
    VeydriftPaidAllianceInvites internal paidInvites;
    AllianceMockResourceToken internal metalToken;
    AllianceMockResourceToken internal crystalToken;
    AllianceMockResourceToken internal deuteriumToken;

    function setUp() public {
        VeydriftCombatModule combatModule =
            new VeydriftCombatModule(address(new VeydriftCombatRapidfire()));
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftAttackProtectionModule attackProtectionModule = new VeydriftAttackProtectionModule();
        VeydriftColonizationModule colonizationModule =
            new VeydriftColonizationModule(address(new VeydriftShipProductionModule()));
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();
        VeydriftStateMigrationModule stateMigrationModule =
            new VeydriftStateMigrationModule(address(0xBEEF));
        VeydriftFirstPlanetSettlementModule firstPlanetSettlementModule =
            new VeydriftFirstPlanetSettlementModule(address(0xBEEF));
        game = new VeydriftGame(
            admin,
            address(firstPlanetSettlementModule),
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule),
            address(defenseHoldModule),
            address(stateMigrationModule)
        );
        RandomnessEngine randomness = new RandomnessEngine(admin, fulfiller);
        vm.prank(admin);
        randomness.setPrecommitRequired(false);
        alliances = new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)));
        warProtection = new VeydriftAllianceWarProtection(address(alliances), address(game));
        paidInvites = new VeydriftPaidAllianceInvites(
            IVeydriftPaidInviteAlliance(address(alliances)), admin, vm.addr(inviteSignerKey)
        );
        metalToken = new AllianceMockResourceToken();
        crystalToken = new AllianceMockResourceToken();
        deuteriumToken = new AllianceMockResourceToken();
        _fundGameReserves(1_000_000_000);
        alliances.setPaidInviteSystem(address(paidInvites));
        alliances.setWarProtection(address(warProtection));
        vm.startPrank(admin);
        game.setAllianceSystem(address(alliances));
        game.setRandomnessEngine(address(randomness));
        randomness.setRequesterAuthorization(address(game), true);
        vm.stopPrank();
        vm.deal(leader, 1 ether);
        vm.deal(member, 1 ether);
        vm.deal(enemy, 1 ether);
        vm.deal(recruit, 1 ether);
        vm.deal(newCommander, 1 ether);
        _start(leader);
        _start(member);
        _start(enemy);
        _start(recruit);
    }

    function testPaidInviteChargesSeparateSettlementAutoJoinsAndReusesStarterBonus() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");
        bytes32 secret = keccak256("high entropy secret kept in private link");
        bytes32 commitment = keccak256(abi.encode(secret));
        uint256 price = paidInvites.INVITE_PRICE();
        uint256 gameFeeBalanceBefore = address(game).balance;

        vm.prank(leader);
        paidInvites.buy{value: price}(commitment);
        VeydriftPaidAllianceInvites.PaidInvite memory purchased = paidInvites.invite(commitment);
        assertEq(purchased.allianceId, allianceId);
        assertEq(purchased.settlementPrice, price);
        assertEq(address(paidInvites).balance, 0);
        assertEq(address(game).balance, gameFeeBalanceBefore + price, "fee enters game treasury");

        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        (uint8 v, bytes32 r, bytes32 s) = _signPaidInvite(commitment, newCommander, expiresAt);
        uint256 settlementPrice = game.startPrice();
        vm.prank(newCommander);
        uint256 planetId = game.startPlanetWithAllianceInvite{value: settlementPrice}(
            commitment, expiresAt, v, r, s
        );
        assertEq(
            address(game).balance,
            gameFeeBalanceBefore + price + settlementPrice,
            "invite and settlement payments are independent"
        );

        assertEq(game.homePlanetOf(newCommander), planetId);
        VeydriftAllianceSystem.Membership memory membership = alliances.allianceOf(newCommander);
        assertEq(membership.allianceId, allianceId);
        assertEq(uint8(membership.role), uint8(VeydriftAllianceSystem.AllianceRole.Member));
        VeydriftGameStorage.Planet memory planet = game.planet(planetId);
        assertEq(planet.resources.metal, 1_000, "must reuse referral starter bonus");
        assertEq(planet.resources.crystal, 1_000, "must reuse referral starter bonus");

        vm.prank(newCommander);
        vm.expectRevert();
        game.startPlanetWithAllianceInvite{value: settlementPrice}(commitment, expiresAt, v, r, s);
    }

    function testPaidInviteAuthorizationIsRecipientBoundExpiringAndSingleUse() public {
        vm.prank(leader);
        alliances.createAlliance("VDFT", "Veydrift Union", "");
        bytes32 commitment = keccak256("private-link-2");
        uint256 price = paidInvites.INVITE_PRICE();
        vm.prank(leader);
        paidInvites.buy{value: price}(commitment);
        uint64 expiresAt = uint64(block.timestamp + 5 minutes);
        (uint8 v, bytes32 r, bytes32 s) = _signPaidInvite(commitment, newCommander, expiresAt);

        address frontRunner = address(0xF00D);
        vm.deal(frontRunner, 1 ether);
        uint256 settlementPrice = game.startPrice();
        vm.expectRevert(VeydriftPaidAllianceInvites.InvalidAuthorization.selector);
        vm.prank(frontRunner);
        game.startPlanetWithAllianceInvite{value: settlementPrice}(commitment, expiresAt, v, r, s);

        vm.warp(expiresAt);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftPaidAllianceInvites.InvalidAuthorizationExpiry.selector, expiresAt
            )
        );
        vm.prank(newCommander);
        game.startPlanetWithAllianceInvite{value: settlementPrice}(commitment, expiresAt, v, r, s);
    }

    function testPaidInviteRemainsRedeemableUntilUsed() public {
        vm.prank(leader);
        alliances.createAlliance("VDFT", "Veydrift Union", "");
        bytes32 commitment = keccak256("private-link-without-invite-expiry");
        uint256 price = paidInvites.INVITE_PRICE();
        vm.prank(leader);
        paidInvites.buy{value: price}(commitment);

        vm.warp(block.timestamp + 366 days);
        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        (uint8 v, bytes32 r, bytes32 s) = _signPaidInvite(commitment, newCommander, expiresAt);
        uint256 settlementPrice = game.startPrice();
        vm.prank(newCommander);
        game.startPlanetWithAllianceInvite{value: settlementPrice}(commitment, expiresAt, v, r, s);
        assertTrue(paidInvites.invite(commitment).redeemed);
    }

    function testAnyCurrentMemberCanBuyButNonMembersCannot() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");
        _inviteAndAccept(allianceId, member);
        uint256 price = paidInvites.INVITE_PRICE();

        bytes32 memberCommitment = keccak256("member-paid-invite");
        vm.prank(member);
        paidInvites.buy{value: price}(memberCommitment);
        assertEq(paidInvites.invite(memberCommitment).purchaser, member);

        vm.prank(address(0xF00D));
        vm.expectRevert();
        paidInvites.buy{value: price}(keccak256("outsider-paid-invite"));
    }

    function testCanonicalProductionBonusCutsLeaveAndRejoinBoundariesAcrossOwnedPlanets() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");
        bytes32 commitment = keccak256("private-link-3");
        uint256 price = paidInvites.INVITE_PRICE();
        vm.prank(leader);
        paidInvites.buy{value: price}(commitment);
        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        (uint8 v, bytes32 r, bytes32 s) = _signPaidInvite(commitment, newCommander, expiresAt);
        uint256 settlementPrice = game.startPrice();
        vm.prank(newCommander);
        uint256 homePlanetId = game.startPlanetWithAllianceInvite{value: settlementPrice}(
            commitment, expiresAt, v, r, s
        );
        _enableMetalProduction(homePlanetId);
        uint256 colonyPlanetId = 10_818;
        _cloneOwnedPlanet(newCommander, homePlanetId, colonyPlanetId);
        _enableMetalProduction(colonyPlanetId);

        VeydriftGameStorage.Resources memory homeBefore = game.planet(homePlanetId).resources;
        VeydriftGameStorage.Resources memory colonyBefore = game.planet(colonyPlanetId).resources;
        vm.warp(vm.getBlockTimestamp() + 10 hours);

        vm.prank(newCommander);
        alliances.leaveAlliance();
        VeydriftGameStorage.Resources memory homeAfterLeave = game.planet(homePlanetId).resources;
        VeydriftGameStorage.Resources memory colonyAfterLeave =
        game.planet(colonyPlanetId).resources;
        VeydriftGameStorage.Resources memory balanceAfterLeave =
            paidInvites.bonusBalance(allianceId);
        assertGt(homeAfterLeave.metal, homeBefore.metal, "leave must settle the home planet");
        assertGt(colonyAfterLeave.metal, colonyBefore.metal, "leave must settle every owned planet");
        uint256 eligibleMetal = uint256(homeAfterLeave.metal - homeBefore.metal)
            + uint256(colonyAfterLeave.metal - colonyBefore.metal);
        assertEq(
            balanceAfterLeave.metal,
            eligibleMetal * paidInvites.PRODUCTION_BONUS_BPS() / 10_000,
            "pre-leave production must receive the exact canonical 2%"
        );

        vm.warp(vm.getBlockTimestamp() + 10 hours);
        vm.prank(leader);
        alliances.inviteMember(allianceId, newCommander);
        vm.prank(newCommander);
        alliances.acceptInvite(allianceId);
        VeydriftGameStorage.Resources memory homeAfterRejoin = game.planet(homePlanetId).resources;
        VeydriftGameStorage.Resources memory colonyAfterRejoin =
        game.planet(colonyPlanetId).resources;
        assertGt(homeAfterRejoin.metal, homeAfterLeave.metal, "away production stays with player");
        assertGt(
            colonyAfterRejoin.metal,
            colonyAfterLeave.metal,
            "away production on every planet stays with player"
        );
        assertEq(
            paidInvites.bonusBalance(allianceId).metal,
            balanceAfterLeave.metal,
            "production while away must not be credited after rejoin"
        );

        vm.warp(vm.getBlockTimestamp() + 10 hours);
        vm.prank(newCommander);
        game.collectResources(homePlanetId);
        vm.prank(newCommander);
        game.collectResources(colonyPlanetId);
        VeydriftGameStorage.Resources memory balanceAfterResume =
            paidInvites.bonusBalance(allianceId);
        VeydriftGameStorage.Resources memory homeAfterResume = game.planet(homePlanetId).resources;
        VeydriftGameStorage.Resources memory colonyAfterResume =
        game.planet(colonyPlanetId).resources;
        uint256 resumedMetal = uint256(homeAfterResume.metal - homeAfterRejoin.metal)
            + uint256(colonyAfterResume.metal - colonyAfterRejoin.metal);
        assertEq(
            balanceAfterResume.metal,
            (eligibleMetal + resumedMetal) * paidInvites.PRODUCTION_BONUS_BPS() / 10_000,
            "same issuing-alliance rejoin must resume exact canonical 2% credit"
        );
    }

    function testKickCutsCanonicalProductionBeforeSameAllianceRejoin() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");
        uint256 planetId = _startPaidInvitee(allianceId, keccak256("kick-boundary"));
        _enableMetalProduction(planetId);

        vm.warp(vm.getBlockTimestamp() + 10 hours);
        vm.prank(leader);
        alliances.kickMember(allianceId, newCommander);
        uint128 balanceAfterKick = paidInvites.bonusBalance(allianceId).metal;
        assertGt(balanceAfterKick, 0, "kick must credit eligible production first");

        vm.warp(vm.getBlockTimestamp() + 10 hours);
        vm.prank(leader);
        alliances.inviteMember(allianceId, newCommander);
        vm.prank(newCommander);
        alliances.acceptInvite(allianceId);
        assertEq(
            paidInvites.bonusBalance(allianceId).metal,
            balanceAfterKick,
            "production while kicked must not be credited"
        );

        vm.warp(vm.getBlockTimestamp() + 10 hours);
        vm.prank(newCommander);
        game.collectResources(planetId);
        assertGt(
            paidInvites.bonusBalance(allianceId).metal,
            balanceAfterKick,
            "credit must resume from the rejoin boundary"
        );
    }

    function testBonusReserveShortfallDefersWithoutRevertingPlayerSettlement() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");
        uint256 planetId = _startPaidInvitee(allianceId, keccak256("reserve-boundary"));
        _enableMetalProduction(planetId);

        VeydriftGameStorage.Resources memory beforeResources = game.planet(planetId).resources;
        vm.warp(vm.getBlockTimestamp() + 10 hours);
        VeydriftGameStorage.Resources memory preview = game.previewResources(planetId);
        VeydriftGameStorage.Resources memory required = game.resourceReserveRequirement();
        _setGameReserveBalances(
            required.metal + preview.metal - beforeResources.metal,
            required.crystal + preview.crystal - beforeResources.crystal,
            required.deuterium + preview.deuterium - beforeResources.deuterium
        );

        vm.prank(newCommander);
        game.collectResources(planetId);
        VeydriftGameStorage.Resources memory afterConstrainedSettlement =
        game.planet(planetId).resources;
        assertEq(afterConstrainedSettlement.metal, preview.metal, "player output must be unchanged");
        assertEq(
            paidInvites.bonusBalance(allianceId).metal,
            0,
            "unbacked bonus must not enter the withdrawable balance"
        );
        VeydriftGameStorage.Resources memory pending = paidInvites.pendingBonusBalance(allianceId);
        uint256 constrainedMetal = preview.metal - beforeResources.metal;
        assertEq(
            pending.metal,
            constrainedMetal * paidInvites.PRODUCTION_BONUS_BPS() / 10_000,
            "the exact 2% entitlement must be deferred, not discarded"
        );

        metalToken.mint(address(game), 10_000);
        crystalToken.mint(address(game), 10_000);
        deuteriumToken.mint(address(game), 10_000);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        VeydriftGameStorage.Resources memory secondPreview = game.previewResources(planetId);
        vm.prank(newCommander);
        game.collectResources(planetId);
        assertEq(
            paidInvites.pendingBonusBalance(allianceId).metal,
            0,
            "later reserve capacity must fund the deferred entitlement"
        );
        assertEq(
            paidInvites.bonusBalance(allianceId).metal,
            (constrainedMetal + secondPreview.metal - afterConstrainedSettlement.metal)
                * paidInvites.PRODUCTION_BONUS_BPS() / 10_000,
            "funded balance must include the exact deferred and current 2% production"
        );
    }

    function testOfficerCreditsCanonicalProductionBonusToOwnedPlanetBeforeRift() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("VDFT", "Veydrift Union", "");
        _inviteAndAccept(allianceId, member);
        vm.prank(leader);
        alliances.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Officer);

        bytes32 commitment = keccak256("private-link-4");
        uint256 price = paidInvites.INVITE_PRICE();
        vm.prank(leader);
        paidInvites.buy{value: price}(commitment);
        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        (uint8 v, bytes32 r, bytes32 s) = _signPaidInvite(commitment, newCommander, expiresAt);
        uint256 settlementPrice = game.startPrice();
        vm.prank(newCommander);
        uint256 planetId = game.startPlanetWithAllianceInvite{value: settlementPrice}(
            commitment, expiresAt, v, r, s
        );

        vm.prank(newCommander);
        game.startBuildingUpgrade(planetId, Building.SolarPlant);
        vm.warp(block.timestamp + 365 days);
        vm.prank(newCommander);
        game.collectResources(planetId);
        vm.prank(newCommander);
        game.startBuildingUpgrade(planetId, Building.MetalMine);
        vm.warp(block.timestamp + 365 days);
        vm.prank(newCommander);
        game.collectResources(planetId);
        vm.warp(block.timestamp + 100 hours);
        vm.prank(newCommander);
        game.collectResources(planetId);

        VeydriftGameStorage.Resources memory balance = paidInvites.bonusBalance(allianceId);
        assertGt(balance.metal, 0, "canonical settled mine output must accrue a 2% bonus");
        uint256 destinationPlanetId = game.homePlanetOf(member);
        VeydriftGameStorage.Resources memory destinationBefore =
        game.planet(destinationPlanetId).resources;
        uint256 walletTokenBalanceBefore = metalToken.balanceOf(member);
        uint256 leaderPlanetId = game.homePlanetOf(leader);
        vm.prank(member);
        vm.expectRevert();
        paidInvites.withdraw(allianceId, leaderPlanetId, balance);
        vm.prank(member);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.RiftStabilizerRequiredForPaidInviteWithdrawal.selector,
                destinationPlanetId
            )
        );
        paidInvites.withdraw(allianceId, destinationPlanetId, balance);
        _setBuildingLevel(destinationPlanetId, Building.InterdimensionalRiftStabilizer, 1);
        VeydriftGameStorage.Resources memory withdrawalAmount = VeydriftGameStorage.Resources({
            metal: balance.metal / 2, crystal: balance.crystal / 2, deuterium: balance.deuterium / 2
        });
        if (
            withdrawalAmount.metal == 0 && withdrawalAmount.crystal == 0
                && withdrawalAmount.deuterium == 0
        ) {
            withdrawalAmount.metal = balance.metal;
        }
        vm.prank(member);
        paidInvites.withdraw(allianceId, destinationPlanetId, withdrawalAmount);
        VeydriftGameStorage.Resources memory destinationAfter =
        game.planet(destinationPlanetId).resources;
        assertEq(destinationAfter.metal, destinationBefore.metal + withdrawalAmount.metal);
        assertEq(
            metalToken.balanceOf(member),
            walletTokenBalanceBefore,
            "treasury credit must not bypass ordinary Rift extraction"
        );
        VeydriftGameStorage.Resources memory afterBalance = paidInvites.bonusBalance(allianceId);
        assertEq(afterBalance.metal, balance.metal - withdrawalAmount.metal);
        assertEq(afterBalance.crystal, balance.crystal - withdrawalAmount.crystal);
        assertEq(afterBalance.deuterium, balance.deuterium - withdrawalAmount.deuterium);
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

        (
            attackerAllianceId,
            defenderAllianceId,,
            atWar,
            bashingWarException,
            scoreProtectionException
        ) = alliances.attackLimitAllianceContext(enemy, leader);
        assertEq(attackerAllianceId, enemyAllianceId);
        assertEq(defenderAllianceId, allianceId);
        assertTrue(atWar);
        assertTrue(bashingWarException);
        assertTrue(scoreProtectionException);
        assertEq(
            uint8(alliances.diplomacyStatus(enemyAllianceId, allianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.War)
        );
    }

    function testWarProtectionRequiresCorrectBindingAndAllianceWriter() public {
        VeydriftAllianceWarProtection misbound =
            new VeydriftAllianceWarProtection(address(0xBEEF), address(game));
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.InvalidWarProtectionModule.selector, address(misbound)
            )
        );
        alliances.setWarProtection(address(misbound));

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftAllianceWarProtection.NotAlliance.selector, address(this))
        );
        warProtection.capture(1, 2, uint64(block.timestamp));
    }

    function testWarSnapshotRestrictsLateAndRejoinedMembersAndProtectsOutmatchedDeclaree()
        public
    {
        vm.prank(leader);
        uint256 declarerAllianceId = alliances.createAlliance("ALLY", "Alliance", "");
        _inviteAndAccept(declarerAllianceId, member);
        vm.prank(enemy);
        uint256 declareeAllianceId = alliances.createAlliance("WAR", "War Target", "");

        // Every new commander starts at score 1,000. Twenty Deathstars raise the declarer's
        // snapshot above the 1.5x band, so it must not receive a score-protection bypass.
        _setShipCount(game.homePlanetOf(member), Ship.Deathstar, 20);
        vm.prank(leader);
        alliances.setDiplomacy(
            declarerAllianceId, declareeAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );

        VeydriftAllianceWarProtection.WarSnapshot memory snapshot =
            warProtection.warSnapshot(declarerAllianceId, declareeAllianceId);
        assertGt(snapshot.snapshotId, 0);
        assertEq(snapshot.declarerMemberCount, 2);
        assertEq(snapshot.declareeMemberCount, 1);
        assertTrue(warProtection.memberAtStart(declarerAllianceId, declareeAllianceId, member));

        (,,, bool atWar, bool bashingWarException, bool scoreProtectionException) =
            alliances.attackLimitAllianceContext(member, enemy);
        assertTrue(atWar);
        assertTrue(bashingWarException);
        assertFalse(scoreProtectionException, "outmatched declarer cannot bypass score protection");

        (,,,,, scoreProtectionException) = alliances.attackLimitAllianceContext(enemy, leader);
        assertTrue(scoreProtectionException, "declarer receives no score protection from declaree");

        _inviteAndAccept(declarerAllianceId, recruit);
        (,,, atWar, bashingWarException, scoreProtectionException) =
            alliances.attackLimitAllianceContext(recruit, enemy);
        assertTrue(atWar);
        assertFalse(bashingWarException, "late join gets no bashing exception");
        assertFalse(scoreProtectionException, "late join gets no score exception");

        vm.prank(member);
        alliances.leaveAlliance();
        _inviteAndAccept(declarerAllianceId, member);
        (,,, atWar, bashingWarException, scoreProtectionException) =
            alliances.attackLimitAllianceContext(member, enemy);
        assertTrue(atWar);
        assertFalse(bashingWarException, "rejoin cannot restore the original war privilege");
        assertFalse(scoreProtectionException, "rejoin cannot restore score exception");
    }

    function testWarCannotEndUntilFortyEightHoursAfterDeclaration() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("ALLY", "Alliance", "");
        _inviteAndAccept(allianceId, member);
        vm.prank(enemy);
        uint256 enemyAllianceId = alliances.createAlliance("WAR", "War Target", "");

        vm.prank(leader);
        alliances.setMemberRole(allianceId, member, VeydriftAllianceSystem.AllianceRole.Officer);

        uint64 declaredAt = uint64(block.timestamp);
        vm.prank(leader);
        alliances.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );
        assertEq(alliances.warStartedAt(allianceId, enemyAllianceId), declaredAt);
        assertEq(alliances.warStartedAt(enemyAllianceId, allianceId), declaredAt);
        assertEq(alliances.warDeclarer(allianceId, enemyAllianceId), allianceId);
        assertEq(alliances.warDeclarer(enemyAllianceId, allianceId), allianceId);

        uint64 minimumDuration = alliances.WAR_MINIMUM_DURATION();
        vm.prank(member);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.WarEndLocked.selector, declaredAt + minimumDuration
            )
        );
        alliances.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.None
        );

        vm.warp(declaredAt + minimumDuration - 1);
        vm.prank(member);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.WarEndLocked.selector, declaredAt + minimumDuration
            )
        );
        alliances.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.None
        );

        vm.warp(declaredAt + minimumDuration);
        vm.prank(member);
        alliances.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.None
        );
        assertEq(
            uint8(alliances.diplomacyStatus(allianceId, enemyAllianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.None)
        );
        assertEq(
            uint8(alliances.diplomacyStatus(enemyAllianceId, allianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.None)
        );
        assertEq(alliances.warStartedAt(allianceId, enemyAllianceId), 0);
        assertEq(alliances.warStartedAt(enemyAllianceId, allianceId), 0);
    }

    function testOnlyDeclaringAllianceCanEndWar() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("ALLY", "Alliance", "");
        vm.prank(enemy);
        uint256 enemyAllianceId = alliances.createAlliance("WAR", "War Target", "");

        vm.prank(leader);
        alliances.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );
        assertEq(alliances.warDeclarer(allianceId, enemyAllianceId), allianceId);
        assertEq(alliances.warDeclarer(enemyAllianceId, allianceId), allianceId);
        vm.warp(block.timestamp + alliances.WAR_MINIMUM_DURATION());

        vm.prank(enemy);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.NotAuthorized.selector, enemy, enemyAllianceId
            )
        );
        alliances.setDiplomacy(
            enemyAllianceId, allianceId, VeydriftAllianceSystem.DiplomacyStatus.None
        );
    }

    function testDeclaringWarClearsReciprocalTreatyState() public {
        vm.prank(leader);
        uint256 allianceId = alliances.createAlliance("ALLY", "Alliance", "");
        vm.prank(enemy);
        uint256 enemyAllianceId = alliances.createAlliance("NAP", "Treaty Partner", "");
        vm.prank(recruit);
        uint256 alliedAllianceId = alliances.createAlliance("FRND", "Allied Partner", "");

        vm.prank(leader);
        alliances.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.NonAggressionPact
        );
        vm.prank(leader);
        alliances.setDiplomacy(
            allianceId, alliedAllianceId, VeydriftAllianceSystem.DiplomacyStatus.Ally
        );
        assertEq(
            uint8(alliances.diplomacyStatus(enemyAllianceId, allianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.NonAggressionPact)
        );
        assertEq(
            uint8(alliances.diplomacyStatus(alliedAllianceId, allianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.Ally)
        );

        vm.prank(leader);
        alliances.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );
        vm.prank(leader);
        alliances.setDiplomacy(
            allianceId, alliedAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );

        assertEq(
            uint8(alliances.diplomacyStatus(allianceId, enemyAllianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.War)
        );
        assertEq(
            uint8(alliances.diplomacyStatus(enemyAllianceId, allianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.War)
        );
        assertEq(
            uint8(alliances.diplomacyStatus(allianceId, alliedAllianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.War)
        );
        assertEq(
            uint8(alliances.diplomacyStatus(alliedAllianceId, allianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.War)
        );
        assertGt(alliances.warStartedAt(enemyAllianceId, allianceId), 0);
        assertGt(alliances.warStartedAt(alliedAllianceId, allianceId), 0);
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
        vm.warp(block.timestamp + alliances.WAR_MINIMUM_DURATION());
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
        vm.prank(admin);
        game.setAllianceSystem(address(proxied));

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
        proxied.upgradeToAndCall(
            address(newImplementation),
            abi.encodeCall(VeydriftAllianceSystem.initializeWarMinimumDuration, ())
        );

        assertEq(VeydriftAllianceSystemV2(address(proxied)).upgradeVersion(), "v2");
        assertEq(proxied.owner(), admin);
        assertEq(proxied.warMinimumDurationActivatedAt(), uint64(block.timestamp));
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

    function testCorrectiveUpgradeRequiresMigratedDeclarerForLegacyMirroredWars() public {
        VeydriftAllianceSystemStateHarness stateful = VeydriftAllianceSystemStateHarness(
            address(
                new ERC1967Proxy(
                    address(
                        new VeydriftAllianceSystemStateHarness(IVeydriftAllianceGame(address(game)))
                    ),
                    abi.encodeCall(
                        VeydriftAllianceSystem.initialize,
                        (IVeydriftAllianceGame(address(game)), admin)
                    )
                )
            )
        );
        VeydriftAllianceSystem proxied = VeydriftAllianceSystem(address(stateful));
        vm.prank(admin);
        game.setAllianceSystem(address(proxied));

        vm.prank(leader);
        uint256 allianceId = proxied.createAlliance("ALLY", "Alliance", "");
        vm.prank(enemy);
        uint256 enemyAllianceId = proxied.createAlliance("WAR", "War Target", "");
        vm.prank(recruit);
        uint256 secondEnemyAllianceId = proxied.createAlliance("WAR2", "Second War Target", "");

        vm.prank(admin);
        proxied.initializeWarMinimumDuration();
        uint64 activatedAt = proxied.warMinimumDurationActivatedAt();

        stateful.seedDiplomacyDirection(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );
        stateful.seedDiplomacyDirection(
            enemyAllianceId, allianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );
        stateful.seedDiplomacyDirection(
            allianceId, secondEnemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );
        stateful.seedDiplomacyDirection(
            secondEnemyAllianceId, allianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );

        VeydriftAllianceSystemStateHarness correctiveImplementation =
            new VeydriftAllianceSystemStateHarness(IVeydriftAllianceGame(address(game)));
        vm.prank(admin);
        proxied.upgradeToAndCall(address(correctiveImplementation), "");

        assertEq(proxied.warDeclarer(allianceId, enemyAllianceId), 0);
        vm.prank(enemy);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.WarDeclarerUnknown.selector, enemyAllianceId, allianceId
            )
        );
        proxied.setDiplomacy(
            enemyAllianceId, allianceId, VeydriftAllianceSystem.DiplomacyStatus.None
        );

        vm.startPrank(admin);
        proxied.migrateLegacyWarMetadata(allianceId, enemyAllianceId, allianceId, activatedAt);
        proxied.migrateLegacyWarMetadata(
            allianceId, secondEnemyAllianceId, secondEnemyAllianceId, activatedAt
        );
        vm.stopPrank();
        assertEq(proxied.warDeclarer(enemyAllianceId, allianceId), allianceId);
        assertEq(proxied.warDeclarer(allianceId, secondEnemyAllianceId), secondEnemyAllianceId);

        vm.warp(activatedAt + proxied.WAR_MINIMUM_DURATION());
        vm.prank(enemy);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.NotAuthorized.selector, enemy, enemyAllianceId
            )
        );
        proxied.setDiplomacy(
            enemyAllianceId, allianceId, VeydriftAllianceSystem.DiplomacyStatus.None
        );
        vm.prank(leader);
        proxied.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.None
        );
        vm.prank(leader);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftAllianceSystem.NotAuthorized.selector, leader, allianceId
            )
        );
        proxied.setDiplomacy(
            allianceId, secondEnemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.None
        );
        vm.prank(recruit);
        proxied.setDiplomacy(
            secondEnemyAllianceId, allianceId, VeydriftAllianceSystem.DiplomacyStatus.None
        );

        assertEq(
            uint8(proxied.diplomacyStatus(allianceId, enemyAllianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.None)
        );
        assertEq(
            uint8(proxied.diplomacyStatus(enemyAllianceId, allianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.None)
        );
        assertEq(proxied.warStartedAt(allianceId, enemyAllianceId), 0);
        assertEq(proxied.warStartedAt(enemyAllianceId, allianceId), 0);
        assertEq(
            uint8(proxied.diplomacyStatus(allianceId, secondEnemyAllianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.None)
        );
        assertEq(
            uint8(proxied.diplomacyStatus(secondEnemyAllianceId, allianceId)),
            uint8(VeydriftAllianceSystem.DiplomacyStatus.None)
        );
        assertEq(proxied.warStartedAt(allianceId, secondEnemyAllianceId), 0);
        assertEq(proxied.warStartedAt(secondEnemyAllianceId, allianceId), 0);
    }

    function testCorrectiveUpgradeClearsBothStoredWarTimestamps() public {
        VeydriftAllianceSystemStateHarness stateful = VeydriftAllianceSystemStateHarness(
            address(
                new ERC1967Proxy(
                    address(
                        new VeydriftAllianceSystemStateHarness(IVeydriftAllianceGame(address(game)))
                    ),
                    abi.encodeCall(
                        VeydriftAllianceSystem.initialize,
                        (IVeydriftAllianceGame(address(game)), admin)
                    )
                )
            )
        );
        VeydriftAllianceSystem proxied = VeydriftAllianceSystem(address(stateful));
        vm.prank(admin);
        game.setAllianceSystem(address(proxied));

        vm.prank(leader);
        uint256 allianceId = proxied.createAlliance("ALLY", "Alliance", "");
        vm.prank(enemy);
        uint256 enemyAllianceId = proxied.createAlliance("WAR", "War Target", "");

        vm.prank(admin);
        proxied.initializeWarMinimumDuration();
        uint64 startedAt = uint64(block.timestamp);
        stateful.seedDiplomacyDirection(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );
        stateful.seedDiplomacyDirection(
            enemyAllianceId, allianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );
        stateful.seedWarStartedAt(allianceId, enemyAllianceId, startedAt);
        stateful.seedWarStartedAt(enemyAllianceId, allianceId, startedAt);

        VeydriftAllianceSystemStateHarness correctiveImplementation =
            new VeydriftAllianceSystemStateHarness(IVeydriftAllianceGame(address(game)));
        vm.prank(admin);
        proxied.upgradeToAndCall(address(correctiveImplementation), "");

        vm.prank(admin);
        proxied.migrateLegacyWarMetadata(allianceId, enemyAllianceId, allianceId, startedAt);
        assertEq(stateful.storedWarDeclarer(allianceId, enemyAllianceId), allianceId);
        assertEq(stateful.storedWarDeclarer(enemyAllianceId, allianceId), allianceId);

        vm.warp(startedAt + proxied.WAR_MINIMUM_DURATION());
        vm.prank(leader);
        proxied.setDiplomacy(
            allianceId, enemyAllianceId, VeydriftAllianceSystem.DiplomacyStatus.None
        );

        assertEq(proxied.warStartedAt(allianceId, enemyAllianceId), 0);
        assertEq(proxied.warStartedAt(enemyAllianceId, allianceId), 0);
        assertEq(stateful.storedWarStartedAt(allianceId, enemyAllianceId), 0);
        assertEq(stateful.storedWarStartedAt(enemyAllianceId, allianceId), 0);
        assertEq(stateful.storedWarDeclarer(allianceId, enemyAllianceId), 0);
        assertEq(stateful.storedWarDeclarer(enemyAllianceId, allianceId), 0);
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

    function _signPaidInvite(bytes32 commitment, address invitee, uint64 expiresAt)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            paidInvites.authorizationHash(commitment, invitee, expiresAt)
        );
        return vm.sign(inviteSignerKey, digest);
    }

    function _startPaidInvitee(uint256 allianceId, bytes32 commitment)
        internal
        returns (uint256 planetId)
    {
        assertEq(alliances.allianceOf(leader).allianceId, allianceId);
        uint256 price = paidInvites.INVITE_PRICE();
        vm.prank(leader);
        paidInvites.buy{value: price}(commitment);
        uint64 expiresAt = uint64(block.timestamp + 10 minutes);
        (uint8 v, bytes32 r, bytes32 s) = _signPaidInvite(commitment, newCommander, expiresAt);
        uint256 settlementPrice = game.startPrice();
        vm.prank(newCommander);
        return
            game.startPlanetWithAllianceInvite{value: settlementPrice}(
                commitment, expiresAt, v, r, s
            );
    }

    function _enableMetalProduction(uint256 planetId) internal {
        _setBuildingLevel(planetId, Building.MetalMine, 1);
        _setBuildingLevel(planetId, Building.SolarPlant, 10);
        _setBuildingLevel(planetId, Building.MetalStorage, 10);
    }

    function _setBuildingLevel(uint256 planetId, Building building, uint16 level) internal {
        bytes32 outerSlot = keccak256(abi.encode(planetId, uint256(6)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(building)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(level)));
    }

    function _cloneOwnedPlanet(address player, uint256 sourcePlanetId, uint256 planetId) internal {
        uint256 sourceBase = uint256(keccak256(abi.encode(sourcePlanetId, uint256(4))));
        uint256 targetBase = uint256(keccak256(abi.encode(planetId, uint256(4))));
        for (uint256 i = 0; i < 4; i++) {
            vm.store(
                address(game),
                bytes32(targetBase + i),
                vm.load(address(game), bytes32(sourceBase + i))
            );
        }

        bytes32 ownedListSlot = keccak256(abi.encode(player, uint256(36)));
        uint256 ownedCount = uint256(vm.load(address(game), ownedListSlot));
        bytes32 ownedListData = keccak256(abi.encode(ownedListSlot));
        vm.store(address(game), bytes32(uint256(ownedListData) + ownedCount), bytes32(planetId));
        vm.store(address(game), ownedListSlot, bytes32(ownedCount + 1));
        vm.store(
            address(game), keccak256(abi.encode(planetId, uint256(37))), bytes32(ownedCount + 1)
        );
    }

    function _setGameReserveBalances(uint256 metal, uint256 crystal, uint256 deuterium) internal {
        vm.store(
            address(metalToken), keccak256(abi.encode(address(game), uint256(0))), bytes32(metal)
        );
        vm.store(
            address(crystalToken),
            keccak256(abi.encode(address(game), uint256(0))),
            bytes32(crystal)
        );
        vm.store(
            address(deuteriumToken),
            keccak256(abi.encode(address(game), uint256(0))),
            bytes32(deuterium)
        );
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
