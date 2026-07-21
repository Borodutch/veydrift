// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IAerodromePoolFactory {
    function getPool(address tokenA, address tokenB, bool stable)
        external
        view
        returns (address pool);
}

interface IAerodromeRouter {
    function defaultFactory() external view returns (address);
    function weth() external view returns (address);
    function addLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
}

/// @notice Immutable time lock for the four classic Aerodrome LP tokens.
/// @dev There is no owner or emergency withdrawal. LP tokens can only be released to `beneficiary`
///      at or after the immutable owner-approved unlock timestamp.
contract VeydriftLPLock {
    using SafeERC20 for IERC20;

    bytes32 public constant LOCK_DOMAIN = keccak256("veydrift.classic-lp-lock.v1");

    address public immutable beneficiary;
    uint64 public immutable unlockAt;

    error InvalidBeneficiary();
    error InvalidUnlockTime();
    error LPLockActive(uint64 unlockAt);

    event LPTokensReleased(address indexed lpToken, address indexed beneficiary, uint256 amount);

    constructor(address beneficiary_, uint64 unlockAt_) {
        if (beneficiary_ == address(0)) revert InvalidBeneficiary();
        // The approved second-level timestamp is the intended immutable timelock boundary.
        // forge-lint: disable-next-line(block-timestamp)
        if (unlockAt_ <= block.timestamp) revert InvalidUnlockTime();
        beneficiary = beneficiary_;
        unlockAt = unlockAt_;
    }

    function release(address lpToken) external {
        // Base block time is the canonical clock for releasing the locked onchain LP position.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < unlockAt) revert LPLockActive(unlockAt);
        uint256 amount = IERC20(lpToken).balanceOf(address(this));
        IERC20(lpToken).safeTransfer(beneficiary, amount);
        emit LPTokensReleased(lpToken, beneficiary, amount);
    }
}

/// @notice One-shot atomic bootstrap for the four canonical classic volatile Aerodrome pools.
/// @dev This contract deliberately supports no swaps, stable pools, extra pairs, rescue authority,
///      or repeat launch. It is appropriate only when the classic volatile venue decision is approved.
contract VeydriftLiquidityLauncher {
    using SafeERC20 for IERC20;

    uint256 public constant VEYDRIFT_ETH_AMOUNT = 500_000_000 ether;
    uint256 public constant VEYDRIFT_PER_RESOURCE_AMOUNT = 50_000_000 ether;
    uint256 public constant METAL_AMOUNT = 333_333_000;
    uint256 public constant CRYSTAL_AMOUNT = 222_222_000;
    uint256 public constant DEUTERIUM_AMOUNT = 133_333_000;
    uint256 public constant RESOURCE_TOTAL_SUPPLY = 10_000_000_000 * 1e6;
    uint256 public constant VEYDRIFT_TOTAL_SUPPLY = 1_000_000_000 ether;

    address public immutable launchAuthority;
    IAerodromeRouter public immutable router;
    IAerodromePoolFactory public immutable factory;
    address public immutable weth;
    VeydriftLPLock public immutable lpLock;

    bool public launched;

    error UnauthorizedLaunch(address caller);
    error AlreadyLaunched();
    error WrongChain(uint256 chainId);
    error InvalidLaunchContract(address target);
    error InvalidLaunchToken(address token);
    error ExistingCanonicalPool(address tokenA, address tokenB, address pool);
    error LaunchAmountMismatch(address token, uint256 expected, uint256 actual);
    error LaunchLiquidityMissing(address tokenA, address tokenB);
    error ResidualApproval(address token, address owner, address spender, uint256 amount);
    error UnexpectedLauncherBalance(address token, uint256 amount);

    event CanonicalLiquidityLaunched(
        address indexed veydriftWethPool,
        address indexed metalVeydriftPool,
        address indexed crystalVeydriftPool,
        address deuteriumVeydriftPool,
        address lpLock,
        uint256 wethAmount
    );

    constructor(address launchAuthority_, address router_, address lpLock_) {
        if (launchAuthority_ == address(0)) revert InvalidLaunchContract(launchAuthority_);
        if (router_.code.length == 0) revert InvalidLaunchContract(router_);
        if (lpLock_.code.length == 0) revert InvalidLaunchContract(lpLock_);
        if (VeydriftLPLock(lpLock_).LOCK_DOMAIN() != keccak256("veydrift.classic-lp-lock.v1")) {
            revert InvalidLaunchContract(lpLock_);
        }

        launchAuthority = launchAuthority_;
        router = IAerodromeRouter(router_);
        address factory_ = IAerodromeRouter(router_).defaultFactory();
        address weth_ = IAerodromeRouter(router_).weth();
        if (factory_.code.length == 0) revert InvalidLaunchContract(factory_);
        if (weth_.code.length == 0) revert InvalidLaunchContract(weth_);
        factory = IAerodromePoolFactory(factory_);
        weth = weth_;
        lpLock = VeydriftLPLock(lpLock_);
    }

    function launch(
        address veydrift,
        address metal,
        address crystal,
        address deuterium,
        uint256 wethAmount,
        uint256 deadline
    ) external returns (address[4] memory pools) {
        if (msg.sender != launchAuthority) revert UnauthorizedLaunch(msg.sender);
        if (launched) revert AlreadyLaunched();
        if (block.chainid != 8453) revert WrongChain(block.chainid);
        if (wethAmount == 0) revert LaunchAmountMismatch(weth, 1, 0);

        _validateTokens(veydrift, metal, crystal, deuterium);
        _requireMissingPool(veydrift, weth);
        _requireMissingPool(metal, veydrift);
        _requireMissingPool(crystal, veydrift);
        _requireMissingPool(deuterium, veydrift);

        launched = true;
        _pull(veydrift, VEYDRIFT_ETH_AMOUNT + 3 * VEYDRIFT_PER_RESOURCE_AMOUNT);
        _pull(weth, wethAmount);
        _pull(metal, METAL_AMOUNT);
        _pull(crystal, CRYSTAL_AMOUNT);
        _pull(deuterium, DEUTERIUM_AMOUNT);

        pools[0] = _addLiquidity(veydrift, weth, VEYDRIFT_ETH_AMOUNT, wethAmount, deadline);
        pools[1] =
            _addLiquidity(metal, veydrift, METAL_AMOUNT, VEYDRIFT_PER_RESOURCE_AMOUNT, deadline);
        pools[2] = _addLiquidity(
            crystal, veydrift, CRYSTAL_AMOUNT, VEYDRIFT_PER_RESOURCE_AMOUNT, deadline
        );
        pools[3] = _addLiquidity(
            deuterium, veydrift, DEUTERIUM_AMOUNT, VEYDRIFT_PER_RESOURCE_AMOUNT, deadline
        );
        _requireEmpty(veydrift);
        _requireEmpty(weth);
        _requireEmpty(metal);
        _requireEmpty(crystal);
        _requireEmpty(deuterium);

        emit CanonicalLiquidityLaunched(
            pools[0], pools[1], pools[2], pools[3], address(lpLock), wethAmount
        );
    }

    function _validateTokens(address veydrift, address metal, address crystal, address deuterium)
        private
        view
    {
        if (
            veydrift == address(0) || metal == address(0) || crystal == address(0)
                || deuterium == address(0) || veydrift == weth || metal == crystal
                || metal == deuterium || crystal == deuterium || veydrift == metal
                || veydrift == crystal || veydrift == deuterium
        ) revert InvalidLaunchToken(address(0));

        _requireToken(veydrift, 18, VEYDRIFT_TOTAL_SUPPLY);
        _requireToken(metal, 6, RESOURCE_TOTAL_SUPPLY);
        _requireToken(crystal, 6, RESOURCE_TOTAL_SUPPLY);
        _requireToken(deuterium, 6, RESOURCE_TOTAL_SUPPLY);
    }

    function _requireToken(address token, uint8 expectedDecimals, uint256 expectedSupply)
        private
        view
    {
        if (
            token.code.length == 0 || IERC20Metadata(token).decimals() != expectedDecimals
                || IERC20(token).totalSupply() != expectedSupply
        ) revert InvalidLaunchToken(token);
    }

    function _requireMissingPool(address tokenA, address tokenB) private view {
        address pool = factory.getPool(tokenA, tokenB, false);
        if (pool != address(0)) revert ExistingCanonicalPool(tokenA, tokenB, pool);
    }

    function _pull(address token, uint256 amount) private {
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        if (beforeBalance != 0) revert UnexpectedLauncherBalance(token, beforeBalance);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert LaunchAmountMismatch(token, amount, received);
        uint256 remainingApproval = IERC20(token).allowance(msg.sender, address(this));
        if (remainingApproval != 0) {
            revert ResidualApproval(token, msg.sender, address(this), remainingApproval);
        }
    }

    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB,
        uint256 deadline
    ) private returns (address pool) {
        IERC20(tokenA).forceApprove(address(router), amountA);
        IERC20(tokenB).forceApprove(address(router), amountB);
        (uint256 usedA, uint256 usedB, uint256 liquidity) = router.addLiquidity(
            tokenA, tokenB, false, amountA, amountB, amountA, amountB, address(lpLock), deadline
        );
        IERC20(tokenA).forceApprove(address(router), 0);
        IERC20(tokenB).forceApprove(address(router), 0);
        uint256 approvalA = IERC20(tokenA).allowance(address(this), address(router));
        uint256 approvalB = IERC20(tokenB).allowance(address(this), address(router));
        if (approvalA != 0) {
            revert ResidualApproval(tokenA, address(this), address(router), approvalA);
        }
        if (approvalB != 0) {
            revert ResidualApproval(tokenB, address(this), address(router), approvalB);
        }
        if (usedA != amountA) revert LaunchAmountMismatch(tokenA, amountA, usedA);
        if (usedB != amountB) revert LaunchAmountMismatch(tokenB, amountB, usedB);
        if (liquidity == 0) revert LaunchLiquidityMissing(tokenA, tokenB);

        pool = factory.getPool(tokenA, tokenB, false);
        if (pool == address(0) || IERC20(pool).balanceOf(address(lpLock)) == 0) {
            revert LaunchLiquidityMissing(tokenA, tokenB);
        }
    }

    function _requireEmpty(address token) private view {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance != 0) revert UnexpectedLauncherBalance(token, balance);
    }
}
