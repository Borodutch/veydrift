// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";

/// @notice One-pair migration for a mirrored pre-upgrade war whose original
/// declarer cannot be inferred from contract storage. The owner must derive the
/// declarer and declaration time from verified historical event evidence before
/// running this script. Direct one-way legacy wars do not require migration.
contract MigrateAllianceWarMetadata is Script {
    event AllianceWarMetadataMigrationSubmitted(
        address indexed proxy,
        uint256 indexed allianceId,
        uint256 indexed otherAllianceId,
        uint256 declarerAllianceId,
        uint64 declaredAt
    );

    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address payable proxy = payable(vm.envAddress("ALLIANCE_PROXY_ADDRESS"));
        uint256 allianceId = vm.envUint("WAR_ALLIANCE_ID");
        uint256 otherAllianceId = vm.envUint("WAR_OTHER_ALLIANCE_ID");
        uint256 declarerAllianceId = vm.envUint("WAR_DECLARER_ALLIANCE_ID");
        uint64 declaredAt = uint64(vm.envUint("WAR_DECLARED_AT"));

        VeydriftAllianceSystem proxied = VeydriftAllianceSystem(proxy);
        require(vm.addr(privateKey) == proxied.owner(), "BROADCASTER_MUST_BE_PROXY_OWNER");
        require(proxied.warDeclarer(allianceId, otherAllianceId) == 0, "WAR_DECLARER_ALREADY_KNOWN");

        vm.startBroadcast(privateKey);
        proxied.migrateLegacyWarMetadata(
            allianceId, otherAllianceId, declarerAllianceId, declaredAt
        );
        vm.stopBroadcast();

        emit AllianceWarMetadataMigrationSubmitted(
            proxy, allianceId, otherAllianceId, declarerAllianceId, declaredAt
        );
    }
}
