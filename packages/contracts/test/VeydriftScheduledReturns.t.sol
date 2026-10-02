// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {VeydriftMoonSystemTestBase} from "./VeydriftMoonSystem.t.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {
    Ship,
    Technology,
    MissionResolutionItem,
    MissionResolutionOutcome
} from "../src/libraries/VeydriftTypes.sol";

/// @notice Keyless replay of the production timing boundary, through the real Game/module stack.
contract VeydriftScheduledReturnsTest is VeydriftMoonSystemTestBase {
    uint64 private constant RETURN_AT = 1790592545;
    uint64 private constant IMPACT_AT = 1790592549;
    uint256 private constant RETURN_ID = 93742;
    uint256 private constant ATTACK_ID = 93790;

    function testPlanetEarlierReturnAttackTransactionFirst() public {
        _replay(false, -4, false);
    }

    function testMoonEarlierReturnAttackTransactionFirst() public {
        _replay(true, -4, false);
    }

    function testPlanetLaterReturnExcluded() public {
        _replay(false, 4, false);
    }

    function testMoonImpactDoesNotSettleParentPlanetThroughItsLaterCutoff() public {
        (uint256 home,) = _fixture(true, 4);
        uint64 parentSettledAt = game.planet(home).lastSettledAt;
        _fulfillAttackBattleRandomness(ATTACK_ID, 7);
        _resolveAttackFully(ATTACK_ID);
        assertEq(
            game.planet(home).lastSettledAt,
            parentSettledAt,
            "moon impact changed independent planet snapshot"
        );
    }

    function testMoonLaterReturnExcluded() public {
        _replay(true, 4, false);
    }

    function testPlanetEqualTimestampArrivalWins() public {
        _replay(false, 0, false);
    }

    function testMoonEqualTimestampArrivalWins() public {
        _replay(true, 0, false);
    }

    function testPlanetLazySettlementIncludesEarlierReturn() public {
        _replay(false, -4, true);
    }

    function testMoonLazySettlementIncludesEarlierReturn() public {
        _replay(true, -4, true);
    }

    function _fixture(bool isMoon, int64 offset) private returns (uint256 home, uint256 away) {
        return _fixtureBodies(isMoon, isMoon, offset);
    }

    function _fixtureBodies(bool isMoon, bool attackMoon, int64 offset)
        private
        returns (uint256 home, uint256 away)
    {
        vm.warp(RETURN_AT - 1 days);
        (home, away,) = _seedMoonAttackPlanets();
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3_000);
        _setTechnologyLevel(address(0xDEF), Technology.IntergalacticResearchNetwork, 3_000);
        _fundPlanet(home, 1_000_000, 1_000_000, 1_000_000);
        _fundPlanet(away, 1_000_000, 1_000_000, 1_000_000);
        _fundMoon(home, 1_000_000, 1_000_000, 1_000_000);
        _fundMoon(away, 1_000_000, 1_000_000, 1_000_000);
        _setNextFleetId(RETURN_ID);
        _setShipCount(home, Ship.SmallCargo, 196);
        _setShipCount(home, Ship.Recycler, 3);
        if (isMoon) {
            _setMoonShipCount(home, Ship.SmallCargo, 196);
            _setMoonShipCount(home, Ship.Recycler, 3);
        }
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 196;
        ships.recycler = 3;
        vm.prank(player);
        uint256 id = game.launchBodyAttackMission(
            home,
            away,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            100,
            isMoon,
            false,
            VeydriftGameStorage.LootRatio(3_333, 3_333, 3_334)
        );
        assertEq(id, RETURN_ID);
        (, uint64 firstArrival,,) = _fleetMission(id);
        vm.warp(firstArrival);
        _fulfillAttackBattleRandomness(id, 42);
        _resolveAttackFully(id); // Establish an actual returning fleet before the second launch.
        // Fixture IMPACT_AT is 1,790,592,549; callers use only -4, 0 or 4 seconds.
        // Both signed and unsigned 64-bit conversions preserve that positive timestamp.
        // forge-lint: disable-next-line(unsafe-typecast)
        _setTimes(id, firstArrival, uint64(int64(IMPACT_AT) + offset));

        _setNextFleetId(ATTACK_ID);
        _setShipCount(away, Ship.LargeCargo, 10);
        _setShipCount(away, Ship.Battlecruiser, 15);
        delete ships;
        ships.largeCargo = 10;
        ships.battlecruiser = 15;
        vm.prank(address(0xDEF));
        id = game.launchBodyAttackMission(
            away,
            home,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            100,
            false,
            attackMoon,
            VeydriftGameStorage.LootRatio(3_333, 3_333, 3_334)
        );
        assertEq(id, ATTACK_ID);
        _setTimes(id, IMPACT_AT, IMPACT_AT + 1 hours);
        // Target body starts empty; a planet return fixture must not retain the launch inventory.
        assertEq(
            isMoon
                ? game.moonShipCount(home, Ship.SmallCargo)
                : game.shipCount(home, Ship.SmallCargo),
            0
        );
        vm.warp(IMPACT_AT + 6);
    }

    function _replay(bool isMoon, int64 offset, bool lazy) private {
        (uint256 home,) = _fixture(isMoon, offset);
        _fulfillAttackBattleRandomness(ATTACK_ID, 7);
        vm.recordLogs();
        if (lazy) {
            vm.prank(player);
            game.renamePlanet{gas: 15_000_000}(home, "chronological");
        } else {
            // The permissionless attack resolver is invoked before ANY explicit return tx.
            _resolveAttackFully(ATTACK_ID);
        }
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool fought;
        bool found;
        bytes32 battleTopic = keccak256(
            "AttackBattleResolved(uint256,address,uint256,uint8,uint8,uint256,uint128,uint128,uint128)"
        );
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == battleTopic && uint256(logs[i].topics[1]) == ATTACK_ID) {
                (, uint8 rounds,,,,) =
                    abi.decode(logs[i].data, (uint8, uint8, uint256, uint128, uint128, uint128));
                fought = rounds != 0;
                found = true;
            }
        }
        assertTrue(found, "battle event missing");
        assertEq(fought, offset < 0, "snapshot must use scheduled return cutoff");
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(RETURN_ID);
        if (offset < 0) {
            assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returned));
            uint32 beforeCount = isMoon
                ? game.moonShipCount(home, Ship.SmallCargo)
                : game.shipCount(home, Ship.SmallCargo);
            // A concurrent repeat is a no-op, never a revert or a second credit.
            game.completeFleetMissionReturn(RETURN_ID);
            assertEq(
                isMoon
                    ? game.moonShipCount(home, Ship.SmallCargo)
                    : game.shipCount(home, Ship.SmallCargo),
                beforeCount
            );
        } else {
            assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
            game.completeFleetMissionReturn(RETURN_ID);
            assertEq(
                isMoon
                    ? game.moonShipCount(home, Ship.SmallCargo)
                    : game.shipCount(home, Ship.SmallCargo),
                196
            );
        }
        assertEq(game.activeFleetMissionCount(player), 0);
    }

    function testBatchThirtyTwoIndependentReturnsFitOneReceipt() public {
        vm.warp(RETURN_AT - 1 days);
        MissionResolutionItem[] memory items = new MissionResolutionItem[](32);
        for (uint256 i; i < 32; ++i) {
            // Deterministic fixture addresses only, bounded below 32.
            // forge-lint: disable-next-line(unsafe-typecast)
            address owner = address(uint160(0x10000 + i));
            vm.deal(owner, 1 ether);
            vm.prank(owner);
            uint256 home = game.startPlanet{value: 0.05 ether}();
            _fundPlanet(home, 100_000, 100_000, 100_000);
            _setShipCount(home, Ship.Recycler, 1);
            vm.store(
                address(game),
                keccak256(abi.encode(home, uint256(27))),
                bytes32(uint256(1_000) | (uint256(1_000) << 128))
            );
            _setTechnologyLevel(owner, Technology.CombustionDrive, 6);
            VeydriftGameStorage.MissionShips memory recycler;
            recycler.recycler = 1;
            vm.prank(owner);
            uint256 id = game.launchFleetMission(
                home,
                home,
                VeydriftGameStorage.FleetMissionType.Harvest,
                recycler,
                VeydriftGameStorage.Resources(0, 0, 0),
                0
            );
            _setTimes(id, RETURN_AT, RETURN_AT + 100);
            vm.prank(owner);
            game.recallFleetMission(id);
            _setTimes(id, RETURN_AT - 100, RETURN_AT);
            items[i] = MissionResolutionItem(id, 1);
        }
        vm.warp(RETURN_AT);
        uint256 beforeGas = gasleft();
        (MissionResolutionOutcome[] memory outcomes,) =
            game.resolveFleetMissionBatch{gas: 16_500_000}(items);
        emit log_named_uint("32 independent cheap returns execution gas", beforeGas - gasleft());
        for (uint256 i; i < 32; ++i) {
            assertEq(uint8(outcomes[i]), uint8(MissionResolutionOutcome.Settled));
        }
    }

    function testBatchThirtyTwoCheapReturnsGasAndSender() public {
        vm.warp(RETURN_AT - 1 days);
        (uint256 home, uint256 away,) = _seedMoonAttackPlanets();
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3_000);
        _setTechnologyLevel(player, Technology.Computer, 40);
        _setPlanetOwner(away, player);
        _fundPlanet(home, 10_000_000, 10_000_000, 10_000_000);
        _setShipCount(home, Ship.SmallCargo, 32);
        MissionResolutionItem[] memory items = new MissionResolutionItem[](32);
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        for (uint256 i; i < 32; ++i) {
            vm.prank(player);
            uint256 id = game.launchFleetMission(
                home,
                away,
                VeydriftGameStorage.FleetMissionType.Transport,
                ships,
                VeydriftGameStorage.Resources(1, 2, 3),
                0
            );
            vm.prank(player);
            game.recallFleetMission(id);
            _setTimes(id, RETURN_AT - 100, RETURN_AT);
            items[i] = MissionResolutionItem(id, 1);
        }
        vm.warp(RETURN_AT);
        uint256 totalSettled;
        uint256 calls;
        uint256 maxGas;
        // Shared-body invalidations are real: repeated bounded batches finish the backlog,
        // but Pending occurrences must never be counted as completed mission legs.
        while (totalSettled < 32 && calls < 32) {
            vm.prank(player);
            uint256 beforeGas = gasleft();
            (MissionResolutionOutcome[] memory current,) =
                game.resolveFleetMissionBatch{gas: 16_500_000}(items);
            uint256 used = beforeGas - gasleft();
            if (used > maxGas) maxGas = used;
            for (uint256 i; i < 32; ++i) {
                if (current[i] == MissionResolutionOutcome.Settled) ++totalSettled;
            }
            ++calls;
        }
        emit log_named_uint("32 same-body return backlog maximum batch gas", maxGas);
        emit log_named_uint("32 same-body return backlog batches", calls);
        assertEq(totalSettled, 32);
        assertLt(calls, 32, "fewer receipts than one per credited return");
        assertEq(game.shipCount(home, Ship.SmallCargo), 32);
        assertEq(game.activeFleetMissionCount(player), 0);
        assertEq(
            uint256(vm.load(address(game), keccak256(abi.encode(player, uint256(34))))),
            RETURN_AT,
            "delegatecall retains acting sender"
        );
        (MissionResolutionOutcome[] memory outcomes,) = game.resolveFleetMissionBatch(items);
        for (uint256 i; i < 32; ++i) {
            assertEq(uint8(outcomes[i]), uint8(MissionResolutionOutcome.AlreadySettled));
        }
        assertEq(game.shipCount(home, Ship.SmallCargo), 32);
    }

    function testBatchPlanetEarlierReturnReverseArray() public {
        _batchReplay(false, -4);
    }

    function testBatchMoonEarlierReturnReverseArray() public {
        _batchReplay(true, -4);
    }

    function testBatchPlanetLaterReturnReverseArray() public {
        _batchReplay(false, 4);
    }

    function testBatchMoonLaterReturnReverseArray() public {
        _batchReplay(true, 4);
    }

    function testBatchPlanetTieArrivalWins() public {
        _batchReplay(false, 0);
    }

    function testBatchMoonTieArrivalWins() public {
        _batchReplay(true, 0);
    }

    function _batchReplay(bool moon, int64 offset) private {
        (uint256 home,) = _fixture(moon, offset);
        MissionResolutionItem[] memory items = new MissionResolutionItem[](3);
        // Put the later leg first, then repeat it: each occurrence has its own truthful result.
        items[0] = MissionResolutionItem(offset < 0 ? ATTACK_ID : RETURN_ID, offset < 0 ? 0 : 1);
        items[1] = MissionResolutionItem(offset < 0 ? RETURN_ID : ATTACK_ID, offset < 0 ? 1 : 0);
        items[2] = items[0];
        if (offset >= 0) {
            (MissionResolutionOutcome[] memory blocked, uint256 blockedGas) =
                game.resolveFleetMissionBatch(items);
            assertGt(blockedGas, 0);
            // The later return stays blocked; the attack commits protection preparation, which
            // needs no oracle, and stops at its pending combat seed.
            assertEq(uint8(blocked[0]), uint8(MissionResolutionOutcome.Failed));
            assertEq(uint8(blocked[1]), uint8(MissionResolutionOutcome.Progress));
            assertEq(uint8(blocked[2]), uint8(MissionResolutionOutcome.Failed));
            assertEq(
                moon
                    ? game.moonShipCount(home, Ship.SmallCargo)
                    : game.shipCount(home, Ship.SmallCargo),
                0
            );
        }
        _fulfillAttackBattleRandomness(ATTACK_ID, 7);
        vm.recordLogs();
        uint256 beforeGas = gasleft();
        (MissionResolutionOutcome[] memory outcomes, uint256 measured) =
            game.resolveFleetMissionBatch{gas: 16_500_000}(items);
        uint256 total = beforeGas - gasleft();
        // --isolate applies refunds; restore them for a conservative pre-refund bound.
        Vm.Gas memory callGas = vm.lastCallGas();
        assertGe(callGas.gasRefunded, 0);
        uint256 refund = uint256(uint64(callGas.gasRefunded));
        uint256 gross = callGas.gasTotalUsed + refund;
        emit log_named_uint("mixed return/combat batch execution gas", total);
        emit log_named_uint("mixed return/combat measured execution gas", measured);
        assertGt(measured, 0);
        assertLt(measured, gross);
        assertLt(gross, 16_777_216 - 50_000);
        assertEq(
            uint8(outcomes[0]),
            offset < 0
                ? uint8(MissionResolutionOutcome.Progress)
                : uint8(MissionResolutionOutcome.Failed)
        );
        assertEq(uint8(outcomes[2]), uint8(MissionResolutionOutcome.Settled));
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bytes32 topic = keccak256(
            "AttackBattleResolved(uint256,address,uint256,uint8,uint8,uint256,uint128,uint128,uint128)"
        );
        bool found;
        for (uint256 i; i < entries.length; ++i) {
            if (entries[i].topics[0] == topic && uint256(entries[i].topics[1]) == ATTACK_ID) {
                (, uint8 rounds,,,,) =
                    abi.decode(entries[i].data, (uint8, uint8, uint256, uint128, uint128, uint128));
                assertEq(rounds != 0, offset < 0);
                found = true;
            }
        }
        assertTrue(found);
        uint32 ships = moon
            ? game.moonShipCount(home, Ship.SmallCargo)
            : game.shipCount(home, Ship.SmallCargo);
        (outcomes,) = game.resolveFleetMissionBatch(items);
        for (uint256 i; i < outcomes.length; ++i) {
            assertEq(uint8(outcomes[i]), uint8(MissionResolutionOutcome.AlreadySettled));
        }
        assertEq(
            moon
                ? game.moonShipCount(home, Ship.SmallCargo)
                : game.shipCount(home, Ship.SmallCargo),
            ships
        );
    }

    function testBodyLaunchPreservesEveryMobileShipQuantity() public {
        vm.warp(RETURN_AT - 1 days);
        (uint256 home, uint256 away,) = _seedMoonAttackPlanets();
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3_000);
        _setTechnologyLevel(address(0xDEF), Technology.IntergalacticResearchNetwork, 3_000);
        _fundPlanet(home, 10_000_000, 10_000_000, 10_000_000);
        VeydriftGameStorage.MissionShips memory ships;
        uint256 field;
        for (uint8 i; i <= uint8(Ship.Pathfinder); ++i) {
            if (Ship(i) == Ship.SolarSatellite) continue;
            // field counts the fixed mobile ship enum (at most 14), safely below uint32.max.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint32 quantity = uint32(++field);
            _setShipCount(home, Ship(i), quantity);
            assembly ("memory-safe") { mstore(add(ships, mul(sub(field, 1), 32)), quantity) }
        }
        vm.prank(player);
        game.launchBodyAttackMission(
            home,
            away,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            100,
            false,
            true,
            VeydriftGameStorage.LootRatio(3_333, 3_333, 3_334)
        );
        for (uint8 i; i <= uint8(Ship.Pathfinder); ++i) {
            assertEq(game.shipCount(home, Ship(i)), 0, "all mobile fields must debit correctly");
        }
    }

    function testFirstPostUpgradeLaunchNeedsNoInitializationBeforeArrivalAndReturn() public {
        vm.warp(RETURN_AT - 1 days);
        (uint256 home, uint256 away,) = _seedMoonAttackPlanets();
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3_000);
        _setPlanetOwner(away, player);
        _fundPlanet(home, 100_000, 100_000, 100_000);
        _setShipCount(home, Ship.SmallCargo, 3);
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 3;
        vm.prank(player);
        uint256 id = game.launchFleetMission(
            home,
            away,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            0
        );
        (, uint64 arrivalAt, uint64 returnAt,) = _fleetMission(id);
        // No player action or explicit sync after launch: only the funded resolver drives progress.
        vm.warp(arrivalAt);
        (bool eligible,, bool orderingReady) = game.fleetMissionEligibility(id);
        assertTrue(eligible, "new launch is indexed atomically, without initialization");
        assertTrue(orderingReady, "idle launch must not disable funded resolution");
        vm.prank(address(0xBEEF));
        game.resolveFleetMission(id);
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(id);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(game.shipCount(home, Ship.SmallCargo), 0);
        vm.warp(returnAt);
        (eligible,, orderingReady) = game.fleetMissionEligibility(id);
        assertTrue(eligible);
        assertTrue(orderingReady);
        vm.prank(address(0xBEEF));
        game.completeFleetMissionReturn(id);
        (status,,,) = _fleetMission(id);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returned));
        assertEq(game.shipCount(home, Ship.SmallCargo), 3);
        assertEq(game.activeFleetMissionCount(player), 0);
    }

    function testUnregisteredLegacyReturnCompletesWithoutMigrationAndCannotBeRelabeled() public {
        vm.warp(RETURN_AT - 1 days);
        (uint256 home, uint256 away,) = _seedMoonAttackPlanets();
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3_000);
        _setPlanetOwner(away, player);
        _fundPlanet(home, 100_000, 100_000, 100_000);
        _setShipCount(home, Ship.SmallCargo, 3);
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 3;
        vm.prank(player);
        uint256 id = game.launchFleetMission(
            home,
            away,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            0
        );
        (, uint64 arrivalAt, uint64 returnAt,) = _fleetMission(id);
        // Reproduce pre-upgrade storage: mission and legacy indexes exist; all appended
        // chronology membership is absent. No historical mission bytes are rewritten by upgrade.
        bytes32 registration = keccak256(abi.encode(id, uint256(86)));
        vm.store(address(game), registration, bytes32(0));
        vm.store(
            address(game),
            keccak256(abi.encode(uint256(keccak256(abi.encode(home, false))), uint256(80))),
            bytes32(0)
        );
        vm.store(
            address(game),
            keccak256(abi.encode(uint256(keccak256(abi.encode(away, false))), uint256(80))),
            bytes32(0)
        );
        vm.store(address(game), keccak256(abi.encode(player, uint256(83))), bytes32(0));
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.Unauthorized.selector, address(this))
        );
        game.registerFleetChronology(id);
        vm.warp(arrivalAt);
        game.resolveFleetMission(id);
        vm.warp(returnAt);
        game.completeFleetMissionReturn(id);
        assertEq(game.shipCount(home, Ship.SmallCargo), 3);
        assertEq(game.activeFleetMissionCount(player), 0);
        assertEq(vm.load(address(game), registration), bytes32(0), "legacy stays legacy");
        // A concurrent repeat is a no-op, never a revert or a second credit.
        game.completeFleetMissionReturn(id);
        assertEq(game.shipCount(home, Ship.SmallCargo), 3, "no double credit");
        // First new allocation immediately uses the prospective rules despite old clients
        // calling the legacy launch selector, and without any initialization transaction.
        vm.prank(player);
        uint256 next = game.launchFleetMission(
            home,
            away,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            0
        );
        assertEq(uint256(vm.load(address(game), keccak256(abi.encode(next, uint256(86))))), 1);
        assertEq(vm.load(address(game), registration), bytes32(0));
    }

    function testRecalledFleetRemainsTrackedUntilScheduledReturn() public {
        vm.warp(RETURN_AT - 1 days);
        (uint256 home, uint256 away,) = _seedMoonAttackPlanets();
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3_000);
        _setTechnologyLevel(address(0xDEF), Technology.IntergalacticResearchNetwork, 3_000);
        _fundPlanet(home, 100_000, 100_000, 100_000);
        _setShipCount(home, Ship.SmallCargo, 3);
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 3;
        vm.prank(player);
        uint256 id = game.launchFleetMission(
            home,
            away,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            0
        );
        vm.warp(block.timestamp + 10);
        vm.prank(player);
        game.recallFleetMission(id);
        (,, uint64 returnAt,) = _fleetMission(id);
        vm.warp(returnAt);
        vm.prank(player);
        game.renamePlanet(home, "recalled");
        assertEq(game.shipCount(home, Ship.SmallCargo), 3);
        assertEq(game.activeFleetMissionCount(player), 0);
    }

    function testEarlierReturnCanLandWhileLaterAttackRandomnessPending() public {
        (uint256 home,) = _fixture(true, -4);
        game.completeFleetMissionReturn(RETURN_ID);
        assertEq(game.moonShipCount(home, Ship.SmallCargo), 196);
        // Protection preparation may progress before the oracle is needed, but no round may
        // execute without randomness. Drive bounded preparation to the actual oracle boundary.
        bool waiting;
        for (uint256 calls; calls < 64; ++calls) {
            try game.resolveFleetMission{gas: 15_000_000}(ATTACK_ID) {}
            catch {
                waiting = true;
                break;
            }
        }
        assertTrue(waiting, "must stop at missing randomness");
        (uint8 rounds,) = game.battleResolutionProgress(ATTACK_ID);
        assertEq(rounds, 0, "no combat before randomness");
        _fulfillAttackBattleRandomness(ATTACK_ID, 7);
        _resolveAttackFully(ATTACK_ID);
        assertEq(game.activeFleetMissionCount(player), 0);
    }

    function testLaterReturnCannotLandWhileEarlierAttackRandomnessPending() public {
        _fixture(false, 4);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.FleetMissionNotResolved.selector, IMPACT_AT)
        );
        game.completeFleetMissionReturn(RETURN_ID);
    }

    function testBoundedReturnScanResumesAndInvalidatesAfterSwapAndPop() public {
        (uint256 home,) = _fixture(false, -4);
        // Model a large legacy tracked array without granting additional fleets/resources.
        bytes32 arraySlot = keccak256(abi.encode(home, uint256(38)));
        bytes32 dataSlot = keccak256(abi.encode(arraySlot));
        vm.store(address(game), arraySlot, bytes32(uint256(32)));
        for (uint256 i; i < 30; ++i) {
            vm.store(address(game), bytes32(uint256(dataSlot) + i), bytes32(uint256(100_000 + i)));
        }
        vm.store(address(game), bytes32(uint256(dataSlot) + 30), bytes32(RETURN_ID));
        vm.store(address(game), bytes32(uint256(dataSlot) + 31), bytes32(ATTACK_ID));
        // Keep the reverse index consistent for the real swap-and-pop untracker.
        bytes32 reverseBase = keccak256(abi.encode(home, uint256(40)));
        vm.store(address(game), keccak256(abi.encode(RETURN_ID, reverseBase)), bytes32(uint256(31)));
        vm.store(address(game), keccak256(abi.encode(ATTACK_ID, reverseBase)), bytes32(uint256(32)));
        _fulfillAttackBattleRandomness(ATTACK_ID, 7);
        bool done;
        for (uint256 calls; calls < 2048; ++calls) {
            uint256 beforeGas = gasleft();
            game.resolveFleetMission{gas: 15_000_000}(ATTACK_ID);
            assertLt(beforeGas - gasleft(), 16_000_000, "bounded Base transaction gas");
            (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(ATTACK_ID);
            if (status != VeydriftGameStorage.FleetMissionStatus.Outbound) {
                done = true;
                break;
            }
        }
        assertTrue(done, "bounded scans must make progress");
        (VeydriftGameStorage.FleetMissionStatus returned,,,) = _fleetMission(RETURN_ID);
        assertEq(uint8(returned), uint8(VeydriftGameStorage.FleetMissionStatus.Returned));
    }

    function testLaterAttackCannotPullReturnAcrossEarlierUnseededImpact() public {
        (uint256 home, uint256 away) = _fixture(false, -4);
        // A genuinely new (higher-ID) attack has an earlier scheduled impact. Registration
        // happens at allocation; synthetic historical insertion is intentionally not backfilled.
        vm.warp(IMPACT_AT - 100);
        _setTechnologyLevel(address(0xDEF), Technology.Computer, 3);
        _setShipCount(away, Ship.SmallCargo, 1);
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(address(0xDEF));
        uint256 earlierId = game.launchFleetMission(
            away,
            home,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            0
        );
        _setTimes(earlierId, RETURN_AT - 1, IMPACT_AT + 100);
        vm.warp(IMPACT_AT + 6);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.FleetMissionNotResolved.selector, RETURN_AT - 1
            )
        );
        game.resolveFleetMission(ATTACK_ID);
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(RETURN_ID);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
    }

    function testEarlierUnresolvedReturnSourceBlocksImpact() public {
        _fixture(false, -4);
        // Simulate a still-unseeded earlier attack whose scheduled round-trip is already over.
        bytes32 slot = keccak256(abi.encode(RETURN_ID, uint256(24)));
        uint256 packed = uint256(vm.load(address(game), slot));
        vm.store(
            address(game),
            slot,
            bytes32(
                (packed & ~uint256(255)) | uint256(VeydriftGameStorage.FleetMissionStatus.Outbound)
            )
        );
        _fulfillAttackBattleRandomness(ATTACK_ID, 7);
        vm.expectRevert();
        game.resolveFleetMission(ATTACK_ID);
    }

    function testAmendedScopeMoonReturnIndependentOfPlanetAttack() public {
        (uint256 home,) = _fixtureBodies(true, false, 4);
        game.completeFleetMissionReturn(RETURN_ID);
        assertEq(game.moonShipCount(home, Ship.SmallCargo), 196);
    }

    function testAmendedScopePlanetReturnIndependentOfMoonAttack() public {
        (uint256 home,) = _fixtureBodies(false, true, 4);
        game.completeFleetMissionReturn(RETURN_ID);
        assertEq(game.shipCount(home, Ship.SmallCargo), 196);
    }

    function testAmendedScopeEarlierTransportPrecedesAttack() public {
        (uint256 home, uint256 away) = _fixture(false, 4);
        vm.warp(IMPACT_AT - 100);
        _setTechnologyLevel(player, Technology.Computer, 3);
        _setPlanetOwner(away, player);
        _setShipCount(away, Ship.SmallCargo, 1);
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 transportId = game.launchFleetMission(
            away,
            home,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            0
        );
        _setPlanetOwner(away, address(0xDEF));
        _setTimes(transportId, IMPACT_AT - 1, IMPACT_AT + 1 hours);
        vm.warp(IMPACT_AT + 6);
        _fulfillAttackBattleRandomness(ATTACK_ID, 7);
        // Either reject/defer the later attack, or settle the earlier transport first.
        (bool ok,) =
            address(game).call(abi.encodeWithSelector(game.resolveFleetMission.selector, ATTACK_ID));
        (VeydriftGameStorage.FleetMissionStatus attackStatus,,,) = _fleetMission(ATTACK_ID);
        (VeydriftGameStorage.FleetMissionStatus transportStatus,,,) = _fleetMission(transportId);
        assertTrue(
            !ok || attackStatus == VeydriftGameStorage.FleetMissionStatus.Outbound
                || transportStatus != VeydriftGameStorage.FleetMissionStatus.Outbound,
            "later attack resolved before earlier transport"
        );
        // Lazy settlement must order the higher-ID earlier transport before the lower-ID battle.
        vm.prank(player);
        game.renamePlanet(home, "chronological transport");
        (attackStatus,,,) = _fleetMission(ATTACK_ID);
        (transportStatus,,,) = _fleetMission(transportId);
        assertTrue(attackStatus != VeydriftGameStorage.FleetMissionStatus.Outbound);
        assertTrue(transportStatus != VeydriftGameStorage.FleetMissionStatus.Outbound);
    }

    function testDestroyedMoonDeployReservesReturnBeforeLaterOriginArrival() public {
        _assertMoonDeployReturn(true, false, false);
    }

    function testReplacementMoonDeployReservesReturnBeforeLaterOriginArrival() public {
        _assertMoonDeployReturn(true, true, false);
    }

    function testDestroyedMoonDeployInvalidatesSavedOriginScan() public {
        _assertMoonDeployReturn(true, false, true);
    }

    function testReplacementMoonDeployInvalidatesSavedOriginScan() public {
        _assertMoonDeployReturn(true, true, true);
    }

    function testSuccessfulMoonDeployDoesNotReserveInventedReturn() public {
        _assertMoonDeployReturn(false, false, false);
    }

    function _assertMoonDeployReturn(bool destroy, bool replace, bool savedScan) private {
        vm.warp(RETURN_AT - 1 days);
        (uint256 home, uint256 away,) = _seedMoonAttackPlanets();
        _setPlanetOwner(away, player);
        _setTechnologyLevel(player, Technology.Computer, 30);
        _fundPlanet(home, 1_000_000, 1_000_000, 1_000_000);
        _fundPlanet(away, 1_000_000, 1_000_000, 1_000_000);
        _setShipCount(home, Ship.SmallCargo, 2);
        _setShipCount(away, Ship.SmallCargo, 14);
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 2;
        vm.prank(player);
        uint256 deployId = game.launchBodyFleetMission(
            home,
            home,
            VeydriftGameStorage.FleetMissionType.Deploy,
            ships,
            VeydriftGameStorage.Resources(123, 45, 0),
            100,
            false,
            true
        );
        _setTimes(deployId, RETURN_AT - 100, RETURN_AT);
        ships.smallCargo = 1;
        if (savedScan) {
            // Keep the first (Deploy) entry in a completed prefix while later entries remain.
            for (uint256 i; i < 13; ++i) {
                vm.prank(player);
                uint256 filler = game.launchFleetMission(
                    away,
                    home,
                    VeydriftGameStorage.FleetMissionType.Deploy,
                    ships,
                    VeydriftGameStorage.Resources(0, 0, 0),
                    0
                );
                _setTimes(filler, IMPACT_AT + 1 days, IMPACT_AT + 2 days);
            }
        }
        vm.prank(player);
        uint256 laterId = game.launchFleetMission(
            away,
            home,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            0
        );
        _setTimes(laterId, IMPACT_AT, IMPACT_AT + 1 hours);
        vm.warp(IMPACT_AT + 6);
        if (savedScan) {
            game.resolveFleetMission(laterId);
            bytes32 scanSlot = bytes32(uint256(keccak256(abi.encode(laterId, uint256(81)))) + 1);
            assertEq(uint256(vm.load(address(game), scanSlot)), 12, "save prefix past deploy");
            (VeydriftGameStorage.FleetMissionStatus pending,,,) = _fleetMission(laterId);
            assertEq(uint8(pending), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        }
        if (destroy) {
            _destroyMoonGuaranteed(home);
            if (replace) _createMoon(home);
            (bool eligible, uint256 blocker, bool ready) = game.fleetMissionEligibility(laterId);
            assertTrue(ready);
            assertFalse(eligible, "failed deploy return must precede later origin arrival");
            assertEq(blocker, deployId);
            // With a saved scan this first call proves preparatory progress, not arrival credit.
            if (savedScan) game.resolveFleetMission(laterId);
            vm.expectRevert(
                abi.encodeWithSelector(
                    VeydriftGameStorage.FleetMissionNotResolved.selector, RETURN_AT
                )
            );
            game.resolveFleetMission(laterId);
            game.resolveFleetMission(deployId);
            (
                VeydriftGameStorage.FleetMissionStatus status,,,
                VeydriftGameStorage.Resources memory cargo
            ) = _fleetMission(deployId);
            assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
            assertEq(cargo.metal, 123);
            assertEq(cargo.crystal, 45);
            for (uint256 i; i < 8; ++i) {
                game.resolveFleetMission(laterId);
                (status,,,) = _fleetMission(laterId);
                if (status != VeydriftGameStorage.FleetMissionStatus.Outbound) break;
            }
            assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
            (status,,,) = _fleetMission(deployId);
            assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returned));
            assertEq(game.shipCount(home, Ship.SmallCargo), 2);
            assertEq(game.moonShipCount(home, Ship.SmallCargo), 0);
            uint128 creditedMetal = game.planet(home).resources.metal;
            // A concurrent repeat is a no-op, never a revert or a second credit.
            game.completeFleetMissionReturn(deployId);
            assertEq(game.planet(home).resources.metal, creditedMetal);
        } else {
            (bool eligible,,) = game.fleetMissionEligibility(laterId);
            assertTrue(eligible, "normal deploy has no origin return dependency");
            game.resolveFleetMission(laterId);
            game.resolveFleetMission(deployId);
            (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(deployId);
            assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
            assertEq(game.moonShipCount(home, Ship.SmallCargo), 2);
            assertEq(game.shipCount(home, Ship.SmallCargo), 0);
        }
    }

    function _setTimes(uint256 id, uint64 arrivalAt, uint64 returnAt) private {
        bytes32 slot = bytes32(uint256(keccak256(abi.encode(id, uint256(24)))) + 3);
        uint256 departure = uint256(vm.load(address(game), slot)) & type(uint64).max;
        vm.store(
            address(game),
            slot,
            bytes32(departure | uint256(arrivalAt) << 64 | uint256(returnAt) << 128)
        );
    }
}
