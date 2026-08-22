// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VeydriftReferralSystem} from "../src/VeydriftReferralSystem.sol";

/// @notice Imports the independently verified referral migration manifest into a replacement
/// referral contract while claims and redemptions remain disabled.
/// @dev The script is resumable at manifest-section boundaries. It verifies the frozen source,
/// target ownership/configuration and every expected/imported digest before finalizing.
///
/// Required env:
///   PRIVATE_KEY                     owner of both source and replacement referral contracts
///   REFERRAL_SYSTEM_ADDRESS         replacement referral contract (game must be unset)
///   REFERRAL_MIGRATION_MANIFEST_FILE path under packages/contracts/manifests
/// Optional env:
///   REFERRAL_MIGRATION_BATCH_SIZE   rows per transaction; defaults to 20
contract MigrateReferralSystem is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(privateKey);
        VeydriftReferralSystem target =
            VeydriftReferralSystem(vm.envAddress("REFERRAL_SYSTEM_ADDRESS"));
        uint256 batchSize = vm.envOr("REFERRAL_MIGRATION_BATCH_SIZE", uint256(20));
        require(batchSize > 0, "BATCH_SIZE_REQUIRED");

        string memory manifest = vm.readFile(vm.envString("REFERRAL_MIGRATION_MANIFEST_FILE"));
        require(vm.parseJsonUint(manifest, ".chainId") == block.chainid, "CHAIN_ID_MISMATCH");
        address sourceAddress = vm.parseJsonAddress(manifest, ".sourceReferral");
        VeydriftReferralSystem source = VeydriftReferralSystem(sourceAddress);
        require(sourceAddress != address(target), "SOURCE_EQUALS_TARGET");
        require(source.owner() == broadcaster, "BROADCASTER_NOT_SOURCE_OWNER");
        require(source.game() == address(0), "SOURCE_NOT_FROZEN");
        require(address(source).balance == 0, "SOURCE_BALANCE_NONZERO");
        require(target.owner() == broadcaster, "BROADCASTER_NOT_TARGET_OWNER");
        require(target.game() == address(0), "TARGET_ALREADY_ACTIVE");
        require(target.referralSigner() == source.referralSigner(), "REFERRAL_SIGNER_MISMATCH");
        require(target.referralSigner() != address(0), "REFERRAL_SIGNER_REQUIRED");

        bytes32 validDigest = vm.parseJsonBytes32(manifest, ".validCodeManifest.digest");
        uint32 validCount = _uint32(vm.parseJsonUint(manifest, ".validCodeManifest.count"));
        bytes32 hashOnlyDigest = vm.parseJsonBytes32(manifest, ".hashOnlyManifest.digest");
        uint32 hashOnlyCount = _uint32(vm.parseJsonUint(manifest, ".hashOnlyManifest.count"));
        bytes32 redemptionDigest = vm.parseJsonBytes32(manifest, ".redemptionManifest.digest");
        uint32 redemptionCount = _uint32(vm.parseJsonUint(manifest, ".redemptionManifest.count"));

        address[] memory validInviters =
            vm.parseJsonAddressArray(manifest, ".calldata.validInviters");
        string[] memory validCodes = vm.parseJsonStringArray(manifest, ".calldata.validCodes");
        uint64[] memory validActivatedAts =
            _uint64Array(vm.parseJsonUintArray(manifest, ".calldata.validActivatedAts"));
        bytes32[] memory validCommitments =
            vm.parseJsonBytes32Array(manifest, ".calldata.validSourceCommitments");
        address[] memory hashOnlyInviters =
            vm.parseJsonAddressArray(manifest, ".calldata.hashOnlyInviters");
        string[] memory hashOnlyCodes = vm.parseJsonStringArray(manifest, ".calldata.hashOnlyCodes");
        bytes32[] memory hashOnlyCommitments =
            vm.parseJsonBytes32Array(manifest, ".calldata.hashOnlySourceCommitments");
        address[] memory redemptionInviters =
            vm.parseJsonAddressArray(manifest, ".calldata.redemptionInviters");
        address[] memory redemptionInvitees =
            vm.parseJsonAddressArray(manifest, ".calldata.redemptionInvitees");
        bytes32[] memory redemptionCommitments =
            vm.parseJsonBytes32Array(manifest, ".calldata.redemptionCommitments");
        uint64[] memory redemptionRedeemedAts =
            _uint64Array(vm.parseJsonUintArray(manifest, ".calldata.redemptionRedeemedAts"));

        require(validInviters.length == validCount, "VALID_COUNT_MISMATCH");
        require(validCodes.length == validCount, "VALID_CODE_COUNT_MISMATCH");
        require(validActivatedAts.length == validCount, "VALID_TIME_COUNT_MISMATCH");
        require(validCommitments.length == validCount, "VALID_COMMITMENT_COUNT_MISMATCH");
        require(hashOnlyInviters.length == hashOnlyCount, "HASH_ONLY_COUNT_MISMATCH");
        require(hashOnlyCodes.length == hashOnlyCount, "HASH_ONLY_CODE_COUNT_MISMATCH");
        require(hashOnlyCommitments.length == hashOnlyCount, "HASH_ONLY_COMMITMENT_COUNT_MISMATCH");
        require(redemptionInviters.length == redemptionCount, "REDEMPTION_COUNT_MISMATCH");
        require(redemptionInvitees.length == redemptionCount, "REDEMPTION_INVITEE_COUNT_MISMATCH");
        require(
            redemptionCommitments.length == redemptionCount, "REDEMPTION_COMMITMENT_COUNT_MISMATCH"
        );
        require(redemptionRedeemedAts.length == redemptionCount, "REDEMPTION_TIME_COUNT_MISMATCH");

        vm.startBroadcast(privateKey);
        if (!target.referralMigrationConfigured()) {
            target.configureReferralCodeMigration(
                validDigest, validCount, hashOnlyDigest, hashOnlyCount
            );
        }
        if (!target.referralRedemptionMigrationConfigured()) {
            target.configureReferralRedemptionMigration(redemptionDigest, redemptionCount);
        }
        vm.stopBroadcast();

        _verifyConfiguration(
            target,
            validDigest,
            validCount,
            hashOnlyDigest,
            hashOnlyCount,
            redemptionDigest,
            redemptionCount
        );

        _migrateValid(
            target,
            privateKey,
            validInviters,
            validCodes,
            validActivatedAts,
            validCommitments,
            batchSize
        );
        _migrateHashOnly(
            target, privateKey, hashOnlyInviters, hashOnlyCodes, hashOnlyCommitments, batchSize
        );
        _migrateRedemptions(
            target,
            privateKey,
            redemptionInviters,
            redemptionInvitees,
            redemptionCommitments,
            redemptionRedeemedAts,
            batchSize
        );

        _verifyImported(
            target,
            validDigest,
            validCount,
            hashOnlyDigest,
            hashOnlyCount,
            redemptionDigest,
            redemptionCount
        );
        if (!target.referralMigrationFinalized()) {
            vm.startBroadcast(privateKey);
            target.finalizeReferralCodeMigration();
            vm.stopBroadcast();
        }
        require(target.referralMigrationFinalized(), "MIGRATION_NOT_FINALIZED");
        require(target.game() == address(0), "TARGET_ACTIVATED_DURING_MIGRATION");
        console2.log("Referral migration finalized:", address(target));
        console2.log("Valid/hash-only/redemptions:", validCount, hashOnlyCount, redemptionCount);
    }

    function _migrateValid(
        VeydriftReferralSystem target,
        uint256 privateKey,
        address[] memory inviters,
        string[] memory codes,
        uint64[] memory activatedAts,
        bytes32[] memory commitments,
        uint256 batchSize
    ) private {
        uint256 offset = target.referralMigrationImportedValidCount();
        require(offset <= inviters.length, "VALID_OFFSET_INVALID");
        while (offset < inviters.length) {
            uint256 end = _min(offset + batchSize, inviters.length);
            vm.startBroadcast(privateKey);
            target.migrateReferralCodes(
                _sliceAddress(inviters, offset, end),
                _sliceString(codes, offset, end),
                _sliceUint64(activatedAts, offset, end),
                _sliceBytes32(commitments, offset, end)
            );
            vm.stopBroadcast();
            offset = end;
        }
    }

    function _migrateHashOnly(
        VeydriftReferralSystem target,
        uint256 privateKey,
        address[] memory inviters,
        string[] memory codes,
        bytes32[] memory commitments,
        uint256 batchSize
    ) private {
        uint256 offset = target.referralMigrationImportedHashOnlyCount();
        require(offset <= inviters.length, "HASH_ONLY_OFFSET_INVALID");
        while (offset < inviters.length) {
            uint256 end = _min(offset + batchSize, inviters.length);
            vm.startBroadcast(privateKey);
            target.migrateLegacyReferralCodeOwnership(
                _sliceAddress(inviters, offset, end),
                _sliceString(codes, offset, end),
                _sliceBytes32(commitments, offset, end)
            );
            vm.stopBroadcast();
            offset = end;
        }
    }

    function _migrateRedemptions(
        VeydriftReferralSystem target,
        uint256 privateKey,
        address[] memory inviters,
        address[] memory invitees,
        bytes32[] memory commitments,
        uint64[] memory redeemedAts,
        uint256 batchSize
    ) private {
        uint256 offset = target.referralMigrationImportedRedemptionCount();
        require(offset <= inviters.length, "REDEMPTION_OFFSET_INVALID");
        while (offset < inviters.length) {
            uint256 end = _min(offset + batchSize, inviters.length);
            vm.startBroadcast(privateKey);
            target.migrateReferralRedemptions(
                _sliceAddress(inviters, offset, end),
                _sliceAddress(invitees, offset, end),
                _sliceBytes32(commitments, offset, end),
                _sliceUint64(redeemedAts, offset, end)
            );
            vm.stopBroadcast();
            offset = end;
        }
    }

    function _verifyConfiguration(
        VeydriftReferralSystem target,
        bytes32 validDigest,
        uint32 validCount,
        bytes32 hashOnlyDigest,
        uint32 hashOnlyCount,
        bytes32 redemptionDigest,
        uint32 redemptionCount
    ) private view {
        require(target.referralMigrationExpectedValidHash() == validDigest, "VALID_DIGEST_CONFIG");
        require(target.referralMigrationExpectedValidCount() == validCount, "VALID_COUNT_CONFIG");
        require(
            target.referralMigrationExpectedHashOnlyHash() == hashOnlyDigest, "HASH_DIGEST_CONFIG"
        );
        require(
            target.referralMigrationExpectedHashOnlyCount() == hashOnlyCount, "HASH_COUNT_CONFIG"
        );
        require(
            target.referralMigrationExpectedRedemptionHash() == redemptionDigest,
            "REDEMPTION_DIGEST_CONFIG"
        );
        require(
            target.referralMigrationExpectedRedemptionCount() == redemptionCount,
            "REDEMPTION_COUNT_CONFIG"
        );
    }

    function _verifyImported(
        VeydriftReferralSystem target,
        bytes32 validDigest,
        uint32 validCount,
        bytes32 hashOnlyDigest,
        uint32 hashOnlyCount,
        bytes32 redemptionDigest,
        uint32 redemptionCount
    ) private view {
        require(target.referralMigrationImportedValidHash() == validDigest, "VALID_DIGEST_IMPORTED");
        require(target.referralMigrationImportedValidCount() == validCount, "VALID_COUNT_IMPORTED");
        require(
            target.referralMigrationImportedHashOnlyHash() == hashOnlyDigest, "HASH_DIGEST_IMPORTED"
        );
        require(
            target.referralMigrationImportedHashOnlyCount() == hashOnlyCount, "HASH_COUNT_IMPORTED"
        );
        require(
            target.referralMigrationImportedRedemptionHash() == redemptionDigest,
            "REDEMPTION_DIGEST_IMPORTED"
        );
        require(
            target.referralMigrationImportedRedemptionCount() == redemptionCount,
            "REDEMPTION_COUNT_IMPORTED"
        );
    }

    function _uint32(uint256 value) private pure returns (uint32) {
        require(value <= type(uint32).max, "UINT32_OVERFLOW");
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32(value);
    }

    function _uint64Array(uint256[] memory source) private pure returns (uint64[] memory output) {
        output = new uint64[](source.length);
        for (uint256 index = 0; index < source.length; index++) {
            require(source[index] <= type(uint64).max, "UINT64_OVERFLOW");
            output[index] = uint64(source[index]);
        }
    }

    function _sliceAddress(address[] memory source, uint256 start, uint256 end)
        private
        pure
        returns (address[] memory output)
    {
        output = new address[](end - start);
        for (uint256 index = start; index < end; index++) {
            output[index - start] = source[index];
        }
    }

    function _sliceString(string[] memory source, uint256 start, uint256 end)
        private
        pure
        returns (string[] memory output)
    {
        output = new string[](end - start);
        for (uint256 index = start; index < end; index++) {
            output[index - start] = source[index];
        }
    }

    function _sliceUint64(uint64[] memory source, uint256 start, uint256 end)
        private
        pure
        returns (uint64[] memory output)
    {
        output = new uint64[](end - start);
        for (uint256 index = start; index < end; index++) {
            output[index - start] = source[index];
        }
    }

    function _sliceBytes32(bytes32[] memory source, uint256 start, uint256 end)
        private
        pure
        returns (bytes32[] memory output)
    {
        output = new bytes32[](end - start);
        for (uint256 index = start; index < end; index++) {
            output[index - start] = source[index];
        }
    }

    function _min(uint256 left, uint256 right) private pure returns (uint256) {
        return left < right ? left : right;
    }
}
