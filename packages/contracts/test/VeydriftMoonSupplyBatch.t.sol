// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {ProductionBatchTransactionProbe} from "./ProductionBatchTransactionProbe.sol";
import {VeydriftMoonSystemTestBase} from "./VeydriftMoonSystem.t.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftGameStorage as G} from "../src/VeydriftGameStorage.sol";
import {VeydriftBatchTransportModule} from "../src/VeydriftBatchTransportModule.sol";
import {IVeydriftDelegation} from "../src/interfaces/IVeydriftDelegation.sol";
import {Ship, Technology, Building} from "../src/libraries/VeydriftTypes.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract VeydriftMoonSupplyBatchTest is VeydriftMoonSystemTestBase {
    function _batch() internal view returns (VeydriftBatchTransportModule) {
        return VeydriftBatchTransportModule(address(game));
    }

    function _seed(uint16 count)
        internal
        returns (uint256 target, G.TransportBatchOrder[] memory orders)
    {
        vm.warp(1000);
        target = _startPlanet();
        _setPlanetLocation(target, player, 1, 100, 8);
        _createMoon(target);
        _setTechnologyLevel(player, Technology.Computer, 20);
        orders = new G.TransportBatchOrder[](count);
        for (uint16 i; i < count; ++i) {
            uint256 origin = i == 0 ? target : 1000 + i;
            _setPlanetLocation(origin, player, 1, uint16(100 + i), 8);
            _fundPlanet(origin, 1_000_000, 1_000_000, 1_000_000);
            _setShipCount(origin, Ship.SmallCargo, 1);
            orders[i].originPlanetId = origin;
            orders[i].ships.smallCargo = 1;
            orders[i].cargo = G.Resources(100, 50, 25);
            orders[i].speedPercent = 100;
        }
    }

    function _launch(uint256 target, G.TransportBatchOrder[] memory orders, bool deploy)
        internal
        returns (uint256[] memory)
    {
        vm.prank(player);
        return deploy
            ? _batch().launchBodyDeployBatch(target, orders)
            : _batch().launchBodyTransportBatch(target, orders);
    }

    function _lifecycle(uint16 count, bool deploy) internal {
        (uint256 target, G.TransportBatchOrder[] memory orders) = _seed(count);
        _fundMoon(target, 777, 555, 333);
        _setMoonShipCount(target, Ship.SmallCargo, 7);
        vm.recordLogs();
        uint256[] memory ids = _launch(target, orders, deploy);
        Vm.Log[] memory launchLogs = vm.getRecordedLogs();
        assertEq(ids.length, count);
        assertEq(game.activeFleetMissionCount(player), count);
        uint64 latestArrival;
        uint64 latestReturn;
        for (uint256 i; i < count; ++i) {
            (
                G.FleetMissionStatus status,
                G.FleetMissionType mode,
                address owner,
                uint256 origin,
                uint256 destination,,
                uint64 arrivalAt,
                uint64 returnAt,
                uint128 fuel,
                G.Resources memory cargo,
            ) = game.fleetMission(ids[i]);
            assertEq(uint8(status), uint8(G.FleetMissionStatus.Outbound));
            assertEq(uint8(mode), deploy ? 1 : 0);
            assertEq(owner, player);
            assertEq(origin, orders[i].originPlanetId);
            assertEq(destination, target);
            assertEq(cargo.deuterium, 25);
            _assertFleetMissionBodiesLog(launchLogs, ids[i], false, true);
            assertEq(game.shipCount(origin, Ship.SmallCargo), 0);
            assertEq(game.planet(origin).resources.metal, 1_000_000 - cargo.metal);
            assertEq(game.planet(origin).resources.deuterium, 1_000_000 - cargo.deuterium - fuel);
            if (arrivalAt > latestArrival) latestArrival = arrivalAt;
            if (returnAt > latestReturn) latestReturn = returnAt;
        }
        assertEq(game.moonShipCount(target, Ship.SmallCargo), 7);
        vm.warp(latestArrival);
        for (uint256 i; i < count; ++i) {
            for (uint256 attempt; attempt < 8; ++attempt) {
                game.resolveFleetMission(ids[i]);
                (G.FleetMissionStatus status,,,) = _fleetMission(ids[i]);
                if (status != G.FleetMissionStatus.Outbound) break;
                assertLt(attempt, 7, "arrival chronology did not finish");
            }
        }
        G.Resources memory received = game.moonResources(target);
        assertEq(received.metal, 777 + uint256(count) * 100);
        assertEq(received.crystal, 555 + uint256(count) * 50);
        assertEq(received.deuterium, 333 + uint256(count) * 25);
        assertEq(game.moonShipCount(target, Ship.SmallCargo), deploy ? 7 + count : 7);
        if (!deploy) {
            vm.warp(latestReturn);
            for (uint256 i; i < count; ++i) {
                game.completeFleetMissionReturn(ids[i]);
            }
        }
        for (uint256 i; i < count; ++i) {
            assertEq(game.shipCount(orders[i].originPlanetId, Ship.SmallCargo), deploy ? 0 : 1);
        }
        assertEq(game.activeFleetMissionCount(player), 0);
    }

    function testTwoTransportParentAndOtherPlanetLifecycle() public {
        _lifecycle(2, false);
    }

    function testTwoDeployParentAndOtherPlanetLifecycle() public {
        _lifecycle(2, true);
    }

    function testFifteenTransportLifecycle() public {
        _lifecycle(15, false);
    }

    function testFifteenDeployLifecycle() public {
        _lifecycle(15, true);
    }

    function testBothModesRejectZeroAndSixteen() public {
        for (uint256 mode; mode < 2; ++mode) {
            for (uint256 count; count <= 16; count += 16) {
                G.TransportBatchOrder[] memory orders = new G.TransportBatchOrder[](count);
                vm.expectRevert(G.InvalidQuantity.selector);
                _launch(1, orders, mode == 1);
            }
        }
    }

    function _unchanged(G.TransportBatchOrder[] memory orders, uint256 next) internal view {
        assertEq(game.nextFleetId(), next);
        assertEq(game.activeFleetMissionCount(player), 0);
        (G.FleetMissionStatus status,,,) = _fleetMission(next);
        assertEq(uint8(status), uint8(G.FleetMissionStatus.None));
        assertEq(game.moonResources(orders[0].originPlanetId).metal, 0);
        for (uint256 i; i < orders.length; ++i) {
            assertEq(game.shipCount(orders[i].originPlanetId, Ship.SmallCargo), 1);
            assertEq(game.planet(orders[i].originPlanetId).resources.metal, 1_000_000);
            assertEq(game.planet(orders[i].originPlanetId).resources.deuterium, 1_000_000);
        }
    }

    function testInvalidLaterOrderRollsBackBothModes() public {
        (uint256 target, G.TransportBatchOrder[] memory orders) = _seed(2);
        uint256 next = game.nextFleetId();
        for (uint256 mode; mode < 2; ++mode) {
            orders[1].ships.smallCargo = 2;
            vm.expectRevert(
                abi.encodeWithSelector(G.InsufficientShips.selector, Ship.SmallCargo, 1, 2)
            );
            _launch(target, orders, mode == 1);
            _unchanged(orders, next);
            orders[1].ships.smallCargo = 1;
            orders[1].cargo.metal = 6000;
            vm.expectRevert();
            _launch(target, orders, mode == 1);
            _unchanged(orders, next);
            orders[1].cargo.metal = 100;
            orders[1].speedPercent = 0;
            vm.expectRevert();
            _launch(target, orders, mode == 1);
            _unchanged(orders, next);
            orders[1].speedPercent = 100;
        }
    }

    function testDuplicateOriginRollsBackBothModes() public {
        (uint256 target, G.TransportBatchOrder[] memory orders) = _seed(2);
        orders[1].originPlanetId = target;
        uint256 next = game.nextFleetId();
        for (uint256 mode; mode < 2; ++mode) {
            vm.expectRevert(G.InvalidQuantity.selector);
            _launch(target, orders, mode == 1);
            _unchanged(orders, next);
        }
    }

    function testMissingDestroyedAndUnownedDestinationBothModes() public {
        (uint256 target, G.TransportBatchOrder[] memory orders) = _seed(2);
        uint256 next = game.nextFleetId();
        _destroyMoonGuaranteed(target);
        for (uint256 mode; mode < 2; ++mode) {
            vm.expectRevert(G.NoPlanet.selector);
            _launch(target, orders, mode == 1);
            _unchanged(orders, next);
            vm.expectRevert(G.NoPlanet.selector);
            _launch(99999, orders, mode == 1);
            _setPlanetOwner(target, address(0xBAD));
            vm.expectRevert(G.NotPlanetOwner.selector);
            _launch(target, orders, mode == 1);
            _setPlanetOwner(target, player);
        }
        _createMoon(target);
        _launch(target, orders, false);
    }

    function testLaterOriginOwnerAndSlotsAndPauseBothModes() public {
        (uint256 target, G.TransportBatchOrder[] memory orders) = _seed(2);
        uint256 next = game.nextFleetId();
        for (uint256 mode; mode < 2; ++mode) {
            _setPlanetOwner(orders[1].originPlanetId, address(0xBAD));
            vm.expectRevert(G.NotPlanetOwner.selector);
            _launch(target, orders, mode == 1);
            _setPlanetOwner(orders[1].originPlanetId, player);
            _unchanged(orders, next);
            _setTechnologyLevel(player, Technology.Computer, 0);
            vm.expectRevert(abi.encodeWithSelector(G.FleetSlotLimitReached.selector, 1));
            _launch(target, orders, mode == 1);
            _setTechnologyLevel(player, Technology.Computer, 20);
            vm.prank(admin);
            game.setGamePaused(true);
            vm.expectRevert(abi.encodeWithSelector(G.Unauthorized.selector, player));
            _launch(target, orders, mode == 1);
            vm.prank(admin);
            game.setGamePaused(false);
            _unchanged(orders, next);
        }
    }

    function _replacement(bool deploy, bool recreate) internal {
        (uint256 target, G.TransportBatchOrder[] memory orders) = _seed(2);
        uint256[] memory ids = _launch(target, orders, deploy);
        _destroyMoonGuaranteed(target);
        if (recreate) _createMoon(target);
        (, uint64 at, uint64 back,) = _fleetMission(ids[1]);
        vm.warp(at);
        for (uint256 i; i < ids.length; ++i) {
            game.resolveFleetMission(ids[i]);
            (G.FleetMissionStatus status,,, G.Resources memory cargo) = _fleetMission(ids[i]);
            assertEq(uint8(status), uint8(G.FleetMissionStatus.Returning));
            assertEq(cargo.metal, 100);
        }
        assertEq(game.moonResources(target).metal, 0);
        assertEq(game.moonShipCount(target, Ship.SmallCargo), 0);
        vm.warp(back);
        for (uint256 i; i < ids.length; ++i) {
            game.completeFleetMissionReturn(ids[i]);
            assertEq(game.shipCount(orders[i].originPlanetId, Ship.SmallCargo), 1);
        }
        assertEq(game.activeFleetMissionCount(player), 0);
    }

    function testReplacementMoonTransportReturnsCargoAndShips() public {
        _replacement(false, true);
    }

    function testReplacementMoonDeployReturnsCargoAndShips() public {
        _replacement(true, true);
    }

    function testDestroyedMoonTransportReturnsCargoAndShips() public {
        _replacement(false, false);
    }

    function testDestroyedMoonDeployReturnsCargoAndShips() public {
        _replacement(true, false);
    }

    function testDelegationPreserved() public {
        (uint256 target, G.TransportBatchOrder[] memory orders) = _seed(2);
        vm.prank(player);
        IVeydriftDelegation(address(game)).setDelegate(delegate);
        vm.prank(delegate);
        uint256[] memory ids = _batch().launchBodyDeployBatch(target, orders);
        (,, address owner,,,,,,,,) = game.fleetMission(ids[1]);
        assertEq(owner, player);
        assertEq(game.activeFleetMissionCount(delegate), 0);
    }

    function testCapabilityGetterThroughProxyAndFacadeSize() public {
        ERC1967Proxy proxy =
            new ERC1967Proxy(address(game), abi.encodeWithSignature("initialize(address)", admin));
        assertEq(VeydriftBatchTransportModule(address(proxy)).moonSupplyBatchVersion(), 1);
        assertEq(_batch().moonSupplyBatchVersion(), 1);
        // Old facades route unknown selectors to a module that rejects them. A missing
        // getter must remain distinguishable from the new positive capability result.
        vm.etch(address(proxy), hex"60006000fd");
        (bool supported, bytes memory result) = address(proxy)
            .staticcall(
                abi.encodeWithSelector(VeydriftBatchTransportModule.moonSupplyBatchVersion.selector)
            );
        assertFalse(supported);
        assertEq(result.length, 0);
        assertLe(address(game).code.length, 24_576);
    }

    function _building(uint256 origin, Building building, uint16 level) internal {
        bytes32 outer = keccak256(abi.encode(origin, uint256(6)));
        vm.store(
            address(game),
            keccak256(abi.encode(uint256(uint8(building)), outer)),
            bytes32(uint256(level))
        );
    }

    function testMaturedShipProductionAndResourcesReconciled() public {
        (uint256 target, G.TransportBatchOrder[] memory orders) = _seed(2);
        uint64 ready;
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        for (uint256 i; i < 2; ++i) {
            uint256 origin = orders[i].originPlanetId;
            _building(origin, Building.Shipyard, 4);
            _setShipCount(origin, Ship.SmallCargo, 0);
            vm.prank(player);
            game.startShipProduction(origin, Ship.SmallCargo, 1);
            if (game.shipQueue(origin).readyAt > ready) ready = game.shipQueue(origin).readyAt;
        }
        vm.warp(uint256(ready) + 1);
        uint256[] memory ids = _launch(target, orders, false);
        assertEq(ids.length, 2);
        for (uint256 i; i < 2; ++i) {
            uint256 origin = orders[i].originPlanetId;
            assertFalse(game.shipQueue(origin).active);
            assertEq(game.shipCount(origin, Ship.SmallCargo), 0);
            assertEq(game.planet(origin).lastSettledAt, block.timestamp);
        }
    }

    function testReturnedFleetReconciledBeforeNextBatch() public {
        (uint256 target, G.TransportBatchOrder[] memory orders) = _seed(2);
        uint256[] memory first = _launch(target, orders, false);
        (, uint64 arrival, uint64 back,) = _fleetMission(first[1]);
        vm.warp(arrival);
        game.resolveFleetMission(first[0]);
        game.resolveFleetMission(first[1]);
        _setTechnologyLevel(player, Technology.Computer, 1);
        vm.warp(back);
        uint256[] memory second = _launch(target, orders, true);
        assertEq(second.length, 2);
        assertEq(game.activeFleetMissionCount(player), 2);
        for (uint256 i; i < 2; ++i) {
            (G.FleetMissionStatus status,,,) = _fleetMission(first[i]);
            assertEq(uint8(status), uint8(G.FleetMissionStatus.Returned));
            assertEq(game.shipCount(orders[i].originPlanetId, Ship.SmallCargo), 0);
        }
    }

    function testLaterOriginStagedLockRollsBackEarlierLaunch() public {
        (uint256 target, G.TransportBatchOrder[] memory orders) = _seed(2);
        bytes32 lockSlot = keccak256(
            abi.encode(
                orders[1].originPlanetId,
                uint256(keccak256("veydrift.storage.staged-battle.v1")) + 1
            )
        );
        vm.store(address(game), lockSlot, bytes32(uint256(999)));
        uint256 next = game.nextFleetId();
        vm.expectRevert(abi.encodeWithSelector(G.FleetMissionNotResolved.selector, uint64(0)));
        _launch(target, orders, true);
        _unchanged(orders, next);
    }

    function _gasBatch(bool deploy, bool mixed, bool capped) internal {
        ProductionBatchTransactionProbe probe = new ProductionBatchTransactionProbe();
        probe.write(1);
        (uint256 storageGas, uint256 transientValue) = probe.write(2);
        assertGt(storageGas, 4900, "gas fixture requires committed storage");
        assertEq(transientValue, 0, "gas fixture requires distinct transactions");
        (uint256 target, G.TransportBatchOrder[] memory orders) = _seed(15);
        if (mixed) {
            uint64 ready;
            for (uint256 i; i < orders.length; ++i) {
                orders[i].ships = G.MissionShips(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
                orders[i].speedPercent = uint16(70 + (i % 4) * 10);
                // Different schedules prevent chronology from sharing the same event times.
                // Matured production also exercises the real canonical launch prologue.
                _building(orders[i].originPlanetId, Building.Shipyard, 4);
                _setTechnologyLevel(player, Technology.CombustionDrive, 2);
                vm.prank(player);
                game.startShipProduction(orders[i].originPlanetId, Ship.SmallCargo, 1);
                if (game.shipQueue(orders[i].originPlanetId).readyAt > ready) {
                    ready = game.shipQueue(orders[i].originPlanetId).readyAt;
                }
                _fundPlanet(orders[i].originPlanetId, 1_000_000, 1_000_000, 1_000_000);
                for (uint8 j; j <= uint8(Ship.Pathfinder); ++j) {
                    if (j != uint8(Ship.SolarSatellite)) {
                        _setShipCount(orders[i].originPlanetId, Ship(j), 1);
                    }
                }
            }
            vm.warp(uint256(ready) + 1);
        }
        uint256 next = game.nextFleetId();
        if (capped && mixed) vm.expectRevert();
        vm.prank(player);
        if (deploy) {
            _batch().launchBodyDeployBatch{gas: capped ? 16_777_216 - 21_000 : 100_000_000}(
                target, orders
            );
        } else {
            _batch().launchBodyTransportBatch{gas: capped ? 16_777_216 - 21_000 : 100_000_000}(
                target, orders
            );
        }
        Vm.Gas memory measured = vm.lastCallGas();
        uint256 gross = measured.gasTotalUsed + uint256(uint64(measured.gasRefunded));
        emit log_named_uint("moon batch gross transaction gas", gross);
        if (mixed && capped) {
            _unchanged(orders, next);
        } else {
            assertEq(game.activeFleetMissionCount(player), 15);
            if (mixed) assertGt(gross, 16_777_216);
            else assertLt(gross, 16_777_216);
        }
    }

    /// forge-config: default.isolate = true
    function testFifteenCargoTransportFitsBaseGasCap() public {
        _gasBatch(false, false, true);
    }

    /// forge-config: default.isolate = true
    function testFifteenCargoDeployFitsBaseGasCap() public {
        _gasBatch(true, false, true);
    }

    /// forge-config: default.isolate = true
    function testFifteenMixedTransportRequiresGasPreflight() public {
        _gasBatch(false, true, false);
    }

    /// forge-config: default.isolate = true
    function testFifteenMixedDeployRequiresGasPreflight() public {
        _gasBatch(true, true, false);
    }

    /// forge-config: default.isolate = true
    function testFifteenMixedTransportGasCapAtomicRollback() public {
        _gasBatch(false, true, true);
    }

    /// forge-config: default.isolate = true
    function testFifteenMixedDeployGasCapAtomicRollback() public {
        _gasBatch(true, true, true);
    }

    function testProxyRoutedMoonDeployBatch() public {
        game = VeydriftGame(
            payable(address(
                    new ERC1967Proxy(
                        address(game), abi.encodeWithSignature("initialize(address)", admin)
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
        _lifecycle(2, true);
    }

    function testLegacySingleMoonCompatibility() public {
        _testPlanetToMoonTransportMovesCargoAndReturnsShips();
    }

    function testLegacyPlanetBatchStillRejectsSameBody() public {
        (uint256 target, G.TransportBatchOrder[] memory orders) = _seed(2);
        vm.prank(player);
        vm.expectRevert(G.SamePlanet.selector);
        _batch().launchTransportBatch(target, orders);
        vm.prank(player);
        vm.expectRevert(G.SamePlanet.selector);
        _batch().launchDeployBatch(target, orders);
    }
}
