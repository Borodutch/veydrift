// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {VeydriftAllianceWarProtection} from "../src/VeydriftAllianceWarProtection.sol";

/// @notice Seeds one pre-replacement active war from a local JSON file:
/// `{ "declarerAllianceId": 16, "declareeAllianceId": 6, "declarerMembers": ["0x..."],
///    "declareeMembers": ["0x..."] }`.
contract SeedLegacyWarProtectionRoster is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        VeydriftAllianceWarProtection protection =
            VeydriftAllianceWarProtection(vm.envAddress("WAR_PROTECTION_ADDRESS"));
        require(
            vm.addr(privateKey) == protection.migrationAuthority(),
            "BROADCASTER_MUST_BE_MIGRATION_AUTHORITY"
        );

        string memory roster = vm.readFile(vm.envString("LEGACY_WAR_ROSTER_FILE"));
        uint256 declarerAllianceId = vm.parseJsonUint(roster, ".declarerAllianceId");
        uint256 declareeAllianceId = vm.parseJsonUint(roster, ".declareeAllianceId");
        address[] memory declarerMembers = vm.parseJsonAddressArray(roster, ".declarerMembers");
        address[] memory declareeMembers = vm.parseJsonAddressArray(roster, ".declareeMembers");

        vm.startBroadcast(privateKey);
        protection.seedLegacyWarRoster(
            declarerAllianceId, declareeAllianceId, declarerMembers, declareeMembers
        );
        vm.stopBroadcast();
    }
}
