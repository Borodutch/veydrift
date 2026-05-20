// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";

contract Deploy is Script {
    function run() external returns (address gameAddress) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envOr("ADMIN_ADDRESS", vm.addr(privateKey));
        address metalToken = vm.envOr("METAL_TOKEN_ADDRESS", address(0));
        address crystalToken = vm.envOr("CRYSTAL_TOKEN_ADDRESS", address(0));
        address deuteriumToken = vm.envOr("DEUTERIUM_TOKEN_ADDRESS", address(0));
        require(
            metalToken != address(0) && crystalToken != address(0) && deuteriumToken != address(0),
            "RESOURCE_TOKEN_ADDRESSES_REQUIRED"
        );

        vm.startBroadcast(privateKey);
        VeydriftGame game = new VeydriftGame(admin);
        game.setResourceTokens(metalToken, crystalToken, deuteriumToken);
        vm.stopBroadcast();

        return address(game);
    }
}
