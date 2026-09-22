// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftPaidAllianceInvites} from "../src/VeydriftPaidAllianceInvites.sol";

/// @notice Storage-compatible corrective UUPS upgrade for the live
/// `VeydriftAllianceSystem` proxy. The proxy must already have activated the
/// minimum war duration; this upgrade preserves that timestamp and all existing
/// alliance state, including its configured war-protection module. Replacing that
/// separate module while active wars exist requires a roster-seeding migration and
/// must be staged explicitly with `ReplaceWarProtection`.
/// The broadcasting account must be the proxy `owner()` because `_authorizeUpgrade`
/// is owner-gated.
contract UpgradeAllianceSystem is Script {
    event AllianceSystemUpgraded(
        address indexed proxy, address indexed implementation, address indexed warProtection
    );

    function run() external returns (address newImplementation) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(privateKey);
        address payable proxy = payable(vm.envAddress("ALLIANCE_PROXY_ADDRESS"));

        VeydriftAllianceSystem proxied = VeydriftAllianceSystem(proxy);
        IVeydriftAllianceGame game = proxied.game();
        require(address(game) != address(0), "ALLIANCE_GAME_NOT_CONFIGURED");
        (bool delegationOk, bytes memory delegationData) = address(game)
            .staticcall(abi.encodeWithSignature("effectivePlayer(address)", broadcaster));
        require(delegationOk && delegationData.length >= 32, "GAME_DELEGATION_NOT_UPGRADED");
        require(broadcaster == proxied.owner(), "BROADCASTER_MUST_BE_PROXY_OWNER");
        require(proxied.warMinimumDurationActivatedAt() != 0, "WAR_MINIMUM_DURATION_NOT_ACTIVATED");
        address previousPaidInviteSystem = proxied.paidInviteSystem();
        address migratedPaidInviteSystem =
            vm.envOr("MIGRATED_PAID_ALLIANCE_INVITE_ADDRESS", address(0));
        require(
            previousPaidInviteSystem == address(0) || migratedPaidInviteSystem != address(0),
            "PAID_INVITE_MIGRATION_REQUIRED"
        );
        if (migratedPaidInviteSystem != address(0)) {
            require(previousPaidInviteSystem != address(0), "SOURCE_PAID_INVITE_MISSING");
            VeydriftPaidAllianceInvites migrated =
                VeydriftPaidAllianceInvites(migratedPaidInviteSystem);
            require(migrated.migrationFinalized(), "PAID_INVITE_MIGRATION_PENDING");
            require(
                migrated.migrationSource() == previousPaidInviteSystem,
                "PAID_INVITE_SOURCE_MISMATCH"
            );
            require(address(migrated.alliance()) == proxy, "PAID_INVITE_ALLIANCE_MISMATCH");
            require(migrated.owner() == broadcaster, "PAID_INVITE_OWNER_MISMATCH");
            require(
                migrated.signer() == VeydriftPaidAllianceInvites(previousPaidInviteSystem).signer(),
                "PAID_INVITE_SIGNER_MISMATCH"
            );
            (bool pausedOk, bytes memory pausedData) =
                address(game).staticcall(abi.encodeWithSignature("gamePaused()"));
            require(
                pausedOk && pausedData.length >= 32 && abi.decode(pausedData, (bool)),
                "GAME_NOT_PAUSED"
            );
        }

        vm.startBroadcast(privateKey);
        VeydriftAllianceSystem implementation = new VeydriftAllianceSystem(game);
        newImplementation = address(implementation);
        // The live proxy already activated the war minimum-duration storage in
        // the prior upgrade. Corrective implementations must preserve that
        // timestamp and cannot call the version-2 reinitializer again.
        proxied.upgradeToAndCall(newImplementation, "");
        if (migratedPaidInviteSystem != address(0)) {
            proxied.setPaidInviteSystem(migratedPaidInviteSystem);
        }
        vm.stopBroadcast();

        require(
            proxied.paidInviteSystem()
                == (migratedPaidInviteSystem == address(0)
                        ? previousPaidInviteSystem
                        : migratedPaidInviteSystem),
            "PAID_INVITE_POINTER_MISMATCH"
        );

        emit AllianceSystemUpgraded(proxy, newImplementation, address(proxied.warProtection()));
    }
}
