// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftCombatModule} from "../src/VeydriftCombatModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftSpaceDockSystem} from "../src/VeydriftSpaceDockSystem.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {Ship} from "../src/libraries/VeydriftTypes.sol";

contract SpaceDockMockResourceToken {
    mapping(address account => uint256 balance) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return true;
    }
}

contract VeydriftSpaceDockSystemTest is Test {
    address internal admin = address(0xA11CE);
    address internal player = address(0xB0B);
    VeydriftGame internal game;
    VeydriftSpaceDockSystem internal spaceDock;

    function setUp() public {
        VeydriftCombatModule combatModule = new VeydriftCombatModule();
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        game = new VeydriftGame(admin, address(gameplayModule), address(planetManagementModule));
        spaceDock = new VeydriftSpaceDockSystem(address(game), admin);
        _fundGameReserves();
        vm.deal(player, 1 ether);
    }

    function testSpaceDockCatalogUsesVeydriftCostAndRepairFormula() public pure {
        (uint128 metal, uint128 crystal, uint128 deuterium) =
            VeydriftCatalog.spaceDockUpgradeCost(0);
        assertEq(metal, 200);
        assertEq(crystal, 0);
        assertEq(deuterium, 50);

        (metal, crystal, deuterium) = VeydriftCatalog.spaceDockUpgradeCost(2);
        assertEq(metal, 5_000);
        assertEq(crystal, 0);
        assertEq(deuterium, 1_250);
        assertEq(VeydriftCatalog.spaceDockRepairBps(1), 2_100);
        assertEq(VeydriftCatalog.spaceDockRepairBps(30), 5_000);
        assertFalse(VeydriftCatalog.shipRepairableInSpaceDock(Ship.SolarSatellite));
    }

    function testCombatWreckageCanBeRepairedBeforeExpiry() public {
        uint256 planetId = _startPlanetWithSpaceDock(1);

        vm.prank(admin);
        spaceDock.recordCombatWreckage(planetId, Ship.LightFighter, 40);

        assertEq(spaceDock.repairableShipCount(planetId, Ship.LightFighter), 8);
        (bool active, uint64 expiresAt) = spaceDock.wreckageFields(planetId);
        assertTrue(active);
        assertEq(expiresAt, block.timestamp + 3 days);

        vm.prank(player);
        spaceDock.startShipRepair(planetId, Ship.LightFighter, 3);
        assertEq(spaceDock.repairableShipCount(planetId, Ship.LightFighter), 5);

        (bool queueActive,, uint32 quantity, uint64 readyAt) = spaceDock.repairQueues(planetId);
        assertTrue(queueActive);
        assertEq(quantity, 3);

        vm.warp(readyAt);
        vm.prank(player);
        spaceDock.finishShipRepair(planetId);
        assertEq(spaceDock.repairedShipCount(planetId, Ship.LightFighter), 3);
    }

    function testWreckageRequiresSpaceDockAndQualifyingLosses() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftSpaceDockSystem.NoSpaceDock.selector, planetId)
        );
        spaceDock.recordCombatWreckage(planetId, Ship.LightFighter, 40);

        vm.prank(admin);
        spaceDock.setSpaceDockLevel(planetId, 1);
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftSpaceDockSystem.WreckageTooSmall.selector, 4_000)
        );
        spaceDock.recordCombatWreckage(planetId, Ship.LightFighter, 1);
    }

    function testExpiredWreckageCannotStartRepair() public {
        uint256 planetId = _startPlanetWithSpaceDock(1);

        vm.prank(admin);
        spaceDock.recordCombatWreckage(planetId, Ship.LightFighter, 40);
        vm.warp(block.timestamp + 3 days + 1);

        vm.prank(player);
        vm.expectRevert();
        spaceDock.startShipRepair(planetId, Ship.LightFighter, 1);
    }

    function testFreshWreckageDoesNotReviveExpiredRepairableShips() public {
        uint256 planetId = _startPlanetWithSpaceDock(1);

        vm.prank(admin);
        spaceDock.recordCombatWreckage(planetId, Ship.LightFighter, 40);
        assertEq(spaceDock.repairableShipCount(planetId, Ship.LightFighter), 8);

        vm.warp(block.timestamp + 3 days + 1);

        vm.prank(admin);
        spaceDock.recordCombatWreckage(planetId, Ship.Cruiser, 10);

        assertEq(spaceDock.repairableShipCount(planetId, Ship.LightFighter), 0);
        assertEq(spaceDock.repairableShipCount(planetId, Ship.Cruiser), 2);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftSpaceDockSystem.InsufficientWreckage.selector, Ship.LightFighter, 0, 1
            )
        );
        spaceDock.startShipRepair(planetId, Ship.LightFighter, 1);
    }

    function _startPlanetWithSpaceDock(uint16 level) internal returns (uint256 planetId) {
        vm.prank(player);
        planetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(admin);
        spaceDock.setSpaceDockLevel(planetId, level);
    }

    function _fundGameReserves() internal {
        SpaceDockMockResourceToken metalToken = new SpaceDockMockResourceToken();
        SpaceDockMockResourceToken crystalToken = new SpaceDockMockResourceToken();
        SpaceDockMockResourceToken deuteriumToken = new SpaceDockMockResourceToken();
        metalToken.mint(address(game), 1_000_000_000);
        crystalToken.mint(address(game), 1_000_000_000);
        deuteriumToken.mint(address(game), 1_000_000_000);
        vm.prank(admin);
        game.setResourceTokens(address(metalToken), address(crystalToken), address(deuteriumToken));
    }
}
