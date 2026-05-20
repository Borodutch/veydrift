// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftFormulas} from "../src/libraries/VeydriftFormulas.sol";
import {Building, Defense, Resource, Ship, Technology} from "../src/libraries/VeydriftTypes.sol";

contract MockResourceToken {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    address public reentryTarget;
    bytes public reentryData;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function burn(address from, uint256 amount) external {
        balanceOf[from] -= amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (!_move(msg.sender, to, amount)) {
            return false;
        }
        _tryReenter();
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved < amount) {
            return false;
        }
        allowance[from][msg.sender] = approved - amount;
        if (!_move(from, to, amount)) {
            return false;
        }
        _tryReenter();
        return true;
    }

    function setReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
    }

    function _move(address from, address to, uint256 amount) private returns (bool) {
        if (balanceOf[from] < amount) {
            return false;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function _tryReenter() private {
        if (reentryTarget != address(0)) {
            (bool ok,) = reentryTarget.call(reentryData);
            ok;
        }
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
        _configureFundedReserves(game, RESERVE_FUNDING);
        vm.deal(player, 1 ether);
        vm.startPrank(admin);
        game.setResourceToken(Resource.Metal, address(metalToken));
        game.setResourceToken(Resource.Crystal, address(crystalToken));
        game.setResourceToken(Resource.Deuterium, address(deuteriumToken));
        vm.stopPrank();
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
        _assertOGameSlotTemperature(planet.position, planet.temperature);
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
        _assertOGameSlotTemperature(preview.position, preview.temperature);
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
        _assertOGameSlotTemperature(planet.position, planet.temperature);
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

    function testCollectCreditsInternalBalanceWithoutWalletTokens() public {
        uint256 planetId = _startPlanet(player);
        _build(player, planetId, Building.MetalMine);
        _build(player, planetId, Building.SolarPlant);

        VeydriftGame.Resources memory beforeResources = game.planet(planetId).resources;

        vm.warp(block.timestamp + 2 hours);
        vm.prank(player);
        game.collectResources(planetId);

        VeydriftGame.Resources memory afterResources = game.planet(planetId).resources;
        VeydriftGame.Resources memory internalClaims = game.totalInternalResources();
        assertGt(afterResources.metal, beforeResources.metal);
        assertEq(internalClaims.metal, afterResources.metal);
        assertEq(internalClaims.crystal, afterResources.crystal);
        assertEq(internalClaims.deuterium, afterResources.deuterium);
        assertEq(metalToken.balanceOf(player), 0);
        assertEq(crystalToken.balanceOf(player), 0);
        assertEq(deuteriumToken.balanceOf(player), 0);
    }

    function testSpendingCollectedResourcesConsumesInternalClaimsButLeavesReserveHeld() public {
        uint256 planetId = _startPlanet(player);
        _build(player, planetId, Building.MetalMine);
        _build(player, planetId, Building.SolarPlant);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(player);
        game.collectResources(planetId);

        VeydriftGame.Resources memory cost =
            game.buildingUpgradeCost(planetId, Building.CrystalMine);
        VeydriftGame.Resources memory claimsBefore = game.totalInternalResources();
        uint256 reserveBefore = metalToken.balanceOf(address(game));

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.CrystalMine);

        VeydriftGame.Resources memory claimsAfter = game.totalInternalResources();
        assertEq(claimsAfter.metal, claimsBefore.metal - cost.metal);
        assertEq(claimsAfter.crystal, claimsBefore.crystal - cost.crystal);
        assertEq(claimsAfter.deuterium, claimsBefore.deuterium - cost.deuterium);
        assertEq(metalToken.balanceOf(address(game)), reserveBefore);
    }

    function testCollectRevertsWhenResourceReserveCannotBackProducedBalance() public {
        uint256 planetId = _startPlanet(player);
        _build(player, planetId, Building.MetalMine);
        _build(player, planetId, Building.SolarPlant);

        VeydriftGame.Resources memory claims = game.totalInternalResources();
        metalToken.burn(address(game), metalToken.balanceOf(address(game)) - claims.metal);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(player);
        vm.expectRevert();
        game.collectResources(planetId);

        VeydriftGame.Resources memory preview = game.previewResources(planetId);
        VeydriftGame.Resources memory settled = game.planet(planetId).resources;
        assertEq(preview.metal, settled.metal);
    }

    function testConfiguredReserveIsRequiredForStartingBalances() public {
        VeydriftGame unfundedGame = new VeydriftGame(admin);
        vm.prank(admin);
        unfundedGame.setResourceTokens(
            address(metalToken), address(crystalToken), address(deuteriumToken)
        );

        address nextPlayer = address(0xC0FFEE);
        vm.deal(nextPlayer, 1 ether);
        vm.prank(nextPlayer);
        vm.expectRevert();
        unfundedGame.startPlanet{value: 0.05 ether}();
    }

    function testResourceTokensMustBeConfiguredBeforeCreditingBalances() public {
        VeydriftGame unconfiguredGame = new VeydriftGame(admin);

        address nextPlayer = address(0xBADCAFE);
        vm.deal(nextPlayer, 1 ether);
        vm.prank(nextPlayer);
        vm.expectRevert();
        unconfiguredGame.startPlanet{value: 0.05 ether}();
    }

    function testNoNormalWithdrawalFunctionTransfersCollectedResources() public {
        uint256 planetId = _startPlanet(player);
        _build(player, planetId, Building.MetalMine);
        _build(player, planetId, Building.SolarPlant);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(player);
        game.collectResources(planetId);

        vm.prank(player);
        (bool ok,) =
            address(game).call(abi.encodeWithSignature("withdrawResources(uint256)", planetId));
        assertFalse(ok);
        assertEq(metalToken.balanceOf(player), 0);
        assertEq(crystalToken.balanceOf(player), 0);
        assertEq(deuteriumToken.balanceOf(player), 0);
    }

    function testMineProductionRequiresOnChainEnergy() public {
        uint256 planetId = _startPlanet(player);
        _build(player, planetId, Building.MetalMine);

        (uint256 producedEnergy, uint256 requiredEnergy, uint256 energyScaleBps) =
            game.energyBalance(planetId);
        assertEq(producedEnergy, 0);
        assertEq(requiredEnergy, 10);
        assertEq(energyScaleBps, 0);

        (uint256 metalPerHour, uint256 crystalPerHour, uint256 deuteriumPerHour) =
            game.productionPerHour(planetId);
        assertEq(metalPerHour, 0);
        assertEq(crystalPerHour, 0);
        assertEq(deuteriumPerHour, 0);

        VeydriftGame.Resources memory beforeResources = game.previewResources(planetId);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(player);
        game.collectResources(planetId);

        VeydriftGame.Resources memory afterResources = game.previewResources(planetId);
        assertEq(afterResources.metal, beforeResources.metal);
        assertEq(afterResources.crystal, beforeResources.crystal);
        assertEq(afterResources.deuterium, beforeResources.deuterium);
    }

    function testOGameEnergyShortageScaleUsesProducedOverRequired() public view {
        uint16 bps = game.BPS();

        (uint256 producedEnergy, uint256 requiredEnergy, uint256 energyScaleBps) =
            VeydriftFormulas.energyBalance(0, 0, 5, 2, bps);
        assertEq(producedEnergy, 60);
        assertEq(requiredEnergy, 100);
        assertEq(energyScaleBps, 6_000);

        (producedEnergy, requiredEnergy, energyScaleBps) =
            VeydriftFormulas.energyBalance(0, 0, 5, 0, bps);
        assertEq(producedEnergy, 0);
        assertEq(requiredEnergy, 100);
        assertEq(energyScaleBps, 0);

        (producedEnergy, requiredEnergy, energyScaleBps) =
            VeydriftFormulas.energyBalance(0, 0, 5, 4, bps);
        assertEq(producedEnergy, 120);
        assertEq(requiredEnergy, 100);
        assertEq(energyScaleBps, bps);
    }

    function testBuildingCompletionSplitsProductionAtReadyAt() public {
        uint256 planetId = _startPlanet(player);
        _build(player, planetId, Building.MetalMine);

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.SolarPlant);
        VeydriftGame.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        VeydriftGame.Resources memory resourcesAfterSolarSpend = game.planet(planetId).resources;

        vm.warp(construction.readyAt + 1 hours);
        vm.prank(player);
        game.finishBuildingUpgrade(planetId);

        (uint256 metalPerHour,,) = game.productionPerHour(planetId);
        VeydriftGame.Resources memory resourcesAfterSolarCompletion =
        game.planet(planetId).resources;
        assertEq(game.buildingLevel(planetId, Building.SolarPlant), 1);
        assertEq(resourcesAfterSolarCompletion.metal, resourcesAfterSolarSpend.metal + metalPerHour);
        assertEq(resourcesAfterSolarCompletion.crystal, resourcesAfterSolarSpend.crystal);
        assertEq(resourcesAfterSolarCompletion.deuterium, resourcesAfterSolarSpend.deuterium);
    }

    function testEnergyImprovementDoesNotRetroactivelyPayShortageTime() public {
        uint256 planetId = _startPlanet(player);
        _build(player, planetId, Building.MetalMine);

        VeydriftGame.Resources memory resourcesAfterMine = game.planet(planetId).resources;
        vm.warp(block.timestamp + 1 hours);

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.SolarPlant);
        VeydriftGame.Resources memory resourcesAfterSolarSpend = game.planet(planetId).resources;
        VeydriftGame.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        assertEq(resourcesAfterSolarSpend.metal, resourcesAfterMine.metal - construction.cost.metal);
        assertEq(
            resourcesAfterSolarSpend.crystal, resourcesAfterMine.crystal - construction.cost.crystal
        );

        vm.warp(construction.readyAt + 1 hours);
        vm.prank(player);
        game.finishBuildingUpgrade(planetId);

        (uint256 metalPerHour,,) = game.productionPerHour(planetId);
        VeydriftGame.Resources memory resourcesAfterSolarCompletion =
        game.planet(planetId).resources;
        assertEq(game.buildingLevel(planetId, Building.SolarPlant), 1);
        assertEq(resourcesAfterSolarCompletion.metal, resourcesAfterSolarSpend.metal + metalPerHour);
        assertEq(resourcesAfterSolarCompletion.crystal, resourcesAfterSolarSpend.crystal);
        assertEq(resourcesAfterSolarCompletion.deuterium, resourcesAfterSolarSpend.deuterium);
    }

    function testMineProductionScalesByOnChainEnergyDeficit() public {
        uint256 planetId = _startPlanet(player);
        _build(player, planetId, Building.MetalMine);
        _build(player, planetId, Building.MetalMine);
        _build(player, planetId, Building.CrystalMine);
        _build(player, planetId, Building.CrystalMine);
        _build(player, planetId, Building.SolarPlant);

        VeydriftGame.Planet memory planet = game.planet(planetId);
        uint256 bps = game.BPS();
        uint256 expectedScaleBps = (30 * bps) / 44;
        uint256 expectedMetalCapacity = (60 * uint256(planet.metalMultiplierBps)) / bps;
        uint256 expectedCrystalCapacity = (46 * uint256(planet.crystalMultiplierBps)) / bps;

        (uint256 producedEnergy, uint256 requiredEnergy, uint256 energyScaleBps) =
            game.energyBalance(planetId);
        assertEq(producedEnergy, 30);
        assertEq(requiredEnergy, 44);
        assertEq(energyScaleBps, expectedScaleBps);

        (uint256 metalPerHour, uint256 crystalPerHour, uint256 deuteriumPerHour) =
            game.productionPerHour(planetId);
        assertEq(metalPerHour, (expectedMetalCapacity * expectedScaleBps) / bps);
        assertEq(crystalPerHour, (expectedCrystalCapacity * expectedScaleBps) / bps);
        assertEq(deuteriumPerHour, 0);
        assertLt(metalPerHour, expectedMetalCapacity);
        assertLt(crystalPerHour, expectedCrystalCapacity);
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
        _assertOGameSlotTemperature(colony.position, colony.temperature);
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

    function testTransportCargoRemainsReserveBackedWhileInFlight() public {
        (uint256 originPlanetId, uint256 colonyPlanetId) = _prepareTransportRoute(player);
        VeydriftGame.Resources memory cargo =
            VeydriftGame.Resources({metal: 700, crystal: 300, deuterium: 0});
        uint128 fuelCost = game.transportFuelCost(originPlanetId, colonyPlanetId, 1, 0, 0);
        VeydriftGame.Resources memory claimsBefore = game.totalInternalResources();

        vm.prank(player);
        uint256 fleetId = game.dispatchTransport(originPlanetId, colonyPlanetId, 1, 0, 0, cargo);

        VeydriftGame.Resources memory claimsInFlight = game.totalInternalResources();
        assertEq(claimsInFlight.metal, claimsBefore.metal);
        assertEq(claimsInFlight.crystal, claimsBefore.crystal);
        assertEq(claimsInFlight.deuterium, claimsBefore.deuterium - fuelCost);

        VeydriftGame.Fleet memory fleet = game.fleet(fleetId);
        vm.warp(fleet.arrivesAt);
        vm.prank(player);
        game.settleFleetArrival(fleetId);

        VeydriftGame.Resources memory claimsAfterArrival = game.totalInternalResources();
        assertEq(claimsAfterArrival.metal, claimsInFlight.metal);
        assertEq(claimsAfterArrival.crystal, claimsInFlight.crystal);
        assertEq(claimsAfterArrival.deuterium, claimsInFlight.deuterium);
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

    function testMarketResourceDepositRequiresConfiguredTokenAndStabilizer() public {
        uint256 planetId = _startPlanet(player);
        metalToken.mint(player, 1_000);
        vm.prank(player);
        metalToken.approve(address(game), 1_000);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGame.RiftStabilizerRequired.selector, planetId)
        );
        game.depositMarketResource(planetId, Resource.Metal, 1_000);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGame.InvalidResource.selector, Resource.Energy)
        );
        game.setResourceToken(Resource.Energy, address(metalToken));
    }

    function testMarketResourceDepositCreditsSpendableUnlockedBalance() public {
        uint256 planetId = _prepareMarketBridgePlanet(player);
        VeydriftGame.Planet memory beforePlanet = game.planet(planetId);
        uint256 reserveBefore = metalToken.balanceOf(address(game));
        metalToken.mint(player, 20_000);

        vm.startPrank(player);
        metalToken.approve(address(game), 20_000);
        game.depositMarketResource(planetId, Resource.Metal, 20_000);
        vm.stopPrank();

        VeydriftGame.Planet memory afterDeposit = game.planet(planetId);
        assertEq(afterDeposit.resources.metal, beforePlanet.resources.metal + 20_000);
        assertEq(metalToken.balanceOf(address(game)), reserveBefore + 20_000);

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.MetalStorage);
        assertTrue(game.activeBuildingConstruction(planetId).active);
    }

    function testMarketResourceWithdrawalLocksBalanceAndFinishesAfterDelay() public {
        uint256 planetId = _prepareMarketBridgePlanet(player);
        uint256 reserveBefore = crystalToken.balanceOf(address(game));
        crystalToken.mint(player, 5_000);

        vm.startPrank(player);
        crystalToken.approve(address(game), 5_000);
        game.depositMarketResource(planetId, Resource.Crystal, 5_000);
        VeydriftGame.Planet memory beforeWithdrawal = game.planet(planetId);
        game.requestMarketResourceWithdrawal(planetId, Resource.Crystal, 5_000);
        vm.stopPrank();

        (
            bool withdrawalActive,
            uint256 withdrawalPlanetId,
            Resource withdrawalResource,
            uint128 withdrawalAmount,
            uint64 withdrawalUnlocksAt
        ) = game.resourceWithdrawals(player, Resource.Crystal);
        assertTrue(withdrawalActive);
        assertEq(withdrawalPlanetId, planetId);
        assertEq(uint8(withdrawalResource), uint8(Resource.Crystal));
        assertEq(withdrawalAmount, 5_000);
        assertEq(withdrawalUnlocksAt, block.timestamp + game.MARKET_WITHDRAWAL_DELAY());

        VeydriftGame.Planet memory afterRequest = game.planet(planetId);
        assertEq(afterRequest.resources.crystal, beforeWithdrawal.resources.crystal - 5_000);
        VeydriftGame.Resources memory locked = game.lockedWithdrawalResources();
        assertEq(locked.crystal, 5_000);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGame.WithdrawalNotReady.selector, withdrawalUnlocksAt)
        );
        game.finishMarketResourceWithdrawal(Resource.Crystal);

        vm.warp(withdrawalUnlocksAt);
        vm.prank(player);
        game.finishMarketResourceWithdrawal(Resource.Crystal);

        assertEq(crystalToken.balanceOf(player), 5_000);
        assertEq(crystalToken.balanceOf(address(game)), reserveBefore);
        VeydriftGame.Resources memory lockedAfterFinish = game.lockedWithdrawalResources();
        assertEq(lockedAfterFinish.crystal, 0);
        (bool finishedActive,,,,) = game.resourceWithdrawals(player, Resource.Crystal);
        assertFalse(finishedActive);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGame.WithdrawalInactive.selector, Resource.Crystal)
        );
        game.finishMarketResourceWithdrawal(Resource.Crystal);
    }

    function testMarketResourceWithdrawalLockedBalanceCannotBeSpent() public {
        uint256 planetId = _prepareMarketBridgePlanet(player);
        VeydriftGame.Planet memory beforeDeposit = game.planet(planetId);
        uint128 depositAmount = 20_000;
        uint128 withdrawalAmount =
            uint128(uint256(beforeDeposit.resources.metal) + depositAmount - 500);
        metalToken.mint(player, depositAmount);

        vm.startPrank(player);
        metalToken.approve(address(game), depositAmount);
        game.depositMarketResource(planetId, Resource.Metal, depositAmount);
        game.requestMarketResourceWithdrawal(planetId, Resource.Metal, withdrawalAmount);
        vm.expectRevert();
        game.startBuildingUpgrade(planetId, Building.MetalStorage);
        vm.stopPrank();

        VeydriftGame.Planet memory afterRequest = game.planet(planetId);
        assertEq(afterRequest.resources.metal, 500);
    }

    function testMarketResourceWithdrawalsTrackMultipleResourcesIndependently() public {
        uint256 planetId = _prepareMarketBridgePlanet(player);
        metalToken.mint(player, 1_000);
        deuteriumToken.mint(player, 700);

        vm.startPrank(player);
        metalToken.approve(address(game), 1_000);
        deuteriumToken.approve(address(game), 700);
        game.depositMarketResource(planetId, Resource.Metal, 1_000);
        game.depositMarketResource(planetId, Resource.Deuterium, 700);
        game.requestMarketResourceWithdrawal(planetId, Resource.Metal, 600);
        game.requestMarketResourceWithdrawal(planetId, Resource.Deuterium, 300);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGame.WithdrawalActive.selector, Resource.Metal)
        );
        game.requestMarketResourceWithdrawal(planetId, Resource.Metal, 1);
        vm.stopPrank();

        (,,, uint128 metalWithdrawalAmount,) = game.resourceWithdrawals(player, Resource.Metal);
        (,,, uint128 deuteriumWithdrawalAmount,) =
            game.resourceWithdrawals(player, Resource.Deuterium);
        assertEq(metalWithdrawalAmount, 600);
        assertEq(deuteriumWithdrawalAmount, 300);
    }

    function testMarketResourceDepositReentrancyDoesNotDoubleCredit() public {
        uint256 planetId = _prepareMarketBridgePlanet(player);
        MockResourceToken maliciousToken = new MockResourceToken();
        maliciousToken.mint(address(game), RESERVE_FUNDING);
        vm.prank(admin);
        game.setResourceToken(Resource.Metal, address(maliciousToken));
        maliciousToken.mint(player, 1_000);
        uint256 reserveBefore = maliciousToken.balanceOf(address(game));
        VeydriftGame.Planet memory beforeDeposit = game.planet(planetId);

        maliciousToken.setReentry(
            address(game),
            abi.encodeWithSelector(
                game.depositMarketResource.selector, planetId, Resource.Metal, uint128(50)
            )
        );

        vm.startPrank(player);
        maliciousToken.approve(address(game), 1_000);
        game.depositMarketResource(planetId, Resource.Metal, 100);
        vm.stopPrank();

        VeydriftGame.Planet memory afterDeposit = game.planet(planetId);
        assertEq(afterDeposit.resources.metal, beforeDeposit.resources.metal + 100);
        assertEq(maliciousToken.balanceOf(address(game)), reserveBefore + 100);
    }

    function _startPlanet(address account) internal returns (uint256 planetId) {
        vm.prank(account);
        planetId = game.startPlanet{value: 0.05 ether}();
    }

    function _configureFundedReserves(VeydriftGame targetGame, uint128 amount) internal {
        metalToken.mint(admin, amount);
        crystalToken.mint(admin, amount);
        deuteriumToken.mint(admin, amount);

        vm.startPrank(admin);
        targetGame.setResourceTokens(
            address(metalToken), address(crystalToken), address(deuteriumToken)
        );
        metalToken.approve(address(targetGame), amount);
        crystalToken.approve(address(targetGame), amount);
        deuteriumToken.approve(address(targetGame), amount);
        targetGame.depositResourceReserves(
            VeydriftGame.Resources({metal: amount, crystal: amount, deuterium: amount})
        );
        vm.stopPrank();
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

    function _prepareMarketBridgePlanet(address account) internal returns (uint256 planetId) {
        planetId = _preparePlanetWithShipyardAndResearch(account);
        _accrueToCaps(account, planetId);
        _buildWithAccrual(account, planetId, Building.ResearchLab);
        _buildWithAccrual(account, planetId, Building.CrystalStorage);
        _buildWithAccrual(account, planetId, Building.CrystalStorage);
        _buildWithAccrual(account, planetId, Building.DeuteriumTank);
        while (game.buildingLevel(planetId, Building.RoboticsFactory) < 4) {
            _buildWithAccrual(account, planetId, Building.RoboticsFactory);
        }
        for (uint256 i = game.technologyLevel(account, Technology.Energy); i < 5; i++) {
            _researchWithAccrual(account, planetId, Technology.Energy);
        }
        _researchWithAccrual(account, planetId, Technology.Hyperspace);
        _buildWithAccrual(account, planetId, Building.InterdimensionalRiftStabilizer);
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

    function _assertOGameSlotTemperature(uint8 position, int16 temperature) internal pure {
        (int16 minMaxTemperature, int16 maxMaxTemperature) = _slotMaxTemperatureBounds(position);
        int16 displayedMaxTemperature = temperature + 20;
        int16 displayedMinTemperature = temperature - 20;

        assertGe(displayedMaxTemperature, minMaxTemperature);
        assertLe(displayedMaxTemperature, maxMaxTemperature);
        assertEq(displayedMinTemperature, displayedMaxTemperature - 40);
    }

    function _slotMaxTemperatureBounds(uint8 position)
        internal
        pure
        returns (int16 minMaxTemperature, int16 maxMaxTemperature)
    {
        if (position == 1) return (220, 260);
        if (position == 2) return (170, 210);
        if (position == 3) return (120, 160);
        if (position == 4) return (70, 110);
        if (position == 5) return (60, 100);
        if (position == 6) return (50, 90);
        if (position == 7) return (40, 80);
        if (position == 8) return (30, 70);
        if (position == 9) return (20, 60);
        if (position == 10) return (10, 50);
        if (position == 11) return (0, 40);
        if (position == 12) return (-10, 30);
        if (position == 13) return (-50, -10);
        if (position == 14) return (-90, -50);
        if (position == 15) return (-130, -90);
        revert("invalid position");
    }
}
