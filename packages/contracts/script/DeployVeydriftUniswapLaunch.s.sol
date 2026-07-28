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
    address internal constant APPROVED_LP_BENEFICIARY = 0xbf74483DB914192bb0a9577f3d8Fb29a6d4c08eE;

    function run() external returns (address lockAddress, address ccaLauncher, address resources) {
        require(block.chainid == VeydriftUniswapDeployments.BASE_CHAIN_ID, "BASE_MAINNET_ONLY");
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address launchAuthority = vm.envAddress("VEYDRIFT_LAUNCH_AUTHORITY");
        require(launchAuthority == APPROVED_LAUNCH_EOA, "UNAPPROVED_LAUNCH_AUTHORITY");
        require(vm.addr(privateKey) == launchAuthority, "LAUNCH_KEY_MISMATCH");
        address beneficiary = vm.envAddress("VEYDRIFT_V4_POSITION_BENEFICIARY");
        address recovery = vm.envAddress("VEYDRIFT_LAUNCH_RECOVERY_RECIPIENT");
        require(beneficiary == APPROVED_LP_BENEFICIARY, "LP_BENEFICIARY_MISMATCH");
        require(recovery == APPROVED_LAUNCH_EOA, "RECOVERY_RECIPIENT_MISMATCH");
        uint64 unlockAt = _validatedUnlockTimestamp(
            vm.envUint("VEYDRIFT_V4_POSITION_UNLOCK_TIMESTAMP")
        );

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

        require(lock.positionManager() == VeydriftUniswapDeployments.POSITION_MANAGER, "LOCK_MANAGER_MISMATCH");
        require(lock.beneficiary() == beneficiary, "LOCK_BENEFICIARY_MISMATCH");
        require(lock.unlockAt() == unlockAt, "LOCK_UNLOCK_MISMATCH");
        require(main.launchAuthority() == launchAuthority, "CCA_AUTHORITY_MISMATCH");
        require(address(main.positionLock()) == address(lock), "CCA_LOCK_MISMATCH");
        require(resourceLauncher.launchAuthority() == launchAuthority, "RESOURCE_AUTHORITY_MISMATCH");
        require(resourceLauncher.recoveryRecipient() == recovery, "RESOURCE_RECOVERY_MISMATCH");
        require(address(resourceLauncher.mainLaunch()) == address(main), "RESOURCE_MAIN_MISMATCH");
        require(address(resourceLauncher.positionLock()) == address(lock), "RESOURCE_LOCK_MISMATCH");

        lockAddress = address(lock);
        ccaLauncher = address(main);
        resources = address(resourceLauncher);
        console2.log("Veydrift v4 position lock:", lockAddress);
        console2.log("Veydrift CCA launcher:", ccaLauncher);
        console2.log("Veydrift resource launcher:", resources);
    }

    function _validatedUnlockTimestamp(uint256 unlockTimestamp) internal view returns (uint64 unlockAt) {
        require(unlockTimestamp <= type(uint64).max, "UNLOCK_TIMESTAMP_OVERFLOW");
        // The LP lock is immutable; never deploy one that is already unlockable.
        // forge-lint: disable-next-line(block-timestamp)
        require(unlockTimestamp > block.timestamp, "UNLOCK_TIMESTAMP_NOT_FUTURE");
        // The preceding bound makes this cast lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        unlockAt = uint64(unlockTimestamp);
    }
}
