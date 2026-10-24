// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {VeydriftMoonSystemTestBase} from "./VeydriftMoonSystem.t.sol";
import {IVeydriftAllianceGame, VeydriftAllianceSystem} from "../src/VeydriftAllianceSystem.sol";
import {VeydriftGameStorage as G} from "../src/VeydriftGameStorage.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";
import {VeydriftMoonDefenseBacklog} from "../src/libraries/VeydriftMoonDefenseBacklog.sol";
import {VeydriftPlanetGeneration} from "../src/libraries/VeydriftPlanetGeneration.sol";
import {VeydriftRefereeBattle as P} from "../src/libraries/VeydriftRefereeBattle.sol";
import {VeydriftRefereeSettlement as S} from "../src/libraries/VeydriftRefereeSettlement.sol";
import {
    VeydriftRefereeSettlementModule as Application
} from "../src/VeydriftRefereeSettlementModule.sol";
import {IRefereeGame, refereeRounds} from "./support/IRefereeGame.sol";
import {Defense, MoonBuilding, Ship, Technology} from "../src/libraries/VeydriftTypes.sol";

/// Ticket #44 audit regressions on the real Game, Moon and RandomnessEngine wiring. Each test
/// replays an audit exploit (finding numbers from the audit fix list) and asserts it now fails.
contract BattleAuditRegressionsTest is VeydriftMoonSystemTestBase {
    address constant DEFENDER = address(0xDEF);
    address constant RESOLVER = address(0xBA771E);
    address constant GRIEFER = address(0x6A1F);
    address constant BYSTANDER = address(0xB157);
    uint32 constant MOON_FLEET = 50;

    event BattleResultReset(uint256 indexed battleId);
    event RefereeBattleVoided(uint256 indexed battleId);

    VeydriftAllianceSystem internal alliance;

    struct Battle {
        uint256 origin;
        uint256 target;
        address defender;
        uint256 refuge;
        uint256 attack;
        uint64 arrival;
    }

    // ---------------------------------------------------------------------- shared helpers

    function _alliances() private {
        alliance = new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)));
        vm.prank(admin);
        game.setAllianceSystem(address(alliance));
    }

    function _ally(address leader, address member) private {
        vm.prank(leader);
        uint256 id = alliance.createAlliance("ATK", "Attackers", "ipfs://attackers");
        vm.prank(leader);
        alliance.inviteMember(id, member);
        vm.prank(member);
        alliance.acceptInvite(id);
    }

    function _commit(uint256 word) private {
        bytes32 commitment = randomness.randomnessCommitment(word);
        vm.prank(fulfiller);
        randomness.commitRandomness(commitment);
    }

    function _enableReferee() private {
        vm.prank(admin);
        IRefereeGame(address(game))
            .configureBattleReferee(
                P.Version(3, keccak256("candidate-2"), keccak256("catalog-fixture")), RESOLVER
            );
    }

    function _resolveUntil(uint256 id, uint8 phase) private {
        for (uint256 i; i < 200; ++i) {
            (uint8 p,,) = game.stagedBattleProgress(id);
            if (p == phase) return;
            game.resolveFleetMission{gas: 15_000_000}(id);
        }
        fail("phase not reached");
    }

    function _status(uint256 id) private view returns (P.Phase phase, uint256 rows) {
        (, phase,,,, rows) = abi.decode(
            IRefereeGame(address(game)).refereeBattleRecord(id, 0, 0),
            (P.Version, P.Phase, bytes32, bytes32, uint256, uint256)
        );
    }

    /// Honest-looking result in which every defender unit dies and every attacker survives.
    function _submitDefenderWiped(uint256 id, address resolver)
        private
        returns (S.Leaf[] memory leaves)
    {
        (, uint256 n) = _status(id);
        leaves = new S.Leaf[](n);
        for (uint256 i; i < n; ++i) {
            P.Row memory row =
                abi.decode(IRefereeGame(address(game)).refereeBattleRecord(id, 2, i), (P.Row));
            uint32 lost = row.side == 1 ? row.count : 0;
            leaves[i] = S.Leaf(
                row.owner, row.source, row.side, row.unit, row.count, lost, row.count - lost, 0
            );
        }
        bytes32 binding = IRefereeGame(address(game)).battleResultBinding(id);
        bytes32 root =
            keccak256(abi.encode(keccak256("veydrift.referee-battle.result-tail.v1"), binding, n));
        uint256[2] memory totals;
        for (uint256 k = n; k > 0; --k) {
            S.Leaf memory leaf = leaves[k - 1];
            leaf.next = root;
            root = keccak256(
                abi.encode(
                    keccak256("veydrift.referee-battle.result-leaf.v1"),
                    binding,
                    k - 1,
                    leaf.owner,
                    leaf.source,
                    leaf.side,
                    leaf.unit,
                    leaf.enrolledCount,
                    leaf.lost,
                    leaf.survivors,
                    leaf.next
                )
            );
            totals[leaf.side] += leaf.survivors;
        }
        vm.prank(resolver);
        IRefereeGame(address(game))
            .submitBattleResult(id, root, totals, keccak256("report"), refereeRounds(1, totals));
    }

    // ------------------------------------------- finding 1a: counterplay recall keeps the guard

    function _counterplayFixture() private returns (uint256 origin, uint256 home, uint256 colony) {
        _alliances();
        vm.deal(DEFENDER, 1 ether);
        origin = _startPlanet();
        vm.prank(DEFENDER);
        home = game.startPlanet{value: 0.05 ether}();
        _setPlanetLocation(origin, player, 1, 100, 8);
        _setPlanetLocation(home, DEFENDER, 1, 140, 8);
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(DEFENDER, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(DEFENDER, Technology.Astrophysics, 1);
        _setShipCount(home, Ship.ColonyShip, 1);
        _fundPlanet(home, 1_000_000, 1_000_000, 1_000_000);
        colony = game.nextPlanetId();
        uint8 position;
        for (uint8 p = 1; p <= 15; ++p) {
            if (
                p != 8
                    && VeydriftPlanetGeneration.isPopulatedPlanetSlot(
                        block.chainid, address(game), 1, 140, p, 9, 499, 15
                    ) && !game.occupiedCoordinates(game.coordinateKey(1, 140, p))
            ) {
                position = p;
                break;
            }
        }
        require(position != 0, "no colony slot");
        G.MissionShips memory colonyShips;
        colonyShips.colonyShip = 1;
        vm.prank(DEFENDER);
        uint256 colonize = game.launchFleetMission(
            home,
            (uint256(1) << 255) | (uint256(1) << 24) | (uint256(140) << 8) | position,
            G.FleetMissionType.Colonize,
            colonyShips,
            G.Resources(0, 0, 0),
            100,
            0
        );
        (, uint64 colonizedAt,,) = _fleetMission(colonize);
        vm.warp(colonizedAt);
        game.resolveFleetMission(colonize);
        assertEq(game.planet(colony).owner, DEFENDER, "colony created");
    }

    function _slowAttack(uint256 origin, uint256 colony) private returns (uint256 attack) {
        _fundPlanet(origin, 1_000_000, 1_000_000, 1_000_000);
        _setShipCount(origin, Ship.Battleship, 50);
        G.MissionShips memory ships;
        ships.battleship = 50;
        vm.prank(player);
        attack = game.launchFleetMission(
            origin, colony, G.FleetMissionType.Attack, ships, G.Resources(0, 0, 0), 10, 0
        );
    }

    function _move(uint256 from, uint256 to, uint128 deuterium, uint128 metal, uint128 crystal)
        private
        returns (uint256 id)
    {
        G.MissionShips memory one;
        one.smallCargo = 1;
        vm.prank(DEFENDER);
        id = game.launchFleetMission(
            from, to, G.FleetMissionType.Deploy, one, G.Resources(metal, crystal, deuterium), 100, 0
        );
    }

    function _land(uint256 id) private {
        (, uint64 at,,) = _fleetMission(id);
        if (vm.getBlockTimestamp() < at) vm.warp(at);
        game.resolveFleetMission(id);
    }

    /// Ships the colony's 500/500 starting stock out so only the inbound attack blocks abandon.
    function _drain(uint256 home, uint256 colony) private {
        _setShipCount(home, Ship.SmallCargo, 2);
        _fundPlanet(home, 1_000_000, 1_000_000, 1_000_000);
        _land(_move(home, colony, 1000, 0, 0));
        uint256 snap = vm.snapshotState();
        (,,,,,,,, uint128 fuel,,) = game.fleetMission(_move(colony, home, 0, 500, 500));
        vm.revertToState(snap);
        _land(_move(colony, home, 1000 - fuel, 500, 500));
        G.Planet memory p = game.planet(colony);
        assertEq(uint256(p.resources.metal) + p.resources.crystal + p.resources.deuterium, 0);
    }

    function _resolveArrived(uint256 attack) private {
        (, uint64 arrival,,) = _fleetMission(attack);
        vm.warp(arrival);
        _fulfillAttackBattleRandomness(attack, 1234);
        _resolveAttackFully(attack);
        (G.FleetMissionStatus status,,,) = _fleetMission(attack);
        assertTrue(status != G.FleetMissionStatus.Outbound, "attack settled, not stranded");
    }

    function testRecalledAcsDefendKeepsInboundAttackGuarded() public {
        (uint256 origin, uint256 home, uint256 colony) = _counterplayFixture();
        uint256 attack = _slowAttack(origin, colony);
        _drain(home, colony);
        _setShipCount(home, Ship.SmallCargo, 1);
        _fundPlanet(home, 1_000_000, 1_000_000, 1_000_000);
        G.MissionShips memory decoy;
        decoy.smallCargo = 1;
        vm.prank(DEFENDER);
        uint256 acsDefend = game.launchFleetMission(
            home, attack, G.FleetMissionType.AcsDefend, decoy, G.Resources(0, 0, 0), 100, 0
        );
        vm.prank(DEFENDER);
        game.recallFleetMission(acsDefend);
        (,, uint64 back,) = _fleetMission(acsDefend);
        vm.warp(back);
        game.completeFleetMissionReturn(acsDefend);
        assertEq(game.activeFleetMissionCount(DEFENDER), 0);
        vm.prank(DEFENDER);
        vm.expectRevert(G.PlanetHasActiveFleetMissions.selector);
        game.abandonPlanet(colony);
        _resolveArrived(attack);
    }

    function testRecalledAcsAttackJoinerKeepsInboundAttackGuarded() public {
        (uint256 origin, uint256 home, uint256 colony) = _counterplayFixture();
        uint256 attack = _slowAttack(origin, colony);
        _drain(home, colony);
        address joiner = address(0x1A1);
        vm.deal(joiner, 1 ether);
        vm.prank(joiner);
        uint256 joinerOrigin = game.startPlanet{value: 0.05 ether}();
        _setPlanetLocation(joinerOrigin, joiner, 1, 120, 8);
        _setTechnologyLevel(joiner, Technology.IntergalacticResearchNetwork, 3000);
        _setShipCount(joinerOrigin, Ship.SmallCargo, 1);
        _fundPlanet(joinerOrigin, 1_000_000, 1_000_000, 1_000_000);
        _ally(player, joiner);
        G.MissionShips memory one;
        one.smallCargo = 1;
        vm.prank(joiner);
        uint256 joined =
            game.joinAttackMission(joinerOrigin, attack, colony, one, G.Resources(0, 0, 0));
        vm.prank(joiner);
        game.recallFleetMission(joined);
        vm.prank(DEFENDER);
        vm.expectRevert(G.PlanetHasActiveFleetMissions.selector);
        game.abandonPlanet(colony);
        _resolveArrived(attack);
    }

    // --------------------------------------- findings 1b/1d/2: referee lock, recovery, void

    function _refereeBattle(bool moonTarget, uint256 word) private returns (Battle memory c) {
        _alliances();
        (c.origin, c.target, c.defender) = _seedMoonAttackPlanets();
        address donor = address(0xD0D0);
        vm.deal(donor, 1 ether);
        vm.prank(donor);
        c.refuge = game.startPlanet{value: 0.05 ether}();
        _setPlanetLocation(c.refuge, c.defender, 1, 100, 10);
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(c.defender, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(player, Technology.Computer, 10);
        _setTechnologyLevel(c.defender, Technology.Computer, 10);
        _setShipCount(c.origin, Ship.Battleship, 10);
        _setShipCount(c.target, Ship.LightFighter, 1);
        _setMoonShipCount(c.target, Ship.LightFighter, MOON_FLEET);
        _fundPlanet(c.refuge, 1_000_000_000, 1_000_000_000, 1_000_000_000);
        _fundPlanet(c.target, 1_000_000_000, 1_000_000_000, 1_000_000_000);
        _fundPlanet(c.origin, 1_000_000_000, 1_000_000_000, 1_000_000_000);
        _fundMoon(c.target, 1_000_000_000, 1_000_000_000, 1_000_000_000);
        _enableReferee();
        _commit(word);
        vm.roll(block.number + 1);
        G.MissionShips memory ships;
        ships.battleship = 2;
        vm.prank(player);
        c.attack = game.launchBodyFleetMission(
            c.origin,
            c.target,
            G.FleetMissionType.Attack,
            ships,
            G.Resources(0, 0, 0),
            100,
            false,
            moonTarget
        );
        (, c.arrival,,) = _fleetMission(c.attack);
    }

    /// The audit's defender-only trick: link an own-planet AcsDefend and recall it at once.
    function _linkAndRecallCounterplay(Battle memory c) private {
        G.MissionShips memory guard;
        guard.lightFighter = 1;
        vm.prank(c.defender);
        uint256 counterplay = game.launchFleetMission(
            c.target, c.attack, G.FleetMissionType.AcsDefend, guard, G.Resources(0, 0, 0), 0
        );
        vm.prank(c.defender);
        game.recallFleetMission(counterplay);
    }

    function _settleApplied(uint256 id, S.Leaf[] memory leaves) private {
        Application(address(game)).applyBattleResultLeaves(id, leaves);
        _resolveUntil(id, 13);
    }

    function testSealedHoldCannotRecallAndDiesOnlyOnce() public {
        Battle memory c = _refereeBattle(false, 4321);
        // A DefenseHold from the defender's second planet stationed over the target.
        _setShipCount(c.refuge, Ship.Battleship, 20);
        G.MissionShips memory holders;
        holders.battleship = 20;
        vm.prank(c.defender);
        uint256 hold =
            game.launchDefenseHold(c.refuge, c.target, holders, G.Resources(0, 0, 0), 100, 4 hours);
        (, uint64 holdArrival,,) = _fleetMission(hold);
        assertLe(holdArrival, c.arrival);
        _linkAndRecallCounterplay(c);
        vm.warp(c.arrival);
        _resolveUntil(c.attack, 16);
        (, uint256 rows) = _status(c.attack);
        P.Row memory last = abi.decode(
            IRefereeGame(address(game)).refereeBattleRecord(c.attack, 2, rows - 1), (P.Row)
        );
        assertEq(last.source, hold, "hold enrolled in the sealed roster");
        vm.prank(c.defender);
        vm.expectRevert(abi.encodeWithSelector(G.FleetMissionNotResolved.selector, c.arrival));
        game.recallFleetMission(hold);

        _fulfillAttackBattleRandomness(c.attack, 4321);
        game.resolveFleetMission(c.attack);
        _settleApplied(c.attack, _submitDefenderWiped(c.attack, RESOLVER));
        (G.FleetMissionStatus status,,,) = _fleetMission(hold);
        assertEq(uint8(status), uint8(G.FleetMissionStatus.Resolved), "hold destroyed");
        assertEq(game.shipCount(c.refuge, Ship.Battleship), 0, "no ships came home");
    }

    function testEnrolledMoonFleetCannotEvacuateAndBattleSettles() public {
        Battle memory c = _refereeBattle(true, 1234);
        _linkAndRecallCounterplay(c);
        vm.warp(c.arrival);
        G.MissionShips memory fleet;
        fleet.lightFighter = MOON_FLEET;
        // Blocked before preparation (inbound index) and after the seal (body lock).
        for (uint256 i; i < 2; ++i) {
            vm.prank(c.defender);
            vm.expectRevert(abi.encodeWithSelector(G.FleetMissionNotResolved.selector, c.arrival));
            game.launchBodyFleetMission{gas: 15_000_000}(
                c.target,
                c.refuge,
                G.FleetMissionType.Deploy,
                fleet,
                G.Resources(0, 0, 0),
                100,
                true,
                false
            );
            if (i == 0) _resolveUntil(c.attack, 16);
        }
        assertEq(game.moonShipCount(c.target, Ship.LightFighter), MOON_FLEET);
        _fulfillAttackBattleRandomness(c.attack, 1234);
        game.resolveFleetMission(c.attack);
        _settleApplied(c.attack, _submitDefenderWiped(c.attack, RESOLVER));
        assertEq(game.moonShipCount(c.target, Ship.LightFighter), 0);
        game.requireNoPendingMoonAttackResolution(c.target);
        moons.setMoonShipCount(c.target, Ship.LightFighter, 1);
    }

    /// The body lock alone guards the target: even with every index entry gone (the audit's
    /// root cause), actions on the locked body still revert until the battle settles.
    function testBodyLockGuardsTargetWithoutIndexEntries() public {
        Battle memory c = _refereeBattle(false, 1234);
        vm.warp(c.arrival);
        _resolveUntil(c.attack, 16);
        bytes32 ids = keccak256(abi.encode(c.target, uint256(38)));
        vm.store(address(game), ids, bytes32(0));
        vm.store(
            address(game),
            keccak256(abi.encode(c.attack, keccak256(abi.encode(c.target, uint256(40))))),
            bytes32(0)
        );
        vm.expectRevert(abi.encodeWithSelector(G.FleetMissionNotResolved.selector, c.arrival));
        game.requireNoPendingMoonAttackResolution(c.target);
    }

    function testOwnerResetLetsRotatedResolverReplaceUnappliableResult() public {
        Battle memory c = _refereeBattle(true, 1234);
        vm.warp(c.arrival);
        _resolveUntil(c.attack, 16);
        _fulfillAttackBattleRandomness(c.attack, 1234);
        game.resolveFleetMission(c.attack);
        uint256[2] memory totals = [uint256(type(uint32).max), uint256(0)];
        vm.prank(RESOLVER);
        IRefereeGame(address(game))
            .submitBattleResult(
                c.attack, keccak256("garbage"), totals, keccak256("r"), refereeRounds(1, totals)
            );
        address fresh = address(0xF8E54);
        vm.prank(admin);
        IRefereeGame(address(game))
            .configureBattleReferee(
                P.Version(3, keccak256("candidate-2"), keccak256("catalog-fixture")), fresh
            );
        vm.expectRevert(abi.encodeWithSelector(G.Unauthorized.selector, address(this)));
        IRefereeGame(address(game)).resetBattleResult(c.attack);
        vm.expectEmit(true, false, false, false, address(game));
        emit BattleResultReset(c.attack);
        vm.prank(admin);
        IRefereeGame(address(game)).resetBattleResult(c.attack);
        (S.Phase phase, uint256 next,,) = IRefereeGame(address(game)).battleResultProgress(c.attack);
        assertEq(uint8(phase), uint8(S.Phase.Unaccepted));
        assertEq(next, 0);
        vm.prank(admin);
        vm.expectRevert(S.InvalidOutput.selector);
        IRefereeGame(address(game)).resetBattleResult(c.attack);

        _settleApplied(c.attack, _submitDefenderWiped(c.attack, fresh));
        assertEq(game.moonShipCount(c.target, Ship.LightFighter), 0);
        (G.FleetMissionStatus status,,,) = _fleetMission(c.attack);
        assertEq(uint8(status), uint8(G.FleetMissionStatus.Returning));
        game.requireNoPendingMoonAttackResolution(c.target);
    }

    /// Lost randomness secret: the sealed battle can never be revealed. The owner voids it and the
    /// ordinary economics phases end it as a no-fight battle, releasing the lock and moon freeze.
    function testVoidedSealedBattleEndsWithoutFightAndReleasesLocks() public {
        Battle memory c = _refereeBattle(true, 1234);
        vm.warp(c.arrival);
        _resolveUntil(c.attack, 16);
        vm.expectRevert(abi.encodeWithSelector(G.Unauthorized.selector, address(this)));
        IRefereeGame(address(game)).voidRefereeBattle(c.attack);
        vm.expectEmit(true, false, false, false, address(game));
        emit RefereeBattleVoided(c.attack);
        vm.prank(admin);
        IRefereeGame(address(game)).voidRefereeBattle(c.attack);
        vm.prank(admin);
        vm.expectRevert(S.InvalidOutput.selector);
        IRefereeGame(address(game)).voidRefereeBattle(c.attack);
        (P.Phase phase,) = _status(c.attack);
        assertEq(uint8(phase), uint8(P.Phase.Bypassed));

        _resolveAttackFully(c.attack);
        (G.FleetMissionStatus status,,,) = _fleetMission(c.attack);
        assertEq(uint8(status), uint8(G.FleetMissionStatus.Returning));
        assertEq(game.moonShipCount(c.target, Ship.LightFighter), MOON_FLEET, "no casualties");
        (uint128 metal, uint128 crystal) = game.debrisField(c.target);
        assertEq(uint256(metal) + crystal, 0, "no debris");
        assertEq(moons.moonChanceOutcomeByBattle(keccak256(abi.encode(c.attack, c.target))), 0);
        game.requireNoPendingMoonAttackResolution(c.target);
        moons.setMoonShipCount(c.target, Ship.LightFighter, MOON_FLEET + 1);
        (,, uint64 back,) = _fleetMission(c.attack);
        vm.warp(back);
        game.completeFleetMissionReturn(c.attack);
        assertEq(game.shipCount(c.origin, Ship.Battleship), 10, "fleet home intact");
    }

    function testVoidDiscardsUnappliedResultButNotAppliedLeaves() public {
        uint256 snap = vm.snapshotState();
        Battle memory c = _refereeBattle(false, 1234);
        vm.warp(c.arrival);
        _resolveUntil(c.attack, 16);
        _fulfillAttackBattleRandomness(c.attack, 1234);
        game.resolveFleetMission(c.attack);
        _submitDefenderWiped(c.attack, RESOLVER);
        vm.prank(admin);
        IRefereeGame(address(game)).voidRefereeBattle(c.attack);
        (,,, uint256 members,,,,) = IRefereeGame(address(game)).battleResultSummary(c.attack);
        assertEq(members, 0, "unapplied result discarded");
        _resolveAttackFully(c.attack);
        assertEq(game.shipCount(c.target, Ship.LightFighter), 1, "no casualties");

        vm.revertToState(snap);
        c = _refereeBattle(false, 1234);
        vm.warp(c.arrival);
        _resolveUntil(c.attack, 16);
        _fulfillAttackBattleRandomness(c.attack, 1234);
        game.resolveFleetMission(c.attack);
        S.Leaf[] memory leaves = _submitDefenderWiped(c.attack, RESOLVER);
        S.Leaf[] memory first = new S.Leaf[](1);
        first[0] = leaves[0];
        Application(address(game)).applyBattleResultLeaves(c.attack, first);
        vm.startPrank(admin);
        vm.expectRevert(S.InvalidOutput.selector);
        IRefereeGame(address(game)).voidRefereeBattle(c.attack);
        vm.expectRevert(S.InvalidOutput.selector);
        IRefereeGame(address(game)).resetBattleResult(c.attack);
        vm.stopPrank();
        S.Leaf[] memory rest = new S.Leaf[](leaves.length - 1);
        for (uint256 i = 1; i < leaves.length; ++i) {
            rest[i - 1] = leaves[i];
        }
        _settleApplied(c.attack, rest);
    }

    // ------------------------------------------- finding 1c: missing defender becomes blocked

    function _abandonedTargetAttack(bool referee) private returns (uint256 id, uint256 origin) {
        uint256 target;
        address defender;
        (origin, target, defender) = _seedMoonAttackPlanets();
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(defender, Technology.IntergalacticResearchNetwork, 3000);
        _setShipCount(origin, Ship.Battleship, 3);
        _setShipCount(target, Ship.LightFighter, 5);
        _fundPlanet(origin, 1_000_000, 1_000_000, 1_000_000);
        if (referee) {
            _enableReferee();
            _commit(777);
            vm.roll(block.number + 1);
        }
        G.MissionShips memory ships;
        ships.battleship = 3;
        vm.prank(player);
        id = game.launchBodyFleetMission(
            origin,
            target,
            G.FleetMissionType.Attack,
            ships,
            G.Resources(0, 0, 0),
            100,
            false,
            false
        );
        // Defense in depth: simulate a target that lost its owner in flight.
        _setPlanetLocation(target, address(0), 1, 100, 9);
        (, uint64 arrival,,) = _fleetMission(id);
        vm.warp(arrival);
        _resolveAttackFully(id);
        (G.FleetMissionStatus status,,,) = _fleetMission(id);
        assertEq(uint8(status), uint8(G.FleetMissionStatus.Returning), "fleet returns");
        (,, uint64 back,) = _fleetMission(id);
        vm.warp(back);
        game.completeFleetMissionReturn(id);
        assertEq(game.shipCount(origin, Ship.Battleship), 3, "no fight");
    }

    function testMissingDefenderPreparesAsBlockedStagedBattle() public {
        _abandonedTargetAttack(false);
    }

    function testMissingDefenderBypassesRefereeWithoutRequest() public {
        (uint256 id,) = _abandonedTargetAttack(true);
        (P.Phase phase,) = _status(id);
        assertEq(uint8(phase), uint8(P.Phase.Bypassed));
        assertEq(randomness.readyCommitmentCount(), 1, "no FIFO word consumed");
    }

    // ------------------------------------------------- finding 3: no request before begin

    function _randomnessFixture()
        private
        returns (uint256 origin, uint256 target, uint256 griefOrigin, uint256 bystander)
    {
        vm.prank(admin);
        randomness.setPrecommitRequired(true);
        moons.setMoonChanceReporter(address(game));
        vm.deal(DEFENDER, 1 ether);
        vm.deal(GRIEFER, 1 ether);
        vm.deal(BYSTANDER, 1 ether);
        origin = _startPlanet();
        vm.prank(DEFENDER);
        target = game.startPlanet{value: 0.05 ether}();
        vm.prank(GRIEFER);
        griefOrigin = game.startPlanet{value: 0.05 ether}();
        vm.prank(BYSTANDER);
        bystander = game.startPlanet{value: 0.05 ether}();
        _setPlanetLocation(origin, player, 1, 100, 8);
        _setPlanetLocation(target, DEFENDER, 1, 100, 9);
        _setPlanetLocation(griefOrigin, GRIEFER, 1, 100, 10);
        _setPlanetLocation(bystander, BYSTANDER, 1, 100, 11);
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(DEFENDER, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(GRIEFER, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(BYSTANDER, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(player, Technology.Computer, 10);
        _setTechnologyLevel(GRIEFER, Technology.Computer, 10);
        _fundPlanet(origin, 1_000_000, 1_000_000, 1_000_000);
        _fundPlanet(griefOrigin, 1_000_000, 1_000_000, 1_000_000);
        _setShipCount(origin, Ship.Battleship, 100);
        _setShipCount(target, Ship.LightFighter, 120);
        _setShipCount(griefOrigin, Ship.LightFighter, 1);
    }

    function _attack(address who, uint256 from, uint256 to, Ship ship, uint32 n)
        private
        returns (uint256)
    {
        G.MissionShips memory ships;
        if (ship == Ship.Battleship) ships.battleship = n;
        else ships.lightFighter = n;
        vm.prank(who);
        return game.launchBodyFleetMission(
            from, to, G.FleetMissionType.Attack, ships, G.Resources(0, 0, 0), 100, false, false
        );
    }

    function testRecalledRefereeAttacksNeverConsumeTheFifo() public {
        (uint256 origin, uint256 target, uint256 griefOrigin, uint256 bystander) =
            _randomnessFixture();
        _enableReferee();
        _commit(4242);
        vm.roll(block.number + 1);
        for (uint256 i; i < 3; ++i) {
            uint256 spam = _attack(GRIEFER, griefOrigin, bystander, Ship.LightFighter, 1);
            vm.prank(GRIEFER);
            game.recallFleetMission(spam);
            (,,,,,,,,,, uint256 requestId) = game.fleetMission(spam);
            assertEq(requestId, 0, "recalled attack bound no randomness");
            (,, uint64 back,) = _fleetMission(spam);
            vm.warp(back);
            game.completeFleetMissionReturn(spam);
        }
        assertEq(randomness.readyCommitmentCount(), 1, "precommitted word untouched");
        uint256 honest = _attack(player, origin, target, Ship.Battleship, 1);
        (, uint64 arrival,,) = _fleetMission(honest);
        vm.warp(arrival);
        _resolveUntil(honest, 16);
        assertEq(randomness.readyCommitmentCount(), 0, "honest battle reserved it at begin");
        _fulfillAttackBattleRandomness(honest, 4242);
        game.resolveFleetMission(honest);
        (uint8 phase,,) = game.stagedBattleProgress(honest);
        assertEq(phase, 17);
    }

    // ----------------------------------------- finding 4: moon chance survives a drained FIFO

    function testDrainedFifoKeepsMoonChanceForPermissionlessRetry() public {
        (uint256 origin, uint256 target, uint256 griefOrigin, uint256 bystander) =
            _randomnessFixture();
        _commit(111);
        _commit(222);
        vm.roll(block.number + 1);
        uint256 id = _attack(player, origin, target, Ship.Battleship, 100);
        (, uint64 arrival,,) = _fleetMission(id);
        vm.warp(arrival);
        _fulfillAttackBattleRandomness(id, 111);
        _attack(GRIEFER, griefOrigin, bystander, Ship.LightFighter, 1);
        assertEq(randomness.readyCommitmentCount(), 0);
        _resolveAttackFully(id);
        (uint128 m, uint128 cr) = game.debrisField(target);
        assertGe(uint256(m) + cr, 100_000, "battle qualifies for a moon chance");

        uint256 outcomeId = moons.moonChanceOutcomeByBattle(keccak256(abi.encode(id, target)));
        assertGt(outcomeId, 0, "chance recorded despite the drained FIFO");
        (uint256 requestId,,,) = moons.moonChanceRandomness(outcomeId);
        assertEq(requestId, 0);
        vm.expectRevert(abi.encodeWithSelector(RandomnessEngine.UnknownRequest.selector, 0));
        moons.finalizeMoonChance(outcomeId);
        vm.prank(GRIEFER);
        vm.expectRevert(RandomnessEngine.NoRandomnessCommitment.selector);
        moons.retryMoonChanceRandomness(outcomeId);

        _commit(333);
        vm.roll(block.number + 1);
        vm.prank(GRIEFER);
        requestId = moons.retryMoonChanceRandomness(outcomeId);
        assertGt(requestId, 0);
        (uint256 stored,,,) = moons.moonChanceRandomness(outcomeId);
        assertEq(stored, requestId);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftMoonSystem.UnknownMoonChanceOutcome.selector, outcomeId)
        );
        moons.retryMoonChanceRandomness(outcomeId);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftMoonSystem.UnknownMoonChanceOutcome.selector, 999)
        );
        moons.retryMoonChanceRandomness(999);
        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, 333);
        moons.finalizeMoonChance(outcomeId);
        (,, bool finalized,) = moons.moonChanceRandomness(outcomeId);
        assertTrue(finalized);
    }

    // ------------------------------------------------- finding 5: moon defense backlog cap

    function testMoonDefenseBacklogIsCappedAtSixteen() public {
        uint256 planetId = _startPlanet();
        _createMoon(planetId);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.LunarBase);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.RoboticsFactory);
        _buildMoon(planetId, MoonBuilding.Shipyard);
        _grantMoonResources(planetId, 10_000_000, 10_000_000, 10_000_000);
        vm.startPrank(player);
        for (uint256 i; i < 17; ++i) {
            moons.startMoonDefenseProduction(planetId, Defense.RocketLauncher, 1);
        }
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftMoonDefenseBacklog.MoonDefenseBacklogFull.selector, planetId
            )
        );
        moons.startMoonDefenseProduction(planetId, Defense.RocketLauncher, 1);
        vm.stopPrank();
        assertEq(moons.moonDefenseQueueBacklog(planetId).length, 16);
    }

    // --------------------------------------------- finding 6: a used commitment never returns

    function testUsedCommitmentCanNeverBePrecommittedAgain() public {
        vm.startPrank(admin);
        randomness.setPrecommitRequired(true);
        randomness.setRequesterAuthorization(address(this), true);
        vm.stopPrank();
        vm.roll(100);
        _commit(7);
        vm.roll(101);
        uint256 first = randomness.requestRandomness(keccak256("first"));
        vm.prank(fulfiller);
        randomness.fulfillRandomness(first, 7);
        bytes32 revealed = randomness.randomnessCommitment(7);
        assertTrue(randomness.usedCommitment(revealed));
        vm.prank(fulfiller);
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentAlreadyUsed.selector, revealed
            )
        );
        randomness.commitRandomness(revealed);

        _commit(8);
        vm.roll(102);
        uint256 stale = randomness.requestRandomness(keccak256("stale"));
        vm.warp(block.timestamp + randomness.STALE_REQUEST_RECOVERY_DELAY());
        bytes32 original = randomness.randomnessCommitment(8);
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentAlreadyUsed.selector, revealed
            )
        );
        randomness.recoverStaleRequestCommitment(stale, original, revealed);
        bytes32 fresh = randomness.randomnessCommitment(9);
        vm.prank(admin);
        randomness.recoverStaleRequestCommitment(stale, original, fresh);
        vm.prank(fulfiller);
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.RandomnessCommitmentAlreadyUsed.selector, fresh)
        );
        randomness.commitRandomness(fresh);
    }

    // ------------------------------------- finding 9: ACS Defend fights at a moon attack's body

    function testAcsDefendAgainstMoonAttackEnrollsOnTheMoon() public {
        _alliances();
        (uint256 origin, uint256 target, address defender) = _seedMoonAttackPlanets();
        address donor = address(0xD0D0);
        vm.deal(donor, 1 ether);
        vm.prank(donor);
        uint256 refuge = game.startPlanet{value: 0.05 ether}();
        _setPlanetLocation(refuge, defender, 1, 100, 10);
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(defender, Technology.IntergalacticResearchNetwork, 3000);
        _setShipCount(origin, Ship.Battleship, 5);
        _setShipCount(refuge, Ship.LightFighter, 10);
        _fundPlanet(origin, 1_000_000, 1_000_000, 1_000_000);
        _fundPlanet(refuge, 1_000_000, 1_000_000, 1_000_000);
        G.MissionShips memory ships;
        ships.battleship = 5;
        vm.prank(player);
        uint256 id = game.launchBodyFleetMission(
            origin, target, G.FleetMissionType.Attack, ships, G.Resources(0, 0, 0), 100, false, true
        );
        G.MissionShips memory guard;
        guard.lightFighter = 10;
        vm.expectEmit(true, false, false, true, address(game));
        emit G.FleetMissionBodies(game.nextFleetId(), false, true);
        vm.prank(defender);
        uint256 acsDefend = game.launchFleetMission(
            refuge, id, G.FleetMissionType.AcsDefend, guard, G.Resources(0, 0, 0), 100, 0
        );
        (, uint64 arrival,,) = _fleetMission(id);
        vm.warp(arrival);
        _fulfillAttackBattleRandomness(id, 99);
        vm.recordLogs();
        _resolveAttackFully(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic =
            keccak256("CombatMemberSnapshot(uint256,uint256,address,uint8,uint8,uint32)");
        bool enrolled;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == topic && uint256(logs[i].topics[2]) == acsDefend) {
                enrolled = true;
            }
        }
        assertTrue(enrolled, "moon ACS Defend fought instead of idling");
        // The defender fleet then settles and lands home through the ordinary chronology.
        game.resolveFleetMission(acsDefend);
        (G.FleetMissionStatus status,, uint64 back,) = _fleetMission(acsDefend);
        if (status == G.FleetMissionStatus.Returning) {
            vm.warp(back);
            game.completeFleetMissionReturn(acsDefend);
            (status,,,) = _fleetMission(acsDefend);
            assertEq(uint8(status), uint8(G.FleetMissionStatus.Returned));
        } else {
            assertEq(uint8(status), uint8(G.FleetMissionStatus.Resolved), "destroyed in battle");
        }
    }
}
