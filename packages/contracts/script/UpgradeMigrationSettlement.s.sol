// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VeydriftMigrationSettlement} from "../src/VeydriftMigrationSettlement.sol";

/// @notice Storage-compatible UUPS upgrade for the live migration settlement proxy.
/// The broadcasting account must be the proxy owner because `_authorizeUpgrade`
/// is owner-gated.
contract UpgradeMigrationSettlement is Script {
    event MigrationSettlementUpgraded(address indexed proxy, address indexed implementation);

    function run() external returns (address newImplementation) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address payable proxy = payable(vm.envAddress("MIGRATION_PROXY_ADDRESS"));

        VeydriftMigrationSettlement proxied = VeydriftMigrationSettlement(proxy);
        require(vm.addr(privateKey) == proxied.owner(), "BROADCASTER_MUST_BE_PROXY_OWNER");

        vm.startBroadcast(privateKey);
        VeydriftMigrationSettlement implementation = new VeydriftMigrationSettlement();
        newImplementation = address(implementation);
        proxied.upgradeToAndCall(newImplementation, "");
        vm.stopBroadcast();

        console2.log("VeydriftMigrationSettlement proxy:", proxy);
        console2.log("New implementation:", newImplementation);
        emit MigrationSettlementUpgraded(proxy, newImplementation);
    }
}
