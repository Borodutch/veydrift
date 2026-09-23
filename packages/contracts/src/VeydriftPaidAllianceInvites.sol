// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {VeydriftGameStorage} from "./VeydriftGameStorage.sol";

interface IVeydriftPaidInviteGame {
    function effectivePlayer(address actor) external view returns (address);
    function gamePaused() external view returns (bool);
    function depositPaidAllianceInviteFee() external payable;
    function resourceReserveAvailable() external view returns (VeydriftGameStorage.Resources memory);
}

interface IVeydriftPaidInviteAlliance {
    function game() external view returns (IVeydriftPaidInviteGame);
    function paidInviteSystem() external view returns (address);
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
contract VeydriftPaidAllianceInvites is Initializable, UUPSUpgradeable {
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

    struct InviteMigration {
        bytes32 commitment;
        PaidInvite invite;
        address invitee;
        uint64 redeemedAt;
    }

    struct IssuanceMigration {
        address invitee;
        uint256 allianceId;
        ProductionRemainder remainder;
    }

    struct BalanceMigration {
        uint256 allianceId;
        VeydriftGameStorage.Resources balance;
        VeydriftGameStorage.Resources pendingBalance;
    }

    IVeydriftPaidInviteAlliance public alliance;
    address public owner;
    address public signer;
    mapping(bytes32 commitment => PaidInvite invite) private _invites;
    mapping(address invitee => uint256 allianceId) public issuingAllianceOf;
    mapping(uint256 allianceId => VeydriftGameStorage.Resources balance) private _balances;
    mapping(uint256 allianceId => VeydriftGameStorage.Resources balance) private _pendingBalances;
    mapping(address invitee => ProductionRemainder remainder) private _remainders;
    bool private _withdrawing;
    address public migrationSource;
    bytes32 public migrationHash;
    bool public migrationFinalized;

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
    error MigrationUnavailable();
    error MigrationHashMismatch(bytes32 expected, bytes32 actual);
    error MigrationDuplicate(bytes32 key);
    error InvalidMigrationEntry(bytes32 key);

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
    event MigrationFinalized(
        address indexed source,
        bytes32 indexed stateHash,
        uint256 inviteCount,
        uint256 issuanceCount,
        uint256 balanceCount
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(
        IVeydriftPaidInviteAlliance allianceSystem,
        address initialOwner,
        address initialSigner
    ) external initializer {
        _initialize(allianceSystem, initialOwner, initialSigner);
        migrationFinalized = true;
    }

    function initializeMigration(
        IVeydriftPaidInviteAlliance allianceSystem,
        address initialOwner,
        address initialSigner,
        address source,
        bytes32 expectedStateHash
    ) external initializer {
        if (source == address(0) || expectedStateHash == bytes32(0)) {
            revert MigrationUnavailable();
        }
        _initialize(allianceSystem, initialOwner, initialSigner);
        _requireFrozenSource(source);
        migrationSource = source;
        migrationHash = expectedStateHash;
    }

    function _initialize(
        IVeydriftPaidInviteAlliance allianceSystem,
        address initialOwner,
        address initialSigner
    ) private {
        if (
            address(allianceSystem) == address(0) || initialOwner == address(0)
                || initialSigner == address(0)
        ) revert ZeroAddress();
        alliance = allianceSystem;
        owner = initialOwner;
        signer = initialSigner;
    }

    modifier migrationReady() {
        if (!migrationFinalized) revert MigrationUnavailable();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyAlliance() {
        if (msg.sender != address(alliance)) revert Unauthorized(msg.sender);
        _;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _requireFrozenSource(address source) private view {
        IVeydriftPaidInviteGame game = alliance.game();
        if (
            game.effectivePlayer(owner) != owner || !game.gamePaused()
                || alliance.paidInviteSystem() != source
        ) revert MigrationUnavailable();
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

    /// @notice Restores the complete frozen state of the legacy non-upgradeable invite contract.
    /// @dev The expected hash is committed during initialization, so a partial, reordered, or
    ///      altered import cannot be finalized. The source must be frozen before producing these
    ///      arrays and remain frozen until the Alliance pointer has switched to this proxy.
    function importMigration(
        InviteMigration[] calldata invites,
        IssuanceMigration[] calldata issuances,
        BalanceMigration[] calldata balances
    ) external onlyOwner {
        if (migrationFinalized || migrationSource == address(0)) revert MigrationUnavailable();
        _requireFrozenSource(migrationSource);
        bytes32 actualHash = keccak256(abi.encode(invites, issuances, balances));
        bytes32 expectedHash = migrationHash;
        if (actualHash != expectedHash) revert MigrationHashMismatch(expectedHash, actualHash);

        for (uint256 i = 0; i < invites.length;) {
            InviteMigration calldata item = invites[i];
            PaidInvite calldata paidInvite = item.invite;
            if (
                item.commitment == bytes32(0) || paidInvite.allianceId == 0
                    || paidInvite.purchaser == address(0) || paidInvite.settlementPrice == 0
                    || paidInvite.purchasedAt == 0
                    || paidInvite.redeemed != (item.invitee != address(0))
                    || paidInvite.redeemed != (item.redeemedAt != 0)
            ) revert InvalidMigrationEntry(item.commitment);
            for (uint256 previous = 0; previous < i;) {
                if (invites[previous].commitment == item.commitment) {
                    revert MigrationDuplicate(item.commitment);
                }
                unchecked {
                    ++previous;
                }
            }
            if (paidInvite.redeemed) {
                uint256 matchingIssuances;
                for (uint256 issuanceIndex = 0; issuanceIndex < issuances.length;) {
                    IssuanceMigration calldata issuance = issuances[issuanceIndex];
                    if (issuance.invitee == item.invitee) {
                        if (issuance.allianceId != paidInvite.allianceId) {
                            revert InvalidMigrationEntry(item.commitment);
                        }
                        unchecked {
                            ++matchingIssuances;
                        }
                    }
                    unchecked {
                        ++issuanceIndex;
                    }
                }
                if (matchingIssuances != 1) revert InvalidMigrationEntry(item.commitment);
            }
            _invites[item.commitment] = paidInvite;
            emit PaidAllianceInvitePurchased(
                item.commitment,
                paidInvite.allianceId,
                paidInvite.purchaser,
                paidInvite.settlementPrice,
                paidInvite.purchasedAt
            );
            if (paidInvite.redeemed) {
                emit PaidAllianceInviteRedeemed(
                    item.commitment,
                    paidInvite.allianceId,
                    item.invitee,
                    paidInvite.purchaser,
                    item.redeemedAt
                );
            }
            unchecked {
                ++i;
            }
        }

        for (uint256 i = 0; i < issuances.length;) {
            IssuanceMigration calldata item = issuances[i];
            bytes32 key = bytes32(uint256(uint160(item.invitee)));
            if (item.invitee == address(0) || item.allianceId == 0) {
                revert InvalidMigrationEntry(key);
            }
            for (uint256 previous = 0; previous < i;) {
                if (issuances[previous].invitee == item.invitee) revert MigrationDuplicate(key);
                unchecked {
                    ++previous;
                }
            }
            uint256 matchingInvites;
            for (uint256 inviteIndex = 0; inviteIndex < invites.length;) {
                InviteMigration calldata inviteItem = invites[inviteIndex];
                if (inviteItem.invitee == item.invitee) {
                    if (
                        !inviteItem.invite.redeemed
                            || inviteItem.invite.allianceId != item.allianceId
                    ) {
                        revert InvalidMigrationEntry(key);
                    }
                    unchecked {
                        ++matchingInvites;
                    }
                }
                unchecked {
                    ++inviteIndex;
                }
            }
            if (matchingInvites != 1) revert InvalidMigrationEntry(key);
            issuingAllianceOf[item.invitee] = item.allianceId;
            _remainders[item.invitee] = item.remainder;
            unchecked {
                ++i;
            }
        }

        for (uint256 i = 0; i < balances.length;) {
            BalanceMigration calldata item = balances[i];
            bytes32 key = bytes32(item.allianceId);
            if (item.allianceId == 0) revert InvalidMigrationEntry(key);
            for (uint256 previous = 0; previous < i;) {
                if (balances[previous].allianceId == item.allianceId) {
                    revert MigrationDuplicate(key);
                }
                unchecked {
                    ++previous;
                }
            }
            VeydriftGameStorage.Resources storage balance = _balances[item.allianceId];
            VeydriftGameStorage.Resources storage pending = _pendingBalances[item.allianceId];
            balance.metal = item.balance.metal;
            balance.crystal = item.balance.crystal;
            balance.deuterium = item.balance.deuterium;
            pending.metal = item.pendingBalance.metal;
            pending.crystal = item.pendingBalance.crystal;
            pending.deuterium = item.pendingBalance.deuterium;
            if (item.balance.metal != 0 || item.balance.crystal != 0 || item.balance.deuterium != 0)
            {
                emit AllianceProductionBonusAccrued(
                    item.allianceId,
                    address(0),
                    item.balance.metal,
                    item.balance.crystal,
                    item.balance.deuterium
                );
            }
            if (
                item.pendingBalance.metal != 0 || item.pendingBalance.crystal != 0
                    || item.pendingBalance.deuterium != 0
            ) {
                emit AllianceProductionBonusDeferred(
                    item.allianceId,
                    address(0),
                    item.pendingBalance.metal,
                    item.pendingBalance.crystal,
                    item.pendingBalance.deuterium
                );
            }
            unchecked {
                ++i;
            }
        }

        migrationFinalized = true;
        emit MigrationFinalized(
            migrationSource, actualHash, invites.length, issuances.length, balances.length
        );
    }

    function buy(bytes32 commitment) external payable migrationReady {
        address player = alliance.game().effectivePlayer(msg.sender);
        (uint256 allianceId,,) = alliance.allianceOf(player);
        if (allianceId == 0) revert Unauthorized(player);
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
            purchaser: player,
            // INVITE_PRICE is the fixed 0.006 ether constant, well below uint128 max.
            // forge-lint: disable-next-line(unsafe-typecast)
            settlementPrice: uint128(price),
            purchasedAt: purchasedAt,
            redeemed: false
        });
        emit PaidAllianceInvitePurchased(commitment, allianceId, player, price, purchasedAt);
    }

    function redeem(
        address invitee,
        bytes32 commitment,
        uint64 expiresAt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyAlliance migrationReady returns (address purchaser, uint256 allianceId) {
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
        migrationReady
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
    ) external migrationReady {
        if (_withdrawing) revert WithdrawalReentered();
        address manager = alliance.game().effectivePlayer(msg.sender);
        (uint256 managerAllianceId, uint8 role,) = alliance.allianceOf(manager);
        if (managerAllianceId != allianceId || role < 2) revert Unauthorized(manager);
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
        alliance.creditPaidInviteBonusToPlanet(planetId, manager, amount);
        _withdrawing = false;
        emit AllianceBonusWithdrawn(
            allianceId, manager, planetId, amount.metal, amount.crystal, amount.deuterium
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

    function productionRemainder(address invitee)
        external
        view
        returns (ProductionRemainder memory)
    {
        return _remainders[invitee];
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
