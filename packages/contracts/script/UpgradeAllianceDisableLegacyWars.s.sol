// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";

/// @notice Upgrades the Alliance proxy and clears every supplied legacy war in that same owner tx.
/// @dev Supply canonical, comma-separated pair lists: `1,1,1` and `4,5,6`.
contract UpgradeAllianceDisableLegacyWars is Script {
    event AllianceLegacyWarsDisabled(
        address indexed proxy, address indexed implementation, uint256 legacyWarCount
    );

    function run() external returns (address newImplementation) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address payable proxy = payable(vm.envAddress("ALLIANCE_PROXY_ADDRESS"));
        uint256[] memory allianceIds = vm.envUint("LEGACY_WAR_ALLIANCE_IDS", ",");
        uint256[] memory otherAllianceIds = vm.envUint("LEGACY_WAR_OTHER_ALLIANCE_IDS", ",");
        require(allianceIds.length != 0, "NO_LEGACY_WARS_SUPPLIED");
        require(allianceIds.length == otherAllianceIds.length, "LEGACY_WAR_LENGTH_MISMATCH");

        VeydriftAllianceSystem proxied = VeydriftAllianceSystem(proxy);
        IVeydriftAllianceGame game = proxied.game();
        require(address(game) != address(0), "ALLIANCE_GAME_NOT_CONFIGURED");
        require(vm.addr(privateKey) == proxied.owner(), "BROADCASTER_MUST_BE_PROXY_OWNER");

        vm.startBroadcast(privateKey);
        newImplementation = address(new VeydriftAllianceSystem(game));
        proxied.upgradeToAndCall(
            newImplementation,
            abi.encodeCall(
                VeydriftAllianceSystem.disableLegacyWars, (allianceIds, otherAllianceIds)
            )
        );
        vm.stopBroadcast();

        emit AllianceLegacyWarsDisabled(proxy, newImplementation, allianceIds.length);
    }
}
