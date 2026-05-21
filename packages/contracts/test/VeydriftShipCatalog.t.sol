// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {VeydriftDependencies} from "../src/libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "../src/libraries/VeydriftFormulas.sol";
import {Ship} from "../src/libraries/VeydriftTypes.sol";

contract VeydriftShipCatalogTest is Test {
    bytes32 private constant DEP_SHIPYARD_2 = "SHIPYARD_2";
    bytes32 private constant DEP_ION_2 = "ION_2";
    bytes32 private constant DEP_HYPERSPACE_5 = "HYPERSPACE_5";
    bytes32 private constant DEP_GRAVITON_1 = "GRAVITON_1";

    function testVanillaOGameRepresentativeShipCostsAndCargo() public pure {
        _assertShip(Ship.SmallCargo, 2_000, 2_000, 0, 5_000);
        _assertShip(Ship.LightFighter, 3_000, 1_000, 0, 50);
        _assertShip(Ship.Cruiser, 20_000, 7_000, 2_000, 800);
        _assertShip(Ship.Battleship, 45_000, 15_000, 0, 1_500);
        _assertShip(Ship.Destroyer, 60_000, 50_000, 15_000, 2_000);
        _assertShip(Ship.Deathstar, 5_000_000, 4_000_000, 1_000_000, 1_000_000);
        _assertShip(Ship.Reaper, 85_000, 55_000, 20_000, 7_000);
        _assertShip(Ship.Pathfinder, 8_000, 15_000, 8_000, 12_000);
    }

    function testVanillaOGameRepresentativeShipRequirements() public {
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftDependencies.MissingDependency.selector, DEP_SHIPYARD_2)
        );
        _requireShip(Ship.SmallCargo, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        _requireShip(Ship.SmallCargo, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftDependencies.MissingDependency.selector, DEP_ION_2)
        );
        _requireShip(Ship.Cruiser, 5, 0, 0, 4, 0, 0, 0, 0, 1, 0, 0, 0);
        _requireShip(Ship.Cruiser, 5, 0, 0, 4, 0, 0, 0, 0, 2, 0, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftDependencies.MissingDependency.selector, DEP_HYPERSPACE_5
            )
        );
        _requireShip(Ship.Destroyer, 9, 0, 0, 0, 6, 4, 0, 0, 0, 0, 0, 0);
        _requireShip(Ship.Destroyer, 9, 0, 0, 0, 6, 5, 0, 0, 0, 0, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftDependencies.MissingDependency.selector, DEP_GRAVITON_1)
        );
        _requireShip(Ship.Deathstar, 12, 0, 0, 0, 7, 6, 0, 0, 0, 0, 0, 0);
        _requireShip(Ship.Deathstar, 12, 0, 0, 0, 7, 6, 1, 0, 0, 0, 0, 0);
    }

    function testShipDurationUsesOGameShipyardAndNaniteFormula() public pure {
        assertEq(VeydriftFormulas.unitDuration(2, 0, 2_000, 2_000, 0, 1, 60), 1_920);
        assertEq(VeydriftFormulas.unitDuration(7, 0, 45_000, 15_000, 0, 1, 60), 10_800);
        assertEq(VeydriftFormulas.unitDuration(7, 2, 45_000, 15_000, 0, 1, 60), 2_700);
        assertEq(
            VeydriftFormulas.unitDuration(12, 0, 5_000_000, 4_000_000, 1_000_000, 1, 60), 996_924
        );
    }

    function _assertShip(
        Ship ship,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium,
        uint256 cargo
    ) private pure {
        (uint128 actualMetal, uint128 actualCrystal, uint128 actualDeuterium) =
            VeydriftCatalog.shipCost(ship);
        assertEq(actualMetal, metal);
        assertEq(actualCrystal, crystal);
        assertEq(actualDeuterium, deuterium);
        assertEq(VeydriftCatalog.shipCargoCapacity(ship), cargo);
    }

    function _requireShip(
        Ship ship,
        uint16 shipyard,
        uint16 espionage,
        uint16 combustion,
        uint16 impulse,
        uint16 hyperspaceDrive,
        uint16 hyperspace,
        uint16 graviton,
        uint16 laser,
        uint16 ion,
        uint16 shielding,
        uint16 armor,
        uint16 plasma
    ) private pure {
        VeydriftDependencies.requireShip(
            ship,
            shipyard,
            espionage,
            combustion,
            impulse,
            hyperspaceDrive,
            hyperspace,
            graviton,
            laser,
            ion,
            shielding,
            armor,
            plasma
        );
    }
}
