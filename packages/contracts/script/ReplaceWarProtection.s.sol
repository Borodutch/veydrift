// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftAllianceWarProtection} from "../src/VeydriftAllianceWarProtection.sol";

/// @notice Stages a replacement war-protection module. Existing active snapshots need their
///         original-side rosters seeded in the replacement before the Alliance proxy is pointed
///         at it; this script deliberately does not change the live module pointer.
contract ReplaceWarProtection is Script {
    event WarProtectionStaged(
        address indexed proxy, address indexed oldModule, address indexed newModule
    );

    function run() external returns (address newModule) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address payable proxy = payable(vm.envAddress("ALLIANCE_PROXY_ADDRESS"));
        VeydriftAllianceSystem proxied = VeydriftAllianceSystem(proxy);
        IVeydriftAllianceGame game = proxied.game();
        require(address(game) != address(0), "ALLIANCE_GAME_NOT_CONFIGURED");
        require(vm.addr(privateKey) == proxied.owner(), "BROADCASTER_MUST_BE_PROXY_OWNER");

        address oldModule = address(proxied.warProtection());
        require(oldModule != address(0), "WAR_PROTECTION_NOT_CONFIGURED");

        vm.startBroadcast(privateKey);
        VeydriftAllianceWarProtection replacement = new VeydriftAllianceWarProtection(
            address(proxied), address(game), oldModule, proxied.owner()
        );
        vm.stopBroadcast();

        newModule = address(replacement);
        emit WarProtectionStaged(proxy, oldModule, newModule);
    }
}
