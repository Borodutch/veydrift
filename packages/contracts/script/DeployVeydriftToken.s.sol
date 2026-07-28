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
    uint256 internal constant MAX_VESTING_START_LEAD = 30 days;

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
        uint64 startTimestamp =
            _validatedVestingStart(vm.envUint("VEYDRIFT_VESTING_START_TIMESTAMP"));

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
        _assertVestingWallets(
            deployedToken,
            development,
            contributor,
            ecosystem,
            developmentBeneficiary,
            contributorBeneficiary,
            ecosystemBeneficiary,
            startTimestamp
        );

        console2.log("VEYDRIFT token:      ", token);
        console2.log("Development vesting:", developmentWallet);
        console2.log("Contributor vesting:", contributorWallet);
        console2.log("Ecosystem vesting:  ", ecosystemWallet);
    }

    /// @dev Genesis vesting must not be backdated or left effectively unconfigured. The bounded
    ///      future window catches zero/past values and accidental far-future deployments while
    ///      still allowing the deployment manifest to name a concrete launch timestamp.
    function _validatedVestingStart(uint256 start) internal view returns (uint64 startTimestamp) {
        require(start != 0, "VESTING_START_ZERO");
        require(start <= type(uint64).max, "VESTING_START_OVERFLOW");
        require(start > block.timestamp, "VESTING_START_NOT_FUTURE");
        require(start <= block.timestamp + MAX_VESTING_START_LEAD, "VESTING_START_TOO_FAR");
        // The preceding bound check makes this timestamp cast lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        startTimestamp = uint64(start);
    }

    function _assertVestingWallets(
        VeydriftToken deployedToken,
        VeydriftDevelopmentVestingWallet development,
        VeydriftContributorVestingWallet contributor,
        VeydriftEcosystemVestingWallet ecosystem,
        address developmentBeneficiary,
        address contributorBeneficiary,
        address ecosystemBeneficiary,
        uint64 startTimestamp
    ) private view {
        require(development.owner() == developmentBeneficiary, "BAD_DEVELOPMENT_BENEFICIARY");
        require(contributor.owner() == contributorBeneficiary, "BAD_CONTRIBUTOR_BENEFICIARY");
        require(ecosystem.owner() == ecosystemBeneficiary, "BAD_ECOSYSTEM_BENEFICIARY");
        require(development.start() == startTimestamp, "BAD_DEVELOPMENT_START");
        require(contributor.start() == startTimestamp, "BAD_CONTRIBUTOR_START");
        require(ecosystem.start() == startTimestamp, "BAD_ECOSYSTEM_START");
        require(
            development.duration() == development.RELEASE_DURATION(), "BAD_DEVELOPMENT_DURATION"
        );
        require(
            contributor.duration() == contributor.RELEASE_DURATION(), "BAD_CONTRIBUTOR_DURATION"
        );
        require(ecosystem.duration() == ecosystem.RELEASE_DURATION(), "BAD_ECOSYSTEM_DURATION");
        require(
            development.end() == uint256(startTimestamp) + development.RELEASE_DURATION(),
            "BAD_DEVELOPMENT_END"
        );
        require(
            contributor.end() == uint256(startTimestamp) + contributor.RELEASE_DURATION(),
            "BAD_CONTRIBUTOR_END"
        );
        require(
            ecosystem.end() == uint256(startTimestamp) + ecosystem.RELEASE_DURATION(),
            "BAD_ECOSYSTEM_END"
        );
        require(
            contributor.cliff() == uint256(startTimestamp) + contributor.CLIFF_DURATION(),
            "BAD_CONTRIBUTOR_CLIFF"
        );
        require(development.releasable(address(deployedToken)) == 0, "DEVELOPMENT_RELEASABLE");
        require(contributor.releasable(address(deployedToken)) == 0, "CONTRIBUTOR_RELEASABLE");
        require(ecosystem.releasable(address(deployedToken)) == 0, "ECOSYSTEM_RELEASABLE");
    }
}
