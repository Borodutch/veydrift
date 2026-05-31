// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ResourceTokenDeployment} from "./ResourceTokenDeployment.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";

contract Deploy is ResourceTokenDeployment {
    string internal constant ALPHA_REDEPLOY_ACK =
        "I have verified Veydrift alpha state migration requirements";

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
        _requireAlphaRedeployAcknowledgement();
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envOr("ADMIN_ADDRESS", vm.addr(privateKey));
        require(admin == vm.addr(privateKey), "ADMIN_MUST_MATCH_BROADCASTER");

        vm.startBroadcast(privateKey);
        VeydriftCombatRapidfire rapidfire = new VeydriftCombatRapidfire();
        VeydriftCombatModule combatModule = new VeydriftCombatModule(address(rapidfire));
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftAttackProtectionModule attackProtectionModule = new VeydriftAttackProtectionModule();
        VeydriftColonizationModule colonizationModule = new VeydriftColonizationModule();
        VeydriftGame game = new VeydriftGame(
            admin,
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule)
        );
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
        game.setRandomnessEngine(randomnessEngineAddress);
        randomnessEngine.setRequesterAuthorization(gameAddress, true);
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

    function _requireAlphaRedeployAcknowledgement() private view {
        string memory acknowledgement = vm.envString("VEYDRIFT_ALPHA_REDEPLOY_ACK");
        require(
            keccak256(bytes(acknowledgement)) == keccak256(bytes(ALPHA_REDEPLOY_ACK)),
            "OPEN_ALPHA_STATE_PRESERVATION_ACK_REQUIRED"
        );
    }
}
