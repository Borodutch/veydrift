// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from
    "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";

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
///      This mirrors the proven manual upgrade performed on 2026-06-11 (tx 0xbf1890…): deploy
///      fresh modules + game impl, then ProxyAdmin.upgradeAndCall(proxy, newImpl, "") from the
///      ProxyAdmin owner EOA.
///
///      Required env:
///        PRIVATE_KEY        deployer EOA; MUST be the ProxyAdmin owner (asserted below)
///        GAME_PROXY_ADDRESS the live VeydriftGame proxy   (0xf12f3173…)
///        GAME_PROXY_ADMIN   the OZ ProxyAdmin contract     (0xef1570ec…)
///      Optional env:
///        ADMIN_ADDRESS      module-admin arg for the new impl (defaults to broadcaster; only
///                           affects the impl's own storage, never the proxy)
///
///      Dry run (no broadcast):
///        forge script script/UpgradeGame.s.sol:UpgradeGame --rpc-url <base_sepolia>
///      Execute:
///        forge script script/UpgradeGame.s.sol:UpgradeGame --rpc-url <base_sepolia> --broadcast
contract UpgradeGame is Script {
    function run() external returns (address newImplementation) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(privateKey);
        address proxy = vm.envAddress("GAME_PROXY_ADDRESS");
        address proxyAdmin = vm.envAddress("GAME_PROXY_ADMIN");
        address moduleAdmin = vm.envOr("ADMIN_ADDRESS", broadcaster);

        // The upgrade call is onlyOwner on the ProxyAdmin. Fail fast (before any deploy) if the
        // signer cannot actually execute the upgrade, so we never strand orphaned module deploys.
        require(
            ProxyAdmin(proxyAdmin).owner() == broadcaster, "BROADCASTER_NOT_PROXY_ADMIN_OWNER"
        );

        vm.startBroadcast(privateKey);

        VeydriftCombatRapidfire rapidfire = new VeydriftCombatRapidfire();
        VeydriftCombatModule combatModule = new VeydriftCombatModule(address(rapidfire));
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftAttackProtectionModule attackProtectionModule = new VeydriftAttackProtectionModule();
        VeydriftColonizationModule colonizationModule = new VeydriftColonizationModule();
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();

        VeydriftGame newImpl = new VeydriftGame(
            moduleAdmin,
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule),
            address(defenseHoldModule)
        );
        newImplementation = address(newImpl);

        ProxyAdmin(proxyAdmin).upgradeAndCall(
            ITransparentUpgradeableProxy(proxy), newImplementation, ""
        );

        vm.stopBroadcast();

        console2.log("VeydriftGame proxy:", proxy);
        console2.log("New implementation:", newImplementation);
        console2.log("Gameplay module:   ", address(gameplayModule));
        console2.log("Combat module:     ", address(combatModule));
    }
}
