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
        require(batchSize > 0 && batchSize <= 20, "BATCH_SIZE_OUT_OF_BOUNDS");

        string memory manifest = vm.readFile(vm.envString("REFERRAL_MIGRATION_MANIFEST_FILE"));
        require(vm.parseJsonUint(manifest, ".version") == 2, "MANIFEST_VERSION_MISMATCH");
        require(vm.parseJsonUint(manifest, ".chainId") == block.chainid, "CHAIN_ID_MISMATCH");
        uint256 snapshotBlock = vm.parseUint(vm.parseJsonString(manifest, ".snapshotBlock"));
        require(
            vm.parseUint(vm.parseJsonString(manifest, ".indexFromBlock")) <= snapshotBlock
                && snapshotBlock <= block.number
                && vm.parseJsonBytes32(manifest, ".snapshotBlockHash") != bytes32(0),
            "SNAPSHOT_BOUNDARY_INVALID"
        );
        require(
            vm.parseJsonAddress(manifest, ".sourceGame") == address(0), "MANIFEST_SOURCE_NOT_FROZEN"
        );
        require(
            vm.parseUint(vm.parseJsonString(manifest, ".sourceBalanceWei")) == 0,
            "MANIFEST_SOURCE_BALANCE_NONZERO"
        );
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
        bytes32 rewardDigest = vm.parseJsonBytes32(manifest, ".rewardStatsManifest.digest");
        uint32 rewardCount = _uint32(vm.parseJsonUint(manifest, ".rewardStatsManifest.count"));
        bytes32 rewardClaimDigest = vm.parseJsonBytes32(manifest, ".rewardClaimManifest.digest");
        uint32 rewardClaimCount = _uint32(vm.parseJsonUint(manifest, ".rewardClaimManifest.count"));

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
        uint256[] memory redemptionRewardAmounts =
            vm.parseJsonUintArray(manifest, ".calldata.redemptionRewardAmounts");
        bool[] memory redemptionPaid = vm.parseJsonBoolArray(manifest, ".calldata.redemptionPaid");
        bool[] memory redemptionCredited =
            vm.parseJsonBoolArray(manifest, ".calldata.redemptionCredited");
        address[] memory rewardClaimInviters =
            vm.parseJsonAddressArray(manifest, ".calldata.rewardClaimInviters");
        address[] memory rewardClaimInvitees =
            vm.parseJsonAddressArray(manifest, ".calldata.rewardClaimInvitees");
        bytes32[] memory rewardClaimCommitments =
            vm.parseJsonBytes32Array(manifest, ".calldata.rewardClaimCommitments");
        address[] memory rewardClaimRecipients =
            vm.parseJsonAddressArray(manifest, ".calldata.rewardClaimRecipients");
        uint256[] memory rewardClaimAmounts =
            vm.parseJsonUintArray(manifest, ".calldata.rewardClaimAmounts");
        uint64[] memory rewardClaimAts =
            _uint64Array(vm.parseJsonUintArray(manifest, ".calldata.rewardClaimAts"));
        address[] memory rewardInviters =
            vm.parseJsonAddressArray(manifest, ".calldata.rewardInviters");
        uint256[] memory rewardAccrued = vm.parseJsonUintArray(manifest, ".calldata.rewardAccrued");
        uint256[] memory rewardPaid = vm.parseJsonUintArray(manifest, ".calldata.rewardPaid");
        uint256[] memory rewardClaimed = vm.parseJsonUintArray(manifest, ".calldata.rewardClaimed");

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
        require(
            redemptionRewardAmounts.length == redemptionCount
                && redemptionPaid.length == redemptionCount
                && redemptionCredited.length == redemptionCount,
            "REDEMPTION_HISTORY_COUNT_MISMATCH"
        );
        require(
            rewardClaimInviters.length == rewardClaimCount
                && rewardClaimInvitees.length == rewardClaimCount
                && rewardClaimCommitments.length == rewardClaimCount
                && rewardClaimRecipients.length == rewardClaimCount
                && rewardClaimAmounts.length == rewardClaimCount
                && rewardClaimAts.length == rewardClaimCount,
            "REWARD_CLAIM_COUNT_MISMATCH"
        );
        require(
            rewardInviters.length == rewardCount && rewardAccrued.length == rewardCount
                && rewardPaid.length == rewardCount && rewardClaimed.length == rewardCount,
            "REWARD_STATS_COUNT_MISMATCH"
        );
        require(
            source.owner() == vm.parseJsonAddress(manifest, ".sourceOwner"), "SOURCE_OWNER_DRIFT"
        );
        require(
            source.referralSigner() == vm.parseJsonAddress(manifest, ".sourceReferralSigner"),
            "SOURCE_SIGNER_DRIFT"
        );
        _verifyFrozenRewards(
            source,
            redemptionCommitments,
            redemptionInvitees,
            rewardInviters,
            rewardAccrued,
            rewardPaid,
            rewardClaimed
        );
        _verifyFrozenCodes(
            source,
            validInviters,
            validCodes,
            validActivatedAts,
            hashOnlyInviters,
            hashOnlyCodes,
            redemptionCommitments,
            redemptionInvitees
        );

        vm.startBroadcast(privateKey);
        if (!target.referralMigrationConfigured()) {
            target.configureReferralCodeMigration(
                validDigest, validCount, hashOnlyDigest, hashOnlyCount
            );
        }
        if (!target.referralRedemptionMigrationConfigured()) {
            target.configureReferralRedemptionMigration(redemptionDigest, redemptionCount);
        }
        if (!target.referralRewardMigrationConfigured()) {
            target.configureReferralRewardMigration(rewardDigest, rewardCount);
        }
        if (!target.referralRewardClaimMigrationConfigured()) {
            target.configureReferralRewardClaimMigration(rewardClaimDigest, rewardClaimCount);
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
        require(
            target.referralMigrationExpectedRewardStatsHash() == rewardDigest,
            "REWARD_DIGEST_CONFIG"
        );
        require(
            target.referralMigrationExpectedRewardStatsCount() == rewardCount, "REWARD_COUNT_CONFIG"
        );
        require(
            target.referralMigrationExpectedRewardClaimHash() == rewardClaimDigest,
            "CLAIM_DIGEST_CONFIG"
        );
        require(
            target.referralMigrationExpectedRewardClaimCount() == rewardClaimCount,
            "CLAIM_COUNT_CONFIG"
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
            redemptionRewardAmounts,
            redemptionPaid,
            redemptionCredited,
            batchSize
        );
        _migrateRewardClaimHistory(
            target,
            privateKey,
            rewardClaimInviters,
            rewardClaimInvitees,
            rewardClaimCommitments,
            rewardClaimRecipients,
            rewardClaimAmounts,
            rewardClaimAts,
            batchSize
        );

        _migrateRewardStats(
            target, privateKey, rewardInviters, rewardAccrued, rewardPaid, rewardClaimed, batchSize
        );
        _verifyFrozenRewards(
            source,
            redemptionCommitments,
            redemptionInvitees,
            rewardInviters,
            rewardAccrued,
            rewardPaid,
            rewardClaimed
        );
        _verifyFrozenCodes(
            source,
            validInviters,
            validCodes,
            validActivatedAts,
            hashOnlyInviters,
            hashOnlyCodes,
            redemptionCommitments,
            redemptionInvitees
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
        require(
            target.referralMigrationImportedRewardStatsHash() == rewardDigest,
            "REWARD_DIGEST_IMPORTED"
        );
        require(
            target.referralMigrationImportedRewardStatsCount() == rewardCount,
            "REWARD_COUNT_IMPORTED"
        );
        require(
            target.referralMigrationImportedRewardClaimHash() == rewardClaimDigest,
            "CLAIM_DIGEST_IMPORTED"
        );
        require(
            target.referralMigrationImportedRewardClaimCount() == rewardClaimCount,
            "CLAIM_COUNT_IMPORTED"
        );
        for (uint256 i; i < rewardCount; ++i) {
            require(
                target.totalReferralRewardsAccrued(rewardInviters[i]) == rewardAccrued[i]
                    && target.totalReferralRewardsPaid(rewardInviters[i]) == rewardPaid[i]
                    && target.totalReferralRewardsClaimed(rewardInviters[i]) == rewardClaimed[i],
                "TARGET_REWARD_STATS_MISMATCH"
            );
        }
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

    function _verifyFrozenCodes(
        VeydriftReferralSystem source,
        address[] memory validInviters,
        string[] memory validCodes,
        uint64[] memory activatedAts,
        address[] memory hashOnlyInviters,
        string[] memory hashOnlyCodes,
        bytes32[] memory redeemedCommitments,
        address[] memory redeemedInvitees
    ) private view {
        require(source.game() == address(0), "SOURCE_NOT_FROZEN");
        for (uint256 i; i < validCodes.length; ++i) {
            bytes32 codeHash = source.referralCodeHash(validCodes[i]);
            bytes32 commitment = source.referralCommitment(validInviters[i], codeHash);
            require(
                source.referralCodeOwner(codeHash) == validInviters[i]
                    && source.referralInvites(commitment) == validInviters[i]
                    && source.referralCodeHashOf(commitment) == codeHash
                    && source.referralClaimedAt(commitment) == activatedAts[i]
                    && source.referralCodeMigrationKind(codeHash) != 2,
                "SOURCE_VALID_CODE_CHANGED"
            );
        }
        for (uint256 i; i < hashOnlyCodes.length; ++i) {
            bytes32 codeHash = _normalizedHashOnly(hashOnlyCodes[i]);
            require(
                source.referralCodeOwner(codeHash) == hashOnlyInviters[i]
                    && source.referralCodeMigrationKind(codeHash) == 2,
                "SOURCE_HASH_ONLY_CHANGED"
            );
        }
        for (uint256 i; i < redeemedCommitments.length; ++i) {
            require(
                source.referralRedemptions(redeemedCommitments[i], redeemedInvitees[i])
                    && source.referralInviteeRedeemed(redeemedInvitees[i]),
                "SOURCE_REDEMPTION_CHANGED"
            );
        }
    }

    function _normalizedHashOnly(string memory code) private pure returns (bytes32) {
        bytes memory original = bytes(code);
        require(original.length == 43, "HASH_ONLY_LENGTH_MISMATCH");
        bytes memory normalized = new bytes(original.length);
        for (uint256 i; i < original.length; ++i) {
            uint8 character = uint8(original[i]);
            normalized[i] =
                character >= 65 && character <= 90 ? bytes1(character + 32) : original[i];
        }
        return keccak256(normalized);
    }

    function _verifyFrozenRewards(
        VeydriftReferralSystem source,
        bytes32[] memory commitments,
        address[] memory invitees,
        address[] memory inviters,
        uint256[] memory accrued,
        uint256[] memory paid,
        uint256[] memory claimed
    ) private view {
        require(source.game() == address(0), "SOURCE_NOT_FROZEN");
        require(address(source).balance == 0, "SOURCE_BALANCE_NONZERO");
        for (uint256 i; i < commitments.length; ++i) {
            require(
                source.referralRewardCredits(commitments[i], invitees[i]) == 0,
                "SOURCE_CREDIT_NONZERO"
            );
        }
        for (uint256 i; i < inviters.length; ++i) {
            address inviter = inviters[i];
            require(source.claimableReferralRewards(inviter) == 0, "SOURCE_ESCROW_NONZERO");
            require(
                source.totalReferralRewardsAccrued(inviter) == accrued[i]
                    && source.totalReferralRewardsPaid(inviter) == paid[i]
                    && source.totalReferralRewardsClaimed(inviter) == claimed[i],
                "SOURCE_REWARD_STATS_CHANGED"
            );
        }
    }

    function _migrateRewardStats(
        VeydriftReferralSystem target,
        uint256 privateKey,
        address[] memory inviters,
        uint256[] memory accrued,
        uint256[] memory paid,
        uint256[] memory claimed,
        uint256 batchSize
    ) private {
        uint256 offset = target.referralMigrationImportedRewardStatsCount();
        require(offset <= inviters.length, "REWARD_OFFSET_INVALID");
        while (offset < inviters.length) {
            uint256 end = _min(offset + batchSize, inviters.length);
            vm.startBroadcast(privateKey);
            target.migrateReferralRewardStats(
                _sliceAddress(inviters, offset, end),
                _sliceUint256(accrued, offset, end),
                _sliceUint256(paid, offset, end),
                _sliceUint256(claimed, offset, end)
            );
            vm.stopBroadcast();
            offset = end;
        }
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
        uint256[] memory rewardAmounts,
        bool[] memory paid,
        bool[] memory credited,
        uint256 batchSize
    ) private {
        uint256 offset = target.referralMigrationImportedRedemptionCount();
        require(offset <= inviters.length, "REDEMPTION_OFFSET_INVALID");
        while (offset < inviters.length) {
            uint256 end = _min(offset + batchSize, inviters.length);
            vm.startBroadcast(privateKey);
            target.migrateReferralRedemptionsWithHistory(
                _sliceAddress(inviters, offset, end),
                _sliceAddress(invitees, offset, end),
                _sliceBytes32(commitments, offset, end),
                _sliceUint64(redeemedAts, offset, end),
                _sliceUint256(rewardAmounts, offset, end),
                _sliceBool(paid, offset, end),
                _sliceBool(credited, offset, end)
            );
            vm.stopBroadcast();
            offset = end;
        }
    }

    function _migrateRewardClaimHistory(
        VeydriftReferralSystem target,
        uint256 privateKey,
        address[] memory inviters,
        address[] memory invitees,
        bytes32[] memory commitments,
        address[] memory recipients,
        uint256[] memory amounts,
        uint64[] memory claimedAts,
        uint256 batchSize
    ) private {
        uint256 offset = target.referralMigrationImportedRewardClaimCount();
        require(offset <= inviters.length, "CLAIM_OFFSET_INVALID");
        while (offset < inviters.length) {
            uint256 end = _min(offset + batchSize, inviters.length);
            vm.startBroadcast(privateKey);
            target.migrateReferralRewardClaimHistory(
                _sliceAddress(inviters, offset, end),
                _sliceAddress(invitees, offset, end),
                _sliceBytes32(commitments, offset, end),
                _sliceAddress(recipients, offset, end),
                _sliceUint256(amounts, offset, end),
                _sliceUint64(claimedAts, offset, end)
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

    function _sliceUint256(uint256[] memory source, uint256 start, uint256 end)
        private
        pure
        returns (uint256[] memory output)
    {
        output = new uint256[](end - start);
        for (uint256 index = start; index < end; index++) {
            output[index - start] = source[index];
        }
    }

    function _sliceBool(bool[] memory source, uint256 start, uint256 end)
        private
        pure
        returns (bool[] memory output)
    {
        output = new bool[](end - start);
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
