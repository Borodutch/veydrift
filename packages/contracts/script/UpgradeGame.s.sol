// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftAcsAttackModule} from "../src/VeydriftAcsAttackModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftShipProductionModule} from "../src/VeydriftShipProductionModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftFirstPlanetSettlementModule} from "../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftReferralSystem} from "../src/VeydriftReferralSystem.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {VeydriftLiveUpgradePolicy} from "../src/libraries/VeydriftLiveUpgradePolicy.sol";

/// @title UpgradeGame
/// @notice Upgrades the live VeydriftGame Transparent ERC1967 proxy in place to a freshly
///         deployed implementation + module set, preserving all proxy storage (planets, fleets,
///         resources, moon/alliance/randomness/resource-token wiring set via on-chain setters).
/// @dev VeydriftGame holds its module addresses as `immutable` (baked into bytecode), so a new
///      implementation carries a new module set. The proxy keeps its storage across the upgrade
///      because the implementation only runs logic via delegatecall. The `admin` constructor arg
///      of the new implementation only writes the implementation contract's own (unused) storage,
///      never the proxy's owner — the proxy's existing owner is preserved.
///
///      This mirrors the proven Base mainnet upgrade flow: deploy fresh modules + game impl, then
///      ProxyAdmin.upgradeAndCall(proxy, newImpl, empty calldata) from the ProxyAdmin owner EOA.
///      First-time cutovers and state migrations are deliberately outside this script: they must
///      already be complete or be implemented as separate resumable live migrations.
///
///      Required env:
///        PRIVATE_KEY        deployer EOA; MUST be the ProxyAdmin owner (asserted below)
///        GAME_PROXY_ADDRESS the live Base VeydriftGame proxy
///        GAME_PROXY_ADMIN   its OZ ProxyAdmin contract
///        MOON_PROXY_ADDRESS the already-upgraded MoonSystem proxy
///      Optional env:
///        ADMIN_ADDRESS      module-admin arg for the new impl (defaults to broadcaster; only
///                           affects the impl's own storage, never the proxy)
///
///      Gameplay remains live for the entire upgrade. Any future state migration must therefore be
///      designed as a backward-compatible, resumable live migration; this script must never pause
///      the Game or add a pause precondition.
///
///      Dry run (no broadcast):
///        forge script script/UpgradeGame.s.sol:UpgradeGame --rpc-url <base_mainnet>
///      Execute:
///        forge script script/UpgradeGame.s.sol:UpgradeGame --rpc-url <base_mainnet> --broadcast
contract UpgradeGame is Script {
    function run() external returns (address newImplementation) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(privateKey);
        address proxy = vm.envAddress("GAME_PROXY_ADDRESS");
        address proxyAdmin = vm.envAddress("GAME_PROXY_ADMIN");
        address moonProxy = vm.envAddress("MOON_PROXY_ADDRESS");
        address moduleAdmin = vm.envOr("ADMIN_ADDRESS", broadcaster);
        address referralSystemAddress = vm.envAddress("VEYDRIFT_REFERRAL_SYSTEM_ADDRESS");
        VeydriftReferralSystem referralSystem = VeydriftReferralSystem(referralSystemAddress);

        // The upgrade call is onlyOwner on the ProxyAdmin. Fail fast (before any deploy) if the
        // signer cannot actually execute the upgrade, so we never strand orphaned module deploys.
        require(ProxyAdmin(proxyAdmin).owner() == broadcaster, "BROADCASTER_NOT_PROXY_ADMIN_OWNER");
        require(VeydriftGame(payable(proxy)).owner() == broadcaster, "BROADCASTER_NOT_GAME_OWNER");
        VeydriftLiveUpgradePolicy.requireGameUpgradeReady(proxy);
        (bool generationOk, bytes memory generationData) =
            moonProxy.staticcall(abi.encodeWithSignature("moonGeneration(uint256)", 0));
        require(generationOk && generationData.length >= 32, "MOON_PARITY_NOT_UPGRADED");
        (bool gameOk, bytes memory gameData) =
            moonProxy.staticcall(abi.encodeWithSignature("game()"));
        require(
            gameOk && gameData.length >= 32 && abi.decode(gameData, (address)) == proxy,
            "MOON_GAME_MISMATCH"
        );
        require(referralSystemAddress.code.length > 0, "REFERRAL_SYSTEM_NOT_CONTRACT");
        require(referralSystem.owner() == broadcaster, "BROADCASTER_NOT_REFERRAL_OWNER");
        require(referralSystem.referralMigrationFinalized(), "REFERRAL_MIGRATION_PENDING");
        require(referralSystem.referralSigner() != address(0), "REFERRAL_SIGNER_REQUIRED");
        address configuredReferralGame = referralSystem.game();
        require(
            configuredReferralGame == address(0) || configuredReferralGame == proxy,
            "REFERRAL_GAME_MISMATCH"
        );

        vm.startBroadcast(privateKey);

        if (configuredReferralGame == address(0)) referralSystem.setGame(proxy);

        VeydriftCombatRapidfire rapidfire = new VeydriftCombatRapidfire();
        VeydriftCombatModule combatModule = new VeydriftCombatModule(address(rapidfire));
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftAttackProtectionModule attackProtectionModule = new VeydriftAttackProtectionModule();
        VeydriftAcsAttackModule acsAttackModule = new VeydriftAcsAttackModule();
        VeydriftColonizationModule colonizationModule =
            new VeydriftColonizationModule(address(new VeydriftShipProductionModule()));
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();
        VeydriftStateMigrationModule stateMigrationModule =
            new VeydriftStateMigrationModule(referralSystemAddress);
        VeydriftFirstPlanetSettlementModule firstPlanetSettlementModule = new VeydriftFirstPlanetSettlementModule(
            referralSystemAddress, address(colonizationModule)
        );

        VeydriftGame newImpl = new VeydriftGame(
            moduleAdmin,
            address(firstPlanetSettlementModule),
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule),
            address(defenseHoldModule),
            address(stateMigrationModule),
            address(acsAttackModule)
        );
        newImplementation = address(newImpl);

        // The new module set is inert until this single ProxyAdmin transaction switches the
        // implementation. The implementation must be compatible with every in-flight action, so
        // gameplay remains available before, during, and after the upgrade.
        ProxyAdmin(proxyAdmin)
            .upgradeAndCall(ITransparentUpgradeableProxy(proxy), newImplementation, bytes(""));

        vm.stopBroadcast();

        console2.log("VeydriftGame proxy:", proxy);
        console2.log("New implementation:", newImplementation);
        console2.log("Gameplay module:   ", address(gameplayModule));
        console2.log("Combat module:     ", address(combatModule));
        console2.log("ACS attack module: ", address(acsAttackModule));
    }
}
