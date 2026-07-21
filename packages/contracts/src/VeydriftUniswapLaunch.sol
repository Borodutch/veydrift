// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Official Base mainnet deployments pinned for the VEYDRIFT CCA/v4 launch path.
/// @dev Sources: Uniswap CCA v2.1.0 (commit 7d7602d...), Liquidity Launcher/LBPStrategy
///      v3.1.0 (commit 873cbb2...), and the official Uniswap v4 deployment registry.
library VeydriftUniswapDeployments {
    uint256 internal constant BASE_CHAIN_ID = 8453;

    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant CCA_FACTORY = 0x000000001F26a0044BaA66024e7b6599c61963F8;
    address internal constant LBP_STRATEGY = 0x34385dD739FE5464892BF0bA4CC42492804dA000;
    address internal constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address internal constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address internal constant STATE_VIEW = 0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    bytes32 internal constant WETH_CODEHASH =
        0x8a3a1f6a9f9dce633117adee5b458245835a8645a8c8726a26382a4622508b1c;
    bytes32 internal constant CCA_FACTORY_CODEHASH =
        0xa1d2a90564f4f63580b25de42efaff92505c254b00fc666f65ab38126cce5cfa;
    bytes32 internal constant LBP_STRATEGY_CODEHASH =
        0x74723f633d30e7ea54ebb2ad6a605965010ced6185cde8ac9dce8504c55787a5;
    bytes32 internal constant POOL_MANAGER_CODEHASH =
        0x83b2af6e9f3158defc2811cbcb0db71ecf8b2ba2abea39c39e370ac5c6f43eb6;
    bytes32 internal constant POSITION_MANAGER_CODEHASH =
        0x243f9e091ddf11c7c04e28059fdbbf1bab82b72d414fafb8e096c097aaeb622a;
    bytes32 internal constant STATE_VIEW_CODEHASH =
        0xbbd5859677ef5491143133e8ed2b8faa0272f6fc2cbae94c53e79cc8c0538545;
    bytes32 internal constant PERMIT2_CODEHASH =
        0xa67739abc3ede9dbdc0491636c67d6a14ac07fab9030c3f509b1eb7b11dff8ed;
}

struct VeydriftV4PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct VeydriftV4PoolParameters {
    uint24 fee;
    int24 tickSpacing;
    address hook;
}

struct VeydriftV4PositionDefinition {
    int24 offsetLower;
    int24 offsetUpper;
    uint24 weight;
    address overridePositionRecipient;
}

struct VeydriftLiquidityAllocationBracket {
    uint128 lowerThreshold;
    uint24 rate;
}

/// @dev ABI-compatible with Uniswap Liquidity Launcher v3.1.0 MigratorParameters.
struct VeydriftMigratorParameters {
    address token;
    address currency;
    uint64 migrationBlock;
    uint128 reservedTokenAmountForLP;
    address recipient;
    address positionRecipient;
    VeydriftV4PoolParameters poolParameters;
    bytes positionDefinitions;
    bytes lpAllocationSchedule;
}

/// @dev ABI-compatible with Uniswap CCA v2.1.0 AuctionParameters.
struct VeydriftAuctionParameters {
    address currency;
    address tokensRecipient;
    address fundsRecipient;
    uint64 startBlock;
    uint64 endBlock;
    uint64 claimBlock;
    uint256 tickSpacing;
    address validationHook;
    uint256 floorPrice;
    uint128 requiredCurrencyRaised;
    bytes auctionStepsData;
}

interface IUniswapLBPStrategy {
    function initializerFactory() external view returns (address);
    function poolManager() external view returns (address);
    function positionManager() external view returns (address);
    function initializeDistribution(
        address token,
        uint256 totalSupply,
        bytes calldata configData,
        bytes32 salt
    ) external;
    function migrate(address initializer) external;
}

interface IUniswapCCAAuctionFactory {
    function protocolFeeController() external view returns (address);
    function getAddress(
        address token,
        uint256 amount,
        bytes calldata configData,
        bytes32 salt,
        address sender
    ) external view returns (address distributor);
}

interface IUniswapCCAAuction {
    function currency() external view returns (address);
    function token() external view returns (address);
    function totalSupply() external view returns (uint128);
    function tokensRecipient() external view returns (address);
    function fundsRecipient() external view returns (address);
    function startBlock() external view returns (uint64);
    function endBlock() external view returns (uint64);
    function claimBlock() external view returns (uint64);
    function validationHook() external view returns (address);
    function tickSpacing() external view returns (uint256);
    function floorPrice() external view returns (uint256);
    function clearingPrice() external view returns (uint256);
    function isGraduated() external view returns (bool);
}

interface IUniswapV4PositionManager {
    function balanceOf(address owner) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function setApprovalForAll(address operator, bool approved) external;
    function nextTokenId() external view returns (uint256);
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
}

interface IUniswapV4PoolManager {
    function initialize(VeydriftV4PoolKey calldata key, uint160 sqrtPriceX96)
        external
        returns (int24 tick);
}

interface IUniswapV4StateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

/// @notice Immutable custody for the main and resource Uniswap v4 position NFTs.
/// @dev There is no owner, rescue, or early-unlock path. Once the timestamp passes, anyone may grant
///      the immutable beneficiary operator rights; only that beneficiary can then move the NFTs.
contract VeydriftV4PositionLock {
    address public immutable positionManager;
    address public immutable beneficiary;
    uint64 public immutable unlockAt;

    error InvalidPositionManager();
    error InvalidBeneficiary();
    error InvalidUnlockTime();
    error PositionLockActive(uint64 unlockAt);

    event BeneficiaryApproved(address indexed beneficiary, uint64 indexed unlockAt);

    constructor(address positionManager_, address beneficiary_, uint64 unlockAt_) {
        if (positionManager_.code.length == 0) revert InvalidPositionManager();
        if (beneficiary_ == address(0)) revert InvalidBeneficiary();
        // The owner-approved timestamp is the immutable position custody boundary.
        // forge-lint: disable-next-line(block-timestamp)
        if (unlockAt_ <= block.timestamp) revert InvalidUnlockTime();
        positionManager = positionManager_;
        beneficiary = beneficiary_;
        unlockAt = unlockAt_;
    }

    function approveBeneficiary() external {
        // Base time is the canonical lock clock.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < unlockAt) revert PositionLockActive(unlockAt);
        IUniswapV4PositionManager(positionManager).setApprovalForAll(beneficiary, true);
        emit BeneficiaryApproved(beneficiary, unlockAt);
    }
}

/// @notice One-shot VEYDRIFT CCA registration and automatic Uniswap v4 migration coordinator.
/// @dev No transaction is broadcast by this contract on its own. The launch authority must provide an
///      exact allowance and owner-approved immutable auction/pool inputs. The deployed audited Uniswap
///      strategy owns the auction lifecycle and best-effort recovery behavior.
contract VeydriftUniswapCCALauncher {
    using SafeERC20 for IERC20;

    uint256 public constant VEYDRIFT_TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant LAUNCH_BOOTSTRAP_ALLOCATION = 500_000_000 ether;
    uint128 public constant CCA_ALLOCATION = 250_000_000 ether;
    uint128 public constant V4_MAIN_LIQUIDITY_ALLOCATION = 250_000_000 ether;
    uint64 public constant BASE_60_MINUTE_BLOCKS = 1_800;
    uint24 public constant MPS = 10_000_000;
    uint256 public constant MIN_CCA_FLOOR_PRICE_X96 = (1 << 32) + 1;

    address public immutable launchAuthority;
    VeydriftV4PositionLock public immutable positionLock;

    bool public launched;
    bool public aborted;
    bool public migrationAttempted;
    bool public migrationSucceeded;
    address public launchToken;
    address public auction;
    uint64 public migrationBlock;
    uint24 public mainPoolFee;
    int24 public mainPoolTickSpacing;
    bytes32 public configurationHash;

    struct LaunchConfig {
        address tokensRecipient;
        address recoveryRecipient;
        uint64 startBlock;
        uint64 endBlock;
        uint64 claimBlock;
        uint64 migrationBlock;
        uint256 auctionTickSpacingQ96;
        uint256 floorPriceQ96;
        uint128 requiredWethRaised;
        bytes auctionStepsData;
        uint24 v4Fee;
        int24 v4TickSpacing;
        uint24 lpCurrencyRateMps;
    }

    error Unauthorized(address caller);
    error WrongChain(uint256 actual, uint256 expected);
    error InvalidDeployment(address target, bytes32 actualCodehash, bytes32 expectedCodehash);
    error InvalidDeploymentWiring(address target, address actual, address expected);
    error InvalidToken(address token);
    error InvalidRecipient(address recipient);
    error InvalidAuctionTiming();
    error InvalidAuctionSteps(uint256 durationBlocks, uint256 cumulativeMps);
    error InvalidAuctionConfiguration();
    error InvalidV4Configuration();
    error ExistingMainPool(bytes32 poolId);
    error InvalidAllowance(
        address token, address owner, address spender, uint256 expected, uint256 actual
    );
    error UnexpectedBalance(address token, address owner, uint256 amount);
    error AlreadyFinalized();
    error LaunchAborted();
    error MigrationNotReady(uint64 requiredBlock, uint256 actualBlock);
    error AuctionMismatch(address auction);

    event LaunchRegistered(
        address indexed token,
        address indexed auction,
        bytes32 indexed configurationHash,
        uint64 startBlock,
        uint64 endBlock,
        uint64 migrationBlock
    );
    event LaunchAbortedByAuthority(bytes32 indexed reasonHash);
    event MigrationAttempted(
        address indexed auction, bool positionMinted, uint256 lockedPositionCount
    );

    constructor(address launchAuthority_, VeydriftV4PositionLock positionLock_) {
        if (launchAuthority_ == address(0)) revert InvalidRecipient(launchAuthority_);
        if (address(positionLock_).code.length == 0) {
            revert InvalidRecipient(address(positionLock_));
        }
        launchAuthority = launchAuthority_;
        positionLock = positionLock_;
    }

    function preflight(address token, LaunchConfig calldata config, bytes32 salt)
        public
        view
        returns (address predictedAuction, bytes32 configHash, bytes32 mainPoolId)
    {
        _assertOfficialDeployments();
        if (block.chainid != _expectedChainId()) {
            revert WrongChain(block.chainid, _expectedChainId());
        }
        if (
            token.code.length == 0 || IERC20Metadata(token).decimals() != 18
                || IERC20(token).totalSupply() != VEYDRIFT_TOTAL_SUPPLY
        ) revert InvalidToken(token);
        if (
            config.tokensRecipient == address(0) || config.recoveryRecipient == address(0)
                || config.tokensRecipient == _lbpStrategy()
                || config.recoveryRecipient == _lbpStrategy()
        ) revert InvalidRecipient(address(0));
        if (
            config.startBlock <= block.number || config.endBlock <= config.startBlock
                || config.endBlock - config.startBlock != BASE_60_MINUTE_BLOCKS
                || config.claimBlock < config.endBlock || config.migrationBlock <= config.endBlock
        ) revert InvalidAuctionTiming();
        (uint256 durationBlocks, uint256 cumulativeMps) =
            _validateAuctionSteps(config.auctionStepsData);
        if (durationBlocks != BASE_60_MINUTE_BLOCKS || cumulativeMps != MPS) {
            revert InvalidAuctionSteps(durationBlocks, cumulativeMps);
        }
        if (
            config.auctionTickSpacingQ96 < 2 || config.floorPriceQ96 < MIN_CCA_FLOOR_PRICE_X96
                || config.floorPriceQ96 % config.auctionTickSpacingQ96 != 0
                || config.requiredWethRaised == 0
        ) revert InvalidAuctionConfiguration();
        if (
            config.v4Fee == 0 || config.v4Fee > 1_000_000 || config.v4TickSpacing <= 0
                || config.lpCurrencyRateMps == 0 || config.lpCurrencyRateMps > MPS
        ) revert InvalidV4Configuration();
        if (positionLock.positionManager() != _positionManager()) {
            revert InvalidDeploymentWiring(
                address(positionLock), positionLock.positionManager(), _positionManager()
            );
        }
        if (IUniswapV4PositionManager(_positionManager()).balanceOf(address(positionLock)) != 0) {
            revert UnexpectedBalance(_positionManager(), address(positionLock), 1);
        }

        VeydriftMigratorParameters memory migrator = _migratorParameters(token, config);
        VeydriftAuctionParameters memory auctionParams = _auctionParameters(config);
        bytes memory initializerParams = abi.encode(auctionParams);
        bytes memory strategyConfig = abi.encode(migrator, initializerParams);
        bytes32 initializerSalt = keccak256(abi.encode(salt, migrator));
        predictedAuction = IUniswapCCAAuctionFactory(_ccaFactory())
            .getAddress(token, CCA_ALLOCATION, initializerParams, initializerSalt, _lbpStrategy());
        configHash = keccak256(abi.encode(token, config, salt, strategyConfig, predictedAuction));
        mainPoolId = _poolId(token, config.v4Fee, config.v4TickSpacing, address(0));
        (uint160 sqrtPriceX96,,,) = IUniswapV4StateView(_stateView()).getSlot0(mainPoolId);
        if (sqrtPriceX96 != 0) revert ExistingMainPool(mainPoolId);
    }

    function launch(address token, LaunchConfig calldata config, bytes32 salt)
        external
        returns (address registeredAuction)
    {
        if (msg.sender != launchAuthority) revert Unauthorized(msg.sender);
        if (aborted) revert LaunchAborted();
        if (launched) revert AlreadyFinalized();
        (registeredAuction, configurationHash,) = preflight(token, config, salt);
        launched = true;
        launchToken = token;
        auction = registeredAuction;
        migrationBlock = config.migrationBlock;
        mainPoolFee = config.v4Fee;
        mainPoolTickSpacing = config.v4TickSpacing;

        uint256 allowance = IERC20(token).allowance(msg.sender, address(this));
        if (allowance != LAUNCH_BOOTSTRAP_ALLOCATION) {
            revert InvalidAllowance(
                token, msg.sender, address(this), LAUNCH_BOOTSTRAP_ALLOCATION, allowance
            );
        }
        IERC20(token).safeTransferFrom(msg.sender, address(this), LAUNCH_BOOTSTRAP_ALLOCATION);
        _requireNoAllowance(token, msg.sender, address(this));
        IERC20(token).forceApprove(_lbpStrategy(), LAUNCH_BOOTSTRAP_ALLOCATION);
        IUniswapLBPStrategy(_lbpStrategy())
            .initializeDistribution(
                token,
                LAUNCH_BOOTSTRAP_ALLOCATION,
                abi.encode(
                    _migratorParameters(token, config), abi.encode(_auctionParameters(config))
                ),
                salt
            );
        IERC20(token).forceApprove(_lbpStrategy(), 0);
        _requireNoAllowance(token, address(this), _lbpStrategy());
        if (IERC20(token).balanceOf(address(this)) != 0) {
            revert UnexpectedBalance(token, address(this), IERC20(token).balanceOf(address(this)));
        }
        _assertAuction(registeredAuction, token, config);

        emit LaunchRegistered(
            token,
            registeredAuction,
            configurationHash,
            config.startBlock,
            config.endBlock,
            config.migrationBlock
        );
    }

    function abort(bytes32 reasonHash) external {
        if (msg.sender != launchAuthority) revert Unauthorized(msg.sender);
        if (launched || aborted) revert AlreadyFinalized();
        aborted = true;
        emit LaunchAbortedByAuthority(reasonHash);
    }

    /// @notice Permissionless finalization wrapper around the official strategy's best-effort migration.
    /// @dev A false `migrationSucceeded` means the official recovery branch returned assets to the configured
    ///      recovery recipient; it is terminal and must not be retried automatically.
    function finalizeAndMigrate() external returns (bool positionMinted) {
        if (!launched || migrationAttempted) revert AlreadyFinalized();
        if (block.number < migrationBlock) revert MigrationNotReady(migrationBlock, block.number);
        migrationAttempted = true;
        uint256 positionsBefore =
            IUniswapV4PositionManager(_positionManager()).balanceOf(address(positionLock));
        IUniswapLBPStrategy(_lbpStrategy()).migrate(auction);
        uint256 positionsAfter =
            IUniswapV4PositionManager(_positionManager()).balanceOf(address(positionLock));
        positionMinted = positionsAfter > positionsBefore;
        migrationSucceeded = positionMinted;
        emit MigrationAttempted(auction, positionMinted, positionsAfter);
    }

    function mainPoolIds()
        external
        view
        returns (bytes32 hooklessPoolId, bytes32 strategyHookPoolId)
    {
        hooklessPoolId = _poolId(launchToken, mainPoolFee, mainPoolTickSpacing, address(0));
        strategyHookPoolId = _poolId(launchToken, mainPoolFee, mainPoolTickSpacing, _lbpStrategy());
    }

    function officialDeployments()
        external
        pure
        returns (
            address weth,
            address ccaFactory,
            address lbpStrategy,
            address poolManager,
            address positionManager,
            address stateView
        )
    {
        return (
            _weth(), _ccaFactory(), _lbpStrategy(), _poolManager(), _positionManager(), _stateView()
        );
    }

    function _migratorParameters(address token, LaunchConfig calldata config)
        internal
        view
        returns (VeydriftMigratorParameters memory migrator)
    {
        VeydriftV4PositionDefinition[] memory positions = new VeydriftV4PositionDefinition[](0);
        VeydriftLiquidityAllocationBracket[] memory brackets =
            new VeydriftLiquidityAllocationBracket[](1);
        brackets[0] =
            VeydriftLiquidityAllocationBracket({lowerThreshold: 0, rate: config.lpCurrencyRateMps});
        migrator = VeydriftMigratorParameters({
            token: token,
            currency: _weth(),
            migrationBlock: config.migrationBlock,
            reservedTokenAmountForLP: V4_MAIN_LIQUIDITY_ALLOCATION,
            recipient: config.recoveryRecipient,
            positionRecipient: address(positionLock),
            poolParameters: VeydriftV4PoolParameters({
                fee: config.v4Fee, tickSpacing: config.v4TickSpacing, hook: address(0)
            }),
            positionDefinitions: abi.encode(positions),
            lpAllocationSchedule: abi.encode(brackets)
        });
    }

    function _auctionParameters(LaunchConfig calldata config)
        internal
        pure
        returns (VeydriftAuctionParameters memory)
    {
        return VeydriftAuctionParameters({
            currency: _weth(),
            tokensRecipient: config.tokensRecipient,
            fundsRecipient: address(1),
            startBlock: config.startBlock,
            endBlock: config.endBlock,
            claimBlock: config.claimBlock,
            tickSpacing: config.auctionTickSpacingQ96,
            validationHook: address(0),
            floorPrice: config.floorPriceQ96,
            requiredCurrencyRaised: config.requiredWethRaised,
            auctionStepsData: config.auctionStepsData
        });
    }

    function _assertAuction(address registeredAuction, address token, LaunchConfig calldata config)
        private
        view
    {
        if (registeredAuction.code.length == 0) revert AuctionMismatch(registeredAuction);
        IUniswapCCAAuction created = IUniswapCCAAuction(registeredAuction);
        if (
            created.token() != token || created.currency() != _weth()
                || created.totalSupply() != CCA_ALLOCATION
                || created.tokensRecipient() != config.tokensRecipient
                || created.fundsRecipient() != _lbpStrategy()
                || created.startBlock() != config.startBlock
                || created.endBlock() != config.endBlock
                || created.claimBlock() != config.claimBlock
                || created.validationHook() != address(0)
                || created.tickSpacing() != config.auctionTickSpacingQ96
                || created.floorPrice() != config.floorPriceQ96
        ) revert AuctionMismatch(registeredAuction);
    }

    function _validateAuctionSteps(bytes calldata steps)
        private
        pure
        returns (uint256 durationBlocks, uint256 cumulativeMps)
    {
        if (steps.length == 0 || steps.length % 8 != 0) return (0, 0);
        for (uint256 offset = 0; offset < steps.length; offset += 8) {
            uint64 packed;
            assembly {
                packed := shr(192, calldataload(add(steps.offset, offset)))
            }
            // The shift/mask bound these values to exactly 24 and 40 bits.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint24 mps = uint24(packed >> 40);
            // forge-lint: disable-next-line(unsafe-typecast)
            uint40 blockDelta = uint40(packed & type(uint40).max);
            if (blockDelta == 0) return (0, 0);
            durationBlocks += blockDelta;
            cumulativeMps += uint256(mps) * blockDelta;
        }
    }

    function _poolId(address token, uint24 fee, int24 tickSpacing, address hook)
        internal
        pure
        returns (bytes32)
    {
        (address currency0, address currency1) =
            _weth() < token ? (_weth(), token) : (token, _weth());
        return keccak256(
            abi.encode(
                VeydriftV4PoolKey({
                    currency0: currency0,
                    currency1: currency1,
                    fee: fee,
                    tickSpacing: tickSpacing,
                    hooks: hook
                })
            )
        );
    }

    function _requireNoAllowance(address token, address owner, address spender) private view {
        uint256 allowance = IERC20(token).allowance(owner, spender);
        if (allowance != 0) revert InvalidAllowance(token, owner, spender, 0, allowance);
    }

    function _assertOfficialDeployments() internal view virtual {
        _requireCodehash(_weth(), VeydriftUniswapDeployments.WETH_CODEHASH);
        _requireCodehash(_ccaFactory(), VeydriftUniswapDeployments.CCA_FACTORY_CODEHASH);
        _requireCodehash(_lbpStrategy(), VeydriftUniswapDeployments.LBP_STRATEGY_CODEHASH);
        _requireCodehash(_poolManager(), VeydriftUniswapDeployments.POOL_MANAGER_CODEHASH);
        _requireCodehash(_positionManager(), VeydriftUniswapDeployments.POSITION_MANAGER_CODEHASH);
        _requireCodehash(_stateView(), VeydriftUniswapDeployments.STATE_VIEW_CODEHASH);
        if (IERC20Metadata(_weth()).decimals() != 18) revert InvalidToken(_weth());
        if (IUniswapCCAAuctionFactory(_ccaFactory()).protocolFeeController() != address(0)) {
            revert InvalidDeploymentWiring(
                _ccaFactory(),
                IUniswapCCAAuctionFactory(_ccaFactory()).protocolFeeController(),
                address(0)
            );
        }
        IUniswapLBPStrategy strategy = IUniswapLBPStrategy(_lbpStrategy());
        if (strategy.initializerFactory() != _ccaFactory()) {
            revert InvalidDeploymentWiring(
                _lbpStrategy(), strategy.initializerFactory(), _ccaFactory()
            );
        }
        if (strategy.poolManager() != _poolManager()) {
            revert InvalidDeploymentWiring(_lbpStrategy(), strategy.poolManager(), _poolManager());
        }
        if (strategy.positionManager() != _positionManager()) {
            revert InvalidDeploymentWiring(
                _lbpStrategy(), strategy.positionManager(), _positionManager()
            );
        }
    }

    function _requireCodehash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert InvalidDeployment(target, actual, expected);
    }

    function _expectedChainId() internal pure virtual returns (uint256) {
        return VeydriftUniswapDeployments.BASE_CHAIN_ID;
    }

    function _weth() internal pure virtual returns (address) {
        return VeydriftUniswapDeployments.WETH;
    }

    function _ccaFactory() internal pure virtual returns (address) {
        return VeydriftUniswapDeployments.CCA_FACTORY;
    }

    function _lbpStrategy() internal pure virtual returns (address) {
        return VeydriftUniswapDeployments.LBP_STRATEGY;
    }

    function _poolManager() internal pure virtual returns (address) {
        return VeydriftUniswapDeployments.POOL_MANAGER;
    }

    function _positionManager() internal pure virtual returns (address) {
        return VeydriftUniswapDeployments.POSITION_MANAGER;
    }

    function _stateView() internal pure virtual returns (address) {
        return VeydriftUniswapDeployments.STATE_VIEW;
    }
}
