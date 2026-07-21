// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {
    VeydriftContributorVestingWallet,
    VeydriftDevelopmentVestingWallet,
    VeydriftEcosystemVestingWallet,
    VeydriftToken
} from "../src/VeydriftToken.sol";

/// @notice Deploys the fixed-supply token and immutable release wallets from explicit inputs.
/// @dev This script does not deploy liquidity, move resource reserves, or create pools.
contract DeployVeydriftToken is Script {
    address internal constant APPROVED_LAUNCH_EOA = 0xca6C67515aa9aa21DA37e07C7469Fd2C5880e2F4;

    function run()
        external
        returns (
            address token,
            address developmentWallet,
            address contributorWallet,
            address ecosystemWallet
        )
    {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address launchBootstrapRecipient = vm.envAddress("VEYDRIFT_LAUNCH_AUTHORITY");
        require(launchBootstrapRecipient == APPROVED_LAUNCH_EOA, "UNAPPROVED_LAUNCH_AUTHORITY");
        address resourceLiquidityTreasury = vm.envAddress("VEYDRIFT_RESOURCE_LIQUIDITY_TREASURY");
        address developmentBeneficiary = vm.envAddress("VEYDRIFT_DEVELOPMENT_BENEFICIARY");
        address contributorBeneficiary = vm.envAddress("VEYDRIFT_CONTRIBUTOR_BENEFICIARY");
        address ecosystemBeneficiary = vm.envAddress("VEYDRIFT_ECOSYSTEM_BENEFICIARY");
        uint256 start = vm.envUint("VEYDRIFT_VESTING_START_TIMESTAMP");
        require(start <= type(uint64).max, "VESTING_START_OVERFLOW");
        // The preceding bound check makes this timestamp cast lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 startTimestamp = uint64(start);

        vm.startBroadcast(privateKey);
        VeydriftDevelopmentVestingWallet development =
            new VeydriftDevelopmentVestingWallet(developmentBeneficiary, startTimestamp);
        VeydriftContributorVestingWallet contributor =
            new VeydriftContributorVestingWallet(contributorBeneficiary, startTimestamp);
        VeydriftEcosystemVestingWallet ecosystem =
            new VeydriftEcosystemVestingWallet(ecosystemBeneficiary, startTimestamp);
        VeydriftToken deployedToken = new VeydriftToken(
            launchBootstrapRecipient,
            resourceLiquidityTreasury,
            address(development),
            address(contributor),
            address(ecosystem)
        );
        vm.stopBroadcast();

        token = address(deployedToken);
        developmentWallet = address(development);
        contributorWallet = address(contributor);
        ecosystemWallet = address(ecosystem);

        require(deployedToken.totalSupply() == deployedToken.MAX_SUPPLY(), "BAD_TOTAL_SUPPLY");
        require(
            deployedToken.CCA_ALLOCATION() + deployedToken.V4_MAIN_LIQUIDITY_ALLOCATION()
                == deployedToken.LAUNCH_BOOTSTRAP_ALLOCATION(),
            "BAD_LAUNCH_BOOTSTRAP_SPLIT"
        );
        require(
            deployedToken.balanceOf(launchBootstrapRecipient)
                == deployedToken.LAUNCH_BOOTSTRAP_ALLOCATION(),
            "BAD_LAUNCH_BOOTSTRAP_ALLOCATION"
        );
        require(
            deployedToken.balanceOf(resourceLiquidityTreasury)
                == deployedToken.RESOURCE_LIQUIDITY_ALLOCATION(),
            "BAD_RESOURCE_ALLOCATION"
        );
        require(
            deployedToken.balanceOf(developmentWallet) == deployedToken.DEVELOPMENT_ALLOCATION(),
            "BAD_DEVELOPMENT_ALLOCATION"
        );
        require(
            deployedToken.balanceOf(contributorWallet) == deployedToken.CONTRIBUTOR_ALLOCATION(),
            "BAD_CONTRIBUTOR_ALLOCATION"
        );
        require(
            deployedToken.balanceOf(ecosystemWallet) == deployedToken.ECOSYSTEM_ALLOCATION(),
            "BAD_ECOSYSTEM_ALLOCATION"
        );

        console2.log("VEYDRIFT token:      ", token);
        console2.log("Development vesting:", developmentWallet);
        console2.log("Contributor vesting:", contributorWallet);
        console2.log("Ecosystem vesting:  ", ecosystemWallet);
    }
}
