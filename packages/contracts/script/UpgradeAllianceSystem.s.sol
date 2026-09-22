// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftPaidAllianceInvites} from "../src/VeydriftPaidAllianceInvites.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";

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
            _requireFrozenSnapshot(proxied, migrated, previousPaidInviteSystem);
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
        if (migratedPaidInviteSystem != address(0)) {
            _requireFrozenSnapshot(
                proxied,
                VeydriftPaidAllianceInvites(migratedPaidInviteSystem),
                previousPaidInviteSystem
            );
        }

        emit AllianceSystemUpgraded(proxy, newImplementation, address(proxied.warProtection()));
    }

    function _requireFrozenSnapshot(
        VeydriftAllianceSystem alliances,
        VeydriftPaidAllianceInvites target,
        address sourceAddress
    ) private view {
        string memory manifest = vm.readFile(
            vm.envString("PAID_ALLIANCE_INVITE_MIGRATION_MANIFEST_FILE")
        );
        require(vm.parseJsonUint(manifest, ".chainId") == block.chainid, "CHAIN_ID_MISMATCH");
        require(
            vm.parseJsonAddress(manifest, ".sourcePaidInviteSystem") == sourceAddress,
            "SNAPSHOT_SOURCE_MISMATCH"
        );
        require(
            vm.parseJsonAddress(manifest, ".allianceProxy") == address(alliances),
            "SNAPSHOT_ALLIANCE_MISMATCH"
        );
        require(
            vm.parseJsonAddress(manifest, ".game") == address(alliances.game()),
            "SNAPSHOT_GAME_MISMATCH"
        );
        (bool pausedOk, bytes memory pausedData) =
            address(alliances.game()).staticcall(abi.encodeWithSignature("gamePaused()"));
        require(
            pausedOk && pausedData.length >= 32 && abi.decode(pausedData, (bool)), "GAME_NOT_PAUSED"
        );
        require(
            vm.parseJsonAddress(manifest, ".owner") == target.owner(), "SNAPSHOT_OWNER_MISMATCH"
        );
        require(
            vm.parseJsonAddress(manifest, ".signer") == target.signer(), "SNAPSHOT_SIGNER_MISMATCH"
        );
        require(
            address(alliances.game()).balance
                == vm.parseUint(vm.parseJsonString(manifest, ".gameBalance")),
            "GAME_TREASURY_CHANGED"
        );
        bytes32 stateHash = vm.parseJsonBytes32(manifest, ".stateHash");
        require(target.migrationHash() == stateHash, "SNAPSHOT_HASH_MISMATCH");
        (
            VeydriftPaidAllianceInvites.InviteMigration[] memory invites,
            VeydriftPaidAllianceInvites.IssuanceMigration[] memory issuances,
            VeydriftPaidAllianceInvites.BalanceMigration[] memory balances
        ) = abi.decode(
            vm.parseJsonBytes(manifest, ".migrationData"),
            (
                VeydriftPaidAllianceInvites.InviteMigration[],
                VeydriftPaidAllianceInvites.IssuanceMigration[],
                VeydriftPaidAllianceInvites.BalanceMigration[]
            )
        );
        require(
            keccak256(abi.encode(invites, issuances, balances)) == stateHash,
            "SNAPSHOT_DATA_MISMATCH"
        );
        VeydriftPaidAllianceInvites source = VeydriftPaidAllianceInvites(sourceAddress);
        require(
            sourceAddress.balance == 0 && source.owner() == target.owner(),
            "SOURCE_TREASURY_OR_OWNER_CHANGED"
        );
        for (uint256 i; i < invites.length; ++i) {
            VeydriftPaidAllianceInvites.PaidInvite memory actual =
                source.invite(invites[i].commitment);
            VeydriftPaidAllianceInvites.PaidInvite memory expected = invites[i].invite;
            require(
                actual.allianceId == expected.allianceId && actual.purchaser == expected.purchaser
                    && actual.settlementPrice == expected.settlementPrice
                    && actual.purchasedAt == expected.purchasedAt
                    && actual.redeemed == expected.redeemed,
                "SOURCE_INVITE_CHANGED"
            );
        }
        for (uint256 i; i < issuances.length; ++i) {
            VeydriftPaidAllianceInvites.IssuanceMigration memory expected = issuances[i];
            require(
                source.issuingAllianceOf(expected.invitee) == expected.allianceId,
                "SOURCE_ISSUANCE_CHANGED"
            );
            uint256 packed = uint256(
                vm.load(sourceAddress, keccak256(abi.encode(expected.invitee, uint256(6))))
            );
            require(
                packed & ((uint256(1) << 48) - 1)
                    == uint256(expected.remainder.metal) | uint256(expected.remainder.crystal) << 16
                        | uint256(expected.remainder.deuterium) << 32,
                "SOURCE_REMAINDER_CHANGED"
            );
        }
        for (uint256 i; i < balances.length; ++i) {
            VeydriftPaidAllianceInvites.BalanceMigration memory expected = balances[i];
            VeydriftGameStorage.Resources memory actual = source.bonusBalance(expected.allianceId);
            VeydriftGameStorage.Resources memory pending =
                source.pendingBonusBalance(expected.allianceId);
            require(
                actual.metal == expected.balance.metal && actual.crystal == expected.balance.crystal
                    && actual.deuterium == expected.balance.deuterium
                    && pending.metal == expected.pendingBalance.metal
                    && pending.crystal == expected.pendingBalance.crystal
                    && pending.deuterium == expected.pendingBalance.deuterium,
                "SOURCE_BALANCE_CHANGED"
            );
        }
    }
}
