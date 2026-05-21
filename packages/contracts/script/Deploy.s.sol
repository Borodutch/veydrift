// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ResourceTokenDeployment} from "./ResourceTokenDeployment.sol";
import {VeydriftCombatModule} from "../src/VeydriftCombatModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";

contract Deploy is ResourceTokenDeployment {
    event VeydriftDeployment(
        address indexed game,
        address indexed moonSystem,
        address indexed metalToken,
        address crystalToken,
        address deuteriumToken
    );

    function run()
        external
        returns (
            address gameAddress,
            address moonSystemAddress,
            address metalToken,
            address crystalToken,
            address deuteriumToken
        )
    {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envOr("ADMIN_ADDRESS", vm.addr(privateKey));
        require(admin == vm.addr(privateKey), "ADMIN_MUST_MATCH_BROADCASTER");

        vm.startBroadcast(privateKey);
        VeydriftCombatModule combatModule = new VeydriftCombatModule();
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftGame game =
            new VeydriftGame(admin, address(gameplayModule), address(planetManagementModule));
        gameAddress = address(game);
        VeydriftMoonSystem moonSystem = new VeydriftMoonSystem(gameAddress);
        moonSystemAddress = address(moonSystem);
        (metalToken, crystalToken, deuteriumToken) = _deployResourceTokens(admin, gameAddress);
        game.setResourceTokens(metalToken, crystalToken, deuteriumToken);
        game.setMoonSystem(moonSystemAddress);
        emit VeydriftDeployment(
            gameAddress, moonSystemAddress, metalToken, crystalToken, deuteriumToken
        );
        vm.stopBroadcast();
    }
}
