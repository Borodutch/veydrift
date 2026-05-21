// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftCombatModule} from "../src/VeydriftCombatModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {MoonBuilding, Resource, Technology} from "../src/libraries/VeydriftTypes.sol";

contract MoonMockResourceToken {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved < amount || balanceOf[from] < amount) return false;
        allowance[from][msg.sender] = approved - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract VeydriftMoonSystemTest is Test {
    uint128 internal constant RESERVE_FUNDING = 1_000_000_000_000;
    bytes32 internal constant LUNAR_BASE_1_DEPENDENCY = "LUNAR_BASE_1";

    address internal admin = address(0xA11CE);
    address internal player = address(0xB0B);
    VeydriftGame internal game;
    VeydriftMoonSystem internal moons;
    MoonMockResourceToken internal metalToken;
    MoonMockResourceToken internal crystalToken;
    MoonMockResourceToken internal deuteriumToken;

    function setUp() public {
        game = new VeydriftGame(
            admin, address(new VeydriftGameplayModule(address(new VeydriftCombatModule())))
        );
        moons = new VeydriftMoonSystem(address(game));
        metalToken = new MoonMockResourceToken();
        crystalToken = new MoonMockResourceToken();
        deuteriumToken = new MoonMockResourceToken();
        metalToken.mint(address(game), RESERVE_FUNDING);
        crystalToken.mint(address(game), RESERVE_FUNDING);
        deuteriumToken.mint(address(game), RESERVE_FUNDING);
        vm.prank(admin);
        game.setResourceTokens(address(metalToken), address(crystalToken), address(deuteriumToken));
        vm.prank(admin);
        game.setMoonSystem(address(moons));
        vm.deal(player, 1 ether);
    }

    function testMoonCreationAndLunarBaseFields() public {
        uint256 planetId = _startPlanet();

        vm.prank(player);
        VeydriftMoonSystem.Moon memory moon = moons.createMoon(planetId);
        assertTrue(moon.exists);
        assertEq(moon.planetId, planetId);
        assertEq(moon.owner, player);
        assertEq(moon.fields, 1);
        assertGe(moon.diameterKm, 3_400);
        assertLe(moon.diameterKm, 8_500);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftMoonSystem.MoonAlreadyExists.selector, planetId)
        );
        moons.createMoon(planetId);

        VeydriftGameStorage.Resources memory cost =
            moons.moonBuildingUpgradeCost(planetId, MoonBuilding.LunarBase);
        assertEq(cost.metal, 20_000);
        assertEq(cost.crystal, 40_000);
        assertEq(cost.deuterium, 20_000);

        _fundPlanet(planetId, 100_000, 100_000, 100_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.LunarBase), 1);
        assertEq(moons.moon(planetId).fields, 4);
    }

    function testMoonBuildingUpgradeSpendsPlanetResources() public {
        uint256 planetId = _startPlanet();

        vm.prank(player);
        moons.createMoon(planetId);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.InsufficientResources.selector, 500, 500, 0)
        );
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.LunarBase);

        _fundPlanet(planetId, 100_000, 100_000, 100_000);
        vm.prank(player);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.LunarBase);

        VeydriftGameStorage.Planet memory planet = game.planet(planetId);
        assertEq(planet.resources.metal, 80_000);
        assertEq(planet.resources.crystal, 60_000);
        assertEq(planet.resources.deuterium, 80_000);

        VeydriftGameStorage.Resources memory cost =
            moons.moonBuildingUpgradeCost(planetId, MoonBuilding.LunarBase);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftGameStorage.Unauthorized.selector, player));
        game.spendMoonResources(planetId, cost);
    }

    function testSensorPhalanxRequiresLunarBaseAndScansRange() public {
        uint256 planetId = _startPlanet();

        vm.prank(player);
        moons.createMoon(planetId);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftMoonSystem.MissingDependency.selector, LUNAR_BASE_1_DEPENDENCY
            )
        );
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.SensorPhalanx);

        _fundPlanet(planetId, 1_000_000, 1_000_000, 1_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.SensorPhalanx);
        _buildMoon(planetId, MoonBuilding.SensorPhalanx);
        assertEq(moons.sensorPhalanxRange(planetId), 3);

        VeydriftGameStorage.Planet memory planet = game.planet(planetId);
        uint16 nearSystem = planet.system <= 497 ? planet.system + 2 : planet.system - 2;
        uint16 farSystem = planet.system <= 495 ? planet.system + 4 : planet.system - 4;

        vm.prank(player);
        moons.scanSystem(planetId, planet.galaxy, nearSystem);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftMoonSystem.SensorPhalanxOutOfRange.selector, planet.system, farSystem, 3
            )
        );
        moons.scanSystem(planetId, planet.galaxy, farSystem);
    }

    function testJumpGateRequiresOwnedReadyMoonGates() public {
        uint256 planetId = _startPlanet();
        uint256 secondPlanetId = 2;
        _setPlanetOwner(secondPlanetId, player);
        _setTechnologyLevel(player, Technology.Hyperspace, 7);

        vm.prank(player);
        moons.createMoon(planetId);
        _fundPlanet(planetId, 3_000_000, 5_000_000, 3_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.JumpGate);

        vm.prank(player);
        moons.createMoon(secondPlanetId);
        _fundPlanet(secondPlanetId, 3_000_000, 5_000_000, 3_000_000);
        _buildMoon(secondPlanetId, MoonBuilding.LunarBase);
        _buildMoon(secondPlanetId, MoonBuilding.JumpGate);

        vm.prank(player);
        moons.jumpGateJump(planetId, secondPlanetId);
        uint64 readyAt = moons.moon(planetId).jumpGateReadyAt;
        assertEq(readyAt, moons.moon(secondPlanetId).jumpGateReadyAt);
        assertEq(readyAt, block.timestamp + 1 hours);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftMoonSystem.JumpGateNotReady.selector, planetId, readyAt)
        );
        moons.jumpGateJump(planetId, secondPlanetId);
    }

    function _startPlanet() internal returns (uint256 planetId) {
        vm.prank(player);
        planetId = game.startPlanet{value: 0.05 ether}();
    }

    function _buildMoon(uint256 planetId, MoonBuilding building) internal {
        vm.prank(player);
        moons.startMoonBuildingUpgrade(planetId, building);
        VeydriftMoonSystem.MoonBuildingConstruction memory construction =
            moons.activeMoonBuildingConstruction(planetId);
        vm.warp(construction.readyAt);
        vm.prank(player);
        moons.finishMoonBuildingUpgrade(planetId);
    }

    function _setPlanetOwner(uint256 planetId, address owner) internal {
        uint256 planetBase = uint256(keccak256(abi.encode(planetId, uint256(4))));
        vm.store(address(game), bytes32(planetBase), bytes32(uint256(uint160(owner))));
    }

    function _fundPlanet(uint256 planetId, uint128 metal, uint128 crystal, uint128 deuterium)
        internal
    {
        bytes32 packedMetalCrystal = bytes32(uint256(metal) | (uint256(crystal) << 128));
        bytes32 deuteriumWord = bytes32(uint256(deuterium));
        uint256 planetBase = uint256(keccak256(abi.encode(planetId, uint256(4))));

        vm.store(address(game), bytes32(planetBase + 2), packedMetalCrystal);
        vm.store(address(game), bytes32(planetBase + 3), deuteriumWord);
        vm.store(address(game), bytes32(uint256(14)), packedMetalCrystal);
        vm.store(address(game), bytes32(uint256(15)), deuteriumWord);
    }

    function _setTechnologyLevel(address account, Technology technology, uint16 level) internal {
        bytes32 outerSlot = keccak256(abi.encode(account, uint256(20)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(technology)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(level)));
    }
}
