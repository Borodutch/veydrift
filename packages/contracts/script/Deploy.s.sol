// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ResourceTokenDeployment} from "./ResourceTokenDeployment.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";

contract Deploy is ResourceTokenDeployment {
    event VeydriftDeployment(
        address indexed game,
        address indexed metalToken,
        address indexed crystalToken,
        address deuteriumToken
    );

    function run()
        external
        returns (
            address gameAddress,
            address metalToken,
            address crystalToken,
            address deuteriumToken
        )
    {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envOr("ADMIN_ADDRESS", vm.addr(privateKey));
        require(admin == vm.addr(privateKey), "ADMIN_MUST_MATCH_BROADCASTER");

        vm.startBroadcast(privateKey);
        VeydriftGame game = new VeydriftGame(admin);
        gameAddress = address(game);
        (metalToken, crystalToken, deuteriumToken) = _deployResourceTokens(admin, gameAddress);
        game.setResourceTokens(metalToken, crystalToken, deuteriumToken);
        emit VeydriftDeployment(gameAddress, metalToken, crystalToken, deuteriumToken);
        vm.stopBroadcast();
    }
}
