// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {
    VeydriftContributorVestingWallet,
    VeydriftDevelopmentVestingWallet,
    VeydriftEcosystemVestingWallet,
    VeydriftToken
} from "../src/VeydriftToken.sol";

contract VeydriftTokenTest is Test {
    address internal ethLiquidity = address(0x1001);
    address internal resourceLiquidity = address(0x1002);
    address internal developmentBeneficiary = address(0x1003);
    address internal contributorBeneficiary = address(0x1004);
    address internal ecosystemBeneficiary = address(0x1005);
    uint64 internal start = 2_000_000_000;

    VeydriftToken internal token;
    VeydriftDevelopmentVestingWallet internal development;
    VeydriftContributorVestingWallet internal contributor;
    VeydriftEcosystemVestingWallet internal ecosystem;

    function setUp() public {
        development = new VeydriftDevelopmentVestingWallet(developmentBeneficiary, start);
        contributor = new VeydriftContributorVestingWallet(contributorBeneficiary, start);
        ecosystem = new VeydriftEcosystemVestingWallet(ecosystemBeneficiary, start);
        token = new VeydriftToken(
            ethLiquidity,
            resourceLiquidity,
            address(development),
            address(contributor),
            address(ecosystem)
        );
    }

    function testGenesisSupplyAndAllocationsAreExact() public view {
        assertEq(token.name(), "Veydrift");
        assertEq(token.symbol(), "VEYDRIFT");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.LAUNCH_BOOTSTRAP_ALLOCATION(), 500_000_000 ether);
        assertEq(token.CCA_ALLOCATION(), 250_000_000 ether);
        assertEq(token.V4_MAIN_LIQUIDITY_ALLOCATION(), 250_000_000 ether);
        assertEq(
            token.CCA_ALLOCATION() + token.V4_MAIN_LIQUIDITY_ALLOCATION(),
            token.LAUNCH_BOOTSTRAP_ALLOCATION()
        );
        assertEq(token.balanceOf(ethLiquidity), 500_000_000 ether);
        assertEq(token.balanceOf(resourceLiquidity), 150_000_000 ether);
        assertEq(token.balanceOf(address(development)), 150_000_000 ether);
        assertEq(token.balanceOf(address(contributor)), 100_000_000 ether);
        assertEq(token.balanceOf(address(ecosystem)), 100_000_000 ether);
    }

    function testTokenHasNoMintOwnerOrUpgradeSurface() public {
        bytes[3] memory calls = [
            abi.encodeWithSignature("mint(address,uint256)", address(this), 1),
            abi.encodeWithSignature("owner()"),
            abi.encodeWithSignature("upgradeToAndCall(address,bytes)", address(this), bytes(""))
        ];
        for (uint256 i = 0; i < calls.length; ++i) {
            (bool success,) = address(token).call(calls[i]);
            assertFalse(success);
        }
        assertEq(token.totalSupply(), token.MAX_SUPPLY());
    }

    function testDevelopmentReleaseIsLinearOverFiveYears() public {
        vm.warp(start - 1);
        assertEq(development.releasable(address(token)), 0);

        vm.warp(start + 365 days);
        assertEq(development.releasable(address(token)), 30_000_000 ether);
        development.release(address(token));
        assertEq(token.balanceOf(developmentBeneficiary), 30_000_000 ether);

        vm.warp(start + 5 * 365 days);
        development.release(address(token));
        assertEq(token.balanceOf(developmentBeneficiary), 150_000_000 ether);
    }

    function testContributorReleaseHasOneYearCliffAndFourYearSchedule() public {
        vm.warp(start + 365 days - 1);
        assertEq(contributor.releasable(address(token)), 0);

        vm.warp(start + 365 days);
        assertEq(contributor.releasable(address(token)), 25_000_000 ether);
        contributor.release(address(token));
        assertEq(token.balanceOf(contributorBeneficiary), 25_000_000 ether);

        vm.warp(start + 4 * 365 days);
        contributor.release(address(token));
        assertEq(token.balanceOf(contributorBeneficiary), 100_000_000 ether);
    }

    function testEcosystemReleaseIsLinearOverSixYears() public {
        vm.warp(start + 3 * 365 days);
        assertEq(ecosystem.releasable(address(token)), 50_000_000 ether);
        ecosystem.release(address(token));
        assertEq(token.balanceOf(ecosystemBeneficiary), 50_000_000 ether);

        vm.warp(start + 6 * 365 days);
        ecosystem.release(address(token));
        assertEq(token.balanceOf(ecosystemBeneficiary), 100_000_000 ether);
    }

    function testVestingBeneficiaryCannotBypassSchedule() public {
        vm.warp(start + 100 days);
        vm.prank(contributorBeneficiary);
        contributor.release(address(token));
        assertEq(token.balanceOf(contributorBeneficiary), 0);
        assertEq(token.balanceOf(address(contributor)), 100_000_000 ether);
    }
}
