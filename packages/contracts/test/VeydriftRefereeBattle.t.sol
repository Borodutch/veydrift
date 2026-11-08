// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Vm} from "forge-std/Vm.sol";
import {VeydriftMoonSystemTestBase} from "./VeydriftMoonSystem.t.sol";
import {VeydriftGameStorage as G} from "../src/VeydriftGameStorage.sol";
import {VeydriftRefereeBattle as P} from "../src/libraries/VeydriftRefereeBattle.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {Ship, Technology} from "../src/libraries/VeydriftTypes.sol";

import {RefereeFixtureSlots} from "./support/RefereeFixtureSlots.sol";
import {IRefereeGame, refereeRounds} from "./support/IRefereeGame.sol";

contract VeydriftRefereeBattleTest is VeydriftMoonSystemTestBase {
    function _status(uint256 id)
        private
        view
        returns (P.Version memory, P.Phase, bytes32, bytes32, uint256, uint256)
    {
        return abi.decode(
            IRefereeGame(address(game)).refereeBattleRecord(id, 0, 0),
            (P.Version, P.Phase, bytes32, bytes32, uint256, uint256)
        );
    }

    function _row(uint256 id, uint256 index) private view returns (P.Row memory) {
        return abi.decode(IRefereeGame(address(game)).refereeBattleRecord(id, 2, index), (P.Row));
    }

    function _source(uint256 id, uint256 source) private view returns (bytes memory) {
        return IRefereeGame(address(game)).refereeBattleRecord(id, 3, source);
    }
    bytes32 constant SLOT = keccak256("veydrift.storage.referee-battle.v1");

    address constant RESOLVER = address(0xBA771E);

    function _enableFixture() private {
        vm.prank(admin);
        IRefereeGame(address(game))
            .configureBattleReferee(
                P.Version(3, keccak256("candidate-2"), keccak256("catalog-fixture")), RESOLVER
            );
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
        (P.Version memory prospective, address resolver) = abi.decode(
            IRefereeGame(address(game)).refereeBattleRecord(0, 4, 0), (P.Version, address)
        );
        assertEq(prospective.version, 0);
        assertEq(resolver, address(0));
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

    function testSnapshotBeforeRevealAwaitingResultAndImmutableRows() public {
        (uint256 origin, uint256 target, address defender) = _fixture();
        _setTechnologyLevel(defender, Technology.Weapons, 12);
        _enableFixture();
        _commit(1234);
        uint256 id = _launch(origin, target);
        (,,,,,,,,,, uint256 requestId) = game.fleetMission(id);
        assertEq(requestId, 0, "launch binds no randomness");
        vm.recordLogs();
        (, uint64 impact,,) = _fleetMission(id);
        vm.warp(impact);
        // One stage per call: the gated request appears at `begin`, before the roster seal.
        for (uint256 i; i < 64 && requestId == 0; ++i) {
            game.resolveFleetMission{gas: 1_500_000}(id);
            (, requestId,) = abi.decode(
                IRefereeGame(address(game)).refereeBattleRecord(id, 5, 0),
                (address, uint256, bytes32)
            );
        }
        (uint8 stage,,) = game.stagedBattleProgress(id);
        assertLt(stage, 16, "requested before the seal");
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.BattleSnapshotRequired.selector, requestId)
        );
        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, 1234);
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
        assertEq(uint8(phase), uint8(P.Phase.AwaitingResult));
        assertEq(seed, 1234);
        assertEq(snapshot, afterSnapshot);
        assertTrue(context != 0);
        for (uint256 i; i < 3; ++i) {
            game.resolveFleetMission{gas: 15_000_000}(id);
        }
        assertEq(game.shipCount(target, Ship.LightFighter), 7);
        assertEq(_row(id, 0).weapons, 12);
        uint256[2] memory totals;
        vm.expectRevert(abi.encodeWithSelector(G.Unauthorized.selector, address(this)));
        IRefereeGame(address(game))
            .submitBattleResult(
                id, bytes32(uint256(1)), totals, bytes32(uint256(2)), refereeRounds(1, totals)
            );
        (G.FleetMissionStatus status,,,) = _fleetMission(id);
        assertEq(uint8(status), uint8(G.FleetMissionStatus.Outbound));
    }

    function testUnrelatedTransportAndDeployStayRefereeFreeWhilePending() public {
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

    function testLaterDefenderTransportWaitsForEarlierRefereeBattle() public {
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
        bytes memory header = IRefereeGame(address(game)).refereeBattleRecord(id, 1, 0);
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

    function testNonBodyAttackSelectorDefersGatedRandomnessToPreparation() public {
        (uint256 origin, uint256 target,) = _fixture();
        _enableFixture();
        _commit(999);
        G.MissionShips memory ships;
        ships.battleship = 1;
        uint256 nextRequest = randomness.nextRequestId();
        vm.prank(player);
        uint256 id = game.launchFleetMission(
            origin, target, G.FleetMissionType.Attack, ships, G.Resources(0, 0, 0), 100, 0
        );
        (P.Version memory v,,,,,) = _status(id);
        assertEq(v.version, 3);
        assertEq(randomness.nextRequestId(), nextRequest, "launch consumes no FIFO word");
        (,,,,,,,,,, uint256 requestId) = game.fleetMission(id);
        assertEq(requestId, 0);
        _prepare(id);
        (,,,,,,,,,, requestId) = game.fleetMission(id);
        (address engine, uint256 recorded,) = abi.decode(
            IRefereeGame(address(game)).refereeBattleRecord(id, 5, 0), (address, uint256, bytes32)
        );
        assertEq(engine, address(randomness));
        assertEq(recorded, requestId);
        assertEq(requestId, nextRequest);
        (bool gated, bytes32 sealedHash) = randomness.battleRequestPolicy(requestId);
        (,, bytes32 snapshot,,,) = _status(id);
        assertTrue(gated);
        assertEq(sealedHash, snapshot);
    }

    function testAllianceBlockedAttackBypassesRefereeWithoutRequest() public {
        (uint256 origin, uint256 target, address defender) = _fixture();
        VeydriftAllianceSystem alliance =
            new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)));
        vm.prank(admin);
        game.setAllianceSystem(address(alliance));
        _enableFixture();
        _commit(555);
        uint256 id = _launch(origin, target);
        // Joining the attacker's alliance in flight blocks the battle at preparation.
        vm.prank(player);
        uint256 allianceId = alliance.createAlliance("ATK", "Attackers", "ipfs://attackers");
        vm.prank(player);
        alliance.inviteMember(allianceId, defender);
        vm.prank(defender);
        alliance.acceptInvite(allianceId);
        _assertBypass(id);
    }

    function testMissingMoonBypassesRefereeAndReturnsWithoutReveal() public {
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
        // Bypassed before `begin`: no FIFO commitment was ever reserved for this battle.
        (,,,,,,,,,, uint256 requestId) = game.fleetMission(id);
        assertEq(requestId, 0);
        assertEq(randomness.readyCommitmentCount(), 1, "committed word still unused");
    }

    function _assertStream(uint256 id) private view {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (P.Version memory version,, bytes32 expected,,, uint256 rows) = _status(id);
        (address engine, uint256 requestId, bytes32 purpose) = abi.decode(
            IRefereeGame(address(game)).refereeBattleRecord(id, 5, 0), (address, uint256, bytes32)
        );
        bytes32 hash = keccak256(
            abi.encode(
                keccak256("veydrift.referee-battle.input.v1"),
                block.chainid,
                address(game),
                id,
                version,
                engine,
                requestId,
                purpose,
                IRefereeGame(address(game)).refereeBattleRecord(id, 1, 0)
            )
        );
        bytes32 sourceTopic = keccak256("RefereeBattleSource(uint256,uint256,bytes)");
        bytes32 rowTopic = keccak256(
            "RefereeBattleRow(uint256,uint256,(uint256,address,uint32,uint8,uint8,uint16,uint16,uint16))"
        );
        uint256 seen;
        uint256 snapshots;
        bytes32 snapshotTopic =
            keccak256("CombatMemberSnapshot(uint256,uint256,address,uint8,uint8,uint32)");
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == snapshotTopic && uint256(logs[i].topics[1]) == id) {
                ++snapshots;
            }
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
        assertEq(snapshots, rows, "battle report snapshot evidence per row");
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

    bytes32 constant RESOLVED_TOPIC = keccak256(
        "AttackBattleResolved(uint256,address,uint256,uint8,uint8,uint256,uint128,uint128,uint128)"
    );
    bytes32 constant SNAPSHOT_TOPIC =
        keccak256("CombatMemberSnapshot(uint256,uint256,address,uint8,uint8,uint32)");
    bytes32 constant EVIDENCE_TOPIC =
        keccak256("CombatEvidenceComplete(uint256,uint256,uint256,uint256,uint256)");
    bytes32 constant UNDEFENDED_TOPIC = keccak256("RefereeBattleUndefended(uint256)");

    function _attackWith(uint256 origin, uint256 target, bool moon) private returns (uint256) {
        _setShipCount(origin, Ship.SmallCargo, 10);
        G.MissionShips memory ships;
        ships.battleship = 2;
        ships.smallCargo = 3;
        vm.prank(player);
        return game.launchBodyFleetMission(
            origin, target, G.FleetMissionType.Attack, ships, G.Resources(0, 0, 0), 100, false, moon
        );
    }

    /// @dev Resolves with the production resolver's 2.5M work budget; returns the call count.
    function _resolveAtWorkBudget(uint256 id) private returns (uint256 calls) {
        (, uint64 impact,,) = _fleetMission(id);
        vm.warp(impact);
        for (; calls < 64; ++calls) {
            (G.FleetMissionStatus status,,,) = _fleetMission(id);
            if (status != G.FleetMissionStatus.Outbound) return calls;
            game.resolveFleetMission{gas: 2_500_000}(id);
        }
        fail("undefended attack did not settle");
    }

    function _assertUndefendedSettled(uint256 id, uint256 calls) private view {
        (G.FleetMissionStatus status,,,) = _fleetMission(id);
        assertEq(uint8(status), uint8(G.FleetMissionStatus.Returning));
        (, P.Phase phase, bytes32 snapshot,,, uint256 rows) = _status(id);
        assertEq(uint8(phase), uint8(P.Phase.Bypassed));
        assertEq(snapshot, bytes32(0));
        assertEq(rows, 0);
        (,,,,,,,,,, uint256 requestId) = game.fleetMission(id);
        assertEq(requestId, 0, "no gated randomness requested");
        assertEq(randomness.readyCommitmentCount(), 1, "committed word still unused");
        (uint8 stage,,) = game.stagedBattleProgress(id);
        assertEq(stage, 13);
        // Two calls today. Before: 24 resident-lane stages, the journal, seal, reveal wait,
        // referee submit and leaf application.
        assertLe(calls, 3, "undefended battle took too many resolver transactions");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint32[16] memory snapshots;
        uint256 snapshotCount;
        bool resolved;
        bool evidence;
        bool undefended;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length < 2 || uint256(logs[i].topics[1]) != id) continue;
            if (logs[i].topics[0] == SNAPSHOT_TOPIC) {
                (uint8 side, uint8 unit, uint32 count) =
                    abi.decode(logs[i].data, (uint8, uint8, uint32));
                assertEq(uint256(logs[i].topics[2]), id);
                assertEq(address(uint160(uint256(logs[i].topics[3]))), player);
                assertEq(side, 0);
                assertEq(snapshots[unit], 0, "one snapshot per lane");
                snapshots[unit] = count;
                ++snapshotCount;
            } else if (logs[i].topics[0] == RESOLVED_TOPIC) {
                (G.BattleOutcome outcome, uint8 rounds,,,,) = abi.decode(
                    logs[i].data, (G.BattleOutcome, uint8, uint256, uint128, uint128, uint128)
                );
                assertEq(uint8(outcome), uint8(G.BattleOutcome.AttackerWin));
                assertEq(rounds, 0);
                resolved = true;
            } else if (logs[i].topics[0] == EVIDENCE_TOPIC) {
                (uint256 count, uint256 losses,,) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                assertEq(count, 2);
                assertEq(losses, 0);
                evidence = true;
            } else if (logs[i].topics[0] == UNDEFENDED_TOPIC) {
                undefended = true;
            }
        }
        assertEq(snapshotCount, 2, "attacker snapshot evidence");
        assertEq(snapshots[uint8(Ship.Battleship)], 2);
        assertEq(snapshots[uint8(Ship.SmallCargo)], 3);
        assertTrue(resolved && evidence && undefended);
    }

    function testUndefendedPlanetSettlesWithoutRefereeOrReveal() public {
        (uint256 origin, uint256 target,) = _fixture();
        _setShipCount(target, Ship.LightFighter, 0);
        _fundPlanet(target, 100_000, 100_000, 100_000);
        _enableFixture();
        _commit(4321);
        uint256 id = _attackWith(origin, target, false);
        vm.recordLogs();
        uint256 calls = _resolveAtWorkBudget(id);
        _assertUndefendedSettled(id, calls);
        (,,, G.Resources memory cargo) = _fleetMission(id);
        assertGt(uint256(cargo.metal) + cargo.crystal + cargo.deuterium, 0, "raid still loots");
    }

    /// The fast path settles exactly like a full battle with no defender (here the staged path
    /// the referee replaced, which fights the same zero-round battle with randomness).
    function testUndefendedFastPathMatchesFullBattleEconomics() public {
        (uint256 origin, uint256 target,) = _fixture();
        _setShipCount(target, Ship.LightFighter, 0);
        _fundPlanet(target, 100_000, 200_000, 50_000);
        uint256 base = vm.snapshotState();
        _enableFixture();
        _commit(4325);
        uint256 fast = _attackWith(origin, target, false);
        _resolveAtWorkBudget(fast);
        (G.FleetMissionStatus fastStatus,, uint64 fastReturn, G.Resources memory fastCargo) =
            _fleetMission(fast);
        (, P.Phase phase,,,,) = _status(fast);
        assertEq(uint8(phase), uint8(P.Phase.Bypassed));

        vm.revertToState(base);
        uint256 full = _attackWith(origin, target, false);
        assertEq(full, fast);
        _fulfillAttackBattleRandomness(full, 4325);
        (, uint64 impact,,) = _fleetMission(full);
        vm.warp(impact);
        _resolveAttackFully(full);
        (G.FleetMissionStatus status,, uint64 returnAt, G.Resources memory cargo) =
            _fleetMission(full);
        (P.Version memory version,,,,,) = _status(full);
        assertEq(version.version, 0, "full battle took the randomness path");
        assertEq(uint8(status), uint8(fastStatus));
        assertEq(returnAt, fastReturn);
        assertEq(cargo.metal, fastCargo.metal);
        assertEq(cargo.crystal, fastCargo.crystal);
        assertEq(cargo.deuterium, fastCargo.deuterium);
        assertGt(uint256(cargo.metal) + cargo.crystal + cargo.deuterium, 0);
    }

    function testUndefendedMoonIgnoresParentPlanetFleetAndReleasesFreeze() public {
        (uint256 origin, uint256 target, address defender) = _fixture();
        _enableFixture();
        _commit(4322);
        uint256 id = _attackWith(origin, target, true);
        vm.recordLogs();
        uint256 calls = _resolveAtWorkBudget(id);
        _assertUndefendedSettled(id, calls);
        assertEq(game.shipCount(target, Ship.LightFighter), 7);
        // The moon combat freeze taken at preparation is released by the staged finish.
        vm.prank(defender);
        moons.finishMoonBuildingUpgrade(target);
    }

    function _assertKeepsReferee(uint256 id, uint256 rows) private {
        _prepare(id);
        (, P.Phase phase,,,, uint256 recorded) = _status(id);
        assertEq(uint8(phase), uint8(P.Phase.AwaitingRandomness));
        assertEq(recorded, rows);
    }

    function testDefenseOnlyTargetKeepsRefereeRowsInLaneOrder() public {
        (uint256 origin, uint256 target, address defender) = _fixture();
        _setShipCount(target, Ship.LightFighter, 0);
        _setShipCount(target, Ship.SmallCargo, 2);
        // _defenseCounts (slot 19): RocketLauncher (0) and LargeShieldDome (7).
        bytes32 outer = keccak256(abi.encode(target, uint256(19)));
        vm.store(address(game), keccak256(abi.encode(uint256(0), outer)), bytes32(uint256(3)));
        vm.store(address(game), keccak256(abi.encode(uint256(7), outer)), bytes32(uint256(1)));
        _enableFixture();
        _commit(4323);
        uint256 id = _launch(origin, target);
        _assertKeepsReferee(id, 4);
        uint8[4] memory lanes = [uint8(Ship.SmallCargo), 16, 23, uint8(Ship.Battleship)];
        uint32[4] memory counts = [uint32(2), 3, 1, 1];
        for (uint256 i; i < 4; ++i) {
            P.Row memory row = _row(id, i);
            assertEq(row.unit, lanes[i]);
            assertEq(row.count, counts[i]);
            assertEq(row.owner, i == 3 ? player : defender);
        }
    }

    function testSatelliteOrCrawlerOnlyTargetKeepsReferee() public {
        (uint256 origin, uint256 target,) = _fixture();
        _setShipCount(target, Ship.LightFighter, 0);
        _enableFixture();
        uint256 base = vm.snapshotState();
        Ship[2] memory lanes = [Ship.SolarSatellite, Ship.Crawler];
        for (uint256 i; i < 2; ++i) {
            vm.revertToState(base);
            _setShipCount(target, lanes[i], 4);
            _commit(4326 + i);
            uint256 id = _launch(origin, target);
            _assertKeepsReferee(id, 2);
            assertEq(_row(id, 0).unit, uint8(lanes[i]));
        }
    }

    function testEmptyTargetWithLinkedOrStationedRecordKeepsReferee() public {
        (uint256 origin, uint256 target,) = _fixture();
        _setShipCount(target, Ship.LightFighter, 0);
        _enableFixture();
        (uint256 linked, uint256 held,,) = (new RefereeFixtureSlots()).slots();
        uint256 base = vm.snapshotState();
        for (uint256 i; i < 2; ++i) {
            vm.revertToState(base);
            _commit(4324 + i);
            uint256 id = _launch(origin, target);
            uint256[] memory records = new uint256[](1);
            // A historical non-qualifying record: the fast path stays conservative.
            records[0] = 100;
            if (i == 0) _array(id, linked, records);
            else _array(target, held, records);
            _assertKeepsReferee(id, 1);
            assertEq(_row(id, 0).owner, player);
        }
    }

    function testQualifiedLinkedHeldBodyTimingAndDuplicateScans() public {
        (uint256 origin, uint256 target,) = _fixture();
        _enableFixture();
        _commit(2345);
        uint256 id = _launch(origin, target);
        (, uint64 impact,,) = _fleetMission(id);
        (uint256 linked, uint256 held, uint256 until, uint256 missions) =
            (new RefereeFixtureSlots()).slots();
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
