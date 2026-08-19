// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftAllianceWarProtection} from "../src/VeydriftAllianceWarProtection.sol";

/// @notice Points the Alliance proxy at a replacement module after every active legacy roster
///         has been seeded and independently verified.
contract ActivateWarProtection is Script {
    event WarProtectionActivated(address indexed proxy, address indexed module);

    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address payable proxy = payable(vm.envAddress("ALLIANCE_PROXY_ADDRESS"));
        address module = vm.envAddress("WAR_PROTECTION_ADDRESS");

        VeydriftAllianceSystem proxied = VeydriftAllianceSystem(proxy);
        VeydriftAllianceWarProtection candidate = VeydriftAllianceWarProtection(module);

        require(vm.addr(privateKey) == proxied.owner(), "BROADCASTER_MUST_BE_PROXY_OWNER");
        require(candidate.alliance() == address(proxied), "WRONG_ALLIANCE_BINDING");
        require(address(candidate.game()) == address(proxied.game()), "WRONG_GAME_BINDING");

        vm.broadcast(privateKey);
        proxied.setWarProtection(module);
        emit WarProtectionActivated(proxy, module);
    }
}
