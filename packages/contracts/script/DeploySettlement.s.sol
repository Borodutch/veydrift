// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {VeydriftSettlement} from "../src/VeydriftSettlement.sol";

contract DeploySettlement is Script {
    function run() external returns (address settlement) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        bytes32 universeSalt =
            vm.envOr("VEYDRIFT_UNIVERSE_SALT", keccak256("veydrift.base-sepolia.mvp.v1"));

        vm.startBroadcast(privateKey);
        VeydriftSettlement deployed = new VeydriftSettlement(universeSalt);
        vm.stopBroadcast();

        return address(deployed);
    }
}
