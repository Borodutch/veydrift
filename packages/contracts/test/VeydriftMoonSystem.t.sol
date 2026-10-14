// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftCombatRaidModule} from "../src/VeydriftCombatRaidModule.sol";
import {VeydriftStagedCombatModule} from "../src/VeydriftStagedCombatModule.sol";
import {
    VeydriftLegacyCombatModule,
    VeydriftLegacyCombatRapidfire
} from "../src/VeydriftLegacyCombatModule.sol";

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {Vm} from "forge-std/Vm.sol";
import {ProductionBatchTransactionProbe} from "./ProductionBatchTransactionProbe.sol";
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
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {IVeydriftDelegation} from "../src/interfaces/IVeydriftDelegation.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {VeydriftDependencies} from "../src/libraries/VeydriftDependencies.sol";
import {VeydriftAntiRaidPrimitives} from "../src/libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {VeydriftFormulas} from "../src/libraries/VeydriftFormulas.sol";
import {VeydriftMoonDefenseBacklog} from "../src/libraries/VeydriftMoonDefenseBacklog.sol";
import {VeydriftMoonShipBacklog} from "../src/libraries/VeydriftMoonShipBacklog.sol";
import {VeydriftBodyAttackWindow} from "../src/libraries/VeydriftBodyAttackWindow.sol";
import {
    Building,
    Defense,
    MoonBuilding,
    Resource,
    Ship,
    Technology,
    ProductionOrder
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

abstract contract VeydriftMoonSystemTestBase is Test {
    uint128 internal constant RESERVE_FUNDING = 1_000_000_000_000;

    address internal admin = address(0xA11CE);
    address internal player = address(0xB0B);
    address internal fulfiller = address(0xF111);
    address internal reporter = address(0xBABB1E);
    address internal delegate = address(0xD1E);
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
        VeydriftCombatModule combatModule = new VeydriftCombatModule(
            address(new VeydriftCombatRapidfire()),
            address(new VeydriftStagedCombatModule(address(new VeydriftCombatRapidfire()))),
            address(new VeydriftLegacyCombatModule(address(new VeydriftLegacyCombatRapidfire())))
        );
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftAttackProtectionModule attackProtectionModule = new VeydriftAttackProtectionModule();
        VeydriftColonizationModule colonizationModule =
            new VeydriftColonizationModule(address(new VeydriftShipProductionModule()));
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();
        VeydriftStateMigrationModule stateMigrationModule = new VeydriftStateMigrationModule(
            address(0xBEEF), address(new VeydriftCombatRaidModule())
        );
        VeydriftFirstPlanetSettlementModule firstPlanetSettlementModule =
            new VeydriftFirstPlanetSettlementModule(address(0xBEEF), address(colonizationModule));
        game = VeydriftGame(
            payable(deployCode(
                    // Avoid the unoptimized .tests artifact when multiple profiles are cached.
                    "VeydriftGame.sol:VeydriftGame:0.8.28:default",
                    abi.encode(
                        admin,
                        address(firstPlanetSettlementModule),
                        address(gameplayModule),
                        address(planetManagementModule),
                        address(attackProtectionModule),
                        address(colonizationModule),
                        address(defenseHoldModule),
                        address(stateMigrationModule),
                        address(new VeydriftAcsAttackModule())
                    )
                ))
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
        vm.deal(delegate, 1 ether);
    }

    function _testDelegateAndMainCanManageMoonUntilRevoked() internal {
        uint256 planetId = _startPlanet();
        _createMoon(planetId);
        _fundMoon(planetId, 100_000, 100_000, 100_000);
        IVeydriftDelegation delegation = IVeydriftDelegation(address(game));
        vm.prank(player);
        delegation.setDelegate(delegate);

        vm.prank(delegate);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.LunarBase);
        assertTrue(moons.activeMoonBuildingConstruction(planetId).active);

        vm.prank(delegate);
        delegation.revokeDelegate();
        vm.prank(delegate);
        vm.expectRevert(VeydriftMoonSystem.NotMoonOwner.selector);
        moons.finishMoonBuildingUpgrade(planetId);

        vm.prank(player);
        moons.finishMoonBuildingUpgrade(planetId);
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
        assertEq(
            uint256(vm.load(address(game), keccak256(abi.encode(missionId, uint256(86))))),
            1,
            "launch must opt in atomically"
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
        _allyWithAttacker(ally);
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
        assertEq(
            uint256(vm.load(address(game), keccak256(abi.encode(attackMissionId, uint256(86))))),
            1,
            "launch must opt in atomically"
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
        assertEq(
            uint256(vm.load(address(game), keccak256(abi.encode(joinedMissionId, uint256(86))))),
            1,
            "launch must opt in atomically"
        );

        _assertFleetMissionBodiesLog(vm.getRecordedLogs(), joinedMissionId, false, true);
    }

    function _testAcsJoinCanLaunchFromMoonInventoryAndResources() internal {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMoonAttackPlanets();
        address ally = address(0xA77A);
        vm.deal(ally, 1 ether);
        vm.prank(ally);
        uint256 allyPlanetId = game.startPlanet{value: 0.05 ether}();
        _allyWithAttacker(ally);
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
        assertEq(
            uint256(vm.load(address(game), keccak256(abi.encode(attackMissionId, uint256(86))))),
            1,
            "launch must opt in atomically"
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
        assertEq(
            uint256(vm.load(address(game), keccak256(abi.encode(joinedMissionId, uint256(86))))),
            1,
            "launch must opt in atomically"
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
        _allyWithAttacker(ally);
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
        assertEq(
            uint256(vm.load(address(game), keccak256(abi.encode(missionId, uint256(86))))),
            1,
            "launch must opt in atomically"
        );

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 659);
        _resolveAttackFully(missionId);

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
        assertEq(
            uint256(vm.load(address(game), keccak256(abi.encode(missionId, uint256(86))))),
            1,
            "launch must opt in atomically"
        );

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 659);
        _resolveAttackFully(missionId);

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
        _resolveAttackFully(missionId);

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
        _resolveAttackFully(missionId);

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
        _resolveAttackFully(missionId);

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
        _resolveAttackFully(missionId);

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
        _resolveAttackFully(missionId);

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

    /// ACS joins need the attack owner's consent: put `member` in `player`'s alliance.
    function _allyWithAttacker(address member) internal {
        VeydriftAllianceSystem alliance =
            new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)));
        vm.prank(admin);
        game.setAllianceSystem(address(alliance));
        vm.prank(player);
        uint256 allianceId = alliance.createAlliance("ATK", "Attackers", "ipfs://attackers");
        vm.prank(player);
        alliance.inviteMember(allianceId, member);
        vm.prank(member);
        alliance.acceptInvite(allianceId);
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
        _resolveAttackFully(missionId);
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
        for (uint256 calls = 0; calls < 20_000; calls++) {
            (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
            if (status != VeydriftGameStorage.FleetMissionStatus.Outbound) return;
            (uint8 beforePhase,, uint256 beforeWork) = game.stagedBattleProgress(missionId);
            game.resolveFleetMission{gas: 15_000_000}(missionId);
            (uint8 afterPhase,, uint256 afterWork) = game.stagedBattleProgress(missionId);
            if (beforePhase != 0) {
                assertTrue(
                    afterPhase != beforePhase || afterWork > beforeWork,
                    "resolver made no durable progress"
                );
            }
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
    function testDelegateAndMainCanManageMoonUntilRevoked() public {
        _testDelegateAndMainCanManageMoonUntilRevoked();
    }

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

contract VeydriftMoonProductionBatchTest is VeydriftMoonSystemTestBase {
    function _readyMoonShipyard() private returns (uint256 planetId) {
        planetId = _startPlanet();
        _createMoon(planetId);
        _fundPlanet(planetId, 10_000_000, 10_000_000, 10_000_000);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.Shipyard);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
    }

    function _twoMoonAttacksAroundPaidProduction(bool lateTargetsMoon, bool mature)
        private
        returns (uint256 earlyId, uint256 lateId, uint256 target, address defender)
    {
        (uint256 origin, uint256 moonPlanet, address owner_) = _seedMoonAttackPlanets();
        target = moonPlanet;
        defender = owner_;
        bytes32 outer = keccak256(abi.encode(target, uint256(7)));
        vm.store(
            address(moons),
            keccak256(abi.encode(uint256(uint8(MoonBuilding.Shipyard)), outer)),
            bytes32(uint256(1))
        );
        _setTechnologyLevel(defender, Technology.CombustionDrive, 2);
        _setTechnologyLevel(player, Technology.Computer, 2);
        _fundMoon(target, 1_000_000, 1_000_000, 100_000);
        vm.prank(defender);
        moons.startMoonShipProduction(target, Ship.LightFighter, 4);
        VeydriftMoonShipBacklog.Entry memory queue = moons.activeMoonShipQueue(target);
        _fundPlanet(origin, 1_000_000, 1_000_000, 1_000_000);
        _setShipCount(origin, Ship.Battleship, 2);
        VeydriftGameStorage.MissionShips memory ships;
        ships.battleship = 1;
        vm.prank(player);
        lateId = game.launchBodyFleetMission(
            origin,
            target,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            100,
            false,
            lateTargetsMoon
        );
        vm.prank(player);
        earlyId = game.launchBodyFleetMission(
            origin,
            target,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            100,
            false,
            true
        );
        // Two real launches and combat seeds; fix the arrival window around a paid manufacturing
        // interval so battle/cutoff behavior is independent of the map's travel speed.
        _storeFleetMission(
            lateId,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            VeydriftGameStorage.FleetMissionType.Attack,
            player,
            origin,
            target,
            queue.startedAt,
            queue.readyAt + 1,
            queue.readyAt + 1
        );
        _storeFleetMission(
            earlyId,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            VeydriftGameStorage.FleetMissionType.Attack,
            player,
            origin,
            target,
            queue.startedAt,
            queue.startedAt + 1,
            queue.startedAt + 1
        );
        _fulfillAttackBattleRandomness(earlyId, 659);
        _fulfillAttackBattleRandomness(lateId, 660);
        if (mature) vm.warp(queue.readyAt + 2);
    }

    function _battleDefenderMetalLoss(Vm.Log[] memory logs, uint256 missionId)
        private
        pure
        returns (uint128)
    {
        bytes32 topic =
            keccak256("CombatLosses(uint256,uint128,uint128,uint128,uint128,uint128,uint128)");
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].topics.length < 2 || logs[i].topics[0] != topic
                    || uint256(logs[i].topics[1]) != missionId
            ) {
                continue;
            }
            (,,, uint128 metal,,) =
                abi.decode(logs[i].data, (uint128, uint128, uint128, uint128, uint128, uint128));
            return metal;
        }
        revert("combat loss event missing");
    }

    function testTwoMoonAttacksReverseExplicitResolvePreservesHistoricalDefenders() public {
        (uint256 earlyId, uint256 lateId, uint256 target,) =
            _twoMoonAttacksAroundPaidProduction(true, true);
        (, uint64 earlyAt,,) = _fleetMission(earlyId);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.FleetMissionNotResolved.selector, earlyAt)
        );
        game.resolveFleetMission(lateId);
        assertEq(game.moonShipCount(target, Ship.LightFighter), 0);
        vm.recordLogs();
        _resolveAttackFully(earlyId);
        Vm.Log[] memory earlyLogs = vm.getRecordedLogs();
        assertEq(_battleDefenderMetalLoss(earlyLogs, earlyId), 0);
        assertEq(game.moonShipCount(target, Ship.LightFighter), 0);
        vm.recordLogs();
        _resolveAttackFully(lateId);
        assertGt(_battleDefenderMetalLoss(vm.getRecordedLogs(), lateId), 0);
    }

    function testEarlierMoonArrivalDoesNotBlockIndependentParentPlanetAttack() public {
        (uint256 earlyId, uint256 lateId, uint256 target, address defender) =
            _twoMoonAttacksAroundPaidProduction(false, true);
        // Independent planet combat must neither wait for the moon nor settle its future ships.
        _resolveAttackFully(lateId);
        assertEq(game.moonShipCount(target, Ship.LightFighter), 0);
        _resolveAttackFully(earlyId);
        _resolveAttackFully(lateId);
        assertEq(game.moonShipCount(target, Ship.LightFighter), 0);
        vm.prank(defender);
        moons.finishMoonShipProduction(target);
        assertTrue(game.moonShipCount(target, Ship.LightFighter) > 0);
    }

    function testLazyMoonCombatLandsEarlierDeployBeforeLaterMoonAttack() public {
        (uint256 earlyId, uint256 lateId, uint256 target, address defender) =
            _twoMoonAttacksAroundPaidProduction(true, false);
        (, uint64 earlyAt,,) = _fleetMission(earlyId);
        (, uint64 lateAt,,) = _fleetMission(lateId);
        _fundPlanet(target, 100_000, 100_000, 100_000);
        _setShipCount(target, Ship.SmallCargo, 1);
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(defender);
        uint256 deployId = game.launchBodyFleetMission(
            target,
            target,
            VeydriftGameStorage.FleetMissionType.Deploy,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            100,
            false,
            true
        );
        _storeFleetMission(
            deployId,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            VeydriftGameStorage.FleetMissionType.Deploy,
            defender,
            target,
            target,
            earlyAt - 1,
            earlyAt - 1,
            earlyAt - 1
        );
        vm.warp(lateAt + 2);
        vm.recordLogs();
        vm.prank(defender);
        game.renamePlanet(target, "arrivals first");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(_battleDefenderMetalLoss(logs, earlyId), 0);
        assertGt(_battleDefenderMetalLoss(logs, lateId), 0);
    }

    function testLazyMoonCombatResolvesEarlierImpactBeforeLaterLaunchOrder() public {
        (uint256 earlyId, uint256 lateId, uint256 target, address defender) =
            _twoMoonAttacksAroundPaidProduction(true, true);
        vm.recordLogs();
        vm.prank(defender);
        game.renamePlanet(target, "chronological");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_battleDefenderMetalLoss(logs, earlyId), 0);
        assertGt(_battleDefenderMetalLoss(logs, lateId), 0);
        (VeydriftGameStorage.FleetMissionStatus earlyStatus,,,) = _fleetMission(earlyId);
        (VeydriftGameStorage.FleetMissionStatus lateStatus,,,) = _fleetMission(lateId);
        assertTrue(earlyStatus != VeydriftGameStorage.FleetMissionStatus.Outbound);
        assertTrue(lateStatus != VeydriftGameStorage.FleetMissionStatus.Outbound);
    }

    function _seedBatchPrerequisites(uint256 planetId) private {
        bytes32 outer = keccak256(abi.encode(planetId, uint256(7)));
        vm.store(
            address(moons),
            keccak256(abi.encode(uint256(uint8(MoonBuilding.Shipyard)), outer)),
            bytes32(uint256(12))
        );
        for (uint8 i; i <= uint8(Technology.Graviton); ++i) {
            _setTechnologyLevel(player, Technology(i), 12);
        }
    }

    function _batchDefense(uint256 i) private pure returns (Defense) {
        Defense[6] memory types_ = [
            Defense.PlasmaTurret,
            Defense.GaussCannon,
            Defense.IonCannon,
            Defense.HeavyLaser,
            Defense.LightLaser,
            Defense.RocketLauncher
        ];
        return types_[i % types_.length];
    }

    function _costlyBatchOrders() private pure returns (ProductionOrder[] memory orders) {
        orders = new ProductionOrder[](15);
        Ship[7] memory ships = [
            Ship.Deathstar,
            Ship.Reaper,
            Ship.Battlecruiser,
            Ship.Destroyer,
            Ship.Bomber,
            Ship.Battleship,
            Ship.Cruiser
        ];
        for (uint256 i; i < 13; ++i) {
            orders[i] = ProductionOrder(
                // i % 2 is either 0 or 1 and fits uint8.
                // forge-lint: disable-next-line(unsafe-typecast)
                uint8(i % 2),
                i % 2 == 0 ? uint8(ships[i / 2]) : uint8(_batchDefense(i / 2)),
                // This loop has i < 13, so i + 1 is at most 13 and fits uint32.
                // forge-lint: disable-next-line(unsafe-typecast)
                uint32(i + 1)
            );
        }
        // Both singleton guards run after a long heterogeneous defense backlog.
        orders[13] = ProductionOrder(1, uint8(Defense.SmallShieldDome), 1);
        orders[14] = ProductionOrder(1, uint8(Defense.LargeShieldDome), 1);
    }

    function _batchCost(ProductionOrder[] memory orders)
        private
        pure
        returns (VeydriftGameStorage.Resources memory total)
    {
        for (uint256 i; i < orders.length; ++i) {
            (uint128 metal, uint128 crystal, uint128 deuterium) = orders[i].kind == 0
                ? VeydriftCatalog.shipCost(Ship(orders[i].itemId))
                : VeydriftCatalog.defenseCost(Defense(orders[i].itemId));
            total.metal += metal * orders[i].quantity;
            total.crystal += crystal * orders[i].quantity;
            total.deuterium += deuterium * orders[i].quantity;
        }
    }

    function testMixedMoonBatchCumulativeOverspendRollsBackBothLanes() public {
        uint256 planetId = _readyMoonShipyard();
        _fundMoon(planetId, 5_000, 5_000, 0);
        ProductionOrder[] memory orders = new ProductionOrder[](2);
        orders[0] = ProductionOrder(0, uint8(Ship.LightFighter), 1);
        orders[1] = ProductionOrder(1, uint8(Defense.RocketLauncher), 2);
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.InsufficientResources.selector, 2_000, 4_000, 0
            )
        );
        moons.startMoonProductionBatch(planetId, orders);
        assertFalse(moons.activeMoonShipQueue(planetId).active);
        assertFalse(moons.activeMoonDefenseQueue(planetId).active);
        assertEq(_moonResources(planetId).metal, 5_000);

        orders[1].quantity = 1;
        vm.prank(player);
        moons.startMoonProductionBatch(planetId, orders);
        assertEq(moons.activeMoonShipQueue(planetId).quantity, 1);
        assertEq(moons.activeMoonDefenseQueue(planetId).quantity, 1);
        assertEq(_moonResources(planetId).metal, 0);
        assertEq(_moonResources(planetId).crystal, 4_000);
    }

    function testMoonShipQueueHistoricalCutoffPartialAndSeparateInventory() public {
        uint256 planetId = _readyMoonShipyard();
        _fundMoon(planetId, 100_000, 100_000, 0);
        vm.prank(player);
        moons.startMoonShipProduction(planetId, Ship.LightFighter, 4);
        VeydriftMoonShipBacklog.Entry memory queued = moons.activeMoonShipQueue(planetId);
        vm.warp(queued.readyAt + 100);
        vm.prank(address(game));
        moons.settleMoonShipProductionUntil(planetId, queued.startedAt + 1);
        assertEq(game.moonShipCount(planetId, Ship.LightFighter), 0);
        vm.prank(address(game));
        moons.settleMoonShipProductionUntil(planetId, queued.readyAt - 1);
        assertEq(game.moonShipCount(planetId, Ship.LightFighter), 3);
        assertEq(game.shipCount(planetId, Ship.LightFighter), 0);
        vm.prank(address(game));
        moons.settleMoonShipProductionUntil(planetId, queued.readyAt - 1);
        assertEq(game.moonShipCount(planetId, Ship.LightFighter), 3);
        vm.prank(player);
        moons.finishMoonShipProduction(planetId);
        assertEq(game.moonShipCount(planetId, Ship.LightFighter), 4);
        assertFalse(moons.activeMoonShipQueue(planetId).active);
    }

    function testMoonShipsFailClosedBeforeGameCutoffUpgrade() public {
        uint256 planetId = _readyMoonShipyard();
        _fundMoon(planetId, 100_000, 100_000, 0);
        vm.mockCall(
            address(game),
            abi.encodeWithSignature("moonShipProductionVersion()"),
            abi.encode(uint8(0))
        );
        vm.prank(player);
        vm.expectRevert(VeydriftMoonSystem.InvalidQuantity.selector);
        moons.startMoonShipProduction(planetId, Ship.LightFighter, 1);
        assertFalse(moons.activeMoonShipQueue(planetId).active);
    }

    function testBodyScopedSnapshotsSettleOnlyRequestedMoonAtHistoricalCutoff() public {
        uint256 planetId = _readyMoonShipyard();
        _fundMoon(planetId, 100_000, 100_000, 0);
        vm.prank(player);
        moons.startMoonShipProduction(planetId, Ship.LightFighter, 4);
        VeydriftMoonShipBacklog.Entry memory queued = moons.activeMoonShipQueue(planetId);
        vm.warp(queued.readyAt + 200);
        vm.prank(address(game));
        game.completeAttackTargetSnapshotQueues(planetId, queued.readyAt - 1);
        assertEq(game.moonShipCount(planetId, Ship.LightFighter), 0, "planet snapshot touched moon");
        vm.prank(address(game));
        moons.settleMoonShipProductionUntil(planetId, queued.readyAt - 1);
        assertEq(game.moonShipCount(planetId, Ship.LightFighter), 3);
        vm.prank(address(game));
        moons.settleMoonShipProductionUntil(planetId, queued.readyAt - 1);
        assertEq(game.moonShipCount(planetId, Ship.LightFighter), 3);
    }

    function testMoonBatchRejectsUnauthorizedPausedAndPlanetOnlyShip() public {
        uint256 planetId = _readyMoonShipyard();
        _fundMoon(planetId, 100_000, 100_000, 100_000);
        ProductionOrder[] memory orders = new ProductionOrder[](1);
        orders[0] = ProductionOrder(0, uint8(Ship.LightFighter), 1);
        vm.expectRevert(VeydriftMoonSystem.NotMoonOwner.selector);
        moons.startMoonProductionBatch(planetId, orders);
        vm.prank(player);
        IVeydriftDelegation(address(game)).setDelegate(delegate);
        vm.prank(delegate);
        moons.startMoonProductionBatch(planetId, orders);
        vm.prank(admin);
        game.setGamePaused(true);
        vm.prank(player);
        vm.expectRevert();
        moons.startMoonProductionBatch(planetId, orders);
        vm.prank(admin);
        game.setGamePaused(false);
        orders[0].itemId = uint8(Ship.SolarSatellite);
        vm.prank(player);
        vm.expectRevert(VeydriftMoonSystem.InvalidQuantity.selector);
        moons.startMoonProductionBatch(planetId, orders);
        orders[0].quantity = 0;
        vm.prank(player);
        vm.expectRevert();
        moons.startMoonProductionBatch(planetId, orders);
    }

    function testMoonDestructionClearsPaidShipBacklogAndReplacementGeneration() public {
        uint256 planetId = _readyMoonShipyard();
        _fundMoon(planetId, 100_000, 100_000, 0);
        uint64 generation = moons.moonGeneration(planetId);
        vm.startPrank(player);
        moons.startMoonShipProduction(planetId, Ship.LightFighter, 5);
        moons.startMoonShipProduction(planetId, Ship.LightFighter, 2);
        vm.stopPrank();
        assertEq(moons.moonShipQueueBacklog(planetId).length, 1);

        VeydriftMoonSystem.Moon memory moonRef = moons.moon(planetId);
        uint16 chance = moons.moonDestructionChanceBps(moonRef.diameterKm, 1);
        vm.prank(reporter);
        (uint256 outcomeId, uint256 requestId) =
            moons.requestMoonDestructionFromBattle(12_897, planetId, reporter, 1);
        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, uint256(chance - 1) + uint256(9_999) * 10_000);
        (bool destroyed,) = moons.finalizeMoonDestruction(outcomeId);
        assertTrue(destroyed);
        assertFalse(moons.activeMoonShipQueue(planetId).active);
        assertEq(moons.moonShipQueueBacklog(planetId).length, 0);
        _createMoon(planetId);
        assertGt(moons.moonGeneration(planetId), generation);
        assertFalse(moons.activeMoonShipQueue(planetId).active);
        assertEq(game.moonShipCount(planetId, Ship.LightFighter), 0);
    }

    function testMoonBatchRejectsPendingCombatBeforeSpending() public {
        (uint256 origin, uint256 target, address defender) = _seedMoonAttackPlanets();
        _fundPlanet(origin, 100_000, 100_000, 100_000);
        _setShipCount(origin, Ship.SmallCargo, 1);
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 missionId = game.launchBodyFleetMission(
            origin,
            target,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            100,
            false,
            true
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        ProductionOrder[] memory orders = new ProductionOrder[](1);
        orders[0] = ProductionOrder(0, uint8(Ship.LightFighter), 1);
        vm.prank(defender);
        vm.expectRevert();
        moons.startMoonProductionBatch(target, orders);
        assertFalse(moons.activeMoonShipQueue(target).active);
    }

    function testMoonFinishCannotCreditPostImpactShipsDuringPendingCombat() public {
        (uint256 origin, uint256 target, address defender) = _seedMoonAttackPlanets();
        // This fixture starts the defender as another player; provision its Moon Shipyard directly.
        bytes32 outer = keccak256(abi.encode(target, uint256(7)));
        bytes32 shipyardSlot = keccak256(abi.encode(uint256(uint8(MoonBuilding.Shipyard)), outer));
        vm.store(address(moons), shipyardSlot, bytes32(uint256(1)));
        _setTechnologyLevel(defender, Technology.CombustionDrive, 2);
        _fundMoon(target, 1_000_000, 1_000_000, 100_000);
        vm.prank(defender);
        moons.startMoonShipProduction(target, Ship.LightFighter, 100);
        uint64 readyAt = moons.activeMoonShipQueue(target).readyAt;

        _fundPlanet(origin, 100_000, 100_000, 100_000);
        _setShipCount(origin, Ship.SmallCargo, 1);
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 missionId = game.launchBodyFleetMission(
            origin,
            target,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            100,
            false,
            true
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(readyAt > arrivalAt ? readyAt : arrivalAt + 1);
        vm.prank(defender);
        vm.expectRevert();
        moons.finishMoonShipProduction(target);
        assertEq(game.moonShipCount(target, Ship.LightFighter), 0);
        assertTrue(moons.activeMoonShipQueue(target).active);
    }

    function testMoonBatchFifteenMixedOrdersAndSixteenthRejected() public {
        uint256 planetId = _readyMoonShipyard();
        _setTechnologyLevel(player, Technology.Shielding, 2);
        _fundMoon(planetId, 1_000_000, 1_000_000, 1_000_000);
        ProductionOrder[] memory orders = new ProductionOrder[](15);
        for (uint256 i; i < 15; ++i) {
            orders[i] = ProductionOrder(
                // i % 2 is either 0 or 1 and fits uint8.
                // forge-lint: disable-next-line(unsafe-typecast)
                uint8(i % 2),
                i % 2 == 0
                    ? uint8(Ship.LightFighter)
                    : (i == 13 ? uint8(Defense.SmallShieldDome) : uint8(Defense.RocketLauncher)),
                i % 4 == 3 && i != 13 ? 10 : 1
            );
        }
        uint256 beforeGas = gasleft();
        vm.prank(player);
        moons.startMoonProductionBatch(planetId, orders);
        uint256 used = beforeGas - gasleft();
        emit log_named_uint("moon 15 mixed rows execution gas", used);
        assertLt(
            used + 21_000 + 16
                * abi.encodeCall(moons.startMoonProductionBatch, (planetId, orders)).length,
            12_000_000
        );
        assertEq(moons.moonShipQueueBacklog(planetId).length, 7);
        assertEq(moons.moonDefenseQueueBacklog(planetId).length, 6);
        ProductionOrder[] memory tooMany = new ProductionOrder[](16);
        for (uint256 i; i < 16; ++i) {
            tooMany[i] = orders[i % 15];
        }
        vm.prank(player);
        vm.expectRevert(VeydriftMoonSystem.InvalidQuantity.selector);
        moons.startMoonProductionBatch(planetId, tooMany);
        assertEq(moons.moonShipQueueBacklog(planetId).length, 7);
    }

    function testMoonBatchFifteenShipsLastRowOverspendRollsBack() public {
        uint256 planetId = _readyMoonShipyard();
        _fundMoon(planetId, 44_999, 14_999, 0);
        ProductionOrder[] memory orders = new ProductionOrder[](15);
        for (uint256 i; i < 15; ++i) {
            orders[i] = ProductionOrder(0, uint8(Ship.LightFighter), 1);
        }
        vm.prank(player);
        vm.expectRevert();
        moons.startMoonProductionBatch(planetId, orders);
        assertFalse(moons.activeMoonShipQueue(planetId).active);
        assertEq(moons.moonShipQueueBacklog(planetId).length, 0);
        assertEq(_moonResources(planetId).metal, 44_999);
        _fundMoon(planetId, 45_000, 15_000, 0);
        uint256 beforeGas = gasleft();
        vm.prank(player);
        moons.startMoonProductionBatch(planetId, orders);
        emit log_named_uint("moon 15 ship rows execution gas", beforeGas - gasleft());
        assertEq(moons.moonShipQueueBacklog(planetId).length, 14);
        orders = new ProductionOrder[](1);
        orders[0] = ProductionOrder(0, uint8(Ship.LightFighter), 1);
        for (uint256 i; i < 2; ++i) {
            _fundMoon(planetId, 3_000, 1_000, 0);
            vm.prank(player);
            moons.startMoonProductionBatch(planetId, orders);
        }
        assertEq(moons.moonShipQueueBacklog(planetId).length, 16);
        _fundMoon(planetId, 3_000, 1_000, 0);
        vm.prank(player);
        vm.expectRevert(VeydriftMoonSystem.InvalidQuantity.selector);
        moons.startMoonProductionBatch(planetId, orders);
        assertEq(moons.moonShipQueueBacklog(planetId).length, 16);
    }

    function testMoonBatchFifteenDefensesFIFOAndLastRowCapacityRollback() public {
        uint256 planetId = _readyMoonShipyard();
        _seedBatchPrerequisites(planetId);
        _fundMoon(planetId, 100_000_000, 100_000_000, 100_000_000);
        ProductionOrder[] memory orders = new ProductionOrder[](15);
        for (uint256 i; i < orders.length; ++i) {
            // orders has 15 entries, so i + 1 is at most 15 and fits uint32.
            // forge-lint: disable-next-line(unsafe-typecast)
            orders[i] = ProductionOrder(1, uint8(_batchDefense(i)), uint32(i + 1));
        }
        VeydriftGameStorage.Resources memory cost = _batchCost(orders);
        vm.cool(address(game));
        vm.cool(address(moons));
        uint256 beforeGas = gasleft();
        vm.prank(player);
        moons.startMoonProductionBatch(planetId, orders);
        uint256 used = beforeGas - gasleft();
        uint256 upper = used + 21_000 + 16
            * abi.encodeCall(moons.startMoonProductionBatch, (planetId, orders)).length;
        emit log_named_uint("moon 15 defense-only execution gas", used);
        emit log_named_uint("moon 15 defense-only intrinsic/calldata upper bound", upper);
        assertLt(upper, 12_000_000);
        assertLt(upper, 16_777_216);
        assertEq(_moonResources(planetId).metal, 100_000_000 - cost.metal);
        assertEq(_moonResources(planetId).crystal, 100_000_000 - cost.crystal);
        assertEq(_moonResources(planetId).deuterium, 100_000_000 - cost.deuterium);
        VeydriftMoonDefenseBacklog.Entry memory active = moons.activeMoonDefenseQueue(planetId);
        VeydriftMoonDefenseBacklog.Entry[] memory pending = moons.moonDefenseQueueBacklog(planetId);
        assertTrue(active.active);
        assertEq(uint8(active.defense), orders[0].itemId);
        assertEq(active.quantity, orders[0].quantity);
        assertEq(pending.length, 14);
        uint64 previousReady = active.readyAt;
        for (uint256 i; i < pending.length; ++i) {
            assertTrue(pending[i].active);
            assertEq(uint8(pending[i].defense), orders[i + 1].itemId);
            assertEq(pending[i].quantity, orders[i + 1].quantity);
            assertGt(pending[i].readyAt, previousReady);
            previousReady = pending[i].readyAt;
        }
        assertFalse(moons.activeMoonShipQueue(planetId).active);
        assertEq(moons.moonShipQueueBacklog(planetId).length, 0);

        // At active + 14 pending, two rows fit; ONLY the third (last) row overflows.
        // Snapshot complete paid queues and all resource/reserve components, not just lengths.
        bytes32 beforeState = keccak256(
            abi.encode(
                _moonResources(planetId),
                game.resourceReserveRequirement(),
                moons.activeMoonDefenseQueue(planetId),
                moons.moonDefenseQueueBacklog(planetId),
                moons.activeMoonShipQueue(planetId),
                moons.moonShipQueueBacklog(planetId)
            )
        );
        ProductionOrder[] memory overflow = new ProductionOrder[](3);
        for (uint256 i; i < overflow.length; ++i) {
            // overflow has 3 entries, so i + 1 is at most 3 and fits uint32.
            // forge-lint: disable-next-line(unsafe-typecast)
            overflow[i] = ProductionOrder(1, uint8(_batchDefense(i)), uint32(i + 1));
        }
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftMoonDefenseBacklog.MoonDefenseBacklogFull.selector, planetId
            )
        );
        moons.startMoonProductionBatch(planetId, overflow);
        assertEq(
            keccak256(
                abi.encode(
                    _moonResources(planetId),
                    game.resourceReserveRequirement(),
                    moons.activeMoonDefenseQueue(planetId),
                    moons.moonDefenseQueueBacklog(planetId),
                    moons.activeMoonShipQueue(planetId),
                    moons.moonShipQueueBacklog(planetId)
                )
            ),
            beforeState
        );
        // The same prefix succeeds and reaches the actual active + 16 pending boundary.
        ProductionOrder[] memory fits = new ProductionOrder[](2);
        fits[0] = overflow[0];
        fits[1] = overflow[1];
        vm.prank(player);
        moons.startMoonProductionBatch(planetId, fits);
        assertEq(moons.moonDefenseQueueBacklog(planetId).length, 16);
    }

    function testMoonBatchMeasuredAtLoadedBacklogs() public {
        uint256 planetId = _readyMoonShipyard();
        _fundMoon(planetId, 1_000_000, 1_000_000, 1_000_000);
        vm.startPrank(player);
        for (uint256 i; i < 12; ++i) {
            moons.startMoonShipProduction(planetId, Ship.LightFighter, 1);
            moons.startMoonDefenseProduction(planetId, Defense.RocketLauncher, 1);
        }
        vm.stopPrank();
        ProductionOrder[] memory orders = new ProductionOrder[](4);
        orders[0] = ProductionOrder(0, uint8(Ship.LightFighter), 1);
        orders[1] = ProductionOrder(1, uint8(Defense.RocketLauncher), 1);
        orders[2] = ProductionOrder(0, uint8(Ship.LightFighter), 1);
        orders[3] = ProductionOrder(1, uint8(Defense.RocketLauncher), 1);
        uint256 beforeGas = gasleft();
        vm.prank(player);
        moons.startMoonProductionBatch(planetId, orders);
        uint256 used = beforeGas - gasleft();
        emit log_named_uint("moon 4-order batch with 11+11 backlogs", used);
        assertLt(used, 12_000_000);
        assertEq(moons.moonShipQueueBacklog(planetId).length, 13);
        assertEq(moons.moonDefenseQueueBacklog(planetId).length, 13);
    }

    /// forge-config: default.isolate = true
    function testMoonBatchDrainsMaximumReadyPreexistingBacklogsWithinGasCeiling() public {
        uint256 planetId = _readyMoonShipyard();
        _seedBatchPrerequisites(planetId);
        _fundMoon(planetId, 10_000_000_000, 10_000_000_000, 10_000_000_000);
        Ship[7] memory ships = [
            Ship.Deathstar,
            Ship.Reaper,
            Ship.Battlecruiser,
            Ship.Destroyer,
            Ship.Bomber,
            Ship.Battleship,
            Ship.Cruiser
        ];
        vm.startPrank(player);
        // Actual maximum: one active AND sixteen pending in EACH lane.
        // Heterogeneous rows force differing inventory keys and non-identical FIFO shifts.
        for (uint256 i; i < 17; ++i) {
            moons.startMoonShipProduction(planetId, ships[i % 7], 100);
            moons.startMoonDefenseProduction(planetId, _batchDefense(i), 100);
        }
        vm.stopPrank();
        assertTrue(moons.activeMoonShipQueue(planetId).active);
        assertTrue(moons.activeMoonDefenseQueue(planetId).active);
        assertEq(moons.moonShipQueueBacklog(planetId).length, 16);
        assertEq(moons.moonDefenseQueueBacklog(planetId).length, 16);
        uint64 shipsReady = moons.moonShipQueueBacklog(planetId)[15].readyAt;
        uint64 defensesReady = moons.moonDefenseQueueBacklog(planetId)[15].readyAt;
        vm.warp(shipsReady > defensesReady ? shipsReady : defensesReady);
        ProductionOrder[] memory orders = _costlyBatchOrders();
        // Isolation executes every top-level CALL in a fresh EVM transaction:
        // committed original storage, cleared transient storage, and cold modules/libraries.
        // Check that semantic boundary rather than relying on vm.cool (warmth only).
        ProductionBatchTransactionProbe probe = new ProductionBatchTransactionProbe();
        probe.write(1);
        (uint256 storageGas, uint256 transientValue) = probe.write(2);
        assertGe(storageGas, 5_000, "requires clean committed storage: enable isolation");
        assertEq(transientValue, 0, "requires a fresh transaction transient store");

        bytes memory callData = abi.encodeCall(moons.startMoonProductionBatch, (planetId, orders));
        uint256 intrinsic = 21_000;
        for (uint256 i; i < callData.length; ++i) {
            intrinsic += callData[i] == 0 ? 4 : 16;
        }
        vm.prank(player);
        // Forge isolation adds 21k to this call allowance: a real 12m transaction.
        moons.startMoonProductionBatch{gas: 12_000_000 - 21_000}(planetId, orders);
        Vm.Gas memory measured = vm.lastCallGas();
        // Isolated lastCallGas includes intrinsic and deducts refunds. Add refunds
        // back: they cannot finance execution or avoid the transaction gas limit.
        assertGe(measured.gasRefunded, 0);
        uint256 upper = measured.gasTotalUsed + uint256(uint64(measured.gasRefunded));
        emit log_named_uint("moon committed settlement execution gas", upper - intrinsic);
        emit log_named_uint("moon committed settlement intrinsic/calldata gas", intrinsic);
        emit log_named_uint("moon committed settlement gross transaction gas", upper);
        emit log_named_uint(
            "moon committed settlement charged transaction gas", measured.gasTotalUsed
        );
        assertLt(upper, 12_000_000);
        assertLt(upper, 16_777_216);
        for (uint256 i; i < 7; ++i) {
            assertEq(game.moonShipCount(planetId, ships[i]), (i < 3 ? 300 : 200));
        }
        for (uint256 i; i < 6; ++i) {
            assertEq(moons.moonDefenseCount(planetId, _batchDefense(i)), (i < 5 ? 300 : 200));
        }
        assertEq(uint8(moons.activeMoonShipQueue(planetId).ship), orders[0].itemId);
        assertEq(uint8(moons.activeMoonDefenseQueue(planetId).defense), orders[1].itemId);
        assertEq(moons.moonShipQueueBacklog(planetId).length, 6);
        assertEq(moons.moonDefenseQueueBacklog(planetId).length, 7);
    }

    function testMoonBatchDuplicateDomeRevertsShipAndDefense() public {
        uint256 planetId = _readyMoonShipyard();
        _setTechnologyLevel(player, Technology.Shielding, 2);
        _fundMoon(planetId, 100_000, 100_000, 100_000);
        ProductionOrder[] memory orders = new ProductionOrder[](3);
        orders[0] = ProductionOrder(0, uint8(Ship.LightFighter), 1);
        orders[1] = ProductionOrder(1, uint8(Defense.SmallShieldDome), 1);
        orders[2] = ProductionOrder(1, uint8(Defense.SmallShieldDome), 1);
        vm.prank(player);
        vm.expectRevert(VeydriftMoonSystem.LevelTooHigh.selector);
        moons.startMoonProductionBatch(planetId, orders);
        assertFalse(moons.activeMoonShipQueue(planetId).active);
        assertFalse(moons.activeMoonDefenseQueue(planetId).active);
        assertEq(_moonResources(planetId).metal, 100_000);
    }

    function testMoonOriginLaunchCanUseShipFinishingOnThisInteraction() public {
        uint256 planetId = _readyMoonShipyard();
        _fundMoon(planetId, 100_000, 100_000, 100_000);
        vm.prank(player);
        moons.startMoonShipProduction(planetId, Ship.LightFighter, 1);
        uint64 readyAt = moons.activeMoonShipQueue(planetId).readyAt;
        vm.warp(readyAt);
        VeydriftGameStorage.MissionShips memory ships;
        ships.lightFighter = 1;
        vm.prank(player);
        uint256 missionId = game.launchBodyFleetMission(
            planetId,
            planetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources(0, 0, 0),
            100,
            true,
            false
        );
        assertGt(missionId, 0);
        assertFalse(moons.activeMoonShipQueue(planetId).active);
        assertEq(game.moonShipCount(planetId, Ship.LightFighter), 0);
    }

    function testMoonBatchRefusesFullShipBacklogWithoutAffectingPaidQueue() public {
        uint256 planetId = _readyMoonShipyard();
        _fundMoon(planetId, 1_000_000, 1_000_000, 0);
        vm.startPrank(player);
        for (uint256 i; i < 17; ++i) {
            moons.startMoonShipProduction(planetId, Ship.LightFighter, 1);
        }
        vm.stopPrank();
        assertEq(moons.moonShipQueueBacklog(planetId).length, 16);
        ProductionOrder[] memory orders = new ProductionOrder[](1);
        orders[0] = ProductionOrder(0, uint8(Ship.LightFighter), 1);
        vm.prank(player);
        vm.expectRevert(VeydriftMoonSystem.InvalidQuantity.selector);
        moons.startMoonProductionBatch(planetId, orders);
        assertEq(moons.moonShipQueueBacklog(planetId).length, 16);
    }
}

contract VeydriftBuildingDemolitionTest is VeydriftMoonSystemTestBase {
    function _setBuildingLevel(uint256 planetId, Building building, uint16 level) private {
        bytes32 outerSlot = keccak256(abi.encode(planetId, uint256(6)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(building)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(level)));
    }

    function _setDefenseCount(uint256 planetId, Defense defense, uint32 count) private {
        bytes32 outerSlot = keccak256(abi.encode(planetId, uint256(19)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(defense)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(count)));
    }

    function _planetResources(uint256 planetId)
        private
        view
        returns (VeydriftGameStorage.Resources memory)
    {
        return game.planet(planetId).resources;
    }

    function _readyMoon() private returns (uint256 planetId) {
        planetId = _startPlanet();
        _createMoon(planetId);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.Shipyard);
    }

    function _usedPlanetFields(uint256 planetId) private view returns (uint256 used) {
        for (uint8 i = 0; i <= uint8(type(Building).max); i++) {
            used += game.buildingLevel(planetId, Building(i));
        }
    }

    function testPlanetDemolitionFreesAFieldOnCompletion() public {
        uint256 planetId = _startPlanet();
        _setBuildingLevel(planetId, Building.CrystalMine, 3);
        // Park every remaining field in the Alliance Depot so the planet is full.
        uint256 openFields = game.planet(planetId).fields - _usedPlanetFields(planetId);
        _setBuildingLevel(
            planetId,
            Building.AllianceDepot,
            // casting to 'uint16' is safe because a planet has at most a few hundred fields
            // forge-lint: disable-next-line(unsafe-typecast)
            uint16(game.buildingLevel(planetId, Building.AllianceDepot) + openFields)
        );
        _fundPlanet(planetId, 1_000_000, 1_000_000, 1_000_000);
        uint256 usedBefore = _usedPlanetFields(planetId);
        assertEq(usedBefore, game.planet(planetId).fields);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.FieldCapacityReached.selector);
        game.startBuildingUpgrade(planetId, Building.MetalMine);

        vm.prank(player);
        game.startBuildingDemolition(planetId, Building.CrystalMine);
        // The field frees only when the demolition completes.
        assertEq(_usedPlanetFields(planetId), usedBefore);
        vm.warp(game.activeBuildingConstruction(planetId).readyAt);
        vm.prank(player);
        game.finishBuildingUpgrade(planetId);
        assertEq(_usedPlanetFields(planetId), usedBefore - 1);

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.MetalMine);
        assertTrue(game.activeBuildingConstruction(planetId).active);
    }

    function testMoonDemolitionFreesAFieldOnCompletion() public {
        uint256 planetId = _readyMoon();
        _fundMoon(planetId, 1_000_000, 1_000_000, 1_000_000);
        // Lunar Base 1, Robotics 2 and Shipyard 1 fill the moon.
        vm.prank(player);
        vm.expectRevert(VeydriftMoonSystem.MoonFieldCapacityReached.selector);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.RoboticsFactory);

        vm.prank(player);
        moons.startMoonBuildingDemolition(planetId, MoonBuilding.Shipyard);
        vm.warp(moons.activeMoonBuildingConstruction(planetId).readyAt);
        vm.prank(player);
        moons.finishMoonBuildingUpgrade(planetId);
        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.Shipyard), 0);

        vm.prank(player);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.RoboticsFactory);
        assertTrue(moons.activeMoonBuildingConstruction(planetId).active);
    }

    function testMoonDemolitionCountsDueIonResearch() public {
        uint256 planetId = _readyMoon();
        _fundMoon(planetId, 10_000, 10_000, 10_000);
        _fundPlanet(planetId, 10_000_000, 10_000_000, 10_000_000);
        _setBuildingLevel(planetId, Building.ResearchLab, 10);
        _setTechnologyLevel(player, Technology.Energy, 10);
        _setTechnologyLevel(player, Technology.Laser, 10);
        _setTechnologyLevel(player, Technology.Ion, 2);

        vm.prank(player);
        game.startResearch(planetId, Technology.Ion);
        vm.warp(game.researchQueue(player).readyAt);
        // Ion 3 is due but unsettled; the moon price must already use it (-12%, not -8%).
        assertEq(game.technologyLevel(player, Technology.Ion), 2);

        vm.prank(player);
        moons.startMoonBuildingDemolition(planetId, MoonBuilding.RoboticsFactory);
        assertEq(moons.activeMoonBuildingConstruction(planetId).cost.metal, 352);
    }

    function testDemolitionCostMatchesOgameVectors() public pure {
        // Metal mine (60/15, factor 1.5): 16 -> 15 with Ion 1 and 1 -> 0 with Ion 0.
        (uint256 metal, uint256 metalFull) = VeydriftFormulas.demolitionCost(60, 16, 15, 10, 1);
        (uint256 crystal, uint256 crystalFull) = VeydriftFormulas.demolitionCost(15, 16, 15, 10, 1);
        assertEq(metal, 16_815);
        assertEq(crystal, 4_203);
        assertEq(metalFull, 17_515);
        assertEq(crystalFull, 4_378);
        (metal,) = VeydriftFormulas.demolitionCost(60, 1, 15, 10, 0);
        (crystal,) = VeydriftFormulas.demolitionCost(15, 1, 15, 10, 0);
        assertEq(metal, 40);
        assertEq(crystal, 10);
        // Ion 3 = -12%; Ion 25 and above make demolition free without changing its duration input.
        (metal,) = VeydriftFormulas.demolitionCost(1_000, 2, 2, 1, 3);
        assertEq(metal, 880);
        (metal, metalFull) = VeydriftFormulas.demolitionCost(1_000, 2, 2, 1, 25);
        assertEq(metal, 0);
        assertEq(metalFull, 1_000);
        (metal,) = VeydriftFormulas.demolitionCost(1_000, 2, 2, 1, 30);
        assertEq(metal, 0);
    }

    function testPlanetDemolitionChargesIonDiscountedCostAndLowersLevel() public {
        uint256 planetId = _startPlanet();
        _setBuildingLevel(planetId, Building.MetalMine, 16);
        _setBuildingLevel(planetId, Building.RoboticsFactory, 2);
        _setTechnologyLevel(player, Technology.Ion, 1);
        _fundPlanet(planetId, 100_000, 100_000, 0);

        vm.prank(player);
        game.startBuildingDemolition(planetId, Building.MetalMine);

        VeydriftGameStorage.Resources memory left = _planetResources(planetId);
        assertEq(100_000 - left.metal, 16_815);
        assertEq(100_000 - left.crystal, 4_203);
        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        assertTrue(construction.active);
        assertEq(uint8(construction.building), uint8(Building.MetalMine));
        assertEq(construction.targetLevel, 15);
        assertEq(construction.cost.metal, 16_815);
        // Duration uses the undiscounted price: (17,515 + 4,378) * 3600 / (2500 * 3).
        assertEq(construction.readyAt, block.timestamp + (uint256(17_515 + 4_378) * 3600) / 7500);

        // Upgrades cannot share the slot, and a second demolition cannot stack.
        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.ConstructionActive.selector);
        game.startBuildingUpgrade(planetId, Building.CrystalMine);
        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.ConstructionActive.selector);
        game.startBuildingDemolition(planetId, Building.RoboticsFactory);

        vm.warp(construction.readyAt);
        vm.prank(player);
        game.finishBuildingUpgrade(planetId);
        assertEq(game.buildingLevel(planetId, Building.MetalMine), 15);
        assertFalse(game.activeBuildingConstruction(planetId).active);
    }

    function testPlanetDemolitionCancelRefundsFullCost() public {
        uint256 planetId = _startPlanet();
        _setBuildingLevel(planetId, Building.CrystalMine, 3);
        _fundPlanet(planetId, 10_000, 10_000, 0);

        vm.prank(player);
        game.startBuildingDemolition(planetId, Building.CrystalMine);
        VeydriftGameStorage.Resources memory spent = _planetResources(planetId);
        assertLt(spent.metal, 10_000);

        vm.prank(player);
        game.cancelBuildingDemolition(planetId);
        VeydriftGameStorage.Resources memory refunded = _planetResources(planetId);
        assertEq(refunded.metal, 10_000);
        assertEq(refunded.crystal, 10_000);
        assertFalse(game.activeBuildingConstruction(planetId).active);
        assertEq(game.buildingLevel(planetId, Building.CrystalMine), 3);

        // Upgrades are not cancellable through the demolition entry point.
        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.CrystalMine);
        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.ConstructionInactive.selector);
        game.cancelBuildingDemolition(planetId);
    }

    function testPlanetDemolitionCancelAfterReadyRevertsAndKeepsDowngrade() public {
        uint256 planetId = _startPlanet();
        _setBuildingLevel(planetId, Building.CrystalMine, 3);
        _fundPlanet(planetId, 10_000, 10_000, 0);

        vm.prank(player);
        game.startBuildingDemolition(planetId, Building.CrystalMine);
        vm.warp(game.activeBuildingConstruction(planetId).readyAt);
        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.ConstructionInactive.selector);
        game.cancelBuildingDemolition(planetId);

        vm.prank(player);
        game.finishBuildingUpgrade(planetId);
        assertEq(game.buildingLevel(planetId, Building.CrystalMine), 2);
    }

    function testDelegateCanDemolishAndCancelForTheirMainWallet() public {
        uint256 planetId = _startPlanet();
        _setBuildingLevel(planetId, Building.CrystalMine, 3);
        _fundPlanet(planetId, 10_000, 10_000, 0);
        vm.prank(player);
        IVeydriftDelegation(address(game)).setDelegate(delegate);

        vm.prank(delegate);
        game.startBuildingDemolition(planetId, Building.CrystalMine);
        assertTrue(game.activeBuildingConstruction(planetId).active);
        vm.prank(delegate);
        game.cancelBuildingDemolition(planetId);
        assertFalse(game.activeBuildingConstruction(planetId).active);
        assertEq(_planetResources(planetId).metal, 10_000);
    }

    function testPlanetDemolitionIsFreeFromIon25() public {
        uint256 planetId = _startPlanet();
        _setBuildingLevel(planetId, Building.SolarPlant, 10);
        _setTechnologyLevel(player, Technology.Ion, 25);
        _fundPlanet(planetId, 0, 0, 0);

        vm.prank(player);
        game.startBuildingDemolition(planetId, Building.SolarPlant);
        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        assertEq(construction.cost.metal, 0);
        assertEq(construction.cost.crystal, 0);
        assertGt(construction.readyAt, block.timestamp);
    }

    function testPlanetDemolitionRejectsExcludedBuildings() public {
        uint256 planetId = _startPlanet();
        _fundPlanet(planetId, 10_000_000, 10_000_000, 10_000_000);
        _setBuildingLevel(planetId, Building.Terraformer, 2);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.BuildingNotDemolishable.selector, Building.Terraformer
            )
        );
        game.startBuildingDemolition(planetId, Building.Terraformer);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.BuildingNotDemolishable.selector, Building.FusionReactor
            )
        );
        game.startBuildingDemolition(planetId, Building.FusionReactor);

        vm.prank(address(0xDEAD));
        vm.expectRevert(VeydriftGameStorage.NotPlanetOwner.selector);
        game.startBuildingDemolition(planetId, Building.MetalMine);
    }

    function testPlanetDemolitionBusyGuards() public {
        uint256 planetId = _startPlanet();
        _fundPlanet(planetId, 10_000_000, 10_000_000, 10_000_000);
        _setBuildingLevel(planetId, Building.Shipyard, 2);
        _setBuildingLevel(planetId, Building.NaniteFactory, 1);
        _setBuildingLevel(planetId, Building.ResearchLab, 1);
        _setBuildingLevel(planetId, Building.MissileSilo, 1);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);

        vm.prank(player);
        game.startShipProduction(planetId, Ship.LightFighter, 1);
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.BuildingInUse.selector, Building.Shipyard)
        );
        game.startBuildingDemolition(planetId, Building.Shipyard);
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.BuildingInUse.selector, Building.NaniteFactory
            )
        );
        game.startBuildingDemolition(planetId, Building.NaniteFactory);

        vm.prank(player);
        game.startResearch(planetId, Technology.Energy);
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.BuildingInUse.selector, Building.ResearchLab)
        );
        game.startBuildingDemolition(planetId, Building.ResearchLab);

        _setDefenseCount(planetId, Defense.AntiBallisticMissile, 6);
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.MissileSiloCapacityExceeded.selector, uint32(6), uint32(0)
            )
        );
        game.startBuildingDemolition(planetId, Building.MissileSilo);

        // Unrelated buildings stay demolishable while production and research run.
        _setBuildingLevel(planetId, Building.MetalMine, 2);
        vm.prank(player);
        game.startBuildingDemolition(planetId, Building.MetalMine);
        assertTrue(game.activeBuildingConstruction(planetId).active);
    }

    function testQueuedSiloDemolitionReservesLowerMissileCapacity() public {
        uint256 planetId = _startPlanet();
        _fundPlanet(planetId, 10_000_000, 10_000_000, 10_000_000);
        _setBuildingLevel(planetId, Building.Shipyard, 1);
        _setBuildingLevel(planetId, Building.MissileSilo, 3);

        vm.prank(player);
        game.startBuildingDemolition(planetId, Building.MissileSilo);
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.MissileSiloCapacityExceeded.selector, uint32(21), uint32(20)
            )
        );
        game.startDefenseProduction(planetId, Defense.AntiBallisticMissile, 21);
    }

    function testMoonDemolitionChargesCostLowersLevelAndCancelRefunds() public {
        uint256 planetId = _readyMoon();
        _setTechnologyLevel(player, Technology.Ion, 3);
        _fundMoon(planetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        moons.startMoonBuildingDemolition(planetId, MoonBuilding.RoboticsFactory);
        VeydriftMoonSystem.MoonBuildingConstruction memory construction =
            moons.activeMoonBuildingConstruction(planetId);
        // Robotics 2 -> 1 costs level-1 robotics (400/120/200) less 12%.
        assertEq(construction.targetLevel, 1);
        assertEq(construction.cost.metal, 352);
        assertEq(construction.cost.crystal, 105);
        assertEq(construction.cost.deuterium, 176);
        VeydriftGameStorage.Resources memory left = _moonResources(planetId);
        assertEq(left.metal, 10_000 - 352);

        vm.prank(player);
        vm.expectRevert(VeydriftMoonSystem.ConstructionActive.selector);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.JumpGate);

        vm.prank(player);
        moons.cancelMoonBuildingDemolition(planetId);
        assertEq(_moonResources(planetId).metal, 10_000);
        assertFalse(moons.activeMoonBuildingConstruction(planetId).active);

        vm.prank(player);
        moons.startMoonBuildingDemolition(planetId, MoonBuilding.RoboticsFactory);
        vm.warp(moons.activeMoonBuildingConstruction(planetId).readyAt);
        vm.prank(player);
        moons.finishMoonBuildingUpgrade(planetId);
        assertEq(moons.moonBuildingLevel(planetId, MoonBuilding.RoboticsFactory), 1);
    }

    function testMoonDemolitionRejectsLunarBaseAndBusyShipyard() public {
        uint256 planetId = _readyMoon();
        _fundMoon(planetId, 1_000_000, 1_000_000, 1_000_000);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftMoonSystem.MoonBuildingNotDemolishable.selector, MoonBuilding.LunarBase
            )
        );
        moons.startMoonBuildingDemolition(planetId, MoonBuilding.LunarBase);
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftMoonSystem.MoonBuildingNotDemolishable.selector, MoonBuilding.JumpGate
            )
        );
        moons.startMoonBuildingDemolition(planetId, MoonBuilding.JumpGate);

        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        vm.prank(player);
        moons.startMoonShipProduction(planetId, Ship.LightFighter, 1);
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftMoonSystem.MoonBuildingInUse.selector, MoonBuilding.Shipyard
            )
        );
        moons.startMoonBuildingDemolition(planetId, MoonBuilding.Shipyard);

        vm.prank(player);
        vm.expectRevert(VeydriftMoonSystem.ConstructionInactive.selector);
        moons.cancelMoonBuildingDemolition(planetId);
    }

    string private constant DEMOLITION_PARITY_FIXTURE = "./demolition-parity-fixture.json";
    string private _parityFixture;
    bool private _parityWrite;

    /// @notice #121: the backend replays this fixture through its lazy demolition lens
    ///         (apps/backend/src/server.test.ts, "demolition parity fixture"), so both sides must
    ///         reproduce the same settled numbers. After an intended formula change, rewrite the
    ///         fixture's values in place with
    ///         `DEMOLITION_PARITY_WRITE=true forge test --mt testDemolitionParityFixture`.
    function testDemolitionParityFixture() public {
        _parityWrite = vm.envOr("DEMOLITION_PARITY_WRITE", false);
        _parityFixture = vm.readFile(DEMOLITION_PARITY_FIXTURE);
        // Keep every timestamp below the backend tests' fixed clock so its queues read as due.
        vm.warp(1_769_700_000);
        uint256 planetId = _startPlanet();
        VeydriftGameStorage.Planet memory planet = game.planet(planetId);
        _parity(".planet.fields", planet.fields);
        _parity(".planet.temperatureOffset", uint256(int256(planet.temperature) + 1_000));
        _parity(".planet.metalMultiplierBps", planet.metalMultiplierBps);
        _parity(".planet.crystalMultiplierBps", planet.crystalMultiplierBps);
        _parity(".planet.deuteriumMultiplierBps", planet.deuteriumMultiplierBps);

        _setBuildingLevel(planetId, Building.MetalMine, 12);
        _setBuildingLevel(planetId, Building.CrystalMine, 10);
        _setBuildingLevel(planetId, Building.DeuteriumSynthesizer, 8);
        _setBuildingLevel(planetId, Building.SolarPlant, 14);
        _setBuildingLevel(planetId, Building.RoboticsFactory, 2);
        _setBuildingLevel(planetId, Building.MetalStorage, 2);
        _setBuildingLevel(planetId, Building.CrystalStorage, 3);
        _setBuildingLevel(planetId, Building.DeuteriumTank, 2);
        _setBuildingLevel(planetId, Building.FusionReactor, 1);
        _setBuildingLevel(planetId, Building.Shipyard, 2);
        _setBuildingLevel(planetId, Building.ResearchLab, 2);
        _setTechnologyLevel(player, Technology.Energy, 3);
        _setTechnologyLevel(player, Technology.CombustionDrive, 1);
        _parity(".levels.metalMine", game.buildingLevel(planetId, Building.MetalMine));
        _parity(".levels.crystalMine", game.buildingLevel(planetId, Building.CrystalMine));
        _parity(
            ".levels.deuteriumSynthesizer",
            game.buildingLevel(planetId, Building.DeuteriumSynthesizer)
        );
        _parity(".levels.solarPlant", game.buildingLevel(planetId, Building.SolarPlant));
        _parity(".levels.roboticsFactory", game.buildingLevel(planetId, Building.RoboticsFactory));
        _parity(".levels.metalStorage", game.buildingLevel(planetId, Building.MetalStorage));
        _parity(".levels.crystalStorage", game.buildingLevel(planetId, Building.CrystalStorage));
        _parity(".levels.deuteriumTank", game.buildingLevel(planetId, Building.DeuteriumTank));
        _parity(".levels.fusionReactor", game.buildingLevel(planetId, Building.FusionReactor));
        _parity(".levels.shipyard", game.buildingLevel(planetId, Building.Shipyard));
        _parity(".levels.researchLab", game.buildingLevel(planetId, Building.ResearchLab));
        _parity(".technologies.energy", game.technologyLevel(player, Technology.Energy));
        _parity(
            ".technologies.combustionDrive",
            game.technologyLevel(player, Technology.CombustionDrive)
        );
        _fundPlanet(planetId, 30_000, 30_000, 10_000);
        vm.warp(block.timestamp + 600);

        // Solar Plant 14 -> 13 drops the energy factor below 100% at its finish time.
        _parityStep(planetId, ".solar", Building.SolarPlant, 3_600);
        // Metal Storage 2 -> 1 leaves metal above the new cap: kept, but it stops accumulating.
        _parityStep(planetId, ".storage", Building.MetalStorage, 7_200);
        // Fusion Reactor 1 -> 0 removes both its energy and its deuterium burn at the finish time.
        _parityStep(planetId, ".fusion", Building.FusionReactor, 3_600);

        // Crystal Mine 10 -> 9 finishes lazily; the next upgrade start settles it on-chain first.
        vm.prank(player);
        game.startBuildingDemolition(planetId, Building.CrystalMine);
        _parityStart(planetId, ".followedByUpgrade.demolition");
        vm.warp(game.activeBuildingConstruction(planetId).readyAt + 600);
        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.MetalMine);
        _parityStart(planetId, ".followedByUpgrade.upgrade");
        _parity(
            ".followedByUpgrade.upgrade.crystalMineLevel",
            game.buildingLevel(planetId, Building.CrystalMine)
        );
        _paritySettle(planetId, ".followedByUpgrade", 3_600);

        // Shipyard 2 -> 1 finishes lazily; the next ship order settles it and is timed by level 1.
        vm.prank(player);
        game.startBuildingDemolition(planetId, Building.Shipyard);
        _parityStart(planetId, ".shipyard.demolition");
        vm.warp(game.activeBuildingConstruction(planetId).readyAt + 600);
        vm.prank(player);
        game.startShipProduction(planetId, Ship.LightFighter, 1);
        _parity(".shipyard.ship.startedAt", block.timestamp);
        _parity(".shipyard.ship.readyAt", game.shipQueue(planetId).readyAt);
        _parity(".shipyard.ship.shipyardLevel", game.buildingLevel(planetId, Building.Shipyard));

        // Research Lab 2 -> 1 likewise times the next research by the lowered lab.
        vm.prank(player);
        game.startBuildingDemolition(planetId, Building.ResearchLab);
        _parityStart(planetId, ".researchLab.demolition");
        vm.warp(game.activeBuildingConstruction(planetId).readyAt + 600);
        vm.prank(player);
        game.startResearch(planetId, Technology.Energy);
        _parity(".researchLab.research.startedAt", block.timestamp);
        _parity(".researchLab.research.readyAt", game.researchQueue(player).readyAt);
        _parity(".researchLab.research.targetLevel", game.researchQueue(player).targetLevel);
        _parity(
            ".researchLab.research.labLevel", game.buildingLevel(planetId, Building.ResearchLab)
        );

        // Moon Robotics 2 -> 1; rebuilding it settles the lowered level first.
        _createMoon(planetId);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.Shipyard);
        _fundMoon(planetId, 100_000, 100_000, 100_000);
        _parity(".moon.fields", moons.moon(planetId).fields);
        vm.prank(player);
        moons.startMoonBuildingDemolition(planetId, MoonBuilding.RoboticsFactory);
        _parityMoonStart(planetId, ".moon.demolition");
        vm.warp(moons.activeMoonBuildingConstruction(planetId).readyAt + 60);
        vm.prank(player);
        moons.startMoonBuildingUpgrade(planetId, MoonBuilding.RoboticsFactory);
        _parity(
            ".moon.upgrade.roboticsLevel",
            moons.moonBuildingLevel(planetId, MoonBuilding.RoboticsFactory)
        );
        _parityMoonStart(planetId, ".moon.upgrade");
        vm.warp(moons.activeMoonBuildingConstruction(planetId).readyAt + 60);
        vm.prank(player);
        moons.finishMoonBuildingUpgrade(planetId);
        _parity(
            ".moon.settled.roboticsLevel",
            moons.moonBuildingLevel(planetId, MoonBuilding.RoboticsFactory)
        );
    }

    function _parityStep(
        uint256 planetId,
        string memory key,
        Building building,
        uint256 lazySeconds
    ) private {
        vm.prank(player);
        game.startBuildingDemolition(planetId, building);
        _parityStart(planetId, string.concat(key, ".demolition"));
        _paritySettle(planetId, key, lazySeconds);
    }

    function _parityStart(uint256 planetId, string memory key) private {
        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        _parity(string.concat(key, ".startedAt"), block.timestamp);
        _parity(string.concat(key, ".building"), uint8(construction.building));
        _parity(string.concat(key, ".targetLevel"), construction.targetLevel);
        _parity(string.concat(key, ".readyAt"), construction.readyAt);
        _parityResources(string.concat(key, ".cost"), construction.cost);
        _parityResources(string.concat(key, ".resources"), _planetResources(planetId));
    }

    /// @dev Settles `lazySeconds` after the active construction's finish and records what the
    ///      backend lens must already show at that instant without the settlement transaction.
    function _paritySettle(uint256 planetId, string memory key, uint256 lazySeconds) private {
        vm.warp(game.activeBuildingConstruction(planetId).readyAt + lazySeconds);
        _parity(string.concat(key, ".scoreBeforeSettle"), game.playerScore(player));
        vm.prank(player);
        game.settlePlanet(planetId);
        _parity(string.concat(key, ".settledAt"), block.timestamp);
        _parityResources(string.concat(key, ".settled"), _planetResources(planetId));
        _parity(string.concat(key, ".scoreAfterSettle"), game.playerScore(player));
        uint256 usedFields;
        for (uint8 i = 0; i <= uint8(type(Building).max); i++) {
            usedFields += game.buildingLevel(planetId, Building(i));
        }
        _parity(string.concat(key, ".fieldsUsed"), usedFields);
        (uint256 produced, uint256 required, uint256 scaleBps) = game.energyBalance(planetId);
        _parity(string.concat(key, ".energy.produced"), produced);
        _parity(string.concat(key, ".energy.required"), required);
        _parity(string.concat(key, ".energy.scaleBps"), scaleBps);
    }

    function _parityMoonStart(uint256 planetId, string memory key) private {
        VeydriftMoonSystem.MoonBuildingConstruction memory construction =
            moons.activeMoonBuildingConstruction(planetId);
        _parity(string.concat(key, ".startedAt"), block.timestamp);
        _parity(string.concat(key, ".building"), uint8(construction.building));
        _parity(string.concat(key, ".targetLevel"), construction.targetLevel);
        _parity(string.concat(key, ".readyAt"), construction.readyAt);
        _parityResources(string.concat(key, ".cost"), construction.cost);
    }

    function _parityResources(string memory key, VeydriftGameStorage.Resources memory resources)
        private
    {
        _parity(string.concat(key, ".metal"), resources.metal);
        _parity(string.concat(key, ".crystal"), resources.crystal);
        _parity(string.concat(key, ".deuterium"), resources.deuterium);
    }

    function _parity(string memory key, uint256 actual) private {
        if (_parityWrite) {
            vm.writeJson(vm.toString(actual), DEMOLITION_PARITY_FIXTURE, key);
        } else {
            assertEq(actual, stdJson.readUint(_parityFixture, key), key);
        }
    }
}
