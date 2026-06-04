// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftSpaceDockSystem} from "../src/VeydriftSpaceDockSystem.sol";
import {VeydriftAntiRaidPrimitives} from "../src/libraries/VeydriftAntiRaidPrimitives.sol";
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
    event PlanetShipCountChanged(uint256 indexed planetId, Ship indexed ship, uint32 total);

    uint128 internal constant RESERVE_FUNDING = 1_000_000_000_000;
    bytes32 internal constant DEP_SHIPYARD_2 = "SHIPYARD_2";
    bytes32 internal constant DEP_WEAPONS_3 = "WEAPONS_3";
    bytes32 internal constant DEP_MISSILE_SILO_4 = "MISSILE_SILO_4";
    bytes32 internal constant MISSILE_SILO_2 = "MISSILE_SILO_2";
    bytes32 internal constant MISSILE_SILO_4 = "MISSILE_SILO_4";
    bytes32 internal constant CRAWLER_TECH_REQUIREMENT = "COMBUSTION_4_ARMOR_4_LASER_4";
    bytes32 internal constant RESEARCH_LAB_12 = "RESEARCH_LAB_12";
    bytes32 internal constant ENERGY_3 = "ENERGY_3";
    bytes32 internal constant NANITE_FACTORY_1 = "NANITE_FACTORY_1";
    bytes32 internal constant COMPUTER_10 = "COMPUTER_10";
    bytes32 internal constant ENERGY_12 = "ENERGY_12";
    bytes32 internal constant TEST_ATTACK_BATTLE_DOMAIN = keccak256("veydrift.attack-battle.v1");
    bytes32 internal constant TEST_COMBAT_STREAM_DOMAIN =
        keccak256("veydrift.classic-combat-random-stream.v1");
    uint8 internal constant ATTACK_RELATION_WEAKER_FLAG = 2;
    uint8 internal constant ATTACK_BANDIT_FLAG = 8;
    uint8 internal constant ATTACK_INACTIVE_FLAG = 16;

    address internal admin = address(0xA11CE);
    address internal player = address(0xB0B);
    address internal fulfiller = address(0xF111);
    VeydriftGame internal game;
    VeydriftAllianceSystem internal allianceSystem;
    RandomnessEngine internal randomness;
    VeydriftMoonSystem internal moons;
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
    event PlanetSettled(
        uint256 indexed planetId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium,
        uint64 settledAt
    );
    event PlanetRenamed(address indexed player, uint256 indexed planetId, string name);
    event PlanetAbandoned(
        address indexed player,
        uint256 indexed planetId,
        uint16 galaxy,
        uint16 system,
        uint8 position
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
    event AttackMissionJoined(
        uint256 indexed attackMissionId,
        uint256 indexed joinedMissionId,
        address indexed participant,
        uint256 originPlanetId,
        uint256 targetPlanetId
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
        allianceSystem = new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)));
        randomness = new RandomnessEngine(admin, fulfiller);
        vm.prank(admin);
        randomness.setPrecommitRequired(false);
        moons = new VeydriftMoonSystem(address(game), address(randomness));
        metalToken = new MockResourceToken();
        crystalToken = new MockResourceToken();
        deuteriumToken = new MockResourceToken();
        _fundGameReserves(RESERVE_FUNDING);
        vm.prank(admin);
        game.setAllianceSystem(address(allianceSystem));
        vm.prank(admin);
        game.setMoonSystem(address(moons));
        vm.prank(admin);
        game.setRandomnessEngine(address(randomness));
        vm.prank(admin);
        randomness.setRequesterAuthorization(address(game), true);
        vm.prank(admin);
        randomness.setRequesterAuthorization(address(moons), true);
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
        assertEq(VeydriftCatalog.shipCargoCapacity(Ship.Crawler), 0);
        assertEq(game.maxPlanets(player), 1);
        assertEq(
            VeydriftCatalog.shipCargoCapacity(Ship.SmallCargo)
                + VeydriftCatalog.shipCargoCapacity(Ship.Recycler)
                + VeydriftCatalog.shipCargoCapacity(Ship.ColonyShip),
            32_500
        );

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

    function testResearchCostsScaleByCurrentLevel() public {
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

    function testResearchPrerequisitesUseCanonicalVeydriftRequirements() public {
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

    function testResearchDurationUsesLinkedLabsFromNetwork() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setShipCount(planetId, Ship.ColonyShip, 1);

        uint256 colonyPlanetId = _createResolvedColony(player, planetId, 189);

        _setBuildingLevel(planetId, Building.ResearchLab, 4);
        _setBuildingLevel(colonyPlanetId, Building.ResearchLab, 7);
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 1);
        _setTechnologyLevel(player, Technology.Energy, 8);
        _setTechnologyLevel(player, Technology.Laser, 10);
        _setTechnologyLevel(player, Technology.Ion, 5);
        _setResources(planetId, 100_000, 100_000, 100_000);

        vm.prank(player);
        game.startResearch(planetId, Technology.Plasma);

        VeydriftGameStorage.ResearchQueue memory queue = game.researchQueue(player);
        assertTrue(queue.active);
        assertEq(uint8(queue.technology), uint8(Technology.Plasma));
        assertEq(queue.readyAt, block.timestamp + 1_800);
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

    function testBuildingConstructionDurationsMatchCanonicalVeydriftFormula() public {
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

    function testTerraformerCompletionExpandsPlanetFieldsByFive() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        uint16 startingFields = game.planet(planetId).fields;

        _seedTerraformerPrerequisites(planetId);
        _setResources(planetId, 0, 50_000, 100_000);

        _build(player, planetId, Building.Terraformer);

        assertEq(game.buildingLevel(planetId, Building.Terraformer), 1);
        assertEq(game.planet(planetId).fields, startingFields + 5);
    }

    function testTerraformerCanStartAtFullFieldCapacityAndOtherBuildingsCannot() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        uint16 startingFields = game.planet(planetId).fields;

        _seedTerraformerPrerequisites(planetId);
        _fillUsedFields(planetId, startingFields);
        _setResources(planetId, 20_000, 90_000, 100_000);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.FieldCapacityReached.selector);
        game.startBuildingUpgrade(planetId, Building.AllianceDepot);

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.Terraformer);

        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        vm.warp(construction.readyAt);
        vm.prank(player);
        game.finishBuildingUpgrade(planetId);

        assertEq(game.planet(planetId).fields, startingFields + 5);
        assertEq(game.buildingLevel(planetId, Building.Terraformer), 1);
    }

    function testTerraformerStartKeepsNaniteAndEnergyDependencies() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setResources(planetId, 0, 50_000, 100_000);
        _setTechnologyLevel(player, Technology.Energy, 12);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.MissingDependency.selector, NANITE_FACTORY_1)
        );
        game.startBuildingUpgrade(planetId, Building.Terraformer);

        _setBuildingLevel(planetId, Building.NaniteFactory, 1);
        _setTechnologyLevel(player, Technology.Energy, 11);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.MissingDependency.selector, ENERGY_12)
        );
        game.startBuildingUpgrade(planetId, Building.Terraformer);
    }

    function testVeydriftBuildingEconomyFormulas() public {
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
        assertEq(VeydriftFormulas.buildingDuration(2, 1, 10_000, 5_000, 1, 1), 3_600);
    }

    function testSolarSatellitesIncreasePlanetEnergy() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        VeydriftGameStorage.FirstPlanet memory planet = game.firstPlanetOf(player);
        uint256 perSatelliteEnergy = VeydriftFormulas.solarSatelliteEnergy(planet.temperature);

        _setShipCount(planetId, Ship.SolarSatellite, 3);

        (uint256 producedEnergy, uint256 requiredEnergy, uint256 scaleBps) =
            game.energyBalance(planetId);
        assertEq(producedEnergy, perSatelliteEnergy * 3);
        assertEq(requiredEnergy, 0);
        assertEq(scaleBps, 10_000);
    }

    function testDestroyedSolarSatellitesReducePlanetEnergy() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.Battleship, 100);
        _setShipCount(targetPlanetId, Ship.SolarSatellite, 100);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

        (uint256 energyBefore,,) = game.energyBalance(targetPlanetId);

        VeydriftGameStorage.MissionShips memory ships;
        ships.battleship = 100;
        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            901
        );

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 901);
        vm.expectEmit(true, true, false, true, address(game));
        emit PlanetShipCountChanged(targetPlanetId, Ship.SolarSatellite, 0);
        game.resolveFleetMission(missionId);

        uint32 satellitesAfter = game.shipCount(targetPlanetId, Ship.SolarSatellite);
        (uint256 energyAfter,,) = game.energyBalance(targetPlanetId);
        assertEq(satellitesAfter, 0);
        assertLt(energyAfter, energyBefore);
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

    function testBuildingUpgradeAutoCollectsAccruedResourcesBeforeSpend() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.MetalMine, 1);
        _setBuildingLevel(planetId, Building.SolarPlant, 1);

        VeydriftGameStorage.Resources memory cost =
            game.buildingUpgradeCost(planetId, Building.CrystalMine);
        _setResources(planetId, cost.metal - 1, cost.crystal, cost.deuterium);

        vm.warp(block.timestamp + 1 hours);
        uint64 settledAt = uint64(block.timestamp);
        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.CrystalMine);

        assertTrue(game.activeBuildingConstruction(planetId).active);
        assertEq(game.planet(planetId).lastSettledAt, settledAt);
    }

    function testShipProductionAutoCollectsAccruedResourcesBeforeSpend() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.MetalMine, 20);
        _setBuildingLevel(planetId, Building.SolarPlant, 20);
        _setBuildingLevel(planetId, Building.Shipyard, 2);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);

        VeydriftGameStorage.Resources memory cost = game.shipCost(Ship.SmallCargo);
        _setResources(planetId, cost.metal - 1, cost.crystal, cost.deuterium);

        vm.warp(block.timestamp + 1 hours);
        uint64 settledAt = uint64(block.timestamp);
        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 1);

        assertTrue(game.shipQueue(planetId).active);
        assertEq(game.planet(planetId).lastSettledAt, settledAt);
    }

    function testResearchAutoCollectsAccruedResourcesBeforeSpend() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.MetalMine, 10);
        _setBuildingLevel(planetId, Building.SolarPlant, 10);
        _setBuildingLevel(planetId, Building.ResearchLab, 1);
        _setTechnologyLevel(player, Technology.Energy, 2);

        VeydriftGameStorage.Resources memory cost = game.researchCost(player, Technology.Laser);
        _setResources(planetId, cost.metal - 1, cost.crystal, cost.deuterium);

        vm.warp(block.timestamp + 1 hours);
        uint64 settledAt = uint64(block.timestamp);
        vm.prank(player);
        game.startResearch(planetId, Technology.Laser);

        assertTrue(game.researchQueue(player).active);
        assertEq(game.planet(planetId).lastSettledAt, settledAt);
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

    function testCrawlerDependencyCatalogRequiresCanonicalUnlocks() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftDependencies.MissingDependency.selector, CRAWLER_TECH_REQUIREMENT
            )
        );
        VeydriftDependencies.requireShip(Ship.Crawler, 5, 3, 0, 0, 0, 0, 0, 3, 0, 0, 3, 0);

        VeydriftDependencies.requireShip(Ship.Crawler, 5, 4, 0, 0, 0, 0, 0, 4, 0, 0, 4, 0);
    }

    function testBuildingDependencyCatalogRequiresCanonicalUnlocks() public {
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
        uint64 settledAt = uint64(block.timestamp);

        vm.prank(player);
        vm.expectEmit(true, false, false, true, address(game));
        emit PlanetSettled(planetId, 398, 455, 0, settledAt);
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

    function testDefenseDependenciesMatchCanonicalVeydriftRequirements() public {
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

    function testDefenseDurationUsesCanonicalShipyardNaniteBasis() public pure {
        assertEq(VeydriftFormulas.unitDuration(1, 0, 2_000, 0, 0, 1, 1, 1), 1_440);
        assertEq(VeydriftFormulas.unitDuration(1, 2, 2_000, 0, 0, 1, 1, 1), 360);
        assertEq(VeydriftFormulas.unitDuration(8, 0, 1_500, 500, 0, 1, 1, 1), 320);
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

    function testDefenseProductionAppendsMatchingActiveQueue() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _seedDefensePrerequisites(planetId);
        _setResources(planetId, 5_000_000, 5_000_000, 5_000_000);

        vm.prank(player);
        game.startDefenseProduction(planetId, Defense.RocketLauncher, 2);
        VeydriftGameStorage.DefenseQueue memory firstQueue = game.defenseQueue(planetId);
        (uint128 metalCost, uint128 crystalCost, uint128 deuteriumCost) =
            VeydriftCatalog.defenseCost(Defense.RocketLauncher);
        uint256 appendedDuration =
            VeydriftFormulas.unitDuration(8, 0, metalCost, crystalCost, deuteriumCost, 3, 1, 1);

        vm.warp(block.timestamp + 10);
        vm.prank(player);
        game.startDefenseProduction(planetId, Defense.RocketLauncher, 3);

        VeydriftGameStorage.DefenseQueue memory appendedQueue = game.defenseQueue(planetId);
        assertTrue(appendedQueue.active);
        assertEq(uint8(appendedQueue.defense), uint8(Defense.RocketLauncher));
        assertEq(appendedQueue.quantity, 5);
        assertEq(appendedQueue.readyAt, firstQueue.readyAt + appendedDuration);
        assertEq(appendedQueue.cost.metal, metalCost * 5);
        assertEq(appendedQueue.cost.crystal, crystalCost * 5);
        assertEq(appendedQueue.cost.deuterium, deuteriumCost * 5);
    }

    function testDefenseProductionRejectsDifferentActiveQueue() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _seedDefensePrerequisites(planetId);
        _setResources(planetId, 5_000_000, 5_000_000, 5_000_000);

        vm.prank(player);
        game.startDefenseProduction(planetId, Defense.RocketLauncher, 2);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.QueueActive.selector);
        game.startDefenseProduction(planetId, Defense.LightLaser, 1);
    }

    function testInterplanetaryMissileAttackConsumesSilosInterceptionAndDestroysDefense() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMissileAttackPlanets();
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

    function testInterplanetaryMissileAttackUsesScoreProtectionButDoesNotCountBashing() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMissileAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 200_000);
        _setShipCount(targetPlanetId, Ship.SmallCargo, 15_000);
        _setDefenseCount(originPlanetId, Defense.InterplanetaryMissile, 8);
        _setDefenseCount(targetPlanetId, Defense.LightLaser, 10);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.AttackScoreProtection.selector);
        game.launchInterplanetaryMissileAttack(
            originPlanetId, targetPlanetId, Defense.LightLaser, 1
        );

        _setShipCount(targetPlanetId, Ship.SmallCargo, 300_000);
        for (uint256 i = 0; i < VeydriftAntiRaidPrimitives.MAX_ATTACKS_PER_BASHING_WINDOW + 1; i++) {
            vm.prank(player);
            game.launchInterplanetaryMissileAttack(
                originPlanetId, targetPlanetId, Defense.LightLaser, 1
            );
        }

        assertEq(game.defenseCount(originPlanetId, Defense.InterplanetaryMissile), 1);
        assertEq(game.defenseCount(targetPlanetId, Defense.LightLaser), 3);
    }

    function testInterplanetaryMissileAttackAllowsPartialInterceptionWithoutNegativeDefense()
        public
    {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMissileAttackPlanets();
        _setDefenseCount(originPlanetId, Defense.InterplanetaryMissile, 8);
        _setDefenseCount(targetPlanetId, Defense.AntiBallisticMissile, 3);
        _setDefenseCount(targetPlanetId, Defense.PlasmaTurret, 2);

        vm.expectEmit(true, true, true, true, address(game));
        emit InterplanetaryMissileAttack(
            player, originPlanetId, targetPlanetId, Defense.PlasmaTurret, 8, 3, 5, 2
        );
        vm.prank(player);
        game.launchInterplanetaryMissileAttack(
            originPlanetId, targetPlanetId, Defense.PlasmaTurret, 8
        );

        assertEq(game.defenseCount(originPlanetId, Defense.InterplanetaryMissile), 0);
        assertEq(game.defenseCount(targetPlanetId, Defense.AntiBallisticMissile), 0);
        assertEq(game.defenseCount(targetPlanetId, Defense.PlasmaTurret), 0);
    }

    function testInterplanetaryMissileAttackRejectsInsufficientInventory() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMissileAttackPlanets();

        _setDefenseCount(originPlanetId, Defense.InterplanetaryMissile, 1);
        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.InvalidQuantity.selector);
        game.launchInterplanetaryMissileAttack(
            originPlanetId, targetPlanetId, Defense.RocketLauncher, 2
        );
    }

    function testInterplanetaryMissileAttackRejectsMissileInventoryAsTarget() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMissileAttackPlanets();
        _setDefenseCount(originPlanetId, Defense.InterplanetaryMissile, 2);
        _setDefenseCount(targetPlanetId, Defense.AntiBallisticMissile, 1);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.InvalidMissileTarget.selector, Defense.AntiBallisticMissile
            )
        );
        game.launchInterplanetaryMissileAttack(
            originPlanetId, targetPlanetId, Defense.AntiBallisticMissile, 1
        );
    }

    function testInterplanetaryMissileAttackRejectsOutOfRangeTarget() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMissileAttackPlanets();
        _setPlanetCoordinates(originPlanetId, 1, 1, 8);
        _setPlanetCoordinates(targetPlanetId, 1, 6, 8);
        _setDefenseCount(originPlanetId, Defense.InterplanetaryMissile, 1);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.InterplanetaryMissileOutOfRange.selector, 1, 6, 4
            )
        );
        game.launchInterplanetaryMissileAttack(
            originPlanetId, targetPlanetId, Defense.RocketLauncher, 1
        );
    }

    function testInterplanetaryMissileAttackRejectsCrossGalaxyTarget() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMissileAttackPlanets();
        _setPlanetCoordinates(originPlanetId, 1, 100, 8);
        _setPlanetCoordinates(targetPlanetId, 2, 100, 8);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 10);
        _setDefenseCount(originPlanetId, Defense.InterplanetaryMissile, 1);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.InterplanetaryMissileOutOfRange.selector, 100, 100, 49
            )
        );
        game.launchInterplanetaryMissileAttack(
            originPlanetId, targetPlanetId, Defense.RocketLauncher, 1
        );
    }

    function testInterplanetaryMissileAttackEnforcesDirectCallerEligibility() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) =
            _seedMissileAttackPlanets();
        _setDefenseCount(originPlanetId, Defense.InterplanetaryMissile, 1);

        vm.prank(defender);
        vm.expectRevert(VeydriftGameStorage.NotPlanetOwner.selector);
        game.launchInterplanetaryMissileAttack(
            originPlanetId, targetPlanetId, Defense.RocketLauncher, 1
        );

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.SamePlanet.selector);
        game.launchInterplanetaryMissileAttack(
            originPlanetId, originPlanetId, Defense.RocketLauncher, 1
        );

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.NoPlanet.selector);
        game.launchInterplanetaryMissileAttack(
            originPlanetId, targetPlanetId + 1, Defense.RocketLauncher, 1
        );
    }

    function testInterplanetaryMissileAttackRejectsSameOwnerTargetPlanet() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);

        uint256 colonyPlanetId = _createResolvedColony(player, originPlanetId, 9);
        _setPlanetCoordinates(originPlanetId, 1, 100, 8);
        _setPlanetCoordinates(colonyPlanetId, 1, 104, 9);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 1);
        _setDefenseCount(originPlanetId, Defense.InterplanetaryMissile, 1);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.SelfAttack.selector);
        game.launchInterplanetaryMissileAttack(
            originPlanetId, colonyPlanetId, Defense.RocketLauncher, 1
        );

        assertEq(game.defenseCount(originPlanetId, Defense.InterplanetaryMissile), 1);
    }

    function testInterplanetaryMissileAttackRejectsSameAllianceTargetPlanet() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) =
            _seedMissileAttackPlanets();
        uint256 allianceId = _createAlliance(defender);
        vm.prank(defender);
        allianceSystem.inviteMember(allianceId, player);
        vm.prank(player);
        allianceSystem.acceptInvite(allianceId);
        _setDefenseCount(originPlanetId, Defense.InterplanetaryMissile, 1);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.SameAllianceAttack.selector);
        game.launchInterplanetaryMissileAttack(
            originPlanetId, targetPlanetId, Defense.RocketLauncher, 1
        );

        assertEq(game.defenseCount(originPlanetId, Defense.InterplanetaryMissile), 1);
    }

    function testInterplanetaryMissileAttackRejectsProtectedDefender() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMissileAttackPlanets();
        _setTechnologyLevel(player, Technology.Graviton, 100);
        _setDefenseCount(originPlanetId, Defense.InterplanetaryMissile, 1);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.AttackScoreProtection.selector);
        game.launchInterplanetaryMissileAttack(
            originPlanetId, targetPlanetId, Defense.RocketLauncher, 1
        );

        assertEq(game.defenseCount(originPlanetId, Defense.InterplanetaryMissile), 1);
    }

    function testInterplanetaryMissileAttackDoesNotRecordBashingWindow() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMissileAttackPlanets();
        _setDefenseCount(originPlanetId, Defense.InterplanetaryMissile, 7);
        _setDefenseCount(targetPlanetId, Defense.RocketLauncher, 10);

        for (uint256 i = 0; i < VeydriftAntiRaidPrimitives.MAX_ATTACKS_PER_BASHING_WINDOW + 1; i++) {
            vm.prank(player);
            game.launchInterplanetaryMissileAttack(
                originPlanetId, targetPlanetId, Defense.RocketLauncher, 1
            );
        }

        assertEq(game.defenseCount(originPlanetId, Defense.InterplanetaryMissile), 0);
        assertEq(game.defenseCount(targetPlanetId, Defense.RocketLauncher), 3);
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

    function testFreshlyCompletedShipCanImmediatelyLaunchAttack() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);

        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();

        _setBuildingLevel(originPlanetId, Building.Shipyard, 2);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        game.startShipProduction(originPlanetId, Ship.SmallCargo, 1);
        VeydriftGameStorage.ShipQueue memory queue = game.shipQueue(originPlanetId);
        vm.warp(queue.readyAt);
        vm.prank(player);
        game.finishShipProduction(originPlanetId);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 0);
    }

    function testColonyAndTransportMutateState() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        uint256 colonyPlanetId = _createResolvedColony(player, originPlanetId, 7);

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

        uint64 returnAt;
        (status,, returnAt,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(game.planet(colonyPlanetId).resources.metal, 100);
        assertEq(game.shipCount(colonyPlanetId, Ship.SmallCargo), 0);

        vm.warp(returnAt);
        vm.prank(player);
        game.completeFleetMissionReturn(missionId);

        (status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returned));
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 1);
    }

    function testMissionSpeedChangesTravelTimeAndFuel() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Computer, 2);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 5);
        _setShipCount(originPlanetId, Ship.SmallCargo, 2);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.prank(player);
        uint256 fullSpeedMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            0
        );
        vm.prank(player);
        uint256 halfSpeedMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            50,
            0
        );

        (,,,,, uint64 fullDepartureAt, uint64 fullArrivalAt,, uint128 fullFuelCost,,) =
            game.fleetMission(fullSpeedMissionId);
        (,,,,, uint64 halfDepartureAt, uint64 halfArrivalAt,, uint128 halfFuelCost,,) =
            game.fleetMission(halfSpeedMissionId);

        assertGt(fullFuelCost, 1);
        assertLt(halfFuelCost, fullFuelCost);
        assertGt(halfArrivalAt - halfDepartureAt, fullArrivalAt - fullDepartureAt);
    }

    function testColonizeFleetMissionCreatesColonyOnResolution() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 2, 44, 8);
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 4);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(2, 44, 9),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 300, crystal: 200, deuterium: 100}),
            100,
            0
        );
        uint256 expectedDistance = 1_005;
        (, uint256 colonyFuelConsumption, uint256 colonySpeed) =
            VeydriftCatalog.shipMovementStats(Ship.ColonyShip, 0, 4, 0);
        uint256 expectedFuelCost = VeydriftAntiRaidPrimitives.missionFuelCost(
            colonyFuelConsumption,
            expectedDistance,
            VeydriftAntiRaidPrimitives.FULL_MISSION_SPEED_PERCENT
        );
        uint256 expectedTravelSeconds = VeydriftAntiRaidPrimitives.travelSeconds(
            expectedDistance,
            colonySpeed,
            VeydriftAntiRaidPrimitives.FULL_MISSION_SPEED_PERCENT,
            game.FLEET_UNIVERSE_SPEED()
        );

        (VeydriftGameStorage.FleetMissionStatus status, uint64 arrivalAt,,) =
            _fleetMission(missionId);
        (,,,,, uint64 departureAt,, uint64 returnAt, uint128 fuelCost,,) =
            game.fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        assertEq(fuelCost, expectedFuelCost);
        assertEq(arrivalAt - departureAt, expectedTravelSeconds);
        assertEq(returnAt - arrivalAt, expectedTravelSeconds);
        assertEq(game.shipCount(originPlanetId, Ship.ColonyShip), 0);
        assertEq(game.planet(originPlanetId).resources.metal, 9_700);
        assertEq(game.planet(originPlanetId).resources.crystal, 9_800);
        assertEq(game.planet(originPlanetId).resources.deuterium, 9_900 - expectedFuelCost);
        assertEq(game.planetCountOf(player), 1);

        vm.warp(arrivalAt);
        vm.prank(player);
        game.resolveFleetMission(missionId);

        (status,,,) = _fleetMission(missionId);
        uint256 colonyPlanetId = 2;
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertEq(game.activeFleetMissionCount(player), 0);
        assertEq(game.planetCountOf(player), 2);
        assertEq(game.planet(colonyPlanetId).owner, player);
        assertEq(game.planet(colonyPlanetId).galaxy, 2);
        assertEq(game.planet(colonyPlanetId).system, 44);
        assertEq(game.planet(colonyPlanetId).position, 9);
        assertEq(game.planet(colonyPlanetId).resources.metal, 300);
        assertEq(game.planet(colonyPlanetId).resources.crystal, 200);
        assertEq(game.planet(colonyPlanetId).resources.deuterium, 100);
    }

    function testColonizationReturnsIfCoordinatesBecomeOccupiedBeforeArrival() public {
        address competitor = address(0xC011);
        vm.deal(competitor, 1 ether);

        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(competitor);
        uint256 competitorPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 1, 1, 1);
        _setPlanetCoordinates(competitorPlanetId, 9, 400, 8);
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(competitor, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.Computer, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setShipCount(competitorPlanetId, Ship.ColonyShip, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(competitorPlanetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(9, 400, 9),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 300, crystal: 200, deuterium: 100}),
            10,
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);

        uint256 competitorColonyId = _settleColonizationMission(
            competitor,
            competitorPlanetId,
            9,
            400,
            9,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            _colonyShipManifest()
        );
        assertEq(game.planet(competitorColonyId).owner, competitor);

        uint256 nextPlanetIdBeforeFailedResolve = game.nextPlanetId();
        vm.warp(arrivalAt);
        vm.prank(player);
        game.resolveFleetMission(missionId);

        (VeydriftGameStorage.FleetMissionStatus status,, uint64 returnAt,) =
            _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(game.nextPlanetId(), nextPlanetIdBeforeFailedResolve);
        assertEq(game.activeFleetMissionCount(player), 1);

        uint128 metalBeforeReturn = game.planet(originPlanetId).resources.metal;
        uint128 crystalBeforeReturn = game.planet(originPlanetId).resources.crystal;
        vm.warp(returnAt);
        vm.prank(player);
        game.completeFleetMissionReturn(missionId);

        (status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returned));
        assertEq(game.shipCount(originPlanetId, Ship.ColonyShip), 1);
        assertEq(game.planet(originPlanetId).resources.metal, metalBeforeReturn + 300);
        assertEq(game.planet(originPlanetId).resources.crystal, crystalBeforeReturn + 200);
        assertEq(game.activeFleetMissionCount(player), 0);
    }

    function testColonizationReturnsIfPlanetLimitIsReachedBeforeArrival() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.Computer, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 2);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(9, 399, 8),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 400, crystal: 0, deuterium: 0}),
            10,
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);

        uint256 secondColonyId = _settleColonizationMission(
            player,
            originPlanetId,
            9,
            399,
            9,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            _colonyShipManifest()
        );
        assertEq(game.planet(secondColonyId).owner, player);
        assertEq(game.planetCountOf(player), 2);

        uint256 nextPlanetIdBeforeFailedResolve = game.nextPlanetId();
        vm.warp(arrivalAt);
        vm.prank(player);
        game.resolveFleetMission(missionId);

        (VeydriftGameStorage.FleetMissionStatus status,, uint64 returnAt,) =
            _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(game.nextPlanetId(), nextPlanetIdBeforeFailedResolve);
        assertEq(game.planetCountOf(player), 2);

        uint128 metalBeforeReturn = game.planet(originPlanetId).resources.metal;
        vm.warp(returnAt);
        vm.prank(player);
        game.completeFleetMissionReturn(missionId);

        (status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returned));
        assertEq(game.shipCount(originPlanetId, Ship.ColonyShip), 1);
        assertEq(game.planet(originPlanetId).resources.metal, metalBeforeReturn + 400);
        assertEq(game.activeFleetMissionCount(player), 0);
    }

    function testResourceSavingLaunchesBeforeIncomingAttackAndCannotBeLooted() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);
        vm.prank(player);
        uint256 attackerPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(defender, Technology.Astrophysics, 1);
        _setShipCount(targetPlanetId, Ship.ColonyShip, 1);

        uint256 safeColonyId = _createResolvedColony(defender, targetPlanetId, 162);

        _setShipCount(attackerPlanetId, Ship.SmallCargo, 1);
        _setShipCount(targetPlanetId, Ship.SmallCargo, 1);
        _setResources(attackerPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 0, 10_000);

        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            attackerPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            162
        );
        (, uint64 attackArrivalAt,,) = _fleetMission(attackMissionId);

        vm.prank(defender);
        uint256 saveMissionId = game.launchFleetMission(
            targetPlanetId,
            safeColonyId,
            VeydriftGameStorage.FleetMissionType.Transport,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 4_000, crystal: 0, deuterium: 0}),
            0
        );
        assertEq(game.planet(targetPlanetId).resources.metal, 6_000);

        vm.warp(attackArrivalAt);
        _fulfillAttackBattleRandomness(attackMissionId, 162);
        game.resolveFleetMission(attackMissionId);

        (,,, VeydriftGameStorage.Resources memory attackCargo) = _fleetMission(attackMissionId);
        assertEq(attackCargo.metal, 4_500);
        assertEq(game.planet(targetPlanetId).resources.metal, 1_500);

        (, uint64 saveArrivalAt, uint64 saveReturnAt,) = _fleetMission(saveMissionId);
        uint64 currentTestTime = attackArrivalAt;
        if (currentTestTime < saveArrivalAt) {
            vm.warp(saveArrivalAt);
            currentTestTime = saveArrivalAt;
        }
        game.resolveFleetMission(saveMissionId);
        assertEq(game.planet(safeColonyId).resources.metal, 4_000);
        assertEq(game.shipCount(safeColonyId, Ship.SmallCargo), 0);

        if (currentTestTime < saveReturnAt) vm.warp(saveReturnAt);
        vm.prank(defender);
        game.completeFleetMissionReturn(saveMissionId);
        assertEq(game.shipCount(targetPlanetId, Ship.SmallCargo), 1);
    }

    function testTransportDirectCallsCannotOverspendCargoOrBypassFuel() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.Computer, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);

        uint256 colonyPlanetId = _createResolvedColony(player, originPlanetId, 163);

        _setShipCount(originPlanetId, Ship.SmallCargo, 2);
        _setResources(originPlanetId, 6_000, 0, 10_000);

        vm.prank(player);
        game.launchFleetMission(
            originPlanetId,
            colonyPlanetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 4_000, crystal: 0, deuterium: 0}),
            0
        );
        assertEq(game.planet(originPlanetId).resources.metal, 2_000);
        uint128 remainingDeuterium = game.planet(originPlanetId).resources.deuterium;

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.InsufficientResources.selector, 2_000, 0, remainingDeuterium
            )
        );
        game.launchFleetMission(
            originPlanetId,
            colonyPlanetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 2_500, crystal: 0, deuterium: 0}),
            0
        );

        _setResources(originPlanetId, 0, 0, 0);
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.InsufficientResources.selector, 0, 0, 0)
        );
        game.launchFleetMission(
            originPlanetId,
            colonyPlanetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
    }

    function testAttackRejectsSameOwnerTargetPlanet() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        uint256 colonyPlanetId = _createResolvedColony(player, originPlanetId, 8);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.SelfAttack.selector);
        game.launchFleetMission(
            originPlanetId,
            colonyPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
    }

    function testAttackProtectionDetailsUseClassicScoreTiersInactivityAndHonorPlunder() public {
        vm.warp(8 days);
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _setTechnologyLevel(player, Technology.Computer, 2);
        _setShipCount(originPlanetId, Ship.SmallCargo, 200_000);
        _setShipCount(targetPlanetId, Ship.SmallCargo, 15_000);
        _setResources(originPlanetId, 1_000_000, 1_000_000, 1_000_000);
        _setResources(targetPlanetId, 100_000, 100_000, 100_000);

        (VeydriftGameStorage.AttackBlockReason reason, uint8 flags, uint16 plunderBps) =
            _attackProtectionStatus(player, targetPlanetId);
        assertEq(uint8(reason), uint8(VeydriftGameStorage.AttackBlockReason.ScoreProtection));
        assertEq(flags & ATTACK_RELATION_WEAKER_FLAG, ATTACK_RELATION_WEAKER_FLAG);
        assertEq(flags & ATTACK_BANDIT_FLAG, 0);
        assertEq(plunderBps, 5_000);
        assertEq(flags & ATTACK_INACTIVE_FLAG, 0);

        _setPlayerLastActiveAt(defender, 1);
        (reason, flags, plunderBps) = _attackProtectionStatus(player, targetPlanetId);
        assertEq(uint8(reason), uint8(VeydriftGameStorage.AttackBlockReason.None));
        assertEq(flags & ATTACK_INACTIVE_FLAG, ATTACK_INACTIVE_FLAG);

        _setHonorPoints(defender, -500);
        (reason, flags, plunderBps) = _attackProtectionStatus(player, targetPlanetId);
        assertEq(flags & ATTACK_BANDIT_FLAG, ATTACK_BANDIT_FLAG);
        assertEq(plunderBps, 10_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            123
        );
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
    }

    function testBashingLimitBlocksSeventhAttackUnlessDefenderIsInactive() public {
        vm.warp(8 days);
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _setTechnologyLevel(player, Technology.Computer, 10);
        _setShipCount(originPlanetId, Ship.SmallCargo, 8);
        _setResources(originPlanetId, 1_000_000, 1_000_000, 1_000_000);
        _setResources(targetPlanetId, 1_000_000, 1_000_000, 1_000_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        for (uint256 i = 0; i < VeydriftAntiRaidPrimitives.MAX_ATTACKS_PER_BASHING_WINDOW; i++) {
            vm.prank(player);
            game.launchFleetMission(
                originPlanetId,
                targetPlanetId,
                VeydriftGameStorage.FleetMissionType.Attack,
                ships,
                VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
                i
            );
        }

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.AttackBashingLimitReached.selector);
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            77
        );

        _setPlayerLastActiveAt(defender, 1);
        vm.prank(player);
        uint256 allowedMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            78
        );
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(allowedMissionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
    }

    function testAttackRejectsSameAllianceTargetPlanet() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        uint256 allianceId = _createAlliance(player);
        vm.prank(player);
        allianceSystem.inviteMember(allianceId, defender);
        vm.prank(defender);
        allianceSystem.acceptInvite(allianceId);

        _setTechnologyLevel(player, Technology.Computer, 1);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.SameAllianceAttack.selector);
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        (VeydriftGameStorage.AttackBlockReason reason,,) =
            _attackProtectionStatus(player, targetPlanetId);
        assertEq(uint8(reason), uint8(VeydriftGameStorage.AttackBlockReason.SameAlliance));
    }

    function testWarDiplomacyBypassesAttackBashingLimit() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        uint256 attackerAllianceId = _createAlliance(player);
        uint256 defenderAllianceId = _createAlliance(defender);
        vm.prank(player);
        allianceSystem.setDiplomacy(
            attackerAllianceId, defenderAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );

        _setTechnologyLevel(player, Technology.Computer, 7);
        _setShipCount(originPlanetId, Ship.SmallCargo, 7);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        for (uint256 index = 0; index < 7; index++) {
            vm.prank(player);
            game.launchFleetMission(
                originPlanetId,
                targetPlanetId,
                VeydriftGameStorage.FleetMissionType.Attack,
                _smallCargoManifest(),
                VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
                index
            );
        }

        (VeydriftGameStorage.AttackBlockReason reason,,) =
            _attackProtectionStatus(player, targetPlanetId);
        assertEq(uint8(reason), uint8(VeydriftGameStorage.AttackBlockReason.None));
        assertEq(game.activeFleetMissionCount(player), 7);
    }

    function testWarDiplomacyBypassesAttackScoreProtection() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        uint256 attackerAllianceId = _createAlliance(player);
        uint256 defenderAllianceId = _createAlliance(defender);
        vm.prank(player);
        allianceSystem.setDiplomacy(
            attackerAllianceId, defenderAllianceId, VeydriftAllianceSystem.DiplomacyStatus.War
        );

        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(originPlanetId, Ship.Deathstar, 2_000);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
    }

    function testUnsetAllianceSystemKeepsDefaultAttackProtection() public {
        vm.prank(admin);
        game.setAllianceSystem(address(0));

        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(originPlanetId, Ship.Deathstar, 2_000);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.AttackScoreProtection.selector);
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
    }

    function testDeployToSameOwnerTargetPlanetStillWorks() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        uint256 colonyPlanetId = _createResolvedColony(player, originPlanetId, 9);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            colonyPlanetId,
            VeydriftGameStorage.FleetMissionType.Deploy,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
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
        assertEq(game.shipCount(colonyPlanetId, Ship.SmallCargo), 1);
    }

    function testRenamePlanetIsContractBackedAndOwnerGated() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        vm.expectEmit(true, true, false, true);
        emit PlanetRenamed(player, planetId, "New Eos");
        game.renamePlanet(planetId, "New Eos");

        assertEq(game.planetNames(planetId), "New Eos");

        vm.prank(address(0xCAFE));
        vm.expectRevert(VeydriftGameStorage.NotPlanetOwner.selector);
        game.renamePlanet(planetId, "Stolen");

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.InvalidPlanetName.selector);
        game.renamePlanet(planetId, "");
    }

    function testAbandonColonyClearsOwnershipAndCoordinateOnlyWhenSafe() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);

        uint256 colonyPlanetId = _createResolvedColony(player, originPlanetId, 11);
        VeydriftGameStorage.Planet memory colony = game.planet(colonyPlanetId);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.CannotAbandonHomePlanet.selector);
        game.abandonPlanet(originPlanetId);

        _setResources(colonyPlanetId, 1, 0, 0);
        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.PlanetHasResources.selector);
        game.abandonPlanet(colonyPlanetId);
        _setResources(colonyPlanetId, 0, 0, 0);

        vm.prank(player);
        game.abandonPlanet(colonyPlanetId);

        assertEq(game.planetCountOf(player), 1);
        assertEq(game.planet(colonyPlanetId).owner, address(0));
        assertTrue(game.isCoordinateAvailable(colony.galaxy, colony.system, colony.position));
    }

    function testAbandonColonyRejectsActiveQueuesAndFleetMissions() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.Computer, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);

        uint256 colonyPlanetId = _createResolvedColony(player, originPlanetId, 12);

        _setResources(colonyPlanetId, 1_000, 1_000, 0);
        vm.prank(player);
        game.startBuildingUpgrade(colonyPlanetId, Building.MetalMine);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.PlanetHasActiveQueues.selector);
        game.abandonPlanet(colonyPlanetId);

        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(colonyPlanetId);
        vm.warp(construction.readyAt);
        vm.prank(player);
        game.finishBuildingUpgrade(colonyPlanetId);
        _setResources(colonyPlanetId, 0, 0, 0);

        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 100, 100, 100);
        vm.prank(player);
        game.launchFleetMission(
            originPlanetId,
            colonyPlanetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.PlanetHasActiveFleetMissions.selector);
        game.abandonPlanet(colonyPlanetId);
    }

    function testGenericFleetMissionLaunchRecallResolveAndReturn() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 1, 100, 8);
        _setPlanetCoordinates(targetPlanetId, 1, 100, 9);
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
        uint256 secondMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
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
        _fulfillAttackBattleRandomness(missionId, 1);
        _fulfillAttackBattleRandomness(secondMissionId, 2);
        game.resolveFleetMission(missionId);
        game.resolveFleetMission(missionId);
        game.resolveFleetMission(secondMissionId);

        (status,, returnAt,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        vm.warp(returnAt);
        game.completeFleetMissionReturn(missionId);
        assertEq(game.activeFleetMissionCount(player), 1);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 2);
        assertGt(game.planet(originPlanetId).resources.metal, 0);
    }

    function testDueUnresolvedAttackBlocksOnlyInvolvedStateUntilPublicResolution() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        address unrelated = address(0xCAFE);
        vm.deal(unrelated, 1 ether);

        _setTechnologyLevel(player, Technology.Computer, 1);
        _setTechnologyLevel(defender, Technology.Astrophysics, 1);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(targetPlanetId, Ship.SmallCargo, 1);
        _setShipCount(targetPlanetId, Ship.ColonyShip, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

        uint256 defenderColonyId = _createResolvedColony(defender, targetPlanetId, 160);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);

        vm.prank(defender);
        game.renamePlanet(targetPlanetId, "still reactive");

        vm.warp(arrivalAt);
        bytes memory pendingResolutionError =
            abi.encodeWithSelector(VeydriftGameStorage.FleetMissionNotResolved.selector, arrivalAt);

        vm.prank(defender);
        vm.expectRevert(pendingResolutionError);
        game.startBuildingUpgrade(targetPlanetId, Building.MetalMine);

        vm.prank(defender);
        vm.expectRevert(pendingResolutionError);
        game.startResearch(targetPlanetId, Technology.Energy);

        vm.prank(defender);
        vm.expectRevert(pendingResolutionError);
        game.startShipProduction(targetPlanetId, Ship.LightFighter, 1);

        vm.prank(defender);
        vm.expectRevert(pendingResolutionError);
        game.launchFleetMission(
            targetPlanetId,
            defenderColonyId,
            VeydriftGameStorage.FleetMissionType.Transport,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 1, crystal: 0, deuterium: 0}),
            0
        );

        vm.prank(player);
        vm.expectRevert(pendingResolutionError);
        game.recallFleetMission(missionId);

        vm.prank(unrelated);
        uint256 unrelatedPlanetId = game.startPlanet{value: 0.05 ether}();
        _setResources(unrelatedPlanetId, 10_000, 10_000, 10_000);
        vm.prank(unrelated);
        game.startBuildingUpgrade(unrelatedPlanetId, Building.MetalMine);

        _fulfillAttackBattleRandomness(missionId, 160);
        vm.prank(unrelated);
        game.resolveFleetMission(missionId);
        game.resolveFleetMission(missionId);

        vm.prank(defender);
        game.startBuildingUpgrade(targetPlanetId, Building.MetalMine);
    }

    function testFleetMissionStoresTimingAndDebitsFuelForMixedFleet() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 2);
        _setShipCount(originPlanetId, Ship.LightFighter, 3);
        _setShipCount(originPlanetId, Ship.LargeCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 5_000, 4_000, 3_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 2;
        ships.lightFighter = 3;
        ships.largeCargo = 1;

        uint256 distance = _planetDistanceForTest(originPlanetId, targetPlanetId);
        uint256 expectedTravelSeconds = VeydriftAntiRaidPrimitives.travelSeconds(distance, 5_000);
        uint128 expectedFuelCost =
            uint128(VeydriftAntiRaidPrimitives.missionFuelCost(130, distance));
        VeydriftGameStorage.Resources memory cargo =
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 11});

        uint256 departureAt = block.timestamp;
        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            cargo,
            0
        );

        (,,,,, uint64 storedDepartureAt, uint64 arrivalAt, uint64 returnAt, uint128 fuelCost,,) =
            game.fleetMission(missionId);

        assertEq(storedDepartureAt, departureAt);
        assertEq(arrivalAt, departureAt + expectedTravelSeconds);
        assertEq(returnAt, arrivalAt + expectedTravelSeconds);
        assertEq(fuelCost, expectedFuelCost);
        assertEq(game.planet(originPlanetId).resources.deuterium, 10_000 - expectedFuelCost - 11);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 0);
        assertEq(game.shipCount(originPlanetId, Ship.LightFighter), 0);
        assertEq(game.shipCount(originPlanetId, Ship.LargeCargo), 0);
    }

    function testGenericFleetMissionRecallAndRaidReturn() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);

        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 1, 100, 8);
        _setPlanetCoordinates(targetPlanetId, 1, 100, 9);
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
            VeydriftGameStorage.FleetMissionType.Attack,
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
        _fulfillAttackBattleRandomness(raidMissionId, 456);
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
        _setPlanetCoordinates(originPlanetId, 1, 100, 8);
        _setPlanetCoordinates(targetPlanetId, 1, 100, 9);
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
        emit FleetMissionCargo(1, 150, 25, 0, 4);
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
        _fulfillAttackBattleRandomness(missionId, 1);
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

    function testAttackBattleAttackerWinUsesClassicPlunderAndCargoLimitedLoot() public {
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
        _fulfillAttackBattleRandomness(missionId, 777);
        game.resolveFleetMission(missionId);

        VeydriftGameStorage.Resources memory cargo;
        (status,,, cargo) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(cargo.metal, 5_000);
        assertEq(cargo.crystal, 0);
        assertEq(cargo.deuterium, 0);
        assertEq(game.planet(targetPlanetId).resources.metal, 5_000);
        assertEq(game.planet(targetPlanetId).resources.crystal, 4_000);
        assertEq(game.planet(targetPlanetId).resources.deuterium, 3_000);
    }

    function testAttackBattleSmallBalancesRemainLootableByPlunderRate() public {
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
        _fulfillAttackBattleRandomness(missionId, 778);
        game.resolveFleetMission(missionId);

        (,,, VeydriftGameStorage.Resources memory cargo) = _fleetMission(missionId);
        assertEq(cargo.metal, 675);
        assertEq(cargo.crystal, 675);
        assertEq(cargo.deuterium, 675);
        assertEq(game.planet(targetPlanetId).resources.metal, 225);
    }

    function testRaidProtectionReadEntrypointsExposeProtectedRaidableAndMaxLoot() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.MetalStorage, 1);
        _setResources(planetId, 20_000, 20_000, 20_000);

        VeydriftGameStorage.Resources memory protected = game.protectedResources(planetId);
        assertEq(protected.metal, 0);
        assertEq(protected.crystal, 0);
        assertEq(protected.deuterium, 0);

        VeydriftGameStorage.Resources memory raidable = game.raidableResources(planetId);
        assertEq(raidable.metal, 20_000);
        assertEq(raidable.crystal, 20_000);
        assertEq(raidable.deuterium, 20_000);

        VeydriftGameStorage.Resources memory maxLoot = game.maxRaidLoot(planetId, 5_000);
        assertEq(maxLoot.metal, 5_000);
        assertEq(maxLoot.crystal, 0);
        assertEq(maxLoot.deuterium, 0);
    }

    function testFleetCounterplayRequiresAlliancePermission() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(targetPlanetId, Ship.LightFighter, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

        VeydriftGameStorage.MissionShips memory attackers;
        attackers.smallCargo = 1;
        vm.prank(player);
        uint256 hostileMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            attackers,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            801
        );

        VeydriftGameStorage.MissionShips memory defenders;
        defenders.lightFighter = 1;
        vm.prank(defender);
        vm.expectRevert(VeydriftGameStorage.InvalidQuantity.selector);
        game.launchFleetMission(
            targetPlanetId,
            hostileMissionId,
            VeydriftGameStorage.FleetMissionType.AcsDefend,
            defenders,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
    }

    function testFleetCounterplayAcsDefendJoinsCombatModuleResolution() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _createAlliance(defender);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(targetPlanetId, Ship.Battleship, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

        VeydriftGameStorage.MissionShips memory attackers;
        attackers.smallCargo = 1;
        vm.prank(player);
        uint256 hostileMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            attackers,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            802
        );

        VeydriftGameStorage.MissionShips memory defenders;
        defenders.battleship = 1;
        vm.prank(defender);
        uint256 counterplayMissionId = game.launchFleetMission(
            targetPlanetId,
            hostileMissionId,
            VeydriftGameStorage.FleetMissionType.AcsDefend,
            defenders,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        (, uint64 arrivalAt,,) = _fleetMission(hostileMissionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(hostileMissionId, 802);
        game.resolveFleetMission(hostileMissionId);

        (VeydriftGameStorage.FleetMissionStatus hostileStatus,,,) = _fleetMission(hostileMissionId);
        (VeydriftGameStorage.FleetMissionStatus counterStatus,, uint64 counterReturnAt,) =
            _fleetMission(counterplayMissionId);
        assertEq(uint8(hostileStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertEq(uint8(counterStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(game.planet(targetPlanetId).resources.metal, 10_000);

        vm.warp(counterReturnAt);
        game.completeFleetMissionReturn(counterplayMissionId);
        assertEq(game.shipCount(targetPlanetId, Ship.Battleship), 1);
    }

    function testFleetCounterplayLossesCreateDefenderDebris() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _createAlliance(defender);
        _setShipCount(originPlanetId, Ship.Deathstar, 1);
        _setShipCount(targetPlanetId, Ship.LightFighter, 1);
        _setResources(originPlanetId, 10_000_000, 10_000_000, 10_000_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

        VeydriftGameStorage.MissionShips memory attackers;
        attackers.deathstar = 1;
        vm.prank(player);
        uint256 hostileMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            attackers,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            802
        );

        VeydriftGameStorage.MissionShips memory defenders;
        defenders.lightFighter = 1;
        vm.prank(defender);
        uint256 counterplayMissionId = game.launchFleetMission(
            targetPlanetId,
            hostileMissionId,
            VeydriftGameStorage.FleetMissionType.AcsDefend,
            defenders,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        (, uint64 arrivalAt,,) = _fleetMission(hostileMissionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(hostileMissionId, 802);
        game.resolveFleetMission(hostileMissionId);

        (uint128 debrisMetal, uint128 debrisCrystal) = game.debrisField(targetPlanetId);
        assertEq(debrisMetal, 900);
        assertEq(debrisCrystal, 300);
        (VeydriftGameStorage.FleetMissionStatus counterStatus,,,) =
            _fleetMission(counterplayMissionId);
        assertEq(uint8(counterStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
    }

    function testAllianceDepotSuppliesAcsDefenseHoldingFuel() public {
        address defender = address(0xDEF);
        address ally = address(0xA17C);
        vm.deal(defender, 1 ether);
        vm.deal(ally, 1 ether);

        vm.prank(player);
        uint256 attackerPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(ally);
        uint256 allyPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(attackerPlanetId, 9, 499, 15);
        _setPlanetCoordinates(targetPlanetId, 1, 1, 1);
        _setPlanetCoordinates(allyPlanetId, 1, 1, 2);

        uint256 allianceId = _createAlliance(defender);
        vm.prank(defender);
        allianceSystem.inviteMember(allianceId, ally);
        vm.prank(ally);
        allianceSystem.acceptInvite(allianceId);

        _setBuildingLevel(targetPlanetId, Building.AllianceDepot, 1);
        _setShipCount(attackerPlanetId, Ship.SmallCargo, 1);
        _setShipCount(allyPlanetId, Ship.Battleship, 10);
        _setResources(attackerPlanetId, 10_000, 10_000, 10_000);
        _setResources(allyPlanetId, 10_000, 10_000, 50_000);
        _setResources(targetPlanetId, 10_000, 10_000, 50_000);

        vm.prank(player);
        uint256 hostileMissionId = game.launchFleetMission(
            attackerPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            812
        );

        VeydriftGameStorage.MissionShips memory defenders;
        defenders.battleship = 10;
        vm.prank(ally);
        uint256 counterplayMissionId = game.launchFleetMission(
            allyPlanetId,
            hostileMissionId,
            VeydriftGameStorage.FleetMissionType.AcsDefend,
            defenders,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        (,,,,, uint64 counterplayDepartureAt,, uint64 counterplayReturnAt, uint128 fuelCost,,) =
            game.fleetMission(counterplayMissionId);
        (,,,,,, uint64 hostileArrivalAt,,,,) = game.fleetMission(hostileMissionId);
        uint256 counterplayDistance = _planetDistanceForTest(allyPlanetId, targetPlanetId);
        uint256 counterplayTravelSeconds =
            VeydriftAntiRaidPrimitives.travelSeconds(counterplayDistance, 10_000);
        uint128 expectedTravelFuel =
            uint128(VeydriftAntiRaidPrimitives.missionFuelCost(5_000, counterplayDistance));
        uint256 holdSeconds =
            hostileArrivalAt - (uint256(counterplayDepartureAt) + counterplayTravelSeconds);
        uint128 expectedHoldingFuel = uint128((5_000 * holdSeconds + 10 hours - 1) / (10 hours));
        uint128 depotSupport = expectedHoldingFuel < 20_000 ? expectedHoldingFuel : 20_000;
        uint128 expectedFuelCost = expectedTravelFuel + expectedHoldingFuel - depotSupport;

        assertEq(counterplayReturnAt, hostileArrivalAt + counterplayTravelSeconds);
        assertEq(fuelCost, expectedFuelCost);
        assertEq(game.planet(allyPlanetId).resources.deuterium, 50_000 - expectedFuelCost);
        assertEq(game.planet(targetPlanetId).resources.deuterium, 50_000 - depotSupport);
    }

    function testFleetCounterplayInterceptJoinsCombatModuleResolution() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _createAlliance(defender);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(targetPlanetId, Ship.Battleship, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

        VeydriftGameStorage.MissionShips memory attackers;
        attackers.smallCargo = 1;
        vm.prank(player);
        uint256 hostileMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            attackers,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            803
        );

        VeydriftGameStorage.MissionShips memory interceptors;
        interceptors.battleship = 1;
        vm.prank(defender);
        uint256 counterplayMissionId = game.launchFleetMission(
            targetPlanetId,
            hostileMissionId,
            VeydriftGameStorage.FleetMissionType.Intercept,
            interceptors,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        (, uint64 arrivalAt,,) = _fleetMission(hostileMissionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(hostileMissionId, 803);
        game.resolveFleetMission(hostileMissionId);

        (VeydriftGameStorage.FleetMissionStatus hostileStatus,,,) = _fleetMission(hostileMissionId);
        (VeydriftGameStorage.FleetMissionStatus counterStatus,,,) =
            _fleetMission(counterplayMissionId);
        assertEq(uint8(hostileStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertEq(uint8(counterStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
    }

    function testFleetCounterplayCannotReturnBeforeHostileAttackResolution() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _createAlliance(defender);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(targetPlanetId, Ship.LightFighter, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

        VeydriftGameStorage.MissionShips memory attackers;
        attackers.smallCargo = 1;
        vm.prank(player);
        uint256 hostileMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            attackers,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            805
        );

        VeydriftGameStorage.MissionShips memory defenders;
        defenders.lightFighter = 1;
        vm.prank(defender);
        uint256 counterplayMissionId = game.launchFleetMission(
            targetPlanetId,
            hostileMissionId,
            VeydriftGameStorage.FleetMissionType.AcsDefend,
            defenders,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        (, uint64 arrivalAt,,) = _fleetMission(hostileMissionId);
        vm.warp(arrivalAt);
        game.resolveFleetMission(counterplayMissionId);
        (VeydriftGameStorage.FleetMissionStatus pendingCounterStatus,,,) =
            _fleetMission(counterplayMissionId);
        assertEq(
            uint8(pendingCounterStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound)
        );

        _fulfillAttackBattleRandomness(hostileMissionId, 805);
        game.resolveFleetMission(hostileMissionId);
        (VeydriftGameStorage.FleetMissionStatus counterStatus,,,) =
            _fleetMission(counterplayMissionId);
        assertEq(uint8(counterStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
    }

    function testFleetCounterplayRejectsTooLateArrival() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _createAlliance(defender);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(targetPlanetId, Ship.LightFighter, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

        VeydriftGameStorage.MissionShips memory attackers;
        attackers.smallCargo = 1;
        vm.prank(player);
        uint256 hostileMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            attackers,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            804
        );
        (, uint64 hostileArrivalAt,,) = _fleetMission(hostileMissionId);
        vm.warp(hostileArrivalAt - 1);

        VeydriftGameStorage.MissionShips memory defenders;
        defenders.lightFighter = 1;
        vm.prank(defender);
        vm.expectRevert(VeydriftGameStorage.FleetAlreadyArrived.selector);
        game.launchFleetMission(
            targetPlanetId,
            hostileMissionId,
            VeydriftGameStorage.FleetMissionType.AcsDefend,
            defenders,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
    }

    function testAcsAttackParticipantJoinsAndSplitsLootAndReturnsHome() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        address ally = address(0xA77A);
        vm.deal(ally, 1 ether);
        vm.prank(ally);
        uint256 allyPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 9, 499, 15);
        _setPlanetCoordinates(targetPlanetId, 1, 1, 1);
        _setPlanetCoordinates(allyPlanetId, 1, 1, 2);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(allyPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(allyPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 4_000, 3_000);

        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            900
        );
        vm.prank(ally);
        vm.expectEmit(true, true, true, true);
        emit AttackMissionJoined(
            attackMissionId, attackMissionId + 1, ally, allyPlanetId, targetPlanetId
        );
        uint256 joinedMissionId = game.joinAttackMission(
            allyPlanetId,
            attackMissionId,
            targetPlanetId,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
        );

        (, uint64 arrivalAt,,) = _fleetMission(attackMissionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(attackMissionId, 900);
        game.resolveFleetMission(attackMissionId);

        (
            VeydriftGameStorage.FleetMissionStatus attackStatus,,
            uint64 attackReturnAt,
            VeydriftGameStorage.Resources memory attackCargo
        ) = _fleetMission(attackMissionId);
        (
            VeydriftGameStorage.FleetMissionStatus joinedStatus,,
            uint64 joinedReturnAt,
            VeydriftGameStorage.Resources memory joinedCargo
        ) = _fleetMission(joinedMissionId);
        assertEq(uint8(attackStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(uint8(joinedStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(attackCargo.metal, 3_750);
        assertEq(attackCargo.crystal, 1_250);
        assertEq(attackCargo.deuterium, 0);
        assertEq(joinedCargo.metal, 3_750);
        assertEq(joinedCargo.crystal, 1_250);
        assertEq(joinedCargo.deuterium, 0);

        vm.warp(joinedReturnAt);
        game.completeFleetMissionReturn(joinedMissionId);
        assertEq(game.shipCount(allyPlanetId, Ship.SmallCargo), 1);
        assertEq(game.planet(allyPlanetId).resources.metal, 13_750);

        vm.warp(attackReturnAt);
        game.completeFleetMissionReturn(attackMissionId);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 1);
        assertEq(game.planet(originPlanetId).resources.metal, 13_750);
    }

    function testAcsAttackMultipleParticipantsSplitLootOnceInMissionOrder() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        address firstAlly = address(0xA771);
        address secondAlly = address(0xA772);
        vm.deal(firstAlly, 1 ether);
        vm.deal(secondAlly, 1 ether);
        vm.prank(firstAlly);
        uint256 firstAllyPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(secondAlly);
        uint256 secondAllyPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 9, 499, 15);
        _setPlanetCoordinates(targetPlanetId, 1, 1, 1);
        _setPlanetCoordinates(firstAllyPlanetId, 1, 1, 2);
        _setPlanetCoordinates(secondAllyPlanetId, 1, 1, 3);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(firstAllyPlanetId, Ship.SmallCargo, 1);
        _setShipCount(secondAllyPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(firstAllyPlanetId, 10_000, 10_000, 10_000);
        _setResources(secondAllyPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 30_000, 0, 10_000);

        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            905
        );
        vm.prank(firstAlly);
        uint256 firstJoinedMissionId = game.joinAttackMission(
            firstAllyPlanetId,
            attackMissionId,
            targetPlanetId,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
        );
        vm.prank(secondAlly);
        uint256 secondJoinedMissionId = game.joinAttackMission(
            secondAllyPlanetId,
            attackMissionId,
            targetPlanetId,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
        );

        (, uint64 arrivalAt,,) = _fleetMission(attackMissionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(attackMissionId, 905);
        game.resolveFleetMission(attackMissionId);

        (,,, VeydriftGameStorage.Resources memory attackCargo) = _fleetMission(attackMissionId);
        (,,, VeydriftGameStorage.Resources memory firstCargo) = _fleetMission(firstJoinedMissionId);
        (,,, VeydriftGameStorage.Resources memory secondCargo) =
            _fleetMission(secondJoinedMissionId);
        assertEq(attackCargo.metal, 5_000);
        assertEq(firstCargo.metal, 5_000);
        assertEq(secondCargo.metal, 5_000);
        assertEq(game.planet(targetPlanetId).resources.metal, 15_000);
    }

    function testAcsAttackRejectsLateJoinMismatchedTargetAndDirectAbuse() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        address ally = address(0xA77A);
        vm.deal(ally, 1 ether);
        vm.prank(ally);
        uint256 allyPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 9, 499, 15);
        _setPlanetCoordinates(targetPlanetId, 1, 1, 1);
        _setPlanetCoordinates(allyPlanetId, 1, 1, 2);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(allyPlanetId, Ship.SmallCargo, 2);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(allyPlanetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            901
        );

        vm.prank(ally);
        vm.expectRevert(VeydriftGameStorage.InvalidId.selector);
        game.joinAttackMission(
            allyPlanetId,
            attackMissionId,
            targetPlanetId + 1,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
        );

        vm.prank(ally);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.InvalidMissionType.selector,
                VeydriftGameStorage.FleetMissionType.AcsAttack
            )
        );
        game.launchFleetMission(
            allyPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.AcsAttack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        (, uint64 arrivalAt,,) = _fleetMission(attackMissionId);
        vm.warp(arrivalAt - game.FLEET_RECALL_CUTOFF_SECONDS());
        vm.prank(ally);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.AttackJoinCutoffPassed.selector,
                arrivalAt - VeydriftAntiRaidPrimitives.ACS_DEFEND_JOIN_CUTOFF_SECONDS
            )
        );
        game.joinAttackMission(
            allyPlanetId,
            attackMissionId,
            targetPlanetId,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
        );
    }

    function testAcsAttackParticipantCanRecallBeforePrimaryResolves() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        address ally = address(0xA77A);
        vm.deal(ally, 1 ether);
        vm.prank(ally);
        uint256 allyPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 9, 499, 15);
        _setPlanetCoordinates(targetPlanetId, 1, 1, 1);
        _setPlanetCoordinates(allyPlanetId, 1, 1, 2);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(allyPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(allyPlanetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            902
        );
        vm.prank(ally);
        uint256 joinedMissionId = game.joinAttackMission(
            allyPlanetId,
            attackMissionId,
            targetPlanetId,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
        );

        vm.warp(block.timestamp + 90 seconds);
        vm.prank(ally);
        game.recallFleetMission(joinedMissionId);

        (, uint64 attackArrivalAt,,) = _fleetMission(attackMissionId);
        vm.warp(attackArrivalAt);
        _fulfillAttackBattleRandomness(attackMissionId, 902);
        game.resolveFleetMission(attackMissionId);

        (VeydriftGameStorage.FleetMissionStatus joinedStatus,, uint64 joinedReturnAt,) =
            _fleetMission(joinedMissionId);
        assertEq(uint8(joinedStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Recalled));
        vm.warp(joinedReturnAt);
        game.completeFleetMissionReturn(joinedMissionId);
        assertEq(game.shipCount(allyPlanetId, Ship.SmallCargo), 1);
    }

    function testAcsAttackJoinedFleetContributesBattleStats() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        address ally = address(0xA77A);
        vm.deal(ally, 1 ether);
        vm.prank(ally);
        uint256 allyPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 9, 499, 15);
        _setPlanetCoordinates(targetPlanetId, 1, 1, 1);
        _setPlanetCoordinates(allyPlanetId, 1, 1, 2);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(allyPlanetId, Ship.Battleship, 100);
        _setDefenseCount(targetPlanetId, Defense.RocketLauncher, 100);
        _setResources(originPlanetId, 1_000_000, 1_000_000, 1_000_000);
        _setResources(allyPlanetId, 1_000_000, 1_000_000, 1_000_000);

        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            903
        );
        VeydriftGameStorage.MissionShips memory joinedShips;
        joinedShips.battleship = 100;
        vm.prank(ally);
        game.joinAttackMission(
            allyPlanetId,
            attackMissionId,
            targetPlanetId,
            joinedShips,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
        );

        (, uint64 arrivalAt,,) = _fleetMission(attackMissionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(attackMissionId, 903);
        uint256 gasBefore = gasleft();
        game.resolveFleetMission(attackMissionId);
        uint256 gasUsed = gasBefore - gasleft();

        assertLt(game.defenseCount(targetPlanetId, Defense.RocketLauncher), 100);
        assertLt(gasUsed, 25_000_000);
    }

    function testAcsAttackDefenderFireDoesNotDuplicateAcrossJoinedAttackGroups() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        address ally = address(0xA77B);
        vm.deal(ally, 1 ether);
        vm.prank(ally);
        uint256 allyPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 9, 499, 15);
        _setPlanetCoordinates(targetPlanetId, 1, 1, 1);
        _setPlanetCoordinates(allyPlanetId, 1, 1, 2);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(allyPlanetId, Ship.SmallCargo, 1);
        _setDefenseCount(targetPlanetId, Defense.PlasmaTurret, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(allyPlanetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            904
        );
        vm.prank(ally);
        uint256 joinedMissionId = game.joinAttackMission(
            allyPlanetId,
            attackMissionId,
            targetPlanetId,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
        );

        (, uint64 arrivalAt,,) = _fleetMission(attackMissionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(attackMissionId, 904);
        vm.recordLogs();
        game.resolveFleetMission(attackMissionId);

        assertGt(_attackBattleRoundsFromRecordedLogs(attackMissionId), 1);

        (VeydriftGameStorage.FleetMissionStatus attackStatus,,,) = _fleetMission(attackMissionId);
        (VeydriftGameStorage.FleetMissionStatus joinedStatus,,,) = _fleetMission(joinedMissionId);
        assertEq(uint8(attackStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertEq(uint8(joinedStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
    }

    function testAttackBattleJoinedShipKilledInRoundStillFiresFromRoundStartSnapshot() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        address ally = address(0xACED);
        vm.deal(ally, 1 ether);
        vm.prank(ally);
        uint256 allyPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 9, 499, 15);
        _setPlanetCoordinates(targetPlanetId, 1, 1, 1);
        _setPlanetCoordinates(allyPlanetId, 1, 1, 2);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(allyPlanetId, Ship.Deathstar, 1);
        _setDefenseCount(targetPlanetId, Defense.PlasmaTurret, 1_400);
        _setTechnologyLevel(player, Technology.Graviton, 270);
        _setTechnologyLevel(ally, Technology.Graviton, 270);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(allyPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

        VeydriftGameStorage.MissionShips memory primaryShips;
        primaryShips.smallCargo = 1;
        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            primaryShips,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            905
        );

        VeydriftGameStorage.MissionShips memory joinedShips;
        joinedShips.deathstar = 1;
        vm.prank(ally);
        uint256 joinedMissionId = game.joinAttackMission(
            allyPlanetId,
            attackMissionId,
            targetPlanetId,
            joinedShips,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
        );

        (, uint64 arrivalAt,,) = _fleetMission(attackMissionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(attackMissionId, 905);
        game.resolveFleetMission(attackMissionId);

        assertLt(game.defenseCount(targetPlanetId, Defense.PlasmaTurret), 1_400);
        (VeydriftGameStorage.FleetMissionStatus attackStatus,,,) = _fleetMission(attackMissionId);
        (VeydriftGameStorage.FleetMissionStatus joinedStatus,,,) = _fleetMission(joinedMissionId);
        assertEq(uint8(attackStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertEq(uint8(joinedStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
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
        _fulfillAttackBattleRandomness(missionId, 779);
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
        _fulfillAttackBattleRandomness(missionId, 780);
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
        _fulfillAttackBattleRandomness(missionId, 781);
        game.resolveFleetMission(missionId);

        assertLt(game.defenseCount(targetPlanetId, Defense.RocketLauncher), 100);
        assertEq(game.shipCount(originPlanetId, Ship.Battleship), 0);
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
    }

    function testAttackBattleRepairsClassicDefenseLossesAfterBattle() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.Battleship, 10);
        _setDefenseCount(targetPlanetId, Defense.RocketLauncher, 10);
        _setResources(originPlanetId, 1_000_000, 1_000_000, 1_000_000);
        _setResources(targetPlanetId, 1_000_000, 1_000_000, 1_000_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.battleship = 10;

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            782
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 782);
        game.resolveFleetMission(missionId);

        assertEq(game.defenseCount(targetPlanetId, Defense.RocketLauncher), 7);
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
    }

    function testAttackBattleSelectsTargetsByIndividualUnitsInsteadOfGroups() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.Battleship, 1);
        _setDefenseCount(targetPlanetId, Defense.RocketLauncher, 200);
        _setDefenseCount(targetPlanetId, Defense.LightLaser, 1);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);
        _setResources(targetPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.battleship = 1;

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            783
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 2);
        game.resolveFleetMission(missionId);

        assertEq(game.defenseCount(targetPlanetId, Defense.RocketLauncher), 199);
        assertEq(game.defenseCount(targetPlanetId, Defense.LightLaser), 1);
    }

    function testAttackBattleExpandsOneRandomWordIntoRapidfireStream() public {
        uint32 remaining =
            _resolveCruiserRocketFixture(address(0xA101), address(0xD101), 1, 100, 8, 101);

        assertLt(remaining, 49);
    }

    function testAttackBattleRapidfireBonusShotsRetargetMixedDefenders() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.Cruiser, 1);
        _setShipCount(targetPlanetId, Ship.LightFighter, 10);
        _setDefenseCount(targetPlanetId, Defense.RocketLauncher, 50);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);
        _setResources(targetPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.cruiser = 1;
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
        _fulfillAttackBattleRandomness(missionId, 404);
        game.resolveFleetMission(missionId);

        assertLt(game.shipCount(targetPlanetId, Ship.LightFighter), 10);
        assertLt(game.defenseCount(targetPlanetId, Defense.RocketLauncher), 50);
    }

    function testAttackBattleRapidfireRetargetsIntoAcsDefenderShips() public {
        bool observed;
        for (uint256 randomWord = 1; randomWord <= 128 && !observed;) {
            uint256 snapshot = vm.snapshotState();
            observed = _attackRapidfireRetargetsIntoAcsDefenderShips(randomWord);
            assertTrue(vm.revertToState(snapshot));
            unchecked {
                ++randomWord;
            }
        }

        assertTrue(observed);
    }

    function testFleetCounterplayRapidfireRetargetsAcrossAttackerPool() public {
        bool observed;
        for (uint256 randomWord = 1; randomWord <= 512 && !observed;) {
            uint256 snapshot = vm.snapshotState();
            observed = _counterplayRapidfireRetargetsAcrossAttackerPool(randomWord);
            assertTrue(vm.revertToState(snapshot));
            unchecked {
                ++randomWord;
            }
        }

        assertTrue(observed);
    }

    function testAttackBattleIgnoresCallerRandomnessRequestIdAndBlocksPendingOracle() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 4_000, 3_000);
        uint256 randomWord = 42;
        bytes32 commitment = randomness.randomnessCommitment(randomWord);
        vm.prank(admin);
        randomness.setPrecommitRequired(true);
        vm.prank(fulfiller);
        randomness.commitRandomness(commitment);
        vm.roll(block.number + 1);

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

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        (,,,,,,,,,, uint256 actualRequestId) = game.fleetMission(missionId);
        assertEq(actualRequestId, 1);
        assertNotEq(actualRequestId, requestId);

        bytes32 expectedPurposeHash =
            keccak256(abi.encode(game.ATTACK_BATTLE_DOMAIN(), block.chainid, missionId));
        RandomnessEngine.Request memory request = randomness.request(actualRequestId);
        assertEq(request.requester, address(game));
        assertEq(request.purposeHash, expectedPurposeHash);
        assertEq(request.randomnessCommitment, commitment);

        vm.warp(arrivalAt);
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.PendingRandomness.selector, actualRequestId)
        );
        game.resolveFleetMission(missionId);

        bytes32 wrongCommitment = randomness.randomnessCommitment(randomWord + 1);
        vm.startPrank(fulfiller);
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentMismatch.selector, commitment, wrongCommitment
            )
        );
        randomness.fulfillRandomness(actualRequestId, randomWord + 1);
        vm.stopPrank();

        vm.prank(fulfiller);
        randomness.fulfillRandomness(actualRequestId, randomWord);
        uint256 expectedSeed = uint256(
            keccak256(
                abi.encode(
                    game.ATTACK_BATTLE_DOMAIN(),
                    block.chainid,
                    missionId,
                    actualRequestId,
                    player,
                    targetPlanetId,
                    arrivalAt,
                    randomWord
                )
            )
        );
        vm.expectEmit(true, true, true, true, address(game));
        emit AttackBattleResolved(
            missionId,
            player,
            targetPlanetId,
            VeydriftGameStorage.BattleOutcome.AttackerWin,
            0,
            expectedSeed,
            5_000,
            0,
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

        uint128 expectedFuelCost = uint128(
            VeydriftAntiRaidPrimitives.missionFuelCost(
                10, _planetDistanceForTest(originPlanetId, targetPlanetId)
            )
        );
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.CargoCapacityExceeded.selector, 5_000, 5_001 + expectedFuelCost
            )
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

    function testAttackCreatesDebrisAndRecyclerHarvestReturnsCargo() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);

        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 1, 100, 8);
        _setPlanetCoordinates(targetPlanetId, 1, 100, 9);
        _setTechnologyLevel(player, Technology.Computer, 2);
        _setShipCount(originPlanetId, Ship.Destroyer, 1);
        _setShipCount(originPlanetId, Ship.Recycler, 2);
        _setShipCount(targetPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 200_000, 200_000, 200_000);

        VeydriftGameStorage.MissionShips memory attackShips;
        attackShips.destroyer = 1;
        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            attackShips,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
        (, uint64 attackArrivalAt,,) = _fleetMission(attackMissionId);
        vm.warp(attackArrivalAt);
        _fulfillAttackBattleRandomness(attackMissionId, 1);
        game.resolveFleetMission(attackMissionId);

        (uint128 debrisMetal, uint128 debrisCrystal) = game.debrisField(targetPlanetId);
        assertGt(debrisMetal, 0);
        assertGt(debrisCrystal, 0);
        uint256 outcomeId =
            moons.moonChanceOutcomeByBattle(keccak256(abi.encode(attackMissionId, targetPlanetId)));
        if (uint256(debrisMetal) + debrisCrystal >= 100_000) {
            assertGt(outcomeId, 0);
        }

        VeydriftGameStorage.MissionShips memory harvestShips;
        harvestShips.recycler = 2;
        vm.prank(player);
        uint256 harvestMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Harvest,
            harvestShips,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
        (, uint64 harvestArrivalAt, uint64 harvestReturnAt,) = _fleetMission(harvestMissionId);
        vm.warp(harvestArrivalAt);
        game.resolveFleetMission(harvestMissionId);
        (,,, VeydriftGameStorage.Resources memory harvestedCargo) = _fleetMission(harvestMissionId);
        assertGt(harvestedCargo.metal + harvestedCargo.crystal, 0);
        (uint128 remainingDebrisMetal, uint128 remainingDebrisCrystal) =
            game.debrisField(targetPlanetId);
        assertLt(remainingDebrisMetal + remainingDebrisCrystal, debrisMetal + debrisCrystal);

        vm.warp(harvestReturnAt);
        game.completeFleetMissionReturn(harvestMissionId);
        assertEq(game.shipCount(originPlanetId, Ship.Recycler), 2);
    }

    function testRecyclerHarvestSplitsMetalAndCrystalEvenlyBeforeRemainder() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.Recycler, 1);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);
        _setDebrisField(targetPlanetId, 40_000, 15_000);

        VeydriftGameStorage.MissionShips memory harvestShips;
        harvestShips.recycler = 1;
        vm.prank(player);
        uint256 harvestMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Harvest,
            harvestShips,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
        (, uint64 harvestArrivalAt,,) = _fleetMission(harvestMissionId);
        vm.warp(harvestArrivalAt);
        game.resolveFleetMission(harvestMissionId);

        (,,, VeydriftGameStorage.Resources memory harvestedCargo) = _fleetMission(harvestMissionId);
        assertEq(harvestedCargo.metal, 10_000);
        assertEq(harvestedCargo.crystal, 10_000);
        (uint128 remainingDebrisMetal, uint128 remainingDebrisCrystal) =
            game.debrisField(targetPlanetId);
        assertEq(remainingDebrisMetal, 30_000);
        assertEq(remainingDebrisCrystal, 5_000);
    }

    function testFuzzMoonChanceIsBoundedByDebrisEconomics(
        uint128 metalDebris,
        uint128 crystalDebris
    ) public view {
        uint256 debris = uint256(metalDebris) + crystalDebris;
        uint256 debrisUnits = debris / moons.MOON_CHANCE_DEBRIS_UNIT();
        uint256 expected = debrisUnits * 100;
        if (expected > moons.MAX_MOON_CHANCE_BPS()) expected = moons.MAX_MOON_CHANCE_BPS();

        uint16 chanceBps = moons.moonChanceBps(metalDebris, crystalDebris);
        assertEq(chanceBps, expected);
        assertLe(chanceBps, moons.MAX_MOON_CHANCE_BPS());
    }

    function testQualifyingAttackCreatesMoonChanceAndFinalizesAfterRandomness() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);

        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 1, 100, 8);
        _setPlanetCoordinates(targetPlanetId, 1, 100, 9);
        _setShipCount(originPlanetId, Ship.Battleship, 100);
        _setShipCount(targetPlanetId, Ship.LightFighter, 120);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory attackShips;
        attackShips.battleship = 100;
        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            attackShips,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
        (, uint64 attackArrivalAt,,) = _fleetMission(attackMissionId);
        vm.warp(attackArrivalAt);
        _fulfillAttackBattleRandomness(attackMissionId, 2);
        game.resolveFleetMission(attackMissionId);

        (uint128 debrisMetal, uint128 debrisCrystal) = game.debrisField(targetPlanetId);
        uint256 outcomeId =
            moons.moonChanceOutcomeByBattle(keccak256(abi.encode(attackMissionId, targetPlanetId)));
        assertGt(outcomeId, 0);

        (
            uint256 battleId,
            uint256 reportedTargetPlanetId,
            address reportedDefender,
            uint16 chanceBps,,,
        ) = moons.moonChanceResult(outcomeId);
        (uint256 requestId,, bool finalized,) = moons.moonChanceRandomness(outcomeId);
        assertEq(battleId, attackMissionId);
        assertEq(reportedTargetPlanetId, targetPlanetId);
        assertEq(reportedDefender, defender);
        assertEq(chanceBps, moons.moonChanceBps(debrisMetal, debrisCrystal));
        assertFalse(finalized);

        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, 7);
        moons.finalizeMoonChance(outcomeId);

        assertTrue(moons.moon(targetPlanetId).exists);
        (,, finalized,) = moons.moonChanceRandomness(outcomeId);
        (,,,, bool moonCreated,,) = moons.moonChanceResult(outcomeId);
        assertTrue(finalized);
        assertTrue(moonCreated);
    }

    function testNonQualifyingAttackDoesNotCreateMoonChance() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);

        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 1, 100, 8);
        _setPlanetCoordinates(targetPlanetId, 1, 100, 9);
        _setShipCount(originPlanetId, Ship.LightFighter, 1);
        _setShipCount(targetPlanetId, Ship.LightFighter, 1);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory attackShips;
        attackShips.lightFighter = 1;
        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            attackShips,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
        (, uint64 attackArrivalAt,,) = _fleetMission(attackMissionId);
        vm.warp(attackArrivalAt);
        _fulfillAttackBattleRandomness(attackMissionId, 3);
        game.resolveFleetMission(attackMissionId);

        (uint128 debrisMetal, uint128 debrisCrystal) = game.debrisField(targetPlanetId);
        assertLt(uint256(debrisMetal) + debrisCrystal, 100_000);
        assertEq(
            moons.moonChanceOutcomeByBattle(keccak256(abi.encode(attackMissionId, targetPlanetId))),
            0
        );
    }

    function testQualifyingAttackAgainstExistingMoonRecordsSkip() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);

        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        moons.createMoon(targetPlanetId);
        _setPlanetCoordinates(originPlanetId, 1, 100, 8);
        _setPlanetCoordinates(targetPlanetId, 1, 100, 9);
        _setShipCount(originPlanetId, Ship.Battleship, 100);
        _setShipCount(targetPlanetId, Ship.LightFighter, 120);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory attackShips;
        attackShips.battleship = 100;
        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            attackShips,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
        (, uint64 attackArrivalAt,,) = _fleetMission(attackMissionId);
        vm.warp(attackArrivalAt);
        _fulfillAttackBattleRandomness(attackMissionId, 4);
        game.resolveFleetMission(attackMissionId);

        assertEq(
            moons.moonChanceOutcomeByBattle(keccak256(abi.encode(attackMissionId, targetPlanetId))),
            type(uint256).max
        );
    }

    function testRecyclerHarvestRejectsEmptyDebris() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);

        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setShipCount(originPlanetId, Ship.Recycler, 1);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory harvestShips;
        harvestShips.recycler = 1;
        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.DebrisFieldEmpty.selector);
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Harvest,
            harvestShips,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
    }

    function testAttackForwardsCombatLossesToConfiguredSpaceDock() public {
        address defender = address(0xDEF);
        vm.deal(defender, 1 ether);
        VeydriftSpaceDockSystem spaceDock = new VeydriftSpaceDockSystem(address(game), admin);

        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 1, 100, 8);
        _setPlanetCoordinates(targetPlanetId, 1, 100, 9);
        _setShipCount(originPlanetId, Ship.Destroyer, 40);
        _setShipCount(targetPlanetId, Ship.LightFighter, 40);
        _setResources(originPlanetId, 5_000_000, 5_000_000, 5_000_000);
        vm.prank(admin);
        spaceDock.setSpaceDockLevel(targetPlanetId, 1);
        vm.prank(admin);
        spaceDock.transferOwnership(address(game));
        vm.prank(admin);
        game.setSpaceDockSystem(address(spaceDock));

        VeydriftGameStorage.MissionShips memory attackShips;
        attackShips.destroyer = 40;
        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            attackShips,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 5);
        game.resolveFleetMission(missionId);

        assertGt(spaceDock.repairableShipCount(targetPlanetId, Ship.LightFighter), 0);
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

    function testMissionEntrypointsRejectDirectBypassesForNonOwnerUnsupportedMissionAndRecallOwner()
        public
    {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.prank(defender);
        vm.expectRevert(VeydriftGameStorage.NotPlanetOwner.selector);
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
                VeydriftGameStorage.InvalidMissionType.selector,
                VeydriftGameStorage.FleetMissionType.MissileAttack
            )
        );
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.MissileAttack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

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

        vm.prank(defender);
        vm.expectRevert(VeydriftGameStorage.FleetNotOwner.selector);
        game.recallFleetMission(missionId);

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.FleetNotArrived.selector, arrivalAt)
        );
        game.resolveFleetMission(missionId);
    }

    function testMissionReturnKeeperCannotCreditBeforeReturnAndCreditsOriginalOwner() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        address keeper = address(0xA11CE5);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

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
        _fulfillAttackBattleRandomness(missionId, 6);
        vm.prank(defender);
        game.resolveFleetMission(missionId);

        (VeydriftGameStorage.FleetMissionStatus status,, uint64 returnAt,) =
            _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));

        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.FleetNotArrived.selector, returnAt)
        );
        game.completeFleetMissionReturn(missionId);

        vm.warp(returnAt);
        vm.prank(keeper);
        game.completeFleetMissionReturn(missionId);

        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 1);
        assertEq(game.shipCount(targetPlanetId, Ship.SmallCargo), 0);
        assertEq(game.activeFleetMissionCount(player), 0);
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

    function testRiftBridgeIsBinaryPerPlanet() public {
        vm.prank(player);
        uint256 homePlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setShipCount(homePlanetId, Ship.ColonyShip, 1);

        uint256 colonyPlanetId = _createResolvedColony(player, homePlanetId, 8);

        _setBuildingLevel(homePlanetId, Building.InterdimensionalRiftStabilizer, 1);
        _setResources(homePlanetId, 1_000, 1_000, 1_000);
        _setResources(colonyPlanetId, 1_000, 1_000, 1_000);

        metalToken.mint(player, 1_000);
        vm.prank(player);
        metalToken.approve(address(game), 1_000);

        vm.prank(player);
        game.depositMarketResource(homePlanetId, Resource.Metal, 100);
        assertEq(game.planet(homePlanetId).resources.metal, 1_100);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.RiftStabilizerRequired.selector, colonyPlanetId
            )
        );
        game.depositMarketResource(colonyPlanetId, Resource.Metal, 100);

        _setBuildingLevel(colonyPlanetId, Building.InterdimensionalRiftStabilizer, 1);
        vm.prank(player);
        game.depositMarketResource(colonyPlanetId, Resource.Metal, 100);
        assertEq(game.planet(colonyPlanetId).resources.metal, 1_100);
    }

    function testRiftBridgeCannotBeUpgradedPastBuilt() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.InterdimensionalRiftStabilizer, 1);
        _setResources(planetId, 100_000, 100_000, 100_000);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.LevelTooHigh.selector);
        game.startBuildingUpgrade(planetId, Building.InterdimensionalRiftStabilizer);
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

    function testColonyCallsEnforcePlanetLimitBeforeLaunch() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftGameStorage.PlanetLimitReached.selector, 1));
        game.launchFleetMission(
            planetId,
            _colonizationTargetId(2, 44, 9),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            0
        );
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

    function _seedTerraformerPrerequisites(uint256 planetId) internal {
        _setBuildingLevel(planetId, Building.NaniteFactory, 1);
        _setTechnologyLevel(player, Technology.Energy, 12);
    }

    function _fillUsedFields(uint256 planetId, uint256 targetUsed) internal {
        uint256 remaining = targetUsed;
        uint16 naniteLevel = game.buildingLevel(planetId, Building.NaniteFactory);
        require(remaining >= naniteLevel, "nanite exceeds target");
        remaining -= naniteLevel;

        remaining = _fillBuildingFields(planetId, Building.MetalMine, remaining);
        remaining = _fillBuildingFields(planetId, Building.CrystalMine, remaining);
        remaining = _fillBuildingFields(planetId, Building.DeuteriumSynthesizer, remaining);
        remaining = _fillBuildingFields(planetId, Building.SolarPlant, remaining);
        remaining = _fillBuildingFields(planetId, Building.RoboticsFactory, remaining);
        remaining = _fillBuildingFields(planetId, Building.Shipyard, remaining);
        remaining = _fillBuildingFields(planetId, Building.ResearchLab, remaining);
        remaining = _fillBuildingFields(planetId, Building.MetalStorage, remaining);
        remaining = _fillBuildingFields(planetId, Building.CrystalStorage, remaining);
        remaining = _fillBuildingFields(planetId, Building.DeuteriumTank, remaining);
        remaining = _fillBuildingFields(planetId, Building.FusionReactor, remaining);
        remaining = _fillBuildingFields(planetId, Building.AllianceDepot, remaining);
        remaining = _fillBuildingFields(planetId, Building.MissileSilo, remaining);

        assertEq(remaining, 0);
    }

    function _fillBuildingFields(uint256 planetId, Building building, uint256 remaining)
        internal
        returns (uint256)
    {
        if (remaining == 0) return 0;
        uint16 level = uint16(remaining > 50 ? 50 : remaining);
        _setBuildingLevel(planetId, building, level);
        return remaining - level;
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
        _setPlanetCoordinates(originPlanetId, 1, 100, 8);
        _setPlanetCoordinates(targetPlanetId, 1, 100, 9);
    }

    function _resolveCruiserRocketFixture(
        address attacker,
        address defender,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        uint256 randomWord
    ) internal returns (uint32 remainingRocketLaunchers) {
        vm.deal(attacker, 1 ether);
        vm.deal(defender, 1 ether);
        vm.prank(attacker);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, galaxy, system, position);
        _setPlanetCoordinates(targetPlanetId, galaxy, system, position + 1);
        _setShipCount(originPlanetId, Ship.Cruiser, 1);
        _setDefenseCount(targetPlanetId, Defense.RocketLauncher, 50);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);
        _setResources(targetPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.cruiser = 1;
        vm.prank(attacker);
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
        _fulfillAttackBattleRandomness(missionId, randomWord);
        game.resolveFleetMission(missionId);
        return game.defenseCount(targetPlanetId, Defense.RocketLauncher);
    }

    function _attackRapidfireRetargetsIntoAcsDefenderShips(uint256 randomWord)
        internal
        returns (bool)
    {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _createAlliance(defender);
        _setShipCount(originPlanetId, Ship.Battlecruiser, 10);
        _setShipCount(targetPlanetId, Ship.HeavyFighter, 100);
        _setShipCount(targetPlanetId, Ship.Battleship, 1);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);
        _setResources(targetPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory attackers;
        attackers.battlecruiser = 10;
        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            attackers,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            randomWord
        );

        VeydriftGameStorage.MissionShips memory defenders;
        defenders.battleship = 1;
        vm.prank(defender);
        uint256 counterplayMissionId = game.launchFleetMission(
            targetPlanetId,
            attackMissionId,
            VeydriftGameStorage.FleetMissionType.AcsDefend,
            defenders,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        uint256 seed = _battleSeedForTest(attackMissionId, player, targetPlanetId, randomWord);
        uint256 baseShotsToCounterplay = _distributedTargetShotsForTest(
            10, 1, 101, seed, 1, 4, uint8(Ship.Battlecruiser), 24 + uint8(Ship.Battleship)
        );
        if (baseShotsToCounterplay != 0) return false;

        (, uint64 arrivalAt,,) = _fleetMission(attackMissionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(attackMissionId, randomWord);
        game.resolveFleetMission(attackMissionId);

        (VeydriftGameStorage.FleetMissionStatus counterStatus,,,) =
            _fleetMission(counterplayMissionId);
        return counterStatus == VeydriftGameStorage.FleetMissionStatus.Resolved;
    }

    function _counterplayRapidfireRetargetsAcrossAttackerPool(uint256 randomWord)
        internal
        returns (bool)
    {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _createAlliance(defender);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(originPlanetId, Ship.LightFighter, 40);
        _setShipCount(targetPlanetId, Ship.Cruiser, 1);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);
        _setResources(targetPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory attackers;
        attackers.smallCargo = 1;
        attackers.lightFighter = 40;
        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            attackers,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            randomWord
        );

        VeydriftGameStorage.MissionShips memory defenders;
        defenders.cruiser = 1;
        vm.prank(defender);
        game.launchFleetMission(
            targetPlanetId,
            attackMissionId,
            VeydriftGameStorage.FleetMissionType.AcsDefend,
            defenders,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        uint256 seed = _battleSeedForTest(attackMissionId, player, targetPlanetId, randomWord);
        uint256 baseShotsToSmallCargo = _distributedTargetShotsForTest(
            1, 1, 41, seed, 1, 3, uint8(Ship.Cruiser), uint8(Ship.SmallCargo)
        );
        if (baseShotsToSmallCargo != 0) return false;

        (, uint64 arrivalAt,,) = _fleetMission(attackMissionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(attackMissionId, randomWord);
        game.resolveFleetMission(attackMissionId);

        (VeydriftGameStorage.FleetMissionStatus attackStatus,, uint64 returnAt,) =
            _fleetMission(attackMissionId);
        if (attackStatus == VeydriftGameStorage.FleetMissionStatus.Returning) {
            vm.warp(returnAt);
            game.completeFleetMissionReturn(attackMissionId);
        }
        return game.shipCount(originPlanetId, Ship.SmallCargo) == 0;
    }

    function _battleSeedForTest(
        uint256 missionId,
        address owner,
        uint256 targetPlanetId,
        uint256 randomWord
    ) internal view returns (uint256) {
        (,,,,,, uint64 arrivalAt,,,, uint256 requestId) = game.fleetMission(missionId);
        return uint256(
            keccak256(
                abi.encode(
                    TEST_ATTACK_BATTLE_DOMAIN,
                    block.chainid,
                    missionId,
                    requestId,
                    owner,
                    targetPlanetId,
                    arrivalAt,
                    randomWord
                )
            )
        );
    }

    function _distributedTargetShotsForTest(
        uint256 shots,
        uint32 targetCount,
        uint256 targetTotal,
        uint256 seed,
        uint8 round,
        uint8 side,
        uint8 firingUnit,
        uint256 targetUnit
    ) internal pure returns (uint256 assigned) {
        uint256 weightedShots = shots * targetCount;
        assigned = weightedShots / targetTotal;
        if (
            uint256(
                        keccak256(
                            abi.encode(
                                TEST_COMBAT_STREAM_DOMAIN,
                                seed,
                                round,
                                side,
                                firingUnit,
                                targetUnit,
                                0
                            )
                        )
                    ) % targetTotal < weightedShots % targetTotal
        ) {
            assigned += 1;
        }
    }

    function _seedMissileAttackPlanets()
        internal
        returns (uint256 originPlanetId, uint256 targetPlanetId, address defender)
    {
        (originPlanetId, targetPlanetId, defender) = _seedAttackPlanets();
        _setPlanetCoordinates(originPlanetId, 1, 100, 8);
        _setPlanetCoordinates(targetPlanetId, 1, 104, 8);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 1);
    }

    function _createAlliance(address leader) internal returns (uint256 allianceId) {
        vm.prank(leader);
        allianceId = allianceSystem.createAlliance("DEF", "Defenders", "ipfs://defenders");
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

    function _setPlayerLastActiveAt(address account, uint64 lastActiveAt) internal {
        bytes32 slot = keccak256(abi.encode(account, uint256(34)));
        vm.store(address(game), slot, bytes32(uint256(lastActiveAt)));
    }

    function _setHonorPoints(address account, int256 points) internal {
        bytes32 slot = keccak256(abi.encode(account, uint256(35)));
        // forge-lint: disable-next-line(unsafe-typecast)
        vm.store(address(game), slot, bytes32(uint256(points)));
    }

    function _attackProtectionStatus(address account, uint256 targetPlanetId)
        internal
        view
        returns (VeydriftGameStorage.AttackBlockReason reason, uint8 flags, uint16 plunderBps)
    {
        (bool ok, bytes memory data) = address(game)
            .staticcall(
                abi.encodeWithSelector(
                    game.attackProtectionStatus.selector, account, targetPlanetId
                )
            );
        assertTrue(ok);
        (reason, flags, plunderBps) =
            abi.decode(data, (VeydriftGameStorage.AttackBlockReason, uint8, uint16));
    }

    function _setShipCount(uint256 planetId, Ship ship, uint32 count) internal {
        bytes32 outerSlot = keccak256(abi.encode(planetId, uint256(22)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(ship)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(count)));
    }

    function _setPlanetCoordinates(uint256 planetId, uint16 galaxy, uint16 system, uint8 position)
        internal
    {
        VeydriftGameStorage.Planet memory planetRef = game.planet(planetId);
        uint256 planetBase = uint256(keccak256(abi.encode(planetId, uint256(4))));
        uint256 slot0 = uint256(uint160(planetRef.owner)) | (uint256(galaxy) << 160)
            | (uint256(system) << 176) | (uint256(position) << 192)
            | (uint256(planetRef.fields) << 200) | (uint256(uint16(planetRef.temperature)) << 216)
            | (uint256(planetRef.metalMultiplierBps) << 232);
        uint256 slot1 = uint256(planetRef.crystalMultiplierBps)
            | (uint256(planetRef.deuteriumMultiplierBps) << 16)
            | (uint256(planetRef.lastSettledAt) << 32);
        vm.store(address(game), bytes32(planetBase), bytes32(slot0));
        vm.store(address(game), bytes32(planetBase + 1), bytes32(slot1));
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

    function _setDebrisField(uint256 planetId, uint128 metal, uint128 crystal) internal {
        bytes32 slot = keccak256(abi.encode(planetId, uint256(27)));
        vm.store(address(game), slot, _packResourcesHead(metal, crystal));
    }

    function _lightFighterManifest()
        internal
        pure
        returns (VeydriftGameStorage.MissionShips memory ships)
    {
        ships.lightFighter = 1;
    }

    function _smallCargoManifest()
        internal
        pure
        returns (VeydriftGameStorage.MissionShips memory ships)
    {
        ships.smallCargo = 1;
    }

    function _colonyShipManifest()
        internal
        pure
        returns (VeydriftGameStorage.MissionShips memory ships)
    {
        ships.colonyShip = 1;
    }

    function _settleColonizationMission(
        address account,
        uint256 originPlanetId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        VeydriftGameStorage.Resources memory cargo,
        VeydriftGameStorage.MissionShips memory ships
    ) internal returns (uint256 colonyPlanetId) {
        colonyPlanetId = game.nextPlanetId();
        vm.prank(account);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(galaxy, system, position),
            VeydriftGameStorage.FleetMissionType.Colonize,
            ships,
            cargo,
            100,
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        vm.prank(account);
        game.resolveFleetMission(missionId);
    }

    function _colonizationTargetId(uint16 galaxy, uint16 system, uint8 position)
        internal
        pure
        returns (uint256)
    {
        return (uint256(1) << 255) | (uint256(galaxy) << 24) | (uint256(system) << 8)
            | uint256(position);
    }

    function _nextColonyCoordinates(address account, uint256 salt)
        internal
        view
        returns (uint16 galaxy, uint16 system, uint8 position)
    {
        for (uint256 attempt = 0; attempt < 64; attempt++) {
            bytes32 seed = keccak256(
                abi.encode(
                    game.PLANET_SEED_DOMAIN(),
                    block.chainid,
                    account,
                    salt,
                    game.planetCountOf(account),
                    attempt
                )
            );
            galaxy = uint16((uint256(seed) % game.MAX_GALAXY()) + 1);
            system = uint16(((uint256(seed) >> 16) % game.MAX_SYSTEM()) + 1);
            position = uint8(((uint256(seed) >> 32) % game.MAX_POSITION()) + 1);
            if (!game.occupiedCoordinates(game.coordinateKey(galaxy, system, position))) {
                return (galaxy, system, position);
            }
        }
        revert("coordinates exhausted");
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

    function _attackBattleRoundsFromRecordedLogs(uint256 missionId)
        internal
        view
        returns (uint8 rounds)
    {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bytes32 battleResolvedTopic = keccak256(
            "AttackBattleResolved(uint256,address,uint256,uint8,uint8,uint256,uint128,uint128,uint128)"
        );
        for (uint256 i = 0; i < entries.length;) {
            if (
                entries[i].topics.length != 0 && entries[i].topics[0] == battleResolvedTopic
                    && uint256(entries[i].topics[1]) == missionId
            ) {
                (, rounds,,,,) = abi.decode(
                    entries[i].data,
                    (VeydriftGameStorage.BattleOutcome, uint8, uint256, uint128, uint128, uint128)
                );
                return rounds;
            }
            unchecked {
                ++i;
            }
        }
        revert("AttackBattleResolved not recorded");
    }

    function _fulfillAttackBattleRandomness(uint256 missionId, uint256 randomWord) internal {
        (, VeydriftGameStorage.FleetMissionType missionType,,,,,,,,, uint256 requestId) =
            game.fleetMission(missionId);
        if (missionType != VeydriftGameStorage.FleetMissionType.Attack) return;

        RandomnessEngine.Request memory request = randomness.request(requestId);
        if (request.fulfilledAt != 0) return;

        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, randomWord);
    }

    function _planetDistanceForTest(uint256 originPlanetId, uint256 destinationPlanetId)
        internal
        view
        returns (uint256)
    {
        VeydriftGameStorage.Planet memory origin = game.planet(originPlanetId);
        VeydriftGameStorage.Planet memory destination = game.planet(destinationPlanetId);
        uint256 galaxyDistance = origin.galaxy > destination.galaxy
            ? uint256(origin.galaxy - destination.galaxy)
            : uint256(destination.galaxy - origin.galaxy);
        if (galaxyDistance != 0) return galaxyDistance * 20_000;
        uint256 systemDistance = origin.system > destination.system
            ? uint256(origin.system - destination.system)
            : uint256(destination.system - origin.system);
        if (systemDistance != 0) return 2_700 + systemDistance * 95;
        uint256 positionDistance = origin.position > destination.position
            ? uint256(origin.position - destination.position)
            : uint256(destination.position - origin.position);
        if (positionDistance != 0) return 1_000 + positionDistance * 5;
        return 0;
    }

    function _createResolvedColony(address account, uint256 originPlanetId, uint256 salt)
        internal
        returns (uint256 colonyPlanetId)
    {
        VeydriftGameStorage.Planet memory origin = game.planet(originPlanetId);
        (uint16 galaxy, uint16 system, uint8 position) =
            _nearbyColonyCoordinates(originPlanetId, salt);
        colonyPlanetId = game.nextPlanetId();
        _setResources(originPlanetId, 100_000, 100_000, 100_000);
        if (origin.galaxy == galaxy && origin.system == system && origin.position == position) {
            position = position == 1 ? 2 : position - 1;
        }
        return _settleColonizationMission(
            account,
            originPlanetId,
            galaxy,
            system,
            position,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            _colonyShipManifest()
        );
    }

    function _nearbyColonyCoordinates(uint256 originPlanetId, uint256 salt)
        internal
        view
        returns (uint16 galaxy, uint16 system, uint8 position)
    {
        VeydriftGameStorage.Planet memory origin = game.planet(originPlanetId);
        galaxy = origin.galaxy;
        system = origin.system;

        uint256 maxPosition = game.MAX_POSITION();
        for (uint256 offset = 1; offset < maxPosition; offset++) {
            uint8 candidatePosition =
                uint8(((uint256(origin.position) + salt + offset - 1) % maxPosition) + 1);
            if (
                candidatePosition != origin.position
                    && !game.occupiedCoordinates(
                        game.coordinateKey(galaxy, system, candidatePosition)
                    )
            ) {
                return (galaxy, system, candidatePosition);
            }
        }

        uint256 maxSystem = game.MAX_SYSTEM();
        for (uint256 systemOffset = 1; systemOffset < maxSystem; systemOffset++) {
            uint16 candidateSystem =
                uint16(((uint256(origin.system) + systemOffset - 1) % maxSystem) + 1);
            for (uint256 positionOffset = 0; positionOffset < maxPosition; positionOffset++) {
                uint8 candidatePosition = uint8(((salt + positionOffset) % maxPosition) + 1);
                if (!game.occupiedCoordinates(
                        game.coordinateKey(galaxy, candidateSystem, candidatePosition)
                    )) {
                    return (galaxy, candidateSystem, candidatePosition);
                }
            }
        }

        revert("nearby coordinates exhausted");
    }

    function _packResourcesHead(uint128 metal, uint128 crystal) internal pure returns (bytes32) {
        return bytes32((uint256(crystal) << 128) | uint256(metal));
    }

    function _fundGameReserves(uint256 amount) internal {
        _fundGameReserves(game, metalToken, crystalToken, deuteriumToken, amount);
    }

    function _newGame(address owner) internal returns (VeydriftGame) {
        VeydriftCombatModule combatModule =
            new VeydriftCombatModule(address(new VeydriftCombatRapidfire()));
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftAttackProtectionModule attackProtectionModule = new VeydriftAttackProtectionModule();
        VeydriftColonizationModule colonizationModule = new VeydriftColonizationModule();
        return new VeydriftGame(
            owner,
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule)
        );
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
