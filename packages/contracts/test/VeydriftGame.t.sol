// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftDependencies} from "../src/libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "../src/libraries/VeydriftFormulas.sol";
import {Building, Defense, Resource, Ship, Technology} from "../src/libraries/VeydriftTypes.sol";

contract MockResourceToken {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        virtual
        returns (bool)
    {
        uint256 approved = allowance[from][msg.sender];
        if (approved < amount || balanceOf[from] < amount) {
            return false;
        }

        allowance[from][msg.sender] = approved - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ShortTransferResourceToken is MockResourceToken {
    function transferFrom(address from, address to, uint256 amount)
        external
        override
        returns (bool)
    {
        uint256 approved = allowance[from][msg.sender];
        if (approved < amount || balanceOf[from] < amount) {
            return false;
        }

        allowance[from][msg.sender] = approved - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - 1;
        return true;
    }
}

contract VeydriftGameTest is Test {
    uint128 internal constant RESERVE_FUNDING = 1_000_000_000_000;

    address internal admin = address(0xA11CE);
    address internal player = address(0xB0B);
    VeydriftGame internal game;
    MockResourceToken internal metalToken;
    MockResourceToken internal crystalToken;
    MockResourceToken internal deuteriumToken;

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
        metalToken = new MockResourceToken();
        crystalToken = new MockResourceToken();
        deuteriumToken = new MockResourceToken();
        _fundGameReserves(RESERVE_FUNDING);
        vm.deal(player, 1 ether);
    }

    function testInitializationAndOwnerGuard() public {
        assertEq(game.owner(), admin);
        assertEq(game.startPrice(), 0.05 ether);
        assertEq(game.nextPlanetId(), 1);

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftGame.Unauthorized.selector, player));
        game.setStartPrice(0.01 ether);

        vm.prank(admin);
        game.setStartPrice(0.01 ether);
        assertEq(game.startPrice(), 0.01 ether);
    }

    function testResourceTokensAreRequiredBeforeSettlement() public {
        VeydriftGame unfundedGame = new VeydriftGame(admin);
        vm.deal(player, 1 ether);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGame.ResourceTokenUnset.selector, Resource.Metal)
        );
        unfundedGame.startPlanet{value: 0.05 ether}();
    }

    function testFirstPlanetSettlementUsesBackedResourceReserves() public {
        vm.roll(12_345);
        vm.warp(1_800_000_000);
        vm.prevrandao(keccak256("first settlement entropy"));

        VeydriftGame.FirstPlanet memory preview = game.previewFirstPlanet(player);

        vm.expectEmit(true, true, false, false, address(game));
        emit FirstPlanetSettled(player, 1, 0, 0, 0, bytes32(0), bytes32(0));

        vm.prank(player);
        VeydriftGame.FirstPlanet memory settled = game.settleFirstPlanet{value: 0.05 ether}();

        uint256 planetId = game.homePlanetOf(player);
        VeydriftGame.Planet memory planet = game.planet(planetId);
        VeydriftGame.Resources memory required = game.resourceReserveRequirement();
        VeydriftGame.Resources memory available = game.resourceReserveAvailable();

        assertEq(planetId, 1);
        assertEq(planet.owner, player);
        assertEq(planet.galaxy, preview.galaxy);
        assertEq(planet.system, preview.system);
        assertEq(planet.position, preview.position);
        assertEq(planet.resources.metal, 500);
        assertEq(planet.resources.crystal, 500);
        assertEq(planet.resources.deuterium, 0);
        assertEq(settled.galaxy, planet.galaxy);
        assertEq(settled.system, planet.system);
        assertEq(settled.position, planet.position);
        assertEq(required.metal, 500);
        assertEq(required.crystal, 500);
        assertEq(required.deuterium, 0);
        assertEq(available.metal, RESERVE_FUNDING - 500);
        assertEq(available.crystal, RESERVE_FUNDING - 500);
        assertEq(available.deuterium, RESERVE_FUNDING);
        assertFalse(game.isCoordinateAvailable(planet.galaxy, planet.system, planet.position));
    }

    function testDuplicateSettlementAndBadPaymentAreRejected() public {
        vm.prank(player);
        vm.expectRevert(VeydriftGame.BadStartPayment.selector);
        game.startPlanet{value: 0.049 ether}();

        vm.prank(player);
        game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        vm.expectRevert(VeydriftGame.AlreadyStarted.selector);
        game.startPlanet{value: 0.05 ether}();
    }

    function testConfiguredResourceTokenAddressesAreReadable() public view {
        assertEq(game.resourceToken(Resource.Metal), address(metalToken));
        assertEq(game.resourceToken(Resource.Crystal), address(crystalToken));
        assertEq(game.resourceToken(Resource.Deuterium), address(deuteriumToken));
    }

    function testReserveDepositsRequireDeliveredTokenBalance() public {
        ShortTransferResourceToken shortToken = new ShortTransferResourceToken();
        shortToken.mint(admin, 100);

        vm.prank(admin);
        game.setResourceToken(Resource.Metal, address(shortToken));

        vm.prank(admin);
        shortToken.approve(address(game), 100);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGame.ResourceTransferFailed.selector,
                Resource.Metal,
                address(shortToken),
                100
            )
        );
        game.depositResourceReserves(VeydriftGame.Resources({metal: 100, crystal: 0, deuterium: 0}));
    }

    function testReadAbiReturnsEmptyMvpState() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        assertEq(game.buildingLevel(planetId, Building.MetalMine), 0);
        assertEq(game.shipCount(planetId, Ship.SmallCargo), 0);
        assertEq(game.maxPlanets(player), 1);
        assertEq(game.transportCargoCapacity(1, 1, 1), 32_500);

        (uint256 metalPerHour, uint256 crystalPerHour, uint256 deuteriumPerHour) =
            game.productionPerHour(planetId);
        assertEq(metalPerHour, 0);
        assertEq(crystalPerHour, 0);
        assertEq(deuteriumPerHour, 0);

        (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap) = game.storageCaps(planetId);
        assertEq(metalCap, 10_000);
        assertEq(crystalCap, 10_000);
        assertEq(deuteriumCap, 10_000);
    }

    function testBuildingConstructionAndCompletion() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.MetalMine);

        VeydriftGame.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        assertTrue(construction.active);
        assertEq(uint8(construction.building), uint8(Building.MetalMine));
        assertEq(construction.targetLevel, 1);
        assertEq(construction.cost.metal, 60);
        assertEq(construction.cost.crystal, 15);
        assertEq(construction.cost.deuterium, 0);
        assertEq(construction.readyAt, block.timestamp + 108);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGame.ConstructionNotReady.selector, construction.readyAt)
        );
        game.finishBuildingUpgrade(planetId);

        vm.warp(construction.readyAt);
        vm.prank(player);
        game.finishBuildingUpgrade(planetId);

        assertEq(game.buildingLevel(planetId, Building.MetalMine), 1);
        assertFalse(game.activeBuildingConstruction(planetId).active);
        VeydriftGame.Resources memory nextCost =
            game.buildingUpgradeCost(planetId, Building.MetalMine);
        assertEq(nextCost.metal, 90);
        assertEq(nextCost.crystal, 22);
        assertEq(nextCost.deuterium, 0);
    }

    function testOGameBuildingEconomyFormulas() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        _build(player, planetId, Building.MetalMine);
        _build(player, planetId, Building.SolarPlant);

        VeydriftGame.Resources memory metalMineLevelTwo =
            game.buildingUpgradeCost(planetId, Building.MetalMine);
        VeydriftGame.Resources memory crystalMineLevelOne =
            game.buildingUpgradeCost(planetId, Building.CrystalMine);
        VeydriftGame.Resources memory fusionLevelOne =
            game.buildingUpgradeCost(planetId, Building.FusionReactor);
        VeydriftGame.Resources memory roboticsLevelOne =
            game.buildingUpgradeCost(planetId, Building.RoboticsFactory);
        (uint256 metalPerHour,,) = game.productionPerHour(planetId);
        (uint256 producedEnergy, uint256 requiredEnergy, uint256 scaleBps) =
            game.energyBalance(planetId);
        (uint128 metalCap,,) = game.storageCaps(planetId);

        assertEq(metalMineLevelTwo.metal, 90);
        assertEq(metalMineLevelTwo.crystal, 22);
        assertEq(crystalMineLevelOne.metal, 48);
        assertEq(crystalMineLevelOne.crystal, 24);
        assertEq(fusionLevelOne.metal, 900);
        assertEq(fusionLevelOne.crystal, 360);
        assertEq(fusionLevelOne.deuterium, 180);
        assertEq(roboticsLevelOne.metal, 400);
        assertEq(roboticsLevelOne.crystal, 120);
        assertEq(roboticsLevelOne.deuterium, 200);
        assertEq(metalPerHour, 33);
        assertEq(producedEnergy, 22);
        assertEq(requiredEnergy, 11);
        assertEq(scaleBps, 10_000);
        assertEq(metalCap, 10_000);

        (uint128 levelThreeStorage,,) = VeydriftFormulas.storageCaps(3, 0, 0);
        assertEq(levelThreeStorage, 75_000);
        assertEq(VeydriftFormulas.buildingDuration(2, 1, 10_000, 5_000, 60), 3_600);
    }

    function testBuildingUpgradeSpendsInternalResources() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.MetalMine);

        VeydriftGame.Resources memory resources = game.previewResources(planetId);
        VeydriftGame.Resources memory required = game.resourceReserveRequirement();
        assertEq(resources.metal, 440);
        assertEq(resources.crystal, 485);
        assertEq(resources.deuterium, 0);
        assertEq(required.metal, 440);
        assertEq(required.crystal, 485);
        assertEq(required.deuterium, 0);
    }

    function testBuildingUpgradeRejectsActiveQueueAndBadDependencies() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        bytes32 roboticsDependency = "ROBOTICS_FACTORY_2";
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGame.MissingDependency.selector, roboticsDependency)
        );
        game.startBuildingUpgrade(planetId, Building.Shipyard);

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.MetalMine);

        vm.prank(player);
        vm.expectRevert(VeydriftGame.ConstructionActive.selector);
        game.startBuildingUpgrade(planetId, Building.CrystalMine);
    }

    function testBuildingUpgradeRejectsInsufficientResources() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGame.InsufficientResources.selector, 500, 500, 0)
        );
        game.startBuildingUpgrade(planetId, Building.MetalStorage);
    }

    function testRiftStabilizerDependencyCatalogMatchesCurrentBuildGate() public {
        bytes32 roboticsDependency = "ROBOTICS_FACTORY_2";
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftDependencies.MissingDependency.selector, roboticsDependency
            )
        );
        VeydriftDependencies.requireBuilding(Building.InterdimensionalRiftStabilizer, 1, 1, 2, 0);

        bytes32 researchLabDependency = "RESEARCH_LAB_1";
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftDependencies.MissingDependency.selector, researchLabDependency
            )
        );
        VeydriftDependencies.requireBuilding(Building.InterdimensionalRiftStabilizer, 2, 0, 2, 0);

        bytes32 energyDependency = "ENERGY_2";
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftDependencies.MissingDependency.selector, energyDependency
            )
        );
        VeydriftDependencies.requireBuilding(Building.InterdimensionalRiftStabilizer, 2, 1, 1, 0);

        VeydriftDependencies.requireBuilding(Building.InterdimensionalRiftStabilizer, 2, 1, 2, 0);
    }

    function testCollectResourcesAccruesProductionAfterInfrastructureUpgrade() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        _build(player, planetId, Building.MetalMine);
        _build(player, planetId, Building.SolarPlant);

        VeydriftGame.Resources memory beforeResources = game.previewResources(planetId);
        vm.warp(block.timestamp + 1 hours);

        vm.prank(player);
        game.collectResources(planetId);

        VeydriftGame.Resources memory afterResources = game.previewResources(planetId);
        VeydriftGame.Resources memory required = game.resourceReserveRequirement();
        assertGt(afterResources.metal, beforeResources.metal);
        assertEq(afterResources.crystal, beforeResources.crystal);
        assertEq(afterResources.deuterium, beforeResources.deuterium);
        assertEq(required.metal, afterResources.metal);
        assertEq(required.crystal, afterResources.crystal);
        assertEq(required.deuterium, afterResources.deuterium);
    }

    function testSettlementCannotIssueMoreResourcesThanReserveBacking() public {
        VeydriftGame limitedGame = new VeydriftGame(admin);
        MockResourceToken limitedMetalToken = new MockResourceToken();
        MockResourceToken limitedCrystalToken = new MockResourceToken();
        MockResourceToken limitedDeuteriumToken = new MockResourceToken();
        _fundGameReserves(
            limitedGame, limitedMetalToken, limitedCrystalToken, limitedDeuteriumToken, 500
        );

        vm.prank(player);
        uint256 planetId = limitedGame.startPlanet{value: 0.05 ether}();

        _build(limitedGame, player, planetId, Building.MetalMine);
        _build(limitedGame, player, planetId, Building.SolarPlant);
        vm.warp(block.timestamp + 1_000 hours);

        vm.prank(player);
        limitedGame.collectResources(planetId);

        VeydriftGame.Planet memory planet = limitedGame.planet(planetId);
        VeydriftGame.Resources memory required = limitedGame.resourceReserveRequirement();
        VeydriftGame.Resources memory available = limitedGame.resourceReserveAvailable();

        assertEq(planet.resources.metal, 500);
        assertEq(required.metal, 500);
        assertEq(available.metal, 0);
        assertEq(limitedMetalToken.balanceOf(address(limitedGame)), 500);
    }

    function testCollectResourcesCompletesReadyBuildingQueue() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.MetalMine);
        VeydriftGame.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);

        vm.warp(construction.readyAt);
        vm.prank(player);
        game.collectResources(planetId);

        assertEq(game.buildingLevel(planetId, Building.MetalMine), 1);
        assertFalse(game.activeBuildingConstruction(planetId).active);
    }

    function testAdvancedGameplayModulesFailExplicitly() public {
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.depositMarketResource(1, Resource.Metal, 1);
    }

    function testAuditScopedQueueAndBridgeEntrypointsRemainDisabled() public {
        VeydriftGame.Resources memory cargo =
            VeydriftGame.Resources({metal: 0, crystal: 0, deuterium: 0});

        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.startDefenseProduction(1, Defense.RocketLauncher, 1);
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.finishDefenseProduction(1);
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.startShipProduction(1, Ship.SmallCargo, 1);
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.finishShipProduction(1);
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.startResearch(1, Technology.Energy);
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.finishResearch();
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.createColonyAtNextSlot(1, 1);
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.createColony(1, 1, 1, 1);
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.dispatchTransport(1, 2, 1, 0, 0, cargo);
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.recallFleet(1);
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.settleFleetArrival(1);
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.requestMarketResourceWithdrawal(1, Resource.Metal, 1);
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.finishMarketResourceWithdrawal(Resource.Metal);
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.transportTravelSeconds(1, 2);
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.nextColonyCoordinates(player, 1);
    }

    function _build(address account, uint256 planetId, Building building) internal {
        _build(game, account, planetId, building);
    }

    function _build(VeydriftGame targetGame, address account, uint256 planetId, Building building)
        internal
    {
        vm.prank(account);
        targetGame.startBuildingUpgrade(planetId, building);
        VeydriftGame.BuildingConstruction memory construction =
            targetGame.activeBuildingConstruction(planetId);
        vm.warp(construction.readyAt);
        vm.prank(account);
        targetGame.finishBuildingUpgrade(planetId);
    }

    function _fundGameReserves(uint256 amount) internal {
        _fundGameReserves(game, metalToken, crystalToken, deuteriumToken, amount);
    }

    function _fundGameReserves(
        VeydriftGame targetGame,
        MockResourceToken targetMetalToken,
        MockResourceToken targetCrystalToken,
        MockResourceToken targetDeuteriumToken,
        uint256 amount
    ) internal {
        targetMetalToken.mint(address(targetGame), amount);
        targetCrystalToken.mint(address(targetGame), amount);
        targetDeuteriumToken.mint(address(targetGame), amount);
        vm.prank(admin);
        targetGame.setResourceTokens(
            address(targetMetalToken), address(targetCrystalToken), address(targetDeuteriumToken)
        );
    }
}
