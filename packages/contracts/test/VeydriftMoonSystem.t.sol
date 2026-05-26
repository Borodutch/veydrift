// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {VeydriftCombatModule} from "../src/VeydriftCombatModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
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
    address internal fulfiller = address(0xF111);
    address internal reporter = address(0xBABB1E);
    VeydriftGame internal game;
    RandomnessEngine internal randomness;
    VeydriftMoonSystem internal moons;
    MoonMockResourceToken internal metalToken;
    MoonMockResourceToken internal crystalToken;
    MoonMockResourceToken internal deuteriumToken;

    event MoonChanceRequested(
        uint256 indexed outcomeId,
        uint256 indexed battleId,
        uint256 indexed targetPlanetId,
        address defender,
        uint128 metalDebris,
        uint128 crystalDebris,
        uint16 chanceBps,
        uint256 randomnessRequestId,
        bytes32 purposeHash
    );
    event MoonChanceFinalized(
        uint256 indexed outcomeId,
        uint256 indexed battleId,
        uint256 indexed targetPlanetId,
        uint16 chanceBps,
        bool moonCreated,
        uint256 randomWord,
        uint16 moonFields,
        uint16 moonDiameterKm
    );

    function setUp() public {
        randomness = new RandomnessEngine(admin, fulfiller);
        VeydriftCombatModule combatModule = new VeydriftCombatModule();
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        game = new VeydriftGame(admin, address(gameplayModule), address(planetManagementModule));
        moons = new VeydriftMoonSystem(address(game), address(randomness));
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
        vm.prank(admin);
        randomness.setRequesterAuthorization(address(moons), true);
        moons.setMoonChanceReporter(reporter);
        vm.deal(player, 1 ether);
    }

    function testDirectPlayerMoonCreationReverts() public {
        uint256 planetId = _startPlanet();

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftMoonSystem.NotOwner.selector, player));
        moons.createMoon(planetId);
        assertFalse(moons.moon(planetId).exists);
    }

    function testAdminMoonCreationAndLunarBaseFields() public {
        uint256 planetId = _startPlanet();

        VeydriftMoonSystem.Moon memory moon = moons.createMoon(planetId);
        assertTrue(moon.exists);
        assertEq(moon.planetId, planetId);
        assertEq(moon.owner, player);
        assertGe(moon.fields, 1);
        assertLe(moon.fields, 3);
        assertGe(moon.diameterKm, 3_400);
        assertLe(moon.diameterKm, 8_500);

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
        assertEq(moons.moon(planetId).fields, moon.fields + 3);
    }

    function testMoonChanceCalculationAndCap() public view {
        assertEq(moons.moonChanceBps(99_999, 0), 0);
        assertEq(moons.moonChanceBps(100_000, 0), 100);
        assertEq(moons.moonChanceBps(750_000, 250_000), 1_000);
        assertEq(moons.moonChanceBps(3_000_000, 0), 2_000);
    }

    function testBattleMoonChanceRequestsRandomnessAndBlocksPendingOutcome() public {
        uint256 planetId = _startPlanet();
        bytes32 purposeHash = moons.moonChancePurposeHash(1, 77, planetId, 1_500_000, 0, 1_500);

        vm.expectEmit(true, true, true, true, address(moons));
        emit MoonChanceRequested(1, 77, planetId, player, 1_500_000, 0, 1_500, 1, purposeHash);
        vm.prank(reporter);
        (uint256 outcomeId, uint256 requestId) =
            moons.requestMoonChanceFromBattle(77, planetId, 1_500_000, 0);

        (uint256 battleId, uint256 targetPlanetId, address defender, uint16 chanceBps,,,) =
            moons.moonChanceResult(outcomeId);
        (uint256 storedRequestId, bytes32 storedPurposeHash, bool finalized,) =
            moons.moonChanceRandomness(outcomeId);
        RandomnessEngine.Request memory request = randomness.request(requestId);
        assertEq(battleId, 77);
        assertEq(targetPlanetId, planetId);
        assertEq(defender, player);
        assertEq(chanceBps, 1_500);
        assertEq(storedRequestId, requestId);
        assertFalse(finalized);
        assertEq(request.requester, address(moons));
        assertEq(request.purposeHash, storedPurposeHash);

        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.PendingRandomness.selector, requestId)
        );
        moons.finalizeMoonChance(outcomeId);
    }

    function testFulfilledMoonChanceCreatesMoonDeterministically() public {
        uint256 planetId = _startPlanet();

        vm.prank(reporter);
        (uint256 outcomeId, uint256 requestId) =
            moons.requestMoonChanceFromBattle(78, planetId, 3_000_000, 0);
        (, bytes32 purposeHash,,) = moons.moonChanceRandomness(outcomeId);
        (uint16 expectedFields, uint16 expectedDiameterKm) =
            _expectedMoonShape(planetId, purposeHash, 7);

        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, 7);

        vm.expectEmit(true, true, true, true, address(moons));
        emit MoonChanceFinalized(
            outcomeId, 78, planetId, 2_000, true, 7, expectedFields, expectedDiameterKm
        );
        assertTrue(moons.finalizeMoonChance(outcomeId));

        VeydriftMoonSystem.Moon memory moon = moons.moon(planetId);
        (,, bool finalized, uint256 randomWord) = moons.moonChanceRandomness(outcomeId);
        (,,,, bool moonCreated, uint16 moonFields, uint16 moonDiameterKm) =
            moons.moonChanceResult(outcomeId);
        assertTrue(moon.exists);
        assertEq(moon.owner, player);
        assertEq(moon.fields, expectedFields);
        assertEq(moon.diameterKm, expectedDiameterKm);
        assertTrue(finalized);
        assertTrue(moonCreated);
        assertEq(randomWord, 7);
        assertEq(moonFields, moon.fields);
        assertEq(moonDiameterKm, moon.diameterKm);

        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftMoonSystem.MoonChanceAlreadyFinalized.selector, outcomeId
            )
        );
        moons.finalizeMoonChance(outcomeId);
    }

    function testFulfilledMoonChanceCanResolveNoMoon() public {
        uint256 planetId = _startPlanet();

        vm.prank(reporter);
        (uint256 outcomeId, uint256 requestId) =
            moons.requestMoonChanceFromBattle(79, planetId, 100_000, 0);

        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, 9_999);

        vm.expectEmit(true, true, true, true, address(moons));
        emit MoonChanceFinalized(outcomeId, 79, planetId, 100, false, 9_999, 0, 0);
        assertFalse(moons.finalizeMoonChance(outcomeId));
        assertFalse(moons.moon(planetId).exists);
        (,, bool finalized, uint256 randomWord) = moons.moonChanceRandomness(outcomeId);
        (,,,, bool moonCreated, uint16 moonFields, uint16 moonDiameterKm) =
            moons.moonChanceResult(outcomeId);
        assertTrue(finalized);
        assertFalse(moonCreated);
        assertEq(randomWord, 9_999);
        assertEq(moonFields, 0);
        assertEq(moonDiameterKm, 0);
    }

    function testMoonChanceRejectsDuplicateRerollAndExistingMoonSkipsCreation() public {
        uint256 planetId = _startPlanet();

        vm.prank(reporter);
        moons.requestMoonChanceFromBattle(80, planetId, 1_000_000, 0);

        vm.prank(reporter);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftMoonSystem.MoonChanceAlreadyRecorded.selector, 80, planetId
            )
        );
        moons.requestMoonChanceFromBattle(80, planetId, 1_000_000, 0);

        _createMoon(planetId);

        vm.prank(reporter);
        (uint256 outcomeId, uint256 requestId) =
            moons.requestMoonChanceFromBattle(81, planetId, 3_000_000, 0);
        assertEq(outcomeId, 0);
        assertEq(requestId, 0);
    }

    function testMoonChanceRequiresReporterAndQualifyingDebris() public {
        uint256 planetId = _startPlanet();

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftMoonSystem.NotMoonChanceReporter.selector, address(this))
        );
        moons.requestMoonChanceFromBattle(82, planetId, 1_000_000, 0);

        vm.prank(reporter);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftMoonSystem.MoonChanceTooSmall.selector, 99_999)
        );
        moons.requestMoonChanceFromBattle(82, planetId, 99_999, 0);
    }

    function testMoonBuildingUpgradeSpendsPlanetResources() public {
        uint256 planetId = _startPlanet();

        _createMoon(planetId);

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

        _createMoon(planetId);

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

        _createMoon(planetId);
        _fundPlanet(planetId, 3_000_000, 5_000_000, 3_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.JumpGate);

        _createMoon(secondPlanetId);
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

    function _createMoon(uint256 planetId) internal returns (VeydriftMoonSystem.Moon memory) {
        return moons.createMoon(planetId);
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

    function _expectedMoonShape(uint256 planetId, bytes32 purposeHash, uint256 randomWord)
        internal
        pure
        returns (uint16 fields, uint16 diameterKm)
    {
        uint256 seed = uint256(
            keccak256(
                abi.encode(keccak256("veydrift.moon-chance.v1"), planetId, purposeHash, randomWord)
            )
        );
        fields = uint16(1 + (seed % 3));
        diameterKm = uint16(3_400 + (seed % 5_101));
    }
}
