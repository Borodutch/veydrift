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

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
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

contract VeydriftGameTest is Test {
    uint128 internal constant RESERVE_FUNDING = 1_000_000_000_000;
    bytes32 internal constant DEP_SHIPYARD_2 = "SHIPYARD_2";
    bytes32 internal constant DEP_WEAPONS_3 = "WEAPONS_3";
    bytes32 internal constant DEP_MISSILE_SILO_4 = "MISSILE_SILO_4";

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

    function testReadAbiReturnsEmptyMvpState() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        assertEq(game.buildingLevel(planetId, Building.MetalMine), 0);
        assertEq(game.defenseCost(Defense.RocketLauncher).metal, 2_000);
        assertEq(game.defenseCost(Defense.IonCannon).metal, 5_000);
        assertEq(game.defenseCost(Defense.IonCannon).crystal, 3_000);
        assertEq(game.defenseCount(planetId, Defense.RocketLauncher), 0);
        assertEq(game.shipCount(planetId, Ship.SmallCargo), 0);
        assertEq(game.technologyLevel(player, Technology.Energy), 0);
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
        assertEq(nextCost.metal, 120);
        assertEq(nextCost.crystal, 30);
        assertEq(nextCost.deuterium, 0);
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
        assertEq(VeydriftFormulas.unitDuration(1, 0, 2_000, 0, 1, 60), 1_440);
        assertEq(VeydriftFormulas.unitDuration(1, 2, 2_000, 0, 1, 60), 360);
        assertEq(VeydriftFormulas.unitDuration(8, 0, 1_500, 500, 1, 60), 320);
    }

    function testDefenseProductionEnforcesDomeAndMissileCaps() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _seedDefensePrerequisites(planetId);
        _setResources(planetId, 5_000_000, 5_000_000, 5_000_000);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGame.DefenseLimitReached.selector, Defense.SmallShieldDome
            )
        );
        game.startDefenseProduction(planetId, Defense.SmallShieldDome, 2);

        _buildDefense(planetId, Defense.SmallShieldDome, 1);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGame.DefenseLimitReached.selector, Defense.SmallShieldDome
            )
        );
        game.startDefenseProduction(planetId, Defense.SmallShieldDome, 1);

        _buildDefense(planetId, Defense.InterplanetaryMissile, 20);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGame.MissileSiloCapacityExceeded.selector, 41, 40)
        );
        game.startDefenseProduction(planetId, Defense.AntiBallisticMissile, 1);
    }

    function testAdvancedGameplayModulesFailExplicitly() public {
        vm.expectRevert(VeydriftGame.UnsupportedGameplayModule.selector);
        game.depositMarketResource(1, Resource.Metal, 1);
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

    function _buildDefense(uint256 planetId, Defense defense, uint32 quantity) internal {
        vm.prank(player);
        game.startDefenseProduction(planetId, defense, quantity);
        VeydriftGame.DefenseQueue memory queue = game.defenseQueue(planetId);
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

    function _setResources(uint256 planetId, uint128 metal, uint128 crystal, uint128 deuterium)
        internal
    {
        uint256 planetBase = uint256(keccak256(abi.encode(planetId, uint256(4))));
        vm.store(address(game), bytes32(planetBase + 2), _packResourcesHead(metal, crystal));
        vm.store(address(game), bytes32(planetBase + 3), bytes32(uint256(deuterium)));
        vm.store(address(game), bytes32(uint256(14)), _packResourcesHead(metal, crystal));
        vm.store(address(game), bytes32(uint256(15)), bytes32(uint256(deuterium)));
    }

    function _packResourcesHead(uint128 metal, uint128 crystal) internal pure returns (bytes32) {
        return bytes32((uint256(crystal) << 128) | uint256(metal));
    }

    function _fundGameReserves(uint256 amount) internal {
        metalToken.mint(address(game), amount);
        crystalToken.mint(address(game), amount);
        deuteriumToken.mint(address(game), amount);

        vm.prank(admin);
        game.setResourceTokens(address(metalToken), address(crystalToken), address(deuteriumToken));
    }
}
