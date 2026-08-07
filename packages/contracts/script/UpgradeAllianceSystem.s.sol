// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftAllianceWarProtection} from "../src/VeydriftAllianceWarProtection.sol";

/// @notice Storage-compatible corrective UUPS upgrade for the live
/// `VeydriftAllianceSystem` proxy. The proxy must already have activated the
/// minimum war duration; this upgrade preserves that timestamp and all existing
/// alliance state. After upgrading, use `MigrateAllianceWarMetadata.s.sol` only
/// for mirrored legacy pairs whose declarer cannot be inferred from raw storage.
/// The Game proxy must be upgraded first: the protection module calls its new
/// canonical `playerScore(address)` read. `UpgradeGame` deploys the fresh First
/// Planet module required by the size-constrained Game implementation as part of
/// that same atomic Game upgrade.
/// The broadcasting account must be the proxy `owner()` because `_authorizeUpgrade`
/// is owner-gated.
contract UpgradeAllianceSystem is Script {
    event AllianceSystemUpgraded(
        address indexed proxy, address indexed implementation, address indexed warProtection
    );

    function run() external returns (address newImplementation) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address payable proxy = payable(vm.envAddress("ALLIANCE_PROXY_ADDRESS"));

        VeydriftAllianceSystem proxied = VeydriftAllianceSystem(proxy);
        IVeydriftAllianceGame game = proxied.game();
        require(address(game) != address(0), "ALLIANCE_GAME_NOT_CONFIGURED");
        require(vm.addr(privateKey) == proxied.owner(), "BROADCASTER_MUST_BE_PROXY_OWNER");
        require(proxied.warMinimumDurationActivatedAt() != 0, "WAR_MINIMUM_DURATION_NOT_ACTIVATED");

        vm.startBroadcast(privateKey);
        VeydriftAllianceSystem implementation = new VeydriftAllianceSystem(game);
        newImplementation = address(implementation);
        // The live proxy already activated the war minimum-duration storage in
        // the prior upgrade. Corrective implementations must preserve that
        // timestamp and cannot call the version-2 reinitializer again.
        proxied.upgradeToAndCall(newImplementation, "");
        VeydriftAllianceWarProtection protection =
            new VeydriftAllianceWarProtection(address(proxied), address(game));
        proxied.setWarProtection(address(protection));
        vm.stopBroadcast();

        emit AllianceSystemUpgraded(proxy, newImplementation, address(protection));
    }
}
