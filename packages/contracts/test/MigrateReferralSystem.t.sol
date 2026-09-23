// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MigrateReferralSystem} from "../script/MigrateReferralSystem.s.sol";
import {VeydriftReferralSystem} from "../src/VeydriftReferralSystem.sol";

contract MigrateReferralSystemTest is Test {
    // Disposable local Forge signer; never used on a live chain.
    uint256 private constant TEST_KEY = 0xA11CE;
    string private constant SUCCESS_MANIFEST =
        "./manifests/migration-script-case-success-test.json";
    string private constant FORGED_MANIFEST = "./manifests/migration-script-case-forged-test.json";
    string private constant LEGACY_CODE = "Abcdefghijklmnopqrstuvwxyz0123456789_-abcd0";

    VeydriftReferralSystem private source;
    VeydriftReferralSystem private target;
    MigrateReferralSystem private script;
    address private owner;
    address private inviter = address(0xB0B);
    bytes32 private codeHash;
    bytes32 private commitment;
    bytes32 private digest;

    function setUp() public {
        owner = vm.addr(TEST_KEY);
        source = new VeydriftReferralSystem(owner);
        target = new VeydriftReferralSystem(owner);
        script = new MigrateReferralSystem();
        assertEq(bytes(LEGACY_CODE).length, 43);
        codeHash = keccak256(bytes("abcdefghijklmnopqrstuvwxyz0123456789_-abcd0"));
        commitment = keccak256(bytes(LEGACY_CODE));
        assertNotEq(commitment, keccak256(bytes("abcdefghijklmnopqrstuvwxyz0123456789_-abcd0")));
        digest = source.referralMigrationLeafHashOnly(inviter, codeHash, commitment);

        vm.startPrank(owner);
        source.setReferralSigner(address(0xCAFE));
        target.setReferralSigner(address(0xCAFE));
        source.configureReferralCodeMigration(bytes32(0), 0, digest, 1);
        source.configureReferralRedemptionMigration(bytes32(0), 0);
        source.configureReferralRewardMigration(bytes32(0), 0);
        source.configureReferralRewardClaimMigration(bytes32(0), 0);
        (address[] memory inviters, string[] memory codes, bytes32[] memory commitments) =
            _row(commitment);
        source.migrateLegacyReferralCodeOwnership(inviters, codes, commitments);
        source.finalizeReferralCodeMigration();
        vm.stopPrank();
        assertEq(source.referralCodeOwner(codeHash), inviter);
        assertEq(source.referralCodeMigrationKind(codeHash), 2);

        vm.setEnv("PRIVATE_KEY", vm.toString(TEST_KEY));
        vm.setEnv("REFERRAL_SYSTEM_ADDRESS", vm.toString(address(target)));
        vm.setEnv("REFERRAL_MIGRATION_BATCH_SIZE", "1");
    }

    function testRunPreservesMixedCasePreimageAndRejectsForgedCommitment() public {
        // Both paths run serially because Forge environment variables are process-global.
        bytes32 forged = bytes32(uint256(123));
        _writeManifest(forged, FORGED_MANIFEST);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftReferralSystem.ReferralMigrationCommitmentMismatch.selector,
                commitment,
                forged
            )
        );
        script.run();
        // The expected revert interrupts run() before its stopBroadcast cheatcode.
        vm.stopBroadcast();
        vm.removeFile(FORGED_MANIFEST);
        assertFalse(target.referralMigrationFinalized());
        assertEq(target.referralMigrationImportedHashOnlyCount(), 0);

        _writeManifest(commitment, SUCCESS_MANIFEST);
        (address[] memory inviters, string[] memory codes, bytes32[] memory commitments) =
            _row(commitment);
        // Require the ACTUAL run() to submit the exact, unmodified raw string to the target.
        vm.expectCall(
            address(target),
            abi.encodeCall(
                VeydriftReferralSystem.migrateLegacyReferralCodeOwnership,
                (inviters, codes, commitments)
            )
        );
        script.run();
        assertEq(
            vm.parseJsonString(vm.readFile(SUCCESS_MANIFEST), ".calldata.hashOnlyCodes[0]"),
            LEGACY_CODE
        );
        vm.removeFile(SUCCESS_MANIFEST);

        assertEq(source.owner(), owner);
        assertEq(target.owner(), owner);
        assertEq(source.referralSigner(), target.referralSigner());
        assertEq(source.game(), address(0));
        assertEq(target.game(), address(0));
        assertTrue(source.referralMigrationFinalized());
        assertTrue(target.referralMigrationFinalized());
        assertTrue(target.referralMigrationConfigured());
        assertTrue(target.referralRedemptionMigrationConfigured());
        assertTrue(target.referralRewardMigrationConfigured());
        assertTrue(target.referralRewardClaimMigrationConfigured());
        assertEq(target.referralCodeOwner(codeHash), source.referralCodeOwner(codeHash));
        assertEq(
            target.referralCodeMigrationKind(codeHash), source.referralCodeMigrationKind(codeHash)
        );
        assertEq(target.referralMigrationExpectedHashOnlyHash(), digest);
        assertEq(
            target.referralMigrationExpectedHashOnlyHash(),
            source.referralMigrationExpectedHashOnlyHash()
        );
        assertEq(
            target.referralMigrationExpectedHashOnlyCount(),
            source.referralMigrationExpectedHashOnlyCount()
        );
        assertEq(
            target.referralMigrationExpectedValidHash(), source.referralMigrationExpectedValidHash()
        );
        assertEq(
            target.referralMigrationExpectedValidCount(),
            source.referralMigrationExpectedValidCount()
        );
        assertEq(
            target.referralMigrationExpectedRedemptionHash(),
            source.referralMigrationExpectedRedemptionHash()
        );
        assertEq(
            target.referralMigrationExpectedRedemptionCount(),
            source.referralMigrationExpectedRedemptionCount()
        );
        assertEq(
            target.referralMigrationExpectedRewardStatsHash(),
            source.referralMigrationExpectedRewardStatsHash()
        );
        assertEq(
            target.referralMigrationExpectedRewardStatsCount(),
            source.referralMigrationExpectedRewardStatsCount()
        );
        assertEq(
            target.referralMigrationExpectedRewardClaimHash(),
            source.referralMigrationExpectedRewardClaimHash()
        );
        assertEq(
            target.referralMigrationExpectedRewardClaimCount(),
            source.referralMigrationExpectedRewardClaimCount()
        );
        assertEq(
            target.referralMigrationImportedHashOnlyHash(),
            source.referralMigrationImportedHashOnlyHash()
        );
        assertEq(target.referralMigrationExpectedHashOnlyCount(), 1);
        assertEq(
            target.referralMigrationImportedHashOnlyCount(),
            source.referralMigrationImportedHashOnlyCount()
        );
        assertEq(
            target.referralMigrationImportedValidHash(), source.referralMigrationImportedValidHash()
        );
        assertEq(
            target.referralMigrationImportedValidCount(),
            source.referralMigrationImportedValidCount()
        );
        assertEq(
            target.referralMigrationImportedRedemptionHash(),
            source.referralMigrationImportedRedemptionHash()
        );
        assertEq(
            target.referralMigrationImportedRedemptionCount(),
            source.referralMigrationImportedRedemptionCount()
        );
        assertEq(
            target.referralMigrationImportedRewardStatsHash(),
            source.referralMigrationImportedRewardStatsHash()
        );
        assertEq(
            target.referralMigrationImportedRewardStatsCount(),
            source.referralMigrationImportedRewardStatsCount()
        );
        assertEq(
            target.referralMigrationImportedRewardClaimHash(),
            source.referralMigrationImportedRewardClaimHash()
        );
        assertEq(
            target.referralMigrationImportedRewardClaimCount(),
            source.referralMigrationImportedRewardClaimCount()
        );
    }

    function _row(bytes32 rowCommitment)
        private
        view
        returns (address[] memory inviters, string[] memory codes, bytes32[] memory commitments)
    {
        inviters = new address[](1);
        codes = new string[](1);
        commitments = new bytes32[](1);
        inviters[0] = inviter;
        codes[0] = LEGACY_CODE;
        commitments[0] = rowCommitment;
    }

    function _writeManifest(bytes32 rowCommitment, string memory path) private {
        vm.setEnv("REFERRAL_MIGRATION_MANIFEST_FILE", path);
        // A disposable manifest with every field consumed by the production script. All other
        // inventory classes are empty, so this fixture isolates the raw 43-byte preimage path.
        string memory calldataJson = string.concat(
            '{"validInviters":[],"validCodes":[],"validActivatedAts":[],"validSourceCommitments":[],',
            '"hashOnlyInviters":["',
            vm.toString(inviter),
            '"],"hashOnlyCodes":["',
            LEGACY_CODE,
            '"],"hashOnlySourceCommitments":["',
            vm.toString(rowCommitment),
            '"],',
            '"redemptionInviters":[],"redemptionInvitees":[],"redemptionCommitments":[],',
            '"redemptionRedeemedAts":[],"redemptionRewardAmounts":[],"redemptionPaid":[],',
            '"redemptionCredited":[],"rewardClaimInviters":[],"rewardClaimInvitees":[],',
            '"rewardClaimCommitments":[],"rewardClaimRecipients":[],"rewardClaimAmounts":[],',
            '"rewardClaimAts":[],"rewardInviters":[],"rewardAccrued":[],"rewardPaid":[],"rewardClaimed":[]}'
        );
        string memory header = string.concat(
            '{"version":2,"chainId":',
            vm.toString(block.chainid),
            ',"snapshotBlock":"',
            vm.toString(block.number),
            '","indexFromBlock":"0","snapshotBlockHash":"',
            vm.toString(bytes32(uint256(1))),
            '","sourceGame":"',
            vm.toString(address(0)),
            '","sourceBalanceWei":"0","sourceReferral":"',
            vm.toString(address(source)),
            '","sourceOwner":"',
            vm.toString(owner),
            '","sourceReferralSigner":"',
            vm.toString(source.referralSigner()),
            '"'
        );
        string memory sections = string.concat(
            ',"validCodeManifest":{"digest":"',
            vm.toString(bytes32(0)),
            '","count":0}',
            ',"hashOnlyManifest":{"digest":"',
            vm.toString(digest),
            '","count":1}',
            ',"redemptionManifest":{"digest":"',
            vm.toString(bytes32(0)),
            '","count":0}',
            ',"rewardStatsManifest":{"digest":"',
            vm.toString(bytes32(0)),
            '","count":0}',
            ',"rewardClaimManifest":{"digest":"',
            vm.toString(bytes32(0)),
            '","count":0}',
            ',"calldata":',
            calldataJson,
            "}"
        );
        vm.writeFile(path, string.concat(header, sections));
    }
}
