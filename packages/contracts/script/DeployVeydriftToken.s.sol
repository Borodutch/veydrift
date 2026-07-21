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
        address ethLiquidityTreasury = vm.envAddress("VEYDRIFT_ETH_LIQUIDITY_TREASURY");
        address resourceLiquidityTreasury = vm.envAddress("VEYDRIFT_RESOURCE_LIQUIDITY_TREASURY");
        address developmentBeneficiary = vm.envAddress("VEYDRIFT_DEVELOPMENT_BENEFICIARY");
        address contributorBeneficiary = vm.envAddress("VEYDRIFT_CONTRIBUTOR_BENEFICIARY");
        address ecosystemBeneficiary = vm.envAddress("VEYDRIFT_ECOSYSTEM_BENEFICIARY");
        uint256 start = vm.envUint("VEYDRIFT_VESTING_START_TIMESTAMP");
        require(start <= type(uint64).max, "VESTING_START_OVERFLOW");

        vm.startBroadcast(privateKey);
        VeydriftDevelopmentVestingWallet development =
            new VeydriftDevelopmentVestingWallet(developmentBeneficiary, uint64(start));
        VeydriftContributorVestingWallet contributor =
            new VeydriftContributorVestingWallet(contributorBeneficiary, uint64(start));
        VeydriftEcosystemVestingWallet ecosystem =
            new VeydriftEcosystemVestingWallet(ecosystemBeneficiary, uint64(start));
        VeydriftToken deployedToken = new VeydriftToken(
            ethLiquidityTreasury,
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
