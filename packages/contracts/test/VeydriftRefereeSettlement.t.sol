// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Vm} from "forge-std/Vm.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {ProductionBatchTransactionProbe} from "./ProductionBatchTransactionProbe.sol";
import {VeydriftMoonSystemTestBase} from "./VeydriftMoonSystem.t.sol";
import {VeydriftGameStorage as G} from "../src/VeydriftGameStorage.sol";
import {VeydriftRefereeBattle as P} from "../src/libraries/VeydriftRefereeBattle.sol";
import {VeydriftRefereeSettlement as S} from "../src/libraries/VeydriftRefereeSettlement.sol";
import {
    VeydriftRefereeSettlementModule as Application
} from "../src/VeydriftRefereeSettlementModule.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";

import {RefereeSettlementHarness as H} from "./support/RefereeSettlementHarness.sol";
import {IRefereeGame, refereeRounds} from "./support/IRefereeGame.sol";
import {Ship, Defense, Technology, Building} from "../src/libraries/VeydriftTypes.sol";

contract VeydriftRefereeSettlementTest is VeydriftMoonSystemTestBase {
    address constant RESOLVER = address(0xBA771E);
    bytes32 constant REPORT = keccak256("report");
    bytes private gameCode;
    bool private moonFixture;
    bool private holdFixture;
    bool private cargoJoinFixture;
    bool private zeroJoinFixture;
    address private harness;

    function _inject(bytes memory data) private returns (bytes memory result) {
        if (harness == address(0)) {
            harness = address(new H());
            gameCode = address(game).code;
        }
        vm.etch(address(game), harness.code);
        (bool ok, bytes memory out) = address(game).call(data);
        vm.etch(address(game), gameCode);
        if (!ok) assembly ("memory-safe") { revert(add(out, 32), mload(out)) }
        return out;
    }

    function _fixture() private returns (uint256 id, uint256 target) {
        return _fixtureMany(0);
    }

    function _fixtureMany(uint256 joined) private returns (uint256 id, uint256 target) {
        game = VeydriftGame(
            payable(address(
                    new ERC1967Proxy(
                        address(game), abi.encodeCall(VeydriftGame.initialize, (admin))
                    )
                ))
        );
        moons = new VeydriftMoonSystem(address(game), address(randomness));
        metalToken.mint(address(game), RESERVE_FUNDING);
        crystalToken.mint(address(game), RESERVE_FUNDING);
        deuteriumToken.mint(address(game), RESERVE_FUNDING);
        vm.startPrank(admin);
        game.setResourceTokens(address(metalToken), address(crystalToken), address(deuteriumToken));
        game.setMoonSystem(address(moons));
        game.setRandomnessEngine(address(randomness));
        randomness.setRequesterAuthorization(address(game), true);
        randomness.setRequesterAuthorization(address(moons), true);
        vm.stopPrank();
        (uint256 origin, uint256 t, address defender) = _seedMoonAttackPlanets();
        target = t;
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(defender, Technology.IntergalacticResearchNetwork, 3000);
        _fundPlanet(origin, 1_000_000, 1_000_000, 1_000_000);
        _setShipCount(origin, Ship.Battleship, 100);
        if (cargoJoinFixture) _setShipCount(origin, Ship.SmallCargo, 100);
        _setTechnologyLevel(player, Technology.Computer, 100);
        _setShipCount(target, Ship.LightFighter, 7);
        if (moonFixture) {
            _setMoonShipCount(target, Ship.LightFighter, 7);
            _setMoonDefenseCount(target, Defense.RocketLauncher, 10);
            _fundMoon(target, 100_000, 200_000, 300_000);
        }
        vm.prank(admin);
        IRefereeGame(address(game))
            .configureBattleReferee(
                P.Version(3, keccak256("candidate-2"), keccak256("catalog-fixture")), RESOLVER
            );
        bytes32 commitment = randomness.randomnessCommitment(1234);
        vm.prank(fulfiller);
        randomness.commitRandomness(commitment);
        vm.roll(block.number + 1);
        G.MissionShips memory ships;
        ships.battleship = 2;
        vm.prank(player);
        id = game.launchBodyFleetMission(
            origin,
            target,
            G.FleetMissionType.Attack,
            ships,
            G.Resources(0, 0, 0),
            cargoJoinFixture ? 20 : 100,
            false,
            moonFixture
        );
        if (cargoJoinFixture) {
            ships.battleship = 0;
            ships.smallCargo = 2;
        }
        for (uint256 i; i < joined; ++i) {
            vm.prank(player);
            uint256 joinedId =
                game.joinAttackMission(origin, id, target, ships, G.Resources(0, 0, 0));
            if (zeroJoinFixture) {
                // Model a source emptied before authoritative enrollment, not a post-proof loss.
                _inject(abi.encodeCall(H.missionCount, (joinedId, Ship.Battleship, uint32(0))));
                _inject(abi.encodeCall(H.creditCargo, (joinedId)));
            }
        }
        (, uint64 arrival,,) = _fleetMission(id);
        if (holdFixture) {
            _inject(abi.encodeCall(H.seedHeld, (id, uint256(100), target, defender, arrival)));
            _inject(abi.encodeCall(H.seedHeld, (id, uint256(101), target, defender, arrival)));
        }
        vm.warp(arrival);
        for (uint256 i; i < 100; ++i) {
            (uint8 phase,,) = game.stagedBattleProgress(id);
            if (phase == 16) break;
            game.resolveFleetMission{gas: 15_000_000}(id);
        }
        _fulfillAttackBattleRandomness(id, 1234);
        game.resolveFleetMission{gas: 15_000_000}(id);
        (uint8 pendingPhase,,) = game.stagedBattleProgress(id);
        assertEq(pendingPhase, 17);
    }

    /// Row-ordered leaves with the given losses; `next` links are filled by _commitResult.
    function _rowLeaves(uint256 id, uint32[] memory lost)
        private
        view
        returns (S.Leaf[] memory leaves)
    {
        leaves = new S.Leaf[](lost.length);
        for (uint256 i; i < lost.length; ++i) {
            P.Row memory row =
                abi.decode(IRefereeGame(address(game)).refereeBattleRecord(id, 2, i), (P.Row));
            leaves[i] = S.Leaf(
                row.owner,
                row.source,
                row.side,
                row.unit,
                row.count,
                lost[i],
                row.count - lost[i],
                0
            );
        }
    }

    function _link(uint256 id, S.Leaf[] memory leaves)
        private
        returns (bytes32 root, uint256[2] memory totals)
    {
        bytes32 binding = abi.decode(_inject(abi.encodeCall(H.binding, (id))), (bytes32));
        root = keccak256(
            abi.encode(keccak256("veydrift.referee-battle.result-tail.v1"), binding, leaves.length)
        );
        for (uint256 n = leaves.length; n > 0; --n) {
            leaves[n - 1].next = root;
            root = _node(binding, n - 1, leaves[n - 1]);
            totals[leaves[n - 1].side] += leaves[n - 1].survivors;
        }
    }

    function _commitResult(uint256 id, S.Leaf[] memory leaves) private {
        (bytes32 root, uint256[2] memory totals) = _link(id, leaves);
        vm.prank(RESOLVER);
        IRefereeGame(address(game))
            .submitBattleResult(id, root, totals, REPORT, refereeRounds(1, totals));
    }

    /// Row 0 is the resident defender lane and row 1 the attacking leader.
    function _leaves(uint256 id, uint32 attackerLost, uint32 defenderLost)
        private
        returns (S.Leaf[] memory leaves)
    {
        uint32[] memory lost = new uint32[](2);
        lost[0] = defenderLost;
        lost[1] = attackerLost;
        leaves = _rowLeaves(id, lost);
        _commitResult(id, leaves);
    }

    function _node(bytes32 binding, uint256 index, S.Leaf memory leaf)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                keccak256("veydrift.referee-battle.result-leaf.v1"),
                binding,
                index,
                leaf.owner,
                leaf.source,
                leaf.side,
                leaf.unit,
                leaf.enrolledCount,
                leaf.lost,
                leaf.survivors,
                leaf.next
            )
        );
    }

    function _one(S.Leaf memory leaf) private pure returns (S.Leaf[] memory a) {
        a = new S.Leaf[](1);
        a[0] = leaf;
    }

    function _finish(uint256 id) private {
        for (uint256 i; i < 100; ++i) {
            (uint8 p,,) = game.stagedBattleProgress(id);
            if (p == 13) return;
            game.resolveFleetMission{gas: 15_000_000}(id);
        }
        fail("economics not terminal");
    }

    function testDeltaPreservesNewCreditsAndZeroLossCoverageAndIdempotence() public {
        (uint256 id, uint256 target) = _fixture();
        S.Leaf[] memory leaves = _leaves(id, 0, 7);
        _setShipCount(target, Ship.LightFighter, 12);
        _inject(abi.encodeCall(H.missionCount, (id, Ship.Battleship, 5)));
        Application app = Application(address(game));
        vm.prank(address(0xCAFE));
        app.applyBattleResultLeaves(id, _one(leaves[0]));
        (S.Phase p, uint256 cursor,,) = app.battleResultProgress(id);
        assertEq(uint8(p), 1);
        assertEq(cursor, 1);
        (uint8 stage,,) = game.stagedBattleProgress(id);
        assertEq(stage, 17);
        assertEq(abi.decode(_inject(abi.encodeCall(H.locked, (target))), (uint256)), id);
        vm.expectRevert(S.InvalidOutput.selector);
        app.applyBattleResultLeaves(id, _one(leaves[0]));
        app.applyBattleResultLeaves(id, _one(leaves[1]));
        assertEq(game.shipCount(target, Ship.LightFighter), 5);
        G.MissionShips memory ships =
            abi.decode(_inject(abi.encodeCall(H.ships, (id))), (G.MissionShips));
        assertEq(ships.battleship, 5);
        _finish(id);
        assertEq(abi.decode(_inject(abi.encodeCall(H.locked, (target))), (uint256)), 0);
        (G.FleetMissionStatus status,,,) = _fleetMission(id);
        assertEq(uint8(status), uint8(G.FleetMissionStatus.Returning));
        vm.expectRevert(S.InvalidOutput.selector);
        app.applyBattleResultLeaves(id, leaves);
        game.resolveFleetMission(id);
        assertEq(game.shipCount(target, Ship.LightFighter), 5);
    }

    function testChangedLeafRollsBackAndDriftedInventoryFloorsInsteadOfDeadlocking() public {
        (uint256 id, uint256 target) = _fixture();
        S.Leaf[] memory leaves = _leaves(id, 1, 7);
        Application app = Application(address(game));
        bytes32 originalNext = leaves[0].next;
        S.Leaf[] memory bad = _one(leaves[0]);
        bad[0].next = bytes32(uint256(9));
        vm.expectRevert(S.InvalidOutput.selector);
        app.applyBattleResultLeaves(id, bad);
        (, uint256 cursor,,) = app.battleResultProgress(id);
        assertEq(cursor, 0);
        leaves[0].next = originalNext;
        // Live inventory below the journaled loss floors at zero, like staged combat; a drifted
        // lane can never deadlock the battle.
        _setShipCount(target, Ship.LightFighter, 6);
        _inject(abi.encodeCall(H.missionCount, (id, Ship.Battleship, 0)));
        app.applyBattleResultLeaves(id, leaves);
        assertEq(game.shipCount(target, Ship.LightFighter), 0);
        G.MissionShips memory ships =
            abi.decode(_inject(abi.encodeCall(H.ships, (id))), (G.MissionShips));
        assertEq(ships.battleship, 0);
        _finish(id);
    }

    function testUnacceptedApplicationAndNonResolverSubmissionRemainClosed() public {
        (uint256 id,) = _fixture();
        vm.expectRevert(S.InvalidOutput.selector);
        Application(address(game)).applyBattleResultLeaves(id, new S.Leaf[](0));
        uint256[2] memory totals;
        vm.expectRevert(abi.encodeWithSelector(G.Unauthorized.selector, player));
        vm.prank(player);
        IRefereeGame(address(game))
            .submitBattleResult(id, bytes32(uint256(1)), totals, REPORT, refereeRounds(1, totals));
        vm.expectRevert(S.InvalidOutput.selector);
        vm.prank(RESOLVER);
        IRefereeGame(address(game))
            .submitBattleResult(id, 0, totals, REPORT, refereeRounds(1, totals));
        vm.expectRevert(S.InvalidOutput.selector);
        vm.prank(RESOLVER);
        IRefereeGame(address(game))
            .submitBattleResult(id, bytes32(uint256(1)), totals, REPORT, refereeRounds(7, totals));
        vm.expectRevert(S.InvalidOutput.selector);
        vm.prank(RESOLVER);
        IRefereeGame(address(game))
            .submitBattleResult(id, bytes32(uint256(1)), totals, 0, refereeRounds(1, totals));
        (bytes32 binding,,,,,,,) = IRefereeGame(address(game)).battleResultSummary(id);
        assertEq(binding, 0);
    }

    function testAcceptedRootCannotBeReplacedAndMissingZeroLossCannotSkip() public {
        (uint256 id,) = _fixture();
        S.Leaf[] memory leaves = _leaves(id, 0, 7);
        Application app = Application(address(game));
        vm.expectRevert(S.InvalidOutput.selector);
        app.applyBattleResultLeaves(id, _one(leaves[1]));
        app.applyBattleResultLeaves(id, _one(leaves[0]));
        bytes32 binding = abi.decode(_inject(abi.encodeCall(H.binding, (id))), (bytes32));
        uint256[2] memory totals = [uint256(2), uint256(0)];
        vm.expectRevert(S.InvalidOutput.selector);
        vm.prank(RESOLVER);
        IRefereeGame(address(game))
            .submitBattleResult(id, binding, totals, REPORT, refereeRounds(1, totals));
        (, uint256 cursor,,) = app.battleResultProgress(id);
        assertEq(cursor, 1);
        app.applyBattleResultLeaves(id, _one(leaves[1]));
        _finish(id);
    }

    function testLazyEconomicContinuationPreservesLiveLiabilitiesAndDebrisCredits() public {
        (uint256 id, uint256 target) = _fixture();
        S.Leaf[] memory leaves = _leaves(id, 1, 7);
        Application(address(game)).applyBattleResultLeaves(id, leaves);
        // Test-only newer debris credit, paired with its liability, before terminal economics.
        _inject(abi.encodeCall(H.creditDebris, (target, uint128(17), uint128(23))));
        G.Resources memory beforeLiability = game.totalInternalResources();
        vm.prank(address(0xDEF));
        game.renamePlanet{gas: 15_000_000}(target, "Referee settled");
        (uint8 phase,,) = game.stagedBattleProgress(id);
        assertEq(phase, 13);
        (uint128 metal, uint128 crystal) = game.debrisField(target);
        // One battleship(45k/15k) + seven fighters(3k/1k), 30% debris.
        assertEq(metal, 17 + 19_800);
        assertEq(crystal, 23 + 6_600);
        G.Resources memory afterLiability = game.totalInternalResources();
        assertEq(afterLiability.metal, beforeLiability.metal + 19_800);
        assertEq(afterLiability.crystal, beforeLiability.crystal + 6_600);
    }

    /// forge-config: default.isolate = true
    function testColdProxyApplicationAndEconomicsRespectTransactionEnvelope() public {
        (uint256 id,) = _fixture();
        S.Leaf[] memory leaves = _leaves(id, 1, 7);
        ProductionBatchTransactionProbe probe = new ProductionBatchTransactionProbe();
        probe.write(1);
        (uint256 storeGas, uint256 transientValue) = probe.write(2);
        assertGe(storeGas, 5_000);
        assertEq(transientValue, 0);
        Application(address(game)).applyBattleResultLeaves{gas: 15_000_000 - 21_000}(id, leaves);
        Vm.Gas memory measured = vm.lastCallGas();
        uint256 gross = measured.gasTotalUsed + uint256(uint64(measured.gasRefunded));
        emit log_named_uint("cold referee application gross gas", gross);
        assertLt(gross, 15_000_000);
        game.resolveFleetMission{gas: 15_000_000 - 21_000}(id);
        measured = vm.lastCallGas();
        gross = measured.gasTotalUsed + uint256(uint64(measured.gasRefunded));
        emit log_named_uint("cold referee economics gross gas", gross);
        assertLt(gross, 15_000_000);
        (uint8 phase,,) = game.stagedBattleProgress(id);
        assertEq(phase, 13);
    }

    /// forge-config: default.isolate = true
    function testColdFullThirtyTwoLeafBatchIsBoundedAndContinues() public {
        (uint256 id,) = _fixtureMany(31);
        uint32[] memory lost = new uint32[](33);
        lost[0] = 7; // resident fighters wiped; every attacking source loses one battleship
        for (uint256 i = 1; i < 33; ++i) {
            lost[i] = 1;
        }
        S.Leaf[] memory leaves = _rowLeaves(id, lost);
        _commitResult(id, leaves);
        S.Leaf[] memory batch = new S.Leaf[](32);
        for (uint256 i; i < 32; ++i) {
            batch[i] = leaves[i];
        }
        ProductionBatchTransactionProbe probe = new ProductionBatchTransactionProbe();
        probe.write(1);
        (uint256 storageGas, uint256 transientValue) = probe.write(2);
        assertGe(storageGas, 5000);
        assertEq(transientValue, 0);
        Application app = Application(address(game));
        app.applyBattleResultLeaves{gas: 15_000_000 - 21_000}(id, batch);
        Vm.Gas memory measured = vm.lastCallGas();
        uint256 gross = measured.gasTotalUsed + uint256(uint64(measured.gasRefunded));
        emit log_named_uint("cold 32-leaf application gross gas", gross);
        assertLt(gross, 15_000_000);
        (S.Phase phase, uint256 cursor,,) = app.battleResultProgress(id);
        assertEq(uint8(phase), 1);
        assertEq(cursor, 32);
        app.applyBattleResultLeaves(id, _one(leaves[32]));
        _finish(id);
    }

    function _allLeaves(uint256 id, uint256 survivingSource)
        private
        returns (S.Leaf[] memory leaves)
    {
        (,,,,, uint256 count) = abi.decode(
            IRefereeGame(address(game)).refereeBattleRecord(id, 0, 0),
            (P.Version, P.Phase, bytes32, bytes32, uint256, uint256)
        );
        uint32[] memory lost = new uint32[](count);
        for (uint256 i; i < count; ++i) {
            P.Row memory row =
                abi.decode(IRefereeGame(address(game)).refereeBattleRecord(id, 2, i), (P.Row));
            lost[i] = row.side == 0 || row.source == survivingSource ? 0 : row.count;
        }
        leaves = _rowLeaves(id, lost);
        _commitResult(id, leaves);
    }

    function testMoonCasualtyDeltaRepairsAndRaidUseActualMoonPool() public {
        moonFixture = true;
        (uint256 id, uint256 target) = _fixture();
        S.Leaf[] memory leaves = _allLeaves(id, type(uint256).max);
        // The real Moon setter correctly refuses credits while the body is locked.
        G.Resources memory planetBefore = game.planet(target).resources;
        G.Resources memory moonBefore = game.moonResources(target);
        Application(address(game)).applyBattleResultLeaves(id, leaves);
        assertEq(game.moonShipCount(target, Ship.LightFighter), 0);
        assertEq(moons.moonDefenseCount(target, Defense.RocketLauncher), 0);
        _finish(id);
        assertEq(game.shipCount(target, Ship.LightFighter), 7);
        assertEq(moons.moonDefenseCount(target, Defense.RocketLauncher), 7);
        assertEq(game.planet(target).resources.metal, planetBefore.metal);
        G.Resources memory moonAfter = game.moonResources(target);
        (,,,,,,,,, G.Resources memory cargo,) = game.fleetMission(id);
        assertEq(moonBefore.metal - moonAfter.metal, cargo.metal);
        assertEq(moonBefore.crystal - moonAfter.crystal, cargo.crystal);
        assertEq(moonBefore.deuterium - moonAfter.deuterium, cargo.deuterium);
        assertGt(uint256(cargo.metal) + cargo.crystal + cargo.deuterium, 0);
    }

    function testWipedHoldBurnsCargoAndLivingHoldStaysExactlyOnce() public {
        holdFixture = true;
        (uint256 id, uint256 target) = _fixture();
        S.Leaf[] memory leaves = _allLeaves(id, 101);
        Application(address(game)).applyBattleResultLeaves(id, leaves);
        G.Resources memory beforeLiability = game.totalInternalResources();
        _finish(id);
        (G.FleetMissionStatus dead,, uint64 returned,) = _fleetMission(100);
        (G.FleetMissionStatus alive,,,) = _fleetMission(101);
        assertEq(uint8(dead), uint8(G.FleetMissionStatus.Resolved));
        assertEq(returned, block.timestamp);
        assertEq(uint8(alive), uint8(G.FleetMissionStatus.Outbound));
        (uint256 count, uint64 untilDead, uint64 untilLive) =
            abi.decode(_inject(abi.encodeCall(H.heldState, (target))), (uint256, uint64, uint64));
        assertEq(count, 1);
        assertEq(untilDead, 0);
        assertGt(untilLive, block.timestamp);
        (,,,,,,,,, G.Resources memory cargo,) = game.fleetMission(100);
        assertEq(cargo.metal, 0);
        assertEq(game.activeFleetMissionCount(address(0xDEF)), 1);
        G.Resources memory afterLiability = game.totalInternalResources();
        // 7fighters + 2 small cargos => 7500/3300 debris; wiped cargo releases11/13/17.
        assertEq(afterLiability.metal, beforeLiability.metal + 7500 - 11);
        assertEq(afterLiability.crystal, beforeLiability.crystal + 3300 - 13);
        assertEq(afterLiability.deuterium, beforeLiability.deuterium - 17);
        game.resolveFleetMission(id);
        assertEq(game.activeFleetMissionCount(address(0xDEF)), 1);
    }

    function testPartialLossNeverTruncatesExistingCargo() public {
        (uint256 id,) = _fixture();
        S.Leaf[] memory leaves = _leaves(id, 1, 0);
        _inject(abi.encodeCall(H.creditCargo, (id)));
        Application(address(game)).applyBattleResultLeaves(id, leaves);
        _finish(id);
        (,,,,,,,,, G.Resources memory cargo,) = game.fleetMission(id);
        assertEq(cargo.metal, 11);
        assertEq(cargo.crystal, 13);
        assertEq(cargo.deuterium, 17);
    }

    function testWipedCargoReleasesLiveBackingBeforeClippedDebris() public {
        (uint256 id, uint256 target) = _fixture();
        S.Leaf[] memory leaves = _leaves(id, 2, 0);
        _inject(abi.encodeCall(H.creditCargo, (id)));
        Application(address(game)).applyBattleResultLeaves(id, leaves);
        G.Resources memory liability = game.totalInternalResources();
        G.Resources memory locked = G.Resources(
            uint128(metalToken.balanceOf(address(game)) - liability.metal),
            uint128(crystalToken.balanceOf(address(game)) - liability.crystal),
            uint128(deuteriumToken.balanceOf(address(game)) - liability.deuterium)
        );
        _inject(abi.encodeCall(H.lockReserves, (locked.metal, locked.crystal, locked.deuterium)));
        assertEq(game.resourceReserveAvailable().metal, 0);
        _finish(id);
        (uint128 metal, uint128 crystal) = game.debrisField(target);
        assertEq(metal, 11);
        assertEq(crystal, 13);
        assertEq(game.totalInternalResources().metal, liability.metal);
        assertEq(game.totalInternalResources().crystal, liability.crystal);
        assertEq(game.totalInternalResources().deuterium, liability.deuterium - 17);
        assertEq(game.lockedWithdrawalResources().metal, locked.metal);
        assertEq(game.lockedWithdrawalResources().crystal, locked.crystal);
        assertEq(game.resourceReserveAvailable().metal, 0);
        (G.FleetMissionStatus status,,,) = _fleetMission(id);
        assertEq(uint8(status), uint8(G.FleetMissionStatus.Resolved));
        assertEq(game.activeFleetMissionCount(player), 0);
        game.resolveFleetMission(id);
        assertEq(game.totalInternalResources().metal, liability.metal);
    }

    function _isolationProbe() private {
        ProductionBatchTransactionProbe probe = new ProductionBatchTransactionProbe();
        probe.write(1);
        (uint256 storageGas, uint256 transientValue) = probe.write(2);
        assertGe(storageGas, 5000);
        assertEq(transientValue, 0);
    }

    function _coldEconomicStep(uint256 id) private returns (uint256 gross) {
        game.resolveFleetMission{gas: 1_200_000 - 21_000}(id);
        Vm.Gas memory measured = vm.lastCallGas();
        gross = measured.gasTotalUsed + uint256(uint64(measured.gasRefunded));
        assertLt(gross, 1_200_000, "bounded cold economic transaction");
    }

    function _finishCold(uint256 id) private {
        uint256 peak;
        for (uint256 i; i < 64; ++i) {
            (uint8 phase,,) = game.stagedBattleProgress(id);
            if (phase == 13) {
                emit log_named_uint("integration cold economics peak gross gas", peak);
                return;
            }
            uint256 gross = _coldEconomicStep(id);
            if (gross > peak) peak = gross;
        }
        fail("cold economics did not finish");
    }

    function _raidOrder(uint256 id) private returns (uint256[] memory) {
        return abi.decode(_inject(abi.encodeCall(H.raidMissions, (id))), (uint256[]));
    }

    /// forge-config: default.isolate = true
    function testRaidAllocationFollowsEnrollmentOrder() public {
        cargoJoinFixture = true;
        (uint256 id,) = _fixtureMany(1);
        uint256[] memory order = _raidOrder(id);
        assertEq(order.length, 2);
        assertEq(order[0], id);
        uint256 joined = order[1];
        assertEq(
            abi.decode(IRefereeGame(address(game)).refereeBattleRecord(id, 2, 0), (P.Row)).source, 0
        );
        P.Row memory leader =
            abi.decode(IRefereeGame(address(game)).refereeBattleRecord(id, 2, 1), (P.Row));
        P.Row memory cargo =
            abi.decode(IRefereeGame(address(game)).refereeBattleRecord(id, 2, 2), (P.Row));
        assertEq(cargo.source, joined);
        assertEq(cargo.unit, uint8(Ship.SmallCargo));
        assertEq(leader.source, id);
        assertEq(leader.unit, uint8(Ship.Battleship));
        // Leaves follow journal rows; raid allocation must still follow enrollment order.
        S.Leaf[] memory leaves = _allLeaves(id, type(uint256).max);
        _inject(abi.encodeCall(H.oneUnitRaidPool, (id)));
        _isolationProbe();
        Application(address(game)).applyBattleResultLeaves{gas: 15_000_000 - 21_000}(id, leaves);
        assertEq(keccak256(abi.encode(_raidOrder(id))), keccak256(abi.encode(order)));
        _finishCold(id);
        (,,, G.Resources memory leaderCargo) = _fleetMission(id);
        (,,, G.Resources memory joinedCargo) = _fleetMission(joined);
        (uint256 leaderCapacity, uint256 joinedCapacity) = abi.decode(
            _inject(abi.encodeCall(H.raidCapacities, (id, id, joined))), (uint256, uint256)
        );
        assertGt(leaderCapacity, 0);
        assertGt(joinedCapacity, 0);
        // A canonical-first joined fleet would get0, proving these allocations distinguish order.
        assertEq(joinedCapacity / (leaderCapacity + joinedCapacity), 0);
        // Two strictly positive capacities: first gets floor(1*c/(c+d))=0, last gets1.
        assertEq(leaderCargo.metal, 0);
        assertEq(joinedCargo.metal, 1);
        assertEq(leaderCargo.crystal + joinedCargo.crystal, 0);
        assertEq(leaderCargo.deuterium + joinedCargo.deuterium, 0);
        assertEq(keccak256(abi.encode(_raidOrder(id))), keccak256(abi.encode(order)));
    }

    /// forge-config: default.isolate = true
    function testZeroShipEnrolledSourceWithoutOutputRowStillCleansUp() public {
        zeroJoinFixture = true;
        (uint256 id, uint256 target) = _fixtureMany(1);
        uint256[] memory order = _raidOrder(id);
        assertEq(order.length, 2);
        uint256 empty = order[1];
        G.FleetMission memory frozen = abi.decode(
            IRefereeGame(address(game)).refereeBattleRecord(id, 3, empty), (G.FleetMission)
        );
        assertEq(frozen.ships.battleship, 0);
        assertEq(frozen.cargo.metal, 11);
        S.Leaf[] memory leaves = _allLeaves(id, type(uint256).max);
        assertEq(leaves.length, 2);
        for (uint256 i; i < leaves.length; ++i) {
            assertTrue(leaves[i].source != empty);
        }
        (uint256 originIndex, uint256 targetIndex, uint256 playerIndex) = abi.decode(
            _inject(abi.encodeCall(H.resolutionIndexes, (empty))), (uint256, uint256, uint256)
        );
        // Real ACS launch indexes the group leader, not the joined source individually.
        assertEq(originIndex + targetIndex + playerIndex, 0);
        (originIndex, targetIndex, playerIndex) = abi.decode(
            _inject(abi.encodeCall(H.resolutionIndexes, (id))), (uint256, uint256, uint256)
        );
        assertGt(originIndex, 0);
        assertGt(targetIndex, 0);
        assertGt(playerIndex, 0);
        assertEq(game.activeFleetMissionCount(player), 2);
        _isolationProbe();
        Application(address(game)).applyBattleResultLeaves{gas: 15_000_000 - 21_000}(id, leaves);
        G.Resources memory beforeLiability = game.totalInternalResources();
        _finishCold(id);
        (G.FleetMissionStatus status,, uint64 returned, G.Resources memory cargo) =
            _fleetMission(empty);
        (uint64 epoch,,,) = abi.decode(
            _inject(abi.encodeCall(H.settlementCursor, (id))), (uint64, uint256, uint8, uint256)
        );
        assertEq(uint8(status), uint8(G.FleetMissionStatus.Resolved));
        assertEq(returned, epoch);
        assertEq(cargo.metal + cargo.crystal + cargo.deuterium, 0);
        assertEq(game.activeFleetMissionCount(player), 1);
        (originIndex, targetIndex, playerIndex) = abi.decode(
            _inject(abi.encodeCall(H.resolutionIndexes, (empty))), (uint256, uint256, uint256)
        );
        assertEq(originIndex + targetIndex + playerIndex, 0);
        // The surviving leader remains enumerable for its later return; empty-source cleanup
        // must not remove the group's still-needed indexes.
        (originIndex, targetIndex, playerIndex) = abi.decode(
            _inject(abi.encodeCall(H.resolutionIndexes, (id))), (uint256, uint256, uint256)
        );
        assertGt(originIndex, 0);
        assertGt(targetIndex, 0);
        assertGt(playerIndex, 0);
        assertEq(abi.decode(_inject(abi.encodeCall(H.locked, (target))), (uint256)), 0);
        G.Resources memory afterLiability = game.totalInternalResources();
        assertEq(afterLiability.metal, beforeLiability.metal + 6300 - 11);
        assertEq(afterLiability.crystal, beforeLiability.crystal + 2100 - 13);
        assertEq(afterLiability.deuterium, beforeLiability.deuterium - 17);
        game.resolveFleetMission{gas: 15_000_000 - 21_000}(empty);
        assertEq(game.activeFleetMissionCount(player), 1);
        assertEq(game.totalInternalResources().metal, afterLiability.metal);
    }

    /// forge-config: default.isolate = true
    function testDelayedMulticallReturnsShareFrozenEpochAndLeaderSchedule() public {
        (uint256 id,) = _fixtureMany(2);
        uint256[] memory order = _raidOrder(id);
        assertEq(order.length, 3);
        (, uint64 impact, uint64 leaderReturn,) = _fleetMission(id);
        (,, uint64 oldFirstReturn,) = _fleetMission(order[1]);
        (,, uint64 oldSecondReturn,) = _fleetMission(order[2]);
        S.Leaf[] memory leaves = _allLeaves(id, type(uint256).max);
        vm.warp(uint256(impact) + 10_000); // Proof/application arrives well after original flight deadlines.
        _isolationProbe();
        Application(address(game)).applyBattleResultLeaves{gas: 15_000_000 - 21_000}(id, leaves);
        uint64 epoch;
        uint256 peak;
        for (uint256 i; i < 32; ++i) {
            (uint8 phase,,) = game.stagedBattleProgress(id);
            if (phase == 12) break;
            vm.warp(block.timestamp + 17);
            uint256 gross = _coldEconomicStep(id);
            if (gross > peak) peak = gross;
        }
        (uint8 returnPhase,,) = game.stagedBattleProgress(id);
        assertEq(returnPhase, 12);
        uint256 cursor;
        (epoch, cursor,,) = abi.decode(
            _inject(abi.encodeCall(H.settlementCursor, (id))), (uint64, uint256, uint8, uint256)
        );
        assertEq(epoch, block.timestamp);
        assertEq(cursor, 0);
        assertGt(epoch, uint256(impact) + 10_000);
        for (uint256 i; i < 3; ++i) {
            vm.warp(block.timestamp + 1000);
            uint256 gross = _coldEconomicStep(id);
            if (gross > peak) peak = gross;
            (uint64 afterEpoch, uint256 afterCursor,,) = abi.decode(
                _inject(abi.encodeCall(H.settlementCursor, (id))), (uint64, uint256, uint8, uint256)
            );
            assertEq(afterEpoch, epoch);
            assertEq(afterCursor, i + 1);
            if (i >= 1) {
                (G.FleetMissionStatus firstStatus,, uint64 firstReturn,) = _fleetMission(order[1]);
                assertEq(uint8(firstStatus), uint8(G.FleetMissionStatus.Returning));
                assertEq(firstReturn, uint256(epoch) + oldFirstReturn - impact);
            }
        }
        (,, uint64 secondReturn,) = _fleetMission(order[2]);
        assertEq(secondReturn, uint256(epoch) + oldSecondReturn - impact);
        _finishCold(id);
        (G.FleetMissionStatus leaderStatus,, uint64 unchangedLeaderReturn,) = _fleetMission(id);
        assertEq(uint8(leaderStatus), uint8(G.FleetMissionStatus.Returning));
        assertEq(unchangedLeaderReturn, leaderReturn);
        (,, uint64 finalFirstReturn,) = _fleetMission(order[1]);
        assertEq(finalFirstReturn, uint256(epoch) + oldFirstReturn - impact);
        emit log_named_uint("delayed cold multicall peak gross gas", peak);
        assertEq(keccak256(abi.encode(_raidOrder(id))), keccak256(abi.encode(order)));
    }

    function testOwnerConfiguresRefereeAndResolverRotationIsLive() public {
        (uint256 id,) = _fixture();
        IRefereeGame referee = IRefereeGame(address(game));
        P.Version memory v = P.Version(4, keccak256("rules"), keccak256("catalog"));
        vm.expectRevert(abi.encodeWithSelector(G.Unauthorized.selector, player));
        vm.prank(player);
        referee.configureBattleReferee(v, player);
        vm.startPrank(admin);
        vm.expectRevert(P.InvalidRefereeLifecycle.selector);
        referee.configureBattleReferee(v, address(0));
        vm.expectRevert(P.InvalidRefereeLifecycle.selector);
        referee.configureBattleReferee(P.Version(4, 0, keccak256("catalog")), RESOLVER);
        address rotated = address(0xB0B);
        referee.configureBattleReferee(v, rotated);
        vm.stopPrank();
        (P.Version memory prospective, address resolver) =
            abi.decode(referee.refereeBattleRecord(0, 4, 0), (P.Version, address));
        assertEq(prospective.version, 4);
        assertEq(game.combatModelVersion(), 3);
        assertEq(resolver, rotated);
        // The already-launched battle keeps its frozen version 3 rules.
        (P.Version memory frozen,,,,,) = abi.decode(
            referee.refereeBattleRecord(id, 0, 0),
            (P.Version, P.Phase, bytes32, bytes32, uint256, uint256)
        );
        assertEq(frozen.version, 3);
        S.Leaf[] memory leaves = _rowLeaves(id, new uint32[](2));
        (bytes32 root, uint256[2] memory totals) = _link(id, leaves);
        vm.expectRevert(abi.encodeWithSelector(G.Unauthorized.selector, RESOLVER));
        vm.prank(RESOLVER);
        referee.submitBattleResult(id, root, totals, REPORT, refereeRounds(1, totals));
        vm.prank(rotated);
        referee.submitBattleResult(id, root, totals, REPORT, refereeRounds(1, totals));
        // Version zero stops new launches but never strands launched battles.
        vm.prank(admin);
        vm.expectRevert(P.InvalidRefereeLifecycle.selector);
        referee.configureBattleReferee(P.Version(0, 0, 0), address(0));
        vm.prank(admin);
        referee.configureBattleReferee(P.Version(0, 0, 0), rotated);
        assertEq(game.combatModelVersion(), 2);
        Application(address(game)).applyBattleResultLeaves(id, leaves);
        _finish(id);
    }

    function testSubmissionFreezesSummaryAndEmitsReportHash() public {
        (uint256 id,) = _fixture();
        S.Leaf[] memory leaves = _rowLeaves(id, new uint32[](2));
        leaves[0].lost = 7;
        leaves[0].survivors = 0;
        (bytes32 root, uint256[2] memory totals) = _link(id, leaves);
        bytes32 binding = abi.decode(_inject(abi.encodeCall(H.binding, (id))), (bytes32));
        assertEq(IRefereeGame(address(game)).battleResultBinding(id), binding);
        vm.expectEmit(address(game));
        emit Application.BattleResultSubmitted(id, REPORT, binding, root, 2, 4, 2, 0, 1, 3);
        vm.prank(RESOLVER);
        IRefereeGame(address(game))
            .submitBattleResult(id, root, totals, REPORT, refereeRounds(4, totals));
        (
            bytes32 b,
            bytes32 report,
            bytes32 r,
            uint256 members,
            uint8 rounds,
            uint256[2] memory frozen,
            uint8 outcome,
            uint32 version
        ) = IRefereeGame(address(game)).battleResultSummary(id);
        assertEq(b, binding);
        assertEq(report, REPORT);
        assertEq(r, root);
        assertEq(members, 2);
        assertEq(rounds, 4);
        assertEq(frozen[0], 2);
        assertEq(frozen[1], 0);
        assertEq(outcome, 1);
        assertEq(version, 3);
    }

    event CombatRoundResolved(
        uint256 indexed missionId,
        uint8 indexed round,
        uint256 attackerUnits,
        uint256 defenderUnits,
        uint128 attackerLossMetal,
        uint128 attackerLossCrystal,
        uint128 defenderLossMetal,
        uint128 defenderLossCrystal
    );

    function testRoundSummaryMustEndOnTotalsAndEmitsStandardRoundEvents() public {
        (uint256 id,) = _fixture();
        S.Leaf[] memory leaves = _rowLeaves(id, new uint32[](2));
        (bytes32 root, uint256[2] memory totals) = _link(id, leaves);
        Application.RoundSummary[] memory summary = refereeRounds(2, totals);
        summary[1].defenderUnits = totals[1] + 1;
        vm.expectRevert(S.InvalidOutput.selector);
        vm.prank(RESOLVER);
        IRefereeGame(address(game)).submitBattleResult(id, root, totals, REPORT, summary);
        summary[1].defenderUnits = totals[1];
        summary[0] = Application.RoundSummary(2, 9, 0, 0, 3000, 1000);
        vm.expectEmit(address(game));
        emit CombatRoundResolved(id, 1, 2, 9, 0, 0, 3000, 1000);
        vm.expectEmit(address(game));
        emit CombatRoundResolved(id, 2, totals[0], totals[1], 0, 0, 0, 0);
        vm.prank(RESOLVER);
        IRefereeGame(address(game)).submitBattleResult(id, root, totals, REPORT, summary);
        (,,,, uint8 rounds,,,) = IRefereeGame(address(game)).battleResultSummary(id);
        assertEq(rounds, 2);
    }

    function testLeafMustMatchJournaledRowAndTotals() public {
        (uint256 id,) = _fixture();
        S.Leaf[] memory leaves = _rowLeaves(id, new uint32[](2));
        leaves[0].enrolledCount = 8;
        leaves[0].survivors = 8;
        _commitResult(id, leaves);
        vm.expectRevert(S.InvalidOutput.selector);
        Application(address(game)).applyBattleResultLeaves(id, leaves);
    }

    function testDeclaredTotalsMustMatchAppliedSurvivors() public {
        (uint256 id,) = _fixture();
        S.Leaf[] memory leaves = _rowLeaves(id, new uint32[](2));
        (bytes32 root, uint256[2] memory totals) = _link(id, leaves);
        totals[1] = 0;
        vm.prank(RESOLVER);
        IRefereeGame(address(game))
            .submitBattleResult(id, root, totals, REPORT, refereeRounds(1, totals));
        vm.expectRevert(S.InvalidOutput.selector);
        Application(address(game)).applyBattleResultLeaves(id, leaves);
    }

    function testPausedGameBlocksSubmission() public {
        (uint256 id,) = _fixture();
        S.Leaf[] memory leaves = _rowLeaves(id, new uint32[](2));
        (bytes32 root, uint256[2] memory totals) = _link(id, leaves);
        vm.prank(admin);
        game.setGamePaused(true);
        vm.expectRevert();
        vm.prank(RESOLVER);
        IRefereeGame(address(game))
            .submitBattleResult(id, root, totals, REPORT, refereeRounds(1, totals));
    }

    /// Shared with apps/backend/src/battleReferee.test.ts: leaf and tail hash encodings must match.
    function testResultLeafHashVector() public pure {
        bytes32 binding = keccak256("binding");
        S.Leaf memory leaf = S.Leaf(address(0xDEF), 7, 1, 17, 10, 3, 7, keccak256("next"));
        assertEq(
            _node(binding, 2, leaf),
            0x74a7aa472e96d6d0b2e3136d38f739f3e54e9a37dfe45f10089f42265d19f9e6
        );
        assertEq(
            keccak256(
                abi.encode(keccak256("veydrift.referee-battle.result-tail.v1"), binding, uint256(3))
            ),
            0x47956b270bcb3583adb67288e24e983005102d1f85339042bb649e8e4d9b298f
        );
    }

    function testMaximumDefenseRepairUsesWideProductAndWrappingSeed() public pure {
        uint256 packed = uint256(type(uint32).max) | (uint256(1) << 32) | (uint256(1) << 64);
        uint256 actual = VeydriftCatalog.repairedDefenseCounts(packed, type(uint256).max);
        // Independent integer quotient: (2^32-1)*70/100 = 3006477106.
        assertEq(actual & type(uint32).max, 3_006_477_106);
        assertEq((actual >> 32) & type(uint32).max, 1); // max+1 wraps to0
        assertEq((actual >> 64) & type(uint32).max, 1); // max+2 wraps to1
        assertEq(uint32(VeydriftCatalog.repairedDefenseCounts(uint256(1) << 32, 6) >> 32), 0);
    }
}
