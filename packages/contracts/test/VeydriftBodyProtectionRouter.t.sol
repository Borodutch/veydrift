// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftFirstPlanetSettlementModule} from "../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftShipProductionModule} from "../src/VeydriftShipProductionModule.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {Ship, Technology} from "../src/libraries/VeydriftTypes.sol";

contract RouterMockResourceToken {
    mapping(address account => uint256 balance) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

contract VeydriftBodyProtectionRouterTest is Test {
    address private constant ADMIN = address(0xA11CE);
    address private constant PLAYER = address(0xB0B);
    address private constant DEFENDER = address(0xDEF);
    address private constant ALLY = address(0xA77A);
    address private constant FULFILLER = address(0xF111);

    VeydriftGame private game;
    VeydriftMoonSystem private moons;
    RandomnessEngine private randomness;

    function setUp() public {
        randomness = new RandomnessEngine(ADMIN, FULFILLER);
        vm.prank(ADMIN);
        randomness.setPrecommitRequired(false);

        VeydriftCombatModule combatModule =
            new VeydriftCombatModule(address(new VeydriftCombatRapidfire()));
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftGame implementation = new VeydriftGame(
            ADMIN,
            address(new VeydriftFirstPlanetSettlementModule(address(0xBEEF))),
            address(gameplayModule),
            address(new VeydriftPlanetManagementModule()),
            address(new VeydriftAttackProtectionModule()),
            address(new VeydriftColonizationModule(address(new VeydriftShipProductionModule()))),
            address(new VeydriftDefenseHoldModule()),
            address(new VeydriftStateMigrationModule(address(0xBEEF)))
        );
        game = VeydriftGame(
            address(
                new ERC1967Proxy(
                    address(implementation), abi.encodeCall(VeydriftGame.initialize, (ADMIN))
                )
            )
        );
        moons = new VeydriftMoonSystem(address(game), address(randomness));
        RouterMockResourceToken metalToken = new RouterMockResourceToken();
        RouterMockResourceToken crystalToken = new RouterMockResourceToken();
        RouterMockResourceToken deuteriumToken = new RouterMockResourceToken();
        metalToken.mint(address(game), 1_000_000_000);
        crystalToken.mint(address(game), 1_000_000_000);
        deuteriumToken.mint(address(game), 1_000_000_000);

        vm.prank(ADMIN);
        game.setResourceTokens(address(metalToken), address(crystalToken), address(deuteriumToken));
        vm.prank(ADMIN);
        game.setMoonSystem(address(moons));
        vm.prank(ADMIN);
        game.setRandomnessEngine(address(randomness));
        vm.prank(ADMIN);
        randomness.setRequesterAuthorization(address(game), true);
    }

    function testPlanetToMoonLaunchAndMoonOriginAcsJoinRouteThroughGameProxy() public {
        uint256 originPlanetId = _startPlanet(PLAYER);
        uint256 targetPlanetId = _startPlanet(DEFENDER);
        uint256 allyPlanetId = _startPlanet(ALLY);
        _setPlanetLocation(originPlanetId, PLAYER, 1, 100, 8);
        _setPlanetLocation(targetPlanetId, DEFENDER, 1, 100, 9);
        _setPlanetLocation(allyPlanetId, ALLY, 1, 100, 8);
        moons.createMoon(targetPlanetId);
        moons.createMoon(allyPlanetId);

        _fundPlanet(originPlanetId, 20_000, 20_000, 20_000);
        _fundMoon(allyPlanetId, 20_000, 20_000, 20_000);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        moons.setMoonShipCount(allyPlanetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(PLAYER);
        uint256 attackMissionId = game.launchBodyFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            false,
            true
        );

        vm.prank(ALLY);
        uint256 joinedMissionId = game.joinBodyAttackMission(
            allyPlanetId,
            attackMissionId,
            targetPlanetId,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            true
        );

        (VeydriftGameStorage.FleetMissionStatus attackStatus,,,,,,,,,,) =
            game.fleetMission(attackMissionId);
        (VeydriftGameStorage.FleetMissionStatus joinedStatus,,,,,,,,,,) =
            game.fleetMission(joinedMissionId);
        assertEq(uint8(attackStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        assertEq(uint8(joinedStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        assertEq(game.moonShipCount(allyPlanetId, Ship.SmallCargo), 0);
    }

    function testGameProxyRejectsPublicBodyProtectionEnforcement() public {
        vm.prank(PLAYER);
        (bool ok, bytes memory data) = address(game)
            .staticcall(abi.encodeWithSelector(bytes4(0xcc4cc1ea), PLAYER, uint256(1), true));

        assertFalse(ok);
        assertEq(data, abi.encodeWithSelector(VeydriftGameStorage.Unauthorized.selector, PLAYER));
    }

    function testPlanetToMoonLaunchThroughGameProxyKeepsScoreProtection() public {
        uint256 originPlanetId = _startPlanet(PLAYER);
        uint256 targetPlanetId = _startPlanet(DEFENDER);
        _setPlanetLocation(originPlanetId, PLAYER, 1, 100, 8);
        _setPlanetLocation(targetPlanetId, DEFENDER, 1, 100, 9);
        moons.createMoon(targetPlanetId);
        _fundPlanet(originPlanetId, 20_000, 20_000, 20_000);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setTechnologyLevel(PLAYER, Technology.Graviton, 100);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(PLAYER);
        vm.expectRevert(VeydriftGameStorage.AttackScoreProtection.selector);
        game.launchBodyFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            false,
            true
        );
    }

    function _startPlanet(address player) private returns (uint256 planetId) {
        vm.deal(player, 1 ether);
        vm.prank(player);
        planetId = game.startPlanet{value: 0.05 ether}();
    }

    function _setPlanetLocation(
        uint256 planetId,
        address owner,
        uint16 galaxy,
        uint16 system,
        uint8 position
    ) private {
        VeydriftGameStorage.Planet memory planetRef = game.planet(planetId);
        uint256 planetBase = uint256(keccak256(abi.encode(planetId, uint256(4))));
        uint256 packed = uint256(uint160(owner)) | (uint256(galaxy) << 160)
            | (uint256(system) << 176) | (uint256(position) << 192)
            | (uint256(planetRef.fields) << 200) | (uint256(uint16(planetRef.temperature)) << 216)
            | (uint256(planetRef.metalMultiplierBps) << 232);
        vm.store(address(game), bytes32(planetBase), bytes32(packed));
        uint256 packedMultipliers = uint256(planetRef.crystalMultiplierBps)
            | (uint256(planetRef.deuteriumMultiplierBps) << 16)
            | (uint256(planetRef.lastSettledAt) << 32);
        vm.store(address(game), bytes32(planetBase + 1), bytes32(packedMultipliers));
    }

    function _fundPlanet(uint256 planetId, uint128 metal, uint128 crystal, uint128 deuterium)
        private
    {
        bytes32 packedMetalCrystal = bytes32(uint256(metal) | (uint256(crystal) << 128));
        uint256 planetBase = uint256(keccak256(abi.encode(planetId, uint256(4))));
        vm.store(address(game), bytes32(planetBase + 2), packedMetalCrystal);
        vm.store(address(game), bytes32(planetBase + 3), bytes32(uint256(deuterium)));
        vm.store(address(game), bytes32(uint256(14)), packedMetalCrystal);
        vm.store(address(game), bytes32(uint256(15)), bytes32(uint256(deuterium)));
    }

    function _fundMoon(uint256 planetId, uint128 metal, uint128 crystal, uint128 deuterium)
        private
    {
        bytes32 packedMetalCrystal = bytes32(uint256(metal) | (uint256(crystal) << 128));
        bytes32 slot = keccak256(abi.encode(planetId, uint256(46)));
        vm.store(address(game), slot, packedMetalCrystal);
        vm.store(address(game), bytes32(uint256(slot) + 1), bytes32(uint256(deuterium)));
        vm.store(address(game), bytes32(uint256(14)), packedMetalCrystal);
        vm.store(address(game), bytes32(uint256(15)), bytes32(uint256(deuterium)));
    }

    function _setShipCount(uint256 planetId, Ship ship, uint32 count) private {
        bytes32 outerSlot = keccak256(abi.encode(planetId, uint256(22)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(ship)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(count)));
    }

    function _setTechnologyLevel(address player, Technology technology, uint16 level) private {
        bytes32 outerSlot = keccak256(abi.encode(player, uint256(20)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(technology)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(level)));
    }
}
