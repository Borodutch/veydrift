// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftCombatModule} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {Defense, Ship, Technology} from "../src/libraries/VeydriftTypes.sol";
import {VeydriftCombatReferenceSimulator} from "./support/VeydriftCombatReferenceSimulator.sol";

contract CombatReferenceResourceToken {
    mapping(address account => uint256 balanceOf) public balanceOf;
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
        if (approved < amount || balanceOf[from] < amount) return false;

        allowance[from][msg.sender] = approved - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract VeydriftCombatReferenceParityTest is Test {
    uint256 private constant RESERVE_FUNDING = 1_000_000_000_000;
    bytes32 private constant ATTACK_BATTLE_RESOLVED_TOPIC = keccak256(
        "AttackBattleResolved(uint256,address,uint256,uint8,uint8,uint256,uint128,uint128,uint128)"
    );
    bytes32 private constant COMBAT_LOSSES_TOPIC =
        keccak256("CombatLosses(uint256,uint128,uint128,uint128,uint128,uint128,uint128)");
    bytes32 private constant COMBAT_DEBRIS_SIGNALED_TOPIC =
        keccak256("CombatDebrisSignaled(uint256,uint256,uint128,uint128)");

    address private admin = address(0xA11CE);
    address private player = address(0xB0B);
    address private defender = address(0xDEF);
    address private fulfiller = address(0xF111);
    VeydriftGame private game;
    RandomnessEngine private randomness;
    CombatReferenceResourceToken private metalToken;
    CombatReferenceResourceToken private crystalToken;
    CombatReferenceResourceToken private deuteriumToken;

    struct ActualBattle {
        VeydriftGameStorage.BattleOutcome outcome;
        uint8 rounds;
        uint256 seed;
        VeydriftGameStorage.Resources attackerLosses;
        VeydriftGameStorage.Resources defenderLosses;
        VeydriftGameStorage.Resources debris;
        bool battleFound;
        bool lossesFound;
        bool debrisFound;
    }

    function setUp() public {
        game = _newGame(admin);
        VeydriftAllianceSystem allianceSystem =
            new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)));
        randomness = new RandomnessEngine(admin, fulfiller);
        VeydriftMoonSystem moons = new VeydriftMoonSystem(address(game), address(randomness));
        metalToken = new CombatReferenceResourceToken();
        crystalToken = new CombatReferenceResourceToken();
        deuteriumToken = new CombatReferenceResourceToken();

        vm.prank(admin);
        randomness.setPrecommitRequired(false);
        metalToken.mint(address(game), RESERVE_FUNDING);
        crystalToken.mint(address(game), RESERVE_FUNDING);
        deuteriumToken.mint(address(game), RESERVE_FUNDING);
        vm.prank(admin);
        game.setResourceTokens(address(metalToken), address(crystalToken), address(deuteriumToken));
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
        vm.deal(defender, 1 ether);
    }

    function testReferenceParityDefenderWinCargoAgainstRocketLaunchers() public {
        VeydriftCombatReferenceSimulator.BattleInput memory fixture = _emptyFixture();
        fixture.attackerShips[uint8(Ship.SmallCargo)] = 1;
        fixture.defenderDefenses[uint8(Defense.RocketLauncher)] = 10;

        _assertReferenceParity(fixture, 779);
    }

    function testReferenceParityDrawAgainstShieldDomes() public {
        VeydriftCombatReferenceSimulator.BattleInput memory fixture = _emptyFixture();
        fixture.attackerShips[uint8(Ship.SmallCargo)] = 1;
        fixture.defenderDefenses[uint8(Defense.LargeShieldDome)] = 10;

        _assertReferenceParity(fixture, 780);
    }

    function testReferenceParityRepairsDestroyedDefensesAfterAttackerWin() public {
        VeydriftCombatReferenceSimulator.BattleInput memory fixture = _emptyFixture();
        fixture.attackerShips[uint8(Ship.Battleship)] = 10;
        fixture.defenderDefenses[uint8(Defense.RocketLauncher)] = 10;

        _assertReferenceParity(fixture, 782);
    }

    function testReferenceParityUsesUnitWeightedTargeting() public {
        VeydriftCombatReferenceSimulator.BattleInput memory fixture = _emptyFixture();
        fixture.attackerShips[uint8(Ship.Battleship)] = 1;
        fixture.defenderDefenses[uint8(Defense.RocketLauncher)] = 200;
        fixture.defenderDefenses[uint8(Defense.LightLaser)] = 1;

        _assertReferenceParity(fixture, 2);
    }

    function testReferenceParityCoversShipDefendersAndCombatTechScaling() public {
        VeydriftCombatReferenceSimulator.BattleInput memory fixture = _emptyFixture();
        fixture.attackerShips[uint8(Ship.Destroyer)] = 40;
        fixture.defenderShips[uint8(Ship.LightFighter)] = 40;
        fixture.attackerTech =
            VeydriftCombatReferenceSimulator.CombatTech({weapons: 3, shielding: 2, armor: 4});
        fixture.defenderTech =
            VeydriftCombatReferenceSimulator.CombatTech({weapons: 1, shielding: 5, armor: 2});

        _assertReferenceParity(fixture, 5);
    }

    function testReferenceParityCoversRapidfireStreamExpansion() public {
        VeydriftCombatReferenceSimulator.BattleInput memory fixture = _emptyFixture();
        fixture.attackerShips[uint8(Ship.Cruiser)] = 1;
        fixture.defenderDefenses[uint8(Defense.RocketLauncher)] = 50;

        _assertReferenceParity(fixture, 101);
    }

    function _assertReferenceParity(
        VeydriftCombatReferenceSimulator.BattleInput memory fixture,
        uint256 randomWord
    ) private {
        (uint256 originPlanetId, uint256 targetPlanetId, uint256 missionId) =
            _launchFixtureAttack(fixture);
        ActualBattle memory actual = _resolveAndReadActualBattle(missionId, randomWord);

        fixture.seed = actual.seed;
        VeydriftCombatReferenceSimulator.BattleResult memory expected =
            VeydriftCombatReferenceSimulator.run(fixture);

        assertEq(uint8(actual.outcome), uint8(expected.outcome), "outcome");
        assertEq(actual.rounds, expected.rounds, "rounds");
        _assertResourcesEq(actual.attackerLosses, expected.attackerLosses, "attacker losses");
        _assertResourcesEq(actual.defenderLosses, expected.defenderLosses, "defender losses");
        _assertResourcesEq(actual.debris, expected.debris, "debris event");

        _finishAttackReturnIfNeeded(missionId);
        _assertPlanetShipsEq(originPlanetId, expected.attackerShips, "attacker survivors");
        _assertPlanetShipsEq(targetPlanetId, expected.defenderShips, "defender ships");
        _assertPlanetDefensesEq(targetPlanetId, expected.defenderDefenses, "defender defenses");

        (uint128 debrisMetal, uint128 debrisCrystal) = game.debrisField(targetPlanetId);
        assertEq(debrisMetal, expected.debris.metal, "stored debris metal");
        assertEq(debrisCrystal, expected.debris.crystal, "stored debris crystal");
    }

    function _launchFixtureAttack(VeydriftCombatReferenceSimulator.BattleInput memory fixture)
        private
        returns (uint256 originPlanetId, uint256 targetPlanetId, uint256 missionId)
    {
        vm.prank(player);
        originPlanetId = game.startPlanet{value: 0.05 ether}();
        vm.prank(defender);
        targetPlanetId = game.startPlanet{value: 0.05 ether}();
        _setPlanetCoordinates(originPlanetId, 1, 100, 8);
        _setPlanetCoordinates(targetPlanetId, 1, 100, 9);
        _setCombatTech(player, fixture.attackerTech);
        _setCombatTech(defender, fixture.defenderTech);
        _setResources(originPlanetId, 100_000_000, 100_000_000, 100_000_000);
        _setResources(targetPlanetId, 100_000_000, 100_000_000, 100_000_000);

        for (uint8 i = 0; i < 16;) {
            if (fixture.attackerShips[i] != 0) {
                _setShipCount(originPlanetId, Ship(i), fixture.attackerShips[i]);
            }
            if (fixture.defenderShips[i] != 0) {
                _setShipCount(targetPlanetId, Ship(i), fixture.defenderShips[i]);
            }
            unchecked {
                ++i;
            }
        }
        for (uint8 i = 0; i < 8;) {
            if (fixture.defenderDefenses[i] != 0) {
                _setDefenseCount(targetPlanetId, Defense(i), fixture.defenderDefenses[i]);
            }
            unchecked {
                ++i;
            }
        }

        vm.prank(player);
        missionId = game.launchFleetMission(
            originPlanetId,
            targetPlanetId,
            VeydriftGameStorage.FleetMissionType.Attack,
            _missionShips(fixture.attackerShips),
            VeydriftGameStorage.Resources({metal: 0, crystal: 0, deuterium: 0}),
            0
        );
    }

    function _resolveAndReadActualBattle(uint256 missionId, uint256 randomWord)
        private
        returns (ActualBattle memory actual)
    {
        (, uint64 arrivalAt,,) = _fleetMission(missionId);
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(missionId, randomWord);
        vm.recordLogs();
        game.resolveFleetMission(missionId);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        for (uint256 i = 0; i < entries.length;) {
            if (entries[i].topics.length != 0 && uint256(entries[i].topics[1]) == missionId) {
                if (entries[i].topics[0] == ATTACK_BATTLE_RESOLVED_TOPIC) {
                    (actual.outcome, actual.rounds, actual.seed,,,) = abi.decode(
                        entries[i].data,
                        (
                            VeydriftGameStorage.BattleOutcome,
                            uint8,
                            uint256,
                            uint128,
                            uint128,
                            uint128
                        )
                    );
                    actual.battleFound = true;
                } else if (entries[i].topics[0] == COMBAT_LOSSES_TOPIC) {
                    (
                        actual.attackerLosses.metal,
                        actual.attackerLosses.crystal,
                        actual.attackerLosses.deuterium,
                        actual.defenderLosses.metal,
                        actual.defenderLosses.crystal,
                        actual.defenderLosses.deuterium
                    ) =
                        abi.decode(
                            entries[i].data, (uint128, uint128, uint128, uint128, uint128, uint128)
                        );
                    actual.lossesFound = true;
                } else if (entries[i].topics[0] == COMBAT_DEBRIS_SIGNALED_TOPIC) {
                    (actual.debris.metal, actual.debris.crystal) =
                        abi.decode(entries[i].data, (uint128, uint128));
                    actual.debrisFound = true;
                }
            }
            unchecked {
                ++i;
            }
        }

        assertTrue(actual.battleFound, "battle event");
        assertTrue(actual.lossesFound, "losses event");
        assertTrue(actual.debrisFound, "debris event");
    }

    function _finishAttackReturnIfNeeded(uint256 missionId) private {
        (VeydriftGameStorage.FleetMissionStatus status,, uint64 returnAt,) =
            _fleetMission(missionId);
        if (status == VeydriftGameStorage.FleetMissionStatus.Returning) {
            vm.warp(returnAt);
            game.completeFleetMissionReturn(missionId);
        }
    }

    function _emptyFixture()
        private
        pure
        returns (VeydriftCombatReferenceSimulator.BattleInput memory fixture)
    {}

    function _missionShips(uint32[16] memory ships)
        private
        pure
        returns (VeydriftGameStorage.MissionShips memory missionShips)
    {
        missionShips.smallCargo = ships[uint8(Ship.SmallCargo)];
        missionShips.lightFighter = ships[uint8(Ship.LightFighter)];
        missionShips.recycler = ships[uint8(Ship.Recycler)];
        missionShips.colonyShip = ships[uint8(Ship.ColonyShip)];
        missionShips.largeCargo = ships[uint8(Ship.LargeCargo)];
        missionShips.heavyFighter = ships[uint8(Ship.HeavyFighter)];
        missionShips.cruiser = ships[uint8(Ship.Cruiser)];
        missionShips.battleship = ships[uint8(Ship.Battleship)];
        missionShips.bomber = ships[uint8(Ship.Bomber)];
        missionShips.destroyer = ships[uint8(Ship.Destroyer)];
        missionShips.deathstar = ships[uint8(Ship.Deathstar)];
        missionShips.battlecruiser = ships[uint8(Ship.Battlecruiser)];
        missionShips.reaper = ships[uint8(Ship.Reaper)];
        missionShips.pathfinder = ships[uint8(Ship.Pathfinder)];
    }

    function _setCombatTech(
        address account,
        VeydriftCombatReferenceSimulator.CombatTech memory tech
    ) private {
        _setTechnologyLevel(account, Technology.Weapons, tech.weapons);
        _setTechnologyLevel(account, Technology.Shielding, tech.shielding);
        _setTechnologyLevel(account, Technology.Armor, tech.armor);
    }

    function _assertPlanetShipsEq(uint256 planetId, uint32[16] memory expected, string memory label)
        private
        view
    {
        for (uint8 i = 0; i < 16;) {
            assertEq(game.shipCount(planetId, Ship(i)), expected[i], label);
            unchecked {
                ++i;
            }
        }
    }

    function _assertPlanetDefensesEq(
        uint256 planetId,
        uint32[8] memory expected,
        string memory label
    ) private view {
        for (uint8 i = 0; i < 8;) {
            assertEq(game.defenseCount(planetId, Defense(i)), expected[i], label);
            unchecked {
                ++i;
            }
        }
    }

    function _assertResourcesEq(
        VeydriftGameStorage.Resources memory actual,
        VeydriftGameStorage.Resources memory expected,
        string memory label
    ) private pure {
        assertEq(actual.metal, expected.metal, label);
        assertEq(actual.crystal, expected.crystal, label);
        assertEq(actual.deuterium, expected.deuterium, label);
    }

    function _fleetMission(uint256 missionId)
        private
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

    function _fulfillAttackBattleRandomness(uint256 missionId, uint256 randomWord) private {
        (,,,,,,,,,, uint256 requestId) = game.fleetMission(missionId);
        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, randomWord);
    }

    function _setTechnologyLevel(address account, Technology technology, uint16 level) private {
        bytes32 outerSlot = keccak256(abi.encode(account, uint256(20)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(technology)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(level)));
    }

    function _setShipCount(uint256 planetId, Ship ship, uint32 count) private {
        bytes32 outerSlot = keccak256(abi.encode(planetId, uint256(22)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(ship)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(count)));
    }

    function _setDefenseCount(uint256 planetId, Defense defense, uint32 count) private {
        bytes32 outerSlot = keccak256(abi.encode(planetId, uint256(19)));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(defense)), outerSlot));
        vm.store(address(game), slot, bytes32(uint256(count)));
    }

    function _setResources(uint256 planetId, uint128 metal, uint128 crystal, uint128 deuterium)
        private
    {
        uint256 planetBase = uint256(keccak256(abi.encode(planetId, uint256(4))));
        vm.store(address(game), bytes32(planetBase + 2), _packResourcesHead(metal, crystal));
        vm.store(address(game), bytes32(planetBase + 3), bytes32(uint256(deuterium)));
        vm.store(address(game), bytes32(uint256(14)), _packResourcesHead(metal, crystal));
        vm.store(address(game), bytes32(uint256(15)), bytes32(uint256(deuterium)));
    }

    function _setPlanetCoordinates(uint256 planetId, uint16 galaxy, uint16 system, uint8 position)
        private
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

    function _packResourcesHead(uint128 metal, uint128 crystal) private pure returns (bytes32) {
        return bytes32((uint256(crystal) << 128) | uint256(metal));
    }

    function _newGame(address owner) private returns (VeydriftGame) {
        VeydriftCombatModule combatModule = new VeydriftCombatModule();
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
}
