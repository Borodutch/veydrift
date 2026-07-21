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
    VeydriftUniswapDeployments
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
        require(auction.endBlock() - auction.startBlock() == 1_800, "AUCTION_DURATION");
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
        require(
            IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER).balanceOf(lock)
                == 4,
            "LOCKED_POSITION_COUNT"
        );
        for (uint256 i = 0; i < 3; i++) {
            bytes32 poolId = resources.poolIds(i);
            (uint160 sqrtPriceX96,,,) =
                IUniswapV4StateView(VeydriftUniswapDeployments.STATE_VIEW).getSlot0(poolId);
            require(sqrtPriceX96 != 0, "RESOURCE_POOL_MISSING");
            require(
                IUniswapV4PositionManager(VeydriftUniswapDeployments.POSITION_MANAGER)
                    .ownerOf(resources.positionTokenIds(i)) == lock,
                "RESOURCE_POSITION_OWNER"
            );
        }

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
