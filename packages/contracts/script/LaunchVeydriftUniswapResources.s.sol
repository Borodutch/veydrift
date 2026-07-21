// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VeydriftUniswapDeployments} from "../src/VeydriftUniswapLaunch.sol";
import {VeydriftUniswapResourcePools} from "../src/VeydriftUniswapResourcePools.sol";

/// @notice Creates the three owner-approved hookless full-range resource positions atomically.
contract LaunchVeydriftUniswapResources is Script {
    address internal constant APPROVED_LAUNCH_EOA = 0xca6C67515aa9aa21DA37e07C7469Fd2C5880e2F4;

    function run() external returns (bytes32[3] memory poolIds, uint256[3] memory tokenIds) {
        require(block.chainid == VeydriftUniswapDeployments.BASE_CHAIN_ID, "BASE_MAINNET_ONLY");
        require(vm.envBytes32("VEYDRIFT_OWNER_APPROVAL_DIGEST") != bytes32(0), "APPROVAL_MISSING");
        require(vm.envBytes32("VEYDRIFT_FINAL_SIMULATION_HASH") != bytes32(0), "SIMULATION_MISSING");
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        require(vm.addr(privateKey) == APPROVED_LAUNCH_EOA, "LAUNCH_KEY_MISMATCH");
        VeydriftUniswapResourcePools launcher = VeydriftUniswapResourcePools(
            vm.envAddress("VEYDRIFT_UNISWAP_RESOURCE_LAUNCHER_ADDRESS")
        );
        require(launcher.launchAuthority() == APPROVED_LAUNCH_EOA, "AUTHORITY_MISMATCH");

        VeydriftUniswapResourcePools.ResourcePoolConfig[3] memory configs;
        configs[0] =
            _config(launcher, launcher.metal(), launcher.METAL_AMOUNT(), "VEYDRIFT_V4_METAL_");
        configs[1] = _config(
            launcher, launcher.crystal(), launcher.CRYSTAL_AMOUNT(), "VEYDRIFT_V4_CRYSTAL_"
        );
        configs[2] = _config(
            launcher, launcher.deuterium(), launcher.DEUTERIUM_AMOUNT(), "VEYDRIFT_V4_DEUTERIUM_"
        );
        uint256 deadline = vm.envUint("VEYDRIFT_RESOURCE_LAUNCH_DEADLINE");
        (bytes32 configHash, bytes32[3] memory predictedIds) = launcher.preflight(configs);
        console2.logBytes32(configHash);
        for (uint256 i = 0; i < 3; i++) {
            console2.logBytes32(predictedIds[i]);
        }

        vm.startBroadcast(privateKey);
        (poolIds, tokenIds) = launcher.launchResourcePools(configs, deadline);
        vm.stopBroadcast();
    }

    function _config(
        VeydriftUniswapResourcePools launcher,
        address resource,
        uint256 resourceAmount,
        string memory prefix
    ) private view returns (VeydriftUniswapResourcePools.ResourcePoolConfig memory config) {
        address veydrift = launcher.mainLaunch().launchToken();
        uint256 veyAmount = launcher.VEYDRIFT_PER_RESOURCE_POOL();
        (uint256 amount0Max, uint256 amount1Max) =
            veydrift < resource ? (veyAmount, resourceAmount) : (resourceAmount, veyAmount);
        uint256 minVeydrift = vm.envUint(string.concat(prefix, "MIN_VEYDRIFT_USED"));
        uint256 minResource = vm.envUint(string.concat(prefix, "MIN_RESOURCE_USED"));
        (uint256 amount0Min, uint256 amount1Min) =
            veydrift < resource ? (minVeydrift, minResource) : (minResource, minVeydrift);
        config = VeydriftUniswapResourcePools.ResourcePoolConfig({
            resourceToken: resource,
            sqrtPriceX96: _uint160(string.concat(prefix, "SQRT_PRICE_X96")),
            fee: _uint24(string.concat(prefix, "FEE")),
            tickSpacing: _int24(string.concat(prefix, "TICK_SPACING")),
            liquidity: _uint128(string.concat(prefix, "LIQUIDITY")),
            amount0Max: amount0Max,
            amount1Max: amount1Max,
            amount0Min: amount0Min,
            amount1Min: amount1Min
        });
    }

    function _uint160(string memory name) private view returns (uint160 value) {
        uint256 raw = vm.envUint(name);
        require(raw <= type(uint160).max, "UINT160_OVERFLOW");
        // forge-lint: disable-next-line(unsafe-typecast)
        value = uint160(raw);
    }

    function _uint128(string memory name) private view returns (uint128 value) {
        uint256 raw = vm.envUint(name);
        require(raw <= type(uint128).max, "UINT128_OVERFLOW");
        // forge-lint: disable-next-line(unsafe-typecast)
        value = uint128(raw);
    }

    function _uint24(string memory name) private view returns (uint24 value) {
        uint256 raw = vm.envUint(name);
        require(raw <= type(uint24).max, "UINT24_OVERFLOW");
        // forge-lint: disable-next-line(unsafe-typecast)
        value = uint24(raw);
    }

    function _int24(string memory name) private view returns (int24 value) {
        int256 raw = vm.envInt(name);
        require(raw >= type(int24).min && raw <= type(int24).max, "INT24_OVERFLOW");
        // forge-lint: disable-next-line(unsafe-typecast)
        value = int24(raw);
    }
}
