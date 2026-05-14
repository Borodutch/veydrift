// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";

contract Upgrade is Script {
    function run() external returns (address implementation) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address proxy = vm.envAddress("PROXY_ADDRESS");

        vm.startBroadcast(privateKey);
        VeydriftGame nextImplementation = new VeydriftGame();
        VeydriftGame(payable(proxy)).upgradeToAndCall(address(nextImplementation), "");
        vm.stopBroadcast();

        return address(nextImplementation);
    }
}
