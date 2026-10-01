// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {VeydriftMoonSystemTestBase} from "./VeydriftMoonSystem.t.sol";
import {VeydriftGameStorage as G} from "../src/VeydriftGameStorage.sol";
import {VeydriftMoonDefenseBacklog} from "../src/libraries/VeydriftMoonDefenseBacklog.sol";
import {Defense, Ship, Technology, MoonBuilding} from "../src/libraries/VeydriftTypes.sol";

/// Real Game and Moon modules, real launch/protection/oracle/arrival paths, capped public resolves.
contract VeydriftStagedReviewRegressionTest is VeydriftMoonSystemTestBase {
    function _launch(uint256 origin, uint256 target, bool moonTarget) private returns (uint256) {
        G.MissionShips memory ships;
        ships.battleship = 1;
        vm.prank(player);
        return game.launchBodyFleetMission(
            origin,
            target,
            G.FleetMissionType.Attack,
            ships,
            G.Resources(0, 0, 0),
            100,
            false,
            moonTarget
        );
    }

    function _fixture() private returns (uint256 origin, uint256 target, address defender) {
        (origin, target, defender) = _seedMoonAttackPlanets();
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(defender, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(player, Technology.Computer, 4);
        _fundPlanet(origin, 1_000_000, 1_000_000, 1_000_000);
        _setShipCount(origin, Ship.Battleship, 4);
    }

    function _resolveCapped(uint256 id) private {
        (bool ok, bytes memory data) =
            address(game).call{gas: 15_000_000}(abi.encodeCall(game.resolveFleetMission, (id)));
        if (!ok) assembly ("memory-safe") { revert(add(data, 32), mload(data)) }
    }

    function _finishCapped(uint256 id) private {
        for (uint256 i; i < 2000; ++i) {
            (G.FleetMissionStatus status,,,) = _fleetMission(id);
            if (status != G.FleetMissionStatus.Outbound) return;
            _resolveCapped(id);
        }
        fail("battle failed to finish");
    }

    function testLaterPlanetBattleCannotCreditMoonDefensesPastEarlierMoonImpact() public {
        (uint256 origin, uint256 target, address defender) = _fixture();
        bytes32 outer = keccak256(abi.encode(target, uint256(7)));
        vm.store(
            address(moons),
            keccak256(abi.encode(uint256(uint8(MoonBuilding.Shipyard)), outer)),
            bytes32(uint256(1))
        );
        _fundMoon(target, 1_000_000, 1_000_000, 1_000_000);
        vm.prank(defender);
        moons.startMoonDefenseProduction(target, Defense.RocketLauncher, 4);
        VeydriftMoonDefenseBacklog.Entry memory queue = moons.activeMoonDefenseQueue(target);
        assertFalse(moons.activeMoonShipQueue(target).active, "must exercise absent ship queue");
        uint256 early = _launch(origin, target, true);
        uint256 late = _launch(origin, target, false);
        uint64 earlyAt = uint64(block.timestamp + 1);
        assertGt(queue.readyAt, earlyAt);
        _storeFleetMission(
            early,
            G.FleetMissionStatus.Outbound,
            G.FleetMissionType.Attack,
            player,
            origin,
            target,
            uint64(block.timestamp),
            earlyAt,
            queue.readyAt + 1000
        );
        _storeFleetMission(
            late,
            G.FleetMissionStatus.Outbound,
            G.FleetMissionType.Attack,
            player,
            origin,
            target,
            uint64(block.timestamp),
            queue.readyAt + 1,
            queue.readyAt + 1000
        );
        _fulfillAttackBattleRandomness(early, 659);
        _fulfillAttackBattleRandomness(late, 660);
        vm.warp(queue.readyAt + 2);
        _finishCapped(late);
        // View inventory can project wall time; the persistent queue must still be untouched.
        assertTrue(
            moons.activeMoonDefenseQueue(target).active, "planet battle settled sibling Moon queue"
        );
        assertEq(moons.activeMoonDefenseQueue(target).quantity, 4);
        vm.recordLogs();
        _finishCapped(early);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 snapshot =
            keccak256("CombatMemberSnapshot(uint256,uint256,address,uint8,uint8,uint32)");
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != snapshot || uint256(logs[i].topics[1]) != early) continue;
            (uint8 side, uint8 unit, uint32 count) =
                abi.decode(logs[i].data, (uint8, uint8, uint32));
            if (side == 1 && unit == 16) {
                assertEq(count, 0, "future Moon defenses contaminated early impact");
            }
        }
        assertTrue(moons.activeMoonDefenseQueue(target).active);
        assertEq(moons.activeMoonDefenseQueue(target).quantity, 4);
        assertEq(game.defenseCount(target, Defense.RocketLauncher), 0);
    }

    /// An unregistered legacy-origin battle does not block returns to its body. Ships credited
    /// after resident enrollment must survive casualty application instead of being overwritten.
    function testShipsCreditedMidBattleSurviveCasualtyApplication() public {
        (uint256 origin, uint256 target,) = _fixture();
        _setShipCount(target, Ship.LightFighter, 10);
        uint256 id = _launch(origin, target, false);
        (, uint64 arrivalAt,,) = _fleetMission(id);
        _fulfillAttackBattleRandomness(id, 661);
        vm.warp(arrivalAt);
        vm.recordLogs();
        for (uint256 i; i < 2000; ++i) {
            (uint8 phase,,) = game.stagedBattleProgress(id);
            if (phase >= 3 && phase != 14 && phase != 15) break;
            // Small calls commit only a few stages, so the battle stays mid-flight.
            game.resolveFleetMission{gas: 1_500_000}(id);
        }
        (uint8 enrolledPhase,,) = game.stagedBattleProgress(id);
        assertLt(enrolledPhase, 9, "inject before casualty application");
        _setShipCount(target, Ship.LightFighter, 15); // e.g. a registered return landed
        _finishCapped(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 lossTopic =
            keccak256("CombatMissionLosses(uint256,uint256,address,uint8,uint8,uint32)");
        uint256 lost;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != lossTopic || uint256(logs[i].topics[2]) != 0) continue;
            (uint8 side, uint8 unit, uint32 count) =
                abi.decode(logs[i].data, (uint8, uint8, uint32));
            if (side == 1 && unit == uint8(Ship.LightFighter)) lost += count;
        }
        assertGt(lost, 0, "fixture must destroy resident fighters");
        assertEq(game.shipCount(target, Ship.LightFighter), 15 - lost);
    }

    function testScoreProtectedBounceDoesNotWaitForOracle() public {
        (uint256 origin, uint256 target, address defender) = _fixture();
        uint256 id = _launch(origin, target, false);
        _setTechnologyLevel(defender, Technology.IntergalacticResearchNetwork, 0);
        (G.AttackBlockReason reason,,) = _attackBodyProtectionStatus(player, target, false);
        assertEq(uint8(reason), uint8(G.AttackBlockReason.ScoreProtection));
        _assertUnfulfilledBounce(id);
    }

    function testMissingMoonBounceDoesNotWaitForOracle() public {
        (uint256 origin, uint256 target,) = _fixture();
        uint256 id = _launch(origin, target, true);
        _destroyMoonGuaranteed(target);
        assertFalse(moons.moon(target).exists);
        _assertUnfulfilledBounce(id);
    }

    function _assertUnfulfilledBounce(uint256 id) private {
        (,,,,,,,,,, uint256 requestId) = game.fleetMission(id);
        assertEq(randomness.request(requestId).fulfilledAt, 0);
        (, uint64 arrivalAt, uint64 originalReturn,) = _fleetMission(id);
        vm.warp(arrivalAt);
        vm.recordLogs();
        _finishCapped(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 battle = keccak256(
            "AttackBattleResolved(uint256,address,uint256,uint8,uint8,uint256,uint128,uint128,uint128)"
        );
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != battle, "bounce fought battle");
        }
        (G.FleetMissionStatus status,, uint64 returnAt, G.Resources memory cargo) =
            _fleetMission(id);
        assertEq(uint8(status), uint8(G.FleetMissionStatus.Returning));
        assertEq(returnAt, originalReturn);
        assertEq(cargo.metal + cargo.crystal + cargo.deuterium, 0);
        assertEq(randomness.request(requestId).fulfilledAt, 0, "bounce required oracle fulfillment");
        (uint8 phase,,) = game.stagedBattleProgress(id);
        assertEq(phase, 13);
    }
}
