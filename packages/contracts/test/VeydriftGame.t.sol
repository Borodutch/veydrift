// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {Building, Defense, Ship, Technology} from "../src/libraries/VeydriftTypes.sol";

contract VeydriftGameTest is Test {
    address internal admin = address(0xA11CE);
    address internal player = address(0xB0B);
    VeydriftGame internal game;

    event FirstPlanetSettled(
        address indexed player,
        uint256 indexed planetId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        bytes32 coordinateKey,
        bytes32 planetSeed
    );

    function setUp() public {
        game = new VeydriftGame(admin);
        vm.deal(player, 1 ether);
    }

    function testInitializationAndOwnerGuard() public {
        assertEq(game.owner(), admin);
        assertEq(game.startPrice(), 0.05 ether);

        vm.prank(player);
        vm.expectRevert();
        game.setStartPrice(0.01 ether);

        vm.prank(admin);
        game.setStartPrice(0.01 ether);
        assertEq(game.startPrice(), 0.01 ether);
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
        assertEq(planet.resources.metal, 500);
        assertEq(planet.resources.crystal, 500);
        assertEq(planet.resources.deuterium, 0);

        vm.prank(player);
        vm.expectRevert(VeydriftGame.AlreadyStarted.selector);
        game.startPlanet{value: 0.05 ether}();
    }

    function testFirstPlanetSettlementEmitsCanonicalCoordinateAndSeed() public {
        vm.roll(12_345);
        vm.warp(1_800_000_000);
        vm.prevrandao(keccak256("first settlement entropy"));

        vm.expectEmit(true, true, false, false, address(game));
        emit FirstPlanetSettled(player, 1, 0, 0, 0, bytes32(0), bytes32(0));

        uint256 planetId = _startPlanet(player);
        VeydriftGame.Planet memory planet = game.planet(planetId);

        assertEq(game.homePlanetOf(player), planetId);
        assertEq(
            game.planetSeed(planet.galaxy, planet.system, planet.position), _planetSeed(planet)
        );
        assertFalse(game.isCoordinateAvailable(planet.galaxy, planet.system, planet.position));
    }

    function testCompactFirstPlanetViewsAndSettlementEntrypoint() public {
        assertFalse(game.hasFirstPlanet(player));

        vm.expectRevert(abi.encodeWithSelector(VeydriftGame.NoFirstPlanet.selector, player));
        game.firstPlanetOf(player);

        VeydriftGame.FirstPlanet memory preview = game.previewFirstPlanet(player);
        assertGe(preview.galaxy, 1);
        assertLe(preview.galaxy, 9);
        assertGe(preview.system, 1);
        assertLe(preview.system, 499);
        assertGe(preview.position, 1);
        assertLe(preview.position, 15);
        assertGe(preview.fields, 160);
        assertLe(preview.fields, 239);
        assertEq(preview.settledAt, 0);
        assertEq(preview.settledBlock, 0);

        vm.prank(player);
        VeydriftGame.FirstPlanet memory settled = game.settleFirstPlanet{value: 0.05 ether}();

        assertTrue(game.hasFirstPlanet(player));
        uint256 planetId = game.homePlanetOf(player);
        VeydriftGame.Planet memory planet = game.planet(planetId);
        assertEq(settled.galaxy, planet.galaxy);
        assertEq(settled.system, planet.system);
        assertEq(settled.position, planet.position);
        assertEq(settled.fields, planet.fields);
        assertEq(settled.temperature, planet.temperature);
        assertEq(settled.settledAt, planet.lastSettledAt);
        assertEq(settled.settledBlock, 0);

        VeydriftGame.FirstPlanet memory firstPlanet = game.firstPlanetOf(player);
        assertEq(firstPlanet.galaxy, planet.galaxy);
        assertEq(firstPlanet.system, planet.system);
        assertEq(firstPlanet.position, planet.position);

        VeydriftGame.FirstPlanet memory settledPreview = game.previewFirstPlanet(player);
        assertEq(settledPreview.galaxy, planet.galaxy);
        assertEq(settledPreview.system, planet.system);
        assertEq(settledPreview.position, planet.position);
    }

    function testCompactFirstPlanetSettlementAllowsZeroPriceWhenConfigured() public {
        vm.prank(admin);
        game.setStartPrice(0);

        vm.prank(player);
        VeydriftGame.FirstPlanet memory settled = game.settleFirstPlanet();

        assertTrue(game.hasFirstPlanet(player));
        VeydriftGame.Planet memory planet = game.planet(game.homePlanetOf(player));
        assertEq(settled.galaxy, planet.galaxy);
        assertEq(settled.system, planet.system);
        assertEq(settled.position, planet.position);
    }

    function testFirstPlanetWeakEntropyChangesSettlementMoment() public {
        vm.roll(20_000);
        vm.warp(1_800_000_000);
        vm.prevrandao(keccak256("entropy A"));
        uint256 firstPlanetId = _startPlanet(player);
        VeydriftGame.Planet memory firstPlanet = game.planet(firstPlanetId);

        address secondPlayer = address(0xD00D);
        vm.deal(secondPlayer, 1 ether);
        vm.roll(20_001);
        vm.warp(1_800_000_030);
        vm.prevrandao(keccak256("entropy B"));
        uint256 secondPlanetId = _startPlanet(secondPlayer);
        VeydriftGame.Planet memory secondPlanet = game.planet(secondPlanetId);

        assertFalse(
            firstPlanet.galaxy == secondPlanet.galaxy && firstPlanet.system == secondPlanet.system
                && firstPlanet.position == secondPlanet.position
        );
    }

    function testPlanetSeedRejectsInvalidCoordinates() public {
        vm.expectRevert(VeydriftGame.InvalidCoordinates.selector);
        game.planetSeed(0, 1, 1);
    }

    function testLevelZeroMinesDoNotProduceHiddenResources() public {
        uint256 planetId = _startPlanet(player);
        VeydriftGame.Resources memory beforeResources = game.previewResources(planetId);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(player);
        game.collectResources(planetId);

        VeydriftGame.Resources memory afterResources = game.previewResources(planetId);
        assertEq(afterResources.metal, beforeResources.metal);
        assertEq(afterResources.crystal, beforeResources.crystal);
        assertEq(afterResources.deuterium, beforeResources.deuterium);
    }

    function testResourceAccrualOverElapsedTime() public {
        uint256 planetId = _startPlanet(player);

        _build(player, planetId, Building.MetalMine);
        _build(player, planetId, Building.SolarPlant);

        VeydriftGame.Resources memory beforeResources = game.previewResources(planetId);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(player);
        game.collectResources(planetId);

        VeydriftGame.Resources memory afterResources = game.previewResources(planetId);
        assertGt(afterResources.metal, beforeResources.metal);
        assertEq(afterResources.crystal, beforeResources.crystal);
        assertEq(afterResources.deuterium, beforeResources.deuterium);
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

    function testCollectionNoopsWhenNothingReady() public {
        uint256 planetId = _startPlanet(player);
        VeydriftGame.Resources memory beforeResources = game.previewResources(planetId);

        vm.prank(player);
        game.collectResources(planetId);

        VeydriftGame.Resources memory afterResources = game.previewResources(planetId);
        assertEq(afterResources.metal, beforeResources.metal);
        assertEq(afterResources.crystal, beforeResources.crystal);
        assertEq(afterResources.deuterium, beforeResources.deuterium);
        assertFalse(game.activeBuildingConstruction(planetId).active);
        assertFalse(game.shipQueue(planetId).active);
        assertFalse(game.researchQueue(player).active);
    }

    function testCollectShipsClaimsReadyShipProductionIdempotently() public {
        uint256 planetId = _preparePlanetWithShipyardAndResearch(player);
        _research(player, planetId, Technology.CombustionDrive);

        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 1);
        VeydriftGame.ShipQueue memory queue = game.shipQueue(planetId);

        vm.warp(queue.readyAt);
        vm.prank(player);
        game.collectShips(planetId);

        assertEq(game.shipCount(planetId, Ship.SmallCargo), 1);
        assertFalse(game.shipQueue(planetId).active);

        vm.prank(player);
        game.collectShips(planetId);

        assertEq(game.shipCount(planetId, Ship.SmallCargo), 1);
        assertFalse(game.shipQueue(planetId).active);
    }

    function testCollectResourcesAppliesOnlyReadyQueues() public {
        uint256 planetId = _preparePlanetWithShipyardAndResearch(player);
        _research(player, planetId, Technology.CombustionDrive);

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.MetalMine);
        VeydriftGame.BuildingConstruction memory buildingQueue =
            game.activeBuildingConstruction(planetId);

        vm.prank(player);
        game.startResearch(planetId, Technology.Energy);

        vm.warp(block.timestamp + 30);
        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 1);
        VeydriftGame.ShipQueue memory shipQueue = game.shipQueue(planetId);

        vm.warp(buildingQueue.readyAt);
        vm.prank(player);
        game.collectResources(planetId);

        assertEq(game.buildingLevel(planetId, Building.MetalMine), 2);
        assertEq(game.technologyLevel(player, Technology.Energy), 1);
        assertFalse(game.activeBuildingConstruction(planetId).active);
        assertFalse(game.researchQueue(player).active);
        assertTrue(game.shipQueue(planetId).active);
        assertEq(game.shipCount(planetId, Ship.SmallCargo), 0);

        vm.warp(shipQueue.readyAt);
        vm.prank(player);
        game.collectResources(planetId);

        assertEq(game.shipCount(planetId, Ship.SmallCargo), 1);

        vm.prank(player);
        game.collectResources(planetId);

        assertEq(game.buildingLevel(planetId, Building.MetalMine), 2);
        assertEq(game.technologyLevel(player, Technology.Energy), 1);
        assertEq(game.shipCount(planetId, Ship.SmallCargo), 1);
    }

    function testDependencyResourceAndAccessFailures() public {
        uint256 planetId = _startPlanet(player);

        vm.prank(player);
        vm.expectRevert();
        game.startBuildingUpgrade(planetId, Building.Shipyard);

        vm.prank(address(0xCAFE));
        vm.expectRevert(VeydriftGame.NotPlanetOwner.selector);
        game.collectResources(planetId);

        _prepareStarterEconomy(player, planetId);
        _buildWithAccrual(player, planetId, Building.RoboticsFactory);
        _buildWithAccrual(player, planetId, Building.RoboticsFactory);
        _buildWithAccrual(player, planetId, Building.Shipyard);

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
        _prepareStarterEconomy(account, planetId);
        _buildWithAccrual(account, planetId, Building.RoboticsFactory);
        _buildWithAccrual(account, planetId, Building.RoboticsFactory);
        _buildWithAccrual(account, planetId, Building.Shipyard);
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

    function _prepareStarterEconomy(address account, uint256 planetId) internal {
        _build(account, planetId, Building.MetalMine);
        _build(account, planetId, Building.CrystalMine);
        _build(account, planetId, Building.SolarPlant);
        _accrueToCaps(account, planetId);
        _buildWithAccrual(account, planetId, Building.DeuteriumSynthesizer);
        _buildWithAccrual(account, planetId, Building.SolarPlant);
        _accrueToCaps(account, planetId);
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

    function _planetSeed(VeydriftGame.Planet memory planet) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("veydrift.planet.v1"), planet.galaxy, planet.system, planet.position
            )
        );
    }
}
