// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";

/// @notice Storage-compatible UUPS upgrade adding a bounded FIFO precommit inventory.
contract UpgradeRandomnessEngine is Script {
    function run() external returns (address newImplementation) {
        // Public identity only for a keyless dry run. UPGRADE_DRY_RUN_OWNER must be the proxy
        // owner. Never pass --broadcast for rehearsal.
        address rehearsalOwner = vm.envOr("UPGRADE_DRY_RUN_OWNER", address(0));
        uint256 privateKey;
        address broadcaster = rehearsalOwner;
        if (rehearsalOwner == address(0)) {
            privateKey = vm.envUint("PRIVATE_KEY");
            broadcaster = vm.addr(privateKey);
        }
        address payable proxy = payable(vm.envAddress("RANDOMNESS_PROXY_ADDRESS"));

        RandomnessEngine proxied = RandomnessEngine(proxy);
        address owner = proxied.owner();
        address fulfiller = proxied.fulfiller();
        require(owner != address(0), "RANDOMNESS_OWNER_NOT_CONFIGURED");
        require(fulfiller != address(0), "RANDOMNESS_FULFILLER_NOT_CONFIGURED");
        require(broadcaster == owner, "BROADCASTER_MUST_BE_PROXY_OWNER");

        if (rehearsalOwner != address(0)) vm.startBroadcast(rehearsalOwner);
        else vm.startBroadcast(privateKey);
        RandomnessEngine implementation = new RandomnessEngine(owner, fulfiller);
        newImplementation = address(implementation);
        proxied.upgradeToAndCall(newImplementation, "");
        vm.stopBroadcast();

        console2.log("RandomnessEngine proxy:", proxy);
        console2.log("New implementation:", newImplementation);
        console2.log("Owner:", owner);
        console2.log("Fulfiller:", fulfiller);
    }
}
