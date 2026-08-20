// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ResourceTokenDeployment} from "./ResourceTokenDeployment.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {
    TransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftAcsAttackModule} from "../src/VeydriftAcsAttackModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftShipProductionModule} from "../src/VeydriftShipProductionModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftFirstPlanetSettlementModule} from "../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftMigrationSettlement} from "../src/VeydriftMigrationSettlement.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftReferralSystem} from "../src/VeydriftReferralSystem.sol";
import {
    IVeydriftPaidInviteAlliance,
    VeydriftPaidAllianceInvites
} from "../src/VeydriftPaidAllianceInvites.sol";
import {VeydriftSettlement} from "../src/VeydriftSettlement.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";

contract Deploy is ResourceTokenDeployment {
    string internal constant ALPHA_REDEPLOY_ACK =
        "I have verified Veydrift alpha state migration requirements";

    event VeydriftDeployment(
        address indexed game,
        address indexed settlement,
        address indexed allianceSystem,
        address moonSystem,
        address migrationSettlement,
        address randomnessEngine,
        address metalToken,
        address crystalToken,
        address deuteriumToken
    );
    event VeydriftAuxiliaryProxyDeployed(
        string system, address indexed proxy, address indexed implementation
    );

    function run()
        external
        returns (
            address gameAddress,
            address settlementAddress,
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
        address gameProxyAdmin = vm.envOr("GAME_PROXY_ADMIN_ADDRESS", admin);
        address gameOwner = vm.envOr("GAME_OWNER_ADDRESS", gameProxyAdmin);
        address settlementAdmin = vm.envOr("SETTLEMENT_UPGRADE_ADMIN_ADDRESS", admin);
        address allianceAdmin = vm.envOr("ALLIANCE_UPGRADE_ADMIN_ADDRESS", admin);
        address paidAllianceInviteSigner = vm.envAddress("PAID_ALLIANCE_INVITE_SIGNER_ADDRESS");
        address moonAdmin = vm.envOr("MOON_UPGRADE_ADMIN_ADDRESS", admin);
        address migrationAdmin = vm.envOr("MIGRATION_UPGRADE_ADMIN_ADDRESS", admin);
        address randomnessAdmin = vm.envOr("RANDOMNESS_UPGRADE_ADMIN_ADDRESS", admin);
        address randomnessFulfiller = vm.envOr("RANDOMNESS_FULFILLER_ADDRESS", admin);
        address metalAdmin = vm.envOr("METAL_TOKEN_UPGRADE_ADMIN_ADDRESS", admin);
        address crystalAdmin = vm.envOr("CRYSTAL_TOKEN_UPGRADE_ADMIN_ADDRESS", admin);
        address deuteriumAdmin = vm.envOr("DEUTERIUM_TOKEN_UPGRADE_ADMIN_ADDRESS", admin);
        bytes32 universeSalt =
            vm.envOr("VEYDRIFT_UNIVERSE_SALT", keccak256("veydrift.base-mainnet.v1"));

        vm.startBroadcast(privateKey);
        VeydriftCombatRapidfire rapidfire = new VeydriftCombatRapidfire();
        VeydriftCombatModule combatModule = new VeydriftCombatModule(address(rapidfire));
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftAttackProtectionModule attackProtectionModule = new VeydriftAttackProtectionModule();
        VeydriftAcsAttackModule acsAttackModule = new VeydriftAcsAttackModule();
        VeydriftColonizationModule colonizationModule =
            new VeydriftColonizationModule(address(new VeydriftShipProductionModule()));
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();
        VeydriftReferralSystem referralSystem = new VeydriftReferralSystem(admin);
        VeydriftStateMigrationModule stateMigrationModule =
            new VeydriftStateMigrationModule(address(referralSystem));
        VeydriftFirstPlanetSettlementModule firstPlanetSettlementModule =
            new VeydriftFirstPlanetSettlementModule(address(referralSystem));
        VeydriftGame game = new VeydriftGame(
            admin,
            address(firstPlanetSettlementModule),
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule),
            address(defenseHoldModule),
            address(stateMigrationModule),
            address(acsAttackModule)
        );
        gameAddress = address(
            new TransparentUpgradeableProxy(
                address(game), gameProxyAdmin, abi.encodeCall(VeydriftGame.initialize, (admin))
            )
        );
        game = VeydriftGame(payable(gameAddress));

        VeydriftSettlement settlementImplementation = new VeydriftSettlement(universeSalt);
        settlementAddress = address(
            new ERC1967Proxy(
                address(settlementImplementation),
                abi.encodeCall(VeydriftSettlement.initialize, (settlementAdmin, universeSalt))
            )
        );

        referralSystem.setGame(gameAddress);
        emit VeydriftAuxiliaryProxyDeployed(
            "referral", address(referralSystem), address(referralSystem)
        );
        VeydriftAllianceSystem allianceImplementation =
            new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)));
        allianceSystemAddress = address(
            new ERC1967Proxy(
                address(allianceImplementation),
                abi.encodeCall(
                    VeydriftAllianceSystem.initialize, (IVeydriftAllianceGame(address(game)), admin)
                )
            )
        );
        emit VeydriftAuxiliaryProxyDeployed(
            "alliance", allianceSystemAddress, address(allianceImplementation)
        );
        VeydriftPaidAllianceInvites paidAllianceInvites = new VeydriftPaidAllianceInvites(
            IVeydriftPaidInviteAlliance(allianceSystemAddress),
            allianceAdmin,
            paidAllianceInviteSigner
        );
        VeydriftAllianceSystem(allianceSystemAddress)
            .setPaidInviteSystem(address(paidAllianceInvites));
        emit VeydriftAuxiliaryProxyDeployed(
            "paid-alliance-invites", address(paidAllianceInvites), address(paidAllianceInvites)
        );

        RandomnessEngine randomnessImplementation = new RandomnessEngine(admin, randomnessFulfiller);
        randomnessEngineAddress = address(
            new ERC1967Proxy(
                address(randomnessImplementation),
                abi.encodeCall(RandomnessEngine.initialize, (admin, randomnessFulfiller))
            )
        );
        emit VeydriftAuxiliaryProxyDeployed(
            "randomness", randomnessEngineAddress, address(randomnessImplementation)
        );

        VeydriftMoonSystem moonImplementation =
            new VeydriftMoonSystem(gameAddress, randomnessEngineAddress);
        moonSystemAddress = address(
            new ERC1967Proxy(
                address(moonImplementation),
                abi.encodeCall(
                    VeydriftMoonSystem.initialize, (gameAddress, randomnessEngineAddress, admin)
                )
            )
        );
        emit VeydriftAuxiliaryProxyDeployed("moon", moonSystemAddress, address(moonImplementation));
        VeydriftMigrationSettlement migrationImplementation = new VeydriftMigrationSettlement();
        address migrationSettlementAddress = address(
            new ERC1967Proxy(
                address(migrationImplementation),
                abi.encodeCall(
                    VeydriftMigrationSettlement.initialize, (migrationAdmin, gameAddress)
                )
            )
        );
        emit VeydriftAuxiliaryProxyDeployed(
            "migration", migrationSettlementAddress, address(migrationImplementation)
        );
        (metalToken, crystalToken, deuteriumToken) =
            _deployResourceTokens(gameAddress, metalAdmin, crystalAdmin, deuteriumAdmin);
        game.setResourceTokens(metalToken, crystalToken, deuteriumToken);
        game.setAllianceSystem(allianceSystemAddress);
        game.setMoonSystem(moonSystemAddress);
        game.setMigrationSettlement(migrationSettlementAddress);
        game.setRandomnessEngine(randomnessEngineAddress);
        RandomnessEngine(randomnessEngineAddress).setRequesterAuthorization(gameAddress, true);
        RandomnessEngine(randomnessEngineAddress).setRequesterAuthorization(moonSystemAddress, true);
        VeydriftAllianceSystem(allianceSystemAddress).transferOwnership(allianceAdmin);
        VeydriftMoonSystem(moonSystemAddress).transferOwnership(moonAdmin);
        RandomnessEngine(randomnessEngineAddress).transferOwnership(randomnessAdmin);
        if (gameOwner != admin) {
            game.transferOwnership(gameOwner);
        }
        emit VeydriftDeployment(
            gameAddress,
            settlementAddress,
            allianceSystemAddress,
            moonSystemAddress,
            migrationSettlementAddress,
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
