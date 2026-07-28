// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployVeydriftUniswapLaunch} from "../script/DeployVeydriftUniswapLaunch.s.sol";

contract DeployVeydriftUniswapLaunchHarness is DeployVeydriftUniswapLaunch {
    function validateUnlockTimestamp(uint256 unlockTimestamp) external view returns (uint64) {
        return _validatedUnlockTimestamp(unlockTimestamp);
    }
}

contract DeployVeydriftUniswapLaunchTest is Test {
    DeployVeydriftUniswapLaunchHarness internal deployer;

    function setUp() public {
        vm.warp(2_000_000_000);
        deployer = new DeployVeydriftUniswapLaunchHarness();
    }

    function testUnlockTimestampRejectsPastAndOverflowValues() public {
        vm.expectRevert("UNLOCK_TIMESTAMP_NOT_FUTURE");
        deployer.validateUnlockTimestamp(block.timestamp);

        vm.expectRevert("UNLOCK_TIMESTAMP_OVERFLOW");
        deployer.validateUnlockTimestamp(uint256(type(uint64).max) + 1);
    }

    function testUnlockTimestampAcceptsFutureValue() public view {
        assertEq(deployer.validateUnlockTimestamp(block.timestamp + 365 days), uint64(block.timestamp + 365 days));
    }
}
