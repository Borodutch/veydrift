// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployVeydriftToken} from "../script/DeployVeydriftToken.s.sol";

contract DeployVeydriftTokenHarness is DeployVeydriftToken {
    function validateVestingStart(uint256 start) external view returns (uint64) {
        return _validatedVestingStart(start);
    }
}

contract DeployVeydriftTokenTest is Test {
    DeployVeydriftTokenHarness internal deployer;

    function setUp() public {
        vm.warp(2_000_000_000);
        deployer = new DeployVeydriftTokenHarness();
    }

    function testVestingStartRejectsZeroAndPastValues() public {
        vm.expectRevert("VESTING_START_ZERO");
        deployer.validateVestingStart(0);

        vm.expectRevert("VESTING_START_NOT_FUTURE");
        deployer.validateVestingStart(block.timestamp);
    }

    function testVestingStartRejectsFarFutureValue() public {
        vm.expectRevert("VESTING_START_TOO_FAR");
        deployer.validateVestingStart(block.timestamp + 30 days + 1);
    }

    function testVestingStartAcceptsBoundedFutureValue() public view {
        uint64 start = deployer.validateVestingStart(block.timestamp + 1 days);
        assertEq(start, uint64(block.timestamp + 1 days));
    }
}
