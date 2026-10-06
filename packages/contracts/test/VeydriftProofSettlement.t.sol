// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Vm} from "forge-std/Vm.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {ProductionBatchTransactionProbe} from "./ProductionBatchTransactionProbe.sol";
import {VeydriftMoonSystemTestBase} from "./VeydriftMoonSystem.t.sol";
import {VeydriftGameStorage as G} from "../src/VeydriftGameStorage.sol";
import {VeydriftProofBattle as P} from "../src/libraries/VeydriftProofBattle.sol";
import {VeydriftProofSettlement as S} from "../src/libraries/VeydriftProofSettlement.sol";
import {
    VeydriftProofSettlementModule as Application
} from "../src/VeydriftProofSettlementModule.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";

import {ProofSettlementHarness as H} from "./support/ProofSettlementHarness.sol";
import {Ship, Defense, Technology, Building} from "../src/libraries/VeydriftTypes.sol";

contract VeydriftProofSettlementTest is VeydriftMoonSystemTestBase {
    bytes private gameCode;
    bool private moonFixture;
    bool private holdFixture;
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
        _setTechnologyLevel(player, Technology.Computer, 100);
        _setShipCount(target, Ship.LightFighter, 7);
        if (moonFixture) {
            _setMoonShipCount(target, Ship.LightFighter, 7);
            _setMoonDefenseCount(target, Defense.RocketLauncher, 10);
            _fundMoon(target, 100_000, 200_000, 300_000);
        }
        uint256 slot = uint256(keccak256("veydrift.storage.proof-battle.v1"));
        vm.store(address(game), bytes32(slot), bytes32(uint256(3)));
        vm.store(address(game), bytes32(slot + 1), keccak256("candidate-2"));
        vm.store(address(game), bytes32(slot + 2), keccak256("catalog-fixture"));
        vm.store(address(game), bytes32(slot + 3), bytes32(uint256(uint160(address(randomness)))));
        vm.store(address(game), bytes32(slot + 4), address(randomness).codehash);
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
            100,
            false,
            moonFixture
        );
        for (uint256 i; i < joined; ++i) {
            vm.prank(player);
            game.joinAttackMission(origin, id, target, ships, G.Resources(0, 0, 0));
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
        (uint8 phase,,) = game.stagedBattleProgress(id);
        assertEq(phase, 17);
    }

    function _leaves(uint256 id, uint32 attackerLost, uint32 defenderLost)
        private
        returns (S.Leaf[] memory leaves)
    {
        bytes32 binding = abi.decode(_inject(abi.encodeCall(H.binding, (id))), (bytes32));
        P.Row memory resident = abi.decode(game.proofBattleRecord(id, 2, 0), (P.Row));
        P.Row memory leader = abi.decode(game.proofBattleRecord(id, 2, 1), (P.Row));
        leaves = new S.Leaf[](2);
        bytes32 tail = keccak256(
            abi.encode(keccak256("veydrift.proof-battle.output-tail.v1"), binding, uint256(2))
        );
        leaves[1] = S.Leaf(
            1,
            resident.owner,
            0,
            1,
            resident.unit,
            resident.count,
            defenderLost,
            resident.count - defenderLost,
            tail
        );
        leaves[0] = S.Leaf(
            0,
            leader.owner,
            id,
            0,
            leader.unit,
            leader.count,
            attackerLost,
            leader.count - attackerLost,
            _node(binding, 1, leaves[1])
        );
        uint256[2] memory totals =
            [uint256(leader.count - attackerLost), uint256(resident.count - defenderLost)];
        _inject(abi.encodeCall(H.acceptTrusted, (id, _node(binding, 0, leaves[0]), 2, 1, totals)));
    }

    function _node(bytes32 binding, uint256 index, S.Leaf memory leaf)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                keccak256("veydrift.proof-battle.output-leaf.v1"),
                binding,
                index,
                leaf.cohortId,
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
        app.applyProofBattleLeaves(id, _one(leaves[0]));
        (S.Phase p, uint256 cursor,,) = app.proofSettlementProgress(id);
        assertEq(uint8(p), 1);
        assertEq(cursor, 1);
        (uint8 stage,,) = game.stagedBattleProgress(id);
        assertEq(stage, 17);
        assertEq(abi.decode(_inject(abi.encodeCall(H.locked, (target))), (uint256)), id);
        vm.expectRevert(S.InvalidOutput.selector);
        app.applyProofBattleLeaves(id, _one(leaves[0]));
        app.applyProofBattleLeaves(id, _one(leaves[1]));
        assertEq(game.shipCount(target, Ship.LightFighter), 5);
        G.MissionShips memory ships =
            abi.decode(_inject(abi.encodeCall(H.ships, (id))), (G.MissionShips));
        assertEq(ships.battleship, 5);
        _finish(id);
        assertEq(abi.decode(_inject(abi.encodeCall(H.locked, (target))), (uint256)), 0);
        (G.FleetMissionStatus status,,,) = _fleetMission(id);
        assertEq(uint8(status), uint8(G.FleetMissionStatus.Returning));
        vm.expectRevert(S.InvalidOutput.selector);
        app.applyProofBattleLeaves(id, leaves);
        game.resolveFleetMission(id);
        assertEq(game.shipCount(target, Ship.LightFighter), 5);
    }

    function testChangedLeafAndInsufficientInventoryRollbackBeforeProgress() public {
        (uint256 id, uint256 target) = _fixture();
        S.Leaf[] memory leaves = _leaves(id, 1, 7);
        Application app = Application(address(game));
        bytes32 originalNext = leaves[0].next;
        S.Leaf[] memory bad = _one(leaves[0]);
        bad[0].next = bytes32(uint256(9));
        vm.expectRevert(S.InvalidOutput.selector);
        app.applyProofBattleLeaves(id, bad);
        (, uint256 cursor,,) = app.proofSettlementProgress(id);
        assertEq(cursor, 0);
        leaves[0].next = originalNext;
        _setShipCount(target, Ship.LightFighter, 6);
        vm.expectRevert(S.InsufficientLiveInventory.selector);
        app.applyProofBattleLeaves(id, leaves);
        (, cursor,,) = app.proofSettlementProgress(id);
        assertEq(cursor, 0);
        G.MissionShips memory ships =
            abi.decode(_inject(abi.encodeCall(H.ships, (id))), (G.MissionShips));
        assertEq(ships.battleship, 2);
        _setShipCount(target, Ship.LightFighter, 7);
        app.applyProofBattleLeaves(id, leaves);
        _finish(id);
    }

    function testUnacceptedAndProductionSubmissionRemainClosed() public {
        (uint256 id,) = _fixture();
        vm.expectRevert(S.InvalidOutput.selector);
        Application(address(game)).applyProofBattleLeaves(id, new S.Leaf[](0));
        vm.expectRevert(P.ProofPipelineUnavailable.selector);
        game.submitBattleProof(id, hex"", bytes32(0));
    }

    function testAcceptedRootCannotBeReplacedAndMissingZeroLossCannotSkip() public {
        (uint256 id,) = _fixture();
        S.Leaf[] memory leaves = _leaves(id, 0, 7);
        Application app = Application(address(game));
        vm.expectRevert(S.InvalidOutput.selector);
        app.applyProofBattleLeaves(id, _one(leaves[1]));
        app.applyProofBattleLeaves(id, _one(leaves[0]));
        bytes32 binding = abi.decode(_inject(abi.encodeCall(H.binding, (id))), (bytes32));
        vm.etch(address(game), harness.code);
        uint256[2] memory totals = [uint256(2), uint256(0)];
        vm.expectRevert(S.InvalidOutput.selector);
        H(address(game)).acceptTrusted(id, _node(binding, 0, leaves[0]), 2, 1, totals);
        vm.etch(address(game), gameCode);
        (, uint256 cursor,,) = app.proofSettlementProgress(id);
        assertEq(cursor, 1);
        app.applyProofBattleLeaves(id, _one(leaves[1]));
        _finish(id);
    }

    function testLazyEconomicContinuationPreservesLiveLiabilitiesAndDebrisCredits() public {
        (uint256 id, uint256 target) = _fixture();
        S.Leaf[] memory leaves = _leaves(id, 1, 7);
        Application(address(game)).applyProofBattleLeaves(id, leaves);
        // Test-only newer debris credit, paired with its liability, before terminal economics.
        _inject(abi.encodeCall(H.creditDebris, (target, uint128(17), uint128(23))));
        G.Resources memory beforeLiability = game.totalInternalResources();
        vm.prank(address(0xDEF));
        game.renamePlanet{gas: 15_000_000}(target, "Proof settled");
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
        Application(address(game)).applyProofBattleLeaves{gas: 15_000_000 - 21_000}(id, leaves);
        Vm.Gas memory measured = vm.lastCallGas();
        uint256 gross = measured.gasTotalUsed + uint256(uint64(measured.gasRefunded));
        emit log_named_uint("cold proof application gross gas", gross);
        assertLt(gross, 15_000_000);
        game.resolveFleetMission{gas: 15_000_000 - 21_000}(id);
        measured = vm.lastCallGas();
        gross = measured.gasTotalUsed + uint256(uint64(measured.gasRefunded));
        emit log_named_uint("cold proof economics gross gas", gross);
        assertLt(gross, 15_000_000);
        (uint8 phase,,) = game.stagedBattleProgress(id);
        assertEq(phase, 13);
    }

    /// forge-config: default.isolate = true
    function testColdFullThirtyTwoLeafBatchIsBoundedAndContinues() public {
        (uint256 id,) = _fixtureMany(31);
        bytes32 binding = abi.decode(_inject(abi.encodeCall(H.binding, (id))), (bytes32));
        S.Leaf[] memory leaves = new S.Leaf[](33);
        bytes32 next = keccak256(
            abi.encode(keccak256("veydrift.proof-battle.output-tail.v1"), binding, uint256(33))
        );
        for (uint256 n = 33; n > 0; --n) {
            uint256 index = n - 1;
            uint256 raw = index == 32 ? 0 : index + 1;
            P.Row memory row = abi.decode(game.proofBattleRecord(id, 2, raw), (P.Row));
            leaves[index] = S.Leaf(
                index == 32 ? 1 : 0,
                row.owner,
                row.source,
                row.side,
                row.unit,
                row.count,
                row.side == 0 ? 1 : row.count,
                row.side == 0 ? row.count - 1 : 0,
                next
            );
            next = _node(binding, index, leaves[index]);
        }
        uint256[2] memory totals = [uint256(32), uint256(0)];
        _inject(abi.encodeCall(H.acceptTrusted, (id, next, 33, 1, totals)));
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
        app.applyProofBattleLeaves{gas: 15_000_000 - 21_000}(id, batch);
        Vm.Gas memory measured = vm.lastCallGas();
        uint256 gross = measured.gasTotalUsed + uint256(uint64(measured.gasRefunded));
        emit log_named_uint("cold 32-leaf application gross gas", gross);
        assertLt(gross, 15_000_000);
        (S.Phase phase, uint256 cursor,,) = app.proofSettlementProgress(id);
        assertEq(uint8(phase), 1);
        assertEq(cursor, 32);
        app.applyProofBattleLeaves(id, _one(leaves[32]));
        _finish(id);
    }

    function _allLeaves(uint256 id, uint256 survivingSource)
        private
        returns (S.Leaf[] memory leaves)
    {
        (,,,,, uint256 count) = abi.decode(
            game.proofBattleRecord(id, 0, 0),
            (P.Version, P.Phase, bytes32, bytes32, uint256, uint256)
        );
        bytes32 binding = abi.decode(_inject(abi.encodeCall(H.binding, (id))), (bytes32));
        leaves = new S.Leaf[](count);
        bytes32 next = keccak256(
            abi.encode(keccak256("veydrift.proof-battle.output-tail.v1"), binding, count)
        );
        uint256[2] memory totals;
        // Trusted-fixture root: tests application, not circuit ordering/cryptographic acceptance.
        for (uint256 n = count; n > 0; --n) {
            uint256 i = n - 1;
            P.Row memory row = abi.decode(game.proofBattleRecord(id, 2, i), (P.Row));
            uint32 survivors = row.side == 0 || row.source == survivingSource ? row.count : 0;
            leaves[i] = S.Leaf(
                i,
                row.owner,
                row.source,
                row.side,
                row.unit,
                row.count,
                row.count - survivors,
                survivors,
                next
            );
            totals[row.side] += survivors;
            next = _node(binding, i, leaves[i]);
        }
        _inject(abi.encodeCall(H.acceptTrusted, (id, next, count, 1, totals)));
    }

    function testMoonCasualtyDeltaRepairsAndRaidUseActualMoonPool() public {
        moonFixture = true;
        (uint256 id, uint256 target) = _fixture();
        S.Leaf[] memory leaves = _allLeaves(id, type(uint256).max);
        // The real Moon setter correctly refuses credits while the body is locked.
        G.Resources memory planetBefore = game.planet(target).resources;
        G.Resources memory moonBefore = game.moonResources(target);
        Application(address(game)).applyProofBattleLeaves(id, leaves);
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
        Application(address(game)).applyProofBattleLeaves(id, leaves);
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
        Application(address(game)).applyProofBattleLeaves(id, leaves);
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
        Application(address(game)).applyProofBattleLeaves(id, leaves);
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

    function testOutputbridgePinnedStaticAbiVector() public pure {
        bytes32 binding = 0x96c8730c05585ddb230917c200d884196e9313fd14db0ec2ff49f1851793f2b7;
        S.Leaf memory leaf = S.Leaf(
            0,
            address(1),
            100,
            0,
            10,
            1,
            0,
            1,
            0x3714628d698db75ce55af6cd1ef600445826fc1d9242c6c462e1a224f15e1f60
        );
        assertEq(
            _node(binding, 0, leaf),
            0x21fe8c470d38b24fb90a25ee65cd5b38b97a5e59abc5432056737b3e672e103f
        );
        assertEq(
            keccak256(
                abi.encode(keccak256("veydrift.proof-battle.output-tail.v1"), binding, uint256(3))
            ),
            0x36136de6e8b45e48e10583f5294f2adec1380c9c0ad4d0deb2ce81ae4f745802
        );
    }

    function testMaximumDefenseRepairUsesWideProductAndWrappingSeed() public pure {
        uint256 packed = uint256(type(uint32).max) | (uint256(1) << 32) | (uint256(1) << 64);
        uint256 actual = VeydriftCatalog.repairedDefenseCounts(packed, type(uint256).max);
        // Independent integer quotient: (2^32-1)*70/100 = 3006477106.
        assertEq(uint32(actual), 3_006_477_106);
        assertEq(uint32(actual >> 32), 1); // max+1 wraps to0
        assertEq(uint32(actual >> 64), 1); // max+2 wraps to1
        assertEq(uint32(VeydriftCatalog.repairedDefenseCounts(uint256(1) << 32, 6) >> 32), 0);
    }
}
