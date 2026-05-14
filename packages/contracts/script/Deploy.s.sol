// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";

contract Deploy is Script {
    function run() external returns (address proxy, address implementation) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envOr("ADMIN_ADDRESS", vm.addr(privateKey));

        vm.startBroadcast(privateKey);
        VeydriftGame gameImplementation = new VeydriftGame();
        bytes memory initData = abi.encodeCall(VeydriftGame.initialize, (admin));
        ERC1967Proxy gameProxy = new ERC1967Proxy(address(gameImplementation), initData);
        vm.stopBroadcast();

        return (address(gameProxy), address(gameImplementation));
    }
}
