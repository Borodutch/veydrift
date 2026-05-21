// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ResourceTokenDeployment} from "./ResourceTokenDeployment.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftCombatModule} from "../src/VeydriftCombatModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";

contract Deploy is ResourceTokenDeployment {
    event VeydriftDeployment(
        address indexed game,
        address indexed allianceSystem,
        address indexed moonSystem,
        address randomnessEngine,
        address metalToken,
        address crystalToken,
        address deuteriumToken
    );

    function run()
        external
        returns (
            address gameAddress,
            address allianceSystemAddress,
            address moonSystemAddress,
            address randomnessEngineAddress,
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
        VeydriftAllianceSystem allianceSystem =
            new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)));
        allianceSystemAddress = address(allianceSystem);
        RandomnessEngine randomnessEngine = new RandomnessEngine(admin, admin);
        randomnessEngineAddress = address(randomnessEngine);
        VeydriftMoonSystem moonSystem = new VeydriftMoonSystem(gameAddress, randomnessEngineAddress);
        moonSystemAddress = address(moonSystem);
        (metalToken, crystalToken, deuteriumToken) = _deployResourceTokens(admin, gameAddress);
        game.setResourceTokens(metalToken, crystalToken, deuteriumToken);
        game.setAllianceSystem(allianceSystemAddress);
        game.setMoonSystem(moonSystemAddress);
        randomnessEngine.setRequesterAuthorization(moonSystemAddress, true);
        emit VeydriftDeployment(
            gameAddress,
            allianceSystemAddress,
            moonSystemAddress,
            randomnessEngineAddress,
            metalToken,
            crystalToken,
            deuteriumToken
        );
        vm.stopBroadcast();
    }
}
