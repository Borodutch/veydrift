// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VeydriftPaidAllianceInvites} from "../src/VeydriftPaidAllianceInvites.sol";

interface IVeydriftPricedGame {
    function owner() external view returns (address);
    function startPrice() external view returns (uint256);
    function setStartPrice(uint256 nextPrice) external;
}

/// @notice Sets the join price and the paid alliance invite price together: upgrades the paid-invite
///         proxy to an implementation whose `INVITE_PRICE` is `START_PRICE_WEI`, then sets the Game's
///         `startPrice` to it. Referrers keep half of the join price (the Game pays
///         `startPrice / 2` on referral redemptions).
///
///      Required env:
///        PRIVATE_KEY                 owner of the Game and the paid-invite proxy
///        UPGRADE_DRY_RUN_OWNER       optional PUBLIC owner for a signer-free plan; when set,
///                                    PRIVATE_KEY is never read
///        GAME_PROXY_ADDRESS          Veydrift Game proxy
///        PAID_INVITES_PROXY_ADDRESS  VeydriftPaidAllianceInvites proxy
///        START_PRICE_WEI             new join price; must equal the compiled INVITE_PRICE
contract SetEntryPrices is Script {
    function run() external returns (address newImplementation) {
        address rehearsalOwner = vm.envOr("UPGRADE_DRY_RUN_OWNER", address(0));
        uint256 privateKey;
        address broadcaster = rehearsalOwner;
        if (rehearsalOwner == address(0)) {
            privateKey = vm.envUint("PRIVATE_KEY");
            broadcaster = vm.addr(privateKey);
        }
        IVeydriftPricedGame game = IVeydriftPricedGame(vm.envAddress("GAME_PROXY_ADDRESS"));
        VeydriftPaidAllianceInvites invites =
            VeydriftPaidAllianceInvites(vm.envAddress("PAID_INVITES_PROXY_ADDRESS"));
        uint256 price = vm.envUint("START_PRICE_WEI");
        require(game.owner() == broadcaster, "BROADCASTER_NOT_GAME_OWNER");
        require(invites.owner() == broadcaster, "BROADCASTER_NOT_PAID_INVITES_OWNER");
        require(address(invites.alliance()) != address(0), "PAID_INVITES_NOT_INITIALIZED");
        require(invites.migrationFinalized(), "PAID_INVITES_MIGRATION_NOT_FINALIZED");
        address signer = invites.signer();

        if (rehearsalOwner != address(0)) vm.startBroadcast(rehearsalOwner);
        else vm.startBroadcast(privateKey);
        newImplementation = address(new VeydriftPaidAllianceInvites());
        require(
            VeydriftPaidAllianceInvites(newImplementation).INVITE_PRICE() == price,
            "INVITE_PRICE_NOT_START_PRICE"
        );
        invites.upgradeToAndCall(newImplementation, "");
        if (game.startPrice() != price) game.setStartPrice(price);
        vm.stopBroadcast();

        require(invites.INVITE_PRICE() == price, "INVITE_PRICE_NOT_APPLIED");
        require(
            invites.owner() == broadcaster && invites.signer() == signer, "PAID_INVITES_STATE_LOST"
        );
        require(game.startPrice() == price, "START_PRICE_NOT_APPLIED");
        console2.log("Paid invite implementation:", newImplementation);
        console2.log("Join + invite price (wei):", price);
    }
}
