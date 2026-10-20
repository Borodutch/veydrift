// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployReferralSystem} from "../script/DeployReferralSystem.s.sol";
import {FreezeReferralSystem} from "../script/FreezeReferralSystem.s.sol";
import {MigrateReferralSystem} from "../script/MigrateReferralSystem.s.sol";
import {UpgradeGame} from "../script/UpgradeGame.s.sol";
import {VeydriftReferralSystem} from "../src/VeydriftReferralSystem.sol";

interface IReferralGame {
    function setGamePaused(bool paused) external;
    function startPrice() external view returns (uint256);
    function homePlanetOf(address player) external view returns (uint256);
    function effectivePlayer(address actor) external view returns (address);
    function startPlanetWithReferral(bytes32 commitment, uint8 v, bytes32 r, bytes32 s)
        external
        payable
        returns (uint256 planetId);
}

/// @notice Rehearses the referral replacement on Base state with impersonated owners (no keys):
///         freeze 0x9B9A (old owner), deploy the UUPS proxy and import the manifest (new owner),
///         check every migrated getter against the frozen source, switch the Game, then redeem an
///         existing code through startPlanetWithReferral.
/// @dev Needs REFERRAL_MIGRATION_MANIFEST_FILE: a manifest that the production generators built
///      for this exact state (scripts/rehearse-referral-upgrade.sh does it on an anvil fork and
///      runs this test against that fork). If the fork's source is not frozen yet it is frozen
///      here, so the manifest must then come from the same block plus the freeze
///      (REFERRAL_REHEARSAL_FORK_BLOCK pins forge's fork). After the real freeze or migration on
///      Base, run it against Base with the real manifest (and REFERRAL_SYSTEM_ADDRESS once the
///      proxy exists) as the last check before the Game switch.
contract ReferralUpgradeMainnetForkTest is Test {
    address internal constant GAME = 0xf397910F005151b09644228573a4353818D3755d;
    address internal constant PROXY_ADMIN = 0xc81609E77b5ea79d0CdA9794b75B65D567535cb9;
    address internal constant MOON = 0x4935f1E0024F1Ea07877a583F89A51BF3d91Cf5C;
    address internal constant SOURCE = 0x9B9A94836eaa715A3b801e91Aa409099FC1393B3;
    address internal constant SOURCE_OWNER = 0x4755D28078442cb7E7Ac2409868fb3Ff1B9fA73B;
    address internal constant NEW_OWNER = 0xc2ae8c98099E4B9BBB661D1B306e1C70915eFC02;
    address internal constant SIGNER = 0xCA105d70136fFfa7bf4ED5fFf0Bc6909F985273D;
    bytes32 internal constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    IReferralGame internal constant game = IReferralGame(GAME);
    VeydriftReferralSystem internal constant source = VeydriftReferralSystem(SOURCE);
    VeydriftReferralSystem internal target;
    string internal manifest;
    address internal inviter;
    string internal code;
    bytes32 internal commitment;
    uint256 internal signerKey;

    function testReplaceReferralSystemAndRedeemExistingCode() external {
        // `plain test --fork base` starts on Base already; forge forks from the env RPC.
        if (block.chainid != 8453) {
            string memory rpc = vm.envOr("VEYDRIFT_BASE_MAINNET_RPC_URL", string(""));
            if (bytes(rpc).length == 0) {
                emit log("VEYDRIFT_BASE_MAINNET_RPC_URL unset - skipping referral replacement fork");
                return;
            }
            uint256 forkBlock = vm.envOr("REFERRAL_REHEARSAL_FORK_BLOCK", uint256(0));
            if (forkBlock == 0) vm.createSelectFork(rpc);
            else vm.createSelectFork(rpc, forkBlock);
        }
        string memory manifestFile = vm.envOr("REFERRAL_MIGRATION_MANIFEST_FILE", string(""));
        if (bytes(manifestFile).length == 0) {
            emit log("REFERRAL_MIGRATION_MANIFEST_FILE unset - run scripts/rehearse-referral-upgrade.sh");
            return;
        }
        manifest = vm.readFile(manifestFile);

        // 1. Old owner freezes the source; the Game is paused only around that one transaction.
        if (source.game() != address(0)) {
            vm.prank(NEW_OWNER);
            game.setGamePaused(true);
            vm.setEnv("UPGRADE_DRY_RUN_OWNER", vm.toString(SOURCE_OWNER));
            vm.setEnv("GAME_PROXY_ADDRESS", vm.toString(GAME));
            vm.setEnv("SOURCE_REFERRAL_SYSTEM_ADDRESS", vm.toString(SOURCE));
            new FreezeReferralSystem().run();
            vm.prank(NEW_OWNER);
            game.setGamePaused(false);
        }
        assertEq(source.game(), address(0), "source frozen");

        // 2-3. New owner deploys the proxy (unless it already exists) and imports the manifest.
        vm.setEnv("UPGRADE_DRY_RUN_OWNER", vm.toString(NEW_OWNER));
        address deployed = vm.envOr("REFERRAL_SYSTEM_ADDRESS", address(0));
        if (deployed == address(0)) {
            vm.setEnv("REFERRAL_SIGNER_ADDRESS", vm.toString(SIGNER));
            deployed = new DeployReferralSystem().run();
            vm.setEnv("REFERRAL_SYSTEM_ADDRESS", vm.toString(deployed));
        }
        target = VeydriftReferralSystem(deployed);
        uint256 snapshotBlock = vm.parseUint(vm.parseJsonString(manifest, ".snapshotBlock"));
        if (block.number < snapshotBlock) vm.roll(snapshotBlock);
        new MigrateReferralSystem().run();
        assertEq(target.owner(), NEW_OWNER);
        assertTrue(target.referralMigrationFinalized());
        _assertMigratedStateMatchesSource();

        // 4. New owner switches the Game (sets the target's game pointer, deploys, upgrades).
        vm.setEnv("GAME_PROXY_ADDRESS", vm.toString(GAME));
        vm.setEnv("GAME_PROXY_ADMIN", vm.toString(PROXY_ADMIN));
        vm.setEnv("MOON_PROXY_ADDRESS", vm.toString(MOON));
        vm.setEnv("VEYDRIFT_REFERRAL_SYSTEM_ADDRESS", vm.toString(address(target)));
        vm.setEnv("VEYDRIFT_SOURCE_REFERRAL_SYSTEM_ADDRESS", vm.toString(SOURCE));
        new UpgradeGame().run();
        assertEq(target.game(), GAME);

        _redeemExistingCodeThroughGame();
        _ownerControlsUpgradesAndOwnership();
    }

    function _assertMigratedStateMatchesSource() internal view {
        _same(abi.encodeWithSelector(target.referralSigner.selector));
        address[] memory inviters = vm.parseJsonAddressArray(manifest, ".calldata.validInviters");
        string[] memory codes = vm.parseJsonStringArray(manifest, ".calldata.validCodes");
        for (uint256 i; i < codes.length; ++i) {
            bytes32 codeHash = source.referralCodeHash(codes[i]);
            bytes32 codeCommitment = source.referralCommitment(inviters[i], codeHash);
            assertEq(target.referralCodeMigrationKind(codeHash), 1);
            _same(abi.encodeWithSelector(target.referralCodeState.selector, codeHash));
            _same(
                abi.encodeWithSelector(target.referralCodeOwnedBy.selector, inviters[i], codeHash)
            );
            _same(abi.encodeWithSelector(target.referralInvites.selector, codeCommitment));
            _same(abi.encodeWithSelector(target.referralCodeHashOf.selector, codeCommitment));
            _same(abi.encodeWithSelector(target.referralClaimedAt.selector, codeCommitment));
            _same(abi.encodeWithSelector(target.referralRedemptionQuota.selector, codeCommitment));
            _sameInviter(inviters[i]);
        }
        address[] memory hashOnlyOwners =
            vm.parseJsonAddressArray(manifest, ".calldata.hashOnlyInviters");
        string[] memory hashOnlyCodes = vm.parseJsonStringArray(manifest, ".calldata.hashOnlyCodes");
        for (uint256 i; i < hashOnlyCodes.length; ++i) {
            bytes32 codeHash = keccak256(bytes(vm.toLowercase(hashOnlyCodes[i])));
            assertEq(target.referralCodeOwner(codeHash), hashOnlyOwners[i]);
            _same(abi.encodeWithSelector(target.referralCodeOwner.selector, codeHash));
            _same(abi.encodeWithSelector(target.referralCodeMigrationKind.selector, codeHash));
            _same(
                abi.encodeWithSelector(
                    target.referralCodeOwnedBy.selector, hashOnlyOwners[i], codeHash
                )
            );
        }
        address[] memory invitees =
            vm.parseJsonAddressArray(manifest, ".calldata.redemptionInvitees");
        bytes32[] memory commitments =
            vm.parseJsonBytes32Array(manifest, ".calldata.redemptionCommitments");
        for (uint256 i; i < invitees.length; ++i) {
            assertTrue(target.referralRedemptions(commitments[i], invitees[i]));
            _same(
                abi.encodeWithSelector(
                    target.referralRedemptions.selector, commitments[i], invitees[i]
                )
            );
            _same(abi.encodeWithSelector(target.referralInviteeRedeemed.selector, invitees[i]));
            _same(
                abi.encodeWithSelector(
                    target.referralRewardCredits.selector, commitments[i], invitees[i]
                )
            );
        }
        address[] memory rewardInviters =
            vm.parseJsonAddressArray(manifest, ".calldata.rewardInviters");
        for (uint256 i; i < rewardInviters.length; ++i) {
            _sameInviter(rewardInviters[i]);
        }
    }

    function _sameInviter(address account) internal view {
        _same(abi.encodeWithSelector(target.referralCommitmentOf.selector, account));
        _same(abi.encodeWithSelector(target.referralInviteState.selector, account));
        _same(abi.encodeWithSelector(target.referralTopUpState.selector, account));
        _same(abi.encodeWithSelector(target.claimableReferralRewards.selector, account));
        _same(abi.encodeWithSelector(target.totalReferralRewardsAccrued.selector, account));
        _same(abi.encodeWithSelector(target.totalReferralRewardsPaid.selector, account));
        _same(abi.encodeWithSelector(target.totalReferralRewardsClaimed.selector, account));
    }

    /// The same getter must return byte-identical data on the frozen source and the replacement.
    function _same(bytes memory call) internal view {
        (bool sourceOk, bytes memory sourceData) = SOURCE.staticcall(call);
        (bool targetOk, bytes memory targetData) = address(target).staticcall(call);
        assertTrue(sourceOk && targetOk, "getter reverted");
        assertEq(targetData, sourceData, "migrated getter differs from source");
    }

    function _redeemExistingCodeThroughGame() internal {
        // Manifest rows are ordered by activation, so the last one is the newest live invite.
        address[] memory inviters = vm.parseJsonAddressArray(manifest, ".calldata.validInviters");
        string[] memory codes = vm.parseJsonStringArray(manifest, ".calldata.validCodes");
        inviter = inviters[inviters.length - 1];
        code = codes[codes.length - 1];
        commitment = target.referralCommitment(inviter, target.referralCodeHash(code));
        assertEq(target.referralCommitmentOf(inviter), commitment, "newest code is active");

        // The backend signer's key is not available here; the owner points the target at a
        // throwaway signer. Signatures stay bound to the unchanged Game proxy and chain id.
        address signer;
        (signer, signerKey) = makeAddrAndKey("rehearsal-referral-signer");
        vm.prank(NEW_OWNER);
        target.setReferralSigner(signer);

        _redeemFreshInvitee();
        _rejectMigratedInviteeReplay();
        _topUpOnReplacement();
    }

    function _redeemFreshInvitee() internal {
        (uint8 remaining,) = target.referralRedemptionQuota(commitment);
        assertGt(remaining, 0, "newest code has quota");
        address invitee = makeAddr("rehearsal-invitee");
        uint256 price = game.startPrice();
        uint256 inviterBalance = inviter.balance;
        uint256 accrued = target.totalReferralRewardsAccrued(inviter);
        (uint8 v, bytes32 r, bytes32 s) = _sign(invitee);
        vm.deal(invitee, price);
        vm.prank(invitee);
        uint256 planetId = game.startPlanetWithReferral{value: price}(commitment, v, r, s);

        assertEq(game.homePlanetOf(invitee), planetId);
        assertTrue(target.referralRedemptions(commitment, invitee));
        assertTrue(target.referralInviteeRedeemed(invitee));
        assertFalse(source.referralInviteeRedeemed(invitee), "frozen source untouched");
        assertEq(target.totalReferralRewardsAccrued(inviter), accrued + price / 2);
        // A wallet whose code rejects the 30k-gas payout is credited instead (unchanged behaviour).
        uint256 credited = target.referralRewardCredits(commitment, invitee);
        if (credited == 0) {
            assertEq(inviter.balance, inviterBalance + price / 2, "inviter paid directly");
        } else {
            assertEq(credited, price / 2, "inviter reward credited");
            assertEq(address(target).balance, credited);
        }
        emit log_named_uint("inviter reward credited instead of paid (wei)", credited);
        (uint8 remainingAfter,) = target.referralRedemptionQuota(commitment);
        assertEq(remainingAfter, remaining - 1);
    }

    /// A wallet redeemed on the old contract stays redeemed on the new one.
    function _rejectMigratedInviteeReplay() internal {
        address[] memory redeemed =
            vm.parseJsonAddressArray(manifest, ".calldata.redemptionInvitees");
        if (redeemed.length == 0 || game.effectivePlayer(redeemed[0]) != redeemed[0]) return;
        uint256 price = game.startPrice();
        (uint8 v, bytes32 r, bytes32 s) = _sign(redeemed[0]);
        vm.deal(redeemed[0], price);
        vm.prank(redeemed[0]);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftReferralSystem.ReferralInviteeAlreadyRedeemed.selector,
                commitment,
                redeemed[0]
            )
        );
        game.startPlanetWithReferral{value: price}(commitment, v, r, s);
    }

    /// The inviter tops the code up directly on the replacement once the cooldown has passed.
    function _topUpOnReplacement() internal {
        vm.warp(block.timestamp + 1 days);
        vm.prank(inviter);
        target.claimReferralCode(code);
        (uint64 lastTopUpAt,,) = target.referralTopUpState(inviter);
        assertEq(lastTopUpAt, block.timestamp);
        (uint8 remaining,) = target.referralRedemptionQuota(commitment);
        assertEq(remaining, target.REFERRAL_CLAIM_LIMIT());
    }

    function _ownerControlsUpgradesAndOwnership() internal {
        address nextImplementation = address(new VeydriftReferralSystem());
        vm.prank(SOURCE_OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftReferralSystem.Unauthorized.selector, SOURCE_OWNER)
        );
        target.upgradeToAndCall(nextImplementation, "");
        vm.prank(NEW_OWNER);
        target.upgradeToAndCall(nextImplementation, "");
        assertEq(
            address(uint160(uint256(vm.load(address(target), IMPLEMENTATION_SLOT)))),
            nextImplementation
        );
        assertEq(target.game(), GAME);
        assertTrue(target.referralMigrationFinalized());
        _assertMigratedStateMatchesSourceCodes();

        address nextOwner = makeAddr("next-referral-owner");
        vm.prank(NEW_OWNER);
        target.transferOwnership(nextOwner);
        assertEq(target.owner(), nextOwner);
        vm.prank(NEW_OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftReferralSystem.Unauthorized.selector, NEW_OWNER)
        );
        target.setGame(address(0));
    }

    /// Code ownership and activation survive a later implementation upgrade.
    function _assertMigratedStateMatchesSourceCodes() internal view {
        address[] memory inviters = vm.parseJsonAddressArray(manifest, ".calldata.validInviters");
        string[] memory codes = vm.parseJsonStringArray(manifest, ".calldata.validCodes");
        for (uint256 i; i < codes.length; ++i) {
            bytes32 codeHash = source.referralCodeHash(codes[i]);
            _same(abi.encodeWithSelector(target.referralCodeOwner.selector, codeHash));
            _same(
                abi.encodeWithSelector(
                    target.referralInvites.selector,
                    source.referralCommitment(inviters[i], codeHash)
                )
            );
        }
    }

    function _sign(address invitee) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 payload = keccak256(
            abi.encode(target.REFERRAL_REDEEM_DOMAIN(), block.chainid, GAME, invitee, commitment)
        );
        return vm.sign(
            signerKey, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", payload))
        );
    }
}
