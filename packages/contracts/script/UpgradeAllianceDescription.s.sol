// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";

/// @notice Storage-compatible UUPS upgrade that makes alliance creation emit the existing
/// full-profile event. It deliberately leaves every configured dependency and module unchanged.
contract UpgradeAllianceDescription is Script {
    event AllianceDescriptionImplementationUpgraded(
        address indexed proxy, address indexed implementation
    );

    function run() external returns (address newImplementation) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address payable proxy = payable(vm.envAddress("ALLIANCE_PROXY_ADDRESS"));
        VeydriftAllianceSystem proxied = VeydriftAllianceSystem(proxy);

        address expectedOwner = proxied.owner();
        IVeydriftAllianceGame expectedGame = proxied.game();
        address expectedWarProtection = address(proxied.warProtection());
        address expectedPaidInviteSystem = proxied.paidInviteSystem();
        uint256 expectedNextAllianceId = proxied.nextAllianceId();
        uint64 expectedWarMinimumDurationActivatedAt = proxied.warMinimumDurationActivatedAt();

        require(address(expectedGame) != address(0), "ALLIANCE_GAME_NOT_CONFIGURED");
        require(vm.addr(privateKey) == expectedOwner, "BROADCASTER_MUST_BE_PROXY_OWNER");

        vm.startBroadcast(privateKey);
        newImplementation =
            address(new VeydriftAllianceSystem(IVeydriftAllianceGame(address(expectedGame))));
        proxied.upgradeToAndCall(newImplementation, "");
        vm.stopBroadcast();

        require(proxied.owner() == expectedOwner, "OWNER_CHANGED");
        require(address(proxied.game()) == address(expectedGame), "GAME_CHANGED");
        require(address(proxied.warProtection()) == expectedWarProtection, "WAR_PROTECTION_CHANGED");
        require(proxied.paidInviteSystem() == expectedPaidInviteSystem, "PAID_INVITES_CHANGED");
        require(proxied.nextAllianceId() == expectedNextAllianceId, "NEXT_ALLIANCE_ID_CHANGED");
        require(
            proxied.warMinimumDurationActivatedAt() == expectedWarMinimumDurationActivatedAt,
            "WAR_MINIMUM_CHANGED"
        );

        emit AllianceDescriptionImplementationUpgraded(proxy, newImplementation);
    }
}
