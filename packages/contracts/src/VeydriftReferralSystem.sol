// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IVeydriftReferralGame {
    function homePlanetOf(address player) external view returns (uint256);
    function startPrice() external view returns (uint256);
}

contract VeydriftReferralSystem {
    bytes32 public constant REFERRAL_REDEEM_DOMAIN = keccak256("veydrift.referral.redeem.v1");
    uint8 public constant REFERRAL_CLAIM_LIMIT = 3;
    uint8 public constant REFERRAL_CODE_MAX_LENGTH = 24;
    uint8 public constant REFERRAL_LEGACY_CODE_LENGTH = 43;
    uint8 public constant REFERRAL_MIGRATION_KIND_VALID = 1;
    uint8 public constant REFERRAL_MIGRATION_KIND_HASH_ONLY = 2;
    uint64 public constant REFERRAL_CLAIM_WINDOW = 1 days;
    uint256 public constant DIRECT_PAYOUT_GAS = 30_000;

    struct ReferralInvite {
        address inviter;
    }

    struct ReferralRedemptionWindow {
        uint64[3] redeemedAt;
    }

    address public owner;
    address public game;
    address public referralSigner;
    bool public referralMigrationFinalized;
    bool public referralMigrationConfigured;
    bytes32 public referralMigrationExpectedValidHash;
    bytes32 public referralMigrationExpectedHashOnlyHash;
    bytes32 public referralMigrationImportedValidHash;
    bytes32 public referralMigrationImportedHashOnlyHash;
    uint32 public referralMigrationExpectedValidCount;
    uint32 public referralMigrationExpectedHashOnlyCount;
    uint32 public referralMigrationImportedValidCount;
    uint32 public referralMigrationImportedHashOnlyCount;
    mapping(bytes32 codeHash => address codeOwner) public referralCodeOwner;
    mapping(bytes32 codeHash => uint8 migrationKind) public referralCodeMigrationKind;
    mapping(address codeOwner => mapping(bytes32 codeHash => bool owned)) public
        referralCodeOwnedBy;
    mapping(bytes32 commitment => bytes32 codeHash) public referralCodeHashOf;
    mapping(bytes32 commitment => ReferralInvite invite) public referralInvites;
    mapping(address inviter => bytes32 commitment) public referralCommitmentOf;
    mapping(bytes32 commitment => uint64 claimedAt) public referralClaimedAt;
    mapping(bytes32 commitment => ReferralRedemptionWindow redemptionWindow) private
        _referralRedemptionWindows;
    mapping(bytes32 commitment => mapping(address invitee => bool redeemed)) public
        referralRedemptions;
    mapping(address invitee => bool redeemed) public referralInviteeRedeemed;
    mapping(address inviter => uint256 amount) public claimableReferralRewards;
    mapping(address inviter => uint256 amount) public totalReferralRewardsAccrued;
    mapping(address inviter => uint256 amount) public totalReferralRewardsPaid;
    mapping(address inviter => uint256 amount) public totalReferralRewardsClaimed;
    mapping(bytes32 commitment => mapping(address invitee => uint256 amount)) public
        referralRewardCredits;
    bool private _withdrawingReferralReward;

    error Unauthorized(address account);
    error ReferralSignerUnset();
    error ReferralCodeInvalid();
    error ReferralCodeAlreadyOwned(bytes32 codeHash, address owner);
    error ReferralCommitmentInvalid();
    error ReferralInviteInvalid(bytes32 commitment);
    error ReferralInviteAlreadyClaimed(address inviter, bytes32 commitment);
    error ReferralInviteExpired(bytes32 commitment, uint64 expiredAt);
    error ReferralInviteeAlreadyRedeemed(bytes32 commitment, address invitee);
    error ReferralSignatureInvalid();
    error ReferralSelfInvite();
    error ReferralRedemptionQuotaExceeded(bytes32 commitment, uint64 resetsAt);
    error ReferralRewardInvalid(uint256 expected, uint256 received);
    error ReferralRewardRecipientInvalid();
    error ReferralRewardUnavailable();
    error ReferralRewardWithdrawalFailed(address recipient, uint256 amount);
    error ReferralRewardWithdrawalReentered();
    error ReferralMigrationAlreadyFinalized();
    error ReferralMigrationAlreadyConfigured();
    error ReferralMigrationNotConfigured();
    error ReferralMigrationManifestInvalid(bytes32 manifestHash, uint32 count);
    error ReferralMigrationManifestMismatch(
        bytes32 expectedValidHash,
        bytes32 importedValidHash,
        uint32 expectedValidCount,
        uint32 importedValidCount,
        bytes32 expectedHashOnlyHash,
        bytes32 importedHashOnlyHash,
        uint32 expectedHashOnlyCount,
        uint32 importedHashOnlyCount
    );
    error ReferralMigrationCountExceeded(uint8 kind, uint32 expectedCount);
    error ReferralMigrationCodeAlreadyImported(bytes32 codeHash, uint8 kind);
    error ReferralMigrationCommitmentMismatch(bytes32 expected, bytes32 received);
    error ReferralMigrationPending();
    error ReferralMigrationLengthMismatch();
    error ReferralMigrationTimestampInvalid(uint64 activatedAt);

    event ReferralGameUpdated(address indexed oldGame, address indexed newGame);
    event ReferralSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event ReferralCodeOwnershipClaimed(
        address indexed owner, bytes32 indexed codeHash, string code, uint64 ownedAt, bool migrated
    );
    event ReferralInviteWindowActivated(
        address indexed inviter,
        bytes32 indexed codeHash,
        bytes32 indexed commitment,
        string code,
        uint64 activatedAt,
        uint64 activeUntil,
        bool migrated
    );
    event ReferralCodeClaimed(
        address indexed inviter, bytes32 indexed commitment, uint64 claimedAt
    );
    event ReferralCodeMigrationFinalized(uint64 finalizedAt);
    event ReferralCodeMigrationConfigured(
        bytes32 indexed expectedValidHash,
        uint32 expectedValidCount,
        bytes32 indexed expectedHashOnlyHash,
        uint32 expectedHashOnlyCount
    );
    event ReferralLegacyCodeOwnershipImported(
        address indexed owner,
        bytes32 indexed codeHash,
        bytes32 indexed legacyCommitment,
        bytes32 manifestLeaf
    );
    event ReferralRedemptionQuotaUpdated(
        address indexed inviter,
        uint8 remainingRedemptions,
        uint64 nextRedemptionAt,
        uint64 updatedAt
    );
    event ReferralInviteRedeemed(
        address indexed inviter,
        address indexed invitee,
        bytes32 indexed commitment,
        uint256 rewardAmount,
        bool paid,
        bool credited,
        uint64 redeemedAt
    );
    event ReferralRewardClaimed(
        address indexed inviter,
        address indexed invitee,
        bytes32 indexed commitment,
        address recipient,
        uint256 amount,
        uint64 claimedAt
    );

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert Unauthorized(address(0));
        owner = initialOwner;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyGame() {
        if (msg.sender != game) revert Unauthorized(msg.sender);
        _;
    }

    function setGame(address nextGame) external onlyOwner {
        address oldGame = game;
        game = nextGame;
        emit ReferralGameUpdated(oldGame, nextGame);
    }

    function setReferralSigner(address nextSigner) external onlyOwner {
        address oldSigner = referralSigner;
        referralSigner = nextSigner;
        emit ReferralSignerUpdated(oldSigner, nextSigner);
    }

    function configureReferralCodeMigration(
        bytes32 expectedValidHash,
        uint32 expectedValidCount,
        bytes32 expectedHashOnlyHash,
        uint32 expectedHashOnlyCount
    ) external onlyOwner {
        if (referralMigrationFinalized) {
            revert ReferralMigrationAlreadyFinalized();
        }
        if (referralMigrationConfigured) revert ReferralMigrationAlreadyConfigured();
        _validateMigrationManifest(expectedValidHash, expectedValidCount);
        _validateMigrationManifest(expectedHashOnlyHash, expectedHashOnlyCount);

        referralMigrationConfigured = true;
        referralMigrationExpectedValidHash = expectedValidHash;
        referralMigrationExpectedValidCount = expectedValidCount;
        referralMigrationExpectedHashOnlyHash = expectedHashOnlyHash;
        referralMigrationExpectedHashOnlyCount = expectedHashOnlyCount;
        emit ReferralCodeMigrationConfigured(
            expectedValidHash, expectedValidCount, expectedHashOnlyHash, expectedHashOnlyCount
        );
    }

    function migrateReferralCodes(
        address[] calldata inviters,
        string[] calldata codes,
        uint64[] calldata activatedAts,
        bytes32[] calldata legacyCommitments
    ) external onlyOwner {
        if (referralMigrationFinalized) {
            revert ReferralMigrationAlreadyFinalized();
        }
        if (!referralMigrationConfigured) revert ReferralMigrationNotConfigured();
        if (
            inviters.length != codes.length || codes.length != activatedAts.length
                || activatedAts.length != legacyCommitments.length
        ) {
            revert ReferralMigrationLengthMismatch();
        }

        for (uint256 index = 0; index < codes.length; index++) {
            address inviter = inviters[index];
            if (inviter == address(0)) revert Unauthorized(address(0));
            uint64 activatedAt = activatedAts[index];
            // Referral windows are intentionally timestamp-based; small validator skew cannot
            // transfer ownership or bypass the invite-window quota.
            // forge-lint: disable-next-line(block-timestamp)
            if (activatedAt > block.timestamp) {
                revert ReferralMigrationTimestampInvalid(activatedAt);
            }
            (string memory normalizedCode, bytes32 codeHash) = _normalizedReferralCode(codes[index]);
            bytes32 expectedCommitment = keccak256(bytes(codes[index]));
            bytes32 legacyCommitment = legacyCommitments[index];
            if (legacyCommitment != expectedCommitment) {
                revert ReferralMigrationCommitmentMismatch(expectedCommitment, legacyCommitment);
            }
            _claimCodeOwnership(inviter, codeHash, normalizedCode, activatedAt, true);
            _recordMigrationCode(codeHash, REFERRAL_MIGRATION_KIND_VALID);
            _recordActivation(inviter, codeHash, normalizedCode, activatedAt, true);
            _recordMigrationLeaf(
                referralMigrationLeafValid(inviter, codeHash, legacyCommitment, activatedAt),
                REFERRAL_MIGRATION_KIND_VALID
            );
        }
    }

    function migrateLegacyReferralCodeOwnership(
        address[] calldata inviters,
        string[] calldata codes,
        bytes32[] calldata legacyCommitments
    ) external onlyOwner {
        if (referralMigrationFinalized) {
            revert ReferralMigrationAlreadyFinalized();
        }
        if (!referralMigrationConfigured) revert ReferralMigrationNotConfigured();
        if (inviters.length != codes.length || codes.length != legacyCommitments.length) {
            revert ReferralMigrationLengthMismatch();
        }

        for (uint256 index = 0; index < codes.length; index++) {
            address inviter = inviters[index];
            if (inviter == address(0)) revert Unauthorized(address(0));
            (, bytes32 codeHash) = _normalizedLegacyReferralCode(codes[index]);
            bytes32 expectedCommitment = keccak256(bytes(codes[index]));
            bytes32 legacyCommitment = legacyCommitments[index];
            if (legacyCommitment != expectedCommitment) {
                revert ReferralMigrationCommitmentMismatch(expectedCommitment, legacyCommitment);
            }
            _claimLegacyCodeOwnership(inviter, codeHash);
            _recordMigrationCode(codeHash, REFERRAL_MIGRATION_KIND_HASH_ONLY);
            bytes32 manifestLeaf =
                referralMigrationLeafHashOnly(inviter, codeHash, legacyCommitment);
            _recordMigrationLeaf(manifestLeaf, REFERRAL_MIGRATION_KIND_HASH_ONLY);
            emit ReferralLegacyCodeOwnershipImported(
                inviter, codeHash, legacyCommitment, manifestLeaf
            );
        }
    }

    function finalizeReferralCodeMigration() external onlyOwner {
        if (referralMigrationFinalized) revert ReferralMigrationAlreadyFinalized();
        if (!referralMigrationConfigured) revert ReferralMigrationNotConfigured();
        if (
            referralMigrationImportedValidHash != referralMigrationExpectedValidHash
                || referralMigrationImportedValidCount != referralMigrationExpectedValidCount
                || referralMigrationImportedHashOnlyHash != referralMigrationExpectedHashOnlyHash
                || referralMigrationImportedHashOnlyCount != referralMigrationExpectedHashOnlyCount
        ) {
            revert ReferralMigrationManifestMismatch(
                referralMigrationExpectedValidHash,
                referralMigrationImportedValidHash,
                referralMigrationExpectedValidCount,
                referralMigrationImportedValidCount,
                referralMigrationExpectedHashOnlyHash,
                referralMigrationImportedHashOnlyHash,
                referralMigrationExpectedHashOnlyCount,
                referralMigrationImportedHashOnlyCount
            );
        }
        referralMigrationFinalized = true;
        emit ReferralCodeMigrationFinalized(uint64(block.timestamp));
    }

    function claimReferralCode(string calldata code) external {
        if (!referralMigrationFinalized) revert ReferralMigrationPending();
        if (game == address(0) || IVeydriftReferralGame(game).homePlanetOf(msg.sender) == 0) {
            revert Unauthorized(msg.sender);
        }

        bytes32 existingCommitment = referralCommitmentOf[msg.sender];
        if (existingCommitment != bytes32(0) && !_isExpired(existingCommitment)) {
            revert ReferralInviteAlreadyClaimed(msg.sender, existingCommitment);
        }

        (string memory normalizedCode, bytes32 codeHash) = _normalizedReferralCode(code);
        if (referralCodeMigrationKind[codeHash] == REFERRAL_MIGRATION_KIND_HASH_ONLY) {
            revert ReferralCodeInvalid();
        }
        uint64 nowTimestamp = uint64(block.timestamp);
        _claimCodeOwnership(msg.sender, codeHash, normalizedCode, nowTimestamp, false);
        _recordActivation(msg.sender, codeHash, normalizedCode, nowTimestamp, false);
    }

    function redeemReferralInvite(
        address invitee,
        bytes32 commitment,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable onlyGame returns (address inviter) {
        if (commitment == bytes32(0)) revert ReferralCommitmentInvalid();
        address signer = referralSigner;
        if (signer == address(0)) revert ReferralSignerUnset();

        ReferralInvite storage invite = referralInvites[commitment];
        inviter = invite.inviter;
        if (inviter == address(0)) revert ReferralInviteInvalid(commitment);
        uint64 nowTimestamp = uint64(block.timestamp);
        uint64 claimedAt = referralClaimedAt[commitment];
        uint64 expiredAt = claimedAt + REFERRAL_CLAIM_WINDOW;
        if (
            claimedAt == 0 || nowTimestamp >= expiredAt
                || referralCommitmentOf[inviter] != commitment
        ) {
            revert ReferralInviteExpired(commitment, expiredAt);
        }
        bytes32 codeHash = referralCodeHashOf[commitment];
        if (referralCodeOwner[codeHash] != inviter) revert ReferralInviteInvalid(commitment);
        if (inviter == invitee) revert ReferralSelfInvite();
        if (referralInviteeRedeemed[invitee] || referralRedemptions[commitment][invitee]) {
            revert ReferralInviteeAlreadyRedeemed(commitment, invitee);
        }
        if (!_validReferralSignature(invitee, commitment, v, r, s, signer)) {
            revert ReferralSignatureInvalid();
        }

        uint256 expectedReward = IVeydriftReferralGame(game).startPrice() / 2;
        if (msg.value != expectedReward) {
            revert ReferralRewardInvalid(expectedReward, msg.value);
        }

        _consumeRedemptionQuota(commitment);
        referralRedemptions[commitment][invitee] = true;
        referralInviteeRedeemed[invitee] = true;
        totalReferralRewardsAccrued[inviter] += msg.value;

        (bool paid,) = payable(inviter).call{value: msg.value, gas: DIRECT_PAYOUT_GAS}("");
        bool credited = !paid;
        if (paid) {
            totalReferralRewardsPaid[inviter] += msg.value;
        } else {
            claimableReferralRewards[inviter] += msg.value;
            referralRewardCredits[commitment][invitee] = msg.value;
        }
        emit ReferralInviteRedeemed(
            inviter, invitee, commitment, msg.value, paid, credited, nowTimestamp
        );
        (uint8 remainingRedemptions, uint64 nextRedemptionAt) = _referralRedemptionQuota(commitment);
        emit ReferralRedemptionQuotaUpdated(
            inviter, remainingRedemptions, nextRedemptionAt, nowTimestamp
        );
    }

    function withdrawReferralReward(bytes32 commitment, address invitee, address payable recipient)
        external
    {
        if (_withdrawingReferralReward) revert ReferralRewardWithdrawalReentered();
        if (referralInvites[commitment].inviter != msg.sender) revert Unauthorized(msg.sender);
        if (recipient == address(0)) revert ReferralRewardRecipientInvalid();
        uint256 amount = referralRewardCredits[commitment][invitee];
        if (amount == 0) revert ReferralRewardUnavailable();

        _withdrawingReferralReward = true;
        referralRewardCredits[commitment][invitee] = 0;
        claimableReferralRewards[msg.sender] -= amount;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) {
            referralRewardCredits[commitment][invitee] = amount;
            claimableReferralRewards[msg.sender] += amount;
            _withdrawingReferralReward = false;
            revert ReferralRewardWithdrawalFailed(recipient, amount);
        }
        totalReferralRewardsPaid[msg.sender] += amount;
        totalReferralRewardsClaimed[msg.sender] += amount;
        _withdrawingReferralReward = false;
        emit ReferralRewardClaimed(
            msg.sender, invitee, commitment, recipient, amount, uint64(block.timestamp)
        );
    }

    function normalizeReferralCode(string calldata code)
        external
        pure
        returns (string memory normalizedCode)
    {
        (normalizedCode,) = _normalizedReferralCode(code);
    }

    function referralCodeHash(string calldata code) external pure returns (bytes32 codeHash) {
        (, codeHash) = _normalizedReferralCode(code);
    }

    function referralCommitment(address inviter, bytes32 codeHash) public pure returns (bytes32) {
        return keccak256(abi.encode(inviter, codeHash));
    }

    function referralMigrationLeafValid(
        address inviter,
        bytes32 codeHash,
        bytes32 legacyCommitment,
        uint64 activatedAt
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                REFERRAL_MIGRATION_KIND_VALID, inviter, codeHash, legacyCommitment, activatedAt
            )
        );
    }

    function referralMigrationLeafHashOnly(
        address inviter,
        bytes32 codeHash,
        bytes32 legacyCommitment
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(REFERRAL_MIGRATION_KIND_HASH_ONLY, inviter, codeHash, legacyCommitment)
        );
    }

    function referralCodeState(bytes32 codeHash)
        external
        view
        returns (address codeOwner, bytes32 commitment, uint64 activeUntil, bool active)
    {
        codeOwner = referralCodeOwner[codeHash];
        if (codeOwner == address(0)) return (address(0), bytes32(0), 0, false);
        commitment = referralCommitment(codeOwner, codeHash);
        uint64 claimedAt = referralClaimedAt[commitment];
        if (claimedAt != 0) activeUntil = claimedAt + REFERRAL_CLAIM_WINDOW;
        // forge-lint: disable-next-line(block-timestamp)
        active = referralCommitmentOf[codeOwner] == commitment && block.timestamp < activeUntil;
    }

    function referralInviteState(address inviter)
        external
        view
        returns (
            bytes32 codeHash,
            bytes32 commitment,
            uint64 activeUntil,
            bool active,
            uint8 remainingRedemptions,
            uint64 nextRedemptionAt
        )
    {
        commitment = referralCommitmentOf[inviter];
        codeHash = referralCodeHashOf[commitment];
        uint64 claimedAt = referralClaimedAt[commitment];
        if (claimedAt != 0) activeUntil = claimedAt + REFERRAL_CLAIM_WINDOW;
        // forge-lint: disable-next-line(block-timestamp)
        active = commitment != bytes32(0) && block.timestamp < activeUntil;
        (remainingRedemptions, nextRedemptionAt) = _referralRedemptionQuota(commitment);
    }

    function referralRedemptionQuota(bytes32 commitment)
        external
        view
        returns (uint8 remainingRedemptions, uint64 nextRedemptionAt)
    {
        return _referralRedemptionQuota(commitment);
    }

    function referralRedemptionQuotaOf(address inviter)
        public
        view
        returns (uint8 remainingRedemptions, uint64 nextRedemptionAt)
    {
        return _referralRedemptionQuota(referralCommitmentOf[inviter]);
    }

    function _referralRedemptionQuota(bytes32 commitment)
        private
        view
        returns (uint8 remainingRedemptions, uint64 nextRedemptionAt)
    {
        ReferralRedemptionWindow storage window = _referralRedemptionWindows[commitment];
        uint64 nowTimestamp = uint64(block.timestamp);
        uint64 oldestActive = type(uint64).max;
        uint8 active;

        for (uint256 index = 0; index < REFERRAL_CLAIM_LIMIT; index++) {
            uint64 redeemedAt = window.redeemedAt[index];
            if (redeemedAt == 0 || nowTimestamp >= redeemedAt + REFERRAL_CLAIM_WINDOW) {
                continue;
            }
            active += 1;
            if (redeemedAt < oldestActive) oldestActive = redeemedAt;
        }

        remainingRedemptions = REFERRAL_CLAIM_LIMIT - active;
        if (remainingRedemptions == 0) {
            nextRedemptionAt = oldestActive + REFERRAL_CLAIM_WINDOW;
        }
    }

    function _claimCodeOwnership(
        address inviter,
        bytes32 codeHash,
        string memory normalizedCode,
        uint64 ownedAt,
        bool migrated
    ) private {
        address existingOwner = referralCodeOwner[codeHash];
        if (existingOwner != address(0) && existingOwner != inviter) {
            revert ReferralCodeAlreadyOwned(codeHash, existingOwner);
        }
        if (existingOwner == address(0)) {
            referralCodeOwner[codeHash] = inviter;
            referralCodeOwnedBy[inviter][codeHash] = true;
            emit ReferralCodeOwnershipClaimed(inviter, codeHash, normalizedCode, ownedAt, migrated);
        }
    }

    function _claimLegacyCodeOwnership(address inviter, bytes32 codeHash) private {
        address existingOwner = referralCodeOwner[codeHash];
        if (existingOwner != address(0) && existingOwner != inviter) {
            revert ReferralCodeAlreadyOwned(codeHash, existingOwner);
        }
        if (existingOwner == address(0)) {
            referralCodeOwner[codeHash] = inviter;
            referralCodeOwnedBy[inviter][codeHash] = true;
        }
    }

    function _validateMigrationManifest(bytes32 manifestHash, uint32 count) private pure {
        if ((count == 0) != (manifestHash == bytes32(0))) {
            revert ReferralMigrationManifestInvalid(manifestHash, count);
        }
    }

    function _recordMigrationCode(bytes32 codeHash, uint8 kind) private {
        uint8 existingKind = referralCodeMigrationKind[codeHash];
        if (existingKind != 0) {
            revert ReferralMigrationCodeAlreadyImported(codeHash, existingKind);
        }
        referralCodeMigrationKind[codeHash] = kind;
    }

    function _recordMigrationLeaf(bytes32 manifestLeaf, uint8 kind) private {
        if (kind == REFERRAL_MIGRATION_KIND_VALID) {
            uint32 nextCount = referralMigrationImportedValidCount + 1;
            if (nextCount > referralMigrationExpectedValidCount) {
                revert ReferralMigrationCountExceeded(kind, referralMigrationExpectedValidCount);
            }
            referralMigrationImportedValidCount = nextCount;
            referralMigrationImportedValidHash = referralMigrationImportedValidHash ^ manifestLeaf;
            return;
        }

        uint32 hashOnlyNextCount = referralMigrationImportedHashOnlyCount + 1;
        if (hashOnlyNextCount > referralMigrationExpectedHashOnlyCount) {
            revert ReferralMigrationCountExceeded(kind, referralMigrationExpectedHashOnlyCount);
        }
        referralMigrationImportedHashOnlyCount = hashOnlyNextCount;
        referralMigrationImportedHashOnlyHash = referralMigrationImportedHashOnlyHash ^ manifestLeaf;
    }

    function _recordActivation(
        address inviter,
        bytes32 codeHash,
        string memory normalizedCode,
        uint64 activatedAt,
        bool migrated
    ) private {
        bytes32 commitment = referralCommitment(inviter, codeHash);
        referralInvites[commitment] = ReferralInvite({inviter: inviter});
        referralCodeHashOf[commitment] = codeHash;

        uint64 previousActivatedAt = referralClaimedAt[commitment];
        if (activatedAt >= previousActivatedAt) {
            referralClaimedAt[commitment] = activatedAt;
            delete _referralRedemptionWindows[commitment];
        }

        bytes32 currentCommitment = referralCommitmentOf[inviter];
        if (
            currentCommitment == bytes32(0)
                || referralClaimedAt[commitment] >= referralClaimedAt[currentCommitment]
        ) {
            referralCommitmentOf[inviter] = commitment;
        }

        uint64 activeUntil = activatedAt + REFERRAL_CLAIM_WINDOW;
        emit ReferralInviteWindowActivated(
            inviter, codeHash, commitment, normalizedCode, activatedAt, activeUntil, migrated
        );
        emit ReferralCodeClaimed(inviter, commitment, activatedAt);
    }

    function _normalizedReferralCode(string memory code)
        private
        pure
        returns (string memory normalizedCode, bytes32 codeHash)
    {
        bytes memory source = bytes(code);
        if (source.length == 0 || source.length > REFERRAL_CODE_MAX_LENGTH) {
            revert ReferralCodeInvalid();
        }

        return _normalizeReferralCode(source);
    }

    function _normalizedLegacyReferralCode(string memory code)
        private
        pure
        returns (string memory normalizedCode, bytes32 codeHash)
    {
        bytes memory source = bytes(code);
        if (source.length != REFERRAL_LEGACY_CODE_LENGTH) revert ReferralCodeInvalid();
        return _normalizeReferralCode(source);
    }

    function _normalizeReferralCode(bytes memory source)
        private
        pure
        returns (string memory normalizedCode, bytes32 codeHash)
    {
        bytes memory normalized = new bytes(source.length);
        for (uint256 index = 0; index < source.length; index++) {
            uint8 character = uint8(source[index]);
            bool valid = (character >= 48 && character <= 57)
                || (character >= 65 && character <= 90) || (character >= 97 && character <= 122)
                || character == 45 || character == 95;
            if (!valid) revert ReferralCodeInvalid();
            normalized[index] =
                character >= 65 && character <= 90 ? bytes1(character + 32) : source[index];
        }
        normalizedCode = string(normalized);
        codeHash = keccak256(normalized);
    }

    function _validReferralSignature(
        address invitee,
        bytes32 commitment,
        uint8 v,
        bytes32 r,
        bytes32 s,
        address signer
    ) private view returns (bool) {
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return false;

        bytes32 payloadHash =
            keccak256(abi.encode(REFERRAL_REDEEM_DOMAIN, block.chainid, game, invitee, commitment));
        bytes32 digest =
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash));
        return ecrecover(digest, v, r, s) == signer;
    }

    function _consumeRedemptionQuota(bytes32 commitment) private {
        ReferralRedemptionWindow storage window = _referralRedemptionWindows[commitment];
        uint64 nowTimestamp = uint64(block.timestamp);
        uint256 oldestIndex = 0;
        uint64 oldestActive = type(uint64).max;

        for (uint256 index = 0; index < REFERRAL_CLAIM_LIMIT; index++) {
            uint64 redeemedAt = window.redeemedAt[index];
            if (redeemedAt == 0 || nowTimestamp >= redeemedAt + REFERRAL_CLAIM_WINDOW) {
                window.redeemedAt[index] = nowTimestamp;
                return;
            }
            if (redeemedAt < oldestActive) {
                oldestActive = redeemedAt;
                oldestIndex = index;
            }
        }

        uint64 resetsAt = oldestActive + REFERRAL_CLAIM_WINDOW;
        if (nowTimestamp < resetsAt) {
            revert ReferralRedemptionQuotaExceeded(commitment, resetsAt);
        }
        window.redeemedAt[oldestIndex] = nowTimestamp;
    }

    function _isExpired(bytes32 commitment) private view returns (bool) {
        uint64 claimedAt = referralClaimedAt[commitment];
        uint64 nowTimestamp = uint64(block.timestamp);
        return claimedAt == 0 || nowTimestamp >= claimedAt + REFERRAL_CLAIM_WINDOW;
    }
}
