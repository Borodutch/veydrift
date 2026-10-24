// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Ticket #44 attack-lifecycle audit regressions: each test replays an audit exploit on a
// standalone real-module deployment and asserts it now fails.

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftAcsAttackModule} from "../src/VeydriftAcsAttackModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftStagedCombatModule} from "../src/VeydriftStagedCombatModule.sol";
import {
    VeydriftLegacyCombatModule,
    VeydriftLegacyCombatRapidfire
} from "../src/VeydriftLegacyCombatModule.sol";
import {VeydriftCombatRaidModule} from "../src/VeydriftCombatRaidModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftShipProductionModule} from "../src/VeydriftShipProductionModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftFirstPlanetSettlementModule} from "../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameStorage as S} from "../src/VeydriftGameStorage.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {VeydriftAllianceSystem, IVeydriftAllianceGame} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftPlanetGeneration} from "../src/libraries/VeydriftPlanetGeneration.sol";
import {VeydriftRefereeBattle as P} from "../src/libraries/VeydriftRefereeBattle.sol";
import {IRefereeGame} from "./support/IRefereeGame.sol";
import {Ship, Technology} from "../src/libraries/VeydriftTypes.sol";

contract AuditToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        balanceOf[f] -= a;
        balanceOf[t] += a;
        return true;
    }

    function transfer(address t, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[t] += a;
        return true;
    }
}

contract AttackLifecycleAuditRegressionsTest is Test {
    event CombatProtectionSnapshot(
        uint256 indexed battleId,
        uint256 attackerScore,
        uint256 defenderScore,
        bool blocked,
        uint16 plunderBps
    );

    address internal admin = address(0xA11CE);
    address internal attacker = address(0xB0B);
    address internal defender = address(0xDEF);
    address internal stranger = address(0x5A5A);
    address internal fulfiller = address(0xF111);
    VeydriftGame internal game;
    RandomnessEngine internal randomness;
    VeydriftAllianceSystem internal alliance;

    function setUp() public {
        randomness = new RandomnessEngine(admin, fulfiller);
        vm.prank(admin);
        randomness.setPrecommitRequired(false);
        VeydriftCombatModule combat = new VeydriftCombatModule(
            address(new VeydriftCombatRapidfire()),
            address(new VeydriftStagedCombatModule(address(new VeydriftCombatRapidfire()))),
            address(new VeydriftLegacyCombatModule(address(new VeydriftLegacyCombatRapidfire())))
        );
        VeydriftColonizationModule colonization =
            new VeydriftColonizationModule(address(new VeydriftShipProductionModule()));
        game = VeydriftGame(
            payable(deployCode(
                    "VeydriftGame.sol:VeydriftGame:0.8.28:default",
                    abi.encode(
                        admin,
                        address(
                            new VeydriftFirstPlanetSettlementModule(
                                address(0xBEEF), address(colonization)
                            )
                        ),
                        address(new VeydriftGameplayModule(address(combat))),
                        address(new VeydriftPlanetManagementModule()),
                        address(new VeydriftAttackProtectionModule()),
                        address(colonization),
                        address(new VeydriftDefenseHoldModule()),
                        address(
                            new VeydriftStateMigrationModule(
                                address(0xBEEF), address(new VeydriftCombatRaidModule())
                            )
                        ),
                        address(new VeydriftAcsAttackModule())
                    )
                ))
        );
        AuditToken m = new AuditToken();
        AuditToken c = new AuditToken();
        AuditToken d = new AuditToken();
        m.mint(address(game), 1e15);
        c.mint(address(game), 1e15);
        d.mint(address(game), 1e15);
        vm.startPrank(admin);
        game.setResourceTokens(address(m), address(c), address(d));
        game.setRandomnessEngine(address(randomness));
        randomness.setRequesterAuthorization(address(game), true);
        alliance = new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)));
        game.setAllianceSystem(address(alliance));
        vm.stopPrank();
        vm.warp(1_800_000_000);
    }

    // -------------------------------------------------------------------------- helpers

    function _start(address who, uint16 g, uint16 s, uint8 p) internal returns (uint256 id) {
        vm.deal(who, 1 ether);
        vm.prank(who);
        id = game.startPlanet{value: 0.05 ether}();
        S.Planet memory pl = game.planet(id);
        uint256 base = uint256(keccak256(abi.encode(id, uint256(4))));
        vm.store(
            address(game),
            bytes32(base),
            bytes32(
                uint256(uint160(pl.owner)) | (uint256(g) << 160) | (uint256(s) << 176)
                    | (uint256(p) << 192) | (uint256(pl.fields) << 200)
                    | (uint256(uint16(pl.temperature)) << 216)
                    | (uint256(pl.metalMultiplierBps) << 232)
            )
        );
        // Neutral tech that lifts both sides above newbie/score protection.
        _tech(who, Technology.IntergalacticResearchNetwork, 3_000);
        _tech(who, Technology.Computer, 20);
    }

    function _tech(address who, Technology t, uint16 level) internal {
        bytes32 outer = keccak256(abi.encode(who, uint256(20)));
        vm.store(
            address(game), keccak256(abi.encode(uint256(uint8(t)), outer)), bytes32(uint256(level))
        );
    }

    function _ships(uint256 planetId, Ship ship, uint32 n) internal {
        bytes32 outer = keccak256(abi.encode(planetId, uint256(22)));
        vm.store(
            address(game), keccak256(abi.encode(uint256(uint8(ship)), outer)), bytes32(uint256(n))
        );
    }

    /// Sets a planet balance and keeps `_totalInternalResources` consistent.
    function _res(uint256 planetId, uint128 m, uint128 c, uint128 d) internal {
        S.Resources memory old = game.planet(planetId).resources;
        S.Resources memory tot = game.totalInternalResources();
        tot.metal = tot.metal - old.metal + m;
        tot.crystal = tot.crystal - old.crystal + c;
        tot.deuterium = tot.deuterium - old.deuterium + d;
        uint256 base = uint256(keccak256(abi.encode(planetId, uint256(4))));
        vm.store(address(game), bytes32(base + 2), bytes32(uint256(m) | (uint256(c) << 128)));
        vm.store(address(game), bytes32(base + 3), bytes32(uint256(d)));
        vm.store(
            address(game),
            bytes32(uint256(14)),
            bytes32(uint256(tot.metal) | (uint256(tot.crystal) << 128))
        );
        vm.store(address(game), bytes32(uint256(15)), bytes32(uint256(tot.deuterium)));
    }

    function _fleet(Ship ship, uint32 n) internal pure returns (S.MissionShips memory f) {
        if (ship == Ship.LightFighter) f.lightFighter = n;
        else if (ship == Ship.SmallCargo) f.smallCargo = n;
        else if (ship == Ship.LargeCargo) f.largeCargo = n;
        else if (ship == Ship.Battleship) f.battleship = n;
        else if (ship == Ship.Cruiser) f.cruiser = n;
        else revert("ship");
    }

    function _none() internal pure returns (S.Resources memory) {}

    function _attack(address who, uint256 from, uint256 to, S.MissionShips memory f)
        internal
        returns (uint256 id)
    {
        vm.prank(who);
        id = game.launchFleetMission(from, to, S.FleetMissionType.Attack, f, _none(), 0);
    }

    function _mission(uint256 id)
        internal
        view
        returns (S.FleetMissionStatus status, uint64 arrivalAt, uint64 returnAt, uint256 requestId)
    {
        (status,,,,,, arrivalAt, returnAt,,, requestId) = game.fleetMission(id);
    }

    function _cargo(uint256 id) internal view returns (uint256) {
        (,,,,,,,,, S.Resources memory c,) = game.fleetMission(id);
        return uint256(c.metal) + c.crystal + c.deuterium;
    }

    function _fulfill(uint256 id, uint256 word) internal {
        (,,, uint256 requestId) = _mission(id);
        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, word);
    }

    function _resolve(uint256 id) internal {
        for (uint256 i; i < 400; ++i) {
            (S.FleetMissionStatus st,,,) = _mission(id);
            if (st != S.FleetMissionStatus.Outbound) return;
            game.resolveFleetMission{gas: 15_000_000}(id);
        }
        revert("unresolved");
    }

    function _ally(address leader, address member) internal {
        vm.prank(leader);
        uint256 id = alliance.createAlliance("ATK", "Attackers", "ipfs://attackers");
        vm.prank(leader);
        alliance.inviteMember(id, member);
        vm.prank(member);
        alliance.acceptInvite(id);
    }

    function _blocked(Vm.Log[] memory logs) internal pure returns (bool blocked) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == CombatProtectionSnapshot.selector) {
                (,, blocked,) = abi.decode(logs[i].data, (uint256, uint256, bool, uint16));
            }
        }
    }

    /// Real colonization flow: returns a non-home colony owned by `who`.
    function _colonize(address who, uint256 home) internal returns (uint256 colony) {
        _tech(who, Technology.Astrophysics, 1);
        _ships(home, Ship.ColonyShip, 1);
        S.Planet memory h = game.planet(home);
        uint8 pos;
        for (uint8 p = 1; p <= 15; ++p) {
            if (
                p != 8 && p != 9 && p != 10
                    && VeydriftPlanetGeneration.isPopulatedPlanetSlot(
                        block.chainid, address(game), h.galaxy, h.system, p, 9, 499, 15
                    ) && !game.occupiedCoordinates(game.coordinateKey(h.galaxy, h.system, p))
            ) {
                pos = p;
                break;
            }
        }
        require(pos != 0, "no slot");
        colony = game.nextPlanetId();
        S.MissionShips memory ship;
        ship.colonyShip = 1;
        vm.prank(who);
        uint256 id = game.launchFleetMission(
            home,
            (uint256(1) << 255) | (uint256(h.galaxy) << 24) | (uint256(h.system) << 8) | pos,
            S.FleetMissionType.Colonize,
            ship,
            _none(),
            0
        );
        (, uint64 arrivalAt,,) = _mission(id);
        vm.warp(arrivalAt);
        game.resolveFleetMission(id);
        assertEq(game.planet(colony).owner, who, "colony created");
    }

    // ------------------------- finding 1 (F1): counterplay recall cannot open an abandon trap

    function testCounterplayRecallCannotUnlockAbandonOfTheTarget() public {
        uint256 attackerHome = _start(attacker, 1, 100, 8);
        uint256 defenderHome = _start(defender, 1, 101, 9);
        _res(attackerHome, 1e9, 1e9, 1e9);
        _res(defenderHome, 1e9, 1e9, 1e9);
        uint256 colony = _colonize(defender, defenderHome);

        _ships(attackerHome, Ship.Battleship, 51);
        uint256 atk = _attack(attacker, attackerHome, colony, _fleet(Ship.Battleship, 50));
        (, uint64 impact,,) = _mission(atk);
        vm.warp(block.timestamp + 1);
        uint256 other = _attack(attacker, attackerHome, defenderHome, _fleet(Ship.Battleship, 1));
        _res(colony, 0, 0, 0);

        _ships(defenderHome, Ship.LightFighter, 1);
        vm.prank(defender);
        uint256 cp = game.launchFleetMission(
            defenderHome,
            atk,
            S.FleetMissionType.AcsDefend,
            _fleet(Ship.LightFighter, 1),
            _none(),
            0
        );
        vm.prank(defender);
        game.recallFleetMission(cp);
        (,, uint64 cpBack,) = _mission(cp);
        vm.warp(cpBack);
        game.completeFleetMissionReturn(cp);

        // After the attacker's recall cutoff the target can still not disappear.
        vm.warp(impact - 59);
        vm.prank(defender);
        vm.expectRevert(S.PlanetHasActiveFleetMissions.selector);
        game.abandonPlanet(colony);

        vm.warp(impact);
        _fulfill(atk, 7);
        _resolve(atk);
        (, uint64 otherImpact,,) = _mission(other);
        if (otherImpact > vm.getBlockTimestamp()) vm.warp(otherImpact);
        _fulfill(other, 8);
        _resolve(other);
        (,, uint64 atkBack,) = _mission(atk);
        (,, uint64 otherBack,) = _mission(other);
        vm.warp(atkBack > otherBack ? atkBack : otherBack);
        game.completeFleetMissionReturn(atk);
        game.completeFleetMissionReturn(other);
        (S.FleetMissionStatus st,,,) = _mission(atk);
        assertEq(uint8(st), uint8(S.FleetMissionStatus.Returned), "attacker not stranded");
        (st,,,) = _mission(other);
        assertEq(uint8(st), uint8(S.FleetMissionStatus.Returned), "unrelated raid lands home");
    }

    // ----------------------- finding 10 (F2): the referee seed stays sealed while recall is open

    function testRefereeBattleOffersNoFreeLookBeforeTheRosterSeal() public {
        uint256 attackerHome = _start(attacker, 1, 100, 8);
        uint256 defenderHome = _start(defender, 1, 101, 9);
        _res(attackerHome, 1e9, 1e9, 1e9);
        _res(defenderHome, 1e6, 1e6, 1e6);
        _ships(attackerHome, Ship.Cruiser, 30);
        _ships(defenderHome, Ship.LightFighter, 540);
        vm.prank(admin);
        IRefereeGame(address(game))
            .configureBattleReferee(
                P.Version(3, keccak256("rules"), keccak256("catalog")), address(0xBA771E)
            );
        bytes32 commitment = randomness.randomnessCommitment(5);
        vm.prank(fulfiller);
        randomness.commitRandomness(commitment);
        vm.roll(block.number + 1);

        uint256 atk = _attack(attacker, attackerHome, defenderHome, _fleet(Ship.Cruiser, 30));
        (, uint64 impact,, uint256 requestId) = _mission(atk);
        // No randomness is bound while the fleet flies: there is nothing the fulfiller may reveal
        // and nothing the attacker could replay before deciding whether to recall.
        assertEq(requestId, 0);
        assertEq(randomness.nextRequestId(), 1);
        vm.prank(fulfiller);
        vm.expectRevert(abi.encodeWithSelector(RandomnessEngine.UnknownRequest.selector, 1));
        randomness.fulfillRandomness(1, 5);
        vm.warp(impact - 61);
        vm.prank(attacker);
        game.recallFleetMission(atk);
        (,, uint64 back,) = _mission(atk);
        vm.warp(back);
        game.completeFleetMissionReturn(atk);
        assertEq(randomness.readyCommitmentCount(), 1, "a recall reserves no word");

        // A battle that is fought binds the word only after arrival, and reveals it after the seal.
        atk = _attack(attacker, attackerHome, defenderHome, _fleet(Ship.Cruiser, 30));
        (, impact,,) = _mission(atk);
        vm.warp(impact);
        for (uint256 i; i < 100; ++i) {
            (uint8 phase,,) = game.stagedBattleProgress(atk);
            if (phase == 16) break;
            game.resolveFleetMission{gas: 15_000_000}(atk);
        }
        (,,, requestId) = _mission(atk);
        (bool gated, bytes32 sealedSnapshot) = randomness.battleRequestPolicy(requestId);
        assertTrue(gated);
        assertTrue(sealedSnapshot != bytes32(0), "revealable only once the roster is sealed");
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(S.FleetMissionNotResolved.selector, impact));
        game.recallFleetMission(atk);
        _fulfill(atk, 5);
    }

    // ---------------------------------------- finding 7 (F3): ACS joins need the owner's consent

    function testStrangerCannotJoinAnAttack() public {
        uint256 attackerHome = _start(attacker, 1, 100, 8);
        uint256 defenderHome = _start(defender, 1, 101, 9);
        uint256 strangerHome = _start(stranger, 1, 101, 10);
        _res(attackerHome, 1e9, 1e9, 1e9);
        _res(strangerHome, 1e9, 1e9, 1e9);
        _res(defenderHome, 1e6, 1e6, 1e6);
        _ships(attackerHome, Ship.Battleship, 50);
        _ships(strangerHome, Ship.LargeCargo, 200);

        uint256 atk = _attack(attacker, attackerHome, defenderHome, _fleet(Ship.Battleship, 50));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(S.AttackJoinNotAuthorized.selector, atk));
        game.joinAttackMission(
            strangerHome, atk, defenderHome, _fleet(Ship.LargeCargo, 200), _none()
        );

        // An alliance member of the attack's owner is still welcome.
        _ally(attacker, stranger);
        vm.prank(stranger);
        uint256 joined = game.joinAttackMission(
            strangerHome, atk, defenderHome, _fleet(Ship.LargeCargo, 200), _none()
        );
        (S.FleetMissionStatus status,,,) = _mission(joined);
        assertEq(uint8(status), uint8(S.FleetMissionStatus.Outbound));
    }

    function testAlliedJoinsCountTowardTheBashingLimit() public {
        uint256 attackerHome = _start(attacker, 1, 100, 8);
        uint256 defenderHome = _start(defender, 1, 101, 9);
        uint256 strangerHome = _start(stranger, 1, 101, 10);
        _res(attackerHome, 1e9, 1e9, 1e9);
        _res(strangerHome, 1e9, 1e9, 1e9);
        _ships(attackerHome, Ship.SmallCargo, 100);
        _ships(strangerHome, Ship.Battleship, 1_000);
        _ally(attacker, stranger);

        for (uint256 i; i < 6; ++i) {
            uint256 atk = _attack(attacker, attackerHome, defenderHome, _fleet(Ship.SmallCargo, 1));
            vm.prank(stranger);
            game.joinAttackMission(
                strangerHome, atk, defenderHome, _fleet(Ship.Battleship, 100), _none()
            );
        }
        // Six joined attacks in the window: the ally has no allowance left either.
        vm.prank(stranger);
        vm.expectRevert(S.AttackBashingLimitReached.selector);
        game.launchFleetMission(
            strangerHome,
            defenderHome,
            S.FleetMissionType.Attack,
            _fleet(Ship.Battleship, 50),
            _none(),
            0
        );
    }

    // ------------------------ finding 8 (F4): protection is the launch verdict, not re-scored

    function testInFlightFleetSaveCannotFlipProtection() public {
        uint256 attackerHome = _start(attacker, 1, 100, 8);
        uint256 defenderHome = _start(defender, 1, 101, 9);
        _tech(defender, Technology.IntergalacticResearchNetwork, 0); // score = mostly ships
        _res(attackerHome, 1e9, 1e9, 1e9);
        _res(defenderHome, 1e9, 1e9, 1e9);
        uint256 colony = _colonize(defender, defenderHome);
        _ships(attackerHome, Ship.Battleship, 500);
        _ships(defenderHome, Ship.Battleship, 20_000);
        (S.AttackBlockReason reason,,) = game.attackProtectionStatus(attacker, defenderHome);
        assertEq(uint8(reason), uint8(S.AttackBlockReason.None), "legal attack at launch");
        uint256 atk = _attack(attacker, attackerHome, defenderHome, _fleet(Ship.Battleship, 500));
        (, uint64 impact,,) = _mission(atk);
        _fulfill(atk, 5);
        vm.warp(impact - 11);

        // The whole defending fleet leaves as a DefenseHold, collapsing the live score...
        vm.prank(defender);
        game.launchDefenseHold(
            defenderHome, colony, _fleet(Ship.Battleship, 20_000), _none(), 100, 1 hours
        );
        (reason,,) = game.attackProtectionStatus(attacker, defenderHome);
        assertEq(uint8(reason), uint8(S.AttackBlockReason.ScoreProtection));
        // ...but the battle keeps the launch verdict and raids normally.
        vm.warp(impact);
        vm.recordLogs();
        _resolve(atk);
        assertFalse(_blocked(vm.getRecordedLogs()), "post-cutoff action cannot flip protection");
        assertGt(_cargo(atk), 0);
    }
}
