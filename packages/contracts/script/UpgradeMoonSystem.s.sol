// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {
    IVeydriftMoonGame,
    IVeydriftRandomnessEngine,
    VeydriftMoonSystem
} from "../src/VeydriftMoonSystem.sol";
import {VeydriftLiveUpgradePolicy} from "../src/libraries/VeydriftLiveUpgradePolicy.sol";

/// @notice Storage-compatible UUPS upgrade for the live `VeydriftMoonSystem`
/// proxy. The broadcasting account must be the proxy owner because
/// `_authorizeUpgrade` is owner-gated.
contract UpgradeMoonSystem is Script {
    event MoonSystemUpgraded(address indexed proxy, address indexed implementation);

    function run() external returns (address newImplementation) {
        // Public identity only for a keyless dry run; all existing guards/payloads are shared.
        // UPGRADE_DRY_RUN_OWNER must be the Moon owner. Never pass --broadcast for rehearsal.
        address rehearsalOwner = vm.envOr("UPGRADE_DRY_RUN_OWNER", address(0));
        uint256 privateKey;
        address broadcaster = rehearsalOwner;
        if (rehearsalOwner == address(0)) {
            privateKey = vm.envUint("PRIVATE_KEY");
            broadcaster = vm.addr(privateKey);
        }
        address payable proxy = payable(vm.envAddress("MOON_PROXY_ADDRESS"));

        VeydriftMoonSystem proxied = VeydriftMoonSystem(proxy);
        IVeydriftMoonGame game = proxied.game();
        IVeydriftRandomnessEngine randomness = proxied.randomness();
        require(address(game) != address(0), "MOON_GAME_NOT_CONFIGURED");
        require(address(randomness) != address(0), "MOON_RANDOMNESS_NOT_CONFIGURED");
        require(broadcaster == proxied.owner(), "BROADCASTER_MUST_BE_PROXY_OWNER");
        (bool delegationOk, bytes memory delegationData) = address(game)
            .staticcall(abi.encodeWithSignature("effectivePlayer(address)", broadcaster));
        require(delegationOk && delegationData.length >= 32, "GAME_DELEGATION_NOT_UPGRADED");
        VeydriftLiveUpgradePolicy.requireMoonUpgradeReady(address(game));

        if (rehearsalOwner != address(0)) vm.startBroadcast(rehearsalOwner);
        else vm.startBroadcast(privateKey);
        VeydriftMoonSystem implementation =
            new VeydriftMoonSystem(address(game), address(randomness));
        newImplementation = address(implementation);
        proxied.upgradeToAndCall(newImplementation, "");
        vm.stopBroadcast();

        console2.log("VeydriftMoonSystem proxy:", proxy);
        console2.log("New implementation:", newImplementation);
        console2.log("Game:", address(game));
        console2.log("Randomness:", address(randomness));
        emit MoonSystemUpgraded(proxy, newImplementation);
    }
}
