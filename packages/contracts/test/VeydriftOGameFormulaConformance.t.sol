// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {VeydriftDependencies} from "../src/libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "../src/libraries/VeydriftFormulas.sol";
import {Building, Defense, Ship, Technology} from "../src/libraries/VeydriftTypes.sol";

contract VeydriftOGameFormulaConformanceTest is Test {
    uint16 internal constant BPS = 10_000;
    uint32 internal constant MIN_QUEUE_SECONDS = 60;
    bytes32 private constant DEP_COMBUSTION_2 = "COMBUSTION_2";
    bytes32 private constant DEP_ION_2 = "ION_2";
    bytes32 private constant DEP_GAUSS_CANNON = "WEAPONS_3";
    bytes32 private constant DEP_PLASMA_RESEARCH = "ENERGY_8_LASER_10_ION_5";

    function testVanillaOGameMineProductionAndEnergy() public pure {
        (uint256 produced, uint256 required, uint256 scaleBps) =
            VeydriftFormulas.energyBalance(3, 3, 2, 6, 0, 0);
        assertEq(produced, 212);
        assertEq(required, 126);
        assertEq(scaleBps, BPS);

        (uint256 metal, uint256 crystal, uint256 deuterium) =
            VeydriftFormulas.productionPerHour(5, 4, 3, 12, 0, 0, 10_000, 10_000, 13_040);
        assertEq(metal, 241);
        assertEq(crystal, 117);
        assertEq(deuterium, 50);

        (metal, crystal, deuterium) =
            VeydriftFormulas.productionPerHour(5, 4, 3, 0, 0, 0, 10_000, 10_000, 13_040);
        assertEq(metal, 0);
        assertEq(crystal, 0);
        assertEq(deuterium, 0);
    }

    function testVanillaOGameFusionReactorEnergyAndDeuteriumUse() public pure {
        (uint256 produced, uint256 required, uint256 scaleBps) =
            VeydriftFormulas.energyBalance(0, 0, 0, 0, 2, 3);

        assertEq(produced, 69);
        assertEq(required, 0);
        assertEq(scaleBps, BPS);
        assertEq(VeydriftFormulas.fusionReactorEnergyProduction(1, 3), 32);
        assertEq(VeydriftFormulas.fusionReactorDeuteriumConsumption(1), 11);
        assertEq(VeydriftFormulas.fusionReactorDeuteriumConsumption(2), 25);

        (uint256 metal, uint256 crystal, uint256 deuterium) =
            VeydriftFormulas.productionPerHour(0, 0, 3, 0, 2, 3, 10_000, 10_000, 13_040);
        assertEq(metal, 0);
        assertEq(crystal, 0);
        assertEq(deuterium, 21);
    }

    function testVanillaOGamePlanetMultipliers() public pure {
        (uint16 metalMultiplier, uint16 crystalMultiplier, uint16 deuteriumMultiplier) =
            VeydriftFormulas.planetMultipliers(-12, 206);

        assertEq(metalMultiplier, 10_000);
        assertEq(crystalMultiplier, 10_000);
        assertEq(deuteriumMultiplier, 13_040);
    }

    function testVanillaOGameStorageCapTable() public pure {
        (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap) =
            VeydriftFormulas.storageCaps(0, 3, 10);

        assertEq(metalCap, 10_000);
        assertEq(crystalCap, 75_000);
        assertEq(deuteriumCap, 5_355_000);
    }

    function testVanillaOGameBuildingCosts() public pure {
        _assertBuildingCost(Building.MetalMine, 2, 135, 33, 0);
        _assertBuildingCost(Building.CrystalMine, 3, 196, 98, 0);
        _assertBuildingCost(Building.DeuteriumSynthesizer, 4, 1_139, 379, 0);
        _assertBuildingCost(Building.SolarPlant, 9, 2_883, 1_153, 0);
        _assertBuildingCost(Building.FusionReactor, 1, 1_620, 648, 324);
        _assertBuildingCost(Building.RoboticsFactory, 1, 800, 240, 400);
        _assertBuildingCost(Building.MetalStorage, 10, 1_024_000, 0, 0);
    }

    function testVanillaOGameDurations() public pure {
        assertEq(VeydriftFormulas.buildingDuration(0, 0, 60, 15, MIN_QUEUE_SECONDS), 108);
        assertEq(VeydriftFormulas.buildingDuration(0, 0, 75, 30, MIN_QUEUE_SECONDS), 151);
        assertEq(VeydriftFormulas.buildingDuration(0, 0, 225, 75, MIN_QUEUE_SECONDS), 432);
        assertEq(VeydriftFormulas.buildingDuration(0, 0, 400, 120, MIN_QUEUE_SECONDS), 748);
        assertEq(VeydriftFormulas.buildingDuration(0, 0, 6_000, 0, MIN_QUEUE_SECONDS), 8_640);
        assertEq(VeydriftFormulas.buildingDuration(1, 0, 6_000, 0, MIN_QUEUE_SECONDS), 4_320);
        assertEq(VeydriftFormulas.buildingDuration(1, 2, 6_000, 0, MIN_QUEUE_SECONDS), 1_080);
        assertEq(VeydriftFormulas.unitDuration(2, 0, 2_000, 2_000, 0, 1, MIN_QUEUE_SECONDS), 1_920);
        assertEq(
            VeydriftFormulas.unitDuration(7, 2, 45_000, 15_000, 0, 1, MIN_QUEUE_SECONDS), 2_700
        );
        assertEq(
            VeydriftFormulas.researchDuration(0, 12_000, 12_000, 50_000, MIN_QUEUE_SECONDS), 86_400
        );
        assertEq(
            VeydriftFormulas.researchDuration(1, 12_000, 12_000, 50_000, MIN_QUEUE_SECONDS), 43_200
        );
    }

    function testVanillaOGameShipCostsCargoAndRequirements() public {
        _assertShip(Ship.SmallCargo, 2_000, 2_000, 0, 5_000);
        _assertShip(Ship.Cruiser, 20_000, 7_000, 2_000, 800);
        _assertShip(Ship.Deathstar, 5_000_000, 4_000_000, 1_000_000, 1_000_000);
        _assertShip(Ship.Reaper, 85_000, 55_000, 20_000, 7_000);

        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftDependencies.MissingDependency.selector, DEP_COMBUSTION_2
            )
        );
        VeydriftDependencies.requireShip(Ship.SmallCargo, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        VeydriftDependencies.requireShip(Ship.SmallCargo, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftDependencies.MissingDependency.selector, DEP_ION_2)
        );
        VeydriftDependencies.requireShip(Ship.Cruiser, 5, 0, 4, 0, 0, 0, 0, 0, 1, 0, 0, 0);
        VeydriftDependencies.requireShip(Ship.Cruiser, 5, 0, 4, 0, 0, 0, 0, 0, 2, 0, 0, 0);
    }

    function testVanillaOGameDefenseCostsAndRequirements() public {
        _assertDefense(Defense.RocketLauncher, 2_000, 0, 0);
        _assertDefense(Defense.IonCannon, 2_000, 6_000, 0);
        _assertDefense(Defense.GaussCannon, 20_000, 15_000, 2_000);
        _assertDefense(Defense.PlasmaTurret, 50_000, 50_000, 30_000);

        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftDependencies.MissingDependency.selector, DEP_GAUSS_CANNON
            )
        );
        VeydriftDependencies.requireDefense(Defense.GaussCannon, 6, 0, 6, 0, 0, 2, 1, 0, 0);
        VeydriftDependencies.requireDefense(Defense.GaussCannon, 6, 0, 6, 0, 0, 3, 1, 0, 0);
    }

    function testVanillaOGameCombatStatsAndRapidfire() public pure {
        assertEq(VeydriftCatalog.shipBattleAttack(Ship.SmallCargo), 5);
        assertEq(VeydriftCatalog.shipBattleShield(Ship.SmallCargo), 10);
        assertEq(VeydriftCatalog.shipBattleHull(Ship.SmallCargo), 400);
        assertEq(VeydriftCatalog.shipBattleAttack(Ship.Cruiser), 400);
        assertEq(VeydriftCatalog.shipBattleShield(Ship.Cruiser), 50);
        assertEq(VeydriftCatalog.shipBattleHull(Ship.Cruiser), 2_700);
        assertEq(VeydriftCatalog.shipBattleAttack(Ship.Destroyer), 2_000);
        assertEq(VeydriftCatalog.shipBattleShield(Ship.Destroyer), 500);
        assertEq(VeydriftCatalog.shipBattleHull(Ship.Destroyer), 11_000);
        assertEq(VeydriftCatalog.shipBattleAttack(Ship.Deathstar), 200_000);
        assertEq(VeydriftCatalog.shipBattleShield(Ship.Deathstar), 50_000);
        assertEq(VeydriftCatalog.shipBattleHull(Ship.Deathstar), 900_000);

        assertEq(VeydriftCatalog.defenseBattleAttack(Defense.RocketLauncher), 80);
        assertEq(VeydriftCatalog.defenseBattleShield(Defense.RocketLauncher), 20);
        assertEq(VeydriftCatalog.defenseBattleHull(Defense.RocketLauncher), 200);
        assertEq(VeydriftCatalog.defenseBattleAttack(Defense.LargeShieldDome), 1);
        assertEq(VeydriftCatalog.defenseBattleShield(Defense.LargeShieldDome), 10_000);
        assertEq(VeydriftCatalog.defenseBattleHull(Defense.LargeShieldDome), 10_000);

        assertEq(
            VeydriftCatalog.shipRapidfireAgainstDefense(Ship.Cruiser, Defense.RocketLauncher), 10
        );
        assertEq(VeydriftCatalog.shipRapidfireAgainstShip(Ship.Battlecruiser, Ship.Battleship), 7);
        assertEq(VeydriftCatalog.shipRapidfireAgainstShip(Ship.Destroyer, Ship.Battlecruiser), 2);
        assertEq(
            VeydriftCatalog.shipRapidfireAgainstDefense(Ship.SmallCargo, Defense.RocketLauncher), 1
        );
    }

    function testVanillaOGameResearchCostsAndRequirements() public {
        _assertResearch(Technology.Energy, 0, 800, 400);
        _assertResearch(Technology.HyperspaceDrive, 10_000, 20_000, 6_000);
        _assertResearch(Technology.Plasma, 2_000, 4_000, 1_000);

        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftDependencies.MissingDependency.selector, DEP_PLASMA_RESEARCH
            )
        );
        VeydriftDependencies.requireResearch(Technology.Plasma, 4, 8, 10, 4, 0, 0, 0, 0);
        VeydriftDependencies.requireResearch(Technology.Plasma, 4, 8, 10, 5, 0, 0, 0, 0);
    }

    function _assertBuildingCost(
        Building building,
        uint16 currentLevel,
        uint128 expectedMetal,
        uint128 expectedCrystal,
        uint128 expectedDeuterium
    ) private pure {
        (uint128 metal, uint128 crystal, uint128 deuterium) =
            VeydriftCatalog.buildingUpgradeCost(building, currentLevel);
        assertEq(metal, expectedMetal);
        assertEq(crystal, expectedCrystal);
        assertEq(deuterium, expectedDeuterium);
    }

    function _assertShip(
        Ship ship,
        uint128 expectedMetal,
        uint128 expectedCrystal,
        uint128 expectedDeuterium,
        uint256 expectedCargo
    ) private pure {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.shipCost(ship);
        assertEq(metal, expectedMetal);
        assertEq(crystal, expectedCrystal);
        assertEq(deuterium, expectedDeuterium);
        assertEq(VeydriftCatalog.shipCargoCapacity(ship), expectedCargo);
    }

    function _assertDefense(
        Defense defense,
        uint128 expectedMetal,
        uint128 expectedCrystal,
        uint128 expectedDeuterium
    ) private pure {
        (uint128 metal, uint128 crystal, uint128 deuterium) = VeydriftCatalog.defenseCost(defense);
        assertEq(metal, expectedMetal);
        assertEq(crystal, expectedCrystal);
        assertEq(deuterium, expectedDeuterium);
    }

    function _assertResearch(
        Technology technology,
        uint128 expectedMetal,
        uint128 expectedCrystal,
        uint128 expectedDeuterium
    ) private pure {
        (uint128 metal, uint128 crystal, uint128 deuterium) =
            VeydriftCatalog.researchBaseCost(technology);
        assertEq(metal, expectedMetal);
        assertEq(crystal, expectedCrystal);
        assertEq(deuterium, expectedDeuterium);
    }
}
