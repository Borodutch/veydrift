// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VeydriftMigrationSettlement} from "../src/VeydriftMigrationSettlement.sol";

/// @notice Storage-compatible UUPS upgrade for the live migration settlement proxy.
/// The broadcasting account must be the proxy owner because `_authorizeUpgrade`
/// is owner-gated.
contract UpgradeMigrationSettlement is Script {
    bytes32 private constant IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    event MigrationSettlementUpgraded(address indexed proxy, address indexed implementation);

    function run() external returns (address newImplementation) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address payable proxy = payable(vm.envAddress("MIGRATION_PROXY_ADDRESS"));
        address game = vm.envAddress("GAME_PROXY_ADDRESS");
        address samplePlayer = vm.envAddress("MIGRATION_TEST_PLAYER");
        require(samplePlayer != address(0), "MIGRATION_TEST_PLAYER_REQUIRED");

        VeydriftMigrationSettlement proxied = VeydriftMigrationSettlement(proxy);
        address owner = proxied.owner();
        address signer = proxied.stateSigner();
        require(vm.addr(privateKey) == owner, "BROADCASTER_MUST_BE_PROXY_OWNER");
        require(
            address(proxied.game()) == game && signer != address(0), "MIGRATION_WIRING_MISMATCH"
        );
        (bool delegationOk, bytes memory delegationData) =
            game.staticcall(abi.encodeWithSignature("effectivePlayer(address)", owner));
        require(delegationOk && delegationData.length >= 32, "GAME_DELEGATION_NOT_UPGRADED");
        require(uint256(vm.load(proxy, IMPL_SLOT)) != 0, "MIGRATION_NOT_UUPS_PROXY");
        bytes32 reservationBefore = _reservationHash(proxy, samplePlayer);

        vm.startBroadcast(privateKey);
        VeydriftMigrationSettlement implementation = new VeydriftMigrationSettlement();
        newImplementation = address(implementation);
        proxied.upgradeToAndCall(newImplementation, "");
        vm.stopBroadcast();
        require(
            address(uint160(uint256(vm.load(proxy, IMPL_SLOT)))) == newImplementation,
            "MIGRATION_IMPL_NOT_SELECTED"
        );
        require(proxied.supportsDelegatedClaim(), "DELEGATE_CLAIM_NOT_AVAILABLE");
        require(
            proxied.owner() == owner && proxied.stateSigner() == signer
                && address(proxied.game()) == game,
            "MIGRATION_STATE_CHANGED"
        );
        require(_reservationHash(proxy, samplePlayer) == reservationBefore, "RESERVATION_CHANGED");

        console2.log("VeydriftMigrationSettlement proxy:", proxy);
        console2.log("New implementation:", newImplementation);
        emit MigrationSettlementUpgraded(proxy, newImplementation);
    }

    function _reservationHash(address proxy, address player) private view returns (bytes32) {
        (bool ok, bytes memory data) = proxy.staticcall(
            abi.encodeWithSelector(
                VeydriftMigrationSettlement.migrationReservation.selector, player
            )
        );
        require(ok && data.length == 7 * 32, "MIGRATION_RESERVATION_UNAVAILABLE");
        bytes32 existsWord;
        assembly ("memory-safe") {
            existsWord := mload(add(data, 32))
        }
        require(uint256(existsWord) == 1, "MIGRATION_TEST_PLAYER_NOT_RESERVED");
        return keccak256(data);
    }
}
