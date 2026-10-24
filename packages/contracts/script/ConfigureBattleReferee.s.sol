// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftRefereeBattle as Referee} from "../src/libraries/VeydriftRefereeBattle.sol";

interface IBattleRefereeConfig {
    function configureBattleReferee(Referee.Version calldata version, address resolver) external;
    function refereeBattleRecord(uint256 id, uint8 kind, uint256 index)
        external
        view
        returns (bytes memory);
}

/// @notice Ticket #44 activation: new Attack launches use the trusted battle referee. Rules and
/// catalog hashes pin packages/battle-oracle (rules id and referee-catalog.json) at this commit.
/// BATTLE_REFEREE_VERSION=0 disables new referee launches; launched battles keep their rules and
/// the unchanged resolver finishes them.
contract ConfigureBattleReferee is Script {
    function run() external {
        // Public identity only for a keyless dry run. UPGRADE_DRY_RUN_OWNER must be the game owner.
        // Never pass --broadcast for rehearsal.
        address rehearsalOwner = vm.envOr("UPGRADE_DRY_RUN_OWNER", address(0));
        uint256 privateKey;
        address broadcaster = rehearsalOwner;
        if (rehearsalOwner == address(0)) {
            privateKey = vm.envUint("PRIVATE_KEY");
            broadcaster = vm.addr(privateKey);
        }
        address proxy = vm.envAddress("GAME_PROXY_ADDRESS");
        uint32 version = uint32(vm.envOr("BATTLE_REFEREE_VERSION", uint256(1)));
        (, address current) = abi.decode(
            IBattleRefereeConfig(proxy).refereeBattleRecord(0, 4, 0), (Referee.Version, address)
        );
        // Rollback (version 0) keeps the resolver so already launched referee battles still finish.
        address resolver = vm.envOr("BATTLE_REFEREE_ADDRESS", current);
        require(resolver != address(0), "BATTLE_REFEREE_ADDRESS_REQUIRED");
        require(VeydriftGame(payable(proxy)).owner() == broadcaster, "BROADCASTER_NOT_GAME_OWNER");
        Referee.Version memory config = version == 0
            ? Referee.Version(0, 0, 0)
            : Referee.Version(
                version,
                keccak256("veydrift-classic-combat-1"),
                keccak256(bytes(vm.readFile("../battle-oracle/referee-catalog.json")))
            );

        if (rehearsalOwner != address(0)) vm.startBroadcast(rehearsalOwner);
        else vm.startBroadcast(privateKey);
        IBattleRefereeConfig(proxy).configureBattleReferee(config, resolver);
        vm.stopBroadcast();

        (Referee.Version memory live, address liveResolver) = abi.decode(
            IBattleRefereeConfig(proxy).refereeBattleRecord(0, 4, 0), (Referee.Version, address)
        );
        require(live.version == version && liveResolver == resolver, "REFEREE_CONFIG_NOT_APPLIED");
        require(
            VeydriftGame(payable(proxy)).combatModelVersion() == (version == 0 ? 2 : 3), "MODEL"
        );
        console2.log("Referee version:", live.version);
        console2.log("Resolver:", liveResolver);
        console2.logBytes32(live.rules);
        console2.logBytes32(live.catalog);
    }
}
