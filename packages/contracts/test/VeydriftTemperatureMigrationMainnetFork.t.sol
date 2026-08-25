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
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftFirstPlanetSettlementModule} from "../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftShipProductionModule} from "../src/VeydriftShipProductionModule.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {VeydriftPlanetGeneration} from "../src/libraries/VeydriftPlanetGeneration.sol";

contract VeydriftTemperatureMigrationMainnetForkTest is Test {
    address private constant GAME_PROXY = 0xf397910F005151b09644228573a4353818D3755d;
    address private constant PROXY_ADMIN = 0xc81609E77b5ea79d0CdA9794b75B65D567535cb9;

    function testLiveUpgradePreservesEveryLegacyRollAndRequiresMigrationBeforeUnpause() external {
        string memory rpc = vm.envOr("VEYDRIFT_BASE_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            emit log("VEYDRIFT_BASE_MAINNET_RPC_URL unset - skipping temperature migration fork");
            return;
        }
        uint256 forkBlock = vm.envOr("VEYDRIFT_FORK_BLOCK_NUMBER", uint256(0));
        if (forkBlock == 0) {
            vm.createSelectFork(rpc);
        } else {
            vm.createSelectFork(rpc, forkBlock);
        }

        VeydriftGame game = VeydriftGame(payable(GAME_PROXY));
        address owner = game.owner();
        assertEq(ProxyAdmin(PROXY_ADMIN).owner(), owner, "proxy admin owner drift");

        uint256 end = game.nextPlanetId();
        int16[] memory temperatures = new int16[](end);
        bool[] memory active = new bool[](end);
        uint256 activeCount;
        for (uint256 planetId = 1; planetId < end; ++planetId) {
            VeydriftGameStorage.Planet memory planetBefore = game.planet(planetId);
            if (planetBefore.owner == address(0)) continue;
            active[planetId] = true;
            temperatures[planetId] = planetBefore.temperature;
            activeCount += 1;
        }

        vm.prank(owner);
        game.setGamePaused(true);
        assertTrue(game.gamePaused());

        VeydriftGame implementation = _newImplementation(owner);
        vm.prank(owner);
        ProxyAdmin(PROXY_ADMIN)
            .upgradeAndCall(ITransparentUpgradeableProxy(GAME_PROXY), address(implementation), "");

        assertEq(game.planetTemperatureGenerationVersion(), 0);
        vm.prank(owner);
        vm.expectRevert(VeydriftGameStorage.PlanetTemperatureMigrationPending.selector);
        game.setGamePaused(false);

        uint256 migrated;
        uint256 batches;
        while (game.planetTemperatureGenerationVersion() < 2) {
            vm.prank(owner);
            uint256 gasBeforeMigration = gasleft();
            migrated += game.migratePlanetTemperatures();
            uint256 batchGas = gasBeforeMigration - gasleft();
            emit log_named_uint("temperature migration batch gas", batchGas);
            assertLt(batchGas, 12_000_000, "temperature migration batch exceeds safe gas budget");
            batches += 1;
            if (game.planetTemperatureGenerationVersion() < 2) {
                assertTrue(game.gamePaused());
                vm.prank(owner);
                vm.expectRevert(VeydriftGameStorage.PlanetTemperatureMigrationPending.selector);
                game.setGamePaused(false);
            }
        }
        assertGt(batches, 1, "live migration should exercise resumable batches");
        assertEq(migrated, activeCount);
        assertEq(game.planetTemperatureGenerationVersion(), 2);
        assertTrue(game.gamePaused());

        for (uint256 planetId = 1; planetId < end; ++planetId) {
            if (!active[planetId]) continue;
            VeydriftGameStorage.Planet memory planetAfter = game.planet(planetId);
            assertEq(
                planetAfter.temperature,
                VeydriftPlanetGeneration.migrateLegacyTemperature(
                    planetAfter.position, temperatures[planetId]
                ),
                "planet temperature roll drift"
            );
        }

        vm.prank(owner);
        vm.expectRevert(VeydriftGameStorage.PlanetTemperatureMigrationCompleted.selector);
        game.migratePlanetTemperatures();

        vm.prank(owner);
        game.setGamePaused(false);
        assertFalse(game.gamePaused());
    }

    function _newImplementation(address owner) private returns (VeydriftGame) {
        VeydriftCombatModule combat =
            new VeydriftCombatModule(address(new VeydriftCombatRapidfire()));
        VeydriftColonizationModule colonizationModule =
            new VeydriftColonizationModule(address(new VeydriftShipProductionModule()));
        return new VeydriftGame(
            owner,
            address(
                new VeydriftFirstPlanetSettlementModule(
                    address(0xBEEF), address(colonizationModule)
                )
            ),
            address(new VeydriftGameplayModule(address(combat))),
            address(new VeydriftPlanetManagementModule()),
            address(new VeydriftAttackProtectionModule()),
            address(colonizationModule),
            address(new VeydriftDefenseHoldModule()),
            address(new VeydriftStateMigrationModule(address(0xBEEF))),
            address(new VeydriftAcsAttackModule())
        );
    }
}
