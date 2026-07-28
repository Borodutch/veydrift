// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {
    VeydriftUniswapCCALauncher,
    VeydriftUniswapDeployments
} from "../src/VeydriftUniswapLaunch.sol";

/// @notice Preflights and registers the owner-approved 250M/250M CCA launch.
/// @dev Never run with --broadcast until the approval digest and final simulation hash are public,
///      reviewed, nonzero values. The script accepts no private key other than PRIVATE_KEY.
contract LaunchVeydriftUniswapCCA is Script {
    address internal constant APPROVED_LAUNCH_EOA = 0xca6C67515aa9aa21DA37e07C7469Fd2C5880e2F4;

    function run() external returns (address auction) {
        require(block.chainid == VeydriftUniswapDeployments.BASE_CHAIN_ID, "BASE_MAINNET_ONLY");
        require(vm.envBytes32("VEYDRIFT_OWNER_APPROVAL_DIGEST") != bytes32(0), "APPROVAL_MISSING");
        require(vm.envBytes32("VEYDRIFT_FINAL_SIMULATION_HASH") != bytes32(0), "SIMULATION_MISSING");
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        require(vm.addr(privateKey) == APPROVED_LAUNCH_EOA, "LAUNCH_KEY_MISMATCH");
        VeydriftUniswapCCALauncher launcher =
            VeydriftUniswapCCALauncher(vm.envAddress("VEYDRIFT_UNISWAP_CCA_LAUNCHER_ADDRESS"));
        require(launcher.launchAuthority() == APPROVED_LAUNCH_EOA, "AUTHORITY_MISMATCH");

        VeydriftUniswapCCALauncher.LaunchConfig memory config = _config();
        require(config.tokensRecipient == APPROVED_LAUNCH_EOA, "UNSOLD_RECIPIENT_MISMATCH");
        require(config.recoveryRecipient == APPROVED_LAUNCH_EOA, "RECOVERY_RECIPIENT_MISMATCH");
        bytes32 salt = vm.envBytes32("VEYDRIFT_CCA_SALT");
        (address predicted, bytes32 configHash, bytes32 poolId) =
            launcher.preflight(vm.envAddress("VEYDRIFT_TOKEN_ADDRESS"), config, salt);
        console2.log("Predicted CCA:", predicted);
        console2.logBytes32(configHash);
        console2.logBytes32(poolId);

        vm.startBroadcast(privateKey);
        auction = launcher.launch(vm.envAddress("VEYDRIFT_TOKEN_ADDRESS"), config, salt);
        vm.stopBroadcast();
        require(auction == predicted, "PREDICTION_MISMATCH");
    }

    function _config()
        private
        view
        returns (VeydriftUniswapCCALauncher.LaunchConfig memory config)
    {
        config = VeydriftUniswapCCALauncher.LaunchConfig({
                tokensRecipient: vm.envAddress("VEYDRIFT_CCA_UNSOLD_TOKENS_RECIPIENT"),
                recoveryRecipient: vm.envAddress("VEYDRIFT_LAUNCH_RECOVERY_RECIPIENT"),
                startBlock: _uint64("VEYDRIFT_CCA_START_BLOCK"),
                endBlock: _uint64("VEYDRIFT_CCA_END_BLOCK"),
                claimBlock: _uint64("VEYDRIFT_CCA_CLAIM_BLOCK"),
                migrationBlock: _uint64("VEYDRIFT_CCA_MIGRATION_BLOCK"),
                auctionTickSpacingQ96: vm.envUint("VEYDRIFT_CCA_TICK_SPACING_Q96"),
                floorPriceQ96: vm.envUint("VEYDRIFT_CCA_FLOOR_PRICE_Q96"),
                requiredWethRaised: _uint128("VEYDRIFT_CCA_REQUIRED_WETH"),
                auctionStepsData: vm.envBytes("VEYDRIFT_CCA_STEPS_DATA"),
                v4Fee: _uint24("VEYDRIFT_V4_MAIN_FEE"),
                v4TickSpacing: _int24("VEYDRIFT_V4_MAIN_TICK_SPACING"),
                lpCurrencyRateMps: _uint24("VEYDRIFT_V4_LP_CURRENCY_RATE_MPS")
            });
    }

    function _uint64(string memory name) private view returns (uint64 value) {
        uint256 raw = vm.envUint(name);
        require(raw <= type(uint64).max, "UINT64_OVERFLOW");
        // forge-lint: disable-next-line(unsafe-typecast)
        value = uint64(raw);
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
