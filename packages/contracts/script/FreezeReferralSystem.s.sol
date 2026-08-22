// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VeydriftReferralSystem} from "../src/VeydriftReferralSystem.sol";

/// @notice Freezes the source referral system after the Game proxy has been paused.
/// @dev The final migration manifest must be regenerated only after this succeeds. Setting game to
/// zero blocks both direct code claims/top-ups and Game-authorized redemptions at the source.
///
/// Required env:
///   PRIVATE_KEY                   source referral owner
///   GAME_PROXY_ADDRESS            paused Veydrift Game proxy
///   SOURCE_REFERRAL_SYSTEM_ADDRESS current referral contract
contract FreezeReferralSystem is Script {
    bytes32 private constant GAME_PAUSED_SLOT = bytes32(uint256(52));

    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(privateKey);
        address gameProxy = vm.envAddress("GAME_PROXY_ADDRESS");
        VeydriftReferralSystem source =
            VeydriftReferralSystem(vm.envAddress("SOURCE_REFERRAL_SYSTEM_ADDRESS"));

        require(uint256(vm.load(gameProxy, GAME_PAUSED_SLOT)) != 0, "GAME_MUST_BE_PAUSED");
        require(source.owner() == broadcaster, "BROADCASTER_NOT_REFERRAL_OWNER");
        require(source.game() == gameProxy, "SOURCE_GAME_MISMATCH");

        vm.startBroadcast(privateKey);
        source.setGame(address(0));
        vm.stopBroadcast();

        require(source.game() == address(0), "SOURCE_FREEZE_FAILED");
        console2.log("Frozen referral source:", address(source));
    }
}
