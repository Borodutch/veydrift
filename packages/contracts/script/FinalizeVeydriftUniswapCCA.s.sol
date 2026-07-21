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
        bool reconcile = vm.envOr("VEYDRIFT_RECONCILE_MIGRATION", false);
        uint256 positionTokenId = vm.envOr("VEYDRIFT_UNISWAP_MAIN_POSITION_TOKEN_ID", uint256(0));
        bytes32 evidenceHash =
            reconcile ? vm.envBytes32("VEYDRIFT_MIGRATION_EVIDENCE_DIGEST") : bytes32(0);
        if (reconcile) {
            require(vm.addr(privateKey) == launcher.launchAuthority(), "RECONCILE_AUTHORITY_ONLY");
            require(evidenceHash != bytes32(0), "MIGRATION_EVIDENCE_MISSING");
        }

        vm.startBroadcast(privateKey);
        positionMinted = reconcile
            ? launcher.reconcileMigration(positionTokenId, evidenceHash)
            : launcher.finalizeAndMigrate();
        vm.stopBroadcast();
        require(launcher.migrationAttempted(), "MIGRATION_STATE_MISSING");
        if (positionMinted) {
            require(launcher.migrationSucceeded(), "MIGRATION_SUCCESS_STATE_MISSING");
            require(launcher.mainPositionTokenId() != 0, "MAIN_POSITION_MISSING");
            if (reconcile) {
                require(
                    launcher.reconciliationEvidenceHash() == evidenceHash,
                    "MIGRATION_EVIDENCE_STATE_MISMATCH"
                );
            }
            console2.log(
                reconcile
                    ? "CCA direct migration reconciled"
                    : "CCA migrated into locked v4 position"
            );
            console2.log("Main v4 position token id", launcher.mainPositionTokenId());
        } else {
            require(!launcher.migrationSucceeded(), "MIGRATION_FAILURE_STATE_MISMATCH");
            console2.log("CCA migration entered the terminal recovery branch");
        }
    }
}
