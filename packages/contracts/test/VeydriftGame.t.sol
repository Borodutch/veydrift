// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {
    IVeydriftEffectiveStateGame,
    VeydriftEffectiveStateLens
} from "../src/VeydriftEffectiveStateLens.sol";
import {VeydriftFirstPlanetSettlementModule} from "../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftMigrationSettlement} from "../src/VeydriftMigrationSettlement.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftReferralSystem} from "../src/VeydriftReferralSystem.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {
    IVeydriftResourceProjectionGame,
    VeydriftResourceProjectionLens
} from "../src/VeydriftResourceProjectionLens.sol";
import {VeydriftAntiRaidPrimitives} from "../src/libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftRaidStorage} from "../src/libraries/VeydriftRaidStorage.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {VeydriftDependencies} from "../src/libraries/VeydriftDependencies.sol";
import {VeydriftFormulas} from "../src/libraries/VeydriftFormulas.sol";
import {VeydriftPlanetGeneration} from "../src/libraries/VeydriftPlanetGeneration.sol";
import {
    Building,
    Defense,
    MoonBuilding,
    Resource,
    Ship,
    Technology
} from "../src/libraries/VeydriftTypes.sol";

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

/// @dev Thin wrapper that owns a storage `Planet` slot so the storage-reference
///      `VeydriftRaidStorage.raid` helper can be exercised deterministically in isolation.
contract RaidStorageHarness {
    VeydriftGameStorage.Planet internal _planet;

    function setTarget(uint128 metal, uint128 crystal, uint128 deuterium) external {
        _planet.resources =
            VeydriftGameStorage.Resources({metal: metal, crystal: crystal, deuterium: deuterium});
    }

    function target() external view returns (VeydriftGameStorage.Resources memory) {
        return _planet.resources;
    }

    function raid(
        uint256 capacity,
        uint16 plunderRateBps,
        uint16 metalBps,
        uint16 crystalBps,
        uint16 deuteriumBps
    ) external returns (uint128 metal, uint128 crystal, uint128 deuterium) {
        return VeydriftRaidStorage.raid(
                _planet, 0, capacity, plunderRateBps, metalBps, crystalBps, deuteriumBps
            );
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
    event PlanetDefenseCountChanged(
        uint256 indexed planetId, Defense indexed defense, uint32 total
    );
    event DefenseQueued(
        uint256 indexed planetId,
        Defense indexed defense,
        uint32 quantity,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event ShipQueued(
        uint256 indexed planetId,
        Ship indexed ship,
        uint32 quantity,
        uint64 readyAt,
        uint128 metal,
        uint128 crystal,
        uint128 deuterium
    );
    event DefenseCompleted(
        uint256 indexed planetId, Defense indexed defense, uint32 quantity, uint32 total
    );
    event ShipCompleted(uint256 indexed planetId, Ship indexed ship, uint32 quantity, uint32 total);

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
    bytes32 internal constant TEST_PLANET_SEED_DOMAIN = keccak256("veydrift.planet.v1");
    bytes32 internal constant TEST_COMBAT_STREAM_DOMAIN =
        keccak256("veydrift.classic-combat-random-stream.v1");
    uint16 internal constant TEST_FLEET_UNIVERSE_SPEED = 1;
    uint32 internal constant TEST_FLEET_RECALL_CUTOFF_SECONDS = 60;
    uint16 internal constant TEST_MAX_GALAXY = 9;
    uint16 internal constant TEST_MAX_SYSTEM = 499;
    uint8 internal constant TEST_MAX_POSITION = 15;
    uint8 internal constant ATTACK_RELATION_WEAKER_FLAG = 2;
    uint8 internal constant ATTACK_BANDIT_FLAG = 8;
    uint8 internal constant ATTACK_INACTIVE_FLAG = 16;

    address internal admin = address(0xA11CE);
    address internal player = address(0xB0B);
    address internal fulfiller = address(0xF111);
    uint256 internal referralSignerKey = 0xA11CE1;
    VeydriftGame internal game;
    VeydriftReferralSystem internal referralSystem;
    VeydriftEffectiveStateLens internal effectiveStateLens;
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
    event FleetMissionLootRatio(
        uint256 indexed missionId, uint16 metalBps, uint16 crystalBps, uint16 deuteriumBps
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
    event FleetMissionResolved(
        uint256 indexed missionId,
        address indexed resolver,
        VeydriftGameStorage.FleetMissionType indexed missionType,
        uint64 returnAt
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
    event DefenseHoldEnded(
        uint256 indexed missionId,
        uint256 indexed defenderPlanetId,
        VeydriftGameStorage.FleetMissionStatus status
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
        effectiveStateLens = new VeydriftEffectiveStateLens();
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

    function testOwnerCanPauseAndUnpauseGame() public {
        vm.prank(admin);
        game.setGamePaused(true);

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftGameStorage.Unauthorized.selector, player));
        game.startPlanet{value: 0.05 ether}();

        vm.prank(admin);
        game.setGamePaused(false);

        vm.prank(player);
        game.startPlanet{value: 0.05 ether}();
        assertEq(game.homePlanetOf(player), 1);
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

        vm.expectEmit(true, true, false, false, address(game));
        emit FirstPlanetSettled(player, 1, 0, 0, 0, bytes32(0), bytes32(0));

        vm.prank(player);
        game.startPlanet{value: 0.05 ether}();

        uint256 planetId = game.homePlanetOf(player);
        VeydriftGameStorage.Planet memory planet = game.planet(planetId);
        VeydriftGameStorage.Resources memory required = game.resourceReserveRequirement();
        VeydriftGameStorage.Resources memory available = game.resourceReserveAvailable();

        assertEq(planetId, 1);
        assertEq(planet.owner, player);
        assertEq(planet.resources.metal, 500);
        assertEq(planet.resources.crystal, 500);
        assertEq(planet.resources.deuterium, 0);
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

    function testMigrationClaimImportsSignedFullStateForStartPrice() public {
        VeydriftMigrationSettlement migration = _newMigrationSettlement(admin);
        vm.prank(admin);
        game.setMigrationSettlement(address(migration));
        vm.deal(player, 1 ether);
        uint256 signerKey = 0x5151;
        address signer = vm.addr(signerKey);
        vm.prank(admin);
        migration.setStateSigner(signer);

        address[] memory players = new address[](1);
        uint16[] memory galaxies = new uint16[](1);
        uint16[] memory systems = new uint16[](1);
        uint8[] memory positions = new uint8[](1);
        uint16[] memory fields = new uint16[](1);
        int16[] memory temperatures = new int16[](1);
        players[0] = player;
        galaxies[0] = 2;
        systems[0] = 99;
        positions[0] = 7;
        fields[0] = 211;
        temperatures[0] = -14;

        vm.prank(admin);
        migration.importReservations(players, galaxies, systems, positions, fields, temperatures);
        assertFalse(game.isCoordinateAvailable(2, 99, 7));

        (bytes memory payload, bytes memory signature) =
            _signedMigrationPayload(migration, signerKey, player, 42);
        vm.prank(player);
        migration.claim{value: 0.05 ether}(payload, signature);

        VeydriftGameStorage.Planet memory planet = game.planet(42);
        assertEq(game.homePlanetOf(player), 42);
        assertEq(game.planetCountOf(player), 1);
        assertEq(planet.owner, player);
        assertEq(planet.galaxy, 2);
        assertEq(planet.system, 99);
        assertEq(planet.position, 7);
        assertEq(planet.fields, 211);
        assertEq(planet.temperature, -14);
        assertEq(planet.resources.metal, 12_345);
        assertEq(planet.resources.crystal, 6_789);
        assertEq(planet.resources.deuterium, 555);
        assertEq(game.buildingLevel(42, Building.MetalMine), 17);
        assertEq(game.shipCount(42, Ship.SmallCargo), 123);
        assertEq(game.defenseCount(42, Defense.RocketLauncher), 456);
        assertEq(game.technologyLevel(player, Technology.Computer), 8);
        VeydriftMoonSystem.Moon memory moon = moons.moon(42);
        assertTrue(moon.exists);
        assertEq(moon.owner, player);
        assertEq(moon.fields, 9);
        assertEq(moon.diameterKm, 8_888);
        VeydriftGameStorage.Resources memory moonResources = game.moonResources(42);
        assertEq(moonResources.metal, 100);
        assertEq(moonResources.crystal, 200);
        assertEq(moonResources.deuterium, 300);
        assertEq(game.moonShipCount(42, Ship.Recycler), 12);
        assertEq(moons.moonDefenseCount(42, Defense.SmallShieldDome), 1);
        assertEq(moons.moonBuildingLevel(42, MoonBuilding.JumpGate), 1);
        VeydriftGameStorage.ShipQueue memory shipQueue = game.shipQueue(42);
        assertTrue(shipQueue.active);
        assertEq(uint8(shipQueue.ship), uint8(Ship.LightFighter));
        assertEq(shipQueue.quantity, 7);

        (, bool claimed,,,,,) = migration.migrationReservation(player);
        assertTrue(claimed);
    }

    function testMigrationClaimReplacesAccidentalSingleStartedPlanet() public {
        VeydriftMigrationSettlement migration = _newMigrationSettlement(admin);
        vm.prank(admin);
        game.setMigrationSettlement(address(migration));
        vm.deal(player, 1 ether);
        uint256 signerKey = 0x5151;
        address signer = vm.addr(signerKey);
        vm.prank(admin);
        migration.setStateSigner(signer);

        vm.prank(player);
        uint256 accidentalPlanetId = game.startPlanet{value: 0.05 ether}();
        VeydriftGameStorage.Planet memory accidentalPlanet = game.planet(accidentalPlanetId);
        assertEq(game.homePlanetOf(player), accidentalPlanetId);
        assertEq(game.planetCountOf(player), 1);
        assertFalse(
            game.isCoordinateAvailable(
                accidentalPlanet.galaxy, accidentalPlanet.system, accidentalPlanet.position
            )
        );

        address[] memory players = new address[](1);
        uint16[] memory galaxies = new uint16[](1);
        uint16[] memory systems = new uint16[](1);
        uint8[] memory positions = new uint8[](1);
        uint16[] memory fields = new uint16[](1);
        int16[] memory temperatures = new int16[](1);
        players[0] = player;
        galaxies[0] = 2;
        systems[0] = 99;
        positions[0] = 7;
        fields[0] = 211;
        temperatures[0] = -14;

        vm.prank(admin);
        migration.importReservations(players, galaxies, systems, positions, fields, temperatures);
        (bytes memory payload, bytes memory signature) =
            _signedMigrationPayload(migration, signerKey, player, 42);

        vm.prank(player);
        migration.claim{value: 0.05 ether}(payload, signature);

        VeydriftGameStorage.Planet memory cleared = game.planet(accidentalPlanetId);
        assertEq(cleared.owner, address(0));
        assertTrue(
            game.isCoordinateAvailable(
                accidentalPlanet.galaxy, accidentalPlanet.system, accidentalPlanet.position
            )
        );
        assertEq(game.homePlanetOf(player), 42);
        assertEq(game.planetCountOf(player), 1);
        assertEq(game.planetNames(42), "Migrated Home");
        assertEq(game.shipCount(42, Ship.SmallCargo), 123);
        assertEq(game.technologyLevel(player, Technology.Computer), 8);

        (, bool claimed,,,,,) = migration.migrationReservation(player);
        assertTrue(claimed);
    }

    function testMigrationOwnerCanClaimForAccidentalStartedPlayer() public {
        VeydriftMigrationSettlement migration = _newMigrationSettlement(admin);
        vm.prank(admin);
        game.setMigrationSettlement(address(migration));
        vm.deal(admin, 1 ether);
        vm.deal(player, 1 ether);
        uint256 signerKey = 0x5151;
        address signer = vm.addr(signerKey);
        vm.prank(admin);
        migration.setStateSigner(signer);

        vm.prank(player);
        uint256 accidentalPlanetId = game.startPlanet{value: 0.05 ether}();
        VeydriftGameStorage.Planet memory accidentalPlanet = game.planet(accidentalPlanetId);

        address[] memory players = new address[](1);
        uint16[] memory galaxies = new uint16[](1);
        uint16[] memory systems = new uint16[](1);
        uint8[] memory positions = new uint8[](1);
        uint16[] memory fields = new uint16[](1);
        int16[] memory temperatures = new int16[](1);
        players[0] = player;
        galaxies[0] = 2;
        systems[0] = 99;
        positions[0] = 7;
        fields[0] = 211;
        temperatures[0] = -14;

        vm.prank(admin);
        migration.importReservations(players, galaxies, systems, positions, fields, temperatures);
        (bytes memory payload, bytes memory signature) =
            _signedMigrationPayload(migration, signerKey, player, 42);

        vm.prank(admin);
        migration.claimFor{value: 0.05 ether}(player, payload, signature);

        VeydriftGameStorage.Planet memory cleared = game.planet(accidentalPlanetId);
        assertEq(cleared.owner, address(0));
        assertTrue(
            game.isCoordinateAvailable(
                accidentalPlanet.galaxy, accidentalPlanet.system, accidentalPlanet.position
            )
        );
        assertEq(game.homePlanetOf(player), 42);
        assertEq(game.planetCountOf(player), 1);
        assertEq(game.planetNames(42), "Migrated Home");
        assertEq(game.shipCount(42, Ship.SmallCargo), 123);
        assertEq(game.technologyLevel(player, Technology.Computer), 8);

        (, bool claimed,,,,,) = migration.migrationReservation(player);
        assertTrue(claimed);
    }

    function testMigrationClaimRequiresReservationAndStartPrice() public {
        VeydriftMigrationSettlement migration = _newMigrationSettlement(admin);
        vm.prank(admin);
        game.setMigrationSettlement(address(migration));
        uint256 signerKey = 0x5151;
        address signer = vm.addr(signerKey);
        vm.prank(admin);
        migration.setStateSigner(signer);
        (bytes memory payload, bytes memory signature) =
            _signedMigrationPayload(migration, signerKey, player, 43);

        vm.prank(player);
        vm.expectRevert(VeydriftMigrationSettlement.FullStateMigrationRequired.selector);
        migration.claim{value: 0.05 ether}();

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftMigrationSettlement.MigrationReservationMissing.selector, player
            )
        );
        migration.claim{value: 0.05 ether}(payload, signature);

        address[] memory players = new address[](1);
        uint16[] memory galaxies = new uint16[](1);
        uint16[] memory systems = new uint16[](1);
        uint8[] memory positions = new uint8[](1);
        uint16[] memory fields = new uint16[](1);
        int16[] memory temperatures = new int16[](1);
        players[0] = player;
        galaxies[0] = 3;
        systems[0] = 12;
        positions[0] = 4;
        fields[0] = 190;
        temperatures[0] = 25;

        vm.prank(admin);
        migration.importReservations(players, galaxies, systems, positions, fields, temperatures);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.BadStartPayment.selector);
        migration.claim{value: 0.049 ether}(payload, signature);

        (, bytes memory badSignature) = _signedMigrationPayload(migration, 0x6161, player, 43);
        vm.prank(player);
        vm.expectRevert(VeydriftMigrationSettlement.BadMigrationSignature.selector);
        migration.claim{value: 0.05 ether}(payload, badSignature);

        vm.prank(player);
        migration.claim{value: 0.05 ether}(payload, signature);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftMigrationSettlement.MigrationReservationClaimed.selector, player
            )
        );
        migration.claim{value: 0.05 ether}(payload, signature);
    }

    function testMigrationOwnerCanReserveCoordinatesWithoutClaimReservation() public {
        VeydriftMigrationSettlement migration = _newMigrationSettlement(admin);
        vm.prank(admin);
        game.setMigrationSettlement(address(migration));

        uint16[] memory galaxies = new uint16[](2);
        uint16[] memory systems = new uint16[](2);
        uint8[] memory positions = new uint8[](2);
        galaxies[0] = 4;
        systems[0] = 44;
        positions[0] = 4;
        galaxies[1] = 5;
        systems[1] = 55;
        positions[1] = 5;

        vm.prank(admin);
        migration.reserveCoordinates(galaxies, systems, positions);

        assertFalse(game.isCoordinateAvailable(4, 44, 4));
        assertFalse(game.isCoordinateAvailable(5, 55, 5));

        (bool exists,,,,,,) = migration.migrationReservation(player);
        assertFalse(exists);
    }

    function testReferralClaimRefreshesDuplicateCommitmentForOwner() public {
        bytes32 commitment = keccak256("ref-1");

        vm.prank(player);
        game.startPlanet{value: 0.05 ether}();

        vm.prank(player);
        referralSystem.claimReferralCode(commitment);
        uint64 firstClaimedAt = referralSystem.referralClaimedAt(commitment);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(player);
        referralSystem.claimReferralCode(commitment);

        assertEq(referralSystem.referralInvites(commitment), player);
        assertEq(referralSystem.referralCommitmentOf(player), commitment);
        assertEq(referralSystem.referralClaimedAt(commitment), firstClaimedAt + 2 hours);
    }

    function testReferralClaimRequiresFirstPlanet() public {
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftReferralSystem.Unauthorized.selector, player)
        );
        referralSystem.claimReferralCode(keccak256("ref-no-planet"));
    }

    function testReferralClaimRejectsSecondActiveCodeUntilExpiry() public {
        vm.prank(player);
        game.startPlanet{value: 0.05 ether}();

        bytes32 firstCommitment = keccak256("ref-active-1");
        bytes32 secondCommitment = keccak256("ref-active-2");
        vm.startPrank(player);
        referralSystem.claimReferralCode(firstCommitment);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftReferralSystem.ReferralInviteAlreadyClaimed.selector,
                player,
                firstCommitment
            )
        );
        referralSystem.claimReferralCode(secondCommitment);

        vm.warp(block.timestamp + 1 days);
        referralSystem.claimReferralCode(secondCommitment);
        vm.stopPrank();

        assertEq(referralSystem.referralCommitmentOf(player), secondCommitment);
        assertEq(referralSystem.referralInvites(firstCommitment), address(0));
        assertEq(referralSystem.referralClaimedAt(firstCommitment), 0);
        assertEq(referralSystem.referralInvites(secondCommitment), player);
    }

    function testReferralSettlementRejectsExpiredInvite() public {
        address invitee = address(0xCAFE);
        bytes32 commitment = keccak256("expired high entropy invite code");
        vm.deal(invitee, 1 ether);

        vm.prank(admin);
        referralSystem.setReferralSigner(vm.addr(referralSignerKey));

        vm.prank(player);
        game.startPlanet{value: 0.05 ether}();
        vm.prank(player);
        referralSystem.claimReferralCode(commitment);

        uint64 expiredAt = uint64(block.timestamp + 1 days);
        vm.warp(expiredAt);

        (uint8 v, bytes32 r, bytes32 s) = _referralSignature(invitee, commitment);
        vm.prank(invitee);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.ReferralInviteExpired.selector, commitment, expiredAt
            )
        );
        game.startPlanetWithReferral{value: 0.05 ether}(commitment, v, r, s);
    }

    function testReferralSettlementDoublesStartingResourcesAndPaysInviter() public {
        address invitee = address(0xCAFE);
        bytes32 commitment = keccak256("high entropy invite code");
        vm.deal(invitee, 1 ether);

        vm.prank(admin);
        referralSystem.setReferralSigner(vm.addr(referralSignerKey));

        vm.prank(player);
        game.startPlanet{value: 0.05 ether}();
        uint256 inviterBalanceAfterStart = player.balance;

        vm.prank(player);
        referralSystem.claimReferralCode(commitment);

        (uint8 v, bytes32 r, bytes32 s) = _referralSignature(invitee, commitment);
        vm.prank(invitee);
        uint256 planetId = game.startPlanetWithReferral{value: 0.05 ether}(commitment, v, r, s);

        VeydriftGameStorage.Planet memory planet = game.planet(planetId);
        address inviter = referralSystem.referralInvites(commitment);

        assertEq(inviter, player);
        assertTrue(referralSystem.referralRedemptions(commitment, invitee));
        assertEq(planet.owner, invitee);
        assertEq(planet.resources.metal, 1_000);
        assertEq(planet.resources.crystal, 1_000);
        assertEq(planet.resources.deuterium, 0);
        assertEq(player.balance, inviterBalanceAfterStart + 0.025 ether);
        assertEq(address(game).balance, 0.075 ether);
    }

    function testReferralSettleFirstPlanetCompatibilityPathPaysInviter() public {
        address invitee = address(0xBEEF);
        bytes32 commitment = keccak256("legacy high entropy invite code");
        vm.deal(invitee, 1 ether);

        vm.prank(admin);
        referralSystem.setReferralSigner(vm.addr(referralSignerKey));

        vm.prank(player);
        game.startPlanet{value: 0.05 ether}();
        uint256 inviterBalanceAfterStart = player.balance;

        vm.prank(player);
        referralSystem.claimReferralCode(commitment);

        (uint8 v, bytes32 r, bytes32 s) = _referralSignature(invitee, commitment);
        vm.prank(invitee);
        VeydriftGameStorage.FirstPlanet memory settled =
            game.settleFirstPlanetWithReferral{value: 0.05 ether}(commitment, v, r, s);

        uint256 planetId = game.homePlanetOf(invitee);
        VeydriftGameStorage.Planet memory planet = game.planet(planetId);

        assertTrue(referralSystem.referralRedemptions(commitment, invitee));
        assertEq(planet.owner, invitee);
        assertEq(planet.resources.metal, 1_000);
        assertEq(planet.resources.crystal, 1_000);
        assertEq(settled.galaxy, planet.galaxy);
        assertEq(settled.system, planet.system);
        assertEq(settled.position, planet.position);
        assertEq(player.balance, inviterBalanceAfterStart + 0.025 ether);
    }

    function testReferralSettlementRejectsDuplicateInviteeSelfInviteAndWrongInviteeSignature()
        public
    {
        address invitee = address(0xCAFE);
        address otherInvitee = address(0xD00D);
        bytes32 commitment = keccak256("another high entropy invite code");
        vm.deal(invitee, 1 ether);
        vm.deal(otherInvitee, 1 ether);

        vm.prank(admin);
        referralSystem.setReferralSigner(vm.addr(referralSignerKey));

        vm.prank(player);
        game.startPlanet{value: 0.05 ether}();
        vm.prank(player);
        referralSystem.claimReferralCode(commitment);

        (uint8 inviteeV, bytes32 inviteeR, bytes32 inviteeS) =
            _referralSignature(invitee, commitment);
        vm.prank(otherInvitee);
        vm.expectRevert(VeydriftGameStorage.ReferralSignatureInvalid.selector);
        game.startPlanetWithReferral{value: 0.05 ether}(commitment, inviteeV, inviteeR, inviteeS);

        (uint8 selfV, bytes32 selfR, bytes32 selfS) = _referralSignature(player, commitment);
        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.ReferralSelfInvite.selector);
        game.startPlanetWithReferral{value: 0.05 ether}(commitment, selfV, selfR, selfS);

        vm.prank(invitee);
        game.startPlanetWithReferral{value: 0.05 ether}(commitment, inviteeV, inviteeR, inviteeS);

        vm.deal(invitee, 1 ether);
        (uint8 replayV, bytes32 replayR, bytes32 replayS) = _referralSignature(invitee, commitment);
        vm.prank(invitee);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.ReferralInviteeAlreadyRedeemed.selector, commitment, invitee
            )
        );
        game.startPlanetWithReferral{value: 0.05 ether}(commitment, replayV, replayR, replayS);
    }

    function testReferralSettlementAllowsThreeDistinctInviteesPerRollingDay() public {
        bytes32 commitment = keccak256("rolling high entropy invite code");
        address inviteeOne = address(0xCAFE1);
        address inviteeTwo = address(0xCAFE2);
        address inviteeThree = address(0xCAFE3);
        address inviteeFour = address(0xCAFE4);
        vm.deal(inviteeOne, 1 ether);
        vm.deal(inviteeTwo, 1 ether);
        vm.deal(inviteeThree, 1 ether);
        vm.deal(inviteeFour, 1 ether);

        vm.prank(admin);
        referralSystem.setReferralSigner(vm.addr(referralSignerKey));

        vm.prank(player);
        game.startPlanet{value: 0.05 ether}();
        vm.prank(player);
        referralSystem.claimReferralCode(commitment);

        uint64 firstRedemptionAt = uint64(block.timestamp);
        _startPlanetWithReferral(inviteeOne, commitment);
        vm.warp(firstRedemptionAt + 10 hours);
        _startPlanetWithReferral(inviteeTwo, commitment);
        vm.warp(firstRedemptionAt + 20 hours);
        _startPlanetWithReferral(inviteeThree, commitment);

        (uint8 remaining, uint64 nextRedemptionAt) =
            referralSystem.referralRedemptionQuota(commitment);
        assertEq(remaining, 0);
        assertEq(nextRedemptionAt, firstRedemptionAt + 1 days);

        (uint8 v, bytes32 r, bytes32 s) = _referralSignature(inviteeFour, commitment);
        vm.prank(inviteeFour);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.ReferralRedemptionQuotaExceeded.selector,
                commitment,
                nextRedemptionAt
            )
        );
        game.startPlanetWithReferral{value: 0.05 ether}(commitment, v, r, s);

        vm.warp(nextRedemptionAt);
        vm.prank(player);
        referralSystem.claimReferralCode(commitment);
        _startPlanetWithReferral(inviteeFour, commitment);
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

    function testShieldingLevelOneRequiresResearchLabSixAndEnergyThree() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setResources(planetId, 100_000, 100_000, 100_000);
        _setTechnologyLevel(player, Technology.Energy, 3);

        _setBuildingLevel(planetId, Building.ResearchLab, 5);
        vm.prank(player);
        bytes32 researchLabSixDependency = "RESEARCH_LAB_6";
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.MissingDependency.selector, researchLabSixDependency
            )
        );
        game.startResearch(planetId, Technology.Shielding);

        _setBuildingLevel(planetId, Building.ResearchLab, 6);
        _setTechnologyLevel(player, Technology.Energy, 2);
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.MissingDependency.selector, ENERGY_3)
        );
        game.startResearch(planetId, Technology.Shielding);

        _setTechnologyLevel(player, Technology.Energy, 3);
        vm.prank(player);
        game.startResearch(planetId, Technology.Shielding);

        VeydriftGameStorage.ResearchQueue memory queue = game.researchQueue(player);
        assertTrue(queue.active);
        assertEq(uint8(queue.technology), uint8(Technology.Shielding));
        assertEq(queue.targetLevel, 1);
        assertEq(queue.cost.metal, 200);
        assertEq(queue.cost.crystal, 600);
        assertEq(queue.cost.deuterium, 0);
    }

    function testReadyResearchLabUpgradeCompletesWhenStartingShieldingResearch() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setResources(planetId, 100_000, 100_000, 100_000);
        _setBuildingLevel(planetId, Building.RoboticsFactory, 1);
        _setBuildingLevel(planetId, Building.ResearchLab, 5);
        _setTechnologyLevel(player, Technology.Energy, 3);

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.ResearchLab);
        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        assertTrue(construction.active);
        assertEq(uint8(construction.building), uint8(Building.ResearchLab));
        assertEq(construction.targetLevel, 6);

        vm.warp(construction.readyAt);
        vm.prank(player);
        game.startResearch(planetId, Technology.Shielding);

        assertEq(game.buildingLevel(planetId, Building.ResearchLab), 6);
        assertFalse(game.activeBuildingConstruction(planetId).active);
        VeydriftGameStorage.ResearchQueue memory queue = game.researchQueue(player);
        assertTrue(queue.active);
        assertEq(uint8(queue.technology), uint8(Technology.Shielding));
        assertEq(queue.targetLevel, 1);
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

    // VEY-KANEO-480: a research queue whose `readyAt` has elapsed must lazy-complete inside
    // `startResearch` BEFORE the active check, so the owner can immediately queue the next research
    // without a separate finishResearch tx. Previously the active check ran before any research
    // settle and a ready (but unsettled) research wrongly reverted `QueueActive`, so it never
    // completed via the start path (5th settle-before-check case, missed by #852).
    function testReadyResearchAutoCompletesWhenStartingNext() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.ResearchLab, 1);
        _setTechnologyLevel(player, Technology.Energy, 2);
        _setResources(planetId, 100_000, 100_000, 100_000);

        vm.prank(player);
        game.startResearch(planetId, Technology.Laser);
        VeydriftGameStorage.ResearchQueue memory queue = game.researchQueue(player);
        assertTrue(queue.active);
        assertEq(uint8(queue.technology), uint8(Technology.Laser));
        assertEq(queue.targetLevel, 1);

        // Laser research is ready but has NOT been settled (no finishResearch tx). Starting the next
        // research must settle/complete it first instead of reverting QueueActive.
        vm.warp(queue.readyAt);
        vm.prank(player);
        game.startResearch(planetId, Technology.Laser);

        assertEq(game.technologyLevel(player, Technology.Laser), 1);
        VeydriftGameStorage.ResearchQueue memory next = game.researchQueue(player);
        assertTrue(next.active);
        assertEq(uint8(next.technology), uint8(Technology.Laser));
        assertEq(next.targetLevel, 2);
    }

    // VEY-KANEO-480: a genuinely in-progress research (readyAt not yet elapsed) must still trip
    // QueueActive() — the settle-before-check fix only completes due research, it must not let a
    // second research queue while the first is still running.
    function testInProgressResearchStillRevertsQueueActiveOnStart() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.ResearchLab, 1);
        _setTechnologyLevel(player, Technology.Energy, 2);
        _setResources(planetId, 100_000, 100_000, 100_000);

        vm.prank(player);
        game.startResearch(planetId, Technology.Laser);
        VeydriftGameStorage.ResearchQueue memory queue = game.researchQueue(player);

        // One second before readyAt the research is still running; a second start must revert.
        vm.warp(queue.readyAt - 1);
        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.QueueActive.selector);
        game.startResearch(planetId, Technology.Laser);
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

        // Before readyAt the lazy reconcile is a no-op: the upgrade stays pending (VEY-KANEO-468 —
        // finishBuildingUpgrade is now a thin wrapper that runs the reconcile, it no longer reverts).
        vm.prank(player);
        game.finishBuildingUpgrade(planetId);
        assertTrue(game.activeBuildingConstruction(planetId).active);
        assertEq(game.buildingLevel(planetId, Building.MetalMine), 0);

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

    // VEY-KANEO-477: a building construction whose `readyAt` has elapsed must lazy-complete inside
    // `startBuildingUpgrade` BEFORE the active check, so the owner can immediately queue the next
    // upgrade without a separate finish tx. Previously the active check ran before the settle and a
    // ready (but unsettled) construction wrongly reverted `ConstructionActive`, so it never completed.
    function testReadyBuildingUpgradeAutoCompletesWhenStartingNext() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setResources(planetId, 10_000, 10_000, 0);

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.MetalMine);
        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        assertEq(uint8(construction.building), uint8(Building.MetalMine));

        // The MetalMine upgrade is ready but has NOT been settled (no finish tx). Starting the next
        // upgrade must settle/complete it first instead of reverting ConstructionActive.
        vm.warp(construction.readyAt);
        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.CrystalMine);

        assertEq(game.buildingLevel(planetId, Building.MetalMine), 1);
        VeydriftGameStorage.BuildingConstruction memory next =
            game.activeBuildingConstruction(planetId);
        assertTrue(next.active);
        assertEq(uint8(next.building), uint8(Building.CrystalMine));
        assertEq(next.targetLevel, 1);
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

    function testBuildingCompletionDoesNotApplyBeforeDisplayedReadyAt() public {
        address account = address(0xB005);
        vm.deal(account, 1 ether);
        vm.prank(account);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        vm.prank(account);
        game.startBuildingUpgrade(planetId, Building.DeuteriumSynthesizer);
        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        assertEq(construction.readyAt, block.timestamp + 432);

        // One second before readyAt the lazy reconcile must NOT complete the upgrade (VEY-KANEO-468);
        // it stays pending at the current level rather than reverting.
        vm.warp(construction.readyAt - 1);
        vm.prank(account);
        game.finishBuildingUpgrade(planetId);
        assertTrue(game.activeBuildingConstruction(planetId).active);
        assertEq(game.buildingLevel(planetId, Building.DeuteriumSynthesizer), 0);

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

    function testCrawlersBoostPlanetProduction() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();

        // Give the planet productive mines and ample energy so output is not
        // throttled by an energy shortage.
        _setBuildingLevel(planetId, Building.MetalMine, 10);
        _setBuildingLevel(planetId, Building.CrystalMine, 8);
        _setBuildingLevel(planetId, Building.DeuteriumSynthesizer, 6);
        _setBuildingLevel(planetId, Building.SolarPlant, 20);

        (uint256 baseMetal, uint256 baseCrystal, uint256 baseDeuterium) =
            game.productionPerHour(planetId);
        assertGt(baseMetal, 0);
        assertGt(baseCrystal, 0);
        assertGt(baseDeuterium, 0);

        // 100 crawlers -> +0.02% each = +2% to every mine.
        _setShipCount(planetId, Ship.Crawler, 100);

        (uint256 boostedMetal, uint256 boostedCrystal, uint256 boostedDeuterium) =
            game.productionPerHour(planetId);
        assertEq(boostedMetal, (baseMetal * 10_200) / 10_000);
        assertEq(boostedCrystal, (baseCrystal * 10_200) / 10_000);
        assertEq(boostedDeuterium, (baseDeuterium * 10_200) / 10_000);
        assertGt(boostedMetal, baseMetal);
        assertGt(boostedCrystal, baseCrystal);
        assertGt(boostedDeuterium, baseDeuterium);
    }

    function testSolarSatellitesIncreasePlanetEnergy() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        VeydriftGameStorage.Planet memory planet = game.planet(planetId);
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

    function testDestroyedSolarSatellitesContributeToCombatLossesAndDebris() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.Battleship, 100);
        _setShipCount(targetPlanetId, Ship.SmallCargo, 13);
        _setShipCount(targetPlanetId, Ship.SolarSatellite, 60);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

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

        vm.recordLogs();
        game.resolveFleetMission(missionId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 lossesSig =
            keccak256("CombatLosses(uint256,uint128,uint128,uint128,uint128,uint128,uint128)");
        bytes32 debrisSig = keccak256("CombatDebrisSignaled(uint256,uint256,uint128,uint128)");
        bool lossesFound;
        bool debrisFound;
        uint128 attackerLossMetal;
        uint128 attackerLossCrystal;
        uint128 defenderLossMetal;
        uint128 defenderLossCrystal;
        uint128 debrisMetal;
        uint128 debrisCrystal;
        for (uint256 i = 0; i < logs.length;) {
            Vm.Log memory entry = logs[i];
            if (entry.emitter == address(game)) {
                if (entry.topics[0] == lossesSig && entry.topics[1] == bytes32(missionId)) {
                    (
                        attackerLossMetal,
                        attackerLossCrystal,,
                        defenderLossMetal,
                        defenderLossCrystal,
                    ) =
                        abi.decode(
                            entry.data, (uint128, uint128, uint128, uint128, uint128, uint128)
                        );
                    lossesFound = true;
                } else if (
                    entry.topics[0] == debrisSig && entry.topics[1] == bytes32(missionId)
                        && entry.topics[2] == bytes32(targetPlanetId)
                ) {
                    (debrisMetal, debrisCrystal) = abi.decode(entry.data, (uint128, uint128));
                    debrisFound = true;
                }
            }
            unchecked {
                ++i;
            }
        }

        assertTrue(lossesFound, "combat losses event missing");
        assertTrue(debrisFound, "combat debris event missing");
        assertEq(attackerLossMetal, 0, "attacker metal loss");
        assertEq(attackerLossCrystal, 0, "attacker crystal loss");
        assertEq(defenderLossMetal, 26_000, "small cargo metal loss");
        assertEq(defenderLossCrystal, 146_000, "small cargo plus solar satellite crystal loss");
        assertEq(debrisMetal, ((uint256(attackerLossMetal) + defenderLossMetal) * 3_000) / 10_000);
        assertEq(
            debrisCrystal, ((uint256(attackerLossCrystal) + defenderLossCrystal) * 3_000) / 10_000
        );
        (uint128 storedMetal, uint128 storedCrystal) = game.debrisField(targetPlanetId);
        assertEq(debrisMetal, 7_800, "small cargo metal debris");
        assertEq(debrisCrystal, 43_800, "small cargo plus solar satellite crystal debris");
        assertEq(storedMetal, debrisMetal);
        assertEq(storedCrystal, debrisCrystal);
        assertEq(game.shipCount(targetPlanetId, Ship.SmallCargo), 0);
        assertEq(game.shipCount(targetPlanetId, Ship.SolarSatellite), 0);
    }

    function testCombatLossesEmitShipAndDefenseCountChanged() public {
        // Pin the settlement entropy so planet attributes (and therefore the battle outcome) are
        // deterministic; foundry otherwise randomizes block.prevrandao per run, which would make the
        // per-unit combat losses asserted below flaky. The force levels stay within anti-bashing
        // score protection while still letting the attacker chew through the defender's ship and
        // defense stacks, so both a ship-count and a defense-count loss are guaranteed to occur.
        vm.prevrandao(keccak256("combat losses entropy"));
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.Battleship, 100);
        _setShipCount(targetPlanetId, Ship.LightFighter, 100);
        _setDefenseCount(targetPlanetId, Defense.RocketLauncher, 100);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

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

        // The overwhelmed defender loses ships and defenses; every loss routes through the canonical
        // count sinks, so the backend can index combat losses from events alone. Scan the logs
        // (rather than anchoring on a single ordered emit) and assert the last emitted total for each
        // unit reconstructs the final on-chain count.
        vm.recordLogs();
        game.resolveFleetMission(missionId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 shipSig = keccak256("PlanetShipCountChanged(uint256,uint8,uint32)");
        bytes32 defenseSig = keccak256("PlanetDefenseCountChanged(uint256,uint8,uint32)");
        bool shipLossEvented;
        bool defenseLossEvented;
        uint32 lastShipTotal;
        uint32 lastDefenseTotal;
        for (uint256 i = 0; i < logs.length;) {
            Vm.Log memory entry = logs[i];
            if (entry.emitter == address(game) && entry.topics[1] == bytes32(targetPlanetId)) {
                if (
                    entry.topics[0] == shipSig
                        && entry.topics[2] == bytes32(uint256(uint8(Ship.LightFighter)))
                ) {
                    shipLossEvented = true;
                    lastShipTotal = abi.decode(entry.data, (uint32));
                } else if (
                    entry.topics[0] == defenseSig
                        && entry.topics[2] == bytes32(uint256(uint8(Defense.RocketLauncher)))
                ) {
                    defenseLossEvented = true;
                    lastDefenseTotal = abi.decode(entry.data, (uint32));
                }
            }
            unchecked {
                ++i;
            }
        }

        assertTrue(shipLossEvented, "ship-count loss event missing");
        assertTrue(defenseLossEvented, "defense-count loss event missing");
        // Last emitted total is the canonical post-combat count (last-writer-wins upsert).
        assertEq(lastShipTotal, game.shipCount(targetPlanetId, Ship.LightFighter));
        assertEq(lastDefenseTotal, game.defenseCount(targetPlanetId, Defense.RocketLauncher));
        assertLt(game.shipCount(targetPlanetId, Ship.LightFighter), 100);
        assertLt(game.defenseCount(targetPlanetId, Defense.RocketLauncher), 100);
    }

    function _launchOriginAttack() internal returns (uint256 originPlanetId, uint256 missionId) {
        uint256 targetPlanetId;
        (originPlanetId, targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.Battleship, 100);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.battleship = 100;
        vm.prank(player);
        missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            901
        );
    }

    function testSettlePlanetSettlesFullyWhileMissionEnRoute() public {
        (uint256 originPlanetId, uint256 missionId) = _launchOriginAttack();
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        assertGt(arrivalAt, block.timestamp);

        vm.warp(block.timestamp + 1);
        uint64 enRouteTs = uint64(block.timestamp);
        vm.prank(player);
        game.settlePlanet(originPlanetId);
        assertEq(game.planet(originPlanetId).lastSettledAt, enRouteTs);
    }

    function testSettlePlanetNotFrozenByUnresolvedArrivedMission() public {
        (uint256 originPlanetId, uint256 missionId) = _launchOriginAttack();
        (, uint64 arrivalAt,,) = _fleetMission(missionId);

        // After arrival, with the mission unresolved, collection must NOT revert: it settles only up
        // to the unresolved arrival rather than freezing the planet.
        vm.warp(uint256(arrivalAt) + 1 hours);
        vm.prank(player);
        game.settlePlanet(originPlanetId);
        assertEq(game.planet(originPlanetId).lastSettledAt, arrivalAt);
    }

    function testSettlePlanetUnblocksAfterMissionResolved() public {
        (uint256 originPlanetId, uint256 missionId) = _launchOriginAttack();
        (, uint64 arrivalAt,,) = _fleetMission(missionId);

        vm.warp(uint256(arrivalAt) + 1 hours);
        _fulfillAttackBattleRandomness(missionId, 901);
        game.resolveFleetMission(missionId);

        uint64 resolvedTs = uint64(block.timestamp);
        vm.prank(player);
        game.settlePlanet(originPlanetId);
        assertEq(game.planet(originPlanetId).lastSettledAt, resolvedTs);
    }

    function testDefenderCollectionDoesNotSettleAcrossUnresolvedArrival() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.Battleship, 100);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);

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

        // Defender keeps collecting after the fleet has arrived but before it is resolved. The fix
        // must clamp settlement at the arrival instant so the combat snapshot is unaffected.
        vm.warp(uint256(arrivalAt) + 5 hours);
        vm.prank(defender);
        game.collectResources(targetPlanetId);
        assertEq(game.planet(targetPlanetId).lastSettledAt, arrivalAt);
    }

    function testCollectionClampsToEarliestOfMultiplePendingArrivals() public {
        (uint256 originPlanetId, uint256 target1,) = _seedAttackPlanets();
        // Computer level 1 gives a second fleet slot so both attacks can be in flight at once,
        // while keeping the attacker score close to the single-attack tests (no score protection).
        _setTechnologyLevel(player, Technology.Computer, 1);
        _setShipCount(originPlanetId, Ship.Battleship, 100);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);

        // A second target farther from origin (position 20 vs 9) so its arrival is later.
        address defender2 = address(0xBEEF);
        vm.deal(defender2, 1 ether);
        vm.prank(defender2);
        uint256 target2 = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(target2, 1, 100, 20);

        VeydriftGameStorage.MissionShips memory ships;
        ships.battleship = 50;
        VeydriftGameStorage.Resources memory noCargo =
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0});

        vm.prank(player);
        uint256 m1 = game.launchFleetMission(
            originPlanetId,
            target1,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            noCargo,
            901
        );
        vm.prank(player);
        uint256 m2 = game.launchFleetMission(
            originPlanetId,
            target2,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            noCargo,
            902
        );

        (, uint64 arrival1,,) = _fleetMission(m1);
        (, uint64 arrival2,,) = _fleetMission(m2);
        assertLt(arrival1, arrival2);

        // Warp past BOTH arrivals: two missions are now pending resolution for the origin planet.
        // Collection must clamp to the EARLIEST unresolved arrival, never across it.
        vm.warp(uint256(arrival2) + 1 hours);
        vm.prank(player);
        game.settlePlanet(originPlanetId);
        assertEq(game.planet(originPlanetId).lastSettledAt, arrival1);
    }

    function testEffectiveStateProjectsMaturedQueuesWithoutMutation() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.MetalMine, 5);
        _setBuildingLevel(planetId, Building.SolarPlant, 20);
        _setBuildingLevel(planetId, Building.Shipyard, 4);
        _setBuildingLevel(planetId, Building.ResearchLab, 2);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setTechnologyLevel(player, Technology.Energy, 2);
        _setResources(planetId, 50_000_000, 50_000_000, 50_000_000);

        vm.startPrank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 2);
        game.startDefenseProduction(planetId, Defense.RocketLauncher, 3);
        game.startResearch(planetId, Technology.Laser);
        game.startBuildingUpgrade(planetId, Building.MetalMine);
        vm.stopPrank();

        uint64 maxReady = game.shipQueue(planetId).readyAt;
        if (game.defenseQueue(planetId).readyAt > maxReady) {
            maxReady = game.defenseQueue(planetId).readyAt;
        }
        if (game.researchQueue(player).readyAt > maxReady) {
            maxReady = game.researchQueue(player).readyAt;
        }
        if (game.activeBuildingConstruction(planetId).readyAt > maxReady) {
            maxReady = game.activeBuildingConstruction(planetId).readyAt;
        }
        vm.warp(uint256(maxReady) + 1);

        VeydriftGameStorage.EffectivePlanetState memory state =
            effectiveStateLens.effectivePlanetState(
                IVeydriftEffectiveStateGame(address(game)), planetId
            );
        assertEq(state.asOf, uint64(block.timestamp));
        assertEq(state.planet.owner, player);
        assertEq(state.shipCounts[uint8(Ship.SmallCargo)], 2);
        assertEq(game.shipCount(planetId, Ship.SmallCargo), 0);
        assertEq(state.defenseCounts[uint8(Defense.RocketLauncher)], 3);
        assertEq(game.defenseCount(planetId, Defense.RocketLauncher), 0);
        assertEq(state.technologyLevels[uint8(Technology.Laser)], 1);
        assertEq(uint256(game.technologyLevel(player, Technology.Laser)), 0);
        assertEq(state.buildingLevels[uint8(Building.MetalMine)], 6);
        assertEq(uint256(game.buildingLevel(planetId, Building.MetalMine)), 5);

        // Effective reads do not materialize storage.
        assertTrue(game.shipQueue(planetId).active);
        assertTrue(game.defenseQueue(planetId).active);
        assertTrue(game.researchQueue(player).active);
        assertTrue(game.activeBuildingConstruction(planetId).active);
    }

    function testEffectiveStateProjectsMaturedTerraformerFieldsWithoutMutation() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        uint16 startingFields = game.planet(planetId).fields;

        _seedTerraformerPrerequisites(planetId);
        _setResources(planetId, 50_000_000, 50_000_000, 50_000_000);

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.Terraformer);
        vm.warp(uint256(game.activeBuildingConstruction(planetId).readyAt) + 1);

        VeydriftGameStorage.EffectivePlanetState memory state =
            effectiveStateLens.effectivePlanetState(
                IVeydriftEffectiveStateGame(address(game)), planetId
            );

        assertEq(state.buildingLevels[uint8(Building.Terraformer)], 1);
        assertEq(state.planet.fields, startingFields + 5);
        assertEq(uint256(game.buildingLevel(planetId, Building.Terraformer)), 0);
        assertEq(game.planet(planetId).fields, startingFields);
        assertTrue(game.activeBuildingConstruction(planetId).active);
    }

    function testEffectiveProductionAndStorageUseMaturedStateWithoutMutation() public {
        vm.prank(player);
        uint256 minePlanetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(minePlanetId, Building.MetalMine, 5);
        _setBuildingLevel(minePlanetId, Building.SolarPlant, 20);
        _setResources(minePlanetId, 50_000_000, 50_000_000, 50_000_000);

        vm.prank(player);
        game.startBuildingUpgrade(minePlanetId, Building.MetalMine);
        vm.warp(uint256(game.activeBuildingConstruction(minePlanetId).readyAt) + 1);

        (uint256 rawMetalPerHour,,) = game.productionPerHour(minePlanetId);
        VeydriftGameStorage.EffectivePlanetState memory mineState =
            effectiveStateLens.effectivePlanetState(
                IVeydriftEffectiveStateGame(address(game)), minePlanetId
            );
        assertGt(mineState.metalPerHour, rawMetalPerHour);

        (uint256 rawProducedEnergy,,) = game.energyBalance(minePlanetId);
        assertEq(mineState.producedEnergy, rawProducedEnergy);
        assertEq(uint256(game.buildingLevel(minePlanetId, Building.MetalMine)), 5);

        address storagePlayer = address(0x5A7);
        vm.deal(storagePlayer, 1 ether);
        vm.prank(storagePlayer);
        uint256 storagePlanetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(storagePlanetId, Building.MetalStorage, 1);
        _setResources(storagePlanetId, 50_000_000, 50_000_000, 50_000_000);

        vm.prank(storagePlayer);
        game.startBuildingUpgrade(storagePlanetId, Building.MetalStorage);
        vm.warp(uint256(game.activeBuildingConstruction(storagePlanetId).readyAt) + 1);

        (uint128 rawMetalCap,,) = game.storageCaps(storagePlanetId);
        VeydriftGameStorage.EffectivePlanetState memory state =
            effectiveStateLens.effectivePlanetState(
                IVeydriftEffectiveStateGame(address(game)), storagePlanetId
            );
        assertGt(state.storageCaps.metal, rawMetalCap);
        assertEq(uint256(game.buildingLevel(storagePlanetId, Building.MetalStorage)), 1);
    }

    function testResourceProjectionLensUsesReadyStorageCapBeforeReconcile() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.DeuteriumSynthesizer, 5);
        _setBuildingLevel(planetId, Building.SolarPlant, 10);
        _setResources(planetId, 100_000, 100_000, 10_000);

        uint64 readyAt = uint64(block.timestamp + 1 hours);
        _setBuildingConstruction(planetId, Building.DeuteriumTank, 1, readyAt);
        _setPlanetLastSettledAt(planetId, readyAt - 1 hours);
        vm.warp(uint256(readyAt) + 1 hours);

        VeydriftResourceProjectionLens lens = new VeydriftResourceProjectionLens();
        (
            VeydriftGameStorage.Resources memory resources,
            VeydriftGameStorage.Resources memory caps,,,
            uint256 deuteriumPerHour
        ) = lens.effectiveResourceProjection(
            IVeydriftResourceProjectionGame(address(game)), planetId
        );

        assertEq(caps.deuterium, 20_000);
        assertEq(resources.deuterium, 10_000 + deuteriumPerHour);
        assertEq(uint256(game.buildingLevel(planetId, Building.DeuteriumTank)), 0);
    }

    /// @notice Direct regression for the reported VEY-417 freeze. A Colonize mission is tracked
    ///         against its ORIGIN planet/owner (`_trackMissionResolution` registers origin + owner and
    ///         returns before touching any target). Resolving a Colonize never reads or mutates the
    ///         origin planet, so an arrived-but-unresolved Colonize must NOT gate the origin: the owner
    ///         keeps full settlement AND every mutating action while the colony fleet awaits the
    ///         resolver. Previously the gate reverted FleetMissionNotResolved and froze the account
    ///         out of settle/build/research/launch until the off-chain resolver caught up.
    function testUnresolvedArrivedColonizeMissionDoesNotFreezeOrigin() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 2, 44, 8);
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 4);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        uint8 colonyPosition = _populatedColonyPosition(2, 44, 8);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(2, 44, colonyPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            0
        );

        (, uint64 arrivalAt,,) = _fleetMission(missionId);

        // Fleet has arrived and the Colonize mission is still unresolved (resolver lag). The colony
        // fleet does not touch the origin, so collection must settle FULLY to now — never clamped to
        // the arrival, never reverted.
        vm.warp(uint256(arrivalAt) + 3 hours);
        uint64 nowTs = uint64(block.timestamp);
        vm.prank(player);
        game.settlePlanet(originPlanetId);
        assertEq(game.planet(originPlanetId).lastSettledAt, nowTs);

        // And the whole account stays usable: a mutating action that settles first (the user's
        // reported Infrastructure upgrade) must not revert FleetMissionNotResolved.
        vm.prank(player);
        game.startBuildingUpgrade(originPlanetId, Building.MetalMine);
        assertTrue(game.activeBuildingConstruction(originPlanetId).active);

        // The Colonize mission is still permissionlessly resolvable on arrival.
        game.resolveFleetMission(missionId);
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
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

    // VEY-KANEO-475: every discrete resource mutation must emit the authoritative post-mutation
    // balance via the `_emitPlanetSettled` sink (or the combat library) so the indexer never reads
    // `previewResources` on the fly. These tests assert the emitted balance equals the on-chain
    // `previewResources` for the same planet/block — i.e. the event alone is sufficient to sync state.
    bytes32 private constant _PLANET_SETTLED_TOPIC =
        keccak256("PlanetSettled(uint256,uint128,uint128,uint128,uint64)");

    function _assertLastPlanetSettledMatchesPreview(uint256 planetId) internal view {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        VeydriftGameStorage.Resources memory preview = game.previewResources(planetId);
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            Vm.Log memory entry = logs[i];
            if (
                entry.topics.length == 2 && entry.topics[0] == _PLANET_SETTLED_TOPIC
                    && uint256(entry.topics[1]) == planetId
            ) {
                (uint128 metal, uint128 crystal, uint128 deuterium, uint64 settledAt) =
                    abi.decode(entry.data, (uint128, uint128, uint128, uint64));
                assertEq(metal, preview.metal, "PlanetSettled metal != previewResources");
                assertEq(crystal, preview.crystal, "PlanetSettled crystal != previewResources");
                assertEq(
                    deuterium, preview.deuterium, "PlanetSettled deuterium != previewResources"
                );
                assertEq(settledAt, uint64(block.timestamp), "PlanetSettled settledAt != now");
                found = true;
            }
        }
        assertTrue(found, "no authoritative PlanetSettled emitted for planet");
    }

    function testStartPlanetEmitsAuthoritativePlanetSettled() public {
        vm.recordLogs();
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _assertLastPlanetSettledMatchesPreview(planetId);
    }

    function testBuildingSpendEmitsAuthoritativePlanetSettled() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setResources(planetId, 10_000, 10_000, 10_000);

        vm.recordLogs();
        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.MetalMine);
        // Same block as the spend: no production accrues, so the emitted post-spend balance must
        // equal previewResources exactly. Proves the facade `_spend` emit carries final values.
        _assertLastPlanetSettledMatchesPreview(planetId);
    }

    function testShipProductionSpendEmitsAuthoritativePlanetSettled() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.Shipyard, 2);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setResources(planetId, 10_000, 10_000, 10_000);

        vm.recordLogs();
        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 1);
        // Ship production spends through the colonization module's `_spend` (the inherited sink body),
        // a different emit path than the facade building spend above.
        _assertLastPlanetSettledMatchesPreview(planetId);
    }

    function testFleetLaunchSettlesReadyBuildingBeforeSpendingCargo() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setBuildingLevel(originPlanetId, Building.CrystalMine, 12);
        _setBuildingLevel(originPlanetId, Building.SolarPlant, 40);
        _setShipCount(originPlanetId, Ship.SmallCargo, 2);
        _setResources(originPlanetId, 10_000, 0, 10_000);

        (, uint256 oldCrystalPerHour,) = game.productionPerHour(originPlanetId);
        uint64 readyAt = uint64(block.timestamp + 1);
        _setBuildingConstruction(originPlanetId, Building.CrystalMine, 13, readyAt);
        _setPlanetLastSettledAt(originPlanetId, readyAt);
        vm.warp(uint256(readyAt) + 1 hours);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 2;
        // Crystal mine production for one test hour is far below uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 cargoCrystal = uint128(oldCrystalPerHour + 1);
        VeydriftGameStorage.Resources memory cargo =
            VeydriftGameStorage.Resources({metal: 0, crystal: cargoCrystal, deuterium: 0});

        vm.prank(player);
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            cargo,
            779
        );

        assertEq(game.buildingLevel(originPlanetId, Building.CrystalMine), 13);
        assertFalse(game.activeBuildingConstruction(originPlanetId).active);
    }

    function testAttackRaidEmitsDefenderAuthoritativePlanetSettled() public {
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

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 777);

        vm.recordLogs();
        game.resolveFleetMission(missionId);
        // The raid loots 5_000 metal (classic plunder), leaving the defender at 5_000/4_000/3_000.
        // The combat module is at the EIP-170 limit, so the defender's authoritative balance is
        // emitted from the linked VeydriftRaidStorage library — assert it reached the log.
        assertEq(game.planet(targetPlanetId).resources.metal, 5_000);
        _assertLastPlanetSettledMatchesPreview(targetPlanetId);
    }

    function testAttackRaidPlundersAccruedTargetResourcesAtImpact() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setBuildingLevel(targetPlanetId, Building.MetalMine, 10);
        _setBuildingLevel(targetPlanetId, Building.SolarPlant, 20);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 2_000, 0, 10_000);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            778
        );

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        VeydriftGameStorage.Resources memory targetResourcesAtImpact =
            game.previewResources(targetPlanetId);
        assertGt(targetResourcesAtImpact.metal, 2_000);
        _fulfillAttackBattleRandomness(missionId, 778);
        game.resolveFleetMission(missionId);

        (,,, VeydriftGameStorage.Resources memory attackCargo) = _fleetMission(missionId);
        assertEq(attackCargo.metal, targetResourcesAtImpact.metal / 2);
        assertEq(
            game.planet(targetPlanetId).resources.metal,
            targetResourcesAtImpact.metal - attackCargo.metal
        );
        assertEq(game.planet(targetPlanetId).lastSettledAt, arrivalAt);
    }

    /// @dev Credit/loot paths (market deposit, fleet-return cargo, raid debit) intentionally do not
    ///      re-settle the planet to `block.timestamp` before emitting: the authoritative event carries
    ///      the *stored* balance plus the planet's current `lastSettledAt`, which is exactly what the
    ///      indexer applies before projecting elapsed-time production. Assert the final `PlanetSettled`
    ///      for `planetId` matches that stored state (the last emit wins if a tx emits more than once).
    function _assertLastPlanetSettledMatchesStored(uint256 planetId) internal view {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        VeydriftGameStorage.Planet memory stored = game.planet(planetId);
        bool found;
        uint128 metal;
        uint128 crystal;
        uint128 deuterium;
        uint64 settledAt;
        for (uint256 i = 0; i < logs.length; i++) {
            Vm.Log memory entry = logs[i];
            if (
                entry.topics.length == 2 && entry.topics[0] == _PLANET_SETTLED_TOPIC
                    && uint256(entry.topics[1]) == planetId
            ) {
                (metal, crystal, deuterium, settledAt) =
                    abi.decode(entry.data, (uint128, uint128, uint128, uint64));
                found = true;
            }
        }
        assertTrue(found, "no authoritative PlanetSettled emitted for planet");
        assertEq(metal, stored.resources.metal, "PlanetSettled metal != stored");
        assertEq(crystal, stored.resources.crystal, "PlanetSettled crystal != stored");
        assertEq(deuterium, stored.resources.deuterium, "PlanetSettled deuterium != stored");
        assertEq(settledAt, stored.lastSettledAt, "PlanetSettled settledAt != stored lastSettledAt");
    }

    function testFleetLaunchSpendEmitsAuthoritativePlanetSettled() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        address defender = address(0xD1);
        vm.deal(defender, 1 ether);
        vm.prank(defender);
        uint256 targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;

        vm.recordLogs();
        vm.prank(player);
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
        // Launch debits fuel from the origin through the gameplay module's `_spend` (R3); the emit
        // carries the post-spend origin balance with no further on-the-fly RPC read.
        _assertLastPlanetSettledMatchesStored(originPlanetId);
    }

    function testTransportArrivalCreditEmitsAuthoritativePlanetSettled() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        uint256 colonyPlanetId = _createResolvedColony(player, originPlanetId, 7);

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
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);

        vm.recordLogs();
        vm.prank(player);
        game.resolveFleetMission(missionId);
        // Transport arrival settles + credits the target's cargo through the gameplay module; the
        // consolidated transport/deploy `_emitPlanetSettled` (R5/R6) carries the post-credit balance.
        _assertLastPlanetSettledMatchesStored(colonyPlanetId);
    }

    function testResearchSpendEmitsAuthoritativePlanetSettled() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.ResearchLab, 1);
        _setTechnologyLevel(player, Technology.Energy, 2);
        _setResources(planetId, 100_000, 100_000, 100_000);

        vm.recordLogs();
        vm.prank(player);
        game.startResearch(planetId, Technology.Laser);
        // Research spends through the planet-management module's `_spend` (R3) — the module reclaimed
        // EIP-170 headroom (dead colony entrypoints) so this authoritative emit fits.
        _assertLastPlanetSettledMatchesStored(planetId);
    }

    function testMarketDepositCreditEmitsAuthoritativePlanetSettled() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.InterdimensionalRiftStabilizer, 1);
        _setResources(planetId, 1_000, 1_000, 1_000);
        metalToken.mint(player, 1_000);
        vm.prank(player);
        metalToken.approve(address(game), 1_000);

        vm.recordLogs();
        vm.prank(player);
        game.depositMarketResource(planetId, Resource.Metal, 100);
        assertEq(game.planet(planetId).resources.metal, 1_100);
        // Deposit credits without an explicit settle; the shared `_creditResources` emit (R8) carries
        // the stored post-credit balance and the planet's current `lastSettledAt`.
        _assertLastPlanetSettledMatchesStored(planetId);
    }

    function testFleetReturnCreditEmitsAuthoritativePlanetSettled() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        uint256 colonyPlanetId = _createResolvedColony(player, originPlanetId, 7);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            colonyPlanetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources({metal: 100, crystal: 0, deuterium: 0}),
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        vm.prank(player);
        game.resolveFleetMission(missionId);

        (,, uint64 returnAt,) = _fleetMission(missionId);
        vm.warp(returnAt);
        vm.recordLogs();
        vm.prank(player);
        game.completeFleetMissionReturn(missionId);
        // The return leg credits the origin through `_creditResources` in the planet-management module
        // (R7) and emits the authoritative origin balance.
        _assertLastPlanetSettledMatchesStored(originPlanetId);
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

    function testDefenseProductionQueuesDifferentDefenseBehindActiveQueue() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _seedDefensePrerequisites(planetId);
        _setResources(planetId, 5_000_000, 5_000_000, 5_000_000);

        vm.prank(player);
        game.startDefenseProduction(planetId, Defense.LightLaser, 2);
        VeydriftGameStorage.DefenseQueue memory activeQueue = game.defenseQueue(planetId);
        (uint128 metalCost, uint128 crystalCost, uint128 deuteriumCost) =
            VeydriftCatalog.defenseCost(Defense.RocketLauncher);
        uint256 backlogDuration =
            VeydriftFormulas.unitDuration(8, 0, metalCost, crystalCost, deuteriumCost, 3, 1, 1);

        vm.expectEmit(true, true, false, true, address(game));
        emit DefenseQueued(
            planetId,
            Defense.RocketLauncher,
            3,
            // The test inputs produce a readyAt value backed by the uint64 defense queue field.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint64(activeQueue.readyAt + backlogDuration),
            metalCost * 3,
            crystalCost * 3,
            deuteriumCost * 3
        );
        vm.prank(player);
        game.startDefenseProduction(planetId, Defense.RocketLauncher, 3);

        VeydriftGameStorage.DefenseQueue memory stillActive = game.defenseQueue(planetId);
        assertTrue(stillActive.active);
        assertEq(uint8(stillActive.defense), uint8(Defense.LightLaser));
        assertEq(stillActive.quantity, 2);

        VeydriftGameStorage.DefenseQueue[] memory backlog = game.defenseQueueBacklog(planetId);
        assertEq(backlog.length, 1);
        assertTrue(backlog[0].active);
        assertEq(uint8(backlog[0].defense), uint8(Defense.RocketLauncher));
        assertEq(backlog[0].quantity, 3);
        assertEq(backlog[0].readyAt, activeQueue.readyAt + backlogDuration);
        assertEq(backlog[0].cost.metal, metalCost * 3);
        assertEq(backlog[0].cost.crystal, crystalCost * 3);
        assertEq(backlog[0].cost.deuterium, deuteriumCost * 3);

        vm.warp(activeQueue.readyAt);
        vm.prank(player);
        game.finishDefenseProduction(planetId);

        VeydriftGameStorage.DefenseQueue memory promoted = game.defenseQueue(planetId);
        assertTrue(promoted.active);
        assertEq(uint8(promoted.defense), uint8(Defense.RocketLauncher));
        assertEq(promoted.quantity, 3);
        assertEq(promoted.readyAt, backlog[0].readyAt);
        assertEq(game.defenseQueueBacklog(planetId).length, 0);
        assertEq(game.defenseCount(planetId, Defense.LightLaser), 2);

        vm.warp(promoted.readyAt);
        vm.prank(player);
        game.finishDefenseProduction(planetId);
        assertFalse(game.defenseQueue(planetId).active);
        assertEq(game.defenseCount(planetId, Defense.RocketLauncher), 3);
    }

    function testDefenseProductionPreservesFifoWhenRequeuingActiveTypeAfterBacklog() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _seedDefensePrerequisites(planetId);
        _setResources(planetId, 5_000_000, 5_000_000, 5_000_000);

        vm.prank(player);
        game.startDefenseProduction(planetId, Defense.RocketLauncher, 2);
        VeydriftGameStorage.DefenseQueue memory activeRocketQueue = game.defenseQueue(planetId);

        vm.prank(player);
        game.startDefenseProduction(planetId, Defense.IonCannon, 3);
        VeydriftGameStorage.DefenseQueue[] memory backlogAfterIon =
            game.defenseQueueBacklog(planetId);
        assertEq(backlogAfterIon.length, 1);
        assertEq(uint8(backlogAfterIon[0].defense), uint8(Defense.IonCannon));

        (uint128 metalCost, uint128 crystalCost, uint128 deuteriumCost) =
            VeydriftCatalog.defenseCost(Defense.RocketLauncher);
        uint256 laterRocketDuration =
            VeydriftFormulas.unitDuration(8, 0, metalCost, crystalCost, deuteriumCost, 4, 1, 1);

        vm.prank(player);
        game.startDefenseProduction(planetId, Defense.RocketLauncher, 4);

        VeydriftGameStorage.DefenseQueue memory stillActive = game.defenseQueue(planetId);
        assertTrue(stillActive.active);
        assertEq(uint8(stillActive.defense), uint8(Defense.RocketLauncher));
        assertEq(stillActive.quantity, activeRocketQueue.quantity);
        assertEq(stillActive.readyAt, activeRocketQueue.readyAt);

        VeydriftGameStorage.DefenseQueue[] memory backlog = game.defenseQueueBacklog(planetId);
        assertEq(backlog.length, 2);
        assertEq(uint8(backlog[0].defense), uint8(Defense.IonCannon));
        assertEq(backlog[0].quantity, 3);
        assertEq(uint8(backlog[1].defense), uint8(Defense.RocketLauncher));
        assertEq(backlog[1].quantity, 4);
        assertEq(backlog[1].readyAt, backlog[0].readyAt + laterRocketDuration);
        assertGt(backlog[1].readyAt, backlog[0].readyAt);
        assertEq(backlog[1].cost.metal, metalCost * 4);
        assertEq(backlog[1].cost.crystal, crystalCost * 4);
        assertEq(backlog[1].cost.deuterium, deuteriumCost * 4);
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

    function testInterplanetaryMissileEmitsDefenseCountChangedForEveryLoss() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMissileAttackPlanets();
        _setDefenseCount(originPlanetId, Defense.InterplanetaryMissile, 5);
        _setDefenseCount(targetPlanetId, Defense.AntiBallisticMissile, 2);
        _setDefenseCount(targetPlanetId, Defense.LightLaser, 10);

        // The silo debit, the interception debit, and the primary-target hit each emit the
        // resulting stored total so the backend can index defense state without polling.
        vm.expectEmit(true, true, false, true, address(game));
        emit PlanetDefenseCountChanged(originPlanetId, Defense.InterplanetaryMissile, 0);
        vm.expectEmit(true, true, false, true, address(game));
        emit PlanetDefenseCountChanged(targetPlanetId, Defense.AntiBallisticMissile, 0);
        vm.expectEmit(true, true, false, true, address(game));
        emit PlanetDefenseCountChanged(targetPlanetId, Defense.LightLaser, 7);
        vm.prank(player);
        game.launchInterplanetaryMissileAttack(
            originPlanetId, targetPlanetId, Defense.LightLaser, 5
        );
    }

    function testFleetLaunchAndReturnEmitShipCountChanged() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setShipCount(originPlanetId, Ship.SmallCargo, 3);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);

        uint256 destinationPlanetId = _createResolvedColony(player, originPlanetId, 7);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 3;

        // Launch debits the origin fleet and emits the new stored total.
        vm.expectEmit(true, true, false, true, address(game));
        emit PlanetShipCountChanged(originPlanetId, Ship.SmallCargo, 0);
        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            destinationPlanetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources({metal: 100, crystal: 0, deuterium: 0}),
            0
        );
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 0);

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        vm.prank(player);
        game.resolveFleetMission(missionId);

        (,, uint64 returnAt,) = _fleetMission(missionId);
        vm.warp(returnAt);
        // Return credits the surviving fleet back to the origin and emits the restored total.
        vm.expectEmit(true, true, false, true, address(game));
        emit PlanetShipCountChanged(originPlanetId, Ship.SmallCargo, 3);
        vm.prank(player);
        game.completeFleetMissionReturn(missionId);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 3);
    }

    function testFleetReturnLandsLazilyWithoutCompleteTx() public {
        // VEY-KANEO-468 Phase 2c: a matured return leg must land the moment ANY action touches the
        // owner — with no `completeFleetMissionReturn` keeper/user tx.
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setShipCount(originPlanetId, Ship.SmallCargo, 3);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);

        uint256 destinationPlanetId = _createResolvedColony(player, originPlanetId, 7);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 3;
        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            destinationPlanetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources({metal: 100, crystal: 0, deuterium: 0}),
            0
        );
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 0);
        assertEq(game.activeFleetMissionCount(player), 1);

        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        vm.prank(player);
        game.resolveFleetMission(missionId);

        (,, uint64 returnAt,) = _fleetMission(missionId);
        vm.warp(returnAt);

        // An unrelated action (renamePlanet) lazily lands the matured return — no completeFleetMissionReturn.
        vm.expectEmit(true, true, false, true, address(game));
        emit PlanetShipCountChanged(originPlanetId, Ship.SmallCargo, 3);
        vm.prank(player);
        game.renamePlanet(originPlanetId, "lazyland");

        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 3);
        assertEq(game.activeFleetMissionCount(player), 0);
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returned));
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

    // VEY-KANEO-468: lazy on-chain reconciliation. A production queue whose `readyAt` has elapsed is
    // applied by the next mutating interaction with the planet/owner, with no dedicated finish* tx.
    function testMutatingCallSettlesDueShipAndDefenseWithoutFinishTx() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.Shipyard, 2);
        _setBuildingLevel(planetId, Building.ResearchLab, 1);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setResources(planetId, 1_000_000, 1_000_000, 1_000_000);

        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 2);
        vm.prank(player);
        game.startDefenseProduction(planetId, Defense.RocketLauncher, 3);

        VeydriftGameStorage.ShipQueue memory shipQueue = game.shipQueue(planetId);
        VeydriftGameStorage.DefenseQueue memory defenseQueue = game.defenseQueue(planetId);
        vm.warp(shipQueue.readyAt > defenseQueue.readyAt ? shipQueue.readyAt : defenseQueue.readyAt);

        // No finishShipProduction / finishDefenseProduction call. An unrelated mutating interaction
        // (starting research) must settle both due queues on-chain.
        vm.prank(player);
        game.startResearch(planetId, Technology.Energy);

        assertEq(game.shipCount(planetId, Ship.SmallCargo), 2);
        assertEq(game.defenseCount(planetId, Defense.RocketLauncher), 3);
        assertFalse(game.shipQueue(planetId).active);
        assertFalse(game.defenseQueue(planetId).active);
    }

    function testStartShipProductionSettlesReadyQueueBeforeStartingNextBatch() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.Shipyard, 2);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setResources(planetId, 1_000_000, 1_000_000, 1_000_000);

        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 2);
        VeydriftGameStorage.ShipQueue memory firstQueue = game.shipQueue(planetId);
        vm.warp(firstQueue.readyAt);

        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 1);

        assertEq(game.shipCount(planetId, Ship.SmallCargo), 2);
        VeydriftGameStorage.ShipQueue memory nextQueue = game.shipQueue(planetId);
        assertTrue(nextQueue.active);
        assertEq(uint8(nextQueue.ship), uint8(Ship.SmallCargo));
        assertEq(nextQueue.quantity, 1);
        assertEq(nextQueue.cost.metal, 2_000);
        assertEq(nextQueue.cost.crystal, 2_000);
    }

    function testReadyShipyardUpgradeCompletesBeforeShipDependencyCheck() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.RoboticsFactory, 2);
        _setBuildingLevel(planetId, Building.Shipyard, 1);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setResources(planetId, 1_000_000, 1_000_000, 1_000_000);

        vm.prank(player);
        game.startBuildingUpgrade(planetId, Building.Shipyard);
        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(planetId);
        assertTrue(construction.active);
        assertEq(uint8(construction.building), uint8(Building.Shipyard));
        assertEq(construction.targetLevel, 2);

        vm.warp(construction.readyAt);
        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 1);

        assertEq(game.buildingLevel(planetId, Building.Shipyard), 2);
        assertFalse(game.activeBuildingConstruction(planetId).active);
        assertTrue(game.shipQueue(planetId).active);
        assertEq(uint8(game.shipQueue(planetId).ship), uint8(Ship.SmallCargo));
    }

    function testStartDefenseProductionSettlesReadyQueueBeforeStartingNextBatch() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.Shipyard, 1);
        _setResources(planetId, 1_000_000, 1_000_000, 1_000_000);

        vm.prank(player);
        game.startDefenseProduction(planetId, Defense.RocketLauncher, 3);
        VeydriftGameStorage.DefenseQueue memory firstQueue = game.defenseQueue(planetId);
        vm.warp(firstQueue.readyAt);

        vm.prank(player);
        game.startDefenseProduction(planetId, Defense.RocketLauncher, 1);

        assertEq(game.defenseCount(planetId, Defense.RocketLauncher), 3);
        VeydriftGameStorage.DefenseQueue memory nextQueue = game.defenseQueue(planetId);
        assertTrue(nextQueue.active);
        assertEq(uint8(nextQueue.defense), uint8(Defense.RocketLauncher));
        assertEq(nextQueue.quantity, 1);
        assertEq(nextQueue.cost.metal, 2_000);
        assertEq(nextQueue.cost.crystal, 0);
    }

    // VEY-KANEO-468: research (player-scoped) is applied lazily by the player's next mutating call.
    function testMutatingCallSettlesDueResearchWithoutFinishTx() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.ResearchLab, 1);
        _setBuildingLevel(planetId, Building.Shipyard, 2);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setResources(planetId, 1_000_000, 1_000_000, 1_000_000);

        vm.prank(player);
        game.startResearch(planetId, Technology.Energy);
        VeydriftGameStorage.ResearchQueue memory researchQueue = game.researchQueue(player);
        vm.warp(researchQueue.readyAt);

        // No finishResearch call. A subsequent mutating interaction (starting ship production)
        // must apply the researched level on-chain.
        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 1);

        assertEq(game.technologyLevel(player, Technology.Energy), 1);
        assertFalse(game.researchQueue(player).active);
    }

    function testFleetLaunchSettlesDueShipProductionBeforeShipCountCheck() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 2, 10, 4);
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 4);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setBuildingLevel(originPlanetId, Building.Shipyard, 2);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        uint256 targetPlanetId = _createResolvedColony(player, originPlanetId, 221);
        _setResources(originPlanetId, 1_000_000, 1_000_000, 1_000_000);

        vm.prank(player);
        game.startShipProduction(originPlanetId, Ship.SmallCargo, 1);
        VeydriftGameStorage.ShipQueue memory queue = game.shipQueue(originPlanetId);
        vm.warp(queue.readyAt);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        assertFalse(game.shipQueue(originPlanetId).active);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 0);
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
    }

    // VEY-KANEO-468: one lazy reconcile drains the entire ready production backlog (bounded loop:
    // active + every ready backlog entry), and re-running it applies nothing further (idempotent).
    function testLazySettleDrainsFullProductionBacklogAndIsIdempotent() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.Shipyard, 2);
        _setBuildingLevel(planetId, Building.ResearchLab, 1);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setResources(planetId, 1_000_000, 1_000_000, 1_000_000);

        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 2);
        vm.prank(player);
        game.startShipProduction(planetId, Ship.LightFighter, 3);

        VeydriftGameStorage.ShipQueue[] memory backlog = game.shipQueueBacklog(planetId);
        assertEq(backlog.length, 1);
        vm.warp(backlog[0].readyAt); // both the active SmallCargo batch and the LightFighter backlog are now due

        // A single unrelated mutating call settles the active batch AND the ready backlog batch.
        vm.prank(player);
        game.startResearch(planetId, Technology.Energy);

        assertEq(game.shipCount(planetId, Ship.SmallCargo), 2);
        assertEq(game.shipCount(planetId, Ship.LightFighter), 3);
        assertFalse(game.shipQueue(planetId).active);
        assertEq(game.shipQueueBacklog(planetId).length, 0);

        // Idempotent: a further mutating call does not re-credit the already-settled batches.
        _setResources(planetId, 1_000_000, 1_000_000, 1_000_000);
        vm.prank(player);
        game.startDefenseProduction(planetId, Defense.RocketLauncher, 1);
        assertEq(game.shipCount(planetId, Ship.SmallCargo), 2);
        assertEq(game.shipCount(planetId, Ship.LightFighter), 3);
    }

    // VEY-KANEO-468 cross-player: an attack's impact-time snapshot settles the defender's due
    // (player-scoped) research before combat, without the defender taking any action of their own.
    function testAttackImpactSettlesDefenderDueResearch() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _setBuildingLevel(targetPlanetId, Building.ResearchLab, 1);
        _setResources(targetPlanetId, 1_000_000, 1_000_000, 1_000_000);

        vm.prank(defender);
        game.startResearch(targetPlanetId, Technology.Energy);
        VeydriftGameStorage.ResearchQueue memory researchQueue = game.researchQueue(defender);
        vm.warp(researchQueue.readyAt); // research is now due but the defender never settles it

        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            340
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        assertGe(arrivalAt, researchQueue.readyAt);
        assertEq(game.technologyLevel(defender, Technology.Energy), 0); // not applied before resolution

        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 340);
        game.resolveFleetMission(missionId);

        assertEq(game.technologyLevel(defender, Technology.Energy), 1); // settled at impact
        assertFalse(game.researchQueue(defender).active);
    }

    function testShipProductionAppendsMatchingActiveQueue() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.Shipyard, 2);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setResources(planetId, 50_000, 50_000, 50_000);

        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 2);
        VeydriftGameStorage.ShipQueue memory firstQueue = game.shipQueue(planetId);
        (uint128 metalCost, uint128 crystalCost, uint128 deuteriumCost) =
            VeydriftCatalog.shipCost(Ship.SmallCargo);
        uint256 appendedDuration =
            VeydriftFormulas.unitDuration(2, 0, metalCost, crystalCost, deuteriumCost, 3, 1, 1);

        vm.warp(block.timestamp + 10);
        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 3);

        VeydriftGameStorage.ShipQueue memory appendedQueue = game.shipQueue(planetId);
        assertTrue(appendedQueue.active);
        assertEq(uint8(appendedQueue.ship), uint8(Ship.SmallCargo));
        assertEq(appendedQueue.quantity, 5);
        assertEq(appendedQueue.readyAt, firstQueue.readyAt + appendedDuration);
        assertEq(appendedQueue.cost.metal, metalCost * 5);
        assertEq(appendedQueue.cost.crystal, crystalCost * 5);
        assertEq(appendedQueue.cost.deuterium, deuteriumCost * 5);
    }

    function testShipProductionQueuesDifferentShipBehindActiveQueue() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setBuildingLevel(planetId, Building.Shipyard, 2);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setResources(planetId, 50_000, 50_000, 50_000);

        vm.prank(player);
        game.startShipProduction(planetId, Ship.SmallCargo, 2);
        VeydriftGameStorage.ShipQueue memory activeQueue = game.shipQueue(planetId);
        (uint128 metalCost, uint128 crystalCost, uint128 deuteriumCost) =
            VeydriftCatalog.shipCost(Ship.LightFighter);
        uint256 backlogDuration =
            VeydriftFormulas.unitDuration(2, 0, metalCost, crystalCost, deuteriumCost, 3, 1, 1);

        vm.expectEmit(true, true, false, true, address(game));
        emit ShipQueued(
            planetId,
            Ship.LightFighter,
            3,
            // The test inputs produce a readyAt value backed by the uint64 ship queue field.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint64(activeQueue.readyAt + backlogDuration),
            metalCost * 3,
            crystalCost * 3,
            deuteriumCost * 3
        );
        vm.prank(player);
        game.startShipProduction(planetId, Ship.LightFighter, 3);

        VeydriftGameStorage.ShipQueue memory stillActive = game.shipQueue(planetId);
        assertTrue(stillActive.active);
        assertEq(uint8(stillActive.ship), uint8(Ship.SmallCargo));
        assertEq(stillActive.quantity, 2);

        VeydriftGameStorage.ShipQueue[] memory backlog = game.shipQueueBacklog(planetId);
        assertEq(backlog.length, 1);
        assertTrue(backlog[0].active);
        assertEq(uint8(backlog[0].ship), uint8(Ship.LightFighter));
        assertEq(backlog[0].quantity, 3);
        assertEq(backlog[0].readyAt, activeQueue.readyAt + backlogDuration);
        assertEq(backlog[0].cost.metal, metalCost * 3);
        assertEq(backlog[0].cost.crystal, crystalCost * 3);
        assertEq(backlog[0].cost.deuterium, deuteriumCost * 3);

        vm.warp(activeQueue.readyAt);
        vm.prank(player);
        game.finishShipProduction(planetId);

        VeydriftGameStorage.ShipQueue memory promoted = game.shipQueue(planetId);
        assertTrue(promoted.active);
        assertEq(uint8(promoted.ship), uint8(Ship.LightFighter));
        assertEq(promoted.quantity, 3);
        assertEq(promoted.readyAt, backlog[0].readyAt);
        assertEq(game.shipQueueBacklog(planetId).length, 0);
        assertEq(game.shipCount(planetId, Ship.SmallCargo), 2);

        vm.warp(promoted.readyAt);
        vm.prank(player);
        game.finishShipProduction(planetId);
        assertFalse(game.shipQueue(planetId).active);
        assertEq(game.shipCount(planetId, Ship.LightFighter), 3);
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
        assertEq(game.planet(colonyPlanetId).resources.metal, 600);
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
        uint8 colonyPosition = _populatedColonyPosition(2, 44, 8);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(2, 44, colonyPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            0
        );
        uint256 positionDistance =
            colonyPosition > 8 ? uint256(colonyPosition - 8) : uint256(8 - colonyPosition);
        uint256 expectedDistance = 1_000 + positionDistance * 5;
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
            TEST_FLEET_UNIVERSE_SPEED
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
        assertEq(game.planet(originPlanetId).resources.metal, 10_000);
        assertEq(game.planet(originPlanetId).resources.crystal, 10_000);
        assertEq(game.planet(originPlanetId).resources.deuterium, 10_000 - expectedFuelCost);
        assertEq(game.planetCountOf(player), 1);
        VeydriftGameStorage.Resources memory internalResourcesBeforeResolution =
            game.totalInternalResources();

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
        assertEq(game.planet(colonyPlanetId).position, colonyPosition);
        assertEq(game.planet(colonyPlanetId).resources.metal, 500);
        assertEq(game.planet(colonyPlanetId).resources.crystal, 500);
        assertEq(game.planet(colonyPlanetId).resources.deuterium, 0);
        VeydriftGameStorage.Resources memory internalResourcesAfterResolution =
            game.totalInternalResources();
        assertEq(
            internalResourcesAfterResolution.metal, internalResourcesBeforeResolution.metal + 500
        );
        assertEq(
            internalResourcesAfterResolution.crystal,
            internalResourcesBeforeResolution.crystal + 500
        );
        assertEq(
            internalResourcesAfterResolution.deuterium, internalResourcesBeforeResolution.deuterium
        );
    }

    function testColonizeFleetMissionRejectsUnpopulatedCoordinates() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 2, 44, 8);
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 4);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        uint8 emptyPosition = _unpopulatedColonyPosition(2, 44, 8);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.UnpopulatedCoordinates.selector);
        game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(2, 44, emptyPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            0
        );
    }

    function testColonizeFleetMissionRejectsCarriedCargo() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 2, 44, 8);
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 4);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        uint8 colonyPosition = _populatedColonyPosition(2, 44, 8);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.CargoNotAllowed.selector);
        game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(2, 44, colonyPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 1, crystal: 0, deuterium: 0}),
            100,
            0
        );
    }

    function testColonizeFleetMissionSettlesReadyColonyShipQueueBeforeValidation() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 2, 44, 8);
        _setBuildingLevel(originPlanetId, Building.Shipyard, 4);
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 4);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);

        vm.prank(player);
        game.startShipProduction(originPlanetId, Ship.ColonyShip, 1);
        VeydriftGameStorage.ShipQueue memory queue = game.shipQueue(originPlanetId);
        vm.warp(queue.readyAt);
        uint8 colonyPosition = _populatedColonyPosition(2, 44, 8);

        assertEq(game.shipCount(originPlanetId, Ship.ColonyShip), 0);
        assertTrue(game.shipQueue(originPlanetId).active);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(2, 44, colonyPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            0
        );

        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        assertFalse(game.shipQueue(originPlanetId).active);
        assertEq(game.shipCount(originPlanetId, Ship.ColonyShip), 0);
    }

    /// @notice VEY-KANEO-490: a Colonize fleet-mission launch must route its colony-ship debit through
    ///         the `PlanetShipCountChanged` sink, exactly like attack/transport launches do. The indexer
    ///         derives the at-planet roster (`contract_ship_counts`) purely from this event, so a launch
    ///         that debits storage WITHOUT emitting would leave the indexer's origin count un-debited —
    ///         a phantom colony ship that over-reports the origin roster even though the ship has
    ///         departed. The existing coverage only asserts the on-chain `shipCount` (storage) drops to
    ///         0, which stays green even if the emit is dropped; this locks the event in.
    function testColonizeFleetMissionLaunchEmitsShipCountChanged() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 2, 44, 8);
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 4);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        uint8 colonyPosition = _populatedColonyPosition(2, 44, 8);

        // The launch debits the single colony ship from the origin and must emit the resulting total (0)
        // through the same `PlanetShipCountChanged` sink the indexer integrates for every mission type.
        vm.expectEmit(true, true, false, true, address(game));
        emit PlanetShipCountChanged(originPlanetId, Ship.ColonyShip, 0);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(2, 44, colonyPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            0
        );

        // The mission is still Outbound (not resolved), proving the debit + emit happen at launch time
        // rather than only at colony creation, and the origin storage roster is debited to 0.
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        assertEq(game.shipCount(originPlanetId, Ship.ColonyShip), 0);
    }

    /// @notice VEY-KANEO-468 Phase 2a: an arrived Colonize mission resolves lazily on the owner's
    ///         next mutating action (here `startShipProduction`, which runs the player-scoped Colonize
    ///         reconcile in its prologue) — no explicit `resolveFleetMission`/keeper tx.
    function testColonizeArrivalLazyResolvesOnNextMutatingAction() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 2, 44, 8);
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 4);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setBuildingLevel(originPlanetId, Building.Shipyard, 2);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);
        uint8 colonyPosition = _populatedColonyPosition(2, 44, 8);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(2, 44, colonyPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            0
        );
        (VeydriftGameStorage.FleetMissionStatus status, uint64 arrivalAt,,) =
            _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        assertEq(game.planetCountOf(player), 1);

        // Fleet has arrived but no resolve tx was sent. An unrelated mutating action must settle it.
        vm.warp(uint256(arrivalAt) + 1 hours);
        vm.prank(player);
        game.startShipProduction(originPlanetId, Ship.SmallCargo, 1);

        (status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertEq(game.planetCountOf(player), 2);
        assertEq(game.planet(2).owner, player);
        assertEq(game.activeFleetMissionCount(player), 0);
    }

    /// @notice The lazy Colonize reconcile is a no-op before arrival (mission stays Outbound, no
    ///         colony) and idempotent after (a second mutating action creates no second colony).
    function testColonizeLazyResolveRespectsArrivalAndIsIdempotent() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 2, 44, 8);
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 4);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setBuildingLevel(originPlanetId, Building.Shipyard, 2);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);
        uint8 colonyPosition = _populatedColonyPosition(2, 44, 8);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(2, 44, colonyPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);

        // Before arrival: the reconcile must NOT resolve — mission stays Outbound, no colony.
        vm.warp(uint256(arrivalAt) - 1);
        vm.prank(player);
        game.startShipProduction(originPlanetId, Ship.SmallCargo, 1);
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        assertEq(game.planetCountOf(player), 1);

        // After arrival: first action resolves it.
        vm.warp(uint256(arrivalAt) + 1);
        vm.prank(player);
        game.startShipProduction(originPlanetId, Ship.SmallCargo, 1);
        (status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertEq(game.planetCountOf(player), 2);

        // Idempotent: a further action creates no second colony and does not revert.
        vm.warp(uint256(arrivalAt) + 2);
        vm.prank(player);
        game.startShipProduction(originPlanetId, Ship.SmallCargo, 1);
        assertEq(game.planetCountOf(player), 2);
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
        uint8 colonyPosition = _populatedColonyPosition(9, 400, 8);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(9, 400, colonyPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            10,
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);

        uint256 competitorColonyId = _settleColonizationMission(
            competitor,
            competitorPlanetId,
            9,
            400,
            colonyPosition,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            _colonyShipManifest()
        );
        assertEq(game.planet(competitorColonyId).owner, competitor);
        VeydriftGameStorage.Resources memory internalResourcesBeforeFailedResolve =
            game.totalInternalResources();

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
        assertEq(game.planet(originPlanetId).resources.metal, metalBeforeReturn);
        assertEq(game.planet(originPlanetId).resources.crystal, crystalBeforeReturn);
        assertEq(game.activeFleetMissionCount(player), 0);
        VeydriftGameStorage.Resources memory internalResourcesAfterFailedReturn =
            game.totalInternalResources();
        assertEq(
            internalResourcesAfterFailedReturn.metal, internalResourcesBeforeFailedResolve.metal
        );
        assertEq(
            internalResourcesAfterFailedReturn.crystal, internalResourcesBeforeFailedResolve.crystal
        );
        assertEq(
            internalResourcesAfterFailedReturn.deuterium,
            internalResourcesBeforeFailedResolve.deuterium
        );
    }

    function testColonizationReturnsIfPlanetLimitIsReachedBeforeArrival() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.Computer, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 2);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        uint8 pendingPosition = _populatedColonyPosition(9, 399, 0);
        uint8 secondPosition = _populatedColonyPosition(9, 399, pendingPosition);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(9, 399, pendingPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            10,
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);

        uint256 secondColonyId = _settleColonizationMission(
            player,
            originPlanetId,
            9,
            399,
            secondPosition,
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
        assertEq(game.planet(originPlanetId).resources.metal, metalBeforeReturn);
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
        // Flat 50% classic plunder loots half of the 6,000 metal left after the save run.
        assertEq(attackCargo.metal, 3_000);
        assertEq(game.planet(targetPlanetId).resources.metal, 3_000);

        (, uint64 saveArrivalAt, uint64 saveReturnAt,) = _fleetMission(saveMissionId);
        uint64 currentTestTime = attackArrivalAt;
        if (currentTestTime < saveArrivalAt) {
            vm.warp(saveArrivalAt);
            currentTestTime = saveArrivalAt;
        }
        game.resolveFleetMission(saveMissionId);
        assertEq(game.planet(safeColonyId).resources.metal, 4_500);
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

    function testTransportRejectsSameAlliancePlanet() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _joinAlliance(player, defender);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        VeydriftGameStorage.Resources memory cargo =
            VeydriftGameStorage.Resources({metal: 100, crystal: 0, deuterium: 0});

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.NotPlanetOwner.selector);
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            cargo,
            0
        );
    }

    function testTransportRejectsNonAllianceForeignPlanet() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.NotPlanetOwner.selector);
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 100, crystal: 0, deuterium: 0}),
            0
        );
    }

    function testDeployStillRejectsSameAlliancePlanet() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _joinAlliance(player, defender);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.NotPlanetOwner.selector);
        game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Deploy,
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
        // Classic raiding caps loot at 50% regardless of the bandit flag.
        assertEq(plunderBps, 5_000);

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

    function testAttackResolutionBouncesWhenTargetBecomesScoreProtectedMidFlight() public {
        vm.warp(8 days);
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setTechnologyLevel(player, Technology.Computer, 2);

        // Attacker and the newbie target start close enough in score that the launch is NOT
        // score-protected and the attack is allowed to depart.
        _setShipCount(originPlanetId, Ship.SmallCargo, 50);
        _setShipCount(targetPlanetId, Ship.SmallCargo, 50);
        _setResources(originPlanetId, 1_000_000, 1_000_000, 1_000_000);
        _setResources(targetPlanetId, 500_000, 500_000, 500_000);

        (VeydriftGameStorage.AttackBlockReason launchReason,,) =
            _attackProtectionStatus(player, targetPlanetId);
        assertEq(uint8(launchReason), uint8(VeydriftGameStorage.AttackBlockReason.None));

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
        (, uint64 arrivalAt,,) = _fleetMission(missionId);

        // While the fleet is in flight the attacker's empire balloons far past the newbie target,
        // so the target is now score-protected and must not be raided on impact (the "attack gap").
        _setShipCount(originPlanetId, Ship.Battleship, 1_000_000);
        (VeydriftGameStorage.AttackBlockReason impactReason,,) =
            _attackProtectionStatus(player, targetPlanetId);
        assertEq(uint8(impactReason), uint8(VeydriftGameStorage.AttackBlockReason.ScoreProtection));

        uint32 defenderShipsBefore = game.shipCount(targetPlanetId, Ship.SmallCargo);

        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 1);
        game.resolveFleetMission(missionId);

        // The attack fleet bounced: it is returning with its ship intact and empty cargo (no
        // plunder loaded), and the protected defender kept all of its ships. A real battle would
        // have either loaded plunder into the cargo or destroyed the lone attacker (status
        // Resolved), so this state is only reachable when no combat ran.
        (
            VeydriftGameStorage.FleetMissionStatus status,,,
            VeydriftGameStorage.Resources memory cargo
        ) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(cargo.metal, 0);
        assertEq(cargo.crystal, 0);
        assertEq(cargo.deuterium, 0);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 49);
        assertEq(game.shipCount(targetPlanetId, Ship.SmallCargo), defenderShipsBefore);
    }

    function testAttackResolutionBouncesWhenTargetJoinsAttackerAllianceMidFlight() public {
        vm.warp(8 days);
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _setTechnologyLevel(player, Technology.Computer, 2);

        // Comparable scores so neither score protection nor same-alliance applies at launch.
        _setShipCount(originPlanetId, Ship.SmallCargo, 50);
        _setShipCount(targetPlanetId, Ship.SmallCargo, 50);
        _setResources(originPlanetId, 1_000_000, 1_000_000, 1_000_000);
        _setResources(targetPlanetId, 500_000, 500_000, 500_000);

        (VeydriftGameStorage.AttackBlockReason launchReason,,) =
            _attackProtectionStatus(player, targetPlanetId);
        assertEq(uint8(launchReason), uint8(VeydriftGameStorage.AttackBlockReason.None));

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
        (, uint64 arrivalAt,,) = _fleetMission(missionId);

        // While the fleet is in flight the target joins the attacker's alliance, so the impact is
        // now a same-alliance attack that must not be raided through the "attack gap".
        uint256 allianceId = _createAlliance(player);
        vm.prank(player);
        allianceSystem.inviteMember(allianceId, defender);
        vm.prank(defender);
        allianceSystem.acceptInvite(allianceId);
        (VeydriftGameStorage.AttackBlockReason impactReason,,) =
            _attackProtectionStatus(player, targetPlanetId);
        assertEq(uint8(impactReason), uint8(VeydriftGameStorage.AttackBlockReason.SameAlliance));

        uint32 defenderShipsBefore = game.shipCount(targetPlanetId, Ship.SmallCargo);

        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 1);
        game.resolveFleetMission(missionId);

        // Same-alliance target is not raided on impact: the fleet bounces home untouched.
        (
            VeydriftGameStorage.FleetMissionStatus status,,,
            VeydriftGameStorage.Resources memory cargo
        ) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(cargo.metal, 0);
        assertEq(cargo.crystal, 0);
        assertEq(cargo.deuterium, 0);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 49);
        assertEq(game.shipCount(targetPlanetId, Ship.SmallCargo), defenderShipsBefore);
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

    function testBashingLimitedAttackStillLootsAtResolutionSinceCapIsEnforcedAtLaunch() public {
        // The bashing window count is incremented at LAUNCH (_recordAttack), so the 6/24h cap is
        // enforced when fleets depart and the 7th attack cannot launch. A within-cap raid therefore
        // reads as BashingLimit at impact yet must still resolve and loot: the resolution-time
        // protection re-check (VEY-KANEO-492) deliberately covers only ScoreProtection/SameAlliance,
        // not the launch-enforced bashing limit, so legitimately launched raids are never bounced.
        vm.warp(8 days);
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setTechnologyLevel(player, Technology.Computer, 5);
        _setShipCount(originPlanetId, Ship.SmallCargo, 6);
        _setResources(originPlanetId, 1_000_000, 1_000_000, 1_000_000);
        _setResources(targetPlanetId, 10_000, 4_000, 3_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        uint256 firstMissionId;
        for (uint256 i = 0; i < VeydriftAntiRaidPrimitives.MAX_ATTACKS_PER_BASHING_WINDOW; i++) {
            vm.prank(player);
            uint256 launchedId = game.launchFleetMission(
                originPlanetId,
                targetPlanetId,
                VeydriftGameStorage.FleetMissionType.Attack,
                ships,
                VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
                i
            );
            if (i == 0) {
                firstMissionId = launchedId;
            }
        }

        // The window is now at the bashing cap: the target reads as BashingLimit.
        (VeydriftGameStorage.AttackBlockReason reason,,) =
            _attackProtectionStatus(player, targetPlanetId);
        assertEq(uint8(reason), uint8(VeydriftGameStorage.AttackBlockReason.BashingLimit));

        (, uint64 arrivalAt,,) = _fleetMission(firstMissionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(firstMissionId, 777);
        game.resolveFleetMission(firstMissionId);

        // BashingLimit does not bounce at resolution: the raid still wins and loots 50% of the metal
        // (cargo-capped), exactly like an unthrottled raid.
        (
            VeydriftGameStorage.FleetMissionStatus status,,,
            VeydriftGameStorage.Resources memory cargo
        ) = _fleetMission(firstMissionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(cargo.metal, 5_000);
        assertEq(game.planet(targetPlanetId).resources.metal, 5_000);
        assertEq(game.planet(targetPlanetId).resources.crystal, 4_000);
        assertEq(game.planet(targetPlanetId).resources.deuterium, 3_000);
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

    // VEY-KANEO-477: a building construction whose `readyAt` has elapsed but was never settled must
    // NOT block abandon with PlanetHasActiveQueues. The module settle (moved above the queue checks)
    // completes ready ship/defense queues; the due building is discarded with the destroyed planet.
    function testAbandonPlanetWithReadyBuildingClearsConstructionAndSucceeds() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        uint256 colonyPlanetId = _createResolvedColony(player, originPlanetId, 21);

        _setResources(colonyPlanetId, 1_000, 1_000, 0);
        vm.prank(player);
        game.startBuildingUpgrade(colonyPlanetId, Building.MetalMine);
        VeydriftGameStorage.BuildingConstruction memory construction =
            game.activeBuildingConstruction(colonyPlanetId);
        assertTrue(construction.active);

        // Construction is ready but unsettled (no finish tx); empty the planet at the ready instant.
        vm.warp(construction.readyAt);
        _setPlanetLastSettledAt(colonyPlanetId, uint64(block.timestamp));
        _setResources(colonyPlanetId, 0, 0, 0);

        vm.prank(player);
        game.abandonPlanet(colonyPlanetId);

        assertEq(game.planet(colonyPlanetId).owner, address(0));
        assertFalse(game.activeBuildingConstruction(colonyPlanetId).active);
        assertEq(game.planetCountOf(player), 1);
    }

    // VEY-KANEO-477: an in-progress (not-yet-ready) building still blocks abandon.
    function testAbandonPlanetStillRejectsInProgressBuilding() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        uint256 colonyPlanetId = _createResolvedColony(player, originPlanetId, 22);

        _setResources(colonyPlanetId, 1_000, 1_000, 0);
        vm.prank(player);
        game.startBuildingUpgrade(colonyPlanetId, Building.MetalMine);
        _setResources(colonyPlanetId, 0, 0, 0);

        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.PlanetHasActiveQueues.selector);
        game.abandonPlanet(colonyPlanetId);
    }

    // VEY-KANEO-477: a missile attack must settle the origin's ready-but-unsettled defense production
    // queue BEFORE reading `_defenseCounts`, so just-finished interplanetary missiles are available to
    // fire rather than the launch reverting InvalidQuantity on a stale (0) count.
    function testMissileAttackSettlesOriginReadyMissileQueueBeforeFiring() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedMissileAttackPlanets();
        _seedDefensePrerequisites(originPlanetId);
        _setResources(originPlanetId, 10_000_000, 10_000_000, 10_000_000);
        _setDefenseCount(targetPlanetId, Defense.LightLaser, 10);

        vm.prank(player);
        game.startDefenseProduction(originPlanetId, Defense.InterplanetaryMissile, 3);
        VeydriftGameStorage.DefenseQueue memory queue = game.defenseQueue(originPlanetId);
        assertTrue(queue.active);

        // Missiles are ready but never settled (no finish tx); origin's stored count is still 0.
        vm.warp(queue.readyAt);

        vm.prank(player);
        game.launchInterplanetaryMissileAttack(
            originPlanetId, targetPlanetId, Defense.LightLaser, 3
        );

        assertEq(game.defenseCount(originPlanetId, Defense.InterplanetaryMissile), 0);
        assertEq(game.defenseCount(targetPlanetId, Defense.LightLaser), 7);
    }

    // VEY-KANEO-477: launching a Colonize mission must settle the player's due-but-unresolved fleet
    // arrivals BEFORE `_validateColonyCreation`'s pending-resolution gate, so a prior arrived colony
    // does not wrongly block the next colonize launch.
    function testColonizeLaunchSettlesDueArrivalBeforeValidating() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 2, 60, 8);
        _setTechnologyLevel(player, Technology.Astrophysics, 2);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 4);
        _setTechnologyLevel(player, Technology.Computer, 3);
        _setShipCount(originPlanetId, Ship.ColonyShip, 2);
        _setResources(originPlanetId, 1_000_000, 1_000_000, 1_000_000);
        uint8 firstColonyPosition = _populatedColonyPosition(2, 60, 8);
        uint8 secondColonyPosition = _populatedColonyPosition(2, 60, firstColonyPosition);

        vm.prank(player);
        uint256 firstMissionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(2, 60, firstColonyPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(firstMissionId);

        // First colony has arrived but is unresolved -> pending resolution on the origin.
        vm.warp(uint256(arrivalAt) + 1);

        vm.prank(player);
        uint256 secondMissionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(2, 60, secondColonyPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            0
        );
        assertGt(secondMissionId, firstMissionId);

        // The launch prologue resolved the first colony (terminal Resolved, slot was free).
        (VeydriftGameStorage.FleetMissionStatus firstStatus,,,) = _fleetMission(firstMissionId);
        assertEq(uint8(firstStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
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
        uint128 expectedFuelCost = uint128(_expectedOgameFuelCost(ships, distance, 100, 5_000));
        assertLt(expectedFuelCost, VeydriftAntiRaidPrimitives.missionFuelCost(130, distance));
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
        assertGt(arrivalAt, block.timestamp + TEST_FLEET_RECALL_CUTOFF_SECONDS);

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
        uint64 recallDeadline = cutoffArrivalAt - TEST_FLEET_RECALL_CUTOFF_SECONDS;
        vm.warp(cutoffArrivalAt - TEST_FLEET_RECALL_CUTOFF_SECONDS + 1);
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
        // Flat 50% classic plunder: half of each small balance is looted.
        assertEq(cargo.metal, 450);
        assertEq(cargo.crystal, 450);
        assertEq(cargo.deuterium, 450);
        assertEq(game.planet(targetPlanetId).resources.metal, 450);
    }

    function _launchAttackWithLootRatio(
        uint256 originPlanetId,
        uint256 targetPlanetId,
        uint16 metalBps,
        uint16 crystalBps,
        uint16 deuteriumBps,
        uint256 randomnessRequestId
    ) internal returns (uint256 missionId) {
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        return game.launchAttackMission(
            originPlanetId,
            targetPlanetId,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            VeydriftAntiRaidPrimitives.FULL_MISSION_SPEED_PERCENT,
            randomnessRequestId,
            VeydriftGameStorage.LootRatio({
                metalBps: metalBps, crystalBps: crystalBps, deuteriumBps: deuteriumBps
            })
        );
    }

    function testAttackLootRatioSplitsCapacityWhenCapsNonBinding() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        // Honorable plunder (7_500 bps) keeps every per-resource cap above the ratio shares,
        // so the 5_000-capacity SmallCargo is split purely by the requested 50/30/20 ratio.
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

        uint256 missionId =
            _launchAttackWithLootRatio(originPlanetId, targetPlanetId, 5_000, 3_000, 2_000, 811);
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 811);
        game.resolveFleetMission(missionId);

        (,,, VeydriftGameStorage.Resources memory cargo) = _fleetMission(missionId);
        assertEq(cargo.metal, 2_500);
        assertEq(cargo.crystal, 1_500);
        assertEq(cargo.deuterium, 1_000);
        assertEq(game.planet(targetPlanetId).resources.metal, 7_500);
        assertEq(game.planet(targetPlanetId).resources.crystal, 8_500);
        assertEq(game.planet(targetPlanetId).resources.deuterium, 9_000);
    }

    function testAttackLootRatioRollsUnfillableShareIntoNextResource() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        // No metal to loot: the 40% metal share cannot be filled and rolls over to crystal,
        // while the deuterium share is still honored instead of being greedily skipped.
        _setResources(targetPlanetId, 0, 10_000, 10_000);

        uint256 missionId =
            _launchAttackWithLootRatio(originPlanetId, targetPlanetId, 4_000, 4_000, 2_000, 812);
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 812);
        game.resolveFleetMission(missionId);

        (,,, VeydriftGameStorage.Resources memory cargo) = _fleetMission(missionId);
        assertEq(cargo.metal, 0);
        assertEq(cargo.crystal, 4_000);
        assertEq(cargo.deuterium, 1_000);
        assertEq(game.planet(targetPlanetId).resources.crystal, 6_000);
        assertEq(game.planet(targetPlanetId).resources.deuterium, 9_000);
    }

    function testAttackLootRatioRejectsScoreProtectedTargetAtLaunch() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(originPlanetId, Ship.Deathstar, 2_000);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        (VeydriftGameStorage.AttackBlockReason reason,,) =
            _attackProtectionStatus(player, targetPlanetId);
        assertEq(uint8(reason), uint8(VeydriftGameStorage.AttackBlockReason.ScoreProtection));

        vm.expectRevert(VeydriftGameStorage.AttackScoreProtection.selector);
        _launchAttackWithLootRatio(originPlanetId, targetPlanetId, 5_000, 3_000, 2_000, 813);
    }

    // The cap-bound cascade (a resource share saturates its plunder cap and the remainder rolls into
    // the next resource) is asserted directly against the deployed VeydriftRaidStorage library at the
    // game's flat plunder rate (BASE_RAID_LOOT_BPS = 5_000). Exercising the library in isolation keeps
    // the cascade arithmetic deterministic and independent of the resolution path, which reaches the
    // plunder rate through the combat module's self-`staticcall` to `attackProtectionStatus`. The two
    // surrounding integration tests still cover launch -> resolve -> raid with a ratio at caps that are
    // non-binding, so the end-to-end wiring stays exercised.
    function testRaidCascadesCrystalCapIntoDeuterium() public {
        RaidStorageHarness harness = new RaidStorageHarness();
        // Empty metal and only 3_000 crystal: at the 5_000 bps plunder rate the crystal cap is 1_500,
        // so the rolled-over metal capacity saturates crystal and cascades into deuterium.
        harness.setTarget(0, 3_000, 10_000);

        (uint128 metal, uint128 crystal, uint128 deuterium) = harness.raid({
            capacity: 5_000,
            plunderRateBps: VeydriftAntiRaidPrimitives.BASE_RAID_LOOT_BPS,
            metalBps: 5_000,
            crystalBps: 2_500,
            deuteriumBps: 2_500
        });

        assertEq(metal, 0);
        assertEq(crystal, 1_500);
        assertEq(deuterium, 3_500);
        VeydriftGameStorage.Resources memory remaining = harness.target();
        assertEq(remaining.metal, 0);
        assertEq(remaining.crystal, 1_500);
        assertEq(remaining.deuterium, 6_500);
    }

    function testAttackLootRatioEmitsLaunchEvent() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        uint256 expectedMissionId = game.nextFleetId();
        vm.expectEmit(true, false, false, true, address(game));
        emit FleetMissionLootRatio(expectedMissionId, 6_000, 2_500, 1_500);
        vm.prank(player);
        game.launchAttackMission(
            originPlanetId,
            targetPlanetId,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            VeydriftAntiRaidPrimitives.FULL_MISSION_SPEED_PERCENT,
            815,
            VeydriftGameStorage.LootRatio({metalBps: 6_000, crystalBps: 2_500, deuteriumBps: 1_500})
        );
    }

    function testAttackLootRatioRejectsSharesThatDoNotSumToBps() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 10_000, 10_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.InvalidLootRatio.selector);
        game.launchAttackMission(
            originPlanetId,
            targetPlanetId,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            VeydriftAntiRaidPrimitives.FULL_MISSION_SPEED_PERCENT,
            816,
            VeydriftGameStorage.LootRatio({metalBps: 5_000, crystalBps: 3_000, deuteriumBps: 1_000})
        );
    }

    function testAttackLootRatioRejectsZeroRatio() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);

        // The dedicated entrypoint requires a real ratio; plain greedy attacks use
        // launchFleetMission instead.
        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        vm.expectRevert(VeydriftGameStorage.InvalidLootRatio.selector);
        game.launchAttackMission(
            originPlanetId,
            targetPlanetId,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            VeydriftAntiRaidPrimitives.FULL_MISSION_SPEED_PERCENT,
            817,
            VeydriftGameStorage.LootRatio({metalBps: 0, crystalBps: 0, deuteriumBps: 0})
        );
    }

    function testAttackResolutionSettlesTargetResourcesAtImpactNotLateResolverTime() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setBuildingLevel(targetPlanetId, Building.MetalMine, 1);
        _setBuildingLevel(targetPlanetId, Building.MetalStorage, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 10_000, 0, 10_000);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            339
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        _setPlanetLastSettledAt(targetPlanetId, arrivalAt);

        vm.warp(arrivalAt + 1 days);
        _fulfillAttackBattleRandomness(missionId, 339);
        game.resolveFleetMission(missionId);

        (,,, VeydriftGameStorage.Resources memory cargo) = _fleetMission(missionId);
        assertEq(cargo.metal, 5_000);
        assertEq(game.planet(targetPlanetId).resources.metal, 5_000);
        assertEq(game.planet(targetPlanetId).lastSettledAt, arrivalAt);

        vm.prank(game.planet(targetPlanetId).owner);
        game.collectResources(targetPlanetId);
        assertGt(game.planet(targetPlanetId).lastSettledAt, arrivalAt);
    }

    function testAttackResolutionCompletesDefenderQueuesReadyByImpact() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _setBuildingLevel(targetPlanetId, Building.Shipyard, 2);
        _setTechnologyLevel(defender, Technology.CombustionDrive, 1);
        _setResources(targetPlanetId, 100_000, 100_000, 100_000);

        // Both queues are started before either is ready and the defender takes no further action,
        // so they stay pending until the attack's impact-time snapshot settles them. (VEY-KANEO-468:
        // any intervening defender mutation would lazily settle an already-ready queue sooner — see
        // testMutatingCallSettlesDueShipAndDefenseWithoutFinishTx.)
        vm.prank(defender);
        game.startShipProduction(targetPlanetId, Ship.LightFighter, 1);
        vm.prank(defender);
        game.startDefenseProduction(targetPlanetId, Defense.RocketLauncher, 1);
        VeydriftGameStorage.ShipQueue memory shipQueue = game.shipQueue(targetPlanetId);
        VeydriftGameStorage.DefenseQueue memory defenseQueue = game.defenseQueue(targetPlanetId);
        vm.warp(shipQueue.readyAt > defenseQueue.readyAt ? shipQueue.readyAt : defenseQueue.readyAt);

        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 100_000, 100_000, 100_000);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            340
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);

        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 340);
        vm.expectEmit(true, true, true, true, address(game));
        emit ShipCompleted(targetPlanetId, Ship.LightFighter, 1, 1);
        vm.expectEmit(true, true, true, true, address(game));
        emit DefenseCompleted(targetPlanetId, Defense.RocketLauncher, 1, 1);
        game.resolveFleetMission(missionId);

        assertFalse(game.shipQueue(targetPlanetId).active);
        assertFalse(game.defenseQueue(targetPlanetId).active);
    }

    function testAttackResolutionExcludesQueuesReadyAfterImpactEvenWhenResolvedLate() public {
        (uint256 originPlanetId, uint256 targetPlanetId, address defender) = _seedAttackPlanets();
        _setPlanetCoordinates(originPlanetId, 1, 100, 8);
        _setPlanetCoordinates(targetPlanetId, 1, 100, 9);
        _setBuildingLevel(targetPlanetId, Building.Shipyard, 2);
        _setTechnologyLevel(defender, Technology.CombustionDrive, 1);
        _setResources(targetPlanetId, 1_000_000, 1_000_000, 1_000_000);

        vm.prank(defender);
        game.startShipProduction(targetPlanetId, Ship.LightFighter, 50);
        VeydriftGameStorage.ShipQueue memory shipQueue = game.shipQueue(targetPlanetId);

        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(targetPlanetId, 100_000, 100_000, 100_000);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _smallCargoManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            341
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        assertGt(shipQueue.readyAt, arrivalAt);

        vm.warp(shipQueue.readyAt + 1);
        _fulfillAttackBattleRandomness(missionId, 341);
        game.resolveFleetMission(missionId);

        assertTrue(game.shipQueue(targetPlanetId).active);
        assertEq(game.shipCount(targetPlanetId, Ship.LightFighter), 0);
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

    function testFleetCounterplayAcsDefendAllowsOwnDefenseWithoutAlliance() public {
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
        uint256 counterplayMissionId = game.launchFleetMission(
            targetPlanetId,
            hostileMissionId,
            VeydriftGameStorage.FleetMissionType.AcsDefend,
            defenders,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(counterplayMissionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
    }

    function testFleetCounterplayRequiresAlliancePermissionForAlliedDefense() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        address stranger = address(0xBAD);
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        uint256 strangerPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(strangerPlanetId, 1, 100, 10);
        _setShipCount(originPlanetId, Ship.SmallCargo, 1);
        _setShipCount(strangerPlanetId, Ship.LightFighter, 1);
        _setResources(originPlanetId, 10_000, 10_000, 10_000);
        _setResources(strangerPlanetId, 10_000, 10_000, 10_000);

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
        vm.prank(stranger);
        vm.expectRevert(VeydriftGameStorage.InvalidQuantity.selector);
        game.launchFleetMission(
            strangerPlanetId,
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

    // --- OGame-style ACS Defend (DefenseHold) stationing: VEY-KANEO-441 ---

    function _noCargo() internal pure returns (VeydriftGameStorage.Resources memory) {
        return VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0});
    }

    function _seedDefenseHold()
        internal
        returns (
            address ally,
            uint256 attackerPlanetId,
            uint256 targetPlanetId,
            uint256 allyPlanetId
        )
    {
        address defender = address(0xDEF);
        ally = address(0xA11);
        vm.deal(defender, 1 ether);
        vm.deal(ally, 1 ether);
        vm.prank(player);
        attackerPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        targetPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(ally);
        allyPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(attackerPlanetId, 1, 100, 8);
        _setPlanetCoordinates(targetPlanetId, 1, 100, 9);
        _setPlanetCoordinates(allyPlanetId, 1, 100, 10);
        uint256 allianceId = _createAlliance(defender);
        vm.prank(defender);
        allianceSystem.inviteMember(allianceId, ally);
        vm.prank(ally);
        allianceSystem.acceptInvite(allianceId);
    }

    function testDefenseHoldStationedFleetDefendsAttackAndKeepsHolding() public {
        (address ally, uint256 attackerPlanetId, uint256 targetPlanetId, uint256 allyPlanetId) =
            _seedDefenseHold();
        _setShipCount(attackerPlanetId, Ship.SmallCargo, 1);
        _setShipCount(allyPlanetId, Ship.Battleship, 1);
        _setResources(attackerPlanetId, 100_000, 100_000, 100_000);
        _setResources(allyPlanetId, 100_000, 100_000, 100_000);
        _setResources(targetPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory defenders;
        defenders.battleship = 1;
        vm.prank(ally);
        uint256 holdMissionId = game.launchDefenseHold(
            allyPlanetId, targetPlanetId, defenders, _noCargo(), 100, 4 hours
        );

        // The stationed fleet has arrived and is holding before the attack lands.
        (, uint64 holdArrivalAt, uint64 holdReturnAt,) = _fleetMission(holdMissionId);
        vm.warp(holdArrivalAt + 1 hours);

        VeydriftGameStorage.MissionShips memory attackers;
        attackers.smallCargo = 1;
        vm.prank(player);
        uint256 attackMissionId = game.launchFleetMission(
            attackerPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            attackers,
            _noCargo(),
            771
        );
        (, uint64 attackArrivalAt,,) = _fleetMission(attackMissionId);
        vm.warp(attackArrivalAt);
        _fulfillAttackBattleRandomness(attackMissionId, 771);
        game.resolveFleetMission(attackMissionId);

        // The lone SmallCargo cannot dent the stationed Battleship: the attacker is wiped and the
        // stationed fleet survives and KEEPS holding to defend any further attack in the window.
        (VeydriftGameStorage.FleetMissionStatus attackStatus,,,) = _fleetMission(attackMissionId);
        assertEq(uint8(attackStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        (VeydriftGameStorage.FleetMissionStatus holdStatus,,,) = _fleetMission(holdMissionId);
        assertEq(uint8(holdStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));

        // After the hold window the fleet flies home with its surviving ships.
        vm.warp(holdArrivalAt + 4 hours);
        game.resolveFleetMission(holdMissionId);
        (VeydriftGameStorage.FleetMissionStatus afterHold,,,) = _fleetMission(holdMissionId);
        assertEq(uint8(afterHold), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        vm.warp(holdReturnAt);
        game.completeFleetMissionReturn(holdMissionId);
        assertEq(game.shipCount(allyPlanetId, Ship.Battleship), 1);
    }

    function testDefenseHoldDefendsEveryAttackWithinWindow() public {
        (address ally, uint256 attackerPlanetId, uint256 targetPlanetId, uint256 allyPlanetId) =
            _seedDefenseHold();
        _setShipCount(attackerPlanetId, Ship.SmallCargo, 2);
        _setShipCount(allyPlanetId, Ship.Battleship, 1);
        _setResources(attackerPlanetId, 1_000_000, 1_000_000, 1_000_000);
        _setResources(allyPlanetId, 1_000_000, 1_000_000, 1_000_000);
        _setResources(targetPlanetId, 1_000_000, 1_000_000, 1_000_000);

        VeydriftGameStorage.MissionShips memory defenders;
        defenders.battleship = 1;
        vm.prank(ally);
        uint256 holdMissionId = game.launchDefenseHold(
            allyPlanetId, targetPlanetId, defenders, _noCargo(), 100, 8 hours
        );
        (, uint64 holdArrivalAt,,) = _fleetMission(holdMissionId);

        VeydriftGameStorage.MissionShips memory attackers;
        attackers.smallCargo = 1;
        for (uint256 i = 0; i < 2; i++) {
            vm.warp(holdArrivalAt + 1 hours + i * 1 hours);
            vm.prank(player);
            uint256 attackMissionId = game.launchFleetMission(
                attackerPlanetId,
                targetPlanetId,
                VeydriftGameStorage.FleetMissionType.Attack,
                attackers,
                _noCargo(),
                900 + i
            );
            (, uint64 attackArrivalAt,,) = _fleetMission(attackMissionId);
            vm.warp(attackArrivalAt);
            _fulfillAttackBattleRandomness(attackMissionId, 900 + i);
            game.resolveFleetMission(attackMissionId);

            // The stationed fleet defends each successive attack and stays on station.
            (VeydriftGameStorage.FleetMissionStatus holdStatus,,,) = _fleetMission(holdMissionId);
            assertEq(uint8(holdStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        }
        assertEq(game.shipCount(targetPlanetId, Ship.SmallCargo), 0);
    }

    function testDefenseHoldCannotReturnBeforeWindowElapses() public {
        (address ally,, uint256 targetPlanetId, uint256 allyPlanetId) = _seedDefenseHold();
        _setShipCount(allyPlanetId, Ship.Battleship, 1);
        _setResources(allyPlanetId, 100_000, 100_000, 100_000);
        _setResources(targetPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory defenders;
        defenders.battleship = 1;
        vm.prank(ally);
        uint256 holdMissionId = game.launchDefenseHold(
            allyPlanetId, targetPlanetId, defenders, _noCargo(), 100, 4 hours
        );
        (, uint64 holdArrivalAt,,) = _fleetMission(holdMissionId);
        uint64 holdUntil = holdArrivalAt + 4 hours;

        vm.warp(holdArrivalAt + 1 hours);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.DefenseHoldStillActive.selector, holdUntil)
        );
        game.resolveFleetMission(holdMissionId);
    }

    function testDefenseHoldCanBeRecalledWhileStationed() public {
        (address ally,, uint256 targetPlanetId, uint256 allyPlanetId) = _seedDefenseHold();
        _setShipCount(allyPlanetId, Ship.Battleship, 1);
        _setResources(allyPlanetId, 1_000_000, 1_000_000, 1_000_000);
        _setResources(targetPlanetId, 1_000_000, 1_000_000, 1_000_000);

        VeydriftGameStorage.MissionShips memory defenders;
        defenders.battleship = 1;
        vm.prank(ally);
        uint256 holdMissionId = game.launchDefenseHold(
            allyPlanetId, targetPlanetId, defenders, _noCargo(), 100, 4 hours
        );
        (, uint64 holdArrivalAt, uint64 originalReturnAt,) = _fleetMission(holdMissionId);
        uint64 holdUntil = holdArrivalAt + 4 hours;
        uint64 recallAt = holdArrivalAt + 1 hours;
        uint64 expectedReturnAt = recallAt + (originalReturnAt - holdUntil);

        vm.warp(recallAt);
        vm.expectEmit(true, true, false, false, address(game));
        emit FleetMissionRecalled(holdMissionId, ally, expectedReturnAt, 0);
        vm.expectEmit(true, true, true, true, address(game));
        emit DefenseHoldEnded(
            holdMissionId, targetPlanetId, VeydriftGameStorage.FleetMissionStatus.Recalled
        );
        vm.expectEmit(true, true, true, false, address(game));
        emit FleetMissionReturnExposed(
            holdMissionId,
            ally,
            VeydriftGameStorage.FleetMissionStatus.Recalled,
            allyPlanetId,
            targetPlanetId,
            expectedReturnAt,
            0,
            0,
            0
        );
        vm.prank(ally);
        game.recallFleetMission(holdMissionId);

        (VeydriftGameStorage.FleetMissionStatus status,, uint64 returnAt,) =
            _fleetMission(holdMissionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Recalled));
        assertEq(returnAt, expectedReturnAt);
    }

    function testDefenseHoldRejectsUnauthorizedTarget() public {
        (, uint256 attackerPlanetId, uint256 targetPlanetId,) = _seedDefenseHold();
        _setShipCount(attackerPlanetId, Ship.Battleship, 1);
        _setResources(attackerPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.battleship = 1;
        // The attacker is neither the target owner nor a same-alliance member.
        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.DefenseHoldNotAuthorized.selector, targetPlanetId
            )
        );
        game.launchDefenseHold(attackerPlanetId, targetPlanetId, ships, _noCargo(), 100, 4 hours);
    }

    function testDefenseHoldRejectsInvalidHoldWindow() public {
        (address ally,, uint256 targetPlanetId, uint256 allyPlanetId) = _seedDefenseHold();
        _setShipCount(allyPlanetId, Ship.Battleship, 1);
        _setResources(allyPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.battleship = 1;
        vm.prank(ally);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.InvalidHoldWindow.selector, uint256(0))
        );
        game.launchDefenseHold(allyPlanetId, targetPlanetId, ships, _noCargo(), 100, 0);
    }

    function testLaunchFleetMissionRejectsDefenseHoldType() public {
        (address ally,, uint256 targetPlanetId, uint256 allyPlanetId) = _seedDefenseHold();
        _setShipCount(allyPlanetId, Ship.Battleship, 1);
        _setResources(allyPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.battleship = 1;
        vm.prank(ally);
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftGameStorage.InvalidMissionType.selector,
                VeydriftGameStorage.FleetMissionType.DefenseHold
            )
        );
        game.launchFleetMission(
            allyPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.DefenseHold,
            ships,
            _noCargo(),
            4 hours
        );
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
        // Flat 50% classic plunder of 10,000/4,000/3,000 fits both cargos and splits evenly.
        assertEq(attackCargo.metal, 2_500);
        assertEq(attackCargo.crystal, 1_000);
        assertEq(attackCargo.deuterium, 750);
        assertEq(joinedCargo.metal, 2_500);
        assertEq(joinedCargo.crystal, 1_000);
        assertEq(joinedCargo.deuterium, 750);

        vm.warp(joinedReturnAt);
        game.completeFleetMissionReturn(joinedMissionId);
        assertEq(game.shipCount(allyPlanetId, Ship.SmallCargo), 1);
        assertEq(game.planet(allyPlanetId).resources.metal, 12_500);

        vm.warp(attackReturnAt);
        game.completeFleetMissionReturn(attackMissionId);
        assertEq(game.shipCount(originPlanetId, Ship.SmallCargo), 1);
        assertEq(game.planet(originPlanetId).resources.metal, 12_500);
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
        vm.warp(arrivalAt - TEST_FLEET_RECALL_CUTOFF_SECONDS);
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

    function testAttackBattleCrawlerOnlyDefenderDoesNotForceDraw() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.Battleship, 100);
        _setShipCount(targetPlanetId, Ship.Crawler, 1);
        _setResources(originPlanetId, 10_000_000, 10_000_000, 10_000_000);
        _setResources(targetPlanetId, 10_000_000, 10_000_000, 10_000_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.battleship = 100;

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            651
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 651);

        vm.recordLogs();
        game.resolveFleetMission(missionId);
        (VeydriftGameStorage.BattleOutcome outcome, uint8 rounds) =
            _attackBattleOutcomeFromRecordedLogs(missionId);

        assertEq(uint8(outcome), uint8(VeydriftGameStorage.BattleOutcome.AttackerWin));
        assertEq(rounds, 0);
        assertEq(game.shipCount(targetPlanetId, Ship.Crawler), 0);
        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
    }

    function testAttackBattleCrawlerDoesNotDrawAfterCombatDefendersCleared() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.Battleship, 100);
        _setShipCount(targetPlanetId, Ship.Crawler, 1);
        _setDefenseCount(targetPlanetId, Defense.RocketLauncher, 1);
        _setResources(originPlanetId, 10_000_000, 10_000_000, 10_000_000);
        _setResources(targetPlanetId, 10_000_000, 10_000_000, 10_000_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.battleship = 100;

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            652
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 652);

        vm.recordLogs();
        game.resolveFleetMission(missionId);
        (VeydriftGameStorage.BattleOutcome outcome, uint8 rounds) =
            _attackBattleOutcomeFromRecordedLogs(missionId);

        assertEq(uint8(outcome), uint8(VeydriftGameStorage.BattleOutcome.AttackerWin));
        assertGt(rounds, 0);
        assertEq(game.shipCount(targetPlanetId, Ship.Crawler), 0);
        assertEq(game.defenseCount(targetPlanetId, Defense.RocketLauncher), 0);
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

    function testAttackBattleShieldDomeRepairUsesSeparateSeventyPercentRoll() public {
        _assertShieldDomeRepairRollCoversBothOutcomes(Defense.SmallShieldDome);
        _assertShieldDomeRepairRollCoversBothOutcomes(Defense.LargeShieldDome);
    }

    function testAttackBattleRecomputesDefenseShieldsEachRound() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.Destroyer, 1);
        _setDefenseCount(targetPlanetId, Defense.SmallShieldDome, 1);
        _setResources(originPlanetId, 1_000_000, 1_000_000, 1_000_000);
        _setResources(targetPlanetId, 1_000_000, 1_000_000, 1_000_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.destroyer = 1;

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            780
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 780);
        game.resolveFleetMission(missionId);

        assertEq(game.defenseCount(targetPlanetId, Defense.SmallShieldDome), 1);
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
            keccak256(abi.encode(TEST_ATTACK_BATTLE_DOMAIN, block.chainid, missionId));
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
                    TEST_ATTACK_BATTLE_DOMAIN,
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

    /// @notice VEY-KANEO-468 Phase 2b: an arrived Attack whose randomness is fulfilled resolves
    ///         lazily on the attacker's next ordinary mutating action — no keeper/resolve tx.
    function testAttackArrivalLazyResolvesOnNextMutatingActionWhenRandomnessReady() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setBuildingLevel(originPlanetId, Building.Shipyard, 2);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setShipCount(originPlanetId, Ship.SmallCargo, 2);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);
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
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, 42);

        vm.prank(player);
        game.startShipProduction(originPlanetId, Ship.SmallCargo, 1);

        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
    }

    function testFleetLaunchLazilyResolvesReadyCombatArrivalBeforePendingGate() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setTechnologyLevel(player, Technology.Computer, 1);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setShipCount(originPlanetId, Ship.SmallCargo, 2);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);
        _setResources(targetPlanetId, 10_000, 4_000, 3_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 firstMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(firstMissionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(firstMissionId, 77);

        vm.prank(player);
        uint256 secondMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        (VeydriftGameStorage.FleetMissionStatus firstStatus,,,) = _fleetMission(firstMissionId);
        (VeydriftGameStorage.FleetMissionStatus secondStatus,,,) = _fleetMission(secondMissionId);
        assertEq(uint8(firstStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Returning));
        assertEq(uint8(secondStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        assertEq(game.activeFleetMissionCount(player), 2);
    }

    function testFleetLaunchLazilyResolvesReadyDeployArrivalBeforeSlotGate() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 2, 10, 4);
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 4);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setShipCount(originPlanetId, Ship.ColonyShip, 1);
        uint256 targetPlanetId = _createResolvedColony(player, originPlanetId, 220);
        _setShipCount(originPlanetId, Ship.SmallCargo, 2);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.smallCargo = 1;
        vm.prank(player);
        uint256 deployMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Deploy,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(deployMissionId);
        vm.warp(arrivalAt);

        vm.prank(player);
        uint256 transportMissionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Transport,
            ships,
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );

        (VeydriftGameStorage.FleetMissionStatus deployStatus,,,) = _fleetMission(deployMissionId);
        (VeydriftGameStorage.FleetMissionStatus transportStatus,,,) =
            _fleetMission(transportMissionId);
        assertEq(uint8(deployStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertEq(uint8(transportStatus), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        assertEq(game.activeFleetMissionCount(player), 1);
    }

    /// @notice Lazy combat settlement must not leak the randomness-engine revert to the caller. When
    ///         the battle seed is still pending, the mission remains Outbound and the pre-existing
    ///         pending-mission gate remains the user-visible blocker.
    function testAttackArrivalLazySettleSkipsPendingRandomness() public {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setBuildingLevel(originPlanetId, Building.Shipyard, 2);
        _setTechnologyLevel(player, Technology.CombustionDrive, 2);
        _setShipCount(originPlanetId, Ship.SmallCargo, 2);
        _setResources(originPlanetId, 100_000, 100_000, 100_000);
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
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);

        vm.prank(player);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.FleetMissionNotResolved.selector, arrivalAt)
        );
        game.startShipProduction(originPlanetId, Ship.SmallCargo, 1);

        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
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
        (, uint64 harvestArrivalAt, uint64 harvestReturnAt,) = _fleetMission(harvestMissionId);
        vm.warp(harvestArrivalAt);
        vm.expectEmit(true, true, true, true, address(game));
        emit FleetMissionReturnExposed(
            harvestMissionId,
            player,
            VeydriftGameStorage.FleetMissionStatus.Returning,
            originPlanetId,
            targetPlanetId,
            harvestReturnAt,
            10_000,
            10_000,
            0
        );
        vm.expectEmit(true, true, true, true, address(game));
        emit FleetMissionResolved(
            harvestMissionId,
            address(this),
            VeydriftGameStorage.FleetMissionType.Harvest,
            harvestReturnAt
        );
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
        uint256 moonChanceDebrisUnit = 100_000;
        uint16 maxMoonChanceBps = 2_000;
        uint256 debris = uint256(metalDebris) + crystalDebris;
        uint256 debrisUnits = debris / moonChanceDebrisUnit;
        uint256 expected = debrisUnits * 100;
        if (expected > maxMoonChanceBps) expected = maxMoonChanceBps;

        uint16 chanceBps = moons.moonChanceBps(metalDebris, crystalDebris);
        assertEq(chanceBps, expected);
        assertLe(chanceBps, maxMoonChanceBps);
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

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftGameStorage.Unauthorized.selector, player));
        game.completeAttackTargetSnapshotQueues(targetPlanetId, arrivalAt);

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
        uint8 colonyPosition = _populatedColonyPosition(2, 44, 0);

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftGameStorage.PlanetLimitReached.selector, 1));
        game.launchFleetMission(
            planetId,
            _colonizationTargetId(2, 44, colonyPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            0
        );
    }

    function testColonizeLaunchSettlesDueAstrophysicsBeforePlanetLimit() public {
        vm.prank(player);
        uint256 planetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(planetId, 2, 44, 8);
        _setTechnologyLevel(player, Technology.ImpulseDrive, 3);
        _setResearchQueue(player, Technology.Astrophysics, 1, uint64(block.timestamp));
        _setShipCount(planetId, Ship.ColonyShip, 1);
        _setResources(planetId, 100_000, 100_000, 100_000);
        uint8 colonyPosition = _populatedColonyPosition(2, 44, 8);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            planetId,
            _colonizationTargetId(2, 44, colonyPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            100,
            0
        );

        assertGt(missionId, 0);
        assertEq(game.technologyLevel(player, Technology.Astrophysics), 1);
        assertFalse(game.researchQueue(player).active);
    }

    function testColonizeArrivalSettlesDueAstrophysicsAtArrivalBeforeLimit() public {
        vm.prank(player);
        uint256 originPlanetId = game.startPlanet{value: 0.05 ether}();
        _setTechnologyLevel(player, Technology.Astrophysics, 1);
        _setTechnologyLevel(player, Technology.Computer, 2);
        _setShipCount(originPlanetId, Ship.ColonyShip, 2);
        _setResources(originPlanetId, 1_000_000, 1_000_000, 1_000_000);
        uint8 colonyPosition = _populatedColonyPosition(9, 399, 0);

        vm.prank(player);
        uint256 missionId = game.launchFleetMission(
            originPlanetId,
            _colonizationTargetId(9, 399, colonyPosition),
            VeydriftGameStorage.FleetMissionType.Colonize,
            _colonyShipManifest(),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            10,
            0
        );
        (, uint64 arrivalAt,,) = _fleetMission(missionId);

        uint256 secondColonyId = _createResolvedColony(player, originPlanetId, 67);
        assertEq(game.planet(secondColonyId).owner, player);
        assertEq(game.planetCountOf(player), 2);

        _setResearchQueue(player, Technology.Astrophysics, 2, arrivalAt);

        uint256 nextPlanetIdBeforeResolve = game.nextPlanetId();
        vm.warp(arrivalAt);
        vm.prank(player);
        game.resolveFleetMission(missionId);

        (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(missionId);
        assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertEq(game.technologyLevel(player, Technology.Astrophysics), 2);
        assertEq(game.planetCountOf(player), 3);
        assertEq(game.planet(nextPlanetIdBeforeResolve).owner, player);
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

    function _assertShieldDomeRepairRollCoversBothOutcomes(Defense dome) internal {
        bool observedRebuild;
        bool observedNoRebuild;
        uint32 maxCount = VeydriftCatalog.maxDefensePerPlanet(dome);

        for (
            uint256 randomWord = 1; randomWord <= 128 && (!observedRebuild || !observedNoRebuild);) {
            uint256 snapshot = vm.snapshotState();
            uint32 finalCount = _resolveDeathstarDomeFixture(dome, randomWord);
            assertLe(finalCount, maxCount);
            if (finalCount == 0) {
                observedNoRebuild = true;
            } else if (finalCount == 1) {
                observedRebuild = true;
            } else {
                fail();
            }
            assertTrue(vm.revertToState(snapshot));
            unchecked {
                ++randomWord;
            }
        }

        assertTrue(observedRebuild);
        assertTrue(observedNoRebuild);
    }

    function _resolveDeathstarDomeFixture(Defense dome, uint256 randomWord)
        internal
        returns (uint32)
    {
        (uint256 originPlanetId, uint256 targetPlanetId,) = _seedAttackPlanets();
        _setShipCount(originPlanetId, Ship.Deathstar, 1);
        _setDefenseCount(targetPlanetId, dome, 1);
        _setResources(originPlanetId, 10_000_000, 10_000_000, 10_000_000);
        _setResources(targetPlanetId, 10_000_000, 10_000_000, 10_000_000);

        VeydriftGameStorage.MissionShips memory ships;
        ships.deathstar = 1;

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
        _fulfillAttackBattleRandomness(missionId, randomWord);
        game.resolveFleetMission(missionId);

        return game.defenseCount(targetPlanetId, dome);
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

    function _joinAlliance(address leader, address member) internal returns (uint256 allianceId) {
        allianceId = _createAlliance(leader);
        vm.prank(leader);
        allianceSystem.inviteMember(allianceId, member);
        vm.prank(member);
        allianceSystem.acceptInvite(allianceId);
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

    function _setResearchQueue(
        address account,
        Technology technology,
        uint16 targetLevel,
        uint64 readyAt
    ) internal {
        bytes32 slot = keccak256(abi.encode(account, uint256(10)));
        uint256 packed = uint256(1) | (uint256(uint8(technology)) << 8)
            | (uint256(targetLevel) << 16) | (uint256(readyAt) << 32);
        vm.store(address(game), slot, bytes32(packed));
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

    function _setPlanetLastSettledAt(uint256 planetId, uint64 lastSettledAt) internal {
        VeydriftGameStorage.Planet memory planetRef = game.planet(planetId);
        uint256 planetBase = uint256(keccak256(abi.encode(planetId, uint256(4))));
        uint256 slot1 = uint256(planetRef.crystalMultiplierBps)
            | (uint256(planetRef.deuteriumMultiplierBps) << 16) | (uint256(lastSettledAt) << 32);
        vm.store(address(game), bytes32(planetBase + 1), bytes32(slot1));
    }

    function _setBuildingConstruction(
        uint256 planetId,
        Building building,
        uint16 targetLevel,
        uint64 readyAt
    ) internal {
        bytes32 slot = keccak256(abi.encode(planetId, uint256(7)));
        uint256 packed = uint256(1) | (uint256(uint8(building)) << 8) | (uint256(targetLevel) << 16)
            | (uint256(readyAt) << 32);
        vm.store(address(game), slot, bytes32(packed));
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

    function _populatedColonyPosition(uint16 galaxy, uint16 system, uint8 avoidPosition)
        internal
        view
        returns (uint8)
    {
        for (uint8 position = 1; position <= TEST_MAX_POSITION;) {
            if (
                position != avoidPosition && _isPopulatedColonySlot(galaxy, system, position)
                    && !game.occupiedCoordinates(game.coordinateKey(galaxy, system, position))
            ) {
                return position;
            }
            unchecked {
                ++position;
            }
        }
        revert("populated colony position exhausted");
    }

    function _unpopulatedColonyPosition(uint16 galaxy, uint16 system, uint8 avoidPosition)
        internal
        view
        returns (uint8)
    {
        for (uint8 position = 1; position <= TEST_MAX_POSITION;) {
            if (
                position != avoidPosition && !_isPopulatedColonySlot(galaxy, system, position)
                    && !game.occupiedCoordinates(game.coordinateKey(galaxy, system, position))
            ) {
                return position;
            }
            unchecked {
                ++position;
            }
        }
        revert("unpopulated colony position exhausted");
    }

    function _isPopulatedColonySlot(uint16 galaxy, uint16 system, uint8 position)
        internal
        view
        returns (bool)
    {
        return VeydriftPlanetGeneration.isPopulatedPlanetSlot(
            block.chainid,
            address(game),
            galaxy,
            system,
            position,
            TEST_MAX_GALAXY,
            TEST_MAX_SYSTEM,
            TEST_MAX_POSITION
        );
    }

    function _nextColonyCoordinates(address account, uint256 salt)
        internal
        view
        returns (uint16 galaxy, uint16 system, uint8 position)
    {
        for (uint256 attempt = 0; attempt < 64; attempt++) {
            bytes32 seed = keccak256(
                abi.encode(
                    TEST_PLANET_SEED_DOMAIN,
                    block.chainid,
                    account,
                    salt,
                    game.planetCountOf(account),
                    attempt
                )
            );
            galaxy = uint16((uint256(seed) % TEST_MAX_GALAXY) + 1);
            system = uint16(((uint256(seed) >> 16) % TEST_MAX_SYSTEM) + 1);
            position = uint8(((uint256(seed) >> 32) % TEST_MAX_POSITION) + 1);
            if (
                _isPopulatedColonySlot(galaxy, system, position)
                    && !game.occupiedCoordinates(game.coordinateKey(galaxy, system, position))
            ) {
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

    function _attackBattleOutcomeFromRecordedLogs(uint256 missionId)
        internal
        view
        returns (VeydriftGameStorage.BattleOutcome outcome, uint8 rounds)
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
                (outcome, rounds,,,,) = abi.decode(
                    entries[i].data,
                    (VeydriftGameStorage.BattleOutcome, uint8, uint256, uint128, uint128, uint128)
                );
                return (outcome, rounds);
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

    function _expectedOgameFuelCost(
        VeydriftGameStorage.MissionShips memory ships,
        uint256 distance,
        uint16 speedPercent,
        uint256 slowestSpeed
    ) internal pure returns (uint256) {
        uint256 numerator;
        bool hasFuel;
        for (uint8 i = 0; i <= uint8(Ship.Pathfinder);) {
            Ship ship = Ship(i);
            uint32 quantity = _missionShipQuantity(ships, ship);
            if (quantity != 0) {
                (, uint256 fuel, uint256 speed) = VeydriftCatalog.shipMovementStats(ship, 0, 0, 0);
                if (fuel != 0) {
                    hasFuel = true;
                    numerator += VeydriftAntiRaidPrimitives.ogameFuelNumerator(
                        fuel, quantity, distance, speed, slowestSpeed, speedPercent
                    );
                }
            }
            unchecked {
                ++i;
            }
        }
        return VeydriftAntiRaidPrimitives.ogameFuelCostFromNumerator(numerator, hasFuel);
    }

    function _missionShipQuantity(VeydriftGameStorage.MissionShips memory ships, Ship ship)
        internal
        pure
        returns (uint32)
    {
        if (ship == Ship.SmallCargo) return ships.smallCargo;
        if (ship == Ship.LightFighter) return ships.lightFighter;
        if (ship == Ship.Recycler) return ships.recycler;
        if (ship == Ship.ColonyShip) return ships.colonyShip;
        if (ship == Ship.LargeCargo) return ships.largeCargo;
        if (ship == Ship.HeavyFighter) return ships.heavyFighter;
        if (ship == Ship.Cruiser) return ships.cruiser;
        if (ship == Ship.Battleship) return ships.battleship;
        if (ship == Ship.Bomber) return ships.bomber;
        if (ship == Ship.Destroyer) return ships.destroyer;
        if (ship == Ship.Deathstar) return ships.deathstar;
        if (ship == Ship.Battlecruiser) return ships.battlecruiser;
        if (ship == Ship.Reaper) return ships.reaper;
        if (ship == Ship.Pathfinder) return ships.pathfinder;
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

        uint256 maxPosition = TEST_MAX_POSITION;
        for (uint256 offset = 1; offset < maxPosition; offset++) {
            uint8 candidatePosition =
                uint8(((uint256(origin.position) + salt + offset - 1) % maxPosition) + 1);
            if (
                candidatePosition != origin.position
                    && _isPopulatedColonySlot(galaxy, system, candidatePosition)
                    && !game.occupiedCoordinates(
                        game.coordinateKey(galaxy, system, candidatePosition)
                    )
            ) {
                return (galaxy, system, candidatePosition);
            }
        }

        uint256 maxSystem = TEST_MAX_SYSTEM;
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

    function _referralSignature(address invitee, bytes32 commitment)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 payloadHash = keccak256(
            abi.encode(
                referralSystem.REFERRAL_REDEEM_DOMAIN(),
                block.chainid,
                address(game),
                invitee,
                commitment
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash));
        (v, r, s) = vm.sign(referralSignerKey, digest);
        assertEq(ecrecover(digest, v, r, s), vm.addr(referralSignerKey));
    }

    function _startPlanetWithReferral(address invitee, bytes32 commitment) internal {
        (uint8 v, bytes32 r, bytes32 s) = _referralSignature(invitee, commitment);
        vm.prank(invitee);
        game.startPlanetWithReferral{value: 0.05 ether}(commitment, v, r, s);
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
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();
        VeydriftStateMigrationModule stateMigrationModule = new VeydriftStateMigrationModule();
        VeydriftReferralSystem deployedReferralSystem = new VeydriftReferralSystem(owner);
        VeydriftFirstPlanetSettlementModule firstPlanetSettlementModule =
            new VeydriftFirstPlanetSettlementModule(address(deployedReferralSystem));
        VeydriftGame deployedGame = new VeydriftGame(
            owner,
            address(firstPlanetSettlementModule),
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule),
            address(defenseHoldModule),
            address(stateMigrationModule)
        );
        vm.prank(owner);
        deployedReferralSystem.setGame(address(deployedGame));
        referralSystem = deployedReferralSystem;
        return deployedGame;
    }

    function _newMigrationSettlement(address owner) internal returns (VeydriftMigrationSettlement) {
        VeydriftMigrationSettlement implementation = new VeydriftMigrationSettlement();
        return VeydriftMigrationSettlement(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(VeydriftMigrationSettlement.initialize, (owner, address(game)))
                )
            )
        );
    }

    function _signedMigrationPayload(
        VeydriftMigrationSettlement migration,
        uint256 signerKey,
        address migratedPlayer,
        uint256 planetId
    ) internal view returns (bytes memory payload, bytes memory signature) {
        uint16[16] memory buildings;
        buildings[uint8(Building.MetalMine)] = 17;
        uint32[16] memory ships;
        ships[uint8(Ship.SmallCargo)] = 123;
        uint32[10] memory defenses;
        defenses[uint8(Defense.RocketLauncher)] = 456;
        uint16[15] memory technologies;
        technologies[uint8(Technology.Computer)] = 8;
        uint16[4] memory moonBuildings;
        moonBuildings[uint8(MoonBuilding.JumpGate)] = 1;
        uint32[16] memory moonShips;
        moonShips[uint8(Ship.Recycler)] = 12;
        uint32[10] memory moonDefenses;
        moonDefenses[uint8(Defense.SmallShieldDome)] = 1;

        VeydriftGameStorage.ShipQueue memory shipQueue = VeydriftGameStorage.ShipQueue({
            active: true,
            ship: Ship.LightFighter,
            quantity: 7,
            readyAt: uint64(block.timestamp + 1 hours),
            cost: VeydriftGameStorage.Resources({metal: 21_000, crystal: 7_000, deuterium: 0})
        });

        VeydriftStateMigrationModule.MigrationPlanetState[] memory planets =
            new VeydriftStateMigrationModule.MigrationPlanetState[](1);
        planets[0] = VeydriftStateMigrationModule.MigrationPlanetState({
            planetId: planetId,
            galaxy: 2,
            system: 99,
            position: 7,
            fields: 211,
            temperature: -14,
            lastSettledAt: uint64(block.timestamp),
            name: "Migrated Home",
            resources: VeydriftGameStorage.Resources({
                metal: 12_345, crystal: 6_789, deuterium: 555
            }),
            buildingLevels: buildings,
            shipCounts: ships,
            defenseCounts: defenses,
            buildingQueue: VeydriftGameStorage.BuildingConstruction({
                active: false,
                building: Building.MetalMine,
                targetLevel: 0,
                readyAt: 0,
                cost: VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
            }),
            defenseQueue: VeydriftGameStorage.DefenseQueue({
                active: false,
                defense: Defense.RocketLauncher,
                quantity: 0,
                readyAt: 0,
                cost: VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
            }),
            shipQueue: shipQueue,
            defenseBacklog: new VeydriftGameStorage.DefenseQueue[](0),
            shipBacklog: new VeydriftGameStorage.ShipQueue[](0),
            hasMoon: true,
            moon: VeydriftStateMigrationModule.MigrationMoonState({
                fields: 9,
                diameterKm: 8_888,
                createdAt: uint64(block.timestamp),
                jumpGateReadyAt: uint64(block.timestamp + 2 days),
                resources: VeydriftGameStorage.Resources({
                    metal: 100, crystal: 200, deuterium: 300
                }),
                buildingLevels: moonBuildings,
                shipCounts: moonShips,
                defenseCounts: moonDefenses,
                buildingQueue: VeydriftStateMigrationModule.MigrationMoonBuildingConstruction({
                        active: false,
                        building: MoonBuilding.LunarBase,
                        targetLevel: 0,
                        readyAt: 0,
                        cost: VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
                    }),
                defenseQueue: VeydriftStateMigrationModule.MigrationMoonDefenseQueue({
                    active: false,
                    defense: Defense.RocketLauncher,
                    quantity: 0,
                    readyAt: 0,
                    cost: VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
                })
            })
        });

        VeydriftStateMigrationModule.MigrationPlayerState memory state =
            VeydriftStateMigrationModule.MigrationPlayerState({
                player: migratedPlayer,
                homePlanetId: planetId,
                technologyLevels: technologies,
                researchQueue: VeydriftGameStorage.ResearchQueue({
                    active: false,
                    technology: Technology.Computer,
                    targetLevel: 0,
                    readyAt: 0,
                    cost: VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0})
                }),
                planets: planets
            });
        payload = abi.encode(state);
        bytes32 digest = migration.migrationStateHash(migratedPlayer, payload);
        bytes32 signedDigest =
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, signedDigest);
        signature = abi.encodePacked(r, s, v);
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
