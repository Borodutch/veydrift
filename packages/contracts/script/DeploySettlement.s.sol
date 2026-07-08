// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftSettlement} from "../src/VeydriftSettlement.sol";

contract DeploySettlement is Script {
    function run() external returns (address settlement) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        bytes32 universeSalt =
            vm.envOr("VEYDRIFT_UNIVERSE_SALT", keccak256("veydrift.base-mainnet.v1"));
        address admin = vm.envOr("SETTLEMENT_UPGRADE_ADMIN_ADDRESS", vm.addr(privateKey));

        vm.startBroadcast(privateKey);
        VeydriftSettlement implementation = new VeydriftSettlement(universeSalt);
        ERC1967Proxy deployed = new ERC1967Proxy(
            address(implementation),
            abi.encodeCall(VeydriftSettlement.initialize, (admin, universeSalt))
        );
        vm.stopBroadcast();

        return address(deployed);
    }
}
