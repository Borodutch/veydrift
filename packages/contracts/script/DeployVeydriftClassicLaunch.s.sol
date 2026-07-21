// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VeydriftLPLock, VeydriftLiquidityLauncher} from "../src/VeydriftLiquidityLauncher.sol";

/// @notice Deploys the immutable classic-pool LP lock and one-shot Aerodrome launcher.
/// @dev Pool creation is a separate Safe/authority call to `VeydriftLiquidityLauncher.launch`.
contract DeployVeydriftClassicLaunch is Script {
    address internal constant BASE_AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;

    function run() external returns (address lpLock, address launcher) {
        require(block.chainid == 8453, "BASE_MAINNET_ONLY");
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address launchAuthority = vm.envAddress("VEYDRIFT_LAUNCH_AUTHORITY");
        address lpBeneficiary = vm.envAddress("VEYDRIFT_LP_BENEFICIARY");
        uint256 unlockAt = vm.envUint("VEYDRIFT_LP_UNLOCK_TIMESTAMP");
        require(unlockAt <= type(uint64).max, "LP_UNLOCK_OVERFLOW");

        vm.startBroadcast(privateKey);
        VeydriftLPLock deployedLock = new VeydriftLPLock(lpBeneficiary, uint64(unlockAt));
        VeydriftLiquidityLauncher deployedLauncher = new VeydriftLiquidityLauncher(
            launchAuthority, BASE_AERODROME_ROUTER, address(deployedLock)
        );
        vm.stopBroadcast();

        lpLock = address(deployedLock);
        launcher = address(deployedLauncher);
        console2.log("Classic LP lock:", lpLock);
        console2.log("Launch executor:", launcher);
    }
}
