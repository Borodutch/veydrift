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
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {
    IVeydriftMoonGame,
    IVeydriftRandomnessEngine,
    VeydriftMoonSystem
} from "../src/VeydriftMoonSystem.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {Ship} from "../src/libraries/VeydriftTypes.sol";

/// @notice Live-fork verification of the VeydriftGame proxy upgrade (VEY-468).
/// @dev Runs ONLY when BASE_SEPOLIA_RPC is set, so it is inert in the default `forge test` suite:
///        BASE_SEPOLIA_RPC=https://sepolia.base.org forge test --match-contract UpgradeGameFork -vv
///      It forks live Base Sepolia, performs the exact UpgradeGame.s.sol upgrade as the real
///      ProxyAdmin owner (via prank — no private key needed), and asserts the proxy implementation
///      slot flips while owner + game storage (a real planet's ship count) are preserved.
contract UpgradeGameForkTest is Test {
    // EIP-1967 implementation slot.
    bytes32 internal constant IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    address internal constant PROXY = 0xf12f31734868F1089d9d6514D7F19a31Ec5e00e2;
    address internal constant PROXY_ADMIN = 0xef1570EC118de0c3dC2219C1ee3B731b46f6F54B;
    address internal constant PROXY_ADMIN_OWNER = 0xC2142A4918754abe5975ecD486A66DfeBA39A419;
    address payable internal constant MOON_PROXY =
        payable(0xe65eF3415fA875666AEDF033616c43e61F368c96);

    function _addrFromSlot(bytes32 slot) private view returns (address) {
        return address(uint160(uint256(vm.load(PROXY, slot))));
    }

    function testForkUpgradePreservesStateAndFlipsImplementation() external {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC", string(""));
        if (bytes(rpc).length == 0) {
            emit log("BASE_SEPOLIA_RPC unset - skipping live fork upgrade verification");
            return;
        }
        vm.createSelectFork(rpc);

        // Sanity: the live wiring matches what the upgrade script assumes.
        assertEq(ProxyAdmin(PROXY_ADMIN).owner(), PROXY_ADMIN_OWNER, "proxy admin owner drift");

        address oldImpl = _addrFromSlot(IMPL_SLOT);
        address ownerBefore = VeydriftGame(PROXY).owner();
        uint32 shipBefore = VeydriftGame(PROXY).shipCount(1, Ship.SmallCargo);

        _upgradeMoonSystem();

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
            new VeydriftFirstPlanetSettlementModule(address(0xBEEF));
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
            .upgradeAndCall(
                ITransparentUpgradeableProxy(PROXY),
                address(newImpl),
                abi.encodeCall(VeydriftGame.initializeMoonAttackParity, ())
            );

        // Implementation flipped to the new code.
        address implAfter = _addrFromSlot(IMPL_SLOT);
        assertEq(implAfter, address(newImpl), "impl slot not updated");
        assertTrue(implAfter != oldImpl, "impl unchanged");

        // Proxy storage (owner + a real planet's ship count) survives the upgrade unchanged.
        assertEq(VeydriftGame(PROXY).owner(), ownerBefore, "owner not preserved");
        assertEq(VeydriftGame(PROXY).shipCount(1, Ship.SmallCargo), shipBefore, "ship count drift");

        _assertMoonAttackMissionNotStuck(8328);
        _assertMoonAttackMissionNotStuck(8336);
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

    function _assertMoonAttackMissionNotStuck(uint256 missionId) private {
        (VeydriftGameStorage.FleetMissionStatus statusBefore,,,,,,,,,,) =
            VeydriftGame(PROXY).fleetMission(missionId);
        if (statusBefore == VeydriftGameStorage.FleetMissionStatus.Outbound) {
            VeydriftGame(PROXY).resolveFleetMission(missionId);
        }

        (VeydriftGameStorage.FleetMissionStatus statusAfter,,,,,,,,,,) =
            VeydriftGame(PROXY).fleetMission(missionId);
        assertTrue(
            statusAfter != VeydriftGameStorage.FleetMissionStatus.Outbound,
            "moon attack mission still stuck outbound after upgrade"
        );
    }
}
