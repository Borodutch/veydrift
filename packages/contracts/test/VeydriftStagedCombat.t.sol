// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Vm} from "forge-std/Vm.sol";
import {ProductionBatchTransactionProbe} from "./ProductionBatchTransactionProbe.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftResourceReserves} from "../src/VeydriftResourceReserves.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftStagedCombatModule} from "../src/VeydriftStagedCombatModule.sol";
import {
    VeydriftLegacyCombatModule,
    VeydriftLegacyCombatRapidfire
} from "../src/VeydriftLegacyCombatModule.sol";
import {VeydriftCombatRaidModule} from "../src/VeydriftCombatRaidModule.sol";
import {
    VeydriftStagedBattleStorage as Store
} from "../src/libraries/VeydriftStagedBattleStorage.sol";
import {Ship, Defense, Technology} from "../src/libraries/VeydriftTypes.sol";

/// Storage-compatible facade: all resolver/recall calls use the real Gameplay delegatecall,
/// its self-only round call, the real Combat router and real Staged/Legacy/Raid modules.
/// Only unrelated external dependencies are deterministic fixture adapters. No combat math is mocked.
contract StagedLifecycleFacade is VeydriftResourceReserves {
    address private immutable gameplay;
    address private immutable raid;

    constructor(address gameplay_, address raid_, address randomness_)
        VeydriftResourceReserves(msg.sender)
    {
        gameplay = gameplay_;
        raid = raid_;
        _randomnessEngine = randomness_;
    }

    fallback() external {
        // Protection preview: (reason, flags, plunderBps).
        if (msg.sig == 0xdca08aaf) {
            bytes memory result = abi.encode(uint8(0), uint8(0), uint16(5000));
            assembly ("memory-safe") { return(add(result, 32), mload(result)) }
        }
        address module = msg.sig == 0x41dfa622 ? raid : gameplay;
        (bool ok, bytes memory data) = module.delegatecall(msg.data);
        assembly ("memory-safe") {
            if iszero(ok) { revert(add(data, 32), mload(data)) }
            return(add(data, 32), mload(data))
        }
    }

    function launchInterplanetaryMissileAttack(uint256, uint256, Defense, uint32)
        external
        view
        returns (uint256)
    {
        require(msg.sender == address(this));
        return 1;
    }

    function completeAttackTargetSnapshotQueues(uint256, uint64) external view {
        require(msg.sender == address(this));
    }

    function settleProductionUntil(uint256, uint64) external view {
        require(msg.sender == address(this));
    }

    function settleDuePlayerCombatArrivals(address) external view {
        require(msg.sender == address(this));
    }

    function raidRiftExtraction(address, uint256, uint256, uint16, uint16, uint16)
        external
        view
        returns (Resources memory)
    {
        require(msg.sender == address(this));
        return Resources(0, 0, 0);
    }

    function planet(uint256 id, address owner) external {
        _planets[id].owner = owner;
        _planets[id].lastSettledAt = uint64(block.timestamp);
    }

    function seedMission(uint256 id, FleetMission calldata mission_) external {
        _fleetMissions[id] = mission_;
        ++activeFleetMissionCount[mission_.owner];
        // Fixture funding: balances are seeded, not minted through reserve-token deposits.
        _totalInternalResources = _add(_totalInternalResources, mission_.cargo);
        _trackMissionResolution(id, _fleetMissions[id]);
    }

    function link(uint256 id, uint256 member) external {
        _fleetCounterplayMissions[id].push(member);
    }

    function hold(uint256 id, uint64 until) external {
        uint256 target = _fleetMissions[id].targetPlanetId;
        _stationedDefenseMissions[target].push(id);
        _stationedDefenseMissionIndex[target][id] = _stationedDefenseMissions[target].length;
        _defenseHoldUntil[id] = until;
    }

    function resources(uint256 id, Resources calldata value) external {
        _planets[id].resources = value;
        _totalInternalResources = _add(_totalInternalResources, value);
    }

    function balance(uint256 id) external view returns (Resources memory) {
        return _planets[id].resources;
    }

    function resident(uint256 id, uint32 count) external {
        for (uint8 u; u < 16; ++u) {
            _setPlanetShipCount(id, Ship(u), count);
        }
        for (uint8 u; u < 8; ++u) {
            _setPlanetDefenseCount(
                id,
                Defense(u),
                (u == uint8(Defense.SmallShieldDome) || u == uint8(Defense.LargeShieldDome))
                    ? 1
                    : count
            );
        }
    }

    function tech(address owner, uint16 level) external {
        _technologyLevels[owner][Technology.Weapons] = level;
        _technologyLevels[owner][Technology.Shielding] = level;
        _technologyLevels[owner][Technology.Armor] = level;
    }

    function legacy(uint256 id, uint8 rounds, uint256 seed) external {
        _battleResolutionProgress[id].rounds = rounds;
        _battleResolutionProgress[id].seed = seed;
        _battleRaidProtectionSnapshotted[id] = true;
        _battleRaidPlunderBps[id] = 5000;
    }

    function legacyProgress(uint256 id) external view returns (uint8, uint256) {
        return (_battleResolutionProgress[id].rounds, _battleResolutionProgress[id].seed);
    }

    function mission(uint256 id) external view returns (FleetMission memory) {
        return _fleetMissions[id];
    }

    function progress(uint256 id)
        external
        view
        returns (uint8 phase, uint8 rounds, uint256 work, uint256 seed)
    {
        Store.Battle storage b = Store.battle(id);
        return (
            b.phase,
            b.phase == 13 ? b.round : _battleResolutionProgress[id].rounds,
            b.workDone + b.math.workDone,
            b.seed
        );
    }

    function enrolled(uint256 id, uint256 member) external view returns (bool) {
        return Store.battle(id).enrolled[member];
    }

    function memberCount(uint256 id) external view returns (uint256) {
        return Store.battle(id).members.length;
    }

    function bodyLock(uint256 id) external view returns (uint256) {
        return Store.layout().bodyLock[id];
    }

    function holdState(uint256 id) external view returns (uint64, uint256, uint256) {
        uint256 target = _fleetMissions[id].targetPlanetId;
        return (
            _defenseHoldUntil[id],
            _stationedDefenseMissionIndex[target][id],
            _stationedDefenseMissions[target].length
        );
    }

    function totals(uint256 id) external view returns (uint256, uint256) {
        return (Store.battle(id).math.sides[0].total, Store.battle(id).math.sides[1].total);
    }

    function sideCounts(uint256 id)
        external
        view
        returns (uint256[24] memory a, uint256[24] memory d)
    {
        Store.Battle storage b = Store.battle(id);
        for (uint256 i; i < b.members.length; ++i) {
            Store.Member storage m = b.members[i];
            if (m.side == 0) a[m.unit] += m.count;
            else d[m.unit] += m.count;
        }
    }
}

contract StagedFixedRandomness {
    fallback(bytes calldata) external returns (bytes memory) {
        return abi.encode(uint256(919));
    }
}

interface IStagedLifecycle {
    function resolveFleetMission(uint256 id) external;
    function resolveFleetMissionCombatRound(uint256 id) external returns (bool);
    function recallFleetMission(uint256 id) external;
}

contract VeydriftStagedCombatTest is Test {
    StagedLifecycleFacade internal game;
    address internal gameplay;
    address internal raid;
    address internal randomness;
    uint64 internal constant IMPACT = 10000;
    uint256 internal constant GAS_LIMIT = 15_000_000;
    uint256 internal constant ATTACK = 1;
    uint256 internal constant TARGET = 99;
    bytes32 internal constant SNAPSHOT =
        keccak256("CombatMemberSnapshot(uint256,uint256,address,uint8,uint8,uint32)");
    bytes32 internal constant RESOLVED =
        keccak256("FleetMissionResolved(uint256,address,uint8,uint64)");

    function setUp() public {
        vm.warp(IMPACT);
        address rapidfire = address(new VeydriftCombatRapidfire());
        address staged = address(new VeydriftStagedCombatModule(rapidfire));
        address legacyModule =
            address(new VeydriftLegacyCombatModule(address(new VeydriftLegacyCombatRapidfire())));
        address combat = address(new VeydriftCombatModule(rapidfire, staged, legacyModule));
        gameplay = address(new VeydriftGameplayModule(combat));
        raid = address(new VeydriftCombatRaidModule());
        randomness = address(new StagedFixedRandomness());
        game = _newGame();
    }

    function _newGame() internal returns (StagedLifecycleFacade g) {
        g = new StagedLifecycleFacade(gameplay, raid, randomness);
        g.planet(TARGET, address(0xD));
    }

    function _ships(uint32 n) internal pure returns (VeydriftGameStorage.MissionShips memory) {
        return VeydriftGameStorage.MissionShips(n, n, n, n, n, n, n, n, n, n, n, n, n, n);
    }

    function _mission(uint256 id, VeydriftGameStorage.FleetMissionType kind, uint32 n)
        internal
        pure
        returns (VeydriftGameStorage.FleetMission memory m)
    {
        m.status = VeydriftGameStorage.FleetMissionStatus.Outbound;
        m.missionType = kind;
        m.owner = address(SafeCast.toUint160(100 + id));
        m.originPlanetId = 100 + id;
        m.targetPlanetId = TARGET;
        m.departureAt = 100;
        m.arrivalAt = IMPACT;
        m.returnAt = IMPACT + 1000;
        m.ships = _ships(n);
        m.randomnessRequestId = kind == VeydriftGameStorage.FleetMissionType.Attack ? 919 : ATTACK;
    }

    function _seedLeader(uint32 n) internal {
        game.seedMission(ATTACK, _mission(ATTACK, VeydriftGameStorage.FleetMissionType.Attack, n));
    }

    function _resolve(StagedLifecycleFacade g, uint256 id) internal returns (uint256 used) {
        uint256 beforeGas = gasleft();
        (bool ok, bytes memory data) = address(g).call{gas: GAS_LIMIT}(
            abi.encodeCall(IStagedLifecycle.resolveFleetMission, (id))
        );
        used = beforeGas - gasleft();
        if (!ok) assembly ("memory-safe") { revert(add(data, 32), mload(data)) }
        // The capped child call is the limit proof; this includes call overhead too.
        assertLt(used, GAS_LIMIT, "resolve envelope exceeds 15M");
    }

    /// Below one stage budget plus reserve: commits exactly one bounded stage. A stage heavier
    /// than that budget runs out of gas atomically and is retried with the full envelope.
    function _stage(uint256 id) internal {
        (bool ok, bytes memory data) = address(game).call{gas: 5_450_000}(
            abi.encodeCall(IStagedLifecycle.resolveFleetMission, (id))
        );
        if (ok) return;
        if (data.length != 0) assembly ("memory-safe") { revert(add(data, 32), mload(data)) }
        _resolve(game, id);
    }

    function _finish(StagedLifecycleFacade g) internal returns (uint256 calls, uint256 peak) {
        (uint8 phase,, uint256 work, uint256 seed) = g.progress(ATTACK);
        for (; calls < 30000 && phase != 13; ++calls) {
            assertEq(
                uint8(g.mission(ATTACK).status),
                uint8(VeydriftGameStorage.FleetMissionStatus.Outbound),
                "leader terminal before settlement"
            );
            uint256 used = _resolve(g, ATTACK);
            if (used > peak) peak = used;
            (uint8 next,, uint256 nextWork, uint256 nextSeed) = g.progress(ATTACK);
            assertGt(nextWork, work, "successful call made no durable progress");
            // Protection preparation (14/15) precedes the first oracle seed capture.
            if (seed != 0) assertEq(nextSeed, seed, "seed changed");
            assertEq(g.bodyLock(TARGET), next == 13 ? 0 : ATTACK, "body lock released early");
            phase = next;
            work = nextWork;
            seed = nextSeed;
        }
        assertEq(phase, 13, "battle never finishes");
    }

    function _enroll() internal {
        for (uint256 i; i < 200; ++i) {
            (uint8 phase,,,) = game.progress(ATTACK);
            if (phase >= 6 && phase <= 13) return;
            _resolve(game, ATTACK);
        }
        fail("enrollment did not finish");
    }

    function testLinkedReturnEpochSurvivesWarpsAndReversedEnrollment() public {
        uint64[3] memory forward = _returnEpochScenario(false);
        game = _newGame();
        vm.warp(IMPACT);
        uint64[3] memory reverse = _returnEpochScenario(true);
        for (uint256 i; i < 3; ++i) {
            assertEq(forward[i], reverse[i], "enrollment order changed deadline");
            assertEq(forward[i], IMPACT + 1000, "chunk delay changed return deadline");
        }
    }

    function _returnEpochScenario(bool reverse) private returns (uint64[3] memory deadlines) {
        _seedLeader(1);
        for (uint256 i; i < 3; ++i) {
            uint256 id = reverse ? 4 - i : 2 + i;
            game.seedMission(id, _mission(id, VeydriftGameStorage.FleetMissionType.AcsAttack, 1));
            game.link(ATTACK, id);
        }
        for (uint256 i; i < 200; ++i) {
            (uint8 currentPhase,,,) = game.progress(ATTACK);
            if (currentPhase == 12) break;
            _stage(ATTACK);
        }
        (uint8 phase,,,) = game.progress(ATTACK);
        assertEq(phase, 12, "returns not ready");
        for (uint256 i; i < 20 && phase != 13; ++i) {
            vm.warp(block.timestamp + 100);
            vm.prank(address(SafeCast.toUint160(900 + i)));
            _stage(ATTACK);
            (phase,,,) = game.progress(ATTACK);
        }
        assertEq(phase, 13);
        for (uint256 i; i < 3; ++i) {
            VeydriftGameStorage.FleetMission memory m = game.mission(i + 2);
            assertEq(uint8(m.status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
            deadlines[i] = m.returnAt;
        }
    }

    /// The canonical per-file runner supplies aggregate driver gas; each resolve stays capped at 15M.
    /// forge-config: default.isolate = true
    function testSevenOwnersAllMobileResidentSupportAndDefensesCold15M() public {
        ProductionBatchTransactionProbe probe = new ProductionBatchTransactionProbe();
        probe.write(1);
        (uint256 storageGas, uint256 transientValue) = probe.write(2);
        assertGe(storageGas, 5000, "isolated transaction boundaries required");
        assertEq(transientValue, 0, "transient state must clear between transactions");
        _seedLeader(1000);
        game.tech(address(101), 8);
        game.tech(address(0xD), 8);
        for (uint256 id = 2; id <= 14; ++id) {
            VeydriftGameStorage.FleetMissionType kind = id <= 7
                ? VeydriftGameStorage.FleetMissionType.AcsAttack
                : VeydriftGameStorage.FleetMissionType.DefenseHold;
            game.seedMission(id, _mission(id, kind, 1000));
            game.tech(address(SafeCast.toUint160(100 + id)), SafeCast.toUint16(8 + (id - 1) % 7));
            if (id <= 7) game.link(ATTACK, id);
            else game.hold(id, IMPACT + 1000);
        }
        game.resident(TARGET, 1000);
        _enroll();
        assertEq(
            game.memberCount(ATTACK), 14 * 14 + 24, "all mobile/support/defense lanes enrolled"
        );
        (uint256 calls, uint256 peak) = _finish(game);
        emit log_named_uint("resolver calls after enrollment", calls);
        emit log_named_uint("peak isolated resolver gas", peak);
        (uint8 phase,, uint256 work, uint256 seed) = game.progress(ATTACK);
        bytes32 state = keccak256(abi.encode(game.mission(ATTACK), game.totalInternalResources()));
        vm.recordLogs();
        _resolve(game, ATTACK);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 0, "duplicate terminal emitted events");
        (uint8 afterPhase,, uint256 afterWork, uint256 afterSeed) = game.progress(ATTACK);
        assertEq(afterPhase, phase);
        assertEq(afterWork, work);
        assertEq(afterSeed, seed);
        assertEq(keccak256(abi.encode(game.mission(ATTACK), game.totalInternalResources())), state);
    }

    /// forge-config: default.isolate = true
    function testIdenticalTechPartitionAndEnrollmentOrderExactSideParity() public {
        StagedLifecycleFacade merged = game;
        merged.seedMission(
            ATTACK, _mission(ATTACK, VeydriftGameStorage.FleetMissionType.Attack, 21)
        );
        merged.resident(TARGET, 15);
        _finish(merged);
        (uint256[24] memory expectedA, uint256[24] memory expectedD) = merged.sideCounts(ATTACK);
        for (uint256 order; order < 2; ++order) {
            game = _newGame();
            _seedLeader(7);
            game.resident(TARGET, 15);
            for (uint256 j; j < 2; ++j) {
                uint256 id = order == 0 ? j + 2 : 3 - j;
                game.seedMission(
                    id, _mission(id, VeydriftGameStorage.FleetMissionType.AcsAttack, 7)
                );
                game.link(ATTACK, id);
            }
            _finish(game);
            (uint256[24] memory actualA, uint256[24] memory actualD) = game.sideCounts(ATTACK);
            assertEq(
                abi.encode(actualA),
                abi.encode(expectedA),
                "attacker partition/order changed combat"
            );
            assertEq(
                abi.encode(actualD),
                abi.encode(expectedD),
                "defender partition/order changed combat"
            );
            (,,, uint256 seed) = game.progress(ATTACK);
            (,,, uint256 expectedSeed) = merged.progress(ATTACK);
            assertEq(seed, expectedSeed);
        }
    }

    function testWipedHoldDeduplicatedCargoSlotsAndRemovalExactlyOnce() public {
        VeydriftGameStorage.FleetMission memory a =
            _mission(ATTACK, VeydriftGameStorage.FleetMissionType.Attack, 0);
        a.ships.deathstar = 1000;
        game.seedMission(ATTACK, a);
        VeydriftGameStorage.FleetMission memory d =
            _mission(2, VeydriftGameStorage.FleetMissionType.DefenseHold, 0);
        d.ships.smallCargo = 1;
        d.cargo = VeydriftGameStorage.Resources(11, 22, 33);
        game.seedMission(2, d);
        game.hold(2, IMPACT + 100);
        game.link(ATTACK, 2);
        game.link(ATTACK, 2);
        vm.recordLogs();
        _finish(game);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 snapshots;
        uint256 resolved;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(game)) continue;
            if (logs[i].topics[0] == SNAPSHOT && uint256(logs[i].topics[2]) == 2) ++snapshots;
            if (logs[i].topics[0] == RESOLVED && uint256(logs[i].topics[1]) == 2) ++resolved;
        }
        assertEq(snapshots, 1, "hold enrolled repeatedly");
        assertEq(resolved, 1, "hold terminalized repeatedly");
        d = game.mission(2);
        assertEq(uint8(d.status), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertEq(d.ships.smallCargo, 0);
        assertEq(abi.encode(d.cargo), abi.encode(VeydriftGameStorage.Resources(0, 0, 0)));
        assertEq(game.activeFleetMissionCount(d.owner), 0);
        assertEq(
            abi.encode(game.totalInternalResources()),
            abi.encode(VeydriftGameStorage.Resources(0, 0, 0))
        );
        (uint64 until, uint256 index, uint256 length) = game.holdState(2);
        assertEq(until, 0);
        assertEq(index, 0);
        assertEq(length, 0);
        _resolve(game, ATTACK);
        assertEq(game.activeFleetMissionCount(d.owner), 0);
    }

    function testRaidCreditsOnlyAcquiredLootOnceAndConservesResources() public {
        for (uint256 id = 1; id <= 2; ++id) {
            VeydriftGameStorage.FleetMission memory seeded = _mission(
                id,
                id == 1
                    ? VeydriftGameStorage.FleetMissionType.Attack
                    : VeydriftGameStorage.FleetMissionType.AcsAttack,
                0
            );
            seeded.ships.smallCargo = 2;
            seeded.cargo = VeydriftGameStorage.Resources(7, 11, 13);
            game.seedMission(id, seeded);
            if (id == 2) game.link(ATTACK, id);
        }
        game.resources(TARGET, VeydriftGameStorage.Resources(1000, 1000, 1000));
        bytes memory beforeAccounting = abi.encode(game.totalInternalResources());
        vm.recordLogs();
        _finish(game);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 events;
        uint256 metal;
        uint256 crystal;
        uint256 deuterium;
        bytes32 lootTopic = keccak256("CombatMissionLoot(uint256,uint256,uint128,uint128,uint128)");
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(game) && logs[i].topics[0] == lootTopic) {
                (uint128 m, uint128 c, uint128 d) =
                    abi.decode(logs[i].data, (uint128, uint128, uint128));
                metal += m;
                crystal += c;
                deuterium += d;
                ++events;
            }
        }
        assertEq(events, 2);
        assertEq(metal, 500);
        assertEq(crystal, 500);
        assertEq(deuterium, 500);
        VeydriftGameStorage.FleetMission memory a = game.mission(1);
        VeydriftGameStorage.FleetMission memory b = game.mission(2);
        assertEq(uint256(a.cargo.metal) + b.cargo.metal, 514);
        assertEq(uint256(a.cargo.crystal) + b.cargo.crystal, 522);
        assertEq(uint256(a.cargo.deuterium) + b.cargo.deuterium, 526);
        assertEq(
            abi.encode(game.balance(TARGET)),
            abi.encode(VeydriftGameStorage.Resources(500, 500, 500))
        );
        assertEq(abi.encode(game.totalInternalResources()), beforeAccounting);
        assertEq(game.activeFleetMissionCount(a.owner), 1);
        assertEq(game.activeFleetMissionCount(b.owner), 1);
        vm.recordLogs();
        _resolve(game, ATTACK);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function testDefenderQualificationExcludesOtherBodyLateRecalledAndExpired() public {
        _seedLeader(2);
        for (uint256 id = 2; id <= 6; ++id) {
            VeydriftGameStorage.FleetMission memory d =
                _mission(id, VeydriftGameStorage.FleetMissionType.DefenseHold, 1);
            if (id == 2) d.targetIsMoon = true;
            if (id == 3) d.arrivalAt = IMPACT + 1;
            if (id == 4) d.status = VeydriftGameStorage.FleetMissionStatus.Recalled;
            game.seedMission(id, d);
            // Hold end is inclusive: id 6 ends exactly at impact and still defends.
            game.hold(id, id == 5 ? IMPACT - 1 : id == 6 ? IMPACT : IMPACT + 100);
        }
        _enroll();
        for (uint256 id = 2; id <= 5; ++id) {
            assertFalse(game.enrolled(ATTACK, id), "ineligible defender enrolled");
        }
        assertTrue(game.enrolled(ATTACK, 6));
    }

    function testJoinedAttackerQualificationExcludesOtherBodyLateAndRecalled() public {
        _seedLeader(2);
        for (uint256 id = 2; id <= 5; ++id) {
            VeydriftGameStorage.FleetMission memory a =
                _mission(id, VeydriftGameStorage.FleetMissionType.AcsAttack, 1);
            if (id == 2) a.targetIsMoon = true;
            if (id == 3) a.arrivalAt = IMPACT + 1;
            if (id == 4) a.status = VeydriftGameStorage.FleetMissionStatus.Recalled;
            game.seedMission(id, a);
            game.link(ATTACK, id);
        }
        _enroll();
        for (uint256 id = 2; id <= 4; ++id) {
            assertFalse(game.enrolled(ATTACK, id), "ineligible attacker enrolled");
        }
        assertTrue(game.enrolled(ATTACK, 5));
    }

    function testNoProgressLowGasRevertsAndCannotPartiallyCommit() public {
        _seedLeader(1);
        game.resident(TARGET, 1);
        (bool ok,) = address(game).call{gas: 25000}(
            abi.encodeCall(IStagedLifecycle.resolveFleetMission, (ATTACK))
        );
        assertFalse(ok, "insufficient gas succeeded without progress");
        (uint8 phase,, uint256 work, uint256 seed) = game.progress(ATTACK);
        assertEq(phase, 0);
        assertEq(work, 0);
        assertEq(seed, 0);
        assertEq(game.bodyLock(TARGET), 0);
        _resolve(game, ATTACK);
        (phase,, work, seed) = game.progress(ATTACK);
        assertTrue(phase != 0, "successful call did not start preparation");
        assertGt(work, 0, "successful call made no durable progress");
        assertEq(game.bodyLock(TARGET), ATTACK);
        for (uint256 i; seed == 0 && i < 20; ++i) {
            uint256 previousWork = work;
            _resolve(game, ATTACK);
            (phase,, work, seed) = game.progress(ATTACK);
            assertGt(work, previousWork, "pre-seed preparation made no progress");
        }
        assertGt(seed, 0, "preparation never captured randomness");
    }

    function testSelfOnlyRoundEntryAndActiveBodyMutationProtection() public {
        _seedLeader(1);
        game.resident(TARGET, 1);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.Unauthorized.selector, address(this))
        );
        IStagedLifecycle(address(game)).resolveFleetMissionCombatRound(ATTACK);
        _resolve(game, ATTACK);
        VeydriftGameStorage.FleetMission memory a =
            _mission(2, VeydriftGameStorage.FleetMissionType.Attack, 1);
        game.seedMission(2, a);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.FleetMissionNotResolved.selector, IMPACT)
        );
        IStagedLifecycle(address(game)).resolveFleetMission(2);
        // A future ACS member cannot recall while its target body is locked.
        a = _mission(3, VeydriftGameStorage.FleetMissionType.AcsAttack, 1);
        a.arrivalAt = IMPACT + 1000;
        game.seedMission(3, a);
        vm.prank(a.owner);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.FleetMissionNotResolved.selector, IMPACT)
        );
        IStagedLifecycle(address(game)).recallFleetMission(3);
        assertEq(
            uint8(game.mission(3).status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound)
        );
    }

    function testLegacyInProgressUsesSavedSeedWithoutStartingStagedBattle() public {
        _seedLeader(1);
        game.resident(TARGET, 1);
        game.legacy(ATTACK, 1, 123456);
        _resolve(game, ATTACK);
        (uint8 phase,,,) = game.progress(ATTACK);
        assertEq(phase, 0, "legacy battle restarted as staged");
        (uint8 rounds, uint256 seed) = game.legacyProgress(ATTACK);
        assertEq(rounds, 2);
        assertEq(seed, 123456);
    }
}
