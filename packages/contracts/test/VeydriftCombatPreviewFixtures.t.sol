// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Defense, Ship} from "../src/libraries/VeydriftTypes.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftCombatReferenceSimulator} from "./support/VeydriftCombatReferenceSimulator.sol";

/// @notice Fixed combat vectors consumed by the TypeScript preview parity suite.
/// @dev The separate VeydriftCombatReferenceParityTest proves this reference implementation against
///      the real deployed-module execution path. These named vectors pin the frontend-facing values.
contract VeydriftCombatPreviewFixturesTest is Test {
    function testPreviewFixtureTechnologyDisparity() public pure {
        VeydriftCombatReferenceSimulator.BattleInput memory fixture;
        fixture.seed = 5;
        fixture.attackerShips[uint8(Ship.Destroyer)] = 40;
        fixture.defenderShips[uint8(Ship.LightFighter)] = 40;
        fixture.attackerTech =
            VeydriftCombatReferenceSimulator.CombatTech({weapons: 3, shielding: 2, armor: 4});
        fixture.defenderTech =
            VeydriftCombatReferenceSimulator.CombatTech({weapons: 1, shielding: 5, armor: 2});
        VeydriftCombatReferenceSimulator.BattleResult memory result =
            VeydriftCombatReferenceSimulator.run(fixture);
        assertEq(uint8(result.outcome), uint8(VeydriftGameStorage.BattleOutcome.AttackerWin));
        assertEq(result.rounds, 1);
        assertEq(result.attackerShips[uint8(Ship.Destroyer)], 40);
        assertEq(result.defenderShips[uint8(Ship.LightFighter)], 0);
        _assertResources(result.attackerLosses, 0, 0, 0);
        _assertResources(result.defenderLosses, 120_000, 40_000, 0);
    }

    function testPreviewFixtureShieldGate() public pure {
        VeydriftCombatReferenceSimulator.BattleInput memory fixture;
        fixture.seed = 780;
        fixture.attackerShips[uint8(Ship.SmallCargo)] = 1;
        fixture.defenderDefenses[uint8(Defense.LargeShieldDome)] = 10;

        VeydriftCombatReferenceSimulator.BattleResult memory result =
            VeydriftCombatReferenceSimulator.run(fixture);
        assertEq(uint8(result.outcome), uint8(VeydriftGameStorage.BattleOutcome.Draw));
        assertEq(result.rounds, 6);
        assertEq(result.attackerShips[uint8(Ship.SmallCargo)], 1);
        assertEq(result.defenderDefenses[uint8(Defense.LargeShieldDome)], 10);
        _assertResources(result.attackerLosses, 0, 0, 0);
        _assertResources(result.defenderLosses, 0, 0, 0);
    }

    function testPreviewFixtureHullExplosionRandomPair() public pure {
        VeydriftCombatReferenceSimulator.BattleInput memory fixture;
        fixture.attackerShips[uint8(Ship.SmallCargo)] = 1;
        fixture.defenderShips[uint8(Ship.SmallCargo)] = 27;

        fixture.seed = 1;
        VeydriftCombatReferenceSimulator.BattleResult memory stable =
            VeydriftCombatReferenceSimulator.run(fixture);
        assertEq(uint8(stable.outcome), uint8(VeydriftGameStorage.BattleOutcome.Draw));
        assertEq(stable.rounds, 6);
        assertEq(stable.attackerShips[uint8(Ship.SmallCargo)], 1);
        _assertResources(stable.attackerLosses, 0, 0, 0);

        fixture.seed = 2;
        VeydriftCombatReferenceSimulator.BattleResult memory exploded =
            VeydriftCombatReferenceSimulator.run(fixture);
        assertEq(uint8(exploded.outcome), uint8(VeydriftGameStorage.BattleOutcome.DefenderWin));
        assertEq(exploded.rounds, 3);
        assertEq(exploded.attackerShips[uint8(Ship.SmallCargo)], 0);
        _assertResources(exploded.attackerLosses, 2_000, 2_000, 0);
    }

    function testPreviewFixtureRapidfireHeavy() public pure {
        VeydriftCombatReferenceSimulator.BattleInput memory fixture;
        fixture.seed = 101;
        fixture.attackerShips[uint8(Ship.Cruiser)] = 1;
        fixture.defenderDefenses[uint8(Defense.RocketLauncher)] = 50;

        VeydriftCombatReferenceSimulator.BattleResult memory result =
            VeydriftCombatReferenceSimulator.run(fixture);
        assertEq(uint8(result.outcome), uint8(VeydriftGameStorage.BattleOutcome.DefenderWin));
        assertEq(result.rounds, 1);
        assertEq(result.attackerShips[uint8(Ship.Cruiser)], 0);
        assertEq(result.defenderDefenses[uint8(Defense.RocketLauncher)], 49);
        _assertResources(result.attackerLosses, 20_000, 7_000, 2_000);
    }

    function testPreviewFixtureMixedShipsAndDefenses() public pure {
        VeydriftCombatReferenceSimulator.BattleInput memory fixture;
        fixture.seed = 404;
        fixture.attackerShips[uint8(Ship.Cruiser)] = 1;
        fixture.defenderShips[uint8(Ship.LightFighter)] = 10;
        fixture.defenderDefenses[uint8(Defense.RocketLauncher)] = 50;

        VeydriftCombatReferenceSimulator.BattleResult memory result =
            VeydriftCombatReferenceSimulator.run(fixture);
        assertEq(uint8(result.outcome), uint8(VeydriftGameStorage.BattleOutcome.DefenderWin));
        assertEq(result.rounds, 1);
        assertEq(result.attackerShips[uint8(Ship.Cruiser)], 0);
        assertEq(result.defenderShips[uint8(Ship.LightFighter)], 4);
        assertEq(result.defenderDefenses[uint8(Defense.RocketLauncher)], 40);
        _assertResources(result.attackerLosses, 20_000, 7_000, 2_000);
        _assertResources(result.defenderLosses, 18_000, 6_000, 0);
    }

    function testPreviewFixtureJoinedAttacker() public pure {
        VeydriftCombatReferenceSimulator.BattleInput memory fixture;
        fixture.seed = 104;
        fixture.attackerShips[uint8(Ship.Battleship)] = 1_000;
        fixture.joinedAttackerShips[uint8(Ship.Battleship)] = 1_000;
        fixture.defenderDefenses[uint8(Defense.RocketLauncher)] = 500;

        VeydriftCombatReferenceSimulator.BattleResult memory result =
            VeydriftCombatReferenceSimulator.run(fixture);
        assertEq(uint8(result.outcome), uint8(VeydriftGameStorage.BattleOutcome.AttackerWin));
        assertEq(result.rounds, 1);
        assertEq(result.attackerShips[uint8(Ship.Battleship)], 1_000);
        assertEq(result.joinedAttackerShips[uint8(Ship.Battleship)], 1_000);
        // Outcome is decided before the contract's ordinary-defense repair pass.
        assertEq(result.defenderDefenses[uint8(Defense.RocketLauncher)], 350);
        _assertResources(result.attackerLosses, 0, 0, 0);
    }

    function testPreviewFixtureCounterplayUsesItsOwnersTechnology() public pure {
        VeydriftCombatReferenceSimulator.BattleInput memory fixture;
        fixture.seed = 17;
        fixture.attackerShips[uint8(Ship.SmallCargo)] = 1;
        fixture.counterplayShips[uint8(Ship.SmallCargo)] = 14;

        VeydriftCombatReferenceSimulator.BattleResult memory zeroTech =
            VeydriftCombatReferenceSimulator.run(fixture);
        assertEq(uint8(zeroTech.outcome), uint8(VeydriftGameStorage.BattleOutcome.Draw));
        assertEq(zeroTech.attackerShips[uint8(Ship.SmallCargo)], 1);

        fixture.counterplayTech =
            VeydriftCombatReferenceSimulator.CombatTech({weapons: 10, shielding: 10, armor: 10});
        VeydriftCombatReferenceSimulator.BattleResult memory ownerTech =
            VeydriftCombatReferenceSimulator.run(fixture);
        assertEq(uint8(ownerTech.outcome), uint8(VeydriftGameStorage.BattleOutcome.DefenderWin));
        assertEq(ownerTech.attackerShips[uint8(Ship.SmallCargo)], 0);
        assertEq(ownerTech.counterplayShips[uint8(Ship.SmallCargo)], 14);
        _assertResources(ownerTech.attackerLosses, 2_000, 2_000, 0);
    }

    function _assertResources(
        VeydriftGameStorage.Resources memory resources,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    ) private pure {
        assertEq(resources.metal, metal);
        assertEq(resources.crystal, crystal);
        assertEq(resources.deuterium, deuterium);
    }
}
