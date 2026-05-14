// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {Building, Defense, Ship, Technology} from "../src/libraries/VeydriftTypes.sol";

contract VeydriftGameTest is Test {
    address internal admin = address(0xA11CE);
    address internal player = address(0xB0B);
    VeydriftGame internal game;

    function setUp() public {
        VeydriftGame implementation = new VeydriftGame();
        bytes memory initData = abi.encodeCall(VeydriftGame.initialize, (admin));
        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        game = VeydriftGame(address(proxy));
        vm.deal(player, 1 ether);
    }

    function testProxyInitializationAndUpgradeGuard() public {
        assertEq(game.owner(), admin);
        assertEq(game.startPrice(), 0.05 ether);

        VeydriftGame nextImplementation = new VeydriftGame();
        vm.prank(player);
        vm.expectRevert();
        game.upgradeToAndCall(address(nextImplementation), "");

        vm.prank(admin);
        game.upgradeToAndCall(address(nextImplementation), "");
        assertEq(game.owner(), admin);
    }

    function testPlanetGenerationPaymentCoordinatesAndInitialResources() public {
        vm.prank(player);
        vm.expectRevert(VeydriftGame.BadStartPayment.selector);
        game.startPlanet{value: 0.049 ether}();

        uint256 planetId = _startPlanet(player);
        VeydriftGame.Planet memory planet = game.planet(planetId);
        assertEq(planet.owner, player);
        assertGe(planet.galaxy, 1);
        assertLe(planet.galaxy, 9);
        assertGe(planet.system, 1);
        assertLe(planet.system, 499);
        assertGe(planet.position, 1);
        assertLe(planet.position, 15);
        assertGe(planet.fields, 160);
        assertLe(planet.fields, 239);
        assertEq(planet.resources.metal, 5_000);
        assertEq(planet.resources.crystal, 5_000);
        assertEq(planet.resources.deuterium, 5_000);

        vm.prank(player);
        vm.expectRevert(VeydriftGame.AlreadyStarted.selector);
        game.startPlanet{value: 0.05 ether}();
    }

    function testResourceAccrualOverElapsedTime() public {
        uint256 planetId = _startPlanet(player);
        VeydriftGame.Resources memory beforeResources = game.previewResources(planetId);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(player);
        game.collectResources(planetId);

        VeydriftGame.Resources memory afterResources = game.previewResources(planetId);
        assertGt(afterResources.metal, beforeResources.metal);
        assertGt(afterResources.crystal, beforeResources.crystal);
        assertGt(afterResources.deuterium, beforeResources.deuterium);
    }

    function testBuildingConstructionAndCompletion() public {
        uint256 planetId = _startPlanet(player);

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.MetalMine);

        VeydriftGame.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        assertTrue(construction.active);
        assertEq(construction.targetLevel, 1);

        vm.prank(player);
        vm.expectRevert();
        game.finishBuildingUpgrade(planetId);

        vm.warp(construction.readyAt);
        vm.prank(player);
        game.finishBuildingUpgrade(planetId);

        assertEq(game.buildingLevel(planetId, Building.MetalMine), 1);
    }

    function testDefenseProduction() public {
        uint256 planetId = _preparePlanetWithShipyard(player);

        vm.prank(player);
        game.startDefenseProduction(planetId, Defense.RocketLauncher, 3);
        VeydriftGame.DefenseQueue memory queue = game.defenseQueue(planetId);

        vm.warp(queue.readyAt);
        vm.prank(player);
        game.finishDefenseProduction(planetId);

        assertEq(game.defenseCount(planetId, Defense.RocketLauncher), 3);
    }

    function testShipProduction() public {
        uint256 planetId = _preparePlanetWithShipyardAndResearch(player);
        _research(player, planetId, Technology.CombustionDrive);

        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 1);
        VeydriftGame.ShipQueue memory queue = game.shipQueue(planetId);

        vm.warp(queue.readyAt);
        vm.prank(player);
        game.finishShipProduction(planetId);

        assertEq(game.shipCount(planetId, Ship.SmallCargo), 1);
    }

    function testTechnologyResearch() public {
        uint256 planetId = _preparePlanetWithShipyardAndResearch(player);

        _research(player, planetId, Technology.Energy);

        assertEq(game.technologyLevel(player, Technology.Energy), 1);
    }

    function testDependencyResourceAndAccessFailures() public {
        uint256 planetId = _startPlanet(player);

        vm.prank(player);
        vm.expectRevert();
        game.startBuildingUpgrade(planetId, Building.Shipyard);

        vm.prank(address(0xCAFE));
        vm.expectRevert(VeydriftGame.NotPlanetOwner.selector);
        game.collectResources(planetId);

        _build(player, planetId, Building.RoboticsFactory);
        _build(player, planetId, Building.RoboticsFactory);
        _build(player, planetId, Building.Shipyard);

        vm.prank(player);
        vm.expectRevert();
        game.startShipProduction(planetId, Ship.SmallCargo, 1);

        vm.prank(admin);
        game.setStartPrice(0.07 ether);
        address nextPlayer = address(0xD00D);
        vm.deal(nextPlayer, 1 ether);
        vm.prank(nextPlayer);
        vm.expectRevert(VeydriftGame.BadStartPayment.selector);
        game.startPlanet{value: 0.05 ether}();
    }

    function testColonyCreationConsumesColonyShipAndReservesCoordinates() public {
        uint256 originPlanetId = _prepareColonizer(player);
        (uint16 galaxy, uint16 system, uint8 position) = game.nextColonyCoordinates(player, 42);

        vm.prank(player);
        uint256 colonyPlanetId = game.createColony(originPlanetId, galaxy, system, position);

        VeydriftGame.Planet memory colony = game.planet(colonyPlanetId);
        assertEq(colony.owner, player);
        assertEq(colony.galaxy, galaxy);
        assertEq(colony.system, system);
        assertEq(colony.position, position);
        assertEq(colony.resources.metal, 500);
        assertEq(colony.resources.crystal, 500);
        assertEq(colony.resources.deuterium, 0);
        assertEq(game.planetCountOf(player), 2);
        assertEq(game.maxPlanets(player), 2);
        assertEq(game.shipCount(originPlanetId, Ship.ColonyShip), 0);
        assertFalse(game.isCoordinateAvailable(galaxy, system, position));
    }

    function testColonyCreationRejectsOccupiedCoordinatesAndPlanetLimit() public {
        uint256 originPlanetId = _prepareColonizer(player);
        VeydriftGame.Planet memory home = game.planet(originPlanetId);

        vm.prank(player);
        vm.expectRevert(VeydriftGame.CoordinatesOccupied.selector);
        game.createColony(originPlanetId, home.galaxy, home.system, home.position);

        (uint16 galaxy, uint16 system, uint8 position) = game.nextColonyCoordinates(player, 7);
        vm.prank(player);
        game.createColony(originPlanetId, galaxy, system, position);

        (galaxy, system, position) = game.nextColonyCoordinates(player, 8);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftGame.PlanetLimitReached.selector, 2));
        game.createColony(originPlanetId, galaxy, system, position);
    }

    function testTransportDispatchCapacityFuelTimingAndArrivalSettlement() public {
        (uint256 originPlanetId, uint256 colonyPlanetId) = _prepareTransportRoute(player);
        VeydriftGame.Resources memory cargo =
            VeydriftGame.Resources({metal: 1_000, crystal: 500, deuterium: 100});
        uint128 fuelCost = game.transportFuelCost(originPlanetId, colonyPlanetId, 1, 0, 0);
        uint256 travelSeconds = game.transportTravelSeconds(originPlanetId, colonyPlanetId);
        VeydriftGame.Planet memory originBefore = game.planet(originPlanetId);
        uint256 dispatchedAt = block.timestamp;

        vm.prank(player);
        uint256 fleetId = game.dispatchTransport(originPlanetId, colonyPlanetId, 1, 0, 0, cargo);

        VeydriftGame.Fleet memory fleet = game.fleet(fleetId);
        assertTrue(fleet.active);
        assertEq(fleet.owner, player);
        assertEq(fleet.arrivesAt, dispatchedAt + travelSeconds);
        assertEq(fleet.fuelCost, fuelCost);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 0);
        VeydriftGame.Planet memory originAfter = game.planet(originPlanetId);
        assertEq(originAfter.resources.metal, originBefore.resources.metal - cargo.metal);
        assertEq(originAfter.resources.crystal, originBefore.resources.crystal - cargo.crystal);
        assertEq(
            originAfter.resources.deuterium,
            originBefore.resources.deuterium - cargo.deuterium - fuelCost
        );

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGame.FleetNotArrived.selector, fleet.arrivesAt)
        );
        game.settleFleetArrival(fleetId);

        vm.warp(fleet.arrivesAt);
        vm.prank(player);
        game.settleFleetArrival(fleetId);

        VeydriftGame.Fleet memory settledFleet = game.fleet(fleetId);
        assertFalse(settledFleet.active);
        assertEq(game.shipCount(colonyPlanetId, Ship.SmallCargo), 1);
        VeydriftGame.Planet memory colony = game.planet(colonyPlanetId);
        assertGe(colony.resources.metal, 1_500);
        assertGe(colony.resources.crystal, 1_000);
        assertGe(colony.resources.deuterium, 100);
    }

    function testTransportRejectsOverCapacityAndCanRecall() public {
        (uint256 originPlanetId, uint256 colonyPlanetId) = _prepareTransportRoute(player);
        VeydriftGame.Resources memory tooMuchCargo =
            VeydriftGame.Resources({metal: 5_001, crystal: 0, deuterium: 0});

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGame.CargoCapacityExceeded.selector, 5_000, 5_001)
        );
        game.dispatchTransport(originPlanetId, colonyPlanetId, 1, 0, 0, tooMuchCargo);

        VeydriftGame.Resources memory cargo =
            VeydriftGame.Resources({metal: 700, crystal: 300, deuterium: 0});
        vm.prank(player);
        uint256 fleetId = game.dispatchTransport(originPlanetId, colonyPlanetId, 1, 0, 0, cargo);

        vm.warp(block.timestamp + 90 seconds);
        vm.prank(player);
        game.recallFleet(fleetId);
        VeydriftGame.Fleet memory recalled = game.fleet(fleetId);
        assertTrue(recalled.returning);

        vm.prank(player);
        vm.expectRevert(VeydriftGame.FleetAlreadyReturning.selector);
        game.recallFleet(fleetId);

        vm.warp(recalled.arrivesAt);
        vm.prank(player);
        game.settleFleetArrival(fleetId);

        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 1);
        VeydriftGame.Planet memory origin = game.planet(originPlanetId);
        assertGe(origin.resources.metal, cargo.metal);
        assertGe(origin.resources.crystal, cargo.crystal);
    }

    function _startPlanet(address account) internal returns (uint256 planetId) {
        vm.prank(account);
        planetId = game.startPlanet{value: 0.05 ether}();
    }

    function _preparePlanetWithShipyard(address account) internal returns (uint256 planetId) {
        planetId = _startPlanet(account);
        _build(account, planetId, Building.RoboticsFactory);
        _build(account, planetId, Building.RoboticsFactory);
        _build(account, planetId, Building.Shipyard);
    }

    function _preparePlanetWithShipyardAndResearch(address account)
        internal
        returns (uint256 planetId)
    {
        planetId = _preparePlanetWithShipyard(account);
        _build(account, planetId, Building.ResearchLab);
    }

    function _build(address account, uint256 planetId, Building building) internal {
        vm.prank(account);
        game.startBuildingUpgrade(planetId, building);
        VeydriftGame.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        vm.warp(construction.readyAt);
        vm.prank(account);
        game.finishBuildingUpgrade(planetId);
    }

    function _research(address account, uint256 planetId, Technology technology) internal {
        vm.prank(account);
        game.startResearch(planetId, technology);
        VeydriftGame.ResearchQueue memory queue = game.researchQueue(account);
        vm.warp(queue.readyAt);
        vm.prank(account);
        game.finishResearch();
    }

    function _prepareColonizer(address account) internal returns (uint256 planetId) {
        planetId = _preparePlanetWithShipyardAndResearch(account);
        _buildWithAccrual(account, planetId, Building.CrystalStorage);
        _researchWithAccrual(account, planetId, Technology.Computer);
        _researchWithAccrual(account, planetId, Technology.CombustionDrive);
        _researchWithAccrual(account, planetId, Technology.CombustionDrive);
        _researchWithAccrual(account, planetId, Technology.CombustionDrive);
        _produceShipWithAccrual(account, planetId, Ship.ColonyShip, 1);
    }

    function _prepareTransportRoute(address account)
        internal
        returns (uint256 originPlanetId, uint256 colonyPlanetId)
    {
        originPlanetId = _prepareColonizer(account);
        _produceShipWithAccrual(account, originPlanetId, Ship.SmallCargo, 1);
        _accrueToCaps(account, originPlanetId);

        (uint16 galaxy, uint16 system, uint8 position) = game.nextColonyCoordinates(account, 101);
        vm.prank(account);
        colonyPlanetId = game.createColony(originPlanetId, galaxy, system, position);
    }

    function _buildWithAccrual(address account, uint256 planetId, Building building) internal {
        _accrueToCaps(account, planetId);
        _build(account, planetId, building);
    }

    function _researchWithAccrual(address account, uint256 planetId, Technology technology)
        internal
    {
        _accrueToCaps(account, planetId);
        _research(account, planetId, technology);
    }

    function _produceShipWithAccrual(address account, uint256 planetId, Ship ship, uint32 quantity)
        internal
    {
        _accrueToCaps(account, planetId);
        vm.prank(account);
        game.startShipProduction(planetId, ship, quantity);
        VeydriftGame.ShipQueue memory queue = game.shipQueue(planetId);
        vm.warp(queue.readyAt);
        vm.prank(account);
        game.finishShipProduction(planetId);
    }

    function _accrueToCaps(address account, uint256 planetId) internal {
        vm.warp(block.timestamp + 365 days);
        vm.prank(account);
        game.collectResources(planetId);
    }
}
