// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftAcsAttackModule} from "../src/VeydriftAcsAttackModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftShipProductionModule} from "../src/VeydriftShipProductionModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftFirstPlanetSettlementModule} from "../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {VeydriftDependencies} from "../src/libraries/VeydriftDependencies.sol";
import {VeydriftAntiRaidPrimitives} from "../src/libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {VeydriftMoonDefenseBacklog} from "../src/libraries/VeydriftMoonDefenseBacklog.sol";
import {VeydriftDefenseHoldStorage} from "../src/libraries/VeydriftDefenseHoldStorage.sol";
import {VeydriftBodyAttackWindow} from "../src/libraries/VeydriftBodyAttackWindow.sol";
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

contract MoonAttackWindowHarness is VeydriftGameStorage {
    constructor() VeydriftGameStorage(address(this)) {}

    function seedTarget(uint256 planetId, address defender) external {
        _planets[planetId].owner = defender;
        playerLastActiveAt[defender] = uint64(block.timestamp);
    }

    function setMoonAttackParityActivatedAt(uint64 activatedAt) external {
        _moonAttackParityActivatedAt = activatedAt;
    }

    function recordLegacyAttack(address attacker, uint256 planetId) external {
        _recordAttack(attacker, planetId);
    }

    function recordMoonAttack(address attacker, uint256 planetId) external {
        VeydriftBodyAttackWindow.record(
            _planets,
            _attackWindows,
            _attackProtectionExemptions,
            playerLastActiveAt,
            _moonAttackParityActivatedAt,
            attacker,
            planetId,
            true
        );
    }

    function bodyAttackCount(
        address attacker,
        address defender,
        uint256 planetId,
        bool targetIsMoon
    ) external view returns (uint32) {
        return _currentBodyAttackCount(attacker, defender, planetId, targetIsMoon);
    }
}

contract MoonDefenseHoldIsolationHarness is VeydriftGameStorage {
    constructor() VeydriftGameStorage(address(this)) {}

    function seedPlanetHold(uint256 targetPlanetId, uint256 missionId, uint64 arrivalAt) external {
        FleetMission storage stationed = _fleetMissions[missionId];
        stationed.status = FleetMissionStatus.Outbound;
        stationed.missionType = FleetMissionType.DefenseHold;
        stationed.arrivalAt = arrivalAt;
        stationed.targetIsMoon = false;
        _defenseHoldUntil[missionId] = arrivalAt + 1 days;
        _stationedDefenseMissions[targetPlanetId].push(missionId);
    }

    function link(
        uint256 targetPlanetId,
        uint256 attackMissionId,
        uint64 arrivalAt,
        bool targetIsMoon
    ) external returns (uint256) {
        VeydriftDefenseHoldStorage.linkQualifiedDefenders(
            _stationedDefenseMissions[targetPlanetId],
            _fleetCounterplayMissions[attackMissionId],
            _fleetMissions,
            _defenseHoldUntil,
            arrivalAt,
            targetIsMoon
        );
        return _fleetCounterplayMissions[attackMissionId].length;
    }
}

abstract contract VeydriftMoonSystemTestBase is Test {
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
    event FleetMissionLootRatio(
        uint256 indexed missionId, uint16 metalBps, uint16 crystalBps, uint16 deuteriumBps
    );

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
        VeydriftColonizationModule colonizationModule =
            new VeydriftColonizationModule(address(new VeydriftShipProductionModule()));
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();
        VeydriftStateMigrationModule stateMigrationModule =
            new VeydriftStateMigrationModule(address(0xBEEF));
        VeydriftFirstPlanetSettlementModule firstPlanetSettlementModule =
            new VeydriftFirstPlanetSettlementModule(address(0xBEEF), address(colonizationModule));
        game = new VeydriftGame(
            admin,
            address(firstPlanetSettlementModule),
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule),
            address(defenseHoldModule),
            address(stateMigrationModule),
            address(new VeydriftAcsAttackModule())
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

    function _testProxyInitializationAndOwnerUpgradeGate() internal {
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

    function _testDirectPlayerMoonCreationReverts() internal {
        uint256 planetId = _startPlanet();

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftMoonSystem.NotOwner.selector, player));
        moons.createMoon(planetId);
        assertFalse(moons.moon(planetId).exists);
    }

    function _testMoonGenerationWritesFailClosedAcrossPausedUpgradeBoundary() internal {
        uint256 planetId = _startPlanet();

        vm.prank(reporter);
        (uint256 outcomeId, uint256 requestId) =
            moons.requestMoonChanceFromBattle(10_001, planetId, 3_000_000, 0);
        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, 7);

        vm.prank(admin);
        game.setGamePaused(true);
        vm.expectRevert();
        moons.finalizeMoonChance(outcomeId);

        vm.prank(admin);
        game.setGamePaused(false);
        assertTrue(moons.finalizeMoonChance(outcomeId));

        VeydriftMoonSystem legacyGameGap =
            new VeydriftMoonSystem(address(0xBEEF), address(randomness));
        vm.expectRevert();
        legacyGameGap.finalizeMoonChance(1);
    }

    function _testAdminMoonCreationAndLunarBaseFields() internal {
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

    function _testChickenBurnGrantCreatesMoonForOwnedPlanet() internal {
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

    function _testChickenBurnGrantRejectsDuplicateBurnEvent() internal {
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

    function _testChickenBurnGrantAllowsMoreThanTwoMoonsForAPlayer() internal {
        uint256 firstPlanetId = _startPlanet();
        uint256 secondPlanetId = 1_002;
        uint256 thirdPlanetId = 1_003;
        _setPlanetLocation(secondPlanetId, player, 2, 10, 6);
        _setPlanetLocation(thirdPlanetId, player, 2, 11, 7);

        moons.grantMoonFromChickenBurn(keccak256("burn-1"), player, firstPlanetId);
        moons.grantMoonFromChickenBurn(keccak256("burn-2"), player, secondPlanetId);
        VeydriftMoonSystem.Moon memory moon =
            moons.grantMoonFromChickenBurn(keccak256("burn-3"), player, thirdPlanetId);

        assertTrue(moon.exists);
        assertEq(moon.owner, player);
        assertEq(moon.planetId, thirdPlanetId);
        assertEq(moons.chickenBurnMoonGrantCountOf(player), 3);
    }

    function _testChickenBurnGrantRejectsWrongOwnerAndMissingPlanet() internal {
        uint256 planetId = _startPlanet();

        address impostor = address(0xBAD);
        vm.expectRevert(abi.encodeWithSelector(VeydriftMoonSystem.NotMoonOwner.selector));
        moons.grantMoonFromChickenBurn(keccak256("wrong-owner"), impostor, planetId);

        vm.expectRevert(abi.encodeWithSelector(VeydriftMoonSystem.NoPlanet.selector));
        moons.grantMoonFromChickenBurn(keccak256("no-planet"), player, 99_999);
    }

    function _testChickenBurnGrantIsAdminOnly() internal {
        uint256 planetId = _startPlanet();

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftMoonSystem.NotOwner.selector, player));
        moons.grantMoonFromChickenBurn(keccak256("non-admin"), player, planetId);
    }

    function _testMoonChanceCalculationAndCap() internal view {
        assertEq(moons.moonChanceBps(99_999, 0), 0);
        assertEq(moons.moonChanceBps(100_000, 0), 100);
        assertEq(moons.moonChanceBps(750_000, 250_000), 1_000);
        assertEq(moons.moonChanceBps(3_000_000, 0), 2_000);
    }

    function _testMoonDestructionParityChances() internal view {
        assertEq(moons.moonDestructionChanceBps(3_400, 1), 4_200);
        assertEq(moons.moonDestructionChanceBps(8_500, 1), 800);
        assertEq(moons.moonDestructionChanceBps(3_400, 9), 10_000);
        assertEq(moons.moonDestructionChanceBps(8_500, 0), 0);
        assertEq(moons.moonDeathstarDestructionChanceBps(3_400), 2_900);
        assertEq(moons.moonDeathstarDestructionChanceBps(8_500), 4_600);
    }

    function _testBattleMoonChanceRequestsRandomnessAndBlocksPendingOutcome() internal {
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

    function _testFulfilledMoonChanceCreatesMoonDeterministically() internal {
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

    function _testFulfilledMoonChanceCanResolveNoMoon() internal {
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

    function _testMoonChanceRejectsDuplicateRerollAndExistingMoonSkipsCreation() internal {
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

    function _testMoonChanceRequiresReporterAndQualifyingDebris() internal {
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

    function _testMoonDestructionRequestsRandomnessAndDestroysMoonState() internal {
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

    function _testMoonDestructionCanDestroyDeathstarsWithoutDestroyingMoon() internal {
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

    function _testMoonDestructionRejectsInvalidRequestsAndDuplicates() internal {
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

    function _testMoonBuildingUpgradeSpendsMoonResources() internal {
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

    function _testMoonFacilitiesUnlockWithMoonRoboticsAndFields() internal {
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

    function _testMoonFieldCapacityRequiresOpenFieldEvenForLunarBase() internal {
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

    function _testMoonFacilitiesUseSingleActiveConstructionSlot() internal {
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

    function _testMoonDefenseConstructionUsesMoonShipyardAndSeparateCounts() internal {
        uint256 planetId = _startPlanet();

        _createMoon(planetId);
        _fundPlanet(planetId, 10_000_000, 10_000_000, 10_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.Shipyard);

        vm.prank(player);
        moons.startMoonDefenseProduction(planetId, Defense.RocketLauncher, 3);
        VeydriftMoonDefenseBacklog.Entry memory queue = moons.activeMoonDefenseQueue(planetId);
        assertTrue(queue.active);
        assertEq(uint8(queue.defense), uint8(Defense.RocketLauncher));
        assertEq(queue.quantity, 3);

        vm.warp(queue.readyAt);
        vm.prank(player);
        moons.finishMoonDefenseProduction(planetId);
        assertEq(moons.moonDefenseCount(planetId, Defense.RocketLauncher), 3);
        assertEq(game.defenseCount(planetId, Defense.RocketLauncher), 0);
    }

    function _testMoonDefenseBacklogQueuesMixedTypesAndDrainsFifo() internal {
        uint256 planetId = _startPlanet();

        _createMoon(planetId);
        _fundPlanet(planetId, 10_000_000, 10_000_000, 10_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.Shipyard);
        _buildMoon(planetId, MoonBuilding.Shipyard);
        _setTechnologyLevel(player, Technology.Energy, 2);
        _setTechnologyLevel(player, Technology.Laser, 3);

        vm.startPrank(player);
        moons.startMoonDefenseProduction(planetId, Defense.RocketLauncher, 2);
        moons.startMoonDefenseProduction(planetId, Defense.LightLaser, 3);
        moons.startMoonDefenseProduction(planetId, Defense.RocketLauncher, 1);
        vm.stopPrank();

        VeydriftMoonDefenseBacklog.Entry memory active = moons.activeMoonDefenseQueue(planetId);
        VeydriftMoonDefenseBacklog.Entry[] memory backlog = moons.moonDefenseQueueBacklog(planetId);
        assertEq(uint8(active.defense), uint8(Defense.RocketLauncher));
        assertEq(active.quantity, 2);
        assertEq(backlog.length, 2);
        assertEq(uint8(backlog[0].defense), uint8(Defense.LightLaser));
        assertEq(backlog[0].quantity, 3);
        assertGt(backlog[0].readyAt, active.readyAt);
        assertEq(uint8(backlog[1].defense), uint8(Defense.RocketLauncher));
        assertEq(backlog[1].quantity, 1);
        assertGt(backlog[1].readyAt, backlog[0].readyAt);

        vm.warp(active.readyAt);
        vm.prank(player);
        moons.finishMoonDefenseProduction(planetId);
        assertEq(moons.moonDefenseCount(planetId, Defense.RocketLauncher), 2);
        active = moons.activeMoonDefenseQueue(planetId);
        backlog = moons.moonDefenseQueueBacklog(planetId);
        assertEq(uint8(active.defense), uint8(Defense.LightLaser));
        assertEq(backlog.length, 1);
        assertEq(uint8(backlog[0].defense), uint8(Defense.RocketLauncher));

        vm.warp(backlog[0].readyAt);
        uint256 packed = moons.moonDefensePacked(planetId);
        assertEq(packed & uint256(type(uint32).max), 3);
        assertEq(
            (packed >> (uint256(uint8(Defense.LightLaser)) * 32)) & uint256(type(uint32).max), 3
        );

        moons.setMoonShipCount(planetId, Ship.SmallCargo, 1);
        assertEq(moons.moonDefenseCount(planetId, Defense.LightLaser), 3);
        assertEq(moons.moonDefenseCount(planetId, Defense.RocketLauncher), 3);
        assertFalse(moons.activeMoonDefenseQueue(planetId).active);
        assertEq(moons.moonDefenseQueueBacklog(planetId).length, 0);
    }

    function _testMoonDefenseBacklogCountsQueuedShieldCapacity() internal {
        uint256 planetId = _startPlanet();

        _createMoon(planetId);
        _fundPlanet(planetId, 10_000_000, 10_000_000, 10_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.Shipyard);
        _setTechnologyLevel(player, Technology.Shielding, 2);

        vm.startPrank(player);
        moons.startMoonDefenseProduction(planetId, Defense.RocketLauncher, 1);
        moons.startMoonDefenseProduction(planetId, Defense.SmallShieldDome, 1);
        vm.expectRevert(VeydriftMoonSystem.LevelTooHigh.selector);
        moons.startMoonDefenseProduction(planetId, Defense.SmallShieldDome, 1);
        vm.stopPrank();

        VeydriftMoonDefenseBacklog.Entry[] memory backlog = moons.moonDefenseQueueBacklog(planetId);
        assertEq(backlog.length, 1);
        assertEq(uint8(backlog[0].defense), uint8(Defense.SmallShieldDome));
        assertEq(backlog[0].quantity, 1);
    }

    function _testMoonDefenseIsEffectiveWhenDueAndReconcilesOnNextMutationOnce() internal {
        uint256 planetId = _startPlanet();

        _createMoon(planetId);
        _fundPlanet(planetId, 10_000_000, 10_000_000, 10_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.Shipyard);

        vm.prank(player);
        moons.startMoonDefenseProduction(planetId, Defense.RocketLauncher, 3);
        VeydriftMoonDefenseBacklog.Entry memory queue = moons.activeMoonDefenseQueue(planetId);
        vm.warp(queue.readyAt);

        // Combat snapshots include the elapsed queue even before the next Moon mutation materializes
        // the completion event and canonical storage change. The raw count remains canonical, matching
        // raw planet building/queue getters; backend/UI project the same effective state for reads.
        assertTrue(moons.activeMoonDefenseQueue(planetId).active);
        assertEq(moons.moonDefenseCount(planetId, Defense.RocketLauncher), 0);
        assertEq(uint32(moons.moonDefensePacked(planetId)), 3);

        moons.setMoonShipCount(planetId, Ship.SmallCargo, 1);
        assertEq(moons.moonDefenseCount(planetId, Defense.RocketLauncher), 3);
        assertFalse(moons.activeMoonDefenseQueue(planetId).active);

        // Reconciliation is idempotent and cannot double-credit an already completed queue.
        moons.setMoonShipCount(planetId, Ship.SmallCargo, 2);
        assertEq(moons.moonDefenseCount(planetId, Defense.RocketLauncher), 3);
    }

    function _testLegacyFinishWrappersAreIdempotentAndSharedMutationSettlesBothQueues() internal {
        uint256 planetId = _startPlanet();

        _createMoon(planetId);
        _fundPlanet(planetId, 10_000_000, 10_000_000, 10_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.Shipyard);

        vm.startPrank(player);
        moons.finishMoonBuildingUpgrade(planetId);
        moons.finishMoonDefenseProduction(planetId);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.RoboticsFactory);
        moons.startMoonDefenseProduction(planetId, Defense.RocketLauncher, 2);
        moons.finishMoonBuildingUpgrade(planetId);
        moons.finishMoonDefenseProduction(planetId);
        vm.stopPrank();

        VeydriftMoonSystem.MoonBuildingConstruction memory construction =
            moons.activeMoonBuildingConstruction(planetId);
        VeydriftMoonDefenseBacklog.Entry memory queue = moons.activeMoonDefenseQueue(planetId);
        assertTrue(construction.active);
        assertTrue(queue.active);
        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.RoboticsFactory), 2);
        assertEq(moons.moonDefenseCount(planetId, Defense.RocketLauncher), 0);

        vm.warp(construction.readyAt > queue.readyAt ? construction.readyAt : queue.readyAt);
        moons.setMoonShipCount(planetId, Ship.SmallCargo, 1);

        assertFalse(moons.activeMoonBuildingConstruction(planetId).active);
        assertFalse(moons.activeMoonDefenseQueue(planetId).active);
        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.RoboticsFactory), 3);
        assertEq(moons.moonDefenseCount(planetId, Defense.RocketLauncher), 2);
    }

    function _testStartingMoonDefenseReconcilesDueShipyardFirst() internal {
        uint256 planetId = _startPlanet();

        _createMoon(planetId);
        _fundPlanet(planetId, 10_000_000, 10_000_000, 10_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);

        vm.prank(player);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.Shipyard);
        VeydriftMoonSystem.MoonBuildingConstruction memory shipyardQueue =
            moons.activeMoonBuildingConstruction(planetId);
        vm.warp(shipyardQueue.readyAt);

        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.Shipyard), 0);
        assertTrue(moons.activeMoonBuildingConstruction(planetId).active);

        vm.prank(player);
        moons.startMoonDefenseProduction(planetId, Defense.RocketLauncher, 1);

        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.Shipyard), 1);
        assertTrue(moons.activeMoonDefenseQueue(planetId).active);
    }

    function _testMoonDefenseRequiresMoonShipyard() internal {
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

    function _testJumpGateRequiresOwnedReadyMoonGates() internal {
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

    function _testJumpGateMovesShipsBetweenOwnedMoons() internal {
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

    function _testJumpGateShipMovementEmitsMoonShipCountChangedForBothMoons() internal {
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

    function _testMoonDefenseCountsAreIndependentFromPlanetDefenses() internal {
        uint256 planetId = _startPlanet();
        _createMoon(planetId);

        vm.expectEmit(true, true, false, true, address(moons));
        emit MoonDefenseCountChanged(planetId, Defense.RocketLauncher, 12);
        _setMoonDefenseCount(planetId, Defense.RocketLauncher, 12);

        assertEq(game.defenseCount(planetId, Defense.RocketLauncher), 0);
        assertEq(moons.moonDefenseCount(planetId, Defense.RocketLauncher), 12);
    }

    function _testMoonCombatDefenseRepairRestoresOrdinaryAndRollsDomesIndependently() internal {
        uint256 planetId = _startPlanet();
        _createMoon(planetId);
        _setMoonDefenseCount(planetId, Defense.RocketLauncher, 10);
        _setMoonDefenseCount(planetId, Defense.SmallShieldDome, 1);
        _setMoonDefenseCount(planetId, Defense.LargeShieldDome, 1);

        uint256 destroyedDefenses = uint256(10)
            | (uint256(1) << (uint256(uint8(Defense.SmallShieldDome)) * 32))
            | (uint256(1) << (uint256(uint8(Defense.LargeShieldDome)) * 32));
        vm.prank(address(game));
        moons.applyMoonCombatDefenseChanges(planetId, destroyedDefenses, false);

        uint256 repairedDefenses = VeydriftCatalog.repairedDefenseCounts(destroyedDefenses, 0);
        vm.expectEmit(true, true, false, true, address(moons));
        emit MoonDefenseCountChanged(planetId, Defense.RocketLauncher, 7);
        vm.expectEmit(true, true, false, true, address(moons));
        emit MoonDefenseCountChanged(planetId, Defense.SmallShieldDome, 1);
        vm.prank(address(game));
        moons.applyMoonCombatDefenseChanges(planetId, repairedDefenses, true);

        assertEq(moons.moonDefenseCount(planetId, Defense.RocketLauncher), 7);
        assertEq(moons.moonDefenseCount(planetId, Defense.SmallShieldDome), 1);
        assertEq(moons.moonDefenseCount(planetId, Defense.LargeShieldDome), 0);
        assertEq(game.defenseCount(planetId, Defense.RocketLauncher), 0);
        assertEq(game.defenseCount(planetId, Defense.SmallShieldDome), 0);
        assertEq(game.defenseCount(planetId, Defense.LargeShieldDome), 0);
    }

    function _testPlanetToMoonTransportMovesCargoAndReturnsShips() internal {
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

    function _testPlanetToMoonTransportUsesOgameClassicLocalDistance() internal {
        uint256 planetId = _startPlanet();
        _createMoon(planetId);
        _fundPlanet(planetId, 20_000, 20_000, 20_000);
        _setShipCount(planetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.warp(1_700_000_000);
        vm.prank(player);
        uint256 missionId = game.launchBodyFleetMission(
            planetId,
            planetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            false,
            true
        );

        (,,,,, uint64 departureAt, uint64 arrivalAt, uint64 returnAt,,,) =
            game.fleetMission(missionId);
        uint256 expectedTravelSeconds = VeydriftAntiRaidPrimitives.travelSeconds(5, 5_000, 100, 1);

        assertEq(arrivalAt - departureAt, expectedTravelSeconds);
        assertEq(returnAt - arrivalAt, expectedTravelSeconds);
        assertGt(arrivalAt - departureAt, 10);
    }

    function _testMoonToPlanetTransportSpendsMoonResourcesAndReturnsMoonShips() internal {
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

    function _testDeployStationsFleetOnMoonWithoutReturnLeg() internal {
        uint256 planetId = _startPlanet();
        _createMoon(planetId);
        _fundPlanet(planetId, 20_000, 20_000, 20_000);
        _setShipCount(planetId, Ship.SmallCargo, 1);
        uint256 scoreBeforeLaunch = game.playerScore(player);

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
        assertEq(game.playerScore(player), scoreBeforeLaunch);

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        game.resolveFleetMission(missionId);

        assertEq(game.shipCount(planetId, Ship.SmallCargo), 0);
        assertEq(_moonShipCount(planetId, Ship.SmallCargo), 1);
        assertEq(game.playerScore(player), scoreBeforeLaunch);
    }

    function _testArrivedMoonDeploySettlesBeforeNextMoonOriginLaunchChecks() internal {
        uint256 planetId = _startPlanet();
        _createMoon(planetId);
        _fundPlanet(planetId, 20_000, 20_000, 20_000);
        _setShipCount(planetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 deployMissionId = game.launchBodyFleetMission(
            planetId,
            planetId,
            VeydriftGameStorage.FleetMissionType.Deploy,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 100}),
            100,
            false,
            true
        );

        (, uint64 arrivalAt,,) = _fleetMission(deployMissionId);
        vm.warp(arrivalAt);

        // No explicit resolve call: launchBodyFleetMission's prologue must settle the arrived Deploy,
        // release its only fleet slot, credit the moon ship, and then consume that ship for this launch.
        vm.prank(player);
        uint256 moonOriginMissionId = game.launchBodyFleetMission(
            planetId,
            planetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            true,
            false
        );

        assertGt(moonOriginMissionId, deployMissionId);
        assertEq(game.activeFleetMissionCount(player), 1);
        assertEq(_moonShipCount(planetId, Ship.SmallCargo), 0);
    }

    function _testMoonAttackLaunchStoresMoonBodyFlags() internal {
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

    function _testMoonAttackLaunchStoresSelectedLootRatio() internal {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMoonAttackPlanets();
        _fundMoon(originPlanetId, 20_000, 20_000, 20_000);
        _fundMoon(targetPlanetId, 10_000, 10_000, 10_000);
        _setMoonShipCount(originPlanetId, Ship.SmallCargo, 1);

        uint256 missionId = _launchMoonAttackWithLootRatio(originPlanetId, targetPlanetId);
        uint256 availableCapacity = 5_000 - _fleetFuelCost(missionId);
        VeydriftGameStorage.Resources memory cargo = _resolveAttackAndGetCargo(missionId);
        assertEq(cargo.metal, (availableCapacity * 2_000) / 10_000);
        assertEq(cargo.crystal, (availableCapacity * 5_000) / 10_000);
        assertEq(cargo.deuterium, availableCapacity - cargo.metal - cargo.crystal);
    }

    function _testAcsJoinPreservesMoonTargetAndEmitsBodyMetadata() internal {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMoonAttackPlanets();
        address ally = address(0xA77A);
        vm.deal(ally, 1 ether);
        vm.prank(ally);
        uint256 allyPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetLocation(allyPlanetId, ally, 1, 100, 8);
        _fundPlanet(originPlanetId, 20_000, 20_000, 20_000);
        _fundPlanet(allyPlanetId, 20_000, 20_000, 20_000);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(allyPlanetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
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

        vm.recordLogs();
        vm.prank(ally);
        uint256 joinedMissionId = game.joinAttackMission(
            allyPlanetId,
            attackMissionId,
            targetPlanetId,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
        );

        _assertFleetMissionBodiesLog(vm.getRecordedLogs(), joinedMissionId, false, true);
    }

    function _testAcsJoinCanLaunchFromMoonInventoryAndResources() internal {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMoonAttackPlanets();
        address ally = address(0xA77A);
        vm.deal(ally, 1 ether);
        vm.prank(ally);
        uint256 allyPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetLocation(allyPlanetId, ally, 1, 100, 8);
        _createMoon(allyPlanetId);
        _fundPlanet(originPlanetId, 20_000, 20_000, 20_000);
        _fundMoon(allyPlanetId, 20_000, 20_000, 20_000);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setMoonShipCount(allyPlanetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
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

        vm.recordLogs();
        vm.prank(ally);
        uint256 joinedMissionId = game.joinBodyAttackMission(
            allyPlanetId,
            attackMissionId,
            targetPlanetId,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            true
        );

        _assertFleetMissionBodiesLog(vm.getRecordedLogs(), joinedMissionId, true, true);
        assertEq(_moonShipCount(allyPlanetId, Ship.SmallCargo), 0);
        assertEq(game.shipCount(allyPlanetId, Ship.SmallCargo), 0);
        assertLt(_moonResources(allyPlanetId).deuterium, 20_000);
    }

    function _testAcsJoinFailsClosedWhenTargetMoonDisappears() internal {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) =
            _seedMoonAttackPlanets();
        address ally = address(0xA77A);
        vm.deal(ally, 1 ether);
        vm.prank(ally);
        uint256 allyPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetLocation(allyPlanetId, ally, 1, 100, 8);
        _fundPlanet(originPlanetId, 20_000, 20_000, 20_000);
        _fundPlanet(allyPlanetId, 20_000, 20_000, 20_000);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(allyPlanetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
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

        vm.mockCall(
            address(moons),
            abi.encodeWithSignature("moon(uint256)", targetPlanetId),
            abi.encode(false, targetPlanetId, defender, uint16(0), uint16(0), uint64(0), uint64(0))
        );
        vm.prank(ally);
        vm.expectRevert(VeydriftGameStorage.NoPlanet.selector);
        game.joinAttackMission(
            allyPlanetId,
            attackMissionId,
            targetPlanetId,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
        );
    }

    function _testPlanetToMoonAttackHonorsSelectedLootRatio() internal {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMoonAttackPlanets();
        _fundPlanet(originPlanetId, 20_000, 20_000, 20_000);
        _fundMoon(targetPlanetId, 10_000, 10_000, 10_000);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 missionId = game.launchBodyAttackMission(
            originPlanetId,
            targetPlanetId,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            false,
            true,
            VeydriftGameStorage.LootRatio({metalBps: 0, crystalBps: 10_000, deuteriumBps: 0})
        );

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 659);
        game.resolveFleetMission(missionId);

        (,,, VeydriftGameStorage.Resources memory cargo) = _fleetMission(missionId);
        assertEq(cargo.metal, 0);
        assertGt(cargo.crystal, 0);
        assertEq(cargo.deuterium, 0);
    }

    function _testMoonToPlanetAttackHonorsSelectedLootRatio() internal {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMoonAttackPlanets();
        _fundMoon(originPlanetId, 20_000, 20_000, 20_000);
        _fundPlanet(targetPlanetId, 10_000, 10_000, 10_000);
        _setMoonShipCount(originPlanetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 missionId = game.launchBodyAttackMission(
            originPlanetId,
            targetPlanetId,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            true,
            false,
            VeydriftGameStorage.LootRatio({metalBps: 0, crystalBps: 0, deuteriumBps: 10_000})
        );

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 659);
        game.resolveFleetMission(missionId);

        (,,, VeydriftGameStorage.Resources memory cargo) = _fleetMission(missionId);
        assertEq(cargo.metal, 0);
        assertEq(cargo.crystal, 0);
        assertGt(cargo.deuterium, 0);
    }

    function _testMoonAttackRejectsInvalidLootRatio() internal {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMoonAttackPlanets();
        _fundMoon(originPlanetId, 20_000, 20_000, 20_000);
        _setMoonShipCount(originPlanetId, Ship.SmallCargo, 1);
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.InvalidLootRatio.selector);
        game.launchBodyAttackMission(
            originPlanetId,
            targetPlanetId,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            true,
            true,
            VeydriftGameStorage.LootRatio({metalBps: 3_000, crystalBps: 3_000, deuteriumBps: 3_000})
        );
    }

    function _testMoonAttackRaidsMoonResourcesWithoutTouchingParentPlanet() internal {
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

    function _testPostBattleScoreProtectionKeepsPreCombatPlanetAndMoonPlunder() internal {
        uint256 snapshot = vm.snapshotState();
        _assertPostBattleScoreProtectionKeepsPreCombatPlunder(false);
        assertTrue(vm.revertToState(snapshot));
        _assertPostBattleScoreProtectionKeepsPreCombatPlunder(true);
    }

    function _assertPostBattleScoreProtectionKeepsPreCombatPlunder(bool targetIsMoon) internal {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMoonAttackPlanets();
        _fundPlanet(originPlanetId, 100_000, 100_000, 100_000);
        if (targetIsMoon) _fundMoon(targetPlanetId, 30_000, 30_000, 30_000);
        else _fundPlanet(targetPlanetId, 30_000, 30_000, 30_000);
        // Keep both players within the 1.5x newbie band before launch and after the attacking ship
        // leaves the origin. The deathstar's high combat power per score then destroys enough of
        // the defender's score for protection to become active only during the battle.
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 7);
        _setShipCount(originPlanetId, Ship.Deathstar, 1);
        if (targetIsMoon) _setMoonShipCount(targetPlanetId, Ship.LightFighter, 150);
        else _setShipCount(targetPlanetId, Ship.LightFighter, 150);

        VeydriftGameStorage.MissionShips memory ships;
        ships.deathstar = 1;
        vm.prank(player);
        uint256 missionId = game.launchBodyFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            false,
            targetIsMoon
        );

        (VeydriftGameStorage.AttackBlockReason launchReason,,) =
            _attackBodyProtectionStatus(player, targetPlanetId, targetIsMoon);
        assertEq(uint8(launchReason), uint8(VeydriftGameStorage.AttackBlockReason.None));

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 659);
        _resolveAttackFully(missionId);

        uint32 defenderShips = targetIsMoon
            ? _moonShipCount(targetPlanetId, Ship.LightFighter)
            : game.shipCount(targetPlanetId, Ship.LightFighter);
        assertLt(defenderShips, 150, "battle must reduce defender score");
        (VeydriftGameStorage.AttackBlockReason settlementReason,,) =
            _attackBodyProtectionStatus(player, targetPlanetId, targetIsMoon);
        assertEq(
            uint8(settlementReason), uint8(VeydriftGameStorage.AttackBlockReason.ScoreProtection)
        );

        (,,, VeydriftGameStorage.Resources memory cargo) = _fleetMission(missionId);
        assertGt(
            uint256(cargo.metal) + cargo.crystal + cargo.deuterium,
            0,
            "post-combat score change erased the pre-combat plunder rate"
        );
    }

    function _testPlanetToMoonAttackLootCapacityIncludesFuel() internal {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMoonAttackPlanets();
        _fundPlanet(originPlanetId, 200_000, 200_000, 200_000);
        _fundMoon(targetPlanetId, 0, 100_000, 100_045);
        _setShipCount(originPlanetId, Ship.LargeCargo, 4);

        VeydriftGameStorage.MissionShips memory ships;
        ships.largeCargo = 4;

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
        (,,,,,,,, uint128 fuelCost,,) = game.fleetMission(missionId);
        assertEq(fuelCost, 24);

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 6524);
        game.resolveFleetMission(missionId);

        (,,, VeydriftGameStorage.Resources memory attackCargo) = _fleetMission(missionId);
        assertEq(
            attackCargo.metal + attackCargo.crystal + attackCargo.deuterium, 100_000 - fuelCost
        );
        assertEq(attackCargo.metal, 0);
        assertEq(attackCargo.crystal, 50_000);
        assertEq(attackCargo.deuterium, 50_000 - fuelCost);
    }

    function _testMoonAttackMutatesMoonDefensesNotPlanetDefenses() internal {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) =
            _seedMoonAttackPlanets();
        // This fixture validates moon/planet defense separation, not score protection.
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3_000);
        _setTechnologyLevel(defender, Technology.IntergalacticResearchNetwork, 3_000);
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

        assertEq(moons.moonDefenseCount(targetPlanetId, Defense.RocketLauncher), 70);
        assertEq(game.defenseCount(targetPlanetId, Defense.RocketLauncher), 0);
    }

    function _testPendingMoonAttackBlocksParentPlanetActionsUntilResolved() internal {
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

    function _testPlanetAndMoonTargetsHaveIndependentBashingAllowances() internal {
        vm.warp(8 days);
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) =
            _seedMoonAttackPlanets();
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3_000);
        _setTechnologyLevel(defender, Technology.IntergalacticResearchNetwork, 3_000);
        _setTechnologyLevel(player, Technology.Computer, 10);
        _fundPlanet(originPlanetId, 1_000_000, 1_000_000, 1_000_000);
        _setShipCount(originPlanetId, Ship.SmallCargo, 8);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        for (uint256 i = 0; i < VeydriftAntiRaidPrimitives.MAX_ATTACKS_PER_BASHING_WINDOW; i++) {
            vm.prank(player);
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

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.AttackBashingLimitReached.selector);
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

        vm.prank(player);
        uint256 planetAttackId = game.launchBodyFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            false,
            false
        );
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(planetAttackId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
    }

    function _testMoonBashingWindowInheritsActiveLegacyAllowanceAtUpgrade() internal {
        vm.warp(8 days);
        MoonAttackWindowHarness harness = new MoonAttackWindowHarness();
        address attacker = address(0xA771);
        address defender = address(0xD3F3);
        uint256 planetId = 77;
        harness.seedTarget(planetId, defender);
        harness.setMoonAttackParityActivatedAt(0);

        for (uint256 i = 0; i < VeydriftAntiRaidPrimitives.MAX_ATTACKS_PER_BASHING_WINDOW; i++) {
            harness.recordLegacyAttack(attacker, planetId);
        }
        harness.setMoonAttackParityActivatedAt(uint64(block.timestamp));

        uint32 legacyCount = VeydriftAntiRaidPrimitives.MAX_ATTACKS_PER_BASHING_WINDOW;
        assertEq(harness.bodyAttackCount(attacker, defender, planetId, false), legacyCount);
        assertEq(harness.bodyAttackCount(attacker, defender, planetId, true), legacyCount);

        harness.recordMoonAttack(attacker, planetId);
        assertEq(harness.bodyAttackCount(attacker, defender, planetId, true), legacyCount + 1);
        assertEq(harness.bodyAttackCount(attacker, defender, planetId, false), legacyCount + 1);

        vm.warp(block.timestamp + VeydriftAntiRaidPrimitives.BASHING_WINDOW_SECONDS);
        harness.recordMoonAttack(attacker, planetId);
        assertEq(harness.bodyAttackCount(attacker, defender, planetId, true), 1);
        assertEq(harness.bodyAttackCount(attacker, defender, planetId, false), 0);
    }

    function _testPlanetDefenseHoldDoesNotDefendMoonAttack() internal {
        MoonDefenseHoldIsolationHarness harness = new MoonDefenseHoldIsolationHarness();
        harness.seedPlanetHold(77, 1, 100);
        assertEq(harness.link(77, 2, 200, true), 0);
        assertEq(harness.link(77, 3, 200, false), 1);
    }

    function _testMoonAttackParityInitializerIsIdempotent() internal {
        uint64 activatedAt = game.moonAttackParityActivatedAt();
        assertGt(activatedAt, 0);
        game.initializeMoonAttackParity();
        assertEq(game.moonAttackParityActivatedAt(), activatedAt);
    }

    function _testReturnFromDestroyedOriginMoonFallsBackToParentPlanet() internal {
        uint256 originPlanetId = _startPlanet();
        _createMoon(originPlanetId);
        _fundMoon(originPlanetId, 20_000, 20_000, 20_000);
        _setMoonShipCount(originPlanetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 missionId = game.launchBodyFleetMission(
            originPlanetId,
            originPlanetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources({metal: 100, crystal: 0, deuterium: 0}),
            100,
            true,
            false
        );

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        game.resolveFleetMission(missionId);
        (,, uint64 returnAt,) = _fleetMission(missionId);
        uint64 oldGeneration = moons.moonGeneration(originPlanetId);
        _destroyMoonGuaranteed(originPlanetId);
        _createMoon(originPlanetId);
        assertGt(moons.moonGeneration(originPlanetId), oldGeneration);

        vm.recordLogs();
        vm.warp(returnAt);
        game.completeFleetMissionReturn(missionId);
        _assertFleetMissionBodiesLog(vm.getRecordedLogs(), missionId, false, false);
        assertTrue(moons.moon(originPlanetId).exists);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 1);
        assertEq(game.moonShipCount(originPlanetId, Ship.SmallCargo), 0);
    }

    function _testArrivalAtDestroyedTargetMoonReturnsWithoutGhostState() internal {
        uint256 originPlanetId = _startPlanet();
        uint256 targetPlanetId = originPlanetId;
        _createMoon(targetPlanetId);
        _fundPlanet(originPlanetId, 20_000, 20_000, 20_000);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 missionId = game.launchBodyFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources({metal: 100, crystal: 50, deuterium: 0}),
            100,
            false,
            true
        );

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        uint64 oldGeneration = moons.moonGeneration(targetPlanetId);
        _destroyMoonGuaranteed(targetPlanetId);
        _createMoon(targetPlanetId);
        assertGt(moons.moonGeneration(targetPlanetId), oldGeneration);
        vm.warp(arrivalAt);
        game.resolveFleetMission(missionId);

        (
            VeydriftGameStorage.FleetMissionStatus status,,,
            VeydriftGameStorage.Resources memory cargo
        ) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(cargo.metal, 100);
        assertEq(cargo.crystal, 50);
        assertTrue(moons.moon(targetPlanetId).exists);
        VeydriftGameStorage.Resources memory ghostResources = _moonResources(targetPlanetId);
        assertEq(ghostResources.metal + ghostResources.crystal + ghostResources.deuterium, 0);
        assertEq(game.moonShipCount(targetPlanetId, Ship.SmallCargo), 0);
    }

    function _testAttackDoesNotHitReplacementMoonCreatedBeforeArrival() internal {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMoonAttackPlanets();
        _fundPlanet(originPlanetId, 20_000, 20_000, 20_000);
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
        uint64 oldGeneration = moons.moonGeneration(targetPlanetId);
        _destroyMoonGuaranteed(targetPlanetId);
        _createMoon(targetPlanetId);
        assertGt(moons.moonGeneration(targetPlanetId), oldGeneration);
        _fundMoon(targetPlanetId, 777, 555, 333);
        _setMoonDefenseCount(targetPlanetId, Defense.RocketLauncher, 4);

        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 659);
        game.resolveFleetMission(missionId);

        (
            VeydriftGameStorage.FleetMissionStatus status,,,
            VeydriftGameStorage.Resources memory cargo
        ) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(cargo.metal + cargo.crystal + cargo.deuterium, 0);
        VeydriftGameStorage.Resources memory replacementResources = _moonResources(targetPlanetId);
        assertEq(replacementResources.metal, 777);
        assertEq(replacementResources.crystal, 555);
        assertEq(replacementResources.deuterium, 333);
        assertEq(moons.moonDefenseCount(targetPlanetId, Defense.RocketLauncher), 4);
    }

    // VEY-KANEO-468: a due moon-building construction completes lazily on the next moon interaction,
    // with no finishMoonBuildingUpgrade tx required.
    function _testMoonBuildingSettlesLazilyWithoutFinishTx() internal {
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
        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.LunarBase), 1);
        assertEq(moons.moon(planetId).fields, 4);
        assertTrue(moons.activeMoonBuildingConstruction(planetId).active);

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

    function _launchMoonAttackWithLootRatio(uint256 originPlanetId, uint256 targetPlanetId)
        internal
        returns (uint256 missionId)
    {
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        uint256 expectedMissionId = game.nextFleetId();
        vm.expectEmit(true, false, false, true, address(game));
        emit FleetMissionLootRatio(expectedMissionId, 2_000, 5_000, 3_000);
        vm.prank(player);
        missionId = game.launchBodyAttackMission(
            originPlanetId,
            targetPlanetId,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            true,
            true,
            VeydriftGameStorage.LootRatio({metalBps: 2_000, crystalBps: 5_000, deuteriumBps: 3_000})
        );
        assertEq(missionId, expectedMissionId);
    }

    function _fleetFuelCost(uint256 missionId) internal view returns (uint128 fuelCost) {
        (,,,,,,,, fuelCost,,) = game.fleetMission(missionId);
    }

    function _resolveAttackAndGetCargo(uint256 missionId)
        internal
        returns (VeydriftGameStorage.Resources memory cargo)
    {
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 659);
        game.resolveFleetMission(missionId);
        (,,, cargo) = _fleetMission(missionId);
    }

    function _destroyMoonGuaranteed(uint256 planetId) internal {
        uint256 battleId = 10_000 + planetId;
        VeydriftMoonSystem.Moon memory moon = moons.moon(planetId);
        uint16 moonDestructionBps = moons.moonDestructionChanceBps(moon.diameterKm, 1);
        vm.prank(reporter);
        (uint256 outcomeId, uint256 requestId) =
            moons.requestMoonDestructionFromBattle(battleId, planetId, reporter, 1);
        uint256 randomWord = uint256(moonDestructionBps - 1) + uint256(9_999) * 10_000;
        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, randomWord);
        (bool moonDestroyed,) = moons.finalizeMoonDestruction(outcomeId);
        assertTrue(moonDestroyed);
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

    function _resolveAttackFully(uint256 missionId) internal {
        for (uint256 calls = 0; calls < 6; calls++) {
            (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
            if (status != VeydriftGameStorage.FleetMissionStatus.Outbound) return;
            game.resolveFleetMission(missionId);
        }
        revert("attack did not resolve");
    }

    function _attackBodyProtectionStatus(
        address attacker,
        uint256 targetPlanetId,
        bool targetIsMoon
    )
        internal
        view
        returns (VeydriftGameStorage.AttackBlockReason reason, uint8 flags, uint16 plunderBps)
    {
        (bool ok, bytes memory data) = address(game)
            .staticcall(
                abi.encodeWithSelector(
                    game.attackBodyProtectionStatus.selector, attacker, targetPlanetId, targetIsMoon
                )
            );
        assertTrue(ok);
        return abi.decode(data, (VeydriftGameStorage.AttackBlockReason, uint8, uint16));
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

contract VeydriftMoonSystemCoreTest is VeydriftMoonSystemTestBase {
    function testProxyInitializationAndOwnerUpgradeGate() public {
        _testProxyInitializationAndOwnerUpgradeGate();
    }

    function testDirectPlayerMoonCreationReverts() public {
        _testDirectPlayerMoonCreationReverts();
    }

    function testMoonGenerationWritesFailClosedAcrossPausedUpgradeBoundary() public {
        _testMoonGenerationWritesFailClosedAcrossPausedUpgradeBoundary();
    }

    function testAdminMoonCreationAndLunarBaseFields() public {
        _testAdminMoonCreationAndLunarBaseFields();
    }

    function testChickenBurnGrantCreatesMoonForOwnedPlanet() public {
        _testChickenBurnGrantCreatesMoonForOwnedPlanet();
    }

    function testChickenBurnGrantRejectsDuplicateBurnEvent() public {
        _testChickenBurnGrantRejectsDuplicateBurnEvent();
    }

    function testChickenBurnGrantAllowsMoreThanTwoMoonsForAPlayer() public {
        _testChickenBurnGrantAllowsMoreThanTwoMoonsForAPlayer();
    }

    function testChickenBurnGrantRejectsWrongOwnerAndMissingPlanet() public {
        _testChickenBurnGrantRejectsWrongOwnerAndMissingPlanet();
    }

    function testChickenBurnGrantIsAdminOnly() public {
        _testChickenBurnGrantIsAdminOnly();
    }

    function testMoonChanceCalculationAndCap() public view {
        _testMoonChanceCalculationAndCap();
    }

    function testMoonDestructionParityChances() public view {
        _testMoonDestructionParityChances();
    }

    function testBattleMoonChanceRequestsRandomnessAndBlocksPendingOutcome() public {
        _testBattleMoonChanceRequestsRandomnessAndBlocksPendingOutcome();
    }

    function testFulfilledMoonChanceCreatesMoonDeterministically() public {
        _testFulfilledMoonChanceCreatesMoonDeterministically();
    }

    function testFulfilledMoonChanceCanResolveNoMoon() public {
        _testFulfilledMoonChanceCanResolveNoMoon();
    }

    function testMoonChanceRejectsDuplicateRerollAndExistingMoonSkipsCreation() public {
        _testMoonChanceRejectsDuplicateRerollAndExistingMoonSkipsCreation();
    }

    function testMoonChanceRequiresReporterAndQualifyingDebris() public {
        _testMoonChanceRequiresReporterAndQualifyingDebris();
    }

    function testMoonDestructionRequestsRandomnessAndDestroysMoonState() public {
        _testMoonDestructionRequestsRandomnessAndDestroysMoonState();
    }

    function testMoonDestructionCanDestroyDeathstarsWithoutDestroyingMoon() public {
        _testMoonDestructionCanDestroyDeathstarsWithoutDestroyingMoon();
    }

    function testMoonDestructionRejectsInvalidRequestsAndDuplicates() public {
        _testMoonDestructionRejectsInvalidRequestsAndDuplicates();
    }

    function testMoonBuildingUpgradeSpendsMoonResources() public {
        _testMoonBuildingUpgradeSpendsMoonResources();
    }

    function testMoonFacilitiesUnlockWithMoonRoboticsAndFields() public {
        _testMoonFacilitiesUnlockWithMoonRoboticsAndFields();
    }

    function testMoonFieldCapacityRequiresOpenFieldEvenForLunarBase() public {
        _testMoonFieldCapacityRequiresOpenFieldEvenForLunarBase();
    }

    function testMoonFacilitiesUseSingleActiveConstructionSlot() public {
        _testMoonFacilitiesUseSingleActiveConstructionSlot();
    }

    function testMoonDefenseConstructionUsesMoonShipyardAndSeparateCounts() public {
        _testMoonDefenseConstructionUsesMoonShipyardAndSeparateCounts();
    }

    function testMoonDefenseBacklogQueuesMixedTypesAndDrainsFifo() public {
        _testMoonDefenseBacklogQueuesMixedTypesAndDrainsFifo();
    }

    function testMoonDefenseBacklogCountsQueuedShieldCapacity() public {
        _testMoonDefenseBacklogCountsQueuedShieldCapacity();
    }

    function testMoonDefenseIsEffectiveWhenDueAndReconcilesOnNextMutationOnce() public {
        _testMoonDefenseIsEffectiveWhenDueAndReconcilesOnNextMutationOnce();
    }

    function testLegacyFinishWrappersAreIdempotentAndSharedMutationSettlesBothQueues() public {
        _testLegacyFinishWrappersAreIdempotentAndSharedMutationSettlesBothQueues();
    }

    function testStartingMoonDefenseReconcilesDueShipyardFirst() public {
        _testStartingMoonDefenseReconcilesDueShipyardFirst();
    }

    function testMoonDefenseRequiresMoonShipyard() public {
        _testMoonDefenseRequiresMoonShipyard();
    }

    function testJumpGateRequiresOwnedReadyMoonGates() public {
        _testJumpGateRequiresOwnedReadyMoonGates();
    }

    function testJumpGateMovesShipsBetweenOwnedMoons() public {
        _testJumpGateMovesShipsBetweenOwnedMoons();
    }

    function testJumpGateShipMovementEmitsMoonShipCountChangedForBothMoons() public {
        _testJumpGateShipMovementEmitsMoonShipCountChangedForBothMoons();
    }
}

contract VeydriftMoonAttackParityTest is VeydriftMoonSystemTestBase {
    function testMoonDefenseCountsAreIndependentFromPlanetDefenses() public {
        _testMoonDefenseCountsAreIndependentFromPlanetDefenses();
    }

    function testMoonCombatDefenseRepairRestoresOrdinaryAndRollsDomesIndependently() public {
        _testMoonCombatDefenseRepairRestoresOrdinaryAndRollsDomesIndependently();
    }

    function testPlanetToMoonTransportMovesCargoAndReturnsShips() public {
        _testPlanetToMoonTransportMovesCargoAndReturnsShips();
    }

    function testPlanetToMoonTransportUsesOgameClassicLocalDistance() public {
        _testPlanetToMoonTransportUsesOgameClassicLocalDistance();
    }

    function testMoonToPlanetTransportSpendsMoonResourcesAndReturnsMoonShips() public {
        _testMoonToPlanetTransportSpendsMoonResourcesAndReturnsMoonShips();
    }

    function testDeployStationsFleetOnMoonWithoutReturnLeg() public {
        _testDeployStationsFleetOnMoonWithoutReturnLeg();
    }

    function testArrivedMoonDeploySettlesBeforeNextMoonOriginLaunchChecks() public {
        _testArrivedMoonDeploySettlesBeforeNextMoonOriginLaunchChecks();
    }

    function testMoonAttackLaunchStoresMoonBodyFlags() public {
        _testMoonAttackLaunchStoresMoonBodyFlags();
    }

    function testMoonAttackLaunchStoresSelectedLootRatio() public {
        _testMoonAttackLaunchStoresSelectedLootRatio();
    }

    function testAcsJoinPreservesMoonTargetAndEmitsBodyMetadata() public {
        _testAcsJoinPreservesMoonTargetAndEmitsBodyMetadata();
    }

    function testAcsJoinCanLaunchFromMoonInventoryAndResources() public {
        _testAcsJoinCanLaunchFromMoonInventoryAndResources();
    }

    function testAcsJoinFailsClosedWhenTargetMoonDisappears() public {
        _testAcsJoinFailsClosedWhenTargetMoonDisappears();
    }

    function testPlanetToMoonAttackHonorsSelectedLootRatio() public {
        _testPlanetToMoonAttackHonorsSelectedLootRatio();
    }

    function testMoonToPlanetAttackHonorsSelectedLootRatio() public {
        _testMoonToPlanetAttackHonorsSelectedLootRatio();
    }

    function testMoonAttackRejectsInvalidLootRatio() public {
        _testMoonAttackRejectsInvalidLootRatio();
    }

    function testMoonAttackRaidsMoonResourcesWithoutTouchingParentPlanet() public {
        _testMoonAttackRaidsMoonResourcesWithoutTouchingParentPlanet();
    }

    function testPostBattleScoreProtectionKeepsPreCombatPlanetAndMoonPlunder() public {
        _testPostBattleScoreProtectionKeepsPreCombatPlanetAndMoonPlunder();
    }

    function testPlanetToMoonAttackLootCapacityIncludesFuel() public {
        _testPlanetToMoonAttackLootCapacityIncludesFuel();
    }

    function testMoonAttackMutatesMoonDefensesNotPlanetDefenses() public {
        _testMoonAttackMutatesMoonDefensesNotPlanetDefenses();
    }

    function testPendingMoonAttackBlocksParentPlanetActionsUntilResolved() public {
        _testPendingMoonAttackBlocksParentPlanetActionsUntilResolved();
    }

    function testPlanetAndMoonTargetsHaveIndependentBashingAllowances() public {
        _testPlanetAndMoonTargetsHaveIndependentBashingAllowances();
    }

    function testMoonBashingWindowInheritsActiveLegacyAllowanceAtUpgrade() public {
        _testMoonBashingWindowInheritsActiveLegacyAllowanceAtUpgrade();
    }

    function testPlanetDefenseHoldDoesNotDefendMoonAttack() public {
        _testPlanetDefenseHoldDoesNotDefendMoonAttack();
    }

    function testMoonAttackParityInitializerIsIdempotent() public {
        _testMoonAttackParityInitializerIsIdempotent();
    }

    function testReturnFromDestroyedOriginMoonFallsBackToParentPlanet() public {
        _testReturnFromDestroyedOriginMoonFallsBackToParentPlanet();
    }

    function testArrivalAtDestroyedTargetMoonReturnsWithoutGhostState() public {
        _testArrivalAtDestroyedTargetMoonReturnsWithoutGhostState();
    }

    function testAttackDoesNotHitReplacementMoonCreatedBeforeArrival() public {
        _testAttackDoesNotHitReplacementMoonCreatedBeforeArrival();
    }

    function testMoonBuildingSettlesLazilyWithoutFinishTx() public {
        _testMoonBuildingSettlesLazilyWithoutFinishTx();
    }
}
