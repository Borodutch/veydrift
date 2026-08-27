// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
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
import {
    IVeydriftMoonGame,
    IVeydriftRandomnessEngine,
    VeydriftMoonSystem
} from "../src/VeydriftMoonSystem.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {VeydriftLiveUpgradePolicy} from "../src/libraries/VeydriftLiveUpgradePolicy.sol";
import {Ship} from "../src/libraries/VeydriftTypes.sol";

/// @notice Live-fork verification of the VeydriftGame proxy upgrade.
/// @dev Runs ONLY when BASE_MAINNET_RPC is set, so it is inert in the default `forge test` suite:
///        BASE_MAINNET_RPC=<base-mainnet-rpc> forge test --match-contract UpgradeGameFork -vv
///      It forks live Base mainnet after live-migration prerequisites are satisfied, performs the
///      exact empty-calldata UpgradeGame.s.sol proxy switch as the real ProxyAdmin owner (via prank
///      — no private key needed), and asserts gameplay remains live while owner + game storage (a
///      real planet's ship count) are preserved.
contract UpgradeGameForkTest is Test {
    // EIP-1967 implementation slot.
    bytes32 internal constant IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    address internal constant PROXY = 0xf397910F005151b09644228573a4353818D3755d;
    address internal constant PROXY_ADMIN = 0xc81609E77b5ea79d0CdA9794b75B65D567535cb9;
    address internal constant PROXY_ADMIN_OWNER = 0x4755D28078442cb7E7Ac2409868fb3Ff1B9fA73B;
    address payable internal constant MOON_PROXY =
        payable(0x4935f1E0024F1Ea07877a583F89A51BF3d91Cf5C);

    function _addrFromSlot(bytes32 slot) private view returns (address) {
        return address(uint160(uint256(vm.load(PROXY, slot))));
    }

    function testForkUpgradePreservesStateAndFlipsImplementation() external {
        string memory rpc = vm.envOr("BASE_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) {
            emit log("BASE_MAINNET_RPC unset - skipping live fork upgrade verification");
            return;
        }
        vm.createSelectFork(rpc);

        // Sanity: the live wiring matches what the upgrade script assumes.
        assertEq(ProxyAdmin(PROXY_ADMIN).owner(), PROXY_ADMIN_OWNER, "proxy admin owner drift");

        address oldImpl = _addrFromSlot(IMPL_SLOT);
        address ownerBefore = VeydriftGame(PROXY).owner();
        uint32 shipBefore = VeydriftGame(PROXY).shipCount(1, Ship.SmallCargo);
        assertFalse(VeydriftGame(PROXY).gamePaused(), "game unexpectedly paused before upgrade");

        _upgradeMoonSystem();
        // Exercise the same live/migration preflight as UpgradeGame.s.sol. The fork must fail
        // rather than silently perform a proxy switch when any pause-only migration is pending.
        VeydriftLiveUpgradePolicy.requireGameUpgradeReady(PROXY);

        // Deploy the fresh module set + implementation exactly like UpgradeGame.s.sol.
        VeydriftCombatRapidfire rapidfire = new VeydriftCombatRapidfire();
        VeydriftCombatModule combatModule = new VeydriftCombatModule(address(rapidfire));
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftAttackProtectionModule attackProtectionModule = new VeydriftAttackProtectionModule();
        VeydriftColonizationModule colonizationModule =
            new VeydriftColonizationModule(address(new VeydriftShipProductionModule()));
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();
        VeydriftStateMigrationModule stateMigrationModule =
            new VeydriftStateMigrationModule(address(0xBEEF));
        VeydriftFirstPlanetSettlementModule firstPlanetSettlementModule =
            new VeydriftFirstPlanetSettlementModule(address(0xBEEF), address(colonizationModule));
        VeydriftGame newImpl = new VeydriftGame(
            PROXY_ADMIN_OWNER,
            address(firstPlanetSettlementModule),
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule),
            address(defenseHoldModule),
            address(stateMigrationModule),
            address(new VeydriftAcsAttackModule())
        );

        // Perform the upgrade as the real ProxyAdmin owner.
        vm.prank(PROXY_ADMIN_OWNER);
        ProxyAdmin(PROXY_ADMIN)
            .upgradeAndCall(ITransparentUpgradeableProxy(PROXY), address(newImpl), "");

        // Implementation flipped to the new code.
        address implAfter = _addrFromSlot(IMPL_SLOT);
        assertEq(implAfter, address(newImpl), "impl slot not updated");
        assertTrue(implAfter != oldImpl, "impl unchanged");

        // Proxy storage (owner + a real planet's ship count) survives the upgrade unchanged.
        assertEq(VeydriftGame(PROXY).owner(), ownerBefore, "owner not preserved");
        assertEq(VeydriftGame(PROXY).shipCount(1, Ship.SmallCargo), shipBefore, "ship count drift");
        assertFalse(VeydriftGame(PROXY).gamePaused(), "game paused by upgrade");
    }

    function _upgradeMoonSystem() private {
        VeydriftMoonSystem proxied = VeydriftMoonSystem(MOON_PROXY);
        address owner = proxied.owner();
        IVeydriftMoonGame game = proxied.game();
        IVeydriftRandomnessEngine randomness = proxied.randomness();
        address implementation = address(new VeydriftMoonSystem(address(game), address(randomness)));

        vm.prank(owner);
        proxied.upgradeToAndCall(implementation, "");
    }
}
