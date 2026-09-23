// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {
    IVeydriftPaidInviteAlliance,
    VeydriftPaidAllianceInvites
} from "../src/VeydriftPaidAllianceInvites.sol";

/// @notice Deploys and exactly imports a frozen legacy paid-alliance-invite treasury into a UUPS
/// proxy. This script deliberately does not switch the Alliance pointer: upgrade the delegation-
/// aware Game first, then migrate the frozen treasury, then upgrade Alliance and switch its pointer.
///
/// Required env:
///   PRIVATE_KEY
///   ALLIANCE_PROXY_ADDRESS
///   PAID_ALLIANCE_INVITE_MIGRATION_MANIFEST_FILE
/// Optional env:
///   PAID_ALLIANCE_INVITE_TARGET_ADDRESS (resume an already deployed, unfinalized target)
contract MigratePaidAllianceInvites is Script {
    uint256 private constant LEGACY_REMAINDERS_SLOT = 6;
    uint256 private constant LEGACY_WITHDRAWING_SLOT = 7;

    function run() external returns (address targetAddress) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(privateKey);
        VeydriftAllianceSystem alliances =
            VeydriftAllianceSystem(payable(vm.envAddress("ALLIANCE_PROXY_ADDRESS")));
        string memory manifest =
            vm.readFile(vm.envString("PAID_ALLIANCE_INVITE_MIGRATION_MANIFEST_FILE"));
        require(vm.parseJsonUint(manifest, ".chainId") == block.chainid, "CHAIN_ID_MISMATCH");

        address sourceAddress = vm.parseJsonAddress(manifest, ".sourcePaidInviteSystem");
        address expectedOwner = vm.parseJsonAddress(manifest, ".owner");
        address expectedSigner = vm.parseJsonAddress(manifest, ".signer");
        address expectedAlliance = vm.parseJsonAddress(manifest, ".allianceProxy");
        address expectedGame = vm.parseJsonAddress(manifest, ".game");
        uint256 expectedGameBalance = vm.parseUint(vm.parseJsonString(manifest, ".gameBalance"));
        bytes32 expectedHash = vm.parseJsonBytes32(manifest, ".stateHash");
        bytes memory migrationData = vm.parseJsonBytes(manifest, ".migrationData");
        (
            VeydriftPaidAllianceInvites.InviteMigration[] memory invites,
            VeydriftPaidAllianceInvites.IssuanceMigration[] memory issuances,
            VeydriftPaidAllianceInvites.BalanceMigration[] memory balances
        ) = abi.decode(
            migrationData,
            (
                VeydriftPaidAllianceInvites.InviteMigration[],
                VeydriftPaidAllianceInvites.IssuanceMigration[],
                VeydriftPaidAllianceInvites.BalanceMigration[]
            )
        );
        require(
            keccak256(abi.encode(invites, issuances, balances)) == expectedHash,
            "MANIFEST_HASH_MISMATCH"
        );

        VeydriftPaidAllianceInvites source = VeydriftPaidAllianceInvites(sourceAddress);
        require(address(alliances) == expectedAlliance, "MANIFEST_ALLIANCE_MISMATCH");
        require(address(alliances.game()) == expectedGame, "MANIFEST_GAME_MISMATCH");
        require(alliances.owner() == broadcaster, "BROADCASTER_NOT_ALLIANCE_OWNER");
        require(alliances.paidInviteSystem() == sourceAddress, "SOURCE_NOT_ACTIVE");
        _requireGamePaused(address(alliances.game()));
        require(source.owner() == broadcaster, "BROADCASTER_NOT_SOURCE_OWNER");
        require(source.owner() == expectedOwner, "SOURCE_OWNER_CHANGED");
        require(
            source.signer() == expectedSigner && expectedSigner != address(0),
            "SOURCE_SIGNER_CHANGED"
        );
        require(sourceAddress.balance == 0, "SOURCE_ETH_NOT_MIGRATED");
        require(expectedGame.balance == expectedGameBalance, "GAME_TREASURY_CHANGED");
        require(
            uint256(vm.load(sourceAddress, bytes32(LEGACY_WITHDRAWING_SLOT))) == 0,
            "SOURCE_WITHDRAWING"
        );
        _verifySource(source, invites, issuances, balances);

        targetAddress = vm.envOr("PAID_ALLIANCE_INVITE_TARGET_ADDRESS", address(0));
        if (targetAddress == address(0)) {
            vm.startBroadcast(privateKey);
            VeydriftPaidAllianceInvites implementation = new VeydriftPaidAllianceInvites();
            targetAddress = address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(
                        VeydriftPaidAllianceInvites.initializeMigration,
                        (
                            IVeydriftPaidInviteAlliance(address(alliances)),
                            broadcaster,
                            source.signer(),
                            sourceAddress,
                            expectedHash
                        )
                    )
                )
            );
            vm.stopBroadcast();
        }

        VeydriftPaidAllianceInvites target = VeydriftPaidAllianceInvites(targetAddress);
        require(target.owner() == broadcaster, "BROADCASTER_NOT_TARGET_OWNER");
        require(address(target.alliance()) == address(alliances), "TARGET_ALLIANCE_MISMATCH");
        require(target.signer() == source.signer(), "TARGET_SIGNER_MISMATCH");
        require(target.migrationSource() == sourceAddress, "TARGET_SOURCE_MISMATCH");
        require(target.migrationHash() == expectedHash, "TARGET_HASH_MISMATCH");
        if (!target.migrationFinalized()) {
            vm.startBroadcast(privateKey);
            target.importMigration(invites, issuances, balances);
            vm.stopBroadcast();
        }
        require(target.migrationFinalized(), "TARGET_MIGRATION_PENDING");
        _verifyTarget(target, invites, issuances, balances);
        require(alliances.paidInviteSystem() == sourceAddress, "SOURCE_POINTER_CHANGED");
        _requireGamePaused(address(alliances.game()));
        require(expectedGame.balance == expectedGameBalance, "GAME_TREASURY_CHANGED");

        console2.log("Legacy paid invite system:", sourceAddress);
        console2.log("Migrated paid invite proxy:", targetAddress);
        console2.log("Migration state hash:");
        console2.logBytes32(expectedHash);
    }

    function _verifySource(
        VeydriftPaidAllianceInvites source,
        VeydriftPaidAllianceInvites.InviteMigration[] memory invites,
        VeydriftPaidAllianceInvites.IssuanceMigration[] memory issuances,
        VeydriftPaidAllianceInvites.BalanceMigration[] memory balances
    ) private view {
        for (uint256 i = 0; i < invites.length; ++i) {
            VeydriftPaidAllianceInvites.PaidInvite memory actual =
                source.invite(invites[i].commitment);
            _requireInviteEqual(actual, invites[i].invite);
        }
        for (uint256 i = 0; i < issuances.length; ++i) {
            VeydriftPaidAllianceInvites.IssuanceMigration memory expected = issuances[i];
            require(
                source.issuingAllianceOf(expected.invitee) == expected.allianceId,
                "SOURCE_ISSUANCE_MISMATCH"
            );
            bytes32 slot = keccak256(abi.encode(expected.invitee, LEGACY_REMAINDERS_SLOT));
            uint256 packed = uint256(vm.load(address(source), slot));
            // Each cast intentionally selects one packed uint16 field.
            // forge-lint: disable-next-line(unsafe-typecast)
            require(uint16(packed) == expected.remainder.metal, "SOURCE_METAL_REMAINDER");
            // forge-lint: disable-next-line(unsafe-typecast)
            require(uint16(packed >> 16) == expected.remainder.crystal, "SOURCE_CRYSTAL_REMAINDER");
            // The legacy remainder packs three uint16 fields into the same slot.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint16 deuterium = uint16(packed >> 32);
            require(deuterium == expected.remainder.deuterium, "SOURCE_DEUTERIUM_REMAINDER");
        }
        for (uint256 i = 0; i < balances.length; ++i) {
            _requireResourcesEqual(source.bonusBalance(balances[i].allianceId), balances[i].balance);
            _requireResourcesEqual(
                source.pendingBonusBalance(balances[i].allianceId), balances[i].pendingBalance
            );
        }
    }

    function _verifyTarget(
        VeydriftPaidAllianceInvites target,
        VeydriftPaidAllianceInvites.InviteMigration[] memory invites,
        VeydriftPaidAllianceInvites.IssuanceMigration[] memory issuances,
        VeydriftPaidAllianceInvites.BalanceMigration[] memory balances
    ) private view {
        for (uint256 i = 0; i < invites.length; ++i) {
            _requireInviteEqual(target.invite(invites[i].commitment), invites[i].invite);
        }
        for (uint256 i = 0; i < issuances.length; ++i) {
            VeydriftPaidAllianceInvites.IssuanceMigration memory expected = issuances[i];
            require(
                target.issuingAllianceOf(expected.invitee) == expected.allianceId,
                "TARGET_ISSUANCE_MISMATCH"
            );
            VeydriftPaidAllianceInvites.ProductionRemainder memory actual =
                target.productionRemainder(expected.invitee);
            require(actual.metal == expected.remainder.metal, "TARGET_METAL_REMAINDER");
            require(actual.crystal == expected.remainder.crystal, "TARGET_CRYSTAL_REMAINDER");
            require(actual.deuterium == expected.remainder.deuterium, "TARGET_DEUTERIUM_REMAINDER");
        }
        for (uint256 i = 0; i < balances.length; ++i) {
            _requireResourcesEqual(target.bonusBalance(balances[i].allianceId), balances[i].balance);
            _requireResourcesEqual(
                target.pendingBonusBalance(balances[i].allianceId), balances[i].pendingBalance
            );
        }
    }

    function _requireInviteEqual(
        VeydriftPaidAllianceInvites.PaidInvite memory actual,
        VeydriftPaidAllianceInvites.PaidInvite memory expected
    ) private pure {
        require(actual.allianceId == expected.allianceId, "INVITE_ALLIANCE_MISMATCH");
        require(actual.purchaser == expected.purchaser, "INVITE_PURCHASER_MISMATCH");
        require(actual.settlementPrice == expected.settlementPrice, "INVITE_PRICE_MISMATCH");
        require(actual.purchasedAt == expected.purchasedAt, "INVITE_TIME_MISMATCH");
        require(actual.redeemed == expected.redeemed, "INVITE_REDEEMED_MISMATCH");
    }

    function _requireResourcesEqual(
        VeydriftGameStorage.Resources memory actual,
        VeydriftGameStorage.Resources memory expected
    ) private pure {
        require(actual.metal == expected.metal, "RESOURCE_METAL_MISMATCH");
        require(actual.crystal == expected.crystal, "RESOURCE_CRYSTAL_MISMATCH");
        require(actual.deuterium == expected.deuterium, "RESOURCE_DEUTERIUM_MISMATCH");
    }

    function _requireGamePaused(address game) private view {
        (bool ok, bytes memory data) = game.staticcall(abi.encodeWithSignature("gamePaused()"));
        require(ok && data.length >= 32 && abi.decode(data, (bool)), "GAME_NOT_PAUSED");
    }
}
