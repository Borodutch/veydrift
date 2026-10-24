// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";

interface IVeydriftPausableGame {
    function owner() external view returns (address);
    function gamePaused() external view returns (bool);
    function setGamePaused(bool paused) external;
}

/// @notice One owner transaction that pauses or unpauses the Game, so the pause around the referral
///         freeze can be planned and sent like every other step (keyless plan + hash-tracked send).
///
///      Required env:
///        PRIVATE_KEY            Game owner
///        UPGRADE_DRY_RUN_OWNER  optional PUBLIC Game owner for a signer-free plan; when set,
///                               PRIVATE_KEY is never read
///        GAME_PROXY_ADDRESS     Veydrift Game proxy
///        GAME_PAUSED            true to pause, false to unpause
contract SetGamePaused is Script {
    function run() external {
        address rehearsalOwner = vm.envOr("UPGRADE_DRY_RUN_OWNER", address(0));
        uint256 privateKey;
        address broadcaster = rehearsalOwner;
        if (rehearsalOwner == address(0)) {
            privateKey = vm.envUint("PRIVATE_KEY");
            broadcaster = vm.addr(privateKey);
        }
        IVeydriftPausableGame game = IVeydriftPausableGame(vm.envAddress("GAME_PROXY_ADDRESS"));
        bool paused = vm.envBool("GAME_PAUSED");
        require(game.owner() == broadcaster, "BROADCASTER_NOT_GAME_OWNER");
        require(game.gamePaused() != paused, "GAME_ALREADY_IN_REQUESTED_STATE");

        if (rehearsalOwner != address(0)) vm.startBroadcast(rehearsalOwner);
        else vm.startBroadcast(privateKey);
        game.setGamePaused(paused);
        vm.stopBroadcast();

        require(game.gamePaused() == paused, "GAME_PAUSE_NOT_APPLIED");
        console2.log("Game paused:", paused);
    }
}
