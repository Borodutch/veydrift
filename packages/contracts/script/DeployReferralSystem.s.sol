// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VeydriftReferralSystem} from "../src/VeydriftReferralSystem.sol";

/// @notice Deploys and wires the standalone referral system for an existing VeydriftGame proxy.
/// @dev VeydriftReferralSystem has immutable owner setup through its constructor and no ownership
///      transfer function. The broadcaster therefore remains the referral owner/admin.
///      Code claims stay disabled after deployment until the owner imports the audited legacy
///      ownership manifest. The owner must first commit its reviewed 6-valid / 10-hash-only
///      count/digest pairs through configureReferralCodeMigration(), separately commit the audited
///      replay/window manifest through configureReferralRedemptionMigration(), import both bounded
///      manifest classes, and call finalizeReferralCodeMigration(). Finalization fails closed until
///      both configurations match their imported count/digest pairs.
///
///      Required env:
///        PRIVATE_KEY              deployment/referral-owner EOA
///        GAME_PROXY_ADDRESS       live VeydriftGame proxy to authorize as referral caller
///        REFERRAL_SIGNER_ADDRESS  backend referral payload signer address
///
///      Dry run:
///        forge script script/DeployReferralSystem.s.sol:DeployReferralSystem --rpc-url <rpc>
///      Execute:
///        forge script script/DeployReferralSystem.s.sol:DeployReferralSystem --rpc-url <rpc> --broadcast
contract DeployReferralSystem is Script {
    event ReferralSystemDeployed(
        address indexed referralSystem, address indexed game, address indexed referralSigner
    );

    function run() external returns (address referralSystemAddress) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(privateKey);
        address game = vm.envAddress("GAME_PROXY_ADDRESS");
        address referralSigner = vm.envAddress("REFERRAL_SIGNER_ADDRESS");

        require(game.code.length > 0, "GAME_PROXY_ADDRESS_NOT_CONTRACT");
        require(referralSigner != address(0), "REFERRAL_SIGNER_REQUIRED");

        vm.startBroadcast(privateKey);
        VeydriftReferralSystem referralSystem = new VeydriftReferralSystem(broadcaster);
        referralSystem.setGame(game);
        referralSystem.setReferralSigner(referralSigner);
        vm.stopBroadcast();

        referralSystemAddress = address(referralSystem);
        console2.log("VeydriftReferralSystem:", referralSystemAddress);
        console2.log("Referral owner:       ", broadcaster);
        console2.log("Authorized game:      ", game);
        console2.log("Referral signer:      ", referralSigner);

        emit ReferralSystemDeployed(referralSystemAddress, game, referralSigner);
    }
}
