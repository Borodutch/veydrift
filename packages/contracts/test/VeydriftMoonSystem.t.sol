// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftDependencies} from "../src/libraries/VeydriftDependencies.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {
    Building,
    Defense,
    MoonBuilding,
    Resource,
    Ship,
    Technology
} from "../src/libraries/VeydriftTypes.sol";

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

    event MoonResourcesSettled(
        uint256 indexed planetId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium,
        uint64 settledAt
    );
    event MoonShipCountChanged(uint256 indexed planetId, Ship indexed ship, uint32 total);
    event MoonDefenseCountChanged(uint256 indexed planetId, Defense indexed defense, uint32 total);
    event FleetMissionBodies(uint256 indexed missionId, bool originIsMoon, bool targetIsMoon);

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
    event MoonDestructionRequested(
        uint256 indexed outcomeId,
        uint256 indexed battleId,
        uint256 indexed targetPlanetId,
        address attacker,
        uint32 deathstars,
        uint16 moonDestructionChanceBps,
        uint16 deathstarDestructionChanceBps,
        uint256 randomnessRequestId,
        bytes32 purposeHash
    );
    event MoonDestructionFinalized(
        uint256 indexed outcomeId,
        uint256 indexed battleId,
        uint256 indexed targetPlanetId,
        bool moonDestroyed,
        bool deathstarsDestroyed,
        uint256 randomWord
    );
    event ChickenBurnMoonGranted(
        bytes32 indexed burnId,
        address indexed player,
        uint256 indexed planetId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        uint8 playerGrantCount
    );

    function setUp() public {
        randomness = new RandomnessEngine(admin, fulfiller);
        vm.prank(admin);
        randomness.setPrecommitRequired(false);
        VeydriftCombatModule combatModule =
            new VeydriftCombatModule(address(new VeydriftCombatRapidfire()));
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftAttackProtectionModule attackProtectionModule = new VeydriftAttackProtectionModule();
        VeydriftColonizationModule colonizationModule = new VeydriftColonizationModule();
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();
        game = new VeydriftGame(
            admin,
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule),
            address(defenseHoldModule)
        );
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
        game.setRandomnessEngine(address(randomness));
        vm.prank(admin);
        randomness.setRequesterAuthorization(address(game), true);
        vm.prank(admin);
        randomness.setRequesterAuthorization(address(moons), true);
        moons.setMoonChanceReporter(reporter);
        vm.deal(player, 1 ether);
    }

    function testProxyInitializationAndOwnerUpgradeGate() public {
        VeydriftMoonSystem proxied = VeydriftMoonSystem(
            address(
                new ERC1967Proxy(
                    address(new VeydriftMoonSystem(address(game), address(randomness))),
                    abi.encodeCall(
                        VeydriftMoonSystem.initialize, (address(game), address(randomness), admin)
                    )
                )
            )
        );

        assertEq(proxied.owner(), admin);
        assertEq(address(proxied.game()), address(game));
        assertEq(address(proxied.randomness()), address(randomness));
        assertEq(proxied.moonChanceReporter(), address(game));
        assertEq(proxied.nextMoonChanceId(), 1);
        assertEq(proxied.nextMoonDestructionId(), 1);

        VeydriftMoonSystem nextImplementation =
            new VeydriftMoonSystem(address(game), address(randomness));
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftMoonSystem.NotOwner.selector, player));
        proxied.upgradeToAndCall(address(nextImplementation), "");

        vm.prank(admin);
        proxied.upgradeToAndCall(address(nextImplementation), "");
        assertEq(proxied.owner(), admin);
        assertEq(address(proxied.game()), address(game));
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
        assertEq(moon.fields, 1);
        assertGe(moon.diameterKm, 3_466);
        assertLe(moon.diameterKm, 8_944);

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftMoonSystem.MoonAlreadyExists.selector, planetId)
        );
        moons.createMoon(planetId);

        VeydriftGameStorage.Resources memory cost =
            moons.moonBuildingUpgradeCost(planetId, MoonBuilding.LunarBase);
        assertEq(cost.metal, 20_000);
        assertEq(cost.crystal, 40_000);
        assertEq(cost.deuterium, 20_000);

        _fundMoon(planetId, 100_000, 100_000, 100_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.LunarBase), 1);
        assertEq(moons.moon(planetId).fields, moon.fields + 3);
    }

    function testChickenBurnGrantCreatesMoonForOwnedPlanet() public {
        uint256 planetId = _startPlanet();
        VeydriftGameStorage.Planet memory planetRef = game.planet(planetId);
        bytes32 burnId = keccak256("base-mainnet-tx-1-log-0");

        vm.expectEmit(true, true, true, true, address(moons));
        emit ChickenBurnMoonGranted(
            burnId, player, planetId, planetRef.galaxy, planetRef.system, planetRef.position, 1
        );
        VeydriftMoonSystem.Moon memory moon =
            moons.grantMoonFromChickenBurn(burnId, player, planetId);

        assertTrue(moon.exists);
        assertEq(moon.owner, player);
        assertEq(moon.planetId, planetId);
        assertTrue(moons.chickenBurnMoonGranted(burnId));
        assertEq(moons.chickenBurnMoonGrantCountOf(player), 1);
    }

    function testChickenBurnGrantRejectsDuplicateBurnEvent() public {
        uint256 planetId = _startPlanet();
        bytes32 burnId = keccak256("base-mainnet-tx-1-log-0");

        moons.grantMoonFromChickenBurn(burnId, player, planetId);

        uint256 secondPlanetId = 1_002;
        _setPlanetLocation(secondPlanetId, player, 2, 10, 6);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftMoonSystem.ChickenBurnAlreadyGranted.selector, burnId)
        );
        moons.grantMoonFromChickenBurn(burnId, player, secondPlanetId);
    }

    function testChickenBurnGrantCapsEachPlayerAtTwoIntegrationMoons() public {
        uint256 firstPlanetId = _startPlanet();
        uint256 secondPlanetId = 1_002;
        uint256 thirdPlanetId = 1_003;
        _setPlanetLocation(secondPlanetId, player, 2, 10, 6);
        _setPlanetLocation(thirdPlanetId, player, 2, 11, 7);

        moons.grantMoonFromChickenBurn(keccak256("burn-1"), player, firstPlanetId);
        moons.grantMoonFromChickenBurn(keccak256("burn-2"), player, secondPlanetId);

        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftMoonSystem.ChickenBurnMoonLimitReached.selector,
                player,
                moons.MAX_CHICKEN_BURN_MOONS_PER_PLAYER()
            )
        );
        moons.grantMoonFromChickenBurn(keccak256("burn-3"), player, thirdPlanetId);
    }

    function testChickenBurnGrantRejectsWrongOwnerAndMissingPlanet() public {
        uint256 planetId = _startPlanet();

        address impostor = address(0xBAD);
        vm.expectRevert(abi.encodeWithSelector(VeydriftMoonSystem.NotMoonOwner.selector));
        moons.grantMoonFromChickenBurn(keccak256("wrong-owner"), impostor, planetId);

        vm.expectRevert(abi.encodeWithSelector(VeydriftMoonSystem.NoPlanet.selector));
        moons.grantMoonFromChickenBurn(keccak256("no-planet"), player, 99_999);
    }

    function testChickenBurnGrantIsAdminOnly() public {
        uint256 planetId = _startPlanet();

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftMoonSystem.NotOwner.selector, player));
        moons.grantMoonFromChickenBurn(keccak256("non-admin"), player, planetId);
    }

    function testMoonChanceCalculationAndCap() public view {
        assertEq(moons.moonChanceBps(99_999, 0), 0);
        assertEq(moons.moonChanceBps(100_000, 0), 100);
        assertEq(moons.moonChanceBps(750_000, 250_000), 1_000);
        assertEq(moons.moonChanceBps(3_000_000, 0), 2_000);
    }

    function testMoonDestructionParityChances() public view {
        assertEq(moons.moonDestructionChanceBps(3_400, 1), 4_200);
        assertEq(moons.moonDestructionChanceBps(8_500, 1), 800);
        assertEq(moons.moonDestructionChanceBps(3_400, 9), 10_000);
        assertEq(moons.moonDestructionChanceBps(8_500, 0), 0);
        assertEq(moons.moonDeathstarDestructionChanceBps(3_400), 2_900);
        assertEq(moons.moonDeathstarDestructionChanceBps(8_500), 4_600);
    }

    function testBattleMoonChanceRequestsRandomnessAndBlocksPendingOutcome() public {
        uint256 planetId = _startPlanet();
        bytes32 commitment = randomness.randomnessCommitment(123);
        vm.prank(admin);
        randomness.setPrecommitRequired(true);
        vm.prank(fulfiller);
        randomness.commitRandomness(commitment);
        vm.roll(block.number + 1);
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
        assertEq(request.randomnessCommitment, commitment);

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

    function testMoonDestructionRequestsRandomnessAndDestroysMoonState() public {
        uint256 planetId = _startPlanet();

        VeydriftMoonSystem.Moon memory moon = _createMoon(planetId);
        _fundMoon(planetId, 1_000_000, 1_000_000, 1_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);

        vm.prank(player);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.LunarBase);
        VeydriftMoonSystem.MoonBuildingConstruction memory construction =
            moons.activeMoonBuildingConstruction(planetId);
        assertTrue(construction.active);

        uint16 moonDestructionBps = moons.moonDestructionChanceBps(moon.diameterKm, 1);
        uint16 deathstarDestructionBps = moons.moonDeathstarDestructionChanceBps(moon.diameterKm);
        bytes32 purposeHash = moons.moonDestructionPurposeHash(
            1,
            91,
            planetId,
            reporter,
            1,
            moon.diameterKm,
            moonDestructionBps,
            deathstarDestructionBps
        );

        vm.expectEmit(true, true, true, true, address(moons));
        emit MoonDestructionRequested(
            1,
            91,
            planetId,
            reporter,
            1,
            moonDestructionBps,
            deathstarDestructionBps,
            1,
            purposeHash
        );
        vm.prank(reporter);
        (uint256 outcomeId, uint256 requestId) =
            moons.requestMoonDestructionFromBattle(91, planetId, reporter, 1);

        (
            uint256 battleId,
            uint256 targetPlanetId,
            address attacker,
            uint32 deathstars,
            uint16 reportedMoonBps,
            uint16 reportedDeathstarBps,
            bool moonDestroyed,
            bool deathstarsDestroyed
        ) = moons.moonDestructionResult(outcomeId);
        (uint256 storedRequestId, bytes32 storedPurposeHash, bool finalized,) =
            moons.moonDestructionRandomness(outcomeId);
        assertEq(battleId, 91);
        assertEq(targetPlanetId, planetId);
        assertEq(attacker, reporter);
        assertEq(deathstars, 1);
        assertEq(reportedMoonBps, moonDestructionBps);
        assertEq(reportedDeathstarBps, deathstarDestructionBps);
        assertFalse(moonDestroyed);
        assertFalse(deathstarsDestroyed);
        assertEq(storedRequestId, requestId);
        assertEq(storedPurposeHash, purposeHash);
        assertFalse(finalized);

        uint256 randomWord = uint256(moonDestructionBps - 1) + uint256(9_999) * 10_000;
        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, randomWord);

        vm.expectEmit(true, true, true, true, address(moons));
        emit MoonDestructionFinalized(outcomeId, 91, planetId, true, false, randomWord);
        (moonDestroyed, deathstarsDestroyed) = moons.finalizeMoonDestruction(outcomeId);
        assertTrue(moonDestroyed);
        assertFalse(deathstarsDestroyed);
        assertFalse(moons.moon(planetId).exists);
        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.LunarBase), 0);
        assertFalse(moons.activeMoonBuildingConstruction(planetId).active);

        (,, finalized,) = moons.moonDestructionRandomness(outcomeId);
        (,,,,,, moonDestroyed, deathstarsDestroyed) = moons.moonDestructionResult(outcomeId);
        assertTrue(finalized);
        assertTrue(moonDestroyed);
        assertFalse(deathstarsDestroyed);
    }

    function testMoonDestructionCanDestroyDeathstarsWithoutDestroyingMoon() public {
        uint256 planetId = _startPlanet();

        VeydriftMoonSystem.Moon memory moon = _createMoon(planetId);
        uint16 moonDestructionBps = moons.moonDestructionChanceBps(moon.diameterKm, 1);
        uint16 deathstarDestructionBps = moons.moonDeathstarDestructionChanceBps(moon.diameterKm);

        vm.prank(reporter);
        (uint256 outcomeId, uint256 requestId) =
            moons.requestMoonDestructionFromBattle(92, planetId, reporter, 1);

        uint256 randomWord =
            uint256(moonDestructionBps) + uint256(deathstarDestructionBps - 1) * 10_000;
        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, randomWord);

        (bool moonDestroyed, bool deathstarsDestroyed) = moons.finalizeMoonDestruction(outcomeId);
        assertFalse(moonDestroyed);
        assertTrue(deathstarsDestroyed);
        assertTrue(moons.moon(planetId).exists);
    }

    function testMoonDestructionRejectsInvalidRequestsAndDuplicates() public {
        uint256 planetId = _startPlanet();

        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(VeydriftMoonSystem.NoMoon.selector, planetId));
        moons.requestMoonDestructionFromBattle(93, planetId, reporter, 1);

        _createMoon(planetId);

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftMoonSystem.NotMoonChanceReporter.selector, address(this))
        );
        moons.requestMoonDestructionFromBattle(93, planetId, reporter, 1);

        vm.prank(reporter);
        vm.expectRevert(VeydriftMoonSystem.InvalidQuantity.selector);
        moons.requestMoonDestructionFromBattle(93, planetId, reporter, 0);

        vm.prank(reporter);
        moons.requestMoonDestructionFromBattle(93, planetId, reporter, 1);

        vm.prank(reporter);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftMoonSystem.MoonDestructionAlreadyRecorded.selector, 93, planetId
            )
        );
        moons.requestMoonDestructionFromBattle(93, planetId, reporter, 1);
    }

    function testMoonBuildingUpgradeSpendsMoonResources() public {
        uint256 planetId = _startPlanet();

        _createMoon(planetId);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.InsufficientResources.selector, 0, 0, 0)
        );
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.LunarBase);

        _fundPlanet(planetId, 100_000, 100_000, 100_000);
        _grantMoonResources(planetId, 100_000, 100_000, 100_000);
        vm.prank(player);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.LunarBase);

        VeydriftGameStorage.Planet memory planet = game.planet(planetId);
        assertEq(planet.resources.metal, 100_000);
        assertEq(planet.resources.crystal, 100_000);
        assertEq(planet.resources.deuterium, 100_000);
        VeydriftGameStorage.Resources memory moonBalance = moons.moonResources(planetId);
        assertEq(moonBalance.metal, 80_000);
        assertEq(moonBalance.crystal, 60_000);
        assertEq(moonBalance.deuterium, 80_000);

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftMoonSystem.NotOwner.selector, player));
        moons.grantMoonResources(
            planetId, VeydriftGameStorage.Resources({metal: 1, crystal: 0, deuterium: 0})
        );
    }

    function testMoonFacilitiesUnlockWithMoonRoboticsAndFields() public {
        uint256 planetId = _startPlanet();

        _createMoon(planetId);
        assertEq(moons.moon(planetId).fields, 1);
        _fundMoon(planetId, 3_000_000, 5_000_000, 3_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        assertEq(moons.moon(planetId).fields, 4);
        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.LunarBase), 1);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftMoonSystem.MissingDependency.selector,
                // Dependency ids are short ASCII tags that fit in bytes32.
                // forge-lint: disable-next-line(unsafe-typecast)
                bytes32("ROBOTICS_FACTORY_2")
            )
        );
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.Shipyard);

        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        assertEq(moons.moon(planetId).fields, 7);
        _buildMoon(planetId, MoonBuilding.Shipyard);
        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.RoboticsFactory), 2);
        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.Shipyard), 1);

        _setTechnologyLevel(player, Technology.Hyperspace, 7);
        vm.prank(player);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.JumpGate);
        VeydriftMoonSystem.MoonBuildingConstruction memory construction =
            moons.activeMoonBuildingConstruction(planetId);
        assertTrue(construction.active);
        assertEq(uint8(construction.building), uint8(MoonBuilding.JumpGate));
    }

    function testMoonFieldCapacityRequiresOpenFieldEvenForLunarBase() public {
        uint256 planetId = _startPlanet();

        _createMoon(planetId);
        _fundPlanet(planetId, 10_000_000, 10_000_000, 10_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _setTechnologyLevel(player, Technology.Hyperspace, 7);
        _buildMoon(planetId, MoonBuilding.JumpGate);

        vm.prank(player);
        vm.expectRevert(VeydriftMoonSystem.MoonFieldCapacityReached.selector);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.LunarBase);
    }

    function testMoonFacilitiesUseSingleActiveConstructionSlot() public {
        uint256 planetId = _startPlanet();

        _createMoon(planetId);
        _fundPlanet(planetId, 1_000_000, 1_000_000, 1_000_000);
        _grantMoonResources(planetId, 1_000_000, 1_000_000, 1_000_000);

        vm.prank(player);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.LunarBase);

        vm.prank(player);
        vm.expectRevert(VeydriftMoonSystem.ConstructionActive.selector);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.RoboticsFactory);
    }

    function testMoonDefenseConstructionUsesMoonShipyardAndSeparateCounts() public {
        uint256 planetId = _startPlanet();

        _createMoon(planetId);
        _fundPlanet(planetId, 10_000_000, 10_000_000, 10_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.Shipyard);

        vm.prank(player);
        moons.startMoonDefenseProduction(planetId, Defense.RocketLauncher, 3);
        VeydriftMoonSystem.MoonDefenseQueue memory queue = moons.activeMoonDefenseQueue(planetId);
        assertTrue(queue.active);
        assertEq(uint8(queue.defense), uint8(Defense.RocketLauncher));
        assertEq(queue.quantity, 3);

        vm.warp(queue.readyAt);
        vm.prank(player);
        moons.finishMoonDefenseProduction(planetId);
        assertEq(moons.moonDefenseCount(planetId, Defense.RocketLauncher), 3);
        assertEq(game.defenseCount(planetId, Defense.RocketLauncher), 0);
    }

    function testMoonDefenseRequiresMoonShipyard() public {
        uint256 planetId = _startPlanet();

        _createMoon(planetId);
        _fundPlanet(planetId, 100_000, 100_000, 100_000);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftDependencies.MissingDependency.selector,
                // Dependency ids are short ASCII tags that fit in bytes32.
                // forge-lint: disable-next-line(unsafe-typecast)
                bytes32("SHIPYARD")
            )
        );
        moons.startMoonDefenseProduction(planetId, Defense.RocketLauncher, 1);
    }

    function testJumpGateRequiresOwnedReadyMoonGates() public {
        uint256 planetId = _startPlanet();
        uint256 secondPlanetId = 2;
        _setPlanetOwner(secondPlanetId, player);
        _setTechnologyLevel(player, Technology.Hyperspace, 7);

        _createMoon(planetId);
        _fundMoon(planetId, 3_000_000, 5_000_000, 3_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.JumpGate);

        _createMoon(secondPlanetId);
        _fundMoon(secondPlanetId, 3_000_000, 5_000_000, 3_000_000);
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

    function testJumpGateMovesShipsBetweenOwnedMoons() public {
        uint256 planetId = _startPlanet();
        uint256 secondPlanetId = 2;
        _setPlanetOwner(secondPlanetId, player);
        _setTechnologyLevel(player, Technology.Hyperspace, 7);

        _createMoon(planetId);
        _fundMoon(planetId, 3_000_000, 5_000_000, 3_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.JumpGate);

        _createMoon(secondPlanetId);
        _fundMoon(secondPlanetId, 3_000_000, 5_000_000, 3_000_000);
        _buildMoon(secondPlanetId, MoonBuilding.LunarBase);
        _buildMoon(secondPlanetId, MoonBuilding.JumpGate);

        _setMoonShipCount(planetId, Ship.SmallCargo, 4);
        _setMoonShipCount(planetId, Ship.Battlecruiser, 2);
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 3;
        ships.battlecruiser = 2;

        vm.prank(player);
        moons.jumpGateJumpShips(planetId, secondPlanetId, ships);

        assertEq(game.shipCount(planetId, Ship.SmallCargo), 0);
        assertEq(game.shipCount(secondPlanetId, Ship.SmallCargo), 0);
        assertEq(moons.moonShipCount(planetId, Ship.SmallCargo), 1);
        assertEq(moons.moonShipCount(planetId, Ship.Battlecruiser), 0);
        assertEq(moons.moonShipCount(secondPlanetId, Ship.SmallCargo), 3);
        assertEq(moons.moonShipCount(secondPlanetId, Ship.Battlecruiser), 2);
    }

    function testJumpGateShipMovementEmitsMoonShipCountChangedForBothMoons() public {
        uint256 planetId = _startPlanet();
        uint256 secondPlanetId = 2;
        _setPlanetOwner(secondPlanetId, player);
        _setTechnologyLevel(player, Technology.Hyperspace, 7);

        _createMoon(planetId);
        _fundMoon(planetId, 3_000_000, 5_000_000, 3_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.JumpGate);

        _createMoon(secondPlanetId);
        _fundMoon(secondPlanetId, 3_000_000, 5_000_000, 3_000_000);
        _buildMoon(secondPlanetId, MoonBuilding.LunarBase);
        _buildMoon(secondPlanetId, MoonBuilding.JumpGate);

        _setMoonShipCount(planetId, Ship.SmallCargo, 4);
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 3;

        // A jump-gate transfer debits the origin moon and credits the destination moon, emitting
        // moon-specific totals so the backend never aliases moon fleets to planet fleets.
        vm.expectEmit(true, true, false, true, address(game));
        emit MoonShipCountChanged(planetId, Ship.SmallCargo, 1);
        vm.expectEmit(true, true, false, true, address(game));
        emit MoonShipCountChanged(secondPlanetId, Ship.SmallCargo, 3);
        vm.prank(player);
        moons.jumpGateJumpShips(planetId, secondPlanetId, ships);
    }

    function testMoonDefenseCountsAreIndependentFromPlanetDefenses() public {
        uint256 planetId = _startPlanet();
        _createMoon(planetId);

        vm.expectEmit(true, true, false, true, address(moons));
        emit MoonDefenseCountChanged(planetId, Defense.RocketLauncher, 12);
        _setMoonDefenseCount(planetId, Defense.RocketLauncher, 12);

        assertEq(game.defenseCount(planetId, Defense.RocketLauncher), 0);
        assertEq(moons.moonDefenseCount(planetId, Defense.RocketLauncher), 12);
    }

    function testPlanetToMoonTransportMovesCargoAndReturnsShips() public {
        uint256 planetId = _startPlanet();
        _createMoon(planetId);
        _fundPlanet(planetId, 20_000, 20_000, 20_000);
        _setShipCount(planetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        VeydriftGameStorage.Resources memory cargo =
            VeydriftGameStorage.Resources({metal: 100, crystal: 50, deuterium: 25});

        vm.prank(player);
        uint256 missionId = game.launchBodyFleetMission(
            planetId,
            planetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            cargo,
            100,
            false,
            true
        );

        assertEq(game.shipCount(planetId, Ship.SmallCargo), 0);
        (, uint64 arrivalAt, uint64 returnAt,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        game.resolveFleetMission(missionId);

        VeydriftGameStorage.Resources memory moonResources = _moonResources(planetId);
        assertEq(moonResources.metal, 100);
        assertEq(moonResources.crystal, 50);
        assertEq(moonResources.deuterium, 25);
        assertEq(game.shipCount(planetId, Ship.SmallCargo), 0);

        vm.warp(returnAt);
        game.completeFleetMissionReturn(missionId);
        assertEq(game.shipCount(planetId, Ship.SmallCargo), 1);
    }

    function testMoonToPlanetTransportSpendsMoonResourcesAndReturnsMoonShips() public {
        uint256 planetId = _startPlanet();
        _createMoon(planetId);
        _fundMoon(planetId, 1_000, 1_000, 1_000);
        _setMoonShipCount(planetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        VeydriftGameStorage.Resources memory cargo =
            VeydriftGameStorage.Resources({metal: 120, crystal: 30, deuterium: 10});

        vm.prank(player);
        uint256 missionId = game.launchBodyFleetMission(
            planetId,
            planetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            cargo,
            100,
            true,
            false
        );

        assertEq(_moonShipCount(planetId, Ship.SmallCargo), 0);
        (, uint64 arrivalAt, uint64 returnAt,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        game.resolveFleetMission(missionId);

        VeydriftGameStorage.Planet memory planet = game.planet(planetId);
        assertGe(planet.resources.metal, 620);
        assertGe(planet.resources.crystal, 530);
        assertGe(planet.resources.deuterium, 10);

        vm.warp(returnAt);
        game.completeFleetMissionReturn(missionId);
        assertEq(_moonShipCount(planetId, Ship.SmallCargo), 1);
    }

    function testDeployStationsFleetOnMoonWithoutReturnLeg() public {
        uint256 planetId = _startPlanet();
        _createMoon(planetId);
        _fundPlanet(planetId, 20_000, 20_000, 20_000);
        _setShipCount(planetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.prank(player);
        uint256 missionId = game.launchBodyFleetMission(
            planetId,
            planetId,
            VeydriftGameStorage.FleetMissionType.Deploy,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            false,
            true
        );

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        game.resolveFleetMission(missionId);

        assertEq(game.shipCount(planetId, Ship.SmallCargo), 0);
        assertEq(_moonShipCount(planetId, Ship.SmallCargo), 1);
    }

    function testMoonAttackLaunchStoresMoonBodyFlags() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMoonAttackPlanets();
        _fundMoon(originPlanetId, 20_000, 20_000, 20_000);
        _setMoonShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setNextFleetId(900);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.recordLogs();
        vm.prank(player);
        uint256 missionId = game.launchBodyFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            true,
            true
        );

        assertEq(missionId, 900);
        _assertFleetMissionBodiesLog(vm.getRecordedLogs(), missionId, true, true);
        assertEq(_moonShipCount(originPlanetId, Ship.SmallCargo), 0);
    }

    function testMoonAttackRaidsMoonResourcesWithoutTouchingParentPlanet() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMoonAttackPlanets();
        _fundMoon(originPlanetId, 20_000, 20_000, 20_000);
        _fundMoon(targetPlanetId, 10_000, 4_000, 2_000);
        _fundPlanet(targetPlanetId, 111_000, 222_000, 333_000);
        _setMoonShipCount(originPlanetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.Planet memory parentBefore = game.planet(targetPlanetId);
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.prank(player);
        uint256 missionId = game.launchBodyFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            true,
            true
        );

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 659);
        game.resolveFleetMission(missionId);

        (,,, VeydriftGameStorage.Resources memory attackCargo) = _fleetMission(missionId);
        VeydriftGameStorage.Resources memory moonAfter = _moonResources(targetPlanetId);
        VeydriftGameStorage.Planet memory parentAfter = game.planet(targetPlanetId);

        assertGt(attackCargo.metal + attackCargo.crystal + attackCargo.deuterium, 0);
        assertLt(moonAfter.metal + moonAfter.crystal + moonAfter.deuterium, 16_000);
        assertEq(parentAfter.resources.metal, parentBefore.resources.metal);
        assertEq(parentAfter.resources.crystal, parentBefore.resources.crystal);
        assertEq(parentAfter.resources.deuterium, parentBefore.resources.deuterium);
    }

    function testMoonAttackMutatesMoonDefensesNotPlanetDefenses() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMoonAttackPlanets();
        _fundPlanet(originPlanetId, 100_000, 100_000, 100_000);
        _setShipCount(originPlanetId, Ship.Battleship, 100);
        _setMoonDefenseCount(targetPlanetId, Defense.RocketLauncher, 100);

        VeydriftGameStorage.MissionShips memory ships;
        ships.battleship = 100;

        vm.prank(player);
        uint256 missionId = game.launchBodyFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            false,
            true
        );

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 659);
        game.resolveFleetMission(missionId);

        assertLt(moons.moonDefenseCount(targetPlanetId, Defense.RocketLauncher), 100);
        assertEq(game.defenseCount(targetPlanetId, Defense.RocketLauncher), 0);
    }

    function testPendingMoonAttackBlocksParentPlanetActionsUntilResolved() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) =
            _seedMoonAttackPlanets();
        _fundPlanet(originPlanetId, 100_000, 100_000, 100_000);
        _fundPlanet(targetPlanetId, 100_000, 100_000, 100_000);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.prank(player);
        uint256 missionId = game.launchBodyFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            false,
            true
        );

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);

        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.FleetMissionNotResolved.selector, arrivalAt)
        );
        vm.prank(defender);
        game.startBuildingUpgrade(targetPlanetId, Building.MetalMine);

        _fulfillAttackBattleRandomness(missionId, 659);
        game.resolveFleetMission(missionId);

        vm.prank(defender);
        game.startBuildingUpgrade(targetPlanetId, Building.MetalMine);
        assertTrue(game.activeBuildingConstruction(targetPlanetId).active);
    }

    // VEY-KANEO-468: a due moon-building construction completes lazily on the next moon interaction,
    // with no finishMoonBuildingUpgrade tx required.
    function testMoonBuildingSettlesLazilyWithoutFinishTx() public {
        uint256 planetId = _startPlanet();
        _fundMoon(planetId, 3_000_000, 5_000_000, 3_000_000);
        _createMoon(planetId);
        _buildMoon(planetId, MoonBuilding.LunarBase); // level 1 (provides fields)

        // Start a LunarBase L1->L2 upgrade and warp past readyAt, but do NOT call finish.
        vm.prank(player);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.LunarBase);
        VeydriftMoonSystem.MoonBuildingConstruction memory due =
            moons.activeMoonBuildingConstruction(planetId);
        assertEq(due.targetLevel, 2);
        vm.warp(due.readyAt);
        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.LunarBase), 1); // unsettled pre-touch

        // A subsequent mutating interaction must settle the due construction (no finish tx) and then
        // start the next one.
        vm.prank(player);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.LunarBase);

        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.LunarBase), 2);
        VeydriftMoonSystem.MoonBuildingConstruction memory next =
            moons.activeMoonBuildingConstruction(planetId);
        assertTrue(next.active);
        assertEq(uint8(next.building), uint8(MoonBuilding.LunarBase));
        assertEq(next.targetLevel, 3);
    }

    function _startPlanet() internal returns (uint256 planetId) {
        vm.prank(player);
        planetId = game.startPlanet{value: 0.05 ether}();
    }

    function _seedMoonAttackPlanets()
        internal
        returns (uint256 originPlanetId, uint256 targetPlanetId, address defender)
    {
        defender = address(0xDEF);
        vm.deal(defender, 1 ether);
        originPlanetId = _startPlanet();
        vm.prank(defender);
        targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetLocation(originPlanetId, player, 1, 100, 8);
        _setPlanetLocation(targetPlanetId, defender, 1, 100, 9);
        _createMoon(originPlanetId);
        _createMoon(targetPlanetId);
    }

    function _createMoon(uint256 planetId) internal returns (VeydriftMoonSystem.Moon memory) {
        return moons.createMoon(planetId);
    }

    function _buildMoon(uint256 planetId, MoonBuilding building) internal {
        _grantMoonResources(planetId, 10_000_000, 10_000_000, 10_000_000);
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

    function _setPlanetLocation(
        uint256 planetId,
        address owner,
        uint16 galaxy,
        uint16 system,
        uint8 position
    ) internal {
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

    function _setNextFleetId(uint256 nextFleetId) internal {
        vm.store(address(game), bytes32(uint256(11)), bytes32(nextFleetId));
    }

    function _assertFleetMissionBodiesLog(
        Vm.Log[] memory logs,
        uint256 missionId,
        bool expectedOriginIsMoon,
        bool expectedTargetIsMoon
    ) internal view {
        bytes32 bodiesTopic = keccak256("FleetMissionBodies(uint256,bool,bool)");
        for (uint256 i = 0; i < logs.length;) {
            Vm.Log memory entry = logs[i];
            if (
                entry.emitter != address(game) || entry.topics.length < 2
                    || entry.topics[0] != bodiesTopic || uint256(entry.topics[1]) != missionId
            ) {
                unchecked {
                    ++i;
                }
                continue;
            }

            (bool originIsMoon, bool targetIsMoon) = abi.decode(entry.data, (bool, bool));
            assertEq(originIsMoon, expectedOriginIsMoon);
            assertEq(targetIsMoon, expectedTargetIsMoon);
            return;
        }
        revert("FleetMissionBodies not recorded");
    }

    function _storeFleetMission(
        uint256 missionId,
        VeydriftGameStorage.FleetMissionStatus status,
        VeydriftGameStorage.FleetMissionType missionType,
        address owner,
        uint256 originPlanetId,
        uint256 targetPlanetId,
        uint64 departureAt,
        uint64 arrivalAt,
        uint64 returnAt
    ) internal {
        uint256 missionBase = uint256(keccak256(abi.encode(missionId, uint256(24))));
        uint256 packedHead = uint256(uint8(status)) | (uint256(uint8(missionType)) << 8)
            | (uint256(uint160(owner)) << 16);
        uint256 packedTimes =
            uint256(departureAt) | (uint256(arrivalAt) << 64) | (uint256(returnAt) << 128);
        vm.store(address(game), bytes32(missionBase), bytes32(packedHead));
        vm.store(address(game), bytes32(missionBase + 1), bytes32(originPlanetId));
        vm.store(address(game), bytes32(missionBase + 2), bytes32(targetPlanetId));
        vm.store(address(game), bytes32(missionBase + 3), bytes32(packedTimes));
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

    function _fulfillAttackBattleRandomness(uint256 missionId, uint256 randomWord) internal {
        (, VeydriftGameStorage.FleetMissionType missionType,,,,,,,,, uint256 requestId) =
            game.fleetMission(missionId);
        if (missionType != VeydriftGameStorage.FleetMissionType.Attack) return;

        RandomnessEngine.Request memory request = randomness.request(requestId);
        if (request.fulfilledAt != 0) return;

        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, randomWord);
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

    function _grantMoonResources(
        uint256 planetId,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    ) internal {
        moons.grantMoonResources(
            planetId,
            VeydriftGameStorage.Resources({metal: metal, crystal: crystal, deuterium: deuterium})
        );
    }

    function _fundMoon(uint256 planetId, uint128 metal, uint128 crystal, uint128 deuterium)
        internal
    {
        bytes32 packedMetalCrystal = bytes32(uint256(metal) | (uint256(crystal) << 128));
        bytes32 deuteriumWord = bytes32(uint256(deuterium));
        bytes32 slot = keccak256(abi.encode(planetId, uint256(46)));

        vm.store(address(game), slot, packedMetalCrystal);
        vm.store(address(game), bytes32(uint256(slot) + 1), deuteriumWord);
        vm.store(address(game), bytes32(uint256(14)), packedMetalCrystal);
        vm.store(address(game), bytes32(uint256(15)), deuteriumWord);
    }

    function _moonResources(uint256 planetId)
        internal
        view
        returns (VeydriftGameStorage.Resources memory resources)
    {
        bytes32 slot = keccak256(abi.encode(planetId, uint256(46)));
        bytes32 packedMetalCrystal = vm.load(address(game), slot);
        bytes32 deuteriumWord = vm.load(address(game), bytes32(uint256(slot) + 1));
        resources.metal = uint128(uint256(packedMetalCrystal));
        resources.crystal = uint128(uint256(packedMetalCrystal) >> 128);
        resources.deuterium = uint128(uint256(deuteriumWord));
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

    function _setMoonShipCount(uint256 planetId, Ship ship, uint32 count) internal {
        moons.setMoonShipCount(planetId, ship, count);
        bytes32 outerSlot = keccak256(abi.encode(planetId, uint256(47)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(ship)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(count)));
    }

    function _setMoonDefenseCount(uint256 planetId, Defense defense, uint32 count) internal {
        moons.setMoonDefenseCount(planetId, defense, count);
    }

    function _moonShipCount(uint256 planetId, Ship ship) internal view returns (uint32) {
        bytes32 outerSlot = keccak256(abi.encode(planetId, uint256(47)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(ship)), outerSlot));
        return uint32(uint256(vm.load(address(game), slot)));
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
        diameterKm = uint16(3_466 + (seed % 5_479));
        fields = 1;
    }
}
