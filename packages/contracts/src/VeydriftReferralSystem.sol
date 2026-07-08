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
        bool used;
    }

    struct ReferralClaimWindow {
        uint64 startedAt;
        uint8 count;
    }

    address public owner;
    address public game;
    address public referralSigner;
    mapping(bytes32 commitment => ReferralInvite invite) public referralInvites;
    mapping(address inviter => ReferralClaimWindow claimWindow) public referralClaimWindows;

    error Unauthorized(address account);
    error ReferralSignerUnset();
    error ReferralCommitmentInvalid();
    error ReferralCommitmentAlreadyClaimed(bytes32 commitment);
    error ReferralInviteInvalid(bytes32 commitment);
    error ReferralInviteUsed(bytes32 commitment);
    error ReferralSignatureInvalid();
    error ReferralSelfInvite();
    error ReferralClaimQuotaExceeded(uint64 resetsAt);

    event ReferralGameUpdated(address indexed oldGame, address indexed newGame);
    event ReferralSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event ReferralCodeClaimed(
        address indexed inviter, bytes32 indexed commitment, uint64 claimedAt
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
        if (referralInvites[commitment].inviter != address(0)) {
            revert ReferralCommitmentAlreadyClaimed(commitment);
        }
        if (game == address(0) || IVeydriftReferralGame(game).homePlanetOf(msg.sender) == 0) {
            revert Unauthorized(msg.sender);
        }

        _consumeClaimQuota(msg.sender);
        referralInvites[commitment] = ReferralInvite({inviter: msg.sender, used: false});
        emit ReferralCodeClaimed(msg.sender, commitment, uint64(block.timestamp));
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
        if (invite.used) revert ReferralInviteUsed(commitment);
        if (inviter == invitee) revert ReferralSelfInvite();
        if (!_validReferralSignature(invitee, commitment, v, r, s, signer)) {
            revert ReferralSignatureInvalid();
        }

        invite.used = true;
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

    function _consumeClaimQuota(address inviter) private {
        ReferralClaimWindow storage window = referralClaimWindows[inviter];
        uint64 nowTimestamp = uint64(block.timestamp);
        uint64 resetsAt = window.startedAt + REFERRAL_CLAIM_WINDOW;
        if (window.count == 0 || nowTimestamp >= resetsAt) {
            window.startedAt = nowTimestamp;
            window.count = 1;
            return;
        }
        if (window.count >= REFERRAL_CLAIM_LIMIT) revert ReferralClaimQuotaExceeded(resetsAt);
        window.count += 1;
    }
}
