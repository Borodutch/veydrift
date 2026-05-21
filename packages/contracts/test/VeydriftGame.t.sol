// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftCombatModule} from "../src/VeydriftCombatModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
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

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        if (balanceOf[msg.sender] < amount) return false;
        balanceOf[msg.sender] -= amount;
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
    bytes32 internal constant DEP_SHIPYARD_2 = "SHIPYARD_2";
    bytes32 internal constant DEP_WEAPONS_3 = "WEAPONS_3";
    bytes32 internal constant DEP_MISSILE_SILO_4 = "MISSILE_SILO_4";
    bytes32 internal constant MISSILE_SILO_2 = "MISSILE_SILO_2";
    bytes32 internal constant MISSILE_SILO_4 = "MISSILE_SILO_4";
    bytes32 internal constant CRAWLER_TECH_REQUIREMENT = "COMBUSTION_4_ARMOR_4_LASER_4";
    bytes32 internal constant RESEARCH_LAB_12 = "RESEARCH_LAB_12";
    bytes32 internal constant ENERGY_3 = "ENERGY_3";
    bytes32 internal constant COMPUTER_10 = "COMPUTER_10";
    bytes32 internal constant ENERGY_12 = "ENERGY_12";

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
    event AttackBattleResolved(
        uint256 indexed missionId,
        address indexed attacker,
        uint256 indexed targetPlanetId,
        VeydriftGameStorage.BattleOutcome outcome,
        uint8 rounds,
        uint256 randomSeed,
        uint128 lootMetal,
        uint128 lootCrystal,
        uint128 lootDeuterium
    );
    event FleetMissionCargo(
        uint256 indexed missionId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium,
        uint128 fuelCost
    );
    event FleetMissionShips(
        uint256 indexed missionId,
        uint32 smallCargo,
        uint32 lightFighter,
        uint32 recycler,
        uint32 colonyShip,
        uint32 largeCargo,
        uint32 heavyFighter,
        uint32 cruiser,
        uint32 battleship,
        uint32 bomber,
        uint32 destroyer,
        uint32 deathstar,
        uint32 battlecruiser,
        uint32 reaper,
        uint32 pathfinder
    );
    event FleetMissionRecalled(
        uint256 indexed missionId, address indexed owner, uint64 returnAt, uint128 recallCost
    );
    event FleetMissionReturnExposed(
        uint256 indexed missionId,
        address indexed owner,
        VeydriftGameStorage.FleetMissionStatus indexed status,
        uint256 originPlanetId,
        uint256 targetPlanetId,
        uint64 returnAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event InterplanetaryMissileAttack(
        address indexed attacker,
        uint256 indexed originPlanetId,
        uint256 indexed targetPlanetId,
        Defense primaryTarget,
        uint32 launched,
        uint32 intercepted,
        uint32 hits,
        uint32 destroyedPrimary
    );

    function setUp() public {
        game = _newGame(admin);
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
        vm.expectRevert(abi.encodeWithSelector(VeydriftGameStorage.Unauthorized.selector, player));
        game.setStartPrice(0.01 ether);

        vm.prank(admin);
        game.setStartPrice(0.01 ether);
        assertEq(game.startPrice(), 0.01 ether);
    }

    function testResourceTokensAreRequiredBeforeSettlement() public {
        VeydriftGame unfundedGame = _newGame(admin);
        vm.deal(player, 1 ether);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.ResourceTokenUnset.selector, Resource.Metal)
        );
        unfundedGame.startPlanet{value: 0.05 ether}();
    }

    function testFirstPlanetSettlementUsesBackedResourceReserves() public {
        vm.roll(12_345);
        vm.warp(1_800_000_000);
        vm.prevrandao(keccak256("first settlement entropy"));

        VeydriftGameStorage.FirstPlanet memory preview = game.previewFirstPlanet(player);

        vm.expectEmit(true, true, false, false, address(game));
        emit FirstPlanetSettled(player, 1, 0, 0, 0, bytes32(0), bytes32(0));

        vm.prank(player);
        VeydriftGameStorage.FirstPlanet memory settled = game.settleFirstPlanet{value: 0.05 ether}();

        uint256 planetId = game.homePlanetOf(player);
        VeydriftGameStorage.Planet memory planet = game.planet(planetId);
        VeydriftGameStorage.Resources memory required = game.resourceReserveRequirement();
        VeydriftGameStorage.Resources memory available = game.resourceReserveAvailable();

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
        vm.expectRevert(VeydriftGameStorage.BadStartPayment.selector);
        game.startPlanet{value: 0.049 ether}();

        vm.prank(player);
        game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.AlreadyStarted.selector);
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
                VeydriftGameStorage.ResourceTransferFailed.selector,
                Resource.Metal,
                address(shortToken),
                100
            )
        );
        game.depositResourceReserves(
            VeydriftGameStorage.Resources({metal: 100, crystal: 0, deuterium: 0})
        );
    }

    function testReadAbiReturnsEmptyMvpState() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        assertEq(game.buildingLevel(planetId, Building.MetalMine), 0);
        assertEq(game.defenseCost(Defense.RocketLauncher).metal, 2_000);
        assertEq(game.defenseCost(Defense.IonCannon).metal, 2_000);
        assertEq(game.defenseCost(Defense.IonCannon).crystal, 6_000);
        assertEq(game.defenseCount(planetId, Defense.RocketLauncher), 0);
        assertEq(game.shipCount(planetId, Ship.SmallCargo), 0);
        assertEq(game.technologyLevel(player, Technology.Energy), 0);
        assertEq(game.shipCargoCapacity(Ship.Crawler), 0);
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

    function testVanillaResearchCostsScaleByCurrentLevel() public {
        VeydriftGameStorage.Resources memory energy = game.researchCost(player, Technology.Energy);
        assertEq(energy.metal, 0);
        assertEq(energy.crystal, 800);
        assertEq(energy.deuterium, 400);

        _setTechnologyLevel(player, Technology.Energy, 2);
        energy = game.researchCost(player, Technology.Energy);
        assertEq(energy.metal, 0);
        assertEq(energy.crystal, 3_200);
        assertEq(energy.deuterium, 1_600);

        _setTechnologyLevel(player, Technology.HyperspaceDrive, 1);
        VeydriftGameStorage.Resources memory hyperspaceDrive =
            game.researchCost(player, Technology.HyperspaceDrive);
        assertEq(hyperspaceDrive.metal, 20_000);
        assertEq(hyperspaceDrive.crystal, 40_000);
        assertEq(hyperspaceDrive.deuterium, 12_000);

        _setTechnologyLevel(player, Technology.Astrophysics, 2);
        VeydriftGameStorage.Resources memory astrophysics =
            game.researchCost(player, Technology.Astrophysics);
        assertEq(astrophysics.metal, 12_300);
        assertEq(astrophysics.crystal, 24_500);
        assertEq(astrophysics.deuterium, 12_300);

        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 1);
        VeydriftGameStorage.Resources memory irn =
            game.researchCost(player, Technology.IntergalacticResearchNetwork);
        assertEq(irn.metal, 480_000);
        assertEq(irn.crystal, 800_000);
        assertEq(irn.deuterium, 320_000);

        _setTechnologyLevel(player, Technology.Graviton, 2);
        VeydriftGameStorage.Resources memory graviton =
            game.researchCost(player, Technology.Graviton);
        assertEq(graviton.metal, 0);
        assertEq(graviton.crystal, 0);
        assertEq(graviton.deuterium, 0);
    }

    function testResearchPrerequisitesUseVanillaOGameRequirements() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.ResearchLab, 1);

        vm.prank(player);
        bytes32 energyTwoDependency = "ENERGY_2";
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.MissingDependency.selector, energyTwoDependency
            )
        );
        game.startResearch(planetId, Technology.Laser);

        _setTechnologyLevel(player, Technology.Energy, 2);
        vm.prank(player);
        game.startResearch(planetId, Technology.Laser);

        VeydriftGameStorage.ResearchQueue memory queue = game.researchQueue(player);
        assertTrue(queue.active);
        assertEq(uint8(queue.technology), uint8(Technology.Laser));
        assertEq(queue.targetLevel, 1);
        assertEq(queue.cost.metal, 200);
        assertEq(queue.cost.crystal, 100);
        assertEq(queue.cost.deuterium, 0);
        assertEq(queue.readyAt, block.timestamp + 540);

        vm.warp(queue.readyAt);
        vm.prank(player);
        game.finishResearch();

        assertEq(game.technologyLevel(player, Technology.Laser), 1);
        assertFalse(game.researchQueue(player).active);
    }

    function testAdvancedResearchPrerequisitesCoverRequestedTechnologies() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        _setBuildingLevel(planetId, Building.ResearchLab, 3);
        vm.prank(player);
        bytes32 researchLabFourDependency = "RESEARCH_LAB_4";
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.MissingDependency.selector, researchLabFourDependency
            )
        );
        game.startResearch(planetId, Technology.Ion);

        _setBuildingLevel(planetId, Building.ResearchLab, 7);
        vm.prank(player);
        bytes32 hyperspaceDependency = "ENERGY_5_SHIELDING_5";
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.MissingDependency.selector, hyperspaceDependency
            )
        );
        game.startResearch(planetId, Technology.Hyperspace);

        _setTechnologyLevel(player, Technology.Hyperspace, 2);
        vm.prank(player);
        bytes32 hyperspaceDriveDependency = "HYPERSPACE_3";
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.MissingDependency.selector, hyperspaceDriveDependency
            )
        );
        game.startResearch(planetId, Technology.HyperspaceDrive);

        _setBuildingLevel(planetId, Building.ResearchLab, 10);
        vm.prank(player);
        bytes32 irnDependency = "COMPUTER_8_HYPERSPACE_8";
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.MissingDependency.selector, irnDependency)
        );
        game.startResearch(planetId, Technology.IntergalacticResearchNetwork);

        _setBuildingLevel(planetId, Building.ResearchLab, 12);
        vm.prank(player);
        bytes32 gravitonDependency = "GRAVITON_ENERGY";
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.MissingDependency.selector, gravitonDependency
            )
        );
        game.startResearch(planetId, Technology.Graviton);
    }

    function testBuildingConstructionAndCompletion() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.MetalMine);

        VeydriftGameStorage.BuildingConstruction memory construction =
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
            abi.encodeWithSelector(
                VeydriftGameStorage.ConstructionNotReady.selector, construction.readyAt
            )
        );
        game.finishBuildingUpgrade(planetId);

        vm.warp(construction.readyAt);
        vm.prank(player);
        game.finishBuildingUpgrade(planetId);

        assertEq(game.buildingLevel(planetId, Building.MetalMine), 1);
        assertFalse(game.activeBuildingConstruction(planetId).active);
        VeydriftGameStorage.Resources memory nextCost =
            game.buildingUpgradeCost(planetId, Building.MetalMine);
        assertEq(nextCost.metal, 90);
        assertEq(nextCost.crystal, 22);
        assertEq(nextCost.deuterium, 0);
    }

    function testBuildingConstructionDurationsMatchClassicOGameFormula() public {
        _assertStartedBuildingDuration(address(0xB001), Building.MetalMine, 60, 15, 0, 108);
        _assertStartedBuildingDuration(address(0xB002), Building.SolarPlant, 75, 30, 0, 151);
        _assertStartedBuildingDuration(
            address(0xB003), Building.DeuteriumSynthesizer, 225, 75, 0, 432
        );
        _assertStartedBuildingDuration(
            address(0xB004), Building.RoboticsFactory, 400, 120, 200, 748
        );
    }

    function testBuildingCompletionRejectsBeforeDisplayedReadyAt() public {
        address account = address(0xB005);
        vm.deal(account, 1 ether);
        vm.prank(account);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(account);
        game.startBuildingUpgrade(planetId, Building.DeuteriumSynthesizer);
        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        assertEq(construction.readyAt, block.timestamp + 432);

        vm.warp(construction.readyAt - 1);
        vm.prank(account);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.ConstructionNotReady.selector, construction.readyAt
            )
        );
        game.finishBuildingUpgrade(planetId);

        vm.warp(construction.readyAt);
        vm.prank(account);
        game.finishBuildingUpgrade(planetId);
        assertEq(game.buildingLevel(planetId, Building.DeuteriumSynthesizer), 1);
    }

    function testOGameBuildingEconomyFormulas() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        _build(player, planetId, Building.MetalMine);
        _build(player, planetId, Building.SolarPlant);

        VeydriftGameStorage.Resources memory metalMineLevelTwo =
            game.buildingUpgradeCost(planetId, Building.MetalMine);
        VeydriftGameStorage.Resources memory crystalMineLevelOne =
            game.buildingUpgradeCost(planetId, Building.CrystalMine);
        VeydriftGameStorage.Resources memory fusionLevelOne =
            game.buildingUpgradeCost(planetId, Building.FusionReactor);
        VeydriftGameStorage.Resources memory roboticsLevelOne =
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

        VeydriftGameStorage.Resources memory resources = game.previewResources(planetId);
        VeydriftGameStorage.Resources memory required = game.resourceReserveRequirement();
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
            abi.encodeWithSelector(
                VeydriftGameStorage.MissingDependency.selector, roboticsDependency
            )
        );
        game.startBuildingUpgrade(planetId, Building.Shipyard);

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.MetalMine);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.ConstructionActive.selector);
        game.startBuildingUpgrade(planetId, Building.CrystalMine);
    }

    function testCatalogIncludesCrawlerAndMissileRules() public view {
        VeydriftGame.Resources memory crawlerCost = game.shipCost(Ship.Crawler);

        assertEq(crawlerCost.metal, 2_000);
        assertEq(crawlerCost.crystal, 2_000);
        assertEq(crawlerCost.deuterium, 1_000);
        assertEq(VeydriftCatalog.missileSlots(Defense.AntiBallisticMissile), 1);
        assertEq(VeydriftCatalog.missileSlots(Defense.InterplanetaryMissile), 2);
        assertEq(VeydriftCatalog.missileSiloCapacity(3), 30);
        assertEq(VeydriftCatalog.maxDefensePerPlanet(Defense.SmallShieldDome), 1);
        assertEq(VeydriftCatalog.maxDefensePerPlanet(Defense.LargeShieldDome), 1);
        assertEq(VeydriftCatalog.maxDefensePerPlanet(Defense.RocketLauncher), type(uint32).max);
    }

    function testDefenseDependencyCatalogRequiresMissileSilo() public {
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftDependencies.MissingDependency.selector, MISSILE_SILO_2)
        );
        VeydriftDependencies.requireDefense(Defense.AntiBallisticMissile, 1, 1, 0, 0, 0, 0, 0, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftDependencies.MissingDependency.selector, MISSILE_SILO_4)
        );
        VeydriftDependencies.requireDefense(
            Defense.InterplanetaryMissile, 1, 3, 0, 0, 0, 0, 0, 1, 0
        );

        VeydriftDependencies.requireDefense(
            Defense.InterplanetaryMissile, 1, 4, 0, 0, 0, 0, 0, 1, 0
        );
    }

    function testCrawlerDependencyCatalogRequiresVanillaUnlocks() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftDependencies.MissingDependency.selector, CRAWLER_TECH_REQUIREMENT
            )
        );
        VeydriftDependencies.requireShip(Ship.Crawler, 5, 3, 0, 0, 0, 0, 0, 3, 0, 0, 3, 0);

        VeydriftDependencies.requireShip(Ship.Crawler, 5, 4, 0, 0, 0, 0, 0, 4, 0, 0, 4, 0);
    }

    function testBuildingDependencyCatalogRequiresVanillaUnlocks() public {
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftDependencies.MissingDependency.selector, ENERGY_3)
        );
        VeydriftDependencies.requireBuilding(Building.FusionReactor, 5, 0, 0, 0, 0, 2, 0, 0);
        VeydriftDependencies.requireBuilding(Building.FusionReactor, 5, 0, 0, 0, 0, 3, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftDependencies.MissingDependency.selector, COMPUTER_10)
        );
        VeydriftDependencies.requireBuilding(Building.NaniteFactory, 0, 10, 0, 0, 0, 0, 9, 0);
        VeydriftDependencies.requireBuilding(Building.NaniteFactory, 0, 10, 0, 0, 0, 0, 10, 0);

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftDependencies.MissingDependency.selector, ENERGY_12)
        );
        VeydriftDependencies.requireBuilding(Building.Terraformer, 0, 0, 0, 0, 1, 11, 0, 0);
        VeydriftDependencies.requireBuilding(Building.Terraformer, 0, 0, 0, 0, 1, 12, 0, 0);
    }

    function testResearchDependencyCatalogUsesLabRequirements() public {
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftDependencies.MissingDependency.selector, RESEARCH_LAB_12)
        );
        VeydriftDependencies.requireResearch(Technology.Graviton, 11, 0, 0, 0, 0, 0, 0, 0);

        VeydriftDependencies.requireResearch(Technology.Graviton, 12, 0, 0, 0, 0, 0, 0, 0);
    }

    function testBuildingUpgradeRejectsInsufficientResources() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.InsufficientResources.selector, 500, 500, 0)
        );
        game.startBuildingUpgrade(planetId, Building.MetalStorage);
    }

    function testCollectResourcesAccruesProductionAfterInfrastructureUpgrade() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        _build(player, planetId, Building.MetalMine);
        _build(player, planetId, Building.SolarPlant);

        VeydriftGameStorage.Resources memory beforeResources = game.previewResources(planetId);
        vm.warp(block.timestamp + 1 hours);

        vm.prank(player);
        game.collectResources(planetId);

        VeydriftGameStorage.Resources memory afterResources = game.previewResources(planetId);
        VeydriftGameStorage.Resources memory required = game.resourceReserveRequirement();
        assertGt(afterResources.metal, beforeResources.metal);
        assertEq(afterResources.crystal, beforeResources.crystal);
        assertEq(afterResources.deuterium, beforeResources.deuterium);
        assertEq(required.metal, afterResources.metal);
        assertEq(required.crystal, afterResources.crystal);
        assertEq(required.deuterium, afterResources.deuterium);
    }

    function testSettlementCannotIssueMoreResourcesThanReserveBacking() public {
        VeydriftGame limitedGame = _newGame(admin);
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

        VeydriftGameStorage.Planet memory planet = limitedGame.planet(planetId);
        VeydriftGameStorage.Resources memory required = limitedGame.resourceReserveRequirement();
        VeydriftGameStorage.Resources memory available = limitedGame.resourceReserveAvailable();

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
        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);

        vm.warp(construction.readyAt);
        vm.prank(player);
        game.collectResources(planetId);

        assertEq(game.buildingLevel(planetId, Building.MetalMine), 1);
        assertFalse(game.activeBuildingConstruction(planetId).active);
    }

    function testDefenseDependenciesMatchVanillaOGameRequirements() public {
        VeydriftDependencies.requireDefense(Defense.RocketLauncher, 1, 0, 0, 0, 0, 0, 0, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftDependencies.MissingDependency.selector, DEP_SHIPYARD_2)
        );
        VeydriftDependencies.requireDefense(Defense.LightLaser, 1, 0, 1, 3, 0, 0, 0, 0, 0);

        VeydriftDependencies.requireDefense(Defense.LightLaser, 2, 0, 1, 3, 0, 0, 0, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftDependencies.MissingDependency.selector, DEP_WEAPONS_3)
        );
        VeydriftDependencies.requireDefense(Defense.GaussCannon, 6, 0, 6, 0, 0, 2, 1, 0, 0);

        VeydriftDependencies.requireDefense(Defense.GaussCannon, 6, 0, 6, 0, 0, 3, 1, 0, 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftDependencies.MissingDependency.selector, DEP_MISSILE_SILO_4
            )
        );
        VeydriftDependencies.requireDefense(
            Defense.InterplanetaryMissile, 1, 3, 0, 0, 0, 0, 0, 1, 0
        );

        VeydriftDependencies.requireDefense(
            Defense.InterplanetaryMissile, 1, 4, 0, 0, 0, 0, 0, 1, 0
        );
    }

    function testDefenseDurationUsesVanillaShipyardNaniteBasis() public pure {
        assertEq(VeydriftFormulas.unitDuration(1, 0, 2_000, 0, 0, 1, 60), 1_440);
        assertEq(VeydriftFormulas.unitDuration(1, 2, 2_000, 0, 0, 1, 60), 360);
        assertEq(VeydriftFormulas.unitDuration(8, 0, 1_500, 500, 0, 1, 60), 320);
    }

    function testDefenseProductionEnforcesDomeAndMissileCaps() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _seedDefensePrerequisites(planetId);
        _setResources(planetId, 5_000_000, 5_000_000, 5_000_000);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.DefenseLimitReached.selector, Defense.SmallShieldDome
            )
        );
        game.startDefenseProduction(planetId, Defense.SmallShieldDome, 2);

        _buildDefense(planetId, Defense.SmallShieldDome, 1);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.DefenseLimitReached.selector, Defense.SmallShieldDome
            )
        );
        game.startDefenseProduction(planetId, Defense.SmallShieldDome, 1);

        _buildDefense(planetId, Defense.InterplanetaryMissile, 20);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.MissileSiloCapacityExceeded.selector, 41, 40)
        );
        game.startDefenseProduction(planetId, Defense.AntiBallisticMissile, 1);
    }

    function testInterplanetaryMissileAttackConsumesSilosInterceptionAndDestroysDefense() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setDefenseCount(originPlanetId, Defense.InterplanetaryMissile, 5);
        _setDefenseCount(targetPlanetId, Defense.AntiBallisticMissile, 2);
        _setDefenseCount(targetPlanetId, Defense.LightLaser, 10);
        _setDefenseCount(targetPlanetId, Defense.RocketLauncher, 20);

        vm.expectEmit(true, true, true, true, address(game));
        emit InterplanetaryMissileAttack(
            player, originPlanetId, targetPlanetId, Defense.LightLaser, 5, 2, 3, 3
        );
        vm.prank(player);
        game.launchInterplanetaryMissileAttack(
            originPlanetId, targetPlanetId, Defense.LightLaser, 5
        );

        assertEq(game.defenseCount(originPlanetId, Defense.InterplanetaryMissile), 0);
        assertEq(game.defenseCount(targetPlanetId, Defense.AntiBallisticMissile), 0);
        assertEq(game.defenseCount(targetPlanetId, Defense.LightLaser), 7);
        assertEq(game.defenseCount(targetPlanetId, Defense.RocketLauncher), 20);
    }

    function testInterplanetaryMissileAttackRejectsInsufficientInventory() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();

        _setDefenseCount(originPlanetId, Defense.InterplanetaryMissile, 1);
        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.InvalidQuantity.selector);
        game.launchInterplanetaryMissileAttack(
            originPlanetId, targetPlanetId, Defense.RocketLauncher, 2
        );
    }

    function testRiftDepositRequiresContractGates() public {
        vm.expectRevert(VeydriftGameStorage.NoPlanet.selector);
        game.depositMarketResource(1, Resource.Metal, 1);
    }

    function testShipProductionCompletesAndUpdatesCounts() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.Shipyard, 2);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setResources(planetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 2);

        VeydriftGameStorage.ShipQueue memory queue = game.shipQueue(planetId);
        assertTrue(queue.active);
        assertEq(uint8(queue.ship), uint8(Ship.SmallCargo));
        assertEq(queue.quantity, 2);
        assertEq(queue.cost.metal, 4_000);
        assertEq(queue.cost.crystal, 4_000);

        vm.warp(queue.readyAt);
        vm.prank(player);
        game.finishShipProduction(planetId);

        assertFalse(game.shipQueue(planetId).active);
        assertEq(game.shipCount(planetId, Ship.SmallCargo), 2);
    }

    function testColonyAndTransportMutateState() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        (uint16 galaxy, uint16 system, uint8 position) = game.nextColonyCoordinates(player, 7);
        vm.prank(player);
        uint256 colonyPlanetId = game.createColony(originPlanetId, galaxy, system, position);

        assertEq(game.planetCountOf(player), 2);
        assertEq(game.planet(colonyPlanetId).owner, player);
        assertEq(game.shipCount(originPlanetId, Ship.ColonyShip), 0);

        VeydriftGameStorage.Resources memory cargo =
            VeydriftGameStorage.Resources({metal: 100, crystal: 0, deuterium: 0});
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            colonyPlanetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            cargo,
            0
        );

        (VeydriftGameStorage.FleetMissionStatus status, uint64 arrivalAt,,) =
            _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 0);

        vm.warp(arrivalAt);
        vm.prank(player);
        game.resolveFleetMission(missionId);

        (status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertEq(game.planet(colonyPlanetId).resources.metal, 100);
        assertEq(game.shipCount(colonyPlanetId, Ship.SmallCargo), 1);
    }

    function testGenericFleetMissionLaunchRecallResolveAndReturn() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Computer, 1);
        _setShipCount(originPlanetId, Ship.SmallCargo, 2);
        _setShipCount(originPlanetId, Ship.LightFighter, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 5_000, 4_000, 3_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        (VeydriftGameStorage.FleetMissionStatus status, uint64 arrivalAt, uint64 returnAt,) =
            _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        assertEq(game.activeFleetMissionCount(player), 1);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 1);

        vm.prank(player);
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Harvest,
            _lightFighterManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            99
        );
        assertEq(game.activeFleetMissionCount(player), 2);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.FleetSlotLimitReached.selector, 2)
        );
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        vm.warp(arrivalAt);
        game.resolveFleetMission(missionId);
        game.resolveFleetMission(missionId);

        (status,, returnAt,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        vm.warp(returnAt);
        game.completeFleetMissionReturn(missionId);
        assertEq(game.activeFleetMissionCount(player), 1);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 2);
        assertGt(game.planet(originPlanetId).resources.metal, 0);
    }

    function testGenericFleetMissionRecallAndRaidReturn() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);

        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Computer, 1);
        _setShipCount(originPlanetId, Ship.SmallCargo, 2);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 5_000, 4_000, 3_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.prank(player);
        uint256 recalledMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Harvest,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            123
        );
        vm.warp(block.timestamp + 90 seconds);
        vm.prank(player);
        game.recallFleetMission(recalledMissionId);
        (,, uint64 recallReturnAt,) = _fleetMission(recalledMissionId);
        vm.warp(recallReturnAt);
        game.completeFleetMissionReturn(recalledMissionId);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 2);

        vm.prank(player);
        uint256 raidMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            456
        );
        (
            ,
            uint64 raidArrivalAt,
            uint64 raidReturnAt,
            VeydriftGameStorage.Resources memory raidCargo
        ) = _fleetMission(raidMissionId);
        vm.warp(raidArrivalAt);
        game.resolveFleetMission(raidMissionId);
        VeydriftGameStorage.FleetMissionStatus raidStatus;
        (raidStatus, raidArrivalAt, raidReturnAt, raidCargo) = _fleetMission(raidMissionId);
        assertEq(uint8(raidStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertGt(raidCargo.metal, 0);

        vm.warp(raidReturnAt);
        game.completeFleetMissionReturn(raidMissionId);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 2);
        assertGt(game.planet(originPlanetId).resources.metal, 0);
    }

    function testFleetMissionVisibilityRecallCostAndCutoff() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);

        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Computer, 1);
        _setShipCount(originPlanetId, Ship.SmallCargo, 3);
        _setShipCount(originPlanetId, Ship.LightFighter, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 5_000, 4_000, 3_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        ships.lightFighter = 1;
        VeydriftGameStorage.Resources memory cargo =
            VeydriftGameStorage.Resources({metal: 150, crystal: 25, deuterium: 0});

        vm.expectEmit(true, false, false, true, address(game));
        emit FleetMissionCargo(1, 150, 25, 0, 6);
        vm.expectEmit(true, false, false, true, address(game));
        emit FleetMissionShips(1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        vm.prank(player);
        uint256 recalledMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            cargo,
            123
        );

        (, uint64 arrivalAt,,) = _fleetMission(recalledMissionId);
        assertGt(arrivalAt, block.timestamp + game.FLEET_RECALL_CUTOFF_SECONDS());

        uint128 deuteriumBeforeRecall = game.planet(originPlanetId).resources.deuterium;
        uint64 expectedReturnAt = uint64(block.timestamp + 180 seconds);
        vm.warp(block.timestamp + 90 seconds);
        vm.expectEmit(true, true, false, true, address(game));
        emit FleetMissionRecalled(recalledMissionId, player, expectedReturnAt, 1);
        vm.expectEmit(true, true, true, true, address(game));
        emit FleetMissionReturnExposed(
            recalledMissionId,
            player,
            VeydriftGameStorage.FleetMissionStatus.Recalled,
            originPlanetId,
            targetPlanetId,
            expectedReturnAt,
            150,
            25,
            0
        );
        vm.prank(player);
        game.recallFleetMission(recalledMissionId);
        assertEq(game.planet(originPlanetId).resources.deuterium, deuteriumBeforeRecall - 1);

        ships.lightFighter = 0;
        vm.prank(player);
        uint256 cutoffMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            456
        );
        (, uint64 cutoffArrivalAt,,) = _fleetMission(cutoffMissionId);
        uint64 recallDeadline = cutoffArrivalAt - game.FLEET_RECALL_CUTOFF_SECONDS();
        vm.warp(cutoffArrivalAt - game.FLEET_RECALL_CUTOFF_SECONDS() + 1);
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.FleetRecallCutoffPassed.selector, recallDeadline
            )
        );
        game.recallFleetMission(cutoffMissionId);
    }

    function testResolvedHostileMissionExposesReturningFleet() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);

        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 5_000, 4_000, 3_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);

        vm.warp(arrivalAt);
        vm.expectEmit(true, true, true, false, address(game));
        emit FleetMissionReturnExposed(
            missionId, player, VeydriftGameStorage.FleetMissionStatus.Returning, 0, 0, 0, 0, 0, 0
        );
        game.resolveFleetMission(missionId);

        (
            VeydriftGameStorage.FleetMissionStatus status,,
            uint64 returnAt,
            VeydriftGameStorage.Resources memory raidedCargo
        ) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertGt(returnAt, block.timestamp);
        assertGt(raidedCargo.metal, 0);
    }

    function testAttackBattleAttackerWinUsesProtectedAndCargoLimitedLoot() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 4_000, 3_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            777
        );

        (VeydriftGameStorage.FleetMissionStatus status, uint64 arrivalAt,,) =
            _fleetMission(missionId);
        vm.warp(arrivalAt);
        game.resolveFleetMission(missionId);

        VeydriftGameStorage.Resources memory cargo;
        (status,,, cargo) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(cargo.metal, 4_500);
        assertEq(cargo.crystal, 500);
        assertEq(cargo.deuterium, 0);
        assertEq(game.planet(targetPlanetId).resources.metal, 5_500);
        assertEq(game.planet(targetPlanetId).resources.crystal, 3_500);
        assertEq(game.planet(targetPlanetId).resources.deuterium, 3_000);
    }

    function testAttackBattleProtectedResourcesAreNotLooted() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 900, 900, 900);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            778
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        game.resolveFleetMission(missionId);

        (,,, VeydriftGameStorage.Resources memory cargo) = _fleetMission(missionId);
        assertEq(cargo.metal, 0);
        assertEq(cargo.crystal, 0);
        assertEq(cargo.deuterium, 0);
        assertEq(game.planet(targetPlanetId).resources.metal, 900);
    }

    function testAttackBattleDefenderWinDestroysAttackerFleet() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setDefenseCount(targetPlanetId, Defense.RocketLauncher, 10);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 4_000, 3_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 100, crystal: 0, deuterium: 0}),
            779
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        game.resolveFleetMission(missionId);

        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertEq(game.activeFleetMissionCount(player), 0);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 0);
        assertEq(game.planet(targetPlanetId).resources.metal, 10_000);
    }

    function testAttackBattleDrawReturnsSurvivorsWithoutLoot() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setDefenseCount(targetPlanetId, Defense.LargeShieldDome, 10);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 4_000, 3_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            780
        );
        (, uint64 arrivalAt, uint64 returnAt,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        game.resolveFleetMission(missionId);

        VeydriftGameStorage.FleetMissionStatus status;
        (status,, returnAt,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        vm.warp(returnAt);
        game.completeFleetMissionReturn(missionId);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 1);
        assertEq(game.planet(originPlanetId).resources.metal, 10_000);
        assertEq(game.planet(targetPlanetId).resources.metal, 10_000);
    }

    function testAttackBattleAppliesFleetAndDefenseLosses() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.Battleship, 1);
        _setDefenseCount(targetPlanetId, Defense.RocketLauncher, 100);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 4_000, 3_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.battleship = 1;

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            781
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        game.resolveFleetMission(missionId);

        assertLt(game.defenseCount(targetPlanetId, Defense.RocketLauncher), 100);
        assertEq(game.shipCount(originPlanetId, Ship.Battleship), 0);
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
    }

    function testAttackBattleDerivesDeterministicBattleSeedFromOneRequestId() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 4_000, 3_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        uint256 requestId = 987_654;

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            requestId
        );

        uint256 expectedSeed = uint256(
            keccak256(
                abi.encode(
                    game.ATTACK_BATTLE_DOMAIN(),
                    block.chainid,
                    missionId,
                    player,
                    originPlanetId,
                    targetPlanetId,
                    requestId
                )
            )
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        vm.expectEmit(true, true, true, true, address(game));
        emit AttackBattleResolved(
            missionId,
            player,
            targetPlanetId,
            VeydriftGameStorage.BattleOutcome.AttackerWin,
            0,
            expectedSeed,
            4_500,
            500,
            0
        );
        game.resolveFleetMission(missionId);
    }

    function testGenericFleetMissionRejectsInvalidTargetCapacityShipsAndTiming() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        VeydriftGameStorage.Resources memory cargo =
            VeydriftGameStorage.Resources({metal: 5_001, crystal: 0, deuterium: 0});

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.NoPlanet.selector);
        game.launchFleetMission(
            originPlanetId,
            999,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.CargoCapacityExceeded.selector, 5_000, 5_001)
        );
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            cargo,
            0
        );

        ships.smallCargo = 2;
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.InsufficientShips.selector, Ship.SmallCargo, 1, 2
            )
        );
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
    }

    function testMissionLaunchRejectsFuelAndInFlightCommitments() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Computer, 1);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 0);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.InsufficientResources.selector, 10_000, 10_000, 0
            )
        );
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        vm.prank(player);
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.InsufficientShips.selector, Ship.SmallCargo, 0, 1
            )
        );
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
    }

    function testRiftDepositWithdrawalMovesTokenAndInGameBalances() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.InterdimensionalRiftStabilizer, 1);
        _setResources(planetId, 1_000, 1_000, 1_000);

        metalToken.mint(player, 1_000);
        vm.prank(player);
        metalToken.approve(address(game), 1_000);

        vm.prank(player);
        game.depositMarketResource(planetId, Resource.Metal, 100);
        assertEq(game.planet(planetId).resources.metal, 1_100);
        assertEq(metalToken.balanceOf(player), 900);

        vm.prank(player);
        game.requestMarketResourceWithdrawal(planetId, Resource.Metal, 50);
        (bool active,,,, uint64 unlocksAt) = game.resourceWithdrawals(player, Resource.Metal);
        assertTrue(active);
        assertEq(game.planet(planetId).resources.metal, 1_050);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.WithdrawalNotReady.selector, unlocksAt)
        );
        game.finishMarketResourceWithdrawal(Resource.Metal);

        vm.warp(unlocksAt);
        vm.prank(player);
        game.finishMarketResourceWithdrawal(Resource.Metal);

        (bool finished,,,,) = game.resourceWithdrawals(player, Resource.Metal);
        assertFalse(finished);
        assertEq(metalToken.balanceOf(player), 950);
    }

    function testDirectCallsEnforceShipAndResearchPrerequisitesBeforeUnsupported() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.MissingDependency.selector, DEP_SHIPYARD_2)
        );
        game.startShipProduction(planetId, Ship.SmallCargo, 1);

        vm.prank(player);
        bytes32 researchLabDependency = "RESEARCH_LAB_1";
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.MissingDependency.selector, researchLabDependency
            )
        );
        game.startResearch(planetId, Technology.Energy);
    }

    function testDirectCallsRejectInvalidQuantitiesBeforeUnsupported() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.InvalidQuantity.selector);
        game.startShipProduction(planetId, Ship.SmallCargo, 0);
    }

    function testDirectColonyCallsEnforcePlanetLimitBeforeUnsupported() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftGameStorage.PlanetLimitReached.selector, 1));
        game.createColonyAtNextSlot(planetId, 0);
    }

    function testDirectQueueFinishCallsRequireActiveReadyQueues() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.QueueInactive.selector);
        game.finishDefenseProduction(planetId);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.QueueInactive.selector);
        game.finishShipProduction(planetId);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.QueueInactive.selector);
        game.finishResearch();
    }

    function testAuditScopedReadEntrypointsAreContractBacked() public {
        vm.expectRevert(VeydriftGameStorage.NoPlanet.selector);
        game.transportTravelSeconds(1, 2);
        (uint16 galaxy, uint16 system, uint8 position) = game.nextColonyCoordinates(player, 1);
        assertGe(galaxy, 1);
        assertGe(system, 1);
        assertGe(position, 1);
    }

    function _build(address account, uint256 planetId, Building building) internal {
        _build(game, account, planetId, building);
    }

    function _assertStartedBuildingDuration(
        address account,
        Building building,
        uint128 metalCost,
        uint128 crystalCost,
        uint128 deuteriumCost,
        uint64 expectedDuration
    ) internal {
        vm.deal(account, 1 ether);
        vm.prank(account);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setResources(planetId, metalCost, crystalCost, deuteriumCost);

        uint256 startedAt = block.timestamp;
        vm.prank(account);
        game.startBuildingUpgrade(planetId, building);

        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        assertEq(construction.readyAt, startedAt + expectedDuration);
        assertEq(construction.cost.metal, metalCost);
        assertEq(construction.cost.crystal, crystalCost);
        assertEq(construction.cost.deuterium, deuteriumCost);
    }

    function _build(VeydriftGame targetGame, address account, uint256 planetId, Building building)
        internal
    {
        vm.prank(account);
        targetGame.startBuildingUpgrade(planetId, building);
        VeydriftGameStorage.BuildingConstruction memory construction =
            targetGame.activeBuildingConstruction(planetId);
        vm.warp(construction.readyAt);
        vm.prank(account);
        targetGame.finishBuildingUpgrade(planetId);
    }

    function _buildDefense(uint256 planetId, Defense defense, uint32 quantity) internal {
        vm.prank(player);
        game.startDefenseProduction(planetId, defense, quantity);
        VeydriftGameStorage.DefenseQueue memory queue = game.defenseQueue(planetId);
        vm.warp(queue.readyAt);
        vm.prank(player);
        game.finishDefenseProduction(planetId);
    }

    function _seedDefensePrerequisites(uint256 planetId) internal {
        _setBuildingLevel(planetId, Building.Shipyard, 8);
        _setBuildingLevel(planetId, Building.MissileSilo, 4);
        _setTechnologyLevel(player, Technology.Energy, 6);
        _setTechnologyLevel(player, Technology.Laser, 6);
        _setTechnologyLevel(player, Technology.Ion, 4);
        _setTechnologyLevel(player, Technology.Weapons, 3);
        _setTechnologyLevel(player, Technology.Shielding, 6);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 1);
        _setTechnologyLevel(player, Technology.Plasma, 7);
    }

    function _seedAttackPlanets()
        internal
        returns (uint256 originPlanetId, uint256 targetPlanetId, address defender)
    {
        defender = address(0xDEF);
        vm.deal(defender, 1 ether);
        vm.prank(player);
        originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        targetPlanetId = game.startPlanet{value: 0.05 ether}();
    }

    function _setBuildingLevel(uint256 planetId, Building building, uint16 level) internal {
        bytes32 outerSlot = keccak256(abi.encode(planetId, uint256(6)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(building)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(level)));
    }

    function _setTechnologyLevel(address account, Technology technology, uint16 level) internal {
        bytes32 outerSlot = keccak256(abi.encode(account, uint256(20)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(technology)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(level)));
    }

    function _setShipCount(uint256 planetId, Ship ship, uint32 count) internal {
        bytes32 outerSlot = keccak256(abi.encode(planetId, uint256(22)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(ship)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(count)));
    }

    function _setDefenseCount(uint256 planetId, Defense defense, uint32 count) internal {
        bytes32 outerSlot = keccak256(abi.encode(planetId, uint256(19)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(defense)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(count)));
    }

    function _setResources(uint256 planetId, uint128 metal, uint128 crystal, uint128 deuterium)
        internal
    {
        uint256 planetBase = uint256(keccak256(abi.encode(planetId, uint256(4))));
        vm.store(address(game), bytes32(planetBase + 2), _packResourcesHead(metal, crystal));
        vm.store(address(game), bytes32(planetBase + 3), bytes32(uint256(deuterium)));
        vm.store(address(game), bytes32(uint256(14)), _packResourcesHead(metal, crystal));
        vm.store(address(game), bytes32(uint256(15)), bytes32(uint256(deuterium)));
    }

    function _lightFighterManifest()
        internal
        pure
        returns (VeydriftGameStorage.MissionShips memory ships)
    {
        ships.lightFighter = 1;
    }

    function _fleetMission(uint256 missionId)
        internal
        view
        returns (
            VeydriftGameStorage.FleetMissionStatus status,
            uint64 arrivalAt,
            uint64 returnAt,
            VeydriftGameStorage.Resources memory cargo
        )
    {
        (status,,,,,, arrivalAt, returnAt,, cargo,) = game.fleetMission(missionId);
    }

    function _packResourcesHead(uint128 metal, uint128 crystal) internal pure returns (bytes32) {
        return bytes32((uint256(crystal) << 128) | uint256(metal));
    }

    function _fundGameReserves(uint256 amount) internal {
        _fundGameReserves(game, metalToken, crystalToken, deuteriumToken, amount);
    }

    function _newGame(address owner) internal returns (VeydriftGame) {
        return new VeydriftGame(owner, address(new VeydriftCombatModule()));
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
