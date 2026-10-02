// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Vm} from "forge-std/Vm.sol";
import {ProductionBatchTransactionProbe} from "./ProductionBatchTransactionProbe.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftMoonSystemTestBase} from "./VeydriftMoonSystem.t.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftGameStorage as G} from "../src/VeydriftGameStorage.sol";
import {Ship, Technology, Defense} from "../src/libraries/VeydriftTypes.sol";

/// Every resolve traverses ERC1967Proxy -> real Game -> real Gameplay -> router -> staged modules.
/// State seeding is deliberately separate from the public resolution interface, never a facade.
contract VeydriftCombatArchitectureProxyTest is VeydriftMoonSystemTestBase {
    bytes32 private constant PROTECTION =
        keccak256("CombatProtectionSnapshot(uint256,uint256,uint256,bool,uint16)");
    bytes32 private constant MEMBER =
        keccak256("CombatMemberSnapshot(uint256,uint256,address,uint8,uint8,uint32)");

    function _proxy() private {
        game = VeydriftGame(
            address(
                new ERC1967Proxy(address(game), abi.encodeCall(VeydriftGame.initialize, (admin)))
            )
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
        moons.setMoonChanceReporter(reporter);
    }

    function _launch()
        private
        returns (uint256 id, uint256 origin, uint256 target, address defender)
    {
        _proxy();
        (origin, target, defender) = _seedMoonAttackPlanets();
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(defender, Technology.IntergalacticResearchNetwork, 3000);
        _fundPlanet(origin, 100_000_000, 100_000_000, 100_000_000);
        _setShipCount(origin, Ship.Battleship, 1000);
        _setNextFleetId(95855);
        G.MissionShips memory ships;
        ships.battleship = 1000;
        vm.prank(player);
        id = game.launchBodyFleetMission(
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

    function _step(uint256 id) private returns (uint256 used) {
        (,, uint256 beforeWork) = game.stagedBattleProgress(id);
        vm.cool(address(game));
        vm.cool(address(moons));
        vm.cool(address(randomness));
        uint256 gasBefore = gasleft();
        // A call runs exactly one stage when its gas is below that stage's cost plus the 1.5M
        // floor+reserve. Climbing in 1.4M steps, the first gas that fits the stage stays below it.
        for (uint256 budget = 1_500_000;; budget += 1_400_000) {
            (bool ok, bytes memory data) =
                address(game).call{gas: budget}(abi.encodeCall(game.resolveFleetMission, (id)));
            if (ok) break;
            if (data.length != 0 || budget > 15_000_000) {
                assembly ("memory-safe") { revert(add(data, 32), mload(data)) }
            }
        }
        used = gasBefore - gasleft();
        (uint8 phase,, uint256 afterWork) = game.stagedBattleProgress(id);
        assertTrue(afterWork > beforeWork || phase == 13, "successful receipt without progress");
        assertLt(used, 15_000_000, "public proxy envelope exceeded");
    }

    function _appendPlanet(address owner_, uint256 id) private {
        _setPlanetOwner(id, owner_);
        bytes32 list = keccak256(abi.encode(owner_, uint256(36)));
        uint256 n = uint256(vm.load(address(game), list));
        vm.store(address(game), bytes32(uint256(keccak256(abi.encode(list))) + n), bytes32(id));
        vm.store(address(game), list, bytes32(n + 1));
        vm.store(address(game), keccak256(abi.encode(id, uint256(37))), bytes32(n + 1));
    }

    function testPublicProxyBoundedScoresPreserveFirstCallAcrossRealMoonMutation() public {
        (uint256 id,, uint256 target, address defender) = _launch();
        // Large accounts are not a gameplay cap: preparation must progress in bounded slices.
        for (uint256 i; i < 80; ++i) {
            _appendPlanet(player, 1000 + i);
            _appendPlanet(defender, 2000 + i);
        }
        uint256 attackerBefore = game.playerScore(player);
        uint256 defenderBefore = game.playerScore(defender);
        (, uint64 arrival,,) = _fleetMission(id);
        vm.warp(arrival);
        _step(id);
        (uint8 phase,,) = game.stagedBattleProgress(id);
        assertEq(phase, 14);
        // A *real public Game mutation*, by the authorized Moon module, on an as-yet-unscanned
        // defender planet remains usable and must capture the pre-write value exactly once.
        vm.prank(address(moons));
        game.setMoonShipCount(2079, Ship.Deathstar, 10000);
        vm.prank(address(moons));
        game.setMoonShipCount(2079, Ship.Deathstar, 20000);
        assertGt(game.playerScore(defender), defenderBefore);
        address unrelated = address(0x123456);
        vm.deal(unrelated, 1 ether);
        vm.prank(unrelated);
        game.startPlanet{value: 0.05 ether}();
        vm.recordLogs();
        for (uint256 i; i < 100; ++i) {
            (phase,,) = game.stagedBattleProgress(id);
            if (phase == 15) break;
            _step(id);
        }
        (phase,,) = game.stagedBattleProgress(id);
        assertEq(phase, 15);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == PROTECTION) {
                (uint256 a, uint256 d, bool blocked,) =
                    abi.decode(logs[i].data, (uint256, uint256, bool, uint16));
                assertEq(a, attackerBefore);
                assertEq(d, defenderBefore);
                assertFalse(blocked);
                found = true;
            }
        }
        assertTrue(found, "missing protection evidence");
        // Score scanning completes even without randomness; only the next stage waits for oracle.
        (,,,,,,,,,, uint256 request) = game.fleetMission(id);
        assertEq(randomness.request(request).fulfilledAt, 0);
        assertEq(game.planet(target).owner, defender);
    }

    function _setDefenseCount(uint256 planetId, Defense defense, uint32 count) private {
        vm.store(
            address(game),
            keccak256(
                abi.encode(uint256(uint8(defense)), keccak256(abi.encode(planetId, uint256(19))))
            ),
            bytes32(uint256(count))
        );
    }

    function _queue(uint256 planetId, bool defense, uint64 at, bool isPartial) private {
        uint256 kind =
            defense ? uint256(uint8(Defense.RocketLauncher)) : uint256(uint8(Ship.LightFighter));
        uint64 ready = isPartial ? at + 50 : at;
        vm.store(
            address(game),
            keccak256(abi.encode(planetId, uint256(defense ? 8 : 9))),
            bytes32(uint256(1) | (kind << 8) | (uint256(100) << 16) | (uint256(ready) << 48))
        );
        if (isPartial) {
            bytes32 t = keccak256(
                abi.encode(ready, keccak256(abi.encode(planetId, uint256(defense ? 54 : 53))))
            );
            vm.store(address(game), t, bytes32(uint256(at - 50) | (uint256(100) << 64)));
            vm.store(address(game), bytes32(uint256(t) + 1), bytes32(uint256(1)));
            vm.store(address(game), bytes32(uint256(t) + 2), bytes32(uint256(1)));
        }
    }

    /// Caller starts vm.recordLogs(): a lazy mutation may finish the scan before this runs.
    function _assertProtection(uint256 id, uint256 a, uint256 d) private {
        for (uint256 n; n < 100; ++n) {
            (uint8 p,,) = game.stagedBattleProgress(id);
            if (p == 15) break;
            _step(id);
        }
        (uint8 phase,,) = game.stagedBattleProgress(id);
        assertEq(phase, 15);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 n; n < logs.length; ++n) {
            if (logs[n].topics[0] != PROTECTION) continue;
            (uint256 actualA, uint256 actualD,,) =
                abi.decode(logs[n].data, (uint256, uint256, bool, uint16));
            assertEq(actualA, a, "first-call attacker score changed");
            assertEq(actualD, d, "first-call defender score changed");
            found = true;
        }
        assertTrue(found);
    }

    function _productionSnapshot(uint8 mode) private {
        (uint256 id, uint256 origin,, address defender) = _launch();
        for (uint256 n; n < 12; ++n) {
            _appendPlanet(player, 1000 + n);
            _appendPlanet(defender, 2000 + n);
        }
        (, uint64 arrival,,) = _fleetMission(id);
        uint256 missile;
        if (mode >= 3) {
            // A separate public missile targets an unscanned planet, not the battle-locked body.
            _setPlanetLocation(origin, player, 1, 100, 8);
            _setPlanetLocation(2011, defender, 1, 104, 8);
            _setTechnologyLevel(player, Technology.ImpulseDrive, 3);
            _setDefenseCount(origin, Defense.InterplanetaryMissile, 1);
            vm.prank(player);
            missile = game.launchInterplanetaryMissileAttack(origin, 2011, Defense.LightLaser, 1);
            (, uint64 impact,,) = _fleetMission(missile);
            _queue(2011, false, impact, mode == 4);
            _queue(2011, true, impact, mode == 4);
            if (impact > arrival) arrival = impact;
        } else {
            _queue(2011, mode != 0, arrival, mode == 2);
        }
        uint256 a = game.playerScore(player);
        uint256 d = game.playerScore(defender);
        vm.warp(arrival);
        _step(id);
        (uint8 phase,,) = game.stagedBattleProgress(id);
        assertEq(phase, 14);
        vm.recordLogs();
        if (mode == 0) {
            vm.prank(defender);
            game.finishShipProduction(2011);
        } else if (mode < 3) {
            vm.prank(defender);
            game.finishDefenseProduction(2011);
        } else {
            game.resolveFleetMission{gas: 15_000_000}(missile);
            (G.FleetMissionStatus status,,,) = _fleetMission(missile);
            assertEq(uint8(status), uint8(G.FleetMissionStatus.Resolved));
            assertEq(game.shipCount(2011, Ship.LightFighter), mode == 4 ? 50 : 100);
        }
        if (mode != 0) {
            assertEq(
                game.defenseCount(2011, Defense.RocketLauncher), mode == 2 || mode == 4 ? 50 : 100
            );
        } else {
            assertEq(game.shipCount(2011, Ship.LightFighter), 100);
        }
        assertGt(game.playerScore(defender), d);
        _assertProtection(id, a, d);
    }

    function testPublicProxyShipCompletionPreservesUnscannedScore() public {
        _productionSnapshot(0);
    }

    function testPublicProxyFullDefenseCompletionPreservesUnscannedScore() public {
        _productionSnapshot(1);
    }

    function testPublicProxyPartialDefenseCompletionPreservesUnscannedScore() public {
        _productionSnapshot(2);
    }

    function testPublicProxyMissileFullCreditsPreserveUnscannedScore() public {
        _productionSnapshot(3);
    }

    function testPublicProxyMissilePartialCreditsPreserveUnscannedScore() public {
        _productionSnapshot(4);
    }

    function _arrivalProgress(uint256 planetId)
        private
        view
        returns (uint256 generation, uint256 work, uint64 cursor)
    {
        bytes32 base =
            keccak256(abi.encode(planetId, keccak256("veydrift.storage.arrival-progress.v1")));
        generation = uint256(vm.load(address(game), base));
        work = uint256(vm.load(address(game), bytes32(uint256(base) + 1)));
        cursor =
            uint64(uint256(vm.load(address(game), keccak256(abi.encode(planetId, uint256(74))))));
    }

    function _launchHarvest(uint256 target, uint256 index)
        private
        returns (uint256 id, address owner_)
    {
        owner_ = address(SafeCast.toUint160(0x90000 + index));
        vm.deal(owner_, 1 ether);
        vm.prank(owner_);
        uint256 origin = game.startPlanet{value: 0.05 ether}();
        _setPlanetLocation(origin, owner_, 1, 100, 8);
        _setTechnologyLevel(owner_, Technology.CombustionDrive, 6);
        _setShipCount(origin, Ship.Recycler, 1);
        _fundPlanet(origin, 100000, 100000, 100000);
        G.MissionShips memory ships;
        ships.recycler = 1;
        vm.prank(owner_);
        id = game.launchFleetMission(
            origin, target, G.FleetMissionType.Harvest, ships, G.Resources(0, 0, 0), 10, 0
        );
    }

    function testPublicProxyArrivalProgressSurvivesRealLaunchAndRecallInvalidation() public {
        _proxy();
        (, uint256 target, address defender) = _seedMoonAttackPlanets();
        _setPlanetLocation(target, defender, 1, 104, 8);
        vm.store(
            address(game),
            keccak256(abi.encode(target, uint256(27))),
            bytes32(uint256(1000000) | (uint256(1000000) << 128))
        );
        for (uint256 i; i < 30; ++i) {
            _launchHarvest(target, i);
        }
        // Public self-only helper is the exact bounded path used by the public resolver;
        // prepare before arrivals so normal launch/recall remains eligible.
        vm.prank(address(game));
        assertEq(game.launchInterplanetaryMissileAttack(1, target, Defense.RocketLauncher, 0), 0);
        (uint256 g, uint256 w, uint64 c) = _arrivalProgress(target);
        assertEq(c, 12);
        assertEq(w, 12);
        vm.prank(address(game));
        assertEq(game.launchInterplanetaryMissileAttack(1, target, Defense.RocketLauncher, 0), 0);
        (, uint256 w2, uint64 c2) = _arrivalProgress(target);
        assertEq(c2, 24);
        assertEq(w2, 24);
        (uint256 newId, address owner_) = _launchHarvest(target, 30);
        (uint256 g2, uint256 w3, uint64 c3) = _arrivalProgress(target);
        assertEq(g2, g + 1);
        assertEq(w3, 24);
        assertEq(c3, 0);
        vm.prank(address(game));
        game.launchInterplanetaryMissileAttack(1, target, Defense.RocketLauncher, 0);
        (, uint256 w4, uint64 c4) = _arrivalProgress(target);
        assertEq(w4, 36);
        assertEq(c4, 12);
        vm.prank(owner_);
        game.recallFleetMission(newId);
        (uint256 g3, uint256 w5, uint64 c5) = _arrivalProgress(target);
        assertEq(g3, g2 + 1);
        assertEq(w5, 36);
        assertEq(c5, 0);
        for (uint256 i; i < 3; ++i) {
            vm.prank(address(game));
            game.launchInterplanetaryMissileAttack{gas: 15_000_000}(
                1, target, Defense.RocketLauncher, 0
            );
        }
        (uint256 g4, uint256 w6, uint64 c6) = _arrivalProgress(target);
        assertEq(g4, g3);
        assertEq(w6, 68); //31 retained records plus the completion marker, after36 earlier work.
        assertEq(c6, 31); // Recalled missions remain indexed until their scheduled return.
        vm.prank(address(game));
        game.launchInterplanetaryMissileAttack(1, target, Defense.RocketLauncher, 0);
        (, uint256 w7,) = _arrivalProgress(target);
        assertEq(w7, w6, "cached no-op must not mint progress");
    }

    function _seedRemovalIndex(uint256 key, uint256 listSlot, uint256 indexSlot, uint256 id)
        private
    {
        bytes32 list = keccak256(abi.encode(key, listSlot));
        vm.store(address(game), list, bytes32(uint256(1)));
        vm.store(address(game), keccak256(abi.encode(list)), bytes32(id));
        vm.store(
            address(game),
            keccak256(abi.encode(id, keccak256(abi.encode(key, indexSlot)))),
            bytes32(uint256(1))
        );
    }

    /// forge-config: default.isolate = true
    function testPublicProxy4510HistoricalLinksBoundedScanAndCleanup() public {
        ProductionBatchTransactionProbe probe = new ProductionBatchTransactionProbe();
        probe.write(1);
        (uint256 storageGas, uint256 transientValue) = probe.write(2);
        assertGe(storageGas, 5000, "isolated transaction boundaries required");
        assertEq(transientValue, 0, "transient state must clear");
        (uint256 id, uint256 origin, uint256 target, address defender) = _launch();
        (, uint64 arrival, uint64 back,) = _fleetMission(id);
        bytes32 list = keccak256(abi.encode(id, uint256(32)));
        uint256 data = uint256(keccak256(abi.encode(list)));
        // 4510 persisted links: distinct cold records, mixed ineligibility, two eligible
        // joined attackers plus a defender, and a duplicate of an eligible mission.
        for (uint256 i; i < 4510; ++i) {
            uint256 member = 200000 + i;
            bool eligible = i == 31 || i == 2240 || i == 4509;
            address owner_ = eligible
                ? (i == 2240 ? defender : player)
                : address(SafeCast.toUint160(0x100000 + i));
            G.FleetMissionType kind =
                i == 2240 ? G.FleetMissionType.AcsDefend : G.FleetMissionType.AcsAttack;
            G.FleetMissionStatus status = eligible
                ? G.FleetMissionStatus.Outbound
                : (i % 3 == 0 ? G.FleetMissionStatus.Recalled : G.FleetMissionStatus.Outbound);
            uint256 from = eligible ? origin : 500000 + i;
            _storeFleetMission(
                member,
                status,
                kind,
                owner_,
                from,
                target,
                uint64(block.timestamp),
                eligible ? arrival : arrival + uint64(i % 3 == 1 ? 1 : 0),
                back
            );
            uint256 base = uint256(keccak256(abi.encode(member, uint256(24))));
            // Noneligible zero/incorrect hostile ids exclude outbound, already-arrived records.
            vm.store(address(game), bytes32(base + 9), bytes32(eligible ? id : id + 1));
            vm.store(address(game), bytes32(base + 7), bytes32(uint256(20) << 224));
            vm.store(address(game), bytes32(data + i), bytes32(member));
            if (!eligible) {
                // Real nonzero cold removal writes for all stale origin/player indexes.
                _seedRemovalIndex(from, 38, 40, id);
                _seedRemovalIndex(uint160(owner_), 39, 41, id);
            }
        }
        vm.store(address(game), bytes32(data + 32), bytes32(uint256(200031)));
        vm.store(address(game), list, bytes32(uint256(4510)));
        vm.store(address(game), keccak256(abi.encode(player, uint256(25))), bytes32(uint256(3)));
        vm.store(address(game), keccak256(abi.encode(defender, uint256(25))), bytes32(uint256(1)));
        _fulfillAttackBattleRandomness(id, 659);
        vm.warp(arrival);
        vm.recordLogs();
        uint256 phase4Calls;
        uint256 phase12Calls;
        uint256 peak;
        uint256 calls;
        uint256 battle =
            uint256(keccak256(abi.encode(id, keccak256("veydrift.storage.staged-battle.v1"))));
        for (; calls < 512; ++calls) {
            (uint8 phase,, uint256 work) = game.stagedBattleProgress(id);
            if (phase == 13) break;
            uint256 cursor = uint256(vm.load(address(game), bytes32(battle + 1)));
            uint256 used = _step(id);
            if (used > peak) peak = used;
            (uint8 next,, uint256 nextWork) = game.stagedBattleProgress(id);
            assertGt(nextWork, work, "each call must commit progress including terminal");
            uint256 afterCursor = uint256(vm.load(address(game), bytes32(battle + 1)));
            if (phase == 4) {
                ++phase4Calls;
                if (next == 4) {
                    assertGt(afterCursor, cursor);
                    assertLe(afterCursor - cursor, 32);
                } else {
                    assertEq(next, 5);
                    assertLe(4510 - cursor, 32);
                }
            }
            if (phase == 12) {
                ++phase12Calls;
                if (next == 12 && afterCursor > cursor) assertLe(afterCursor - cursor, 32);
            }
        }
        assertLt(calls, 512, "historical no-ops still require thousands of paid calls");
        (uint8 finalPhase,,) = game.stagedBattleProgress(id);
        assertEq(finalPhase, 13);
        assertLe(phase4Calls, 144);
        assertGe(phase4Calls, 141);
        assertLe(phase12Calls, 146);
        assertGe(phase12Calls, 141);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 enrolled;
        bool[3] memory seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != MEMBER) continue;
            uint256 member = uint256(logs[i].topics[2]);
            if (member == id) continue;
            assertTrue(
                member == 200031 || member == 202240 || member == 204509, "ineligible link enrolled"
            );
            uint256 index = member == 200031 ? 0 : member == 202240 ? 1 : 2;
            assertFalse(seen[index], "duplicate member weight");
            seen[index] = true;
            ++enrolled;
            (uint8 side, uint8 unit, uint32 count) =
                abi.decode(logs[i].data, (uint8, uint8, uint32));
            assertEq(side, index == 1 ? 1 : 0);
            assertEq(unit, uint8(Ship.Battleship));
            assertEq(count, 20);
        }
        assertEq(enrolled, 3);
        // Boundary/middle stale records have their actual index entries removed.
        for (uint256 i; i < 3; ++i) {
            uint256 n = i == 0 ? 0 : i == 1 ? 2200 : 4508;
            bytes32 p = keccak256(abi.encode(id, keccak256(abi.encode(500000 + n, uint256(40)))));
            bytes32 o = keccak256(
                abi.encode(id, keccak256(abi.encode(SafeCast.toUint160(0x100000 + n), uint256(41))))
            );
            assertEq(uint256(vm.load(address(game), p)), 0);
            assertEq(uint256(vm.load(address(game), o)), 0);
        }
        emit log_named_uint("4510 links total resolver calls", calls);
        emit log_named_uint("4510 links phase4 calls", phase4Calls);
        emit log_named_uint("4510 links phase12 calls", phase12Calls);
        emit log_named_uint("4510 links peak isolated resolver gas", peak);
    }

    function _researchMarker(uint256 id) private pure returns (bytes32) {
        return keccak256(abi.encode(id, keccak256("veydrift.storage.battle-research.v1")));
    }

    function _researchLevels(uint256 id, address owner) private view returns (uint256) {
        bytes32 outer = keccak256(
            abi.encode(id, uint256(keccak256("veydrift.storage.battle-research.v1")) + 1)
        );
        return uint256(vm.load(address(game), keccak256(abi.encode(owner, outer))));
    }

    function _researchQueue(address owner, Technology technology, uint16 level, uint64 ready)
        private
    {
        vm.store(
            address(game),
            keccak256(abi.encode(owner, uint256(10))),
            bytes32(
                uint256(1) | (uint256(uint8(technology)) << 8) | (uint256(level) << 16)
                    | (uint256(ready) << 32)
            )
        );
    }

    function _researchPolicyProxy(bool fresh, uint64 delay, bool materialize) private {
        (uint256 id,, uint256 target, address defender) = _launch();
        assertEq(uint256(vm.load(address(game), _researchMarker(id))), 1, "body launch not marked");
        if (!fresh) vm.store(address(game), _researchMarker(id), bytes32(0)); // pre-upgrade mission has no marker
        (, uint64 impact,,) = _fleetMission(id);
        _setTechnologyLevel(player, Technology.Weapons, 5);
        _setTechnologyLevel(defender, Technology.Shielding, 7);
        _setShipCount(target, Ship.LightFighter, 100);
        uint64 ready = impact - 1 + delay;
        _researchQueue(player, Technology.Weapons, 11, ready);
        _researchQueue(defender, Technology.Shielding, 13, ready);
        if (materialize) {
            // Actual facade/self-only completion path; public finishResearch intentionally
            // blocks across overdue combat, so it cannot model an already-deleted old queue.
            // This exercises the shared canonical sink without bypassing its access control.
            vm.warp(ready);
            uint256 origin = game.homePlanetOf(player);
            vm.prank(address(game));
            game.completeAttackTargetSnapshotQueues(origin, ready);
            vm.prank(address(game));
            game.completeAttackTargetSnapshotQueues(target, ready);
        }
        vm.warp(impact + 100);
        _fulfillAttackBattleRandomness(id, 659);
        for (uint256 i; i < 80; ++i) {
            (uint8 currentPhase,,) = game.stagedBattleProgress(id);
            if (currentPhase == 4) break;
            _step(id);
        }
        (uint8 phase,,) = game.stagedBattleProgress(id);
        assertEq(phase, 4);
        uint256 a = _researchLevels(id, player);
        uint256 d = _researchLevels(id, defender);
        assertEq(SafeCast.toUint8(a & 0xff), 1);
        assertEq(SafeCast.toUint8(d & 0xff), 1);
        uint256 expectedW = fresh ? (ready <= impact ? 11 : 5) : (materialize ? 11 : 5);
        uint256 expectedS = fresh ? (ready <= impact ? 13 : 7) : (materialize ? 13 : 7);
        assertEq(SafeCast.toUint16((a >> 8) & 0xffff), expectedW, "attacker policy");
        assertEq(SafeCast.toUint16((d >> 24) & 0xffff), expectedS, "defender policy");
        if (!fresh && !materialize) {
            (bool activeA,,,,) = game.researchQueues(player);
            (bool activeD,,,,) = game.researchQueues(defender);
            assertTrue(activeA);
            assertTrue(activeD, "old battle must not auto-complete research");
        }
    }

    function testOptionBOldProxyNoQueueOverlayBothSides() public {
        _researchPolicyProxy(false, 0, false);
    }

    function testOptionBNewProxyBeforeImpactBothSides() public {
        _researchPolicyProxy(true, 0, false);
    }

    function testOptionBNewProxyAtImpactBothSides() public {
        _researchPolicyProxy(true, 1, false);
    }

    function testOptionBNewProxyAfterImpactBothSides() public {
        _researchPolicyProxy(true, 2, false);
    }

    function testOptionBNewProxyDeletedPostImpactCompletionsExcluded() public {
        _researchPolicyProxy(true, 2, true);
    }

    function testOptionBOldProxyDeletedCompletionsUseStored() public {
        _researchPolicyProxy(false, 2, true);
    }

    function testOptionBNormalAttackLaunchMarkedNotOnlyBodyLaunch() public {
        (uint256 id, uint256 origin, uint256 target,) = _launch();
        _setTechnologyLevel(player, Technology.Computer, 2);
        _setShipCount(origin, Ship.Battleship, 1000);
        G.MissionShips memory ships;
        ships.battleship = 100;
        vm.prank(player);
        uint256 normal = game.launchFleetMission(
            origin, target, G.FleetMissionType.Attack, ships, G.Resources(0, 0, 0), 0
        );
        assertEq(uint256(vm.load(address(game), _researchMarker(normal))), 1);
        assertEq(uint256(vm.load(address(game), _researchMarker(id))), 1);
    }

    function _sevenOwnerResearch(bool fresh) private {
        (uint256 id, uint256 origin, uint256 target,) = _launch();
        if (!fresh) vm.store(address(game), _researchMarker(id), bytes32(0));
        (, uint64 arrival, uint64 back,) = _fleetMission(id);
        bytes32 list = keccak256(abi.encode(target, uint256(48)));
        for (uint256 i; i < 7; ++i) {
            uint256 held = 100000 + i;
            address owner_ = address(SafeCast.toUint160(0x7100 + i));
            _storeFleetMission(
                held,
                G.FleetMissionStatus.Outbound,
                G.FleetMissionType.DefenseHold,
                owner_,
                origin,
                target,
                uint64(block.timestamp),
                arrival - 1,
                back
            );
            uint256 base = uint256(keccak256(abi.encode(held, uint256(24))));
            vm.store(address(game), bytes32(base + 7), bytes32(uint256(100) << 224));
            vm.store(
                address(game),
                keccak256(abi.encode(held, uint256(50))),
                bytes32(uint256(arrival + 1 days))
            );
            vm.store(
                address(game), bytes32(uint256(keccak256(abi.encode(list))) + i), bytes32(held)
            );
            _setTechnologyLevel(owner_, Technology.Weapons, SafeCast.toUint16(5 + i));
            _setTechnologyLevel(owner_, Technology.Shielding, SafeCast.toUint16(6 + i));
            _setTechnologyLevel(owner_, Technology.Armor, SafeCast.toUint16(7 + i));
            _researchQueue(
                owner_,
                Technology.Weapons,
                SafeCast.toUint16(20 + i),
                arrival - 1 + SafeCast.toUint64(i % 3)
            );
            // A member's marker is deliberately opposite: ONLY the leader's policy may matter.
            vm.store(address(game), _researchMarker(held), bytes32(uint256(fresh ? 0 : 1)));
        }
        vm.store(address(game), list, bytes32(uint256(7)));
        _fulfillAttackBattleRandomness(id, 659);
        vm.warp(arrival + 10);
        for (uint256 i; i < 100; ++i) {
            (uint8 currentPhase,,) = game.stagedBattleProgress(id);
            if (currentPhase == 6) break;
            _step(id);
        }
        (uint8 phase,,) = game.stagedBattleProgress(id);
        assertEq(phase, 6);
        for (uint256 i; i < 7; ++i) {
            address owner_ = address(SafeCast.toUint160(0x7100 + i));
            uint256 packed = _researchLevels(id, owner_);
            assertEq(SafeCast.toUint8(packed & 0xff), 1);
            assertEq(SafeCast.toUint16((packed >> 8) & 0xffff), fresh && i % 3 < 2 ? 20 + i : 5 + i);
            assertEq(SafeCast.toUint16((packed >> 24) & 0xffff), 6 + i);
            assertEq(SafeCast.toUint16((packed >> 40) & 0xffff), 7 + i);
        }
    }

    function testOptionBOldLeaderSevenOwnerMembersCannotSelectNewPolicy() public {
        _sevenOwnerResearch(false);
    }

    function testOptionBNewLeaderSevenOwnerMembersUseImpactPolicy() public {
        _sevenOwnerResearch(true);
    }

    function testPublicProxyImportCannotReplaceInboundCombatTarget() public {
        (uint256 id,, uint256 target, address defender) = _launch();
        (, uint64 arrival,,) = _fleetMission(id);
        vm.warp(arrival);
        _step(id);
        vm.prank(admin);
        game.setMigrationSettlement(address(this));
        VeydriftStateMigrationModule.MigrationPlayerState memory state;
        state.player = defender;
        state.homePlanetId = target;
        state.planets = new VeydriftStateMigrationModule.MigrationPlanetState[](1);
        vm.deal(address(this), 1 ether);
        vm.expectRevert(G.PlanetHasActiveFleetMissions.selector);
        game.importMigratedState{value: 0.05 ether}(defender, abi.encode(state));
        assertEq(game.planet(target).owner, defender);
        (bool ok,) = address(game)
            .call(abi.encodeWithSignature("discardSingleStartedPlanet(address)", defender));
        assertFalse(ok, "private discard became publicly routed");
        (ok,) = address(game).call(abi.encodeWithSignature("returnLinkedMissions(uint256)", id));
        assertFalse(ok, "private legacy returns became publicly routed");
    }

    function testPublicProxySavedLegacySeedNeverStartsStagedAndCleansOnlyWipedHold() public {
        (uint256 id, uint256 origin, uint256 target, address defender) = _launch();
        (, uint64 arrival, uint64 back,) = _fleetMission(id);
        uint256 progress = uint256(keccak256(abi.encode(id, uint256(58))));
        vm.store(address(game), bytes32(progress), bytes32(uint256(123456)));
        vm.store(address(game), bytes32(progress + 6), bytes32(uint256(1)));
        vm.store(address(game), keccak256(abi.encode(id, uint256(67))), bytes32(uint256(5000)));
        vm.store(address(game), keccak256(abi.encode(id, uint256(68))), bytes32(uint256(1)));
        bytes32 holds = keccak256(abi.encode(target, uint256(48)));
        bytes32 linked = keccak256(abi.encode(id, uint256(32)));
        for (uint256 i; i < 2; ++i) {
            uint256 member = 100000 + i;
            _storeFleetMission(
                member,
                G.FleetMissionStatus.Outbound,
                G.FleetMissionType.DefenseHold,
                defender,
                origin,
                target,
                uint64(block.timestamp),
                arrival - 1,
                back
            );
            vm.store(
                address(game),
                keccak256(abi.encode(member, uint256(50))),
                bytes32(uint256(arrival + 1 days))
            );
            vm.store(
                address(game), bytes32(uint256(keccak256(abi.encode(holds))) + i), bytes32(member)
            );
            vm.store(
                address(game), bytes32(uint256(keccak256(abi.encode(linked))) + i), bytes32(member)
            );
            vm.store(
                address(game),
                keccak256(abi.encode(member, keccak256(abi.encode(target, uint256(49))))),
                bytes32(i + 1)
            );
        }
        // A previously wiped hold and a still-living hold, exactly as a saved old round can leave.
        uint256 liveBase = uint256(keccak256(abi.encode(uint256(100001), uint256(24))));
        vm.store(address(game), bytes32(liveBase + 8), bytes32(uint256(1000) << 64));
        vm.store(address(game), holds, bytes32(uint256(2)));
        vm.store(address(game), linked, bytes32(uint256(2)));
        vm.store(address(game), keccak256(abi.encode(defender, uint256(25))), bytes32(uint256(2)));
        vm.warp(arrival);
        vm.recordLogs();
        for (uint256 i; i < 6; ++i) {
            (G.FleetMissionStatus status,,,) = _fleetMission(id);
            if (status != G.FleetMissionStatus.Outbound) break;
            game.resolveFleetMission{gas: 15_000_000}(id);
            (uint8 phase,,) = game.stagedBattleProgress(id);
            assertEq(phase, 0, "saved legacy battle switched arithmetic");
        }
        (G.FleetMissionStatus leader,,,) = _fleetMission(id);
        assertTrue(leader != G.FleetMissionStatus.Outbound);
        (G.FleetMissionStatus dead,,,) = _fleetMission(100000);
        assertEq(uint8(dead), uint8(G.FleetMissionStatus.Resolved));
        (G.FleetMissionStatus living,,,) = _fleetMission(100001);
        assertEq(uint8(living), uint8(G.FleetMissionStatus.Outbound));
        assertEq(game.activeFleetMissionCount(defender), 1);
        assertEq(uint256(vm.load(address(game), holds)), 1);
        assertEq(
            uint256(vm.load(address(game), keccak256(abi.encode(uint256(100000), uint256(50))))), 0
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        bytes32 battle = keccak256(
            "AttackBattleResolved(uint256,address,uint256,uint8,uint8,uint256,uint128,uint128,uint128)"
        );
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != PROTECTION, "legacy rechecked protection");
            if (logs[i].topics[0] == battle) {
                (, uint8 rounds, uint256 seed,,,) =
                    abi.decode(logs[i].data, (uint8, uint8, uint256, uint128, uint128, uint128));
                assertGe(rounds, 1);
                assertEq(seed, 123456);
                found = true;
            }
        }
        assertTrue(found);
        (,,,,,,,,,, uint256 request) = game.fleetMission(id);
        assertEq(randomness.request(request).fulfilledAt, 0, "legacy required fresh seed");
        game.resolveFleetMission{gas: 15_000_000}(id);
        assertEq(game.activeFleetMissionCount(defender), 1);
    }

    function testPublicProxyAlreadyOutboundZeroRound95855With22HoldsCompletesUnder15M() public {
        (uint256 id, uint256 origin, uint256 target,) = _launch();
        assertEq(id, 95855);
        (, uint64 arrival, uint64 back,) = _fleetMission(id);
        bytes32 list = keccak256(abi.encode(target, uint256(48)));
        for (uint256 i; i < 22; ++i) {
            uint256 held = 100000 + i;
            address owner_ = address(SafeCast.toUint160(0x10000 + i));
            _storeFleetMission(
                held,
                G.FleetMissionStatus.Outbound,
                G.FleetMissionType.DefenseHold,
                owner_,
                origin,
                target,
                uint64(block.timestamp),
                arrival - 1,
                back
            );
            uint256 base = uint256(keccak256(abi.encode(held, uint256(24))));
            vm.store(address(game), bytes32(base + 7), bytes32(uint256(1000) << 224));
            vm.store(
                address(game),
                keccak256(abi.encode(held, uint256(50))),
                bytes32(uint256(arrival + 1 days))
            );
            vm.store(
                address(game), bytes32(uint256(keccak256(abi.encode(list))) + i), bytes32(held)
            );
            vm.store(
                address(game),
                keccak256(abi.encode(held, keccak256(abi.encode(target, uint256(49))))),
                bytes32(i + 1)
            );
            vm.store(address(game), keccak256(abi.encode(owner_, uint256(25))), bytes32(uint256(1)));
            _setTechnologyLevel(owner_, Technology.Weapons, SafeCast.toUint16(8 + i % 7));
            _setTechnologyLevel(owner_, Technology.Shielding, SafeCast.toUint16(8 + i % 7));
            _setTechnologyLevel(owner_, Technology.Armor, SafeCast.toUint16(8 + i % 7));
        }
        vm.store(address(game), list, bytes32(uint256(22)));
        _fulfillAttackBattleRandomness(id, 659);
        vm.warp(arrival);
        vm.recordLogs();
        uint256 peak;
        uint256 calls;
        for (; calls < 4000; ++calls) {
            (G.FleetMissionStatus status,,,) = _fleetMission(id);
            if (status != G.FleetMissionStatus.Outbound) break;
            uint256 used = _step(id);
            if (used > peak) peak = used;
        }
        assertLt(calls, 4000, "22-hold battle did not terminate");
        (uint8 phase, uint8 rounds,) = game.stagedBattleProgress(id);
        assertEq(phase, 13);
        assertGt(rounds, 0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 enrolled;
        uint256 total;
        bool[22] memory seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == MEMBER) {
                uint256 memberId = uint256(logs[i].topics[2]);
                if (memberId < 100000 || memberId >= 100022) continue;
                (uint8 side, uint8 unit, uint32 count) =
                    abi.decode(logs[i].data, (uint8, uint8, uint32));
                assertFalse(seen[memberId - 100000], "hold enrolled twice");
                seen[memberId - 100000] = true;
                assertEq(side, 1);
                assertEq(unit, uint8(Ship.Battleship));
                assertEq(count, 1000);
                ++enrolled;
                total += count;
            }
        }
        assertEq(enrolled, 22);
        assertEq(total, 22000);
        emit log_named_uint("public proxy continuation calls", calls);
        emit log_named_uint("public proxy peak resolver gas", peak);
    }
}
