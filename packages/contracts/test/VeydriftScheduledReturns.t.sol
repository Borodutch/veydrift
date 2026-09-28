// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {VeydriftMoonSystemTestBase} from "./VeydriftMoonSystem.t.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {Ship, Technology} from "../src/libraries/VeydriftTypes.sol";

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
        // Synthetic fixture has no IDs below RETURN_ID; migration completeness is tested separately.
        vm.store(address(game), bytes32(uint256(78)), bytes32(RETURN_ID - 1));
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
        game.resolveFleetMission(id);
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
        game.syncFleetChronology(256);
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
            game.renamePlanet(home, "chronological");
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
            vm.expectRevert();
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
        vm.expectRevert();
        game.resolveFleetMission(ATTACK_ID);
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
        for (uint256 calls; calls < 20; ++calls) {
            uint256 beforeGas = gasleft();
            game.resolveFleetMission(ATTACK_ID);
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
        // The same returning fleet falls AFTER an additional earlier impact.
        bytes32 arraySlot = keccak256(abi.encode(home, uint256(38)));
        uint256 count = uint256(vm.load(address(game), arraySlot));
        bytes32 dataSlot = keccak256(abi.encode(arraySlot));
        uint256 earlierId = 93789;
        vm.store(address(game), bytes32(uint256(dataSlot) + count), bytes32(earlierId));
        vm.store(address(game), arraySlot, bytes32(count + 1));
        uint256 base = uint256(keccak256(abi.encode(earlierId, uint256(24))));
        vm.store(
            address(game),
            bytes32(base),
            bytes32(
                uint256(VeydriftGameStorage.FleetMissionStatus.Outbound)
                    | uint256(VeydriftGameStorage.FleetMissionType.Attack) << 8
                    | uint256(uint160(address(0xDEF))) << 16
            )
        );
        vm.store(address(game), bytes32(base + 1), bytes32(away));
        vm.store(address(game), bytes32(base + 2), bytes32(home));
        vm.store(
            address(game),
            bytes32(base + 3),
            bytes32(uint256(RETURN_AT - 1) << 64 | uint256(IMPACT_AT + 100) << 128)
        );
        // This fixture writes an older ID directly; replay that artificial insertion through
        // the complete inventory. Real launches only allocate IDs above the durable cursor.
        vm.store(address(game), bytes32(uint256(78)), bytes32(earlierId - 1));
        game.syncFleetChronology(256);
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
