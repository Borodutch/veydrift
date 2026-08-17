// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftShipProductionModule} from "../src/VeydriftShipProductionModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftFirstPlanetSettlementModule} from "../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {
    VeydriftCrystal,
    VeydriftDeuterium,
    VeydriftMetal,
    VeydriftResourceToken
} from "../src/VeydriftResourceToken.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {Resource} from "../src/libraries/VeydriftTypes.sol";

/// @notice Base-mainnet fork proof for the live resource-token and game proxy upgrade paths.
/// @dev No private key or broadcast is used. Set VEYDRIFT_BASE_MAINNET_RPC_URL or
///      BASE_MAINNET_RPC_URL to execute; the default repository suite skips when neither is present.
contract VeydriftLaunchMainnetForkTest is Test {
    bytes32 internal constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 internal constant ADMIN_SLOT =
        0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    address internal constant GAME_PROXY = 0xf397910F005151b09644228573a4353818D3755d;
    address internal constant METAL_PROXY = 0x91A4f8A9D05F21E010dc1eE0B17Ab644D433cB41;
    address internal constant CRYSTAL_PROXY = 0xC6881a2C4C50E28AdCaC4D5577cD8e211E806B76;
    address internal constant DEUTERIUM_PROXY = 0x5A6027DE1C7E52B4b1AD0c13c3eC3Ad5FCb481e2;
    address internal constant FORK_TREASURY = address(0x740);

    function testForkResourceTokenUpgradesRemoveMintAndPreserveSupply() external {
        if (!_selectFork()) return;

        _upgradeResourceToken(VeydriftResourceToken(METAL_PROXY), address(new VeydriftMetal()));
        _upgradeResourceToken(VeydriftResourceToken(CRYSTAL_PROXY), address(new VeydriftCrystal()));
        _upgradeResourceToken(
            VeydriftResourceToken(DEUTERIUM_PROXY), address(new VeydriftDeuterium())
        );
    }

    function testForkGameUpgradePreservesStorageAndReleasesOnlyWhitepaperExcess() external {
        if (!_selectFork()) return;

        VeydriftGame game = VeydriftGame(GAME_PROXY);
        address ownerBefore = game.owner();
        VeydriftGameStorage.Resources memory requirementBefore = game.resourceReserveRequirement();
        address oldImplementation = _addressFromSlot(GAME_PROXY, IMPLEMENTATION_SLOT);
        address proxyAdminAddress = _addressFromSlot(GAME_PROXY, ADMIN_SLOT);
        address proxyAdminOwner = ProxyAdmin(proxyAdminAddress).owner();

        VeydriftCombatModule combatModule =
            new VeydriftCombatModule(address(new VeydriftCombatRapidfire()));
        VeydriftGame newImplementation = new VeydriftGame(
            proxyAdminOwner,
            address(new VeydriftFirstPlanetSettlementModule(address(0xBEEF))),
            address(new VeydriftGameplayModule(address(combatModule))),
            address(new VeydriftPlanetManagementModule()),
            address(new VeydriftAttackProtectionModule()),
            address(new VeydriftColonizationModule(address(new VeydriftShipProductionModule()))),
            address(new VeydriftDefenseHoldModule()),
            address(new VeydriftStateMigrationModule(address(0xBEEF)))
        );

        vm.prank(proxyAdminOwner);
        ProxyAdmin(proxyAdminAddress)
            .upgradeAndCall(
                ITransparentUpgradeableProxy(GAME_PROXY),
                address(newImplementation),
                abi.encodeCall(VeydriftGame.initializeMoonAttackParity, ())
            );

        assertNotEq(address(newImplementation), oldImplementation);
        assertEq(_addressFromSlot(GAME_PROXY, IMPLEMENTATION_SLOT), address(newImplementation));
        assertEq(game.owner(), ownerBefore);
        VeydriftGameStorage.Resources memory requirementAfter = game.resourceReserveRequirement();
        assertEq(requirementAfter.metal, requirementBefore.metal);
        assertEq(requirementAfter.crystal, requirementBefore.crystal);
        assertEq(requirementAfter.deuterium, requirementBefore.deuterium);

        VeydriftGameStorage.Resources memory amount = VeydriftGameStorage.Resources({
            metal: 333_333_000, crystal: 222_222_000, deuterium: 133_333_000
        });
        VeydriftGameStorage.Resources memory safetyMargin = VeydriftGameStorage.Resources({
            metal: 1_000_000, crystal: 1_000_000, deuterium: 1_000_000
        });
        vm.prank(ownerBefore);
        game.releaseExcessResourceReserves(FORK_TREASURY, amount, safetyMargin);

        assertEq(VeydriftResourceToken(METAL_PROXY).balanceOf(FORK_TREASURY), amount.metal);
        assertEq(VeydriftResourceToken(CRYSTAL_PROXY).balanceOf(FORK_TREASURY), amount.crystal);
        assertEq(VeydriftResourceToken(DEUTERIUM_PROXY).balanceOf(FORK_TREASURY), amount.deuterium);
        assertGe(
            game.resourceReserveBalance(Resource.Metal),
            uint256(requirementAfter.metal) + safetyMargin.metal
        );
        assertGe(
            game.resourceReserveBalance(Resource.Crystal),
            uint256(requirementAfter.crystal) + safetyMargin.crystal
        );
        assertGe(
            game.resourceReserveBalance(Resource.Deuterium),
            uint256(requirementAfter.deuterium) + safetyMargin.deuterium
        );
    }

    function _upgradeResourceToken(VeydriftResourceToken token, address newImplementation) private {
        uint256 supplyBefore = token.totalSupply();
        address owner = token.owner();
        vm.prank(owner);
        token.upgradeToAndCall(newImplementation, "");

        assertEq(token.totalSupply(), supplyBefore);
        assertEq(token.totalSupply(), token.INITIAL_SUPPLY());
        vm.prank(owner);
        (bool mintSucceeded,) =
            address(token).call(abi.encodeWithSignature("mint(address,uint256)", FORK_TREASURY, 1));
        assertFalse(mintSucceeded);
        VeydriftMetal forbiddenImplementation = new VeydriftMetal();
        vm.expectRevert(VeydriftResourceToken.ResourceTokenUpgradesDisabled.selector);
        vm.prank(owner);
        token.upgradeToAndCall(address(forbiddenImplementation), "");
        assertEq(token.totalSupply(), supplyBefore);
    }

    function _selectFork() private returns (bool) {
        string memory rpc = vm.envOr("VEYDRIFT_BASE_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) rpc = vm.envOr("BASE_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            emit log("Base mainnet RPC unset - skipping VEY-740 live proxy fork proof");
            return false;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 8453);
        assertTrue(GAME_PROXY.code.length > 0);
        return true;
    }

    function _addressFromSlot(address target, bytes32 slot) private view returns (address) {
        return address(uint160(uint256(vm.load(target, slot))));
    }
}
