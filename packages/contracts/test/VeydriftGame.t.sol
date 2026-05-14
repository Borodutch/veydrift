// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";

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

    function testBuildingUpgradeQueueAndCompletion() public {
        uint256 planetId = _startPlanet(player);

        vm.prank(player);
        game.startBuildingUpgrade(planetId, uint8(VeydriftGame.Building.MetalMine));

        VeydriftGame.BuildQueue memory queue = game.buildingQueue(planetId);
        assertTrue(queue.active);
        assertEq(queue.targetLevel, 1);

        vm.prank(player);
        vm.expectRevert();
        game.finishBuildingUpgrade(planetId);

        vm.warp(queue.readyAt);
        vm.prank(player);
        game.finishBuildingUpgrade(planetId);

        assertEq(game.buildingLevel(planetId, uint8(VeydriftGame.Building.MetalMine)), 1);
    }

    function testDefenseProduction() public {
        uint256 planetId = _preparePlanetWithShipyard(player);

        vm.prank(player);
        game.startDefenseProduction(planetId, uint8(VeydriftGame.Defense.RocketLauncher), 3);
        VeydriftGame.UnitQueue memory queue = game.defenseQueue(planetId);

        vm.warp(queue.readyAt);
        vm.prank(player);
        game.finishDefenseProduction(planetId);

        assertEq(game.defenseCount(planetId, uint8(VeydriftGame.Defense.RocketLauncher)), 3);
    }

    function testShipProduction() public {
        uint256 planetId = _preparePlanetWithShipyardAndResearch(player);
        _research(player, planetId, uint8(VeydriftGame.Technology.CombustionDrive));

        vm.prank(player);
        game.startShipProduction(planetId, uint8(VeydriftGame.Ship.SmallCargo), 1);
        VeydriftGame.UnitQueue memory queue = game.shipQueue(planetId);

        vm.warp(queue.readyAt);
        vm.prank(player);
        game.finishShipProduction(planetId);

        assertEq(game.shipCount(planetId, uint8(VeydriftGame.Ship.SmallCargo)), 1);
    }

    function testTechnologyResearch() public {
        uint256 planetId = _preparePlanetWithShipyardAndResearch(player);

        _research(player, planetId, uint8(VeydriftGame.Technology.Energy));

        assertEq(game.technologyLevel(player, uint8(VeydriftGame.Technology.Energy)), 1);
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
        assertFalse(game.buildingQueue(planetId).active);
        assertFalse(game.shipQueue(planetId).active);
        assertFalse(game.researchQueue(player).active);
    }

    function testCollectShipsClaimsReadyShipProductionIdempotently() public {
        uint256 planetId = _preparePlanetWithShipyardAndResearch(player);
        _research(player, planetId, uint8(VeydriftGame.Technology.CombustionDrive));

        vm.prank(player);
        game.startShipProduction(planetId, uint8(VeydriftGame.Ship.SmallCargo), 1);
        VeydriftGame.UnitQueue memory queue = game.shipQueue(planetId);

        vm.warp(queue.readyAt);
        vm.prank(player);
        game.collectShips(planetId);

        assertEq(game.shipCount(planetId, uint8(VeydriftGame.Ship.SmallCargo)), 1);
        assertFalse(game.shipQueue(planetId).active);

        vm.prank(player);
        game.collectShips(planetId);

        assertEq(game.shipCount(planetId, uint8(VeydriftGame.Ship.SmallCargo)), 1);
        assertFalse(game.shipQueue(planetId).active);
    }

    function testCollectResourcesAppliesOnlyReadyQueues() public {
        uint256 planetId = _preparePlanetWithShipyardAndResearch(player);
        _research(player, planetId, uint8(VeydriftGame.Technology.CombustionDrive));

        vm.prank(player);
        game.startBuildingUpgrade(planetId, uint8(VeydriftGame.Building.MetalMine));
        VeydriftGame.BuildQueue memory buildingQueue = game.buildingQueue(planetId);

        vm.prank(player);
        game.startResearch(planetId, uint8(VeydriftGame.Technology.Energy));

        vm.warp(block.timestamp + 30);
        vm.prank(player);
        game.startShipProduction(planetId, uint8(VeydriftGame.Ship.SmallCargo), 1);
        VeydriftGame.UnitQueue memory shipQueue = game.shipQueue(planetId);

        vm.warp(buildingQueue.readyAt);
        vm.prank(player);
        game.collectResources(planetId);

        assertEq(game.buildingLevel(planetId, uint8(VeydriftGame.Building.MetalMine)), 1);
        assertEq(game.technologyLevel(player, uint8(VeydriftGame.Technology.Energy)), 1);
        assertFalse(game.buildingQueue(planetId).active);
        assertFalse(game.researchQueue(player).active);
        assertTrue(game.shipQueue(planetId).active);
        assertEq(game.shipCount(planetId, uint8(VeydriftGame.Ship.SmallCargo)), 0);

        vm.warp(shipQueue.readyAt);
        vm.prank(player);
        game.collectResources(planetId);

        assertEq(game.shipCount(planetId, uint8(VeydriftGame.Ship.SmallCargo)), 1);

        vm.prank(player);
        game.collectResources(planetId);

        assertEq(game.buildingLevel(planetId, uint8(VeydriftGame.Building.MetalMine)), 1);
        assertEq(game.technologyLevel(player, uint8(VeydriftGame.Technology.Energy)), 1);
        assertEq(game.shipCount(planetId, uint8(VeydriftGame.Ship.SmallCargo)), 1);
    }

    function testDependencyResourceAndAccessFailures() public {
        uint256 planetId = _startPlanet(player);

        vm.prank(player);
        vm.expectRevert();
        game.startBuildingUpgrade(planetId, uint8(VeydriftGame.Building.Shipyard));

        vm.prank(address(0xCAFE));
        vm.expectRevert(VeydriftGame.NotPlanetOwner.selector);
        game.collectResources(planetId);

        _build(player, planetId, uint8(VeydriftGame.Building.RoboticsFactory));
        _build(player, planetId, uint8(VeydriftGame.Building.RoboticsFactory));
        _build(player, planetId, uint8(VeydriftGame.Building.Shipyard));

        vm.prank(player);
        vm.expectRevert();
        game.startShipProduction(planetId, uint8(VeydriftGame.Ship.SmallCargo), 1);

        vm.prank(admin);
        game.setStartPrice(0.07 ether);
        address nextPlayer = address(0xD00D);
        vm.deal(nextPlayer, 1 ether);
        vm.prank(nextPlayer);
        vm.expectRevert(VeydriftGame.BadStartPayment.selector);
        game.startPlanet{value: 0.05 ether}();
    }

    function _startPlanet(address account) internal returns (uint256 planetId) {
        vm.prank(account);
        planetId = game.startPlanet{value: 0.05 ether}();
    }

    function _preparePlanetWithShipyard(address account) internal returns (uint256 planetId) {
        planetId = _startPlanet(account);
        _build(account, planetId, uint8(VeydriftGame.Building.RoboticsFactory));
        _build(account, planetId, uint8(VeydriftGame.Building.RoboticsFactory));
        _build(account, planetId, uint8(VeydriftGame.Building.Shipyard));
    }

    function _preparePlanetWithShipyardAndResearch(address account)
        internal
        returns (uint256 planetId)
    {
        planetId = _preparePlanetWithShipyard(account);
        _build(account, planetId, uint8(VeydriftGame.Building.ResearchLab));
    }

    function _build(address account, uint256 planetId, uint8 buildingId) internal {
        vm.prank(account);
        game.startBuildingUpgrade(planetId, buildingId);
        VeydriftGame.BuildQueue memory queue = game.buildingQueue(planetId);
        vm.warp(queue.readyAt);
        vm.prank(account);
        game.finishBuildingUpgrade(planetId);
    }

    function _research(address account, uint256 planetId, uint8 technologyId) internal {
        vm.prank(account);
        game.startResearch(planetId, technologyId);
        VeydriftGame.ResearchQueue memory queue = game.researchQueue(account);
        vm.warp(queue.readyAt);
        vm.prank(account);
        game.finishResearch();
    }
}
