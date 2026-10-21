// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftReferralSystem} from "../src/VeydriftReferralSystem.sol";

/// @notice Deploys the upgradeable referral system (implementation + ERC1967 proxy) with claims and
///         redemptions disabled until cutover.
/// @dev The broadcaster becomes the proxy owner: it alone authorizes upgrades, can transfer
///      ownership, sets the signer here and later wires `setGame`. Code claims stay disabled until
///      the owner commits and imports the audited manifest with MigrateReferralSystem.s.sol, which
///      finalizes only when every committed count/digest pair matches its import.
///
///      Required env:
///        PRIVATE_KEY              referral owner EOA (the broadcaster)
///        UPGRADE_DRY_RUN_OWNER    optional PUBLIC owner address for a signer-free rehearsal; when
///                                 set, PRIVATE_KEY is never read. Do not use --broadcast.
///        REFERRAL_SIGNER_ADDRESS  backend referral payload signer address
///
///      Dry run:
///        forge script script/DeployReferralSystem.s.sol:DeployReferralSystem --rpc-url <rpc>
///      Execute:
///        forge script script/DeployReferralSystem.s.sol:DeployReferralSystem --rpc-url <rpc> --broadcast
contract DeployReferralSystem is Script {
    event ReferralSystemDeployed(address indexed referralSystem, address indexed referralSigner);

    function run() external returns (address referralSystemAddress) {
        address rehearsalOwner = vm.envOr("UPGRADE_DRY_RUN_OWNER", address(0));
        uint256 privateKey;
        address broadcaster = rehearsalOwner;
        if (rehearsalOwner == address(0)) {
            privateKey = vm.envUint("PRIVATE_KEY");
            broadcaster = vm.addr(privateKey);
        }
        address referralSigner = vm.envAddress("REFERRAL_SIGNER_ADDRESS");
        require(referralSigner != address(0), "REFERRAL_SIGNER_REQUIRED");

        if (rehearsalOwner != address(0)) vm.startBroadcast(rehearsalOwner);
        else vm.startBroadcast(privateKey);
        address implementation = address(new VeydriftReferralSystem());
        VeydriftReferralSystem referralSystem = VeydriftReferralSystem(
            address(
                new ERC1967Proxy(
                    implementation, abi.encodeCall(VeydriftReferralSystem.initialize, (broadcaster))
                )
            )
        );
        referralSystem.setReferralSigner(referralSigner);
        vm.stopBroadcast();

        require(referralSystem.owner() == broadcaster, "REFERRAL_OWNER_MISMATCH");
        require(referralSystem.referralSigner() == referralSigner, "REFERRAL_SIGNER_MISMATCH");
        require(referralSystem.game() == address(0), "REFERRAL_GAME_SET");
        require(!referralSystem.referralMigrationFinalized(), "REFERRAL_ALREADY_FINALIZED");

        referralSystemAddress = address(referralSystem);
        console2.log("VeydriftReferralSystem proxy:", referralSystemAddress);
        console2.log("Implementation:              ", implementation);
        console2.log("Referral owner:              ", broadcaster);
        console2.log("Referral signer:             ", referralSigner);

        emit ReferralSystemDeployed(referralSystemAddress, referralSigner);
    }
}
