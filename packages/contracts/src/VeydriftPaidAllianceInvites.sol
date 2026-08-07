// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {VeydriftGameStorage} from "./VeydriftGameStorage.sol";

interface IVeydriftPaidInviteGame {
    function depositPaidAllianceInviteFee() external payable;
    function resourceReserveAvailable() external view returns (VeydriftGameStorage.Resources memory);
}

interface IVeydriftPaidInviteAlliance {
    function game() external view returns (IVeydriftPaidInviteGame);
    function allianceOf(address player)
        external
        view
        returns (uint256 allianceId, uint8 role, uint64 joinedAt);
    function joinFromPaidInvite(uint256 allianceId, address invitee) external;
    function creditPaidInviteBonusToPlanet(
        uint256 planetId,
        address manager,
        VeydriftGameStorage.Resources calldata amount
    ) external;
}

/// @notice Paid, private, single-use recruitment invites and alliance production treasury.
/// @dev This contract is intentionally separate from the roster authority so both implementations
/// stay below EIP-170. Only commitments are public; the high-entropy secret remains in the link and
/// is exchanged with the backend for a short-lived authorization bound to the recipient wallet.
contract VeydriftPaidAllianceInvites {
    uint128 public constant INVITE_PRICE = 0.006 ether;
    uint16 public constant PRODUCTION_BONUS_BPS = 200;
    uint16 private constant BPS = 10_000;

    struct PaidInvite {
        uint256 allianceId;
        address purchaser;
        uint128 settlementPrice;
        uint64 purchasedAt;
        bool redeemed;
    }

    struct ProductionRemainder {
        uint16 metal;
        uint16 crystal;
        uint16 deuterium;
    }

    IVeydriftPaidInviteAlliance public immutable alliance;
    address public owner;
    address public signer;
    mapping(bytes32 commitment => PaidInvite invite) private _invites;
    mapping(address invitee => uint256 allianceId) public issuingAllianceOf;
    mapping(uint256 allianceId => VeydriftGameStorage.Resources balance) private _balances;
    mapping(uint256 allianceId => VeydriftGameStorage.Resources balance) private _pendingBalances;
    mapping(address invitee => ProductionRemainder remainder) private _remainders;
    bool private _withdrawing;

    error Unauthorized(address account);
    error InvalidCommitment(bytes32 commitment);
    error InviteAlreadyExists(bytes32 commitment);
    error InvalidPayment(uint256 expected, uint256 received);
    error InviteAlreadyRedeemed(bytes32 commitment);
    error InvalidAuthorization();
    error InvalidAuthorizationExpiry(uint64 expiresAt);
    error SignerUnset();
    error BonusUnavailable(uint256 allianceId);
    error WithdrawalReentered();
    error ZeroAddress();

    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event PaidAllianceInvitePurchased(
        bytes32 indexed commitment,
        uint256 indexed allianceId,
        address indexed purchaser,
        uint256 settlementPrice,
        uint64 purchasedAt
    );
    event PaidAllianceInviteRedeemed(
        bytes32 indexed commitment,
        uint256 indexed allianceId,
        address indexed invitee,
        address purchaser,
        uint64 redeemedAt
    );
    event AllianceProductionBonusAccrued(
        uint256 indexed allianceId,
        address indexed invitee,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event AllianceProductionBonusDeferred(
        uint256 indexed allianceId,
        address indexed invitee,
        uint128 pendingMetal,
        uint128 pendingCrystal,
        uint128 pendingDeuterium
    );
    event AllianceBonusWithdrawn(
        uint256 indexed allianceId,
        address indexed manager,
        uint256 indexed planetId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );

    constructor(
        IVeydriftPaidInviteAlliance allianceSystem,
        address initialOwner,
        address initialSigner
    ) {
        if (
            address(allianceSystem) == address(0) || initialOwner == address(0)
                || initialSigner == address(0)
        ) revert ZeroAddress();
        alliance = allianceSystem;
        owner = initialOwner;
        signer = initialSigner;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyAlliance() {
        if (msg.sender != address(alliance)) revert Unauthorized(msg.sender);
        _;
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = nextOwner;
        emit OwnershipTransferred(oldOwner, nextOwner);
    }

    function setSigner(address nextSigner) external onlyOwner {
        if (nextSigner == address(0)) revert ZeroAddress();
        address oldSigner = signer;
        signer = nextSigner;
        emit SignerUpdated(oldSigner, nextSigner);
    }

    function buy(bytes32 commitment) external payable {
        (uint256 allianceId,,) = alliance.allianceOf(msg.sender);
        if (allianceId == 0) revert Unauthorized(msg.sender);
        if (commitment == bytes32(0)) revert InvalidCommitment(commitment);
        if (_invites[commitment].allianceId != 0) revert InviteAlreadyExists(commitment);
        uint256 price = INVITE_PRICE;
        if (msg.value != price) {
            revert InvalidPayment(INVITE_PRICE, msg.value);
        }
        alliance.game().depositPaidAllianceInviteFee{value: msg.value}();
        uint64 purchasedAt = uint64(block.timestamp);
        _invites[commitment] = PaidInvite({
            allianceId: allianceId,
            purchaser: msg.sender,
            // INVITE_PRICE is the fixed 0.006 ether constant, well below uint128 max.
            // forge-lint: disable-next-line(unsafe-typecast)
            settlementPrice: uint128(price),
            purchasedAt: purchasedAt,
            redeemed: false
        });
        emit PaidAllianceInvitePurchased(commitment, allianceId, msg.sender, price, purchasedAt);
    }

    function redeem(
        address invitee,
        bytes32 commitment,
        uint64 expiresAt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyAlliance returns (address purchaser, uint256 allianceId) {
        PaidInvite storage paidInvite = _invites[commitment];
        allianceId = paidInvite.allianceId;
        if (allianceId == 0) revert InvalidCommitment(commitment);
        if (paidInvite.redeemed) revert InviteAlreadyRedeemed(commitment);
        uint64 currentTime = uint64(block.timestamp);
        if (expiresAt <= currentTime) {
            revert InvalidAuthorizationExpiry(expiresAt);
        }
        address expectedSigner = signer;
        if (expectedSigner == address(0)) revert SignerUnset();
        if (
            ECDSA.recover(
                    MessageHashUtils.toEthSignedMessageHash(
                        authorizationHash(commitment, invitee, expiresAt)
                    ),
                    v,
                    r,
                    s
                ) != expectedSigner
        ) revert InvalidAuthorization();

        paidInvite.redeemed = true;
        issuingAllianceOf[invitee] = allianceId;
        alliance.joinFromPaidInvite(allianceId, invitee);
        purchaser = paidInvite.purchaser;
        emit PaidAllianceInviteRedeemed(commitment, allianceId, invitee, purchaser, currentTime);
    }

    function creditProduction(address invitee, VeydriftGameStorage.Resources calldata produced)
        external
        onlyAlliance
        returns (VeydriftGameStorage.Resources memory bonus)
    {
        uint256 allianceId = issuingAllianceOf[invitee];
        (uint256 currentAllianceId,,) = alliance.allianceOf(invitee);
        if (allianceId == 0 || currentAllianceId != allianceId) return bonus;

        ProductionRemainder storage remainder = _remainders[invitee];
        uint256 metalScaled = uint256(produced.metal) * PRODUCTION_BONUS_BPS + remainder.metal;
        uint256 crystalScaled = uint256(produced.crystal) * PRODUCTION_BONUS_BPS + remainder.crystal;
        uint256 deuteriumScaled =
            uint256(produced.deuterium) * PRODUCTION_BONUS_BPS + remainder.deuterium;
        VeydriftGameStorage.Resources memory newlyOwed = VeydriftGameStorage.Resources({
            // A uint128 input scaled by 200 / 10_000, plus sub-BPS carry, fits uint128.
            // forge-lint: disable-next-line(unsafe-typecast)
            metal: uint128(metalScaled / BPS),
            // A uint128 input scaled by 200 / 10_000, plus sub-BPS carry, fits uint128.
            // forge-lint: disable-next-line(unsafe-typecast)
            crystal: uint128(crystalScaled / BPS),
            // A uint128 input scaled by 200 / 10_000, plus sub-BPS carry, fits uint128.
            // forge-lint: disable-next-line(unsafe-typecast)
            deuterium: uint128(deuteriumScaled / BPS)
        });
        // Modulo BPS is below 10_000 and therefore fits uint16.
        // forge-lint: disable-next-line(unsafe-typecast)
        remainder.metal = uint16(metalScaled % BPS);
        // Modulo BPS is below 10_000 and therefore fits uint16.
        // forge-lint: disable-next-line(unsafe-typecast)
        remainder.crystal = uint16(crystalScaled % BPS);
        // Modulo BPS is below 10_000 and therefore fits uint16.
        // forge-lint: disable-next-line(unsafe-typecast)
        remainder.deuterium = uint16(deuteriumScaled % BPS);

        VeydriftGameStorage.Resources storage pending = _pendingBalances[allianceId];
        uint128 totalMetal = pending.metal + newlyOwed.metal;
        uint128 totalCrystal = pending.crystal + newlyOwed.crystal;
        uint128 totalDeuterium = pending.deuterium + newlyOwed.deuterium;
        VeydriftGameStorage.Resources memory available = alliance.game().resourceReserveAvailable();
        bonus = VeydriftGameStorage.Resources({
            metal: _min(totalMetal, available.metal),
            crystal: _min(totalCrystal, available.crystal),
            deuterium: _min(totalDeuterium, available.deuterium)
        });
        pending.metal = totalMetal - bonus.metal;
        pending.crystal = totalCrystal - bonus.crystal;
        pending.deuterium = totalDeuterium - bonus.deuterium;

        VeydriftGameStorage.Resources storage balance = _balances[allianceId];
        balance.metal += bonus.metal;
        balance.crystal += bonus.crystal;
        balance.deuterium += bonus.deuterium;
        if (bonus.metal != 0 || bonus.crystal != 0 || bonus.deuterium != 0) {
            emit AllianceProductionBonusAccrued(
                allianceId, invitee, bonus.metal, bonus.crystal, bonus.deuterium
            );
        }
        if (pending.metal != 0 || pending.crystal != 0 || pending.deuterium != 0) {
            emit AllianceProductionBonusDeferred(
                allianceId, invitee, pending.metal, pending.crystal, pending.deuterium
            );
        }
    }

    function withdraw(
        uint256 allianceId,
        uint256 planetId,
        VeydriftGameStorage.Resources calldata amount
    ) external {
        if (_withdrawing) revert WithdrawalReentered();
        (uint256 managerAllianceId, uint8 role,) = alliance.allianceOf(msg.sender);
        if (managerAllianceId != allianceId || role < 2) revert Unauthorized(msg.sender);
        if (amount.metal == 0 && amount.crystal == 0 && amount.deuterium == 0) {
            revert BonusUnavailable(allianceId);
        }
        VeydriftGameStorage.Resources storage balance = _balances[allianceId];
        if (
            amount.metal > balance.metal || amount.crystal > balance.crystal
                || amount.deuterium > balance.deuterium
        ) revert BonusUnavailable(allianceId);
        _withdrawing = true;
        balance.metal -= amount.metal;
        balance.crystal -= amount.crystal;
        balance.deuterium -= amount.deuterium;
        alliance.creditPaidInviteBonusToPlanet(planetId, msg.sender, amount);
        _withdrawing = false;
        emit AllianceBonusWithdrawn(
            allianceId, msg.sender, planetId, amount.metal, amount.crystal, amount.deuterium
        );
    }

    function invite(bytes32 commitment) external view returns (PaidInvite memory) {
        return _invites[commitment];
    }

    function bonusBalance(uint256 allianceId)
        external
        view
        returns (VeydriftGameStorage.Resources memory)
    {
        return _balances[allianceId];
    }

    /// @notice Exact whole-resource 2% entitlement awaiting ERC-20 reserve backing. Pending amounts
    /// are excluded from the withdrawable balance until a later eligible settlement can fund them.
    function pendingBonusBalance(uint256 allianceId)
        external
        view
        returns (VeydriftGameStorage.Resources memory)
    {
        return _pendingBalances[allianceId];
    }

    function authorizationHash(bytes32 commitment, address invitee, uint64 expiresAt)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                keccak256("VeydriftPaidAllianceInvite"),
                block.chainid,
                address(this),
                commitment,
                invitee,
                expiresAt
            )
        );
    }

    function _min(uint128 a, uint128 b) private pure returns (uint128) {
        return a < b ? a : b;
    }
}
