// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {Ship} from "../src/libraries/VeydriftTypes.sol";
import {
    VeydriftCombatReferenceSimulator as Reference
} from "./support/VeydriftCombatReferenceSimulator.sol";
import {VeydriftIndependentCohortMath as Math} from "./support/VeydriftIndependentCohortMath.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";

/// Conditional seeded evidence, not a guarantee that the numerically larger fleet wins.
contract VeydriftReaperShotReproTest is Test {
    // External frame releases allocation-heavy reference memory after each seed.
    // This changes only the reporting harness; production gas limits are untouched.
    function simulate(uint32 a, uint32 d, uint16[3] memory at, uint16[3] memory dt, uint256 seed)
        external
        pure
        returns (Reference.BattleResult memory)
    {
        // Reaper-only battle: no rapidfire against own type, no defenses, no
        // coalition attribution. Bounded one-cohort simulation avoids constructing
        // 72 unused owner/type slots per round merely to produce this report.
        Math.Cohort memory attacker = reaper(a, at);
        Math.Cohort memory defender = reaper(d, dt);
        Reference.BattleResult memory result;
        for (uint8 round = 1; round <= 6 && attacker.count != 0 && defender.count != 0; ++round) {
            uint256 aLost = Math.destroyed(
                attacker,
                defender.count,
                defender.attack,
                Math.Context(seed, round, 1),
                defender.key
            );
            uint256 dLost = Math.destroyed(
                defender,
                attacker.count,
                attacker.attack,
                Math.Context(seed, round, 4),
                attacker.key
            );
            attacker.count -= aLost;
            defender.count -= dLost;
            result.rounds = round;
        }
        result.attackerShips[uint8(Ship.Reaper)] = uint32(attacker.count);
        result.defenderShips[uint8(Ship.Reaper)] = uint32(defender.count);
        result.outcome = attacker.count != 0 && defender.count == 0
            ? VeydriftGameStorage.BattleOutcome.AttackerWin
            : attacker.count == 0 && defender.count != 0
                ? VeydriftGameStorage.BattleOutcome.DefenderWin
                : VeydriftGameStorage.BattleOutcome.Draw;
        return result;
    }

    function reaper(uint256 n, uint16[3] memory tech) private pure returns (Math.Cohort memory c) {
        c.unit = uint8(Ship.Reaper);
        c.count = n;
        c.attack = VeydriftCatalog.shipBattleAttack(Ship.Reaper) * (10 + uint256(tech[0])) / 10;
        c.shield = VeydriftCatalog.shipBattleShield(Ship.Reaper) * (10 + uint256(tech[1])) / 10;
        c.hull = VeydriftCatalog.shipBattleHull(Ship.Reaper) * (10 + uint256(tech[2])) / 10;
        c.key = uint256(keccak256(abi.encode(c.unit, c.attack, c.shield, c.hull)));
    }

    function testSpecializedReaperMatchesFullReferenceFixture() public {
        assertLe(VeydriftCatalog.shipRapidfireAgainstShip(Ship.Reaper, Ship.Reaper), 1);
        for (uint256 seed = 1; seed <= 8; ++seed) {
            Reference.BattleInput memory input;
            input.seed = seed;
            input.attackerShips[uint8(Ship.Reaper)] = 100;
            input.defenderShips[uint8(Ship.Reaper)] = 99;
            input.attackerTech = Reference.CombatTech(10, 8, 12);
            input.defenderTech = Reference.CombatTech(8, 12, 9);
            Reference.BattleResult memory full = Reference.run(input);
            Reference.BattleResult memory small =
                this.simulate(100, 99, [uint16(10), 8, 12], [uint16(8), 12, 9], seed);
            assertEq(
                small.attackerShips[uint8(Ship.Reaper)], full.attackerShips[uint8(Ship.Reaper)]
            );
            assertEq(
                small.defenderShips[uint8(Ship.Reaper)], full.defenderShips[uint8(Ship.Reaper)]
            );
            assertEq(uint8(small.outcome), uint8(full.outcome));
            assertEq(small.rounds, full.rounds);
        }
    }

    function caseResult(uint32 a, uint32 d, uint16[3] memory at, uint16[3] memory dt) private {
        uint256[3] memory outcomes; // attacker win, defender win, draw
        uint256 minA = type(uint256).max;
        uint256 maxA;
        uint256 minD = type(uint256).max;
        uint256 maxD;
        for (uint256 seed = 1; seed <= 256; ++seed) {
            Reference.BattleResult memory result = this.simulate(a, d, at, dt, seed);
            uint256 leftA = result.attackerShips[uint8(Ship.Reaper)];
            uint256 leftD = result.defenderShips[uint8(Ship.Reaper)];
            assertLe(leftA, a);
            assertLe(leftD, d);
            assertLe(result.rounds, 6);
            if (result.outcome == VeydriftGameStorage.BattleOutcome.AttackerWin) ++outcomes[0];
            else if (result.outcome == VeydriftGameStorage.BattleOutcome.DefenderWin) ++outcomes[1];
            else ++outcomes[2];
            if (leftA < minA) minA = leftA;
            if (leftA > maxA) maxA = leftA;
            if (leftD < minD) minD = leftD;
            if (leftD > maxD) maxD = leftD;
        }
        assertEq(outcomes[0] + outcomes[1] + outcomes[2], 256);
        emit log_named_uint("attacker initial", a);
        emit log_named_uint("defender initial", d);
        emit log_named_uint("attacker wins", outcomes[0]);
        emit log_named_uint("defender wins", outcomes[1]);
        emit log_named_uint("draws", outcomes[2]);
        emit log_named_uint("attacker survivors minimum", minA);
        emit log_named_uint("attacker survivors maximum", maxA);
        emit log_named_uint("defender survivors minimum", minD);
        emit log_named_uint("defender survivors maximum", maxD);
    }

    function testReaperEqualZero_100v99_Seeds1Through256() public {
        caseResult(100, 99, [uint16(0), 0, 0], [uint16(0), 0, 0]);
    }

    function testReaperEqualZero_99v100_Seeds1Through256() public {
        caseResult(99, 100, [uint16(0), 0, 0], [uint16(0), 0, 0]);
    }

    function testReaperEqualZero_100v100_Seeds1Through256() public {
        caseResult(100, 100, [uint16(0), 0, 0], [uint16(0), 0, 0]);
    }

    function testReaperEqualZero_100v98_Seeds1Through256() public {
        caseResult(100, 98, [uint16(0), 0, 0], [uint16(0), 0, 0]);
    }

    function testReaperEqualZero_100v101_Seeds1Through256() public {
        caseResult(100, 101, [uint16(0), 0, 0], [uint16(0), 0, 0]);
    }

    function testReaperEqualTen_100v99_Seeds1Through256() public {
        caseResult(100, 99, [uint16(10), 10, 10], [uint16(10), 10, 10]);
    }

    function testReaperEqualTen_99v100_Seeds1Through256() public {
        caseResult(99, 100, [uint16(10), 10, 10], [uint16(10), 10, 10]);
    }

    function testReaperEqualTen_100v100_Seeds1Through256() public {
        caseResult(100, 100, [uint16(10), 10, 10], [uint16(10), 10, 10]);
    }

    function testReaperEqualTen_100v98_Seeds1Through256() public {
        caseResult(100, 98, [uint16(10), 10, 10], [uint16(10), 10, 10]);
    }

    function testReaperEqualTen_100v101_Seeds1Through256() public {
        caseResult(100, 101, [uint16(10), 10, 10], [uint16(10), 10, 10]);
    }

    function testReaperUnequalWSA_100v99_Seeds1Through256() public {
        caseResult(100, 99, [uint16(10), 8, 12], [uint16(8), 12, 9]);
    }

    function testReaperUnequalWSA_99v100_Seeds1Through256() public {
        caseResult(99, 100, [uint16(10), 8, 12], [uint16(8), 12, 9]);
    }

    function testReaperUnequalWSA_100v100_Seeds1Through256() public {
        caseResult(100, 100, [uint16(10), 8, 12], [uint16(8), 12, 9]);
    }

    function testReaperUnequalWSA_100v98_Seeds1Through256() public {
        caseResult(100, 98, [uint16(10), 8, 12], [uint16(8), 12, 9]);
    }

    function testReaperUnequalWSA_100v101_Seeds1Through256() public {
        caseResult(100, 101, [uint16(10), 8, 12], [uint16(8), 12, 9]);
    }

    function testReaperUnequalWSAReversed_100v99_Seeds1Through256() public {
        caseResult(100, 99, [uint16(8), 12, 9], [uint16(10), 8, 12]);
    }

    function testReaperUnequalWSAReversed_99v100_Seeds1Through256() public {
        caseResult(99, 100, [uint16(8), 12, 9], [uint16(10), 8, 12]);
    }

    function testReaperUnequalWSAReversed_100v100_Seeds1Through256() public {
        caseResult(100, 100, [uint16(8), 12, 9], [uint16(10), 8, 12]);
    }

    function testReaperUnequalWSAReversed_100v98_Seeds1Through256() public {
        caseResult(100, 98, [uint16(8), 12, 9], [uint16(10), 8, 12]);
    }

    function testReaperUnequalWSAReversed_100v101_Seeds1Through256() public {
        caseResult(100, 101, [uint16(8), 12, 9], [uint16(10), 8, 12]);
    }

    function testReaperAttackerTenDefenderZero_100v99_Seeds1Through256() public {
        caseResult(100, 99, [uint16(10), 10, 10], [uint16(0), 0, 0]);
    }

    function testReaperAttackerTenDefenderZero_99v100_Seeds1Through256() public {
        caseResult(99, 100, [uint16(10), 10, 10], [uint16(0), 0, 0]);
    }

    function testReaperAttackerTenDefenderZero_100v100_Seeds1Through256() public {
        caseResult(100, 100, [uint16(10), 10, 10], [uint16(0), 0, 0]);
    }

    function testReaperAttackerTenDefenderZero_100v98_Seeds1Through256() public {
        caseResult(100, 98, [uint16(10), 10, 10], [uint16(0), 0, 0]);
    }

    function testReaperAttackerTenDefenderZero_100v101_Seeds1Through256() public {
        caseResult(100, 101, [uint16(10), 10, 10], [uint16(0), 0, 0]);
    }

    function testReaperAttackerZeroDefenderTen_100v99_Seeds1Through256() public {
        caseResult(100, 99, [uint16(0), 0, 0], [uint16(10), 10, 10]);
    }

    function testReaperAttackerZeroDefenderTen_99v100_Seeds1Through256() public {
        caseResult(99, 100, [uint16(0), 0, 0], [uint16(10), 10, 10]);
    }

    function testReaperAttackerZeroDefenderTen_100v100_Seeds1Through256() public {
        caseResult(100, 100, [uint16(0), 0, 0], [uint16(10), 10, 10]);
    }

    function testReaperAttackerZeroDefenderTen_100v98_Seeds1Through256() public {
        caseResult(100, 98, [uint16(0), 0, 0], [uint16(10), 10, 10]);
    }

    function testReaperAttackerZeroDefenderTen_100v101_Seeds1Through256() public {
        caseResult(100, 101, [uint16(0), 0, 0], [uint16(10), 10, 10]);
    }
}
