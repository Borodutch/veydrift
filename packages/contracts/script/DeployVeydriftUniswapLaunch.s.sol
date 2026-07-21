// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {
    VeydriftUniswapCCALauncher,
    VeydriftUniswapDeployments,
    VeydriftV4PositionLock
} from "../src/VeydriftUniswapLaunch.sol";
import {
    IVeydriftMainLaunch,
    VeydriftUniswapResourcePools
} from "../src/VeydriftUniswapResourcePools.sol";

/// @notice Deploys the immutable lock and the two one-shot Uniswap launch executors.
/// @dev Deployment does not create an auction, move launch inventory, or create liquidity.
contract DeployVeydriftUniswapLaunch is Script {
    address internal constant APPROVED_LAUNCH_EOA = 0xca6C67515aa9aa21DA37e07C7469Fd2C5880e2F4;

    function run() external returns (address lockAddress, address ccaLauncher, address resources) {
        require(block.chainid == VeydriftUniswapDeployments.BASE_CHAIN_ID, "BASE_MAINNET_ONLY");
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address launchAuthority = vm.envAddress("VEYDRIFT_LAUNCH_AUTHORITY");
        require(launchAuthority == APPROVED_LAUNCH_EOA, "UNAPPROVED_LAUNCH_AUTHORITY");
        address beneficiary = vm.envAddress("VEYDRIFT_V4_POSITION_BENEFICIARY");
        address recovery = vm.envAddress("VEYDRIFT_LAUNCH_RECOVERY_RECIPIENT");
        uint256 unlockTimestamp = vm.envUint("VEYDRIFT_V4_POSITION_UNLOCK_TIMESTAMP");
        require(unlockTimestamp <= type(uint64).max, "UNLOCK_TIMESTAMP_OVERFLOW");
        // Bound checked above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 unlockAt = uint64(unlockTimestamp);

        vm.startBroadcast(privateKey);
        VeydriftV4PositionLock lock = new VeydriftV4PositionLock(
            VeydriftUniswapDeployments.POSITION_MANAGER, beneficiary, unlockAt
        );
        VeydriftUniswapCCALauncher main = new VeydriftUniswapCCALauncher(launchAuthority, lock);
        VeydriftUniswapResourcePools resourceLauncher = new VeydriftUniswapResourcePools(
            launchAuthority,
            recovery,
            IVeydriftMainLaunch(address(main)),
            vm.envAddress("VEYDRIFT_METAL_TOKEN_ADDRESS"),
            vm.envAddress("VEYDRIFT_CRYSTAL_TOKEN_ADDRESS"),
            vm.envAddress("VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS"),
            lock
        );
        vm.stopBroadcast();

        lockAddress = address(lock);
        ccaLauncher = address(main);
        resources = address(resourceLauncher);
        console2.log("Veydrift v4 position lock:", lockAddress);
        console2.log("Veydrift CCA launcher:", ccaLauncher);
        console2.log("Veydrift resource launcher:", resources);
    }
}
