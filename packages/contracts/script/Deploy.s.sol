// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";

contract Deploy is Script {
    function run() external returns (address gameAddress) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envOr("ADMIN_ADDRESS", vm.addr(privateKey));

        vm.startBroadcast(privateKey);
        VeydriftGame game = new VeydriftGame(admin);
        vm.stopBroadcast();

        return address(game);
    }
}
