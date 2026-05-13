// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Script.sol";
import "../src/Placeholder.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        new Placeholder();
        vm.stopBroadcast();
    }
}
