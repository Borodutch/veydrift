// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";

/// @notice Storage-compatible UUPS upgrade for the live `VeydriftAllianceSystem`
/// proxy. The new implementation adds alliance roster behavior without touching
/// the existing storage layout, so the proxy keeps every alliance, membership,
/// diplomacy, and defense-intent record. The broadcasting account must be the
/// proxy `owner()` because `_authorizeUpgrade` is owner-gated.
contract UpgradeAllianceSystem is Script {
    event AllianceSystemUpgraded(address indexed proxy, address indexed implementation);

    function run() external returns (address newImplementation) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address payable proxy = payable(vm.envAddress("ALLIANCE_PROXY_ADDRESS"));

        VeydriftAllianceSystem proxied = VeydriftAllianceSystem(proxy);
        IVeydriftAllianceGame game = proxied.game();
        require(address(game) != address(0), "ALLIANCE_GAME_NOT_CONFIGURED");
        require(vm.addr(privateKey) == proxied.owner(), "BROADCASTER_MUST_BE_PROXY_OWNER");

        vm.startBroadcast(privateKey);
        VeydriftAllianceSystem implementation = new VeydriftAllianceSystem(game);
        newImplementation = address(implementation);
        proxied.upgradeToAndCall(
            newImplementation,
            abi.encodeCall(VeydriftAllianceSystem.initializeWarMinimumDuration, ())
        );
        vm.stopBroadcast();

        emit AllianceSystemUpgraded(proxy, newImplementation);
    }
}
