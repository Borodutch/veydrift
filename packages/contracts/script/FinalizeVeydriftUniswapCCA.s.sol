// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {
    VeydriftUniswapCCALauncher,
    VeydriftUniswapDeployments
} from "../src/VeydriftUniswapLaunch.sol";

/// @notice Permissionless final checkpoint-to-v4 migration transaction wrapper.
contract FinalizeVeydriftUniswapCCA is Script {
    function run() external returns (bool positionMinted) {
        require(block.chainid == VeydriftUniswapDeployments.BASE_CHAIN_ID, "BASE_MAINNET_ONLY");
        require(vm.envBytes32("VEYDRIFT_OWNER_APPROVAL_DIGEST") != bytes32(0), "APPROVAL_MISSING");
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        VeydriftUniswapCCALauncher launcher =
            VeydriftUniswapCCALauncher(vm.envAddress("VEYDRIFT_UNISWAP_CCA_LAUNCHER_ADDRESS"));

        vm.startBroadcast(privateKey);
        positionMinted = launcher.finalizeAndMigrate();
        vm.stopBroadcast();
        require(positionMinted, "MIGRATION_RECOVERY_BRANCH");
        console2.log("CCA migrated into locked v4 position");
    }
}
