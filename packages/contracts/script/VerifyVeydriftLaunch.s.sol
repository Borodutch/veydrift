// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    IAerodromePoolFactory,
    VeydriftLiquidityLauncher
} from "../src/VeydriftLiquidityLauncher.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftToken} from "../src/VeydriftToken.sol";
import {Resource} from "../src/libraries/VeydriftTypes.sol";

/// @notice Read-only postflight assertions for the Base launch transaction set.
contract VerifyVeydriftLaunch is Script {
    function run() external view {
        require(block.chainid == 8453, "BASE_MAINNET_ONLY");
        VeydriftToken token = VeydriftToken(vm.envAddress("VEYDRIFT_TOKEN_ADDRESS"));
        VeydriftGame game = VeydriftGame(vm.envAddress("VEYDRIFT_GAME_CONTRACT_ADDRESS"));
        VeydriftLiquidityLauncher launcher =
            VeydriftLiquidityLauncher(vm.envAddress("VEYDRIFT_LIQUIDITY_LAUNCHER_ADDRESS"));
        address metal = vm.envAddress("VEYDRIFT_METAL_TOKEN_ADDRESS");
        address crystal = vm.envAddress("VEYDRIFT_CRYSTAL_TOKEN_ADDRESS");
        address deuterium = vm.envAddress("VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS");
        address weth = launcher.weth();
        address lock = address(launcher.lpLock());
        IAerodromePoolFactory factory = launcher.factory();

        require(token.totalSupply() == token.MAX_SUPPLY(), "VEYDRIFT_SUPPLY_DRIFT");
        require(launcher.launched(), "LAUNCH_NOT_EXECUTED");
        address[4] memory pools = [
            factory.getPool(address(token), weth, false),
            factory.getPool(metal, address(token), false),
            factory.getPool(crystal, address(token), false),
            factory.getPool(deuterium, address(token), false)
        ];
        for (uint256 i = 0; i < pools.length; ++i) {
            require(pools[i] != address(0), "CANONICAL_POOL_MISSING");
            require(IERC20(pools[i]).balanceOf(lock) > 0, "LP_NOT_LOCKED");
        }
        require(
            token.balanceOf(pools[0]) == launcher.VEYDRIFT_ETH_AMOUNT(), "BAD_VEYDRIFT_WETH_RATIO"
        );
        require(
            token.balanceOf(pools[1]) == launcher.VEYDRIFT_PER_RESOURCE_AMOUNT(),
            "BAD_METAL_VEYDRIFT_RATIO"
        );
        require(
            token.balanceOf(pools[2]) == launcher.VEYDRIFT_PER_RESOURCE_AMOUNT(),
            "BAD_CRYSTAL_VEYDRIFT_RATIO"
        );
        require(
            token.balanceOf(pools[3]) == launcher.VEYDRIFT_PER_RESOURCE_AMOUNT(),
            "BAD_DEUT_VEYDRIFT_RATIO"
        );
        require(IERC20(metal).balanceOf(pools[1]) == launcher.METAL_AMOUNT(), "BAD_METAL_RATIO");
        require(
            IERC20(crystal).balanceOf(pools[2]) == launcher.CRYSTAL_AMOUNT(), "BAD_CRYSTAL_RATIO"
        );
        require(
            IERC20(deuterium).balanceOf(pools[3]) == launcher.DEUTERIUM_AMOUNT(), "BAD_DEUT_RATIO"
        );
        require(
            IERC20(weth).balanceOf(pools[0]) == vm.envUint("VEYDRIFT_WETH_LAUNCH_AMOUNT"),
            "BAD_WETH_RATIO"
        );
        _requireNoApproval(address(token), launcher.launchAuthority(), address(launcher));
        _requireNoApproval(metal, launcher.launchAuthority(), address(launcher));
        _requireNoApproval(crystal, launcher.launchAuthority(), address(launcher));
        _requireNoApproval(deuterium, launcher.launchAuthority(), address(launcher));
        _requireNoApproval(weth, launcher.launchAuthority(), address(launcher));
        _requireNoApproval(address(token), address(launcher), address(launcher.router()));
        _requireNoApproval(metal, address(launcher), address(launcher.router()));
        _requireNoApproval(crystal, address(launcher), address(launcher.router()));
        _requireNoApproval(deuterium, address(launcher), address(launcher.router()));
        _requireNoApproval(weth, address(launcher), address(launcher.router()));

        VeydriftGameStorage.Resources memory required = game.resourceReserveRequirement();
        require(
            game.resourceReserveBalance(Resource.Metal)
                >= required.metal + vm.envUint("VEYDRIFT_METAL_SAFETY_MARGIN"),
            "METAL_RESERVE_MARGIN_BREACH"
        );
        require(
            game.resourceReserveBalance(Resource.Crystal)
                >= required.crystal + vm.envUint("VEYDRIFT_CRYSTAL_SAFETY_MARGIN"),
            "CRYSTAL_RESERVE_MARGIN_BREACH"
        );
        require(
            game.resourceReserveBalance(Resource.Deuterium)
                >= required.deuterium + vm.envUint("VEYDRIFT_DEUTERIUM_SAFETY_MARGIN"),
            "DEUT_RESERVE_MARGIN_BREACH"
        );

        console2.log("Postflight assertions passed for four canonical pools and reserve backing");
    }

    function _requireNoApproval(address token, address owner, address spender) private view {
        require(IERC20(token).allowance(owner, spender) == 0, "RESIDUAL_LAUNCH_APPROVAL");
    }
}
