// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VeydriftLiquidityLauncher} from "../src/VeydriftLiquidityLauncher.sol";

/// @notice Executes the one-shot classic volatile launch from an EOA authority.
/// @dev For a Safe authority, generate the equivalent `launch(...)` calldata and execute through
///      the Safe UI after simulation; never expose or import a Safe signer key into this script.
contract LaunchVeydriftClassicLiquidity is Script {
    function run() external returns (address[4] memory pools) {
        require(block.chainid == 8453, "BASE_MAINNET_ONLY");
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        VeydriftLiquidityLauncher launcher =
            VeydriftLiquidityLauncher(vm.envAddress("VEYDRIFT_LIQUIDITY_LAUNCHER_ADDRESS"));
        require(vm.addr(privateKey) == launcher.launchAuthority(), "LAUNCH_AUTHORITY_MISMATCH");

        vm.startBroadcast(privateKey);
        pools = launcher.launch(
            vm.envAddress("VEYDRIFT_TOKEN_ADDRESS"),
            vm.envAddress("VEYDRIFT_METAL_TOKEN_ADDRESS"),
            vm.envAddress("VEYDRIFT_CRYSTAL_TOKEN_ADDRESS"),
            vm.envAddress("VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS"),
            vm.envUint("VEYDRIFT_WETH_LAUNCH_AMOUNT"),
            vm.envUint("VEYDRIFT_LAUNCH_DEADLINE")
        );
        vm.stopBroadcast();

        console2.log("VEYDRIFT/WETH pool:    ", pools[0]);
        console2.log("vMETAL/VEYDRIFT pool:  ", pools[1]);
        console2.log("vCRYSTAL/VEYDRIFT pool:", pools[2]);
        console2.log("vDEUT/VEYDRIFT pool:   ", pools[3]);
    }
}
