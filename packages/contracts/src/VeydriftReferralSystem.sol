// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IVeydriftReferralGame {
    function homePlanetOf(address player) external view returns (uint256);
}

contract VeydriftReferralSystem {
    bytes32 public constant REFERRAL_REDEEM_DOMAIN = keccak256("veydrift.referral.redeem.v1");
    uint8 public constant REFERRAL_CLAIM_LIMIT = 3;
    uint64 public constant REFERRAL_CLAIM_WINDOW = 1 days;

    struct ReferralInvite {
        address inviter;
    }

    struct ReferralRedemptionWindow {
        uint64[3] redeemedAt;
    }

    address public owner;
    address public game;
    address public referralSigner;
    mapping(bytes32 commitment => ReferralInvite invite) public referralInvites;
    mapping(address inviter => bytes32 commitment) public referralCommitmentOf;
    mapping(bytes32 commitment => uint64 claimedAt) public referralClaimedAt;
    mapping(bytes32 commitment => ReferralRedemptionWindow redemptionWindow) private
        _referralRedemptionWindows;
    mapping(bytes32 commitment => mapping(address invitee => bool redeemed)) public
        referralRedemptions;

    error Unauthorized(address account);
    error ReferralSignerUnset();
    error ReferralCommitmentInvalid();
    error ReferralCommitmentAlreadyClaimed(bytes32 commitment);
    error ReferralInviteInvalid(bytes32 commitment);
    error ReferralInviteAlreadyClaimed(address inviter, bytes32 commitment);
    error ReferralInviteExpired(bytes32 commitment, uint64 expiredAt);
    error ReferralInviteeAlreadyRedeemed(bytes32 commitment, address invitee);
    error ReferralSignatureInvalid();
    error ReferralSelfInvite();
    error ReferralRedemptionQuotaExceeded(bytes32 commitment, uint64 resetsAt);

    event ReferralGameUpdated(address indexed oldGame, address indexed newGame);
    event ReferralSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event ReferralCodeClaimed(
        address indexed inviter, bytes32 indexed commitment, uint64 claimedAt
    );
    event ReferralInviteRedeemed(
        address indexed inviter,
        address indexed invitee,
        bytes32 indexed commitment,
        uint64 redeemedAt
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

    function claimReferralCode(bytes32 commitment) external {
        if (commitment == bytes32(0)) revert ReferralCommitmentInvalid();
        uint64 nowTimestamp = uint64(block.timestamp);
        address existingInviter = referralInvites[commitment].inviter;
        if (existingInviter != address(0) && existingInviter != msg.sender) {
            revert ReferralCommitmentAlreadyClaimed(commitment);
        }
        bytes32 existingCommitment = referralCommitmentOf[msg.sender];
        if (existingCommitment != bytes32(0) && !_isExpired(existingCommitment)) {
            revert ReferralInviteAlreadyClaimed(msg.sender, existingCommitment);
        }
        if (game == address(0) || IVeydriftReferralGame(game).homePlanetOf(msg.sender) == 0) {
            revert Unauthorized(msg.sender);
        }

        referralCommitmentOf[msg.sender] = commitment;
        referralInvites[commitment] = ReferralInvite({inviter: msg.sender});
        referralClaimedAt[commitment] = nowTimestamp;
        emit ReferralCodeClaimed(msg.sender, commitment, nowTimestamp);
    }

    function redeemReferralInvite(
        address invitee,
        bytes32 commitment,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyGame returns (address inviter) {
        if (commitment == bytes32(0)) revert ReferralCommitmentInvalid();
        address signer = referralSigner;
        if (signer == address(0)) revert ReferralSignerUnset();

        ReferralInvite storage invite = referralInvites[commitment];
        inviter = invite.inviter;
        if (inviter == address(0)) revert ReferralInviteInvalid(commitment);
        uint64 nowTimestamp = uint64(block.timestamp);
        uint64 claimedAt = referralClaimedAt[commitment];
        uint64 expiredAt = claimedAt + REFERRAL_CLAIM_WINDOW;
        if (claimedAt == 0 || nowTimestamp >= expiredAt) {
            revert ReferralInviteExpired(commitment, expiredAt);
        }
        if (inviter == invitee) revert ReferralSelfInvite();
        if (referralRedemptions[commitment][invitee]) {
            revert ReferralInviteeAlreadyRedeemed(commitment, invitee);
        }
        if (!_validReferralSignature(invitee, commitment, v, r, s, signer)) {
            revert ReferralSignatureInvalid();
        }

        _consumeRedemptionQuota(commitment);
        referralRedemptions[commitment][invitee] = true;
        emit ReferralInviteRedeemed(inviter, invitee, commitment, nowTimestamp);
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

    function referralRedemptionQuota(bytes32 commitment)
        external
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
}
