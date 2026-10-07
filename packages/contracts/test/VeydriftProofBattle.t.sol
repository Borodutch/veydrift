// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Vm} from "forge-std/Vm.sol";
import {VeydriftMoonSystemTestBase} from "./VeydriftMoonSystem.t.sol";
import {VeydriftGameStorage as G} from "../src/VeydriftGameStorage.sol";
import {VeydriftProofBattle as P} from "../src/libraries/VeydriftProofBattle.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {Ship, Technology} from "../src/libraries/VeydriftTypes.sol";

import {ProofFixtureSlots} from "./support/ProofFixtureSlots.sol";

contract VeydriftProofBattleTest is VeydriftMoonSystemTestBase {
    function _status(uint256 id)
        private
        view
        returns (P.Version memory, P.Phase, bytes32, bytes32, uint256, uint256)
    {
        return abi.decode(
            game.proofBattleRecord(id, 0, 0),
            (P.Version, P.Phase, bytes32, bytes32, uint256, uint256)
        );
    }

    function _row(uint256 id, uint256 index) private view returns (P.Row memory) {
        return abi.decode(game.proofBattleRecord(id, 2, index), (P.Row));
    }

    function _source(uint256 id, uint256 source) private view returns (bytes memory) {
        return game.proofBattleRecord(id, 3, source);
    }
    bytes32 constant SLOT = keccak256("veydrift.storage.proof-battle.v1");

    // Test storage injection only. There is deliberately NO production activation function.
    function _enableFixture() private {
        uint256 base = uint256(SLOT);
        vm.store(address(game), bytes32(base), bytes32(uint256(3)));
        vm.store(address(game), bytes32(base + 1), keccak256("candidate-2"));
        vm.store(address(game), bytes32(base + 2), keccak256("catalog-fixture"));
        // Existing random engine used only as a nonempty metadata address; it cannot verify proofs.
        vm.store(address(game), bytes32(base + 3), bytes32(uint256(uint160(address(randomness)))));
        vm.store(address(game), bytes32(base + 4), address(randomness).codehash);
    }

    function _fixture() private returns (uint256 origin, uint256 target, address defender) {
        (origin, target, defender) = _seedMoonAttackPlanets();
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(defender, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(player, Technology.Computer, 10);
        _fundPlanet(origin, 1_000_000, 1_000_000, 1_000_000);
        _setShipCount(origin, Ship.Battleship, 10);
        _setShipCount(target, Ship.LightFighter, 7);
    }

    function _commit(uint256 word) private {
        bytes32 commitment = randomness.randomnessCommitment(word);
        vm.prank(fulfiller);
        randomness.commitRandomness(commitment);
        vm.roll(block.number + 1);
    }

    function _launch(uint256 origin, uint256 target) private returns (uint256) {
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
            false
        );
    }

    function _prepare(uint256 id) private {
        (, uint64 arrival,,) = _fleetMission(id);
        vm.warp(arrival);
        for (uint256 i; i < 100; ++i) {
            (uint8 phase,,) = game.stagedBattleProgress(id);
            if (phase == 16) return;
            game.resolveFleetMission{gas: 15_000_000}(id);
        }
        fail("preparation did not finish");
    }

    function testInactiveOldFlightAndNewVersionFreeze() public {
        (uint256 origin, uint256 target,) = _fixture();
        assertEq(abi.decode(game.proofBattleRecord(0, 4, 0), (uint32)), 0);
        uint256 legacy = _launch(origin, target);
        _enableFixture();
        _commit(101);
        uint256 fresh = _launch(origin, target);
        (P.Version memory old,,,,,) = _status(legacy);
        (P.Version memory version,,,,,) = _status(fresh);
        assertEq(old.version, 0);
        assertEq(version.version, 3);
        vm.store(address(game), SLOT, bytes32(uint256(4)));
        (version,,,,,) = _status(fresh);
        assertEq(version.version, 3);
        _fulfillAttackBattleRandomness(legacy, 99);
        (, uint64 arrival,,) = _fleetMission(legacy);
        vm.warp(arrival);
        _resolveAttackFully(legacy);
        (G.FleetMissionStatus status,,,) = _fleetMission(legacy);
        assertTrue(status != G.FleetMissionStatus.Outbound);
        (, P.Phase phase,,,,) = _status(legacy);
        assertEq(uint8(phase), 0);
    }

    function testSnapshotBeforeRevealAwaitingProofAndImmutableRows() public {
        (uint256 origin, uint256 target, address defender) = _fixture();
        _setTechnologyLevel(defender, Technology.Weapons, 12);
        _enableFixture();
        _commit(1234);
        uint256 id = _launch(origin, target);
        (,,,,,,,,,, uint256 requestId) = game.fleetMission(id);
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.BattleSnapshotRequired.selector, requestId)
        );
        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, 1234);
        vm.recordLogs();
        _prepare(id);
        _assertStream(id);
        (, P.Phase phase, bytes32 snapshot,, uint256 seed, uint256 rows) = _status(id);
        assertEq(uint8(phase), uint8(P.Phase.AwaitingRandomness));
        assertEq(seed, 0);
        assertEq(rows, 2);
        assertTrue(snapshot != bytes32(0));
        P.Row memory resident = _row(id, 0);
        assertEq(resident.source, 0);
        assertEq(resident.owner, defender);
        assertEq(resident.count, 7);
        assertEq(resident.weapons, 12);
        uint256 start = gasleft();
        game.resolveFleetMission{gas: 15_000_000}(id);
        assertLt(start - gasleft(), 500_000, "pending reveal burned combat budget");
        vm.prank(admin);
        game.setRandomnessEngine(address(0xBEEF));
        _fulfillAttackBattleRandomness(id, 1234);
        game.resolveFleetMission{gas: 15_000_000}(id);
        bytes32 afterSnapshot;
        bytes32 context;
        (, phase, afterSnapshot, context, seed,) = _status(id);
        assertEq(uint8(phase), uint8(P.Phase.AwaitingProof));
        assertEq(seed, 1234);
        assertEq(snapshot, afterSnapshot);
        assertTrue(context != 0);
        for (uint256 i; i < 3; ++i) {
            game.resolveFleetMission{gas: 15_000_000}(id);
        }
        assertEq(game.shipCount(target, Ship.LightFighter), 7);
        assertEq(_row(id, 0).weapons, 12);
        vm.expectRevert(P.ProofPipelineUnavailable.selector);
        game.submitBattleProof(id, hex"1234", bytes32(uint256(1)));
        (G.FleetMissionStatus status,,,) = _fleetMission(id);
        assertEq(uint8(status), uint8(G.FleetMissionStatus.Outbound));
    }

    function testUnrelatedTransportAndDeployRemainProofFreeDuringOutage() public {
        (uint256 origin, uint256 target,) = _fixture();
        address other = address(0x999);
        vm.deal(other, 1 ether);
        vm.prank(other);
        uint256 third = game.startPlanet{value: 0.05 ether}();
        _setPlanetOwner(third, player);
        _setShipCount(origin, Ship.SmallCargo, 10);
        _enableFixture();
        _commit(777);
        uint256 attack = _launch(origin, target);
        uint256 nextRequest = randomness.nextRequestId();
        G.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 transport = game.launchBodyFleetMission(
            origin,
            third,
            G.FleetMissionType.Transport,
            ships,
            G.Resources(0, 0, 0),
            100,
            false,
            false
        );
        vm.prank(player);
        uint256 deploy = game.launchBodyFleetMission(
            origin, third, G.FleetMissionType.Deploy, ships, G.Resources(0, 0, 0), 100, false, false
        );
        assertEq(randomness.nextRequestId(), nextRequest);
        _prepare(attack);
        (, uint64 transportAt,,) = _fleetMission(transport);
        (, uint64 deployAt,,) = _fleetMission(deploy);
        vm.warp(transportAt > deployAt ? transportAt : deployAt);
        game.resolveFleetMission{gas: 15_000_000}(transport);
        game.resolveFleetMission{gas: 15_000_000}(deploy);
        (G.FleetMissionStatus t,,,) = _fleetMission(transport);
        (G.FleetMissionStatus d,,,) = _fleetMission(deploy);
        assertEq(uint8(t), uint8(G.FleetMissionStatus.Returning));
        assertEq(uint8(d), uint8(G.FleetMissionStatus.Resolved));
        (P.Version memory v,,,,,) = _status(transport);
        assertEq(v.version, 0);
        (v,,,,,) = _status(deploy);
        assertEq(v.version, 0);
        (, P.Phase p,,,,) = _status(attack);
        assertEq(uint8(p), uint8(P.Phase.AwaitingRandomness));
    }

    function testLaterDefenderTransportWaitsForEarlierProofBattle() public {
        (uint256 origin, uint256 target, address defender) = _fixture();
        address donor = address(0x987);
        vm.deal(donor, 1 ether);
        vm.prank(donor);
        uint256 source = game.startPlanet{value: 0.05 ether}();
        // Fixture ownership only; both real launch endpoints belong to the transport owner.
        _setPlanetLocation(source, defender, 1, 100, 10);
        _setShipCount(source, Ship.SmallCargo, 1);
        _fundPlanet(source, 1_000_000, 1_000_000, 1_000_000);
        _setTechnologyLevel(defender, Technology.Computer, 4);
        _enableFixture();
        _commit(778);
        uint256 attack = _launch(origin, target);
        G.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(defender);
        uint256 transport = game.launchBodyFleetMission(
            source,
            target,
            G.FleetMissionType.Transport,
            ships,
            G.Resources(0, 0, 0),
            100,
            false,
            false
        );
        (, uint64 attackAt,,) = _fleetMission(attack);
        (, uint64 transportAt,,) = _fleetMission(transport);
        assertGt(transportAt, attackAt);
        _prepare(attack);
        vm.warp(transportAt);
        vm.expectRevert(abi.encodeWithSelector(G.FleetMissionNotResolved.selector, attackAt));
        game.resolveFleetMission(transport);
        (P.Version memory version,,,,,) = _status(transport);
        assertEq(version.version, 0);
        (G.FleetMissionStatus status,,,) = _fleetMission(transport);
        assertEq(uint8(status), uint8(G.FleetMissionStatus.Outbound));
    }

    function testMultiCallEnrollmentKeepsOwnerResearchFrozen() public {
        (uint256 origin, uint256 target, address defender) = _fixture();
        _setShipCount(target, Ship.Cruiser, 4);
        _setTechnologyLevel(defender, Technology.Weapons, 12);
        _setTechnologyLevel(defender, Technology.Shielding, 8);
        _setTechnologyLevel(defender, Technology.Armor, 4);
        _enableFixture();
        _commit(779);
        uint256 id = _launch(origin, target);
        (, uint64 impact,,) = _fleetMission(id);
        vm.warp(impact);
        uint256 rows;
        for (uint256 i; i < 64 && rows == 0; ++i) {
            game.resolveFleetMission{gas: 1_500_000}(id);
            (,,,,, rows) = _status(id);
        }
        assertEq(rows, 1, "interrupt after first resident lane");
        assertEq(_row(id, 0).weapons, 12);
        // Simulate a changed current triple; continuation must use the already-frozen owner triple.
        // Real player mutations remain subject to existing pending-battle guards.
        _setTechnologyLevel(defender, Technology.Weapons, 99);
        _setTechnologyLevel(defender, Technology.Shielding, 99);
        _setTechnologyLevel(defender, Technology.Armor, 99);
        _prepare(id);
        P.Row memory cruiser = _row(id, 1);
        assertEq(cruiser.unit, uint8(Ship.Cruiser));
        assertEq(cruiser.weapons, 12);
        assertEq(cruiser.shielding, 8);
        assertEq(cruiser.armor, 4);
    }

    function testMoonResidentAndIncarnationNotPlanetInventory() public {
        (uint256 origin, uint256 target,) = _fixture();
        _setMoonShipCount(target, Ship.LightFighter, 5);
        _enableFixture();
        _commit(888);
        G.MissionShips memory ships;
        ships.battleship = 1;
        vm.prank(player);
        uint256 id = game.launchBodyFleetMission(
            origin, target, G.FleetMissionType.Attack, ships, G.Resources(0, 0, 0), 100, false, true
        );
        _prepare(id);
        assertEq(_row(id, 0).source, 0);
        assertEq(_row(id, 0).count, 5);
        bytes memory header = game.proofBattleRecord(id, 1, 0);
        uint256 body;
        uint256 isMoon;
        uint256 generation;
        uint256 recorded;
        assembly ("memory-safe") {
            body := mload(add(header, 32))
            isMoon := mload(add(header, 64))
            generation := mload(add(header, 96))
            recorded := mload(add(header, 128))
        }
        assertEq(body, target);
        assertEq(isMoon, 1);
        assertEq(recorded, 1);
        assertGt(generation, 0);
        assertEq(game.shipCount(target, Ship.LightFighter), 7);
    }

    function testNonBodyAttackSelectorAlsoRequestsGatedRandomness() public {
        (uint256 origin, uint256 target,) = _fixture();
        _enableFixture();
        _commit(999);
        G.MissionShips memory ships;
        ships.battleship = 1;
        vm.prank(player);
        uint256 id = game.launchFleetMission(
            origin, target, G.FleetMissionType.Attack, ships, G.Resources(0, 0, 0), 100, 0
        );
        (P.Version memory v,,,,,) = _status(id);
        assertEq(v.version, 3);
        (,,,,,,,,,, uint256 requestId) = game.fleetMission(id);
        (bool gated, bytes32 sealedHash) = randomness.battleRequestPolicy(requestId);
        assertTrue(gated);
        assertEq(sealedHash, bytes32(0));
    }

    function testProtectedAttackBypassesProofAndReturnsWithoutReveal() public {
        (uint256 origin, uint256 target, address defender) = _fixture();
        _enableFixture();
        _commit(555);
        uint256 id = _launch(origin, target);
        _setTechnologyLevel(defender, Technology.IntergalacticResearchNetwork, 0);
        _assertBypass(id);
    }

    function testMissingMoonBypassesProofAndReturnsWithoutReveal() public {
        (uint256 origin, uint256 target,) = _fixture();
        _enableFixture();
        _commit(556);
        G.MissionShips memory ships;
        ships.battleship = 1;
        vm.prank(player);
        uint256 id = game.launchBodyFleetMission(
            origin, target, G.FleetMissionType.Attack, ships, G.Resources(0, 0, 0), 100, false, true
        );
        _destroyMoonGuaranteed(target);
        _assertBypass(id);
    }

    function _assertBypass(uint256 id) private {
        (, uint64 at,,) = _fleetMission(id);
        vm.warp(at);
        _resolveAttackFully(id);
        (G.FleetMissionStatus status,,,) = _fleetMission(id);
        assertEq(uint8(status), uint8(G.FleetMissionStatus.Returning));
        (, P.Phase phase, bytes32 snapshot,,, uint256 rows) = _status(id);
        assertEq(uint8(phase), uint8(P.Phase.Bypassed));
        assertEq(snapshot, bytes32(0));
        assertEq(rows, 0);
        (,,,,,,,,,, uint256 requestId) = game.fleetMission(id);
        assertEq(randomness.request(requestId).fulfilledAt, 0);
        (, bytes32 gateSnapshot) = randomness.battleRequestPolicy(requestId);
        assertEq(gateSnapshot, bytes32(0));
    }

    function _assertStream(uint256 id) private view {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (P.Version memory version,, bytes32 expected,,, uint256 rows) = _status(id);
        (address engine, uint256 requestId, bytes32 purpose) =
            abi.decode(game.proofBattleRecord(id, 5, 0), (address, uint256, bytes32));
        bytes32 hash = keccak256(
            abi.encode(
                keccak256("veydrift.qualified-raw-battle.v1"),
                block.chainid,
                address(game),
                id,
                version,
                engine,
                requestId,
                purpose,
                game.proofBattleRecord(id, 1, 0)
            )
        );
        bytes32 sourceTopic = keccak256("ProofBattleSource(uint256,uint256,bytes)");
        bytes32 rowTopic = keccak256(
            "ProofBattleRow(uint256,uint256,(uint256,address,uint32,uint8,uint8,uint16,uint16,uint16))"
        );
        uint256 seen;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter != address(game) || logs[i].topics.length < 3
                    || uint256(logs[i].topics[1]) != id
            ) continue;
            if (logs[i].topics[0] == sourceTopic) {
                bytes memory data = abi.decode(logs[i].data, (bytes));
                assertEq(data, _source(id, uint256(logs[i].topics[2])));
                hash = keccak256(abi.encode(hash, uint8(1), uint256(logs[i].topics[2]), data));
            } else if (logs[i].topics[0] == rowTopic) {
                P.Row memory row = abi.decode(logs[i].data, (P.Row));
                assertEq(uint256(logs[i].topics[2]), seen++);
                hash = keccak256(abi.encode(hash, uint8(2), uint256(logs[i].topics[2]), row));
            }
        }
        assertEq(seen, rows);
        assertEq(keccak256(abi.encode(hash, uint8(3), rows)), expected);
    }

    function _array(uint256 key, uint256 slot, uint256[] memory values) private {
        bytes32 at = keccak256(abi.encode(key, slot));
        vm.store(address(game), at, bytes32(values.length));
        uint256 data = uint256(keccak256(abi.encode(at)));
        for (uint256 i; i < values.length; ++i) {
            vm.store(address(game), bytes32(data + i), bytes32(values[i]));
        }
    }

    function testQualifiedLinkedHeldBodyTimingAndDuplicateScans() public {
        (uint256 origin, uint256 target,) = _fixture();
        _enableFixture();
        _commit(2345);
        uint256 id = _launch(origin, target);
        (, uint64 impact,,) = _fleetMission(id);
        (uint256 linked, uint256 held, uint256 until, uint256 missions) =
            (new ProofFixtureSlots()).slots();
        uint256[] memory links = new uint256[](38);
        // 32 cheap historical records then valid ACS, valid hold, expired hold, wrong body.
        for (uint256 i; i < 32; ++i) {
            links[i] = 100 + i;
        }
        for (uint160 i; i < 6; ++i) {
            uint256 member = 200 + i;
            links[32 + i] = member;
            G.FleetMissionType typ =
                i == 0 ? G.FleetMissionType.AcsAttack : G.FleetMissionType.DefenseHold;
            _storeFleetMission(
                member,
                G.FleetMissionStatus.Outbound,
                typ,
                address(500 + i),
                origin,
                target,
                uint64(block.timestamp),
                i == 4 ? impact + 1 : impact,
                impact + 100
            );
            uint256 at = uint256(keccak256(abi.encode(member, missions)));
            // MissionShips.smallCargo at slot7; randomnessRequestId at slot9 (see GameStorage).
            vm.store(address(game), bytes32(at + 7), bytes32(uint256(3)));
            vm.store(address(game), bytes32(at + 9), bytes32(id));
            if (i == 3) vm.store(address(game), bytes32(at + 11), bytes32(uint256(1) << 8));
            vm.store(
                address(game),
                keccak256(abi.encode(member, until)),
                bytes32(uint256(i == 2 ? impact - 1 : impact + 100))
            );
        }
        _array(id, linked, links);
        uint256[] memory stationed = new uint256[](2);
        stationed[0] = 201;
        stationed[1] = 205;
        _array(target, held, stationed);
        _prepare(id);
        (,,,,, uint256 rows) = _status(id);
        // resident + leader + ACS200 + hold201 + hold205, each exactly once.
        assertEq(rows, 5);
        assertEq(_row(id, 2).source, 200);
        assertEq(_row(id, 3).source, 201);
        assertEq(_row(id, 4).source, 205);
        assertEq(_source(id, 202).length, 0);
        assertEq(_source(id, 203).length, 0);
        assertEq(_source(id, 204).length, 0);
    }
}
