// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {VeydriftFormulas} from "../src/libraries/VeydriftFormulas.sol";
import {Building} from "../src/libraries/VeydriftTypes.sol";

contract VeydriftOGameFormulaConformanceTest is Test {
    uint16 internal constant BPS = 10_000;
    uint32 internal constant MIN_QUEUE_SECONDS = 60;

    function testVanillaOGameMineProductionAndEnergy() public pure {
        (uint256 produced, uint256 required, uint256 scaleBps) =
            VeydriftFormulas.energyBalance(3, 3, 2, 6, BPS);
        assertEq(produced, 212);
        assertEq(required, 126);
        assertEq(scaleBps, BPS);

        (uint256 metal, uint256 crystal, uint256 deuterium) =
            VeydriftFormulas.productionPerHour(5, 4, 3, 12, 10_000, 10_000, 13_040, BPS);
        assertEq(metal, 241);
        assertEq(crystal, 117);
        assertEq(deuterium, 50);

        (metal, crystal, deuterium) =
            VeydriftFormulas.productionPerHour(5, 4, 3, 0, 10_000, 10_000, 13_040, BPS);
        assertEq(metal, 0);
        assertEq(crystal, 0);
        assertEq(deuterium, 0);
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
        _assertBuildingCost(Building.RoboticsFactory, 1, 800, 240, 400);
        _assertBuildingCost(Building.MetalStorage, 10, 1_024_000, 0, 0);
    }

    function testVanillaOGameDurations() public pure {
        assertEq(VeydriftFormulas.buildingDuration(0, 6_000, 0, MIN_QUEUE_SECONDS), 8_640);
        assertEq(VeydriftFormulas.buildingDuration(1, 6_000, 0, MIN_QUEUE_SECONDS), 4_320);
        assertEq(
            VeydriftFormulas.researchDuration(0, 12_000, 12_000, 50_000, MIN_QUEUE_SECONDS), 86_400
        );
        assertEq(
            VeydriftFormulas.researchDuration(1, 12_000, 12_000, 50_000, MIN_QUEUE_SECONDS), 43_200
        );
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
}
