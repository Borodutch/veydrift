// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAerodromePoolFactory} from "../src/VeydriftLiquidityLauncher.sol";
import {
    IUniswapCCAAuction,
    IUniswapV4PositionManager,
    IUniswapV4StateView,
    VeydriftUniswapCCALauncher,
    VeydriftUniswapDeployments,
    VeydriftV4PoolKey
} from "../src/VeydriftUniswapLaunch.sol";
import {VeydriftUniswapResourcePools} from "../src/VeydriftUniswapResourcePools.sol";

/// @notice Read-only postflight assertions for the canonical Uniswap CCA/v4 path.
contract VerifyVeydriftUniswapLaunch is Script {
    address internal constant BASE_AERODROME_FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;

    function run() external view {
        require(block.chainid == VeydriftUniswapDeployments.BASE_CHAIN_ID, "BASE_MAINNET_ONLY");
        _requireCodehash(VeydriftUniswapDeployments.WETH, VeydriftUniswapDeployments.WETH_CODEHASH);
        _requireCodehash(
            VeydriftUniswapDeployments.CCA_FACTORY, VeydriftUniswapDeployments.CCA_FACTORY_CODEHASH
        );
        _requireCodehash(
            VeydriftUniswapDeployments.LBP_STRATEGY,
            VeydriftUniswapDeployments.LBP_STRATEGY_CODEHASH
        );
        _requireCodehash(
            VeydriftUniswapDeployments.POOL_MANAGER,
            VeydriftUniswapDeployments.POOL_MANAGER_CODEHASH
        );
        _requireCodehash(
            VeydriftUniswapDeployments.POSITION_MANAGER,
            VeydriftUniswapDeployments.POSITION_MANAGER_CODEHASH
        );
        _requireCodehash(
            VeydriftUniswapDeployments.STATE_VIEW, VeydriftUniswapDeployments.STATE_VIEW_CODEHASH
        );
        _requireCodehash(
            VeydriftUniswapDeployments.PERMIT2, VeydriftUniswapDeployments.PERMIT2_CODEHASH
        );

        VeydriftUniswapCCALauncher main =
            VeydriftUniswapCCALauncher(vm.envAddress("VEYDRIFT_UNISWAP_CCA_LAUNCHER_ADDRESS"));
        VeydriftUniswapResourcePools resources = VeydriftUniswapResourcePools(
            vm.envAddress("VEYDRIFT_UNISWAP_RESOURCE_LAUNCHER_ADDRESS")
        );
        address token = vm.envAddress("VEYDRIFT_TOKEN_ADDRESS");
        address lock = address(main.positionLock());
        _requireCodehash(token, VeydriftUniswapDeployments.VEYDRIFT_TOKEN_CODEHASH);
        require(IERC20(token).totalSupply() == 1_000_000_000 ether, "VEY_SUPPLY");
        require(
            main.launched() && main.migrationAttempted() && main.migrationSucceeded(), "MAIN_STATE"
        );
        require(resources.launched(), "RESOURCE_STATE");
        require(address(resources.positionLock()) == lock, "LOCK_MISMATCH");

        IUniswapCCAAuction auction = IUniswapCCAAuction(main.auction());
        require(auction.token() == token, "AUCTION_TOKEN");
        require(auction.currency() == VeydriftUniswapDeployments.WETH, "AUCTION_CURRENCY");
        require(auction.totalSupply() == 250_000_000 ether, "AUCTION_SUPPLY");
        require(
            auction.endBlock() - auction.startBlock() == main.BASE_48_HOUR_BLOCKS(),
            "AUCTION_DURATION"
        );
        require(
            auction.fundsRecipient() == VeydriftUniswapDeployments.LBP_STRATEGY, "FUNDS_RECIPIENT"
        );
        require(auction.validationHook() == address(0), "CCA_HOOK");
        require(auction.isGraduated(), "CCA_NOT_GRADUATED");

        (bytes32 hooklessMain, bytes32 strategyHookMain) = main.mainPoolIds();
        (uint160 hooklessPrice,,,) =
            IUniswapV4StateView(VeydriftUniswapDeployments.STATE_VIEW).getSlot0(hooklessMain);
        (uint160 fallbackPrice,,,) =
            IUniswapV4StateView(VeydriftUniswapDeployments.STATE_VIEW).getSlot0(strategyHookMain);
        require((hooklessPrice == 0) != (fallbackPrice == 0), "MAIN_POOL_COUNT");
        uint256 mainPositionId = main.mainPositionTokenId();
        require(mainPositionId != 0, "MAIN_POSITION_ID");
        bytes32 initializedMainPool = hooklessPrice == 0 ? strategyHookMain : hooklessMain;
        _verifyPosition(
            mainPositionId, initializedMainPool, token, VeydriftUniswapDeployments.WETH, lock
        );
        uint256[3] memory resourcePositionIds;
        for (uint256 i = 0; i < 3; i++) {
            bytes32 poolId = resources.poolIds(i);
            (uint160 sqrtPriceX96,,,) =
                IUniswapV4StateView(VeydriftUniswapDeployments.STATE_VIEW).getSlot0(poolId);
            require(sqrtPriceX96 != 0, "RESOURCE_POOL_MISSING");
            resourcePositionIds[i] = resources.positionTokenIds(i);
            address resourceToken =
                i == 0 ? resources.metal() : i == 1 ? resources.crystal() : resources.deuterium();
            _verifyPosition(resourcePositionIds[i], poolId, token, resourceToken, lock);
        }
        require(
            mainPositionId != resourcePositionIds[0] && mainPositionId != resourcePositionIds[1]
                && mainPositionId != resourcePositionIds[2]
                && resourcePositionIds[0] != resourcePositionIds[1]
                && resourcePositionIds[0] != resourcePositionIds[2]
                && resourcePositionIds[1] != resourcePositionIds[2],
            "DUPLICATE_POSITION_ID"
        );

        address authority = main.launchAuthority();
        _requireNoApproval(token, authority, address(main));
        _requireNoApproval(token, address(main), VeydriftUniswapDeployments.LBP_STRATEGY);
        _requireNoApproval(token, authority, address(resources));
        _verifyResource(resources.metal(), authority, resources);
        _verifyResource(resources.crystal(), authority, resources);
        _verifyResource(resources.deuterium(), authority, resources);
        require(IERC20(token).balanceOf(address(main)) == 0, "MAIN_DUST");
        require(IERC20(token).balanceOf(address(resources)) == 0, "RESOURCE_LAUNCHER_DUST");

        IAerodromePoolFactory aerodrome = IAerodromePoolFactory(BASE_AERODROME_FACTORY);
        _requireNoAerodromePair(aerodrome, token, VeydriftUniswapDeployments.WETH);
        _requireNoAerodromePair(aerodrome, resources.metal(), token);
        _requireNoAerodromePair(aerodrome, resources.crystal(), token);
        _requireNoAerodromePair(aerodrome, resources.deuterium(), token);
        console2.log("Uniswap CCA/v4 postflight verification passed");
    }

    function _verifyPosition(
        uint256 tokenId,
        bytes32 expectedPoolId,
        address expectedTokenA,
        address expectedTokenB,
        address lock
    ) private view {
        IUniswapV4PositionManager manager = IUniswapV4PositionManager(
            VeydriftUniswapDeployments.POSITION_MANAGER
        );
        require(manager.ownerOf(tokenId) == lock, "POSITION_OWNER");
        (VeydriftV4PoolKey memory key, uint256 info) = manager.getPoolAndPositionInfo(tokenId);
        require(keccak256(abi.encode(key)) == expectedPoolId, "POSITION_POOL_KEY");
        (address expectedCurrency0, address expectedCurrency1) = expectedTokenA < expectedTokenB
            ? (expectedTokenA, expectedTokenB)
            : (expectedTokenB, expectedTokenA);
        require(
            key.currency0 == expectedCurrency0 && key.currency1 == expectedCurrency1,
            "POSITION_CURRENCIES"
        );
        int24 tickLower;
        int24 tickUpper;
        assembly ("memory-safe") {
            tickLower := signextend(2, shr(8, info))
            tickUpper := signextend(2, shr(32, info))
        }
        // Match Uniswap v4 TickMath's usable full-range boundary formula.
        // forge-lint: disable-next-line(divide-before-multiply)
        int24 expectedLower = (-887_272 / key.tickSpacing) * key.tickSpacing;
        // forge-lint: disable-next-line(divide-before-multiply)
        int24 expectedUpper = (887_272 / key.tickSpacing) * key.tickSpacing;
        require(tickLower == expectedLower && tickUpper == expectedUpper, "POSITION_RANGE");
        require(manager.getPositionLiquidity(tokenId) != 0, "POSITION_LIQUIDITY");
    }

    function _verifyResource(
        address token,
        address authority,
        VeydriftUniswapResourcePools launcher
    ) private view {
        require(IERC20Metadata(token).decimals() == 6, "RESOURCE_DECIMALS");
        require(IERC20(token).totalSupply() == 10_000_000_000 * 1e6, "RESOURCE_SUPPLY");
        _requireNoApproval(token, authority, address(launcher));
        _requireNoApproval(token, address(launcher), VeydriftUniswapDeployments.PERMIT2);
        _requireNoApproval(token, address(launcher), VeydriftUniswapDeployments.POSITION_MANAGER);
        require(IERC20(token).balanceOf(address(launcher)) == 0, "RESOURCE_DUST");
    }

    function _requireNoAerodromePair(IAerodromePoolFactory factory, address tokenA, address tokenB)
        private
        view
    {
        require(factory.getPool(tokenA, tokenB, false) == address(0), "AERODROME_VOLATILE");
        require(factory.getPool(tokenA, tokenB, true) == address(0), "AERODROME_STABLE");
    }

    function _requireNoApproval(address token, address owner, address spender) private view {
        require(IERC20(token).allowance(owner, spender) == 0, "RESIDUAL_APPROVAL");
    }

    function _requireCodehash(address target, bytes32 expected) private view {
        require(target.codehash == expected, "DEPLOYMENT_CODEHASH");
    }
}
