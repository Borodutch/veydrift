// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    IUniswapV4PoolManager,
    IUniswapV4PositionManager,
    IUniswapV4StateView,
    VeydriftUniswapDeployments,
    VeydriftV4PoolKey,
    VeydriftV4PositionLock
} from "./VeydriftUniswapLaunch.sol";

interface IVeydriftMainLaunch {
    function migrationSucceeded() external view returns (bool);
    function launchToken() external view returns (address);
    function positionLock() external view returns (address);
}

interface IUniswapV4PositionManagerWiring {
    function poolManager() external view returns (address);
    function permit2() external view returns (address);
}

interface IUniswapV4StateViewWiring {
    function poolManager() external view returns (address);
}

/// @notice Atomic creator for the three approved hookless, full-range VEYDRIFT resource pools.
/// @dev It can run only after the canonical VEY/WETH migration is proven successful. All input
///      prices, liquidity, fees, and slippage caps come from the separately approved manifest;
///      this contract never reads an AMM price for protocol accounting or launch configuration.
contract VeydriftUniswapResourcePools {
    using SafeERC20 for IERC20;

    uint256 public constant VEYDRIFT_TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant VEYDRIFT_PER_RESOURCE_POOL = 50_000_000 ether;
    uint256 public constant RESOURCE_TOTAL_SUPPLY = 10_000_000_000 * 1e6;
    uint256 public constant METAL_AMOUNT = 333_333_000;
    uint256 public constant CRYSTAL_AMOUNT = 222_222_000;
    uint256 public constant DEUTERIUM_AMOUNT = 133_333_000;
    uint256 public constant MPS = 10_000_000;
    uint256 public constant MIN_INPUT_USAGE_MPS = 9_900_000;
    int24 public constant MIN_TICK = -887272;
    int24 public constant MAX_TICK = 887272;

    uint8 private constant ACTION_MINT_POSITION = 0x02;
    uint8 private constant ACTION_SETTLE = 0x0b;
    uint8 private constant ACTION_TAKE_PAIR = 0x11;
    address public immutable launchAuthority;
    address public immutable recoveryRecipient;
    IVeydriftMainLaunch public immutable mainLaunch;
    address public immutable metal;
    address public immutable crystal;
    address public immutable deuterium;
    VeydriftV4PositionLock public immutable positionLock;

    bool public launched;
    bytes32 public configurationHash;
    bytes32[3] public poolIds;
    uint256[3] public positionTokenIds;
    uint256[3] public amount0Used;
    uint256[3] public amount1Used;

    struct ResourcePoolConfig {
        address resourceToken;
        uint160 sqrtPriceX96;
        uint24 fee;
        int24 tickSpacing;
        uint128 liquidity;
        uint256 amount0Max;
        uint256 amount1Max;
        uint256 amount0Min;
        uint256 amount1Min;
    }

    error Unauthorized(address caller);
    error WrongChain(uint256 actual, uint256 expected);
    error MainMigrationIncomplete();
    error AlreadyLaunched();
    error InvalidRecipient(address recipient);
    error InvalidDeployment(address target, bytes32 actualCodehash, bytes32 expectedCodehash);
    error InvalidDeploymentWiring(address target, address actual, address expected);
    error InvalidToken(address token);
    error InvalidPoolConfiguration(uint256 index);
    error ExistingResourcePool(bytes32 poolId);
    error InvalidAllowance(
        address token, address owner, address spender, uint256 expected, uint256 actual
    );
    error UnexpectedBalance(address token, address owner, uint256 amount);
    error InvalidPosition(uint256 tokenId);
    error InvalidDeadline(uint256 deadline);

    event ResourcePoolsLaunched(
        bytes32 indexed configurationHash,
        bytes32 metalPoolId,
        bytes32 crystalPoolId,
        bytes32 deuteriumPoolId,
        uint256 metalPositionId,
        uint256 crystalPositionId,
        uint256 deuteriumPositionId
    );

    constructor(
        address launchAuthority_,
        address recoveryRecipient_,
        IVeydriftMainLaunch mainLaunch_,
        address metal_,
        address crystal_,
        address deuterium_,
        VeydriftV4PositionLock positionLock_
    ) {
        if (
            launchAuthority_ == address(0) || recoveryRecipient_ == address(0)
                || address(mainLaunch_).code.length == 0 || address(positionLock_).code.length == 0
        ) revert InvalidRecipient(address(0));
        if (
            metal_ == address(0) || crystal_ == address(0) || deuterium_ == address(0)
                || metal_ == crystal_ || metal_ == deuterium_ || crystal_ == deuterium_
        ) revert InvalidToken(address(0));
        launchAuthority = launchAuthority_;
        recoveryRecipient = recoveryRecipient_;
        mainLaunch = mainLaunch_;
        metal = metal_;
        crystal = crystal_;
        deuterium = deuterium_;
        positionLock = positionLock_;
    }

    function preflight(ResourcePoolConfig[3] calldata configs)
        public
        view
        returns (bytes32 configHash, bytes32[3] memory ids)
    {
        _assertOfficialDeployments();
        if (block.chainid != _expectedChainId()) {
            revert WrongChain(block.chainid, _expectedChainId());
        }
        if (!mainLaunch.migrationSucceeded()) revert MainMigrationIncomplete();
        address veydrift = mainLaunch.launchToken();
        if (
            veydrift.codehash != VeydriftUniswapDeployments.VEYDRIFT_TOKEN_CODEHASH
                || IERC20Metadata(veydrift).decimals() != 18
                || IERC20(veydrift).totalSupply() != VEYDRIFT_TOTAL_SUPPLY
        ) revert InvalidToken(veydrift);
        if (
            mainLaunch.positionLock() != address(positionLock)
                || positionLock.positionManager() != _positionManager()
        ) {
            revert InvalidDeploymentWiring(
                address(positionLock), positionLock.positionManager(), _positionManager()
            );
        }

        address[3] memory expectedTokens = [metal, crystal, deuterium];
        uint256[3] memory expectedAmounts = [METAL_AMOUNT, CRYSTAL_AMOUNT, DEUTERIUM_AMOUNT];
        for (uint256 i = 0; i < 3; i++) {
            ResourcePoolConfig calldata config = configs[i];
            if (
                config.resourceToken != expectedTokens[i]
                    || IERC20Metadata(config.resourceToken).decimals() != 6
                    || IERC20(config.resourceToken).totalSupply() != RESOURCE_TOTAL_SUPPLY
            ) revert InvalidToken(config.resourceToken);
            if (
                config.sqrtPriceX96 == 0 || config.fee == 0 || config.fee > 1_000_000
                    || config.tickSpacing <= 0 || config.tickSpacing > 32_767
                    || config.liquidity == 0 || config.amount0Max > type(uint128).max
                    || config.amount1Max > type(uint128).max
            ) revert InvalidPoolConfiguration(i);

            VeydriftV4PoolKey memory key = _poolKey(veydrift, config);
            (uint256 expectedAmount0, uint256 expectedAmount1) = key.currency0 == veydrift
                ? (VEYDRIFT_PER_RESOURCE_POOL, expectedAmounts[i])
                : (expectedAmounts[i], VEYDRIFT_PER_RESOURCE_POOL);
            if (config.amount0Max != expectedAmount0 || config.amount1Max != expectedAmount1) {
                revert InvalidPoolConfiguration(i);
            }
            if (
                config.amount0Min > config.amount0Max || config.amount1Min > config.amount1Max
                    || config.amount0Min * MPS < config.amount0Max * MIN_INPUT_USAGE_MPS
                    || config.amount1Min * MPS < config.amount1Max * MIN_INPUT_USAGE_MPS
            ) revert InvalidPoolConfiguration(i);
            ids[i] = keccak256(abi.encode(key));
            (uint160 existingPrice,,,) = IUniswapV4StateView(_stateView()).getSlot0(ids[i]);
            if (existingPrice != 0) revert ExistingResourcePool(ids[i]);
        }
        configHash = keccak256(abi.encode(veydrift, configs, address(positionLock)));
    }

    function launchResourcePools(ResourcePoolConfig[3] calldata configs, uint256 deadline)
        external
        returns (bytes32[3] memory ids, uint256[3] memory tokenIds)
    {
        if (msg.sender != launchAuthority) revert Unauthorized(msg.sender);
        if (launched) revert AlreadyLaunched();
        // forge-lint: disable-next-line(block-timestamp)
        if (deadline < block.timestamp || deadline > block.timestamp + 30 minutes) {
            revert InvalidDeadline(deadline);
        }
        (configurationHash, ids) = preflight(configs);
        launched = true;

        address veydrift = mainLaunch.launchToken();
        _pullExact(veydrift, 3 * VEYDRIFT_PER_RESOURCE_POOL);
        _pullExact(metal, METAL_AMOUNT);
        _pullExact(crystal, CRYSTAL_AMOUNT);
        _pullExact(deuterium, DEUTERIUM_AMOUNT);

        for (uint256 i = 0; i < 3; i++) {
            (tokenIds[i], amount0Used[i], amount1Used[i]) =
                _initializeAndMint(veydrift, configs[i], deadline);
            poolIds[i] = ids[i];
            positionTokenIds[i] = tokenIds[i];
        }
        if (tokenIds[0] == tokenIds[1] || tokenIds[0] == tokenIds[2] || tokenIds[1] == tokenIds[2]) revert InvalidPosition(0);

        _returnDust(veydrift);
        _returnDust(metal);
        _returnDust(crystal);
        _returnDust(deuterium);

        emit ResourcePoolsLaunched(
            configurationHash, ids[0], ids[1], ids[2], tokenIds[0], tokenIds[1], tokenIds[2]
        );
    }

    function fullRangeTicks(int24 tickSpacing)
        public
        pure
        returns (int24 tickLower, int24 tickUpper)
    {
        // Integer truncation toward zero is the intended full-range usable-tick calculation.
        // forge-lint: disable-next-line(divide-before-multiply)
        tickLower = (MIN_TICK / tickSpacing) * tickSpacing;
        // forge-lint: disable-next-line(divide-before-multiply)
        tickUpper = (MAX_TICK / tickSpacing) * tickSpacing;
    }

    function officialDeployments()
        external
        pure
        returns (address permit2, address poolManager, address positionManager, address stateView)
    {
        return (_permit2(), _poolManager(), _positionManager(), _stateView());
    }

    function _initializeAndMint(
        address veydrift,
        ResourcePoolConfig calldata config,
        uint256 deadline
    ) private returns (uint256 tokenId, uint256 used0, uint256 used1) {
        VeydriftV4PoolKey memory key = _poolKey(veydrift, config);
        IUniswapV4PoolManager(_poolManager()).initialize(key, config.sqrtPriceX96);

        uint256 currency0Before = IERC20(key.currency0).balanceOf(address(this));
        uint256 currency1Before = IERC20(key.currency1).balanceOf(address(this));
        // Pre-fund only the approved maxima, settle those exact amounts, then return any unused
        // pair delta to this launcher. Never use ActionConstants.CONTRACT_BALANCE: unrelated token
        // donations to the public PositionManager must neither subsidize nor block this launch.
        IERC20(key.currency0).safeTransfer(_positionManager(), config.amount0Max);
        IERC20(key.currency1).safeTransfer(_positionManager(), config.amount1Max);
        tokenId = IUniswapV4PositionManager(_positionManager()).nextTokenId();
        (int24 tickLower, int24 tickUpper) = fullRangeTicks(config.tickSpacing);
        bytes memory actions =
            abi.encodePacked(ACTION_MINT_POSITION, ACTION_SETTLE, ACTION_SETTLE, ACTION_TAKE_PAIR);
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(
            key,
            tickLower,
            tickUpper,
            config.liquidity,
            config.amount0Max,
            config.amount1Max,
            address(positionLock),
            bytes("")
        );
        params[1] = abi.encode(key.currency0, config.amount0Max, false);
        params[2] = abi.encode(key.currency1, config.amount1Max, false);
        params[3] = abi.encode(key.currency0, key.currency1, address(this));
        IUniswapV4PositionManager(_positionManager())
            .modifyLiquidities(abi.encode(actions, params), deadline);
        used0 = currency0Before - IERC20(key.currency0).balanceOf(address(this));
        used1 = currency1Before - IERC20(key.currency1).balanceOf(address(this));
        if (used0 < config.amount0Min || used1 < config.amount1Min) {
            revert InvalidPoolConfiguration(type(uint256).max);
        }
        IUniswapV4PositionManager manager = IUniswapV4PositionManager(_positionManager());
        if (manager.ownerOf(tokenId) != address(positionLock)) revert InvalidPosition(tokenId);
        (VeydriftV4PoolKey memory actualKey, uint256 info) = manager.getPoolAndPositionInfo(tokenId);
        int24 actualTickLower;
        int24 actualTickUpper;
        assembly ("memory-safe") {
            actualTickLower := signextend(2, shr(8, info))
            actualTickUpper := signextend(2, shr(32, info))
        }
        if (
            keccak256(abi.encode(actualKey)) != keccak256(abi.encode(key))
                || actualTickLower != tickLower || actualTickUpper != tickUpper
                || manager.getPositionLiquidity(tokenId) != config.liquidity
        ) revert InvalidPosition(tokenId);
    }

    function _pullExact(address token, uint256 amount) private {
        uint256 allowance = IERC20(token).allowance(msg.sender, address(this));
        if (allowance != amount) {
            revert InvalidAllowance(token, msg.sender, address(this), amount, allowance);
        }
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 remaining = IERC20(token).allowance(msg.sender, address(this));
        if (remaining != 0) {
            revert InvalidAllowance(token, msg.sender, address(this), 0, remaining);
        }
    }

    function _returnDust(address token) private {
        uint256 dust = IERC20(token).balanceOf(address(this));
        if (dust != 0) IERC20(token).safeTransfer(recoveryRecipient, dust);
    }

    function _poolKey(address veydrift, ResourcePoolConfig calldata config)
        private
        pure
        returns (VeydriftV4PoolKey memory key)
    {
        (address currency0, address currency1) = veydrift < config.resourceToken
            ? (veydrift, config.resourceToken)
            : (config.resourceToken, veydrift);
        key = VeydriftV4PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: config.fee,
            tickSpacing: config.tickSpacing,
            hooks: address(0)
        });
    }

    function _assertOfficialDeployments() internal view virtual {
        _requireCodehash(_permit2(), VeydriftUniswapDeployments.PERMIT2_CODEHASH);
        _requireCodehash(_poolManager(), VeydriftUniswapDeployments.POOL_MANAGER_CODEHASH);
        _requireCodehash(_positionManager(), VeydriftUniswapDeployments.POSITION_MANAGER_CODEHASH);
        _requireCodehash(_stateView(), VeydriftUniswapDeployments.STATE_VIEW_CODEHASH);
        IUniswapV4PositionManagerWiring positionManager =
            IUniswapV4PositionManagerWiring(_positionManager());
        if (positionManager.poolManager() != _poolManager()) {
            revert InvalidDeploymentWiring(
                _positionManager(), positionManager.poolManager(), _poolManager()
            );
        }
        if (positionManager.permit2() != _permit2()) {
            revert InvalidDeploymentWiring(
                _positionManager(), positionManager.permit2(), _permit2()
            );
        }
        address stateViewPoolManager = IUniswapV4StateViewWiring(_stateView()).poolManager();
        if (stateViewPoolManager != _poolManager()) {
            revert InvalidDeploymentWiring(_stateView(), stateViewPoolManager, _poolManager());
        }
    }

    function _requireCodehash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert InvalidDeployment(target, actual, expected);
    }

    function _expectedChainId() internal pure virtual returns (uint256) {
        return VeydriftUniswapDeployments.BASE_CHAIN_ID;
    }

    function _permit2() internal pure virtual returns (address) {
        return VeydriftUniswapDeployments.PERMIT2;
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
