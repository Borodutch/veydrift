// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Rift audit (2026-10-20) regressions: each test replays an audit finding on a standalone
// real-module deployment and asserts the fixed behaviour.

import {Test} from "forge-std/Test.sol";
import {RandomnessEngine} from "../../src/RandomnessEngine.sol";
import {VeydriftAttackProtectionModule} from "../../src/VeydriftAttackProtectionModule.sol";
import {VeydriftAcsAttackModule} from "../../src/VeydriftAcsAttackModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../../src/VeydriftCombatModule.sol";
import {VeydriftStagedCombatModule} from "../../src/VeydriftStagedCombatModule.sol";
import {
    VeydriftLegacyCombatModule,
    VeydriftLegacyCombatRapidfire
} from "../../src/VeydriftLegacyCombatModule.sol";
import {VeydriftCombatRaidModule} from "../../src/VeydriftCombatRaidModule.sol";
import {VeydriftColonizationModule} from "../../src/VeydriftColonizationModule.sol";
import {VeydriftShipProductionModule} from "../../src/VeydriftShipProductionModule.sol";
import {VeydriftDefenseHoldModule} from "../../src/VeydriftDefenseHoldModule.sol";
import {
    VeydriftFirstPlanetSettlementModule
} from "../../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../../src/VeydriftGame.sol";
import {VeydriftGameStorage as S} from "../../src/VeydriftGameStorage.sol";
import {VeydriftGameplayModule} from "../../src/VeydriftGameplayModule.sol";
import {VeydriftPlanetManagementModule} from "../../src/VeydriftPlanetManagementModule.sol";
import {VeydriftStateMigrationModule as M} from "../../src/VeydriftStateMigrationModule.sol";
import {VeydriftAllianceSystem, IVeydriftAllianceGame} from "../../src/VeydriftAllianceSystem.sol";
import {VeydriftAntiRaidPrimitives} from "../../src/libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftPlanetGeneration} from "../../src/libraries/VeydriftPlanetGeneration.sol";
import {Building, Defense, Resource, Ship, Technology} from "../../src/libraries/VeydriftTypes.sol";

contract RiftAuditToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
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

interface IRift {
    function startRiftExtraction(uint256 planetId, Resource resource, uint128 amount) external;
    function finalizeRiftExtraction(uint256 planetId, Resource resource) external;
    function riftLockedResources(uint256 planetId) external view returns (S.Resources memory);
}

contract RiftAuditRegressionsTest is Test {
    address internal admin = address(0xA11CE);
    address internal attacker = address(0xB0B);
    address internal defender = address(0xDEF);
    address internal stranger = address(0x5A5A);
    address internal fulfiller = address(0xF111);
    VeydriftGame internal game;
    IRift internal rift;
    RandomnessEngine internal randomness;
    VeydriftAllianceSystem internal alliance;
    RiftAuditToken internal metal;

    uint256 internal constant RIFT_EXTRACTIONS_SLOT = 55;

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
                        address(new M(address(0xBEEF), address(new VeydriftCombatRaidModule()))),
                        address(new VeydriftAcsAttackModule())
                    )
                ))
        );
        rift = IRift(address(game));
        metal = new RiftAuditToken();
        RiftAuditToken c = new RiftAuditToken();
        RiftAuditToken d = new RiftAuditToken();
        metal.mint(address(game), 1e15);
        c.mint(address(game), 1e15);
        d.mint(address(game), 1e15);
        vm.startPrank(admin);
        game.setResourceTokens(address(metal), address(c), address(d));
        game.setRandomnessEngine(address(randomness));
        randomness.setRequesterAuthorization(address(game), true);
        alliance = new VeydriftAllianceSystem(IVeydriftAllianceGame(address(game)));
        game.setAllianceSystem(address(alliance));
        vm.stopPrank();
        vm.warp(1_800_000_000);
    }

    // -------------------------------------------------------------------------- helpers

    function _start(address who) internal returns (uint256 id) {
        vm.deal(who, 1 ether);
        uint256 price = game.startPrice();
        vm.prank(who);
        id = game.startPlanet{value: price}();
        // Neutral tech that lifts accounts above newbie/score protection.
        _tech(who, Technology.IntergalacticResearchNetwork, 3_000);
        _tech(who, Technology.Computer, 20);
    }

    function _tech(address who, Technology t, uint16 level) internal {
        bytes32 outer = keccak256(abi.encode(who, uint256(20)));
        vm.store(
            address(game), keccak256(abi.encode(uint256(uint8(t)), outer)), bytes32(uint256(level))
        );
    }

    function _building(uint256 planetId, Building b, uint16 level) internal {
        bytes32 outer = keccak256(abi.encode(planetId, uint256(6)));
        vm.store(
            address(game), keccak256(abi.encode(uint256(uint8(b)), outer)), bytes32(uint256(level))
        );
    }

    function _ships(uint256 planetId, Ship ship, uint32 n) internal {
        bytes32 outer = keccak256(abi.encode(planetId, uint256(22)));
        vm.store(
            address(game), keccak256(abi.encode(uint256(uint8(ship)), outer)), bytes32(uint256(n))
        );
    }

    function _defenses(uint256 planetId, Defense defense, uint32 n) internal {
        bytes32 outer = keccak256(abi.encode(planetId, uint256(19)));
        vm.store(
            address(game),
            keccak256(abi.encode(uint256(uint8(defense)), outer)),
            bytes32(uint256(n))
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

    function _place(uint256 id, uint16 g, uint16 s, uint8 p) internal {
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
    }

    /// An energy-starved economy (no power plants) with a ready 2,000-satellite batch whose
    /// completion was never observed for `days_` days.
    function _starvedPlanetWithReadySatellites(address who, uint256 days_)
        internal
        returns (uint256 planetId)
    {
        planetId = _start(who);
        _building(planetId, Building.MetalMine, 20);
        _building(planetId, Building.CrystalMine, 18);
        _building(planetId, Building.DeuteriumSynthesizer, 15);
        _building(planetId, Building.MetalStorage, 20);
        _building(planetId, Building.CrystalStorage, 20);
        _building(planetId, Building.DeuteriumTank, 20);
        _building(planetId, Building.Shipyard, 12);
        _building(planetId, Building.NaniteFactory, 10);
        _res(planetId, 0, 4_000_000, 1_000_000);
        vm.prank(who);
        game.startShipProduction(planetId, Ship.SolarSatellite, 2_000);
        vm.warp(game.shipQueue(planetId).readyAt + days_ * 1 days);
    }

    function _stabilized(address who) internal returns (uint256 planetId) {
        planetId = _start(who);
        _building(planetId, Building.InterdimensionalRiftStabilizer, 1);
        _res(planetId, 1_000_000, 1_000_000, 1_000_000);
    }

    function _extraction(uint256 planetId, Resource resource)
        internal
        view
        returns (bool active, uint128 amount, uint64 unlocksAt)
    {
        (active, amount,, unlocksAt) = game.riftExtractions(planetId, resource);
    }

    function _fleet(Ship ship, uint32 n) internal pure returns (S.MissionShips memory f) {
        if (ship == Ship.SmallCargo) f.smallCargo = n;
        else if (ship == Ship.LargeCargo) f.largeCargo = n;
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
        returns (S.FleetMissionStatus status, uint64 arrivalAt, uint256 requestId)
    {
        (status,,,,,, arrivalAt,,,, requestId) = game.fleetMission(id);
    }

    function _cargoMetal(uint256 id) internal view returns (uint128) {
        (,,,,,,,,, S.Resources memory c,) = game.fleetMission(id);
        return c.metal;
    }

    function _land(uint256 id) internal {
        (, uint64 arrivalAt, uint256 requestId) = _mission(id);
        if (arrivalAt > vm.getBlockTimestamp()) vm.warp(arrivalAt);
        vm.prank(fulfiller);
        randomness.fulfillRandomness(requestId, 7);
        for (uint256 i; i < 400; ++i) {
            (S.FleetMissionStatus st,,) = _mission(id);
            if (st != S.FleetMissionStatus.Outbound) return;
            game.resolveFleetMission{gas: 15_000_000}(id);
        }
        revert("unresolved");
    }

    /// The attacker has used up its anti-bashing allowance on `planetId` in the current window.
    function _bashed(address who, address target, uint256 planetId) internal {
        bytes32 key = keccak256(abi.encode(who, target, planetId));
        uint256 packed = uint256(block.timestamp)
            | (uint256(VeydriftAntiRaidPrimitives.MAX_ATTACKS_PER_BASHING_WINDOW) << 64);
        vm.store(address(game), keccak256(abi.encode(key, uint256(29))), bytes32(packed));
    }

    /// A Rift planet holding 100 locked metal next to 1,000,000 ordinary metal.
    function _riftTarget(address who) internal returns (uint256 planetId) {
        planetId = game.homePlanetOf(who);
        _building(planetId, Building.InterdimensionalRiftStabilizer, 1);
        _res(planetId, 1_000_100, 0, 0);
        vm.prank(who);
        rift.startRiftExtraction(planetId, Resource.Metal, 100);
    }

    // --- M2: past the anti-bashing limit only the Rift lock may be raided (whitepaper §Raid)

    function testRiftAdmittedAttackPastTheBashingLimitLootsOnlyTheLock() public {
        uint256 origin = _start(attacker);
        _place(origin, 1, 100, 8);
        _place(_start(defender), 1, 101, 9);
        uint256 target = _riftTarget(defender);
        _ships(origin, Ship.LargeCargo, 40);
        _res(origin, 0, 0, 1e9);
        _bashed(attacker, defender, target);

        uint256 id = _attack(attacker, origin, target, _fleet(Ship.LargeCargo, 40));
        _land(id);
        // Before the fix the 7th attack in the window was an open raid: 50% of the ordinary
        // 1,000,000 metal on top of the lock.
        assertEq(_cargoMetal(id), 100, "only the Rift lock");
        assertEq(game.planet(target).resources.metal, 1_000_000, "ordinary metal untouched");
        assertEq(rift.riftLockedResources(target).metal, 0);
    }

    function testRiftAdmittedAttackPastTheBashingLimitBouncesOnceTheLockIsGone() public {
        uint256 origin = _start(attacker);
        _place(origin, 1, 100, 8);
        _place(_start(defender), 1, 101, 9);
        uint256 target = _riftTarget(defender);
        (,, uint64 unlocksAt) = _extraction(target, Resource.Metal);
        vm.warp(unlocksAt);
        // Still an active player (an inactive one is openly raidable by design).
        vm.prank(defender);
        game.collectResources(target);
        _ships(origin, Ship.LargeCargo, 40);
        _res(origin, 0, 0, 1e9);
        _bashed(attacker, defender, target);

        uint256 id = _attack(attacker, origin, target, _fleet(Ship.LargeCargo, 40));
        // The owner ejects the matured lock before impact; the planet is bashing-protected again.
        vm.prank(defender);
        rift.finalizeRiftExtraction(target, Resource.Metal);
        _land(id);
        assertEq(_cargoMetal(id), 0, "no loot without the lock");
        assertEq(game.planet(target).resources.metal, 1_000_000);
    }

    // --- M1: an ACS joiner admitted only by the Rift cannot share an open raid of a newbie

    /// A newbie defender (below 50k score) and a newbie leader within its 1.5x band, plus a
    /// strong joiner in the leader's alliance. Without the lock the newbie is protected from the
    /// joiner; with it the joiner may raid the lock, but only through a Rift-only battle.
    function _newbieRaid()
        internal
        returns (uint256 target, uint256 leaderAttack, uint256 joinerOrigin)
    {
        address leader = address(0x1EAD);
        vm.deal(leader, 1 ether);
        vm.deal(defender, 1 ether);
        uint256 price = game.startPrice();
        vm.prank(defender);
        target = game.startPlanet{value: price}();
        _place(target, 1, 101, 9);
        vm.prank(leader);
        uint256 leaderOrigin = game.startPlanet{value: price}();
        _place(leaderOrigin, 1, 102, 9);
        joinerOrigin = _start(attacker);
        _place(joinerOrigin, 1, 101, 4);
        _building(target, Building.InterdimensionalRiftStabilizer, 1);
        _res(target, 1_000_100, 0, 0);
        vm.prank(defender);
        rift.startRiftExtraction(target, Resource.Metal, 100);

        vm.prank(leader);
        uint256 allianceId = alliance.createAlliance("RFT", "Rifters", "");
        vm.prank(leader);
        alliance.inviteMember(allianceId, attacker);
        vm.prank(attacker);
        alliance.acceptInvite(allianceId);

        _ships(leaderOrigin, Ship.SmallCargo, 1);
        _res(leaderOrigin, 0, 0, 1e6);
        leaderAttack = _attack(leader, leaderOrigin, target, _fleet(Ship.SmallCargo, 1));
        _ships(joinerOrigin, Ship.LargeCargo, 40);
        _res(joinerOrigin, 0, 0, 1e9);
    }

    function testRiftOnlyJoinerCannotJoinAnOpenRaidOfAProtectedTarget() public {
        (uint256 target, uint256 leaderAttack, uint256 joinerOrigin) = _newbieRaid();
        // The newbie leader's raid is open (within its band), so it would loot ordinary metal.
        // Before the fix the strong joiner rode it and took ~99.5% of that 50% ordinary tranche.
        vm.prank(attacker);
        vm.expectRevert(S.AttackScoreProtection.selector);
        game.joinAttackMission(
            joinerOrigin, leaderAttack, target, _fleet(Ship.LargeCargo, 40), _none()
        );
    }

    function testRiftOnlyJoinerMayJoinARiftOnlyRaid() public {
        (uint256 target,, uint256 joinerOrigin) = _newbieRaid();
        // A second strong alliance member leads: its own verdict is already Rift-only.
        uint256 leaderOrigin = _start(stranger);
        _place(leaderOrigin, 1, 102, 5);
        uint256 allianceId = alliance.allianceOf(address(0x1EAD)).allianceId;
        vm.prank(address(0x1EAD));
        alliance.inviteMember(allianceId, stranger);
        vm.prank(stranger);
        alliance.acceptInvite(allianceId);
        _ships(leaderOrigin, Ship.LargeCargo, 1);
        _res(leaderOrigin, 0, 0, 1e9);
        uint256 lead = _attack(stranger, leaderOrigin, target, _fleet(Ship.LargeCargo, 1));
        vm.prank(attacker);
        uint256 joined = game.joinAttackMission(
            joinerOrigin, lead, target, _fleet(Ship.LargeCargo, 40), _none()
        );
        _land(lead);
        assertEq(uint256(_cargoMetal(lead)) + _cargoMetal(joined), 100, "the lock alone");
        assertEq(game.planet(target).resources.metal, 1_000_000);
    }

    function testRiftOnlyAttackerStillRaidsTheLockOnItsOwn() public {
        (uint256 target,, uint256 joinerOrigin) = _newbieRaid();
        uint256 id = _attack(attacker, joinerOrigin, target, _fleet(Ship.LargeCargo, 40));
        _land(id);
        assertEq(_cargoMetal(id), 100, "the lock, and only the lock");
        assertEq(game.planet(target).resources.metal, 1_000_000);
    }

    // ------ L1: satellites that land without a settle must not power the elapsed window

    function testFinishShipProductionDoesNotCreditSatelliteOutputRetroactively() public {
        uint256 planetId = _starvedPlanetWithReadySatellites(defender, 10);
        // The honest balance: everything that accrued while the planet had no power.
        S.Resources memory honest = game.previewResources(planetId);

        vm.prank(defender);
        game.finishShipProduction(planetId);
        assertEq(game.shipCount(planetId, Ship.SolarSatellite), 2_000);
        vm.prank(defender);
        game.collectResources(planetId);
        // Before the fix the 10 starved days were re-priced at full satellite power.
        assertEq(game.planet(planetId).resources.metal, honest.metal);
        assertEq(game.planet(planetId).resources.crystal, honest.crystal);
    }

    function testFinishShipProductionStillRevertsWhenNothingIsReady() public {
        uint256 planetId = _start(defender);
        _building(planetId, Building.Shipyard, 1);
        _res(planetId, 0, 4_000_000, 1_000_000);
        vm.prank(defender);
        game.startShipProduction(planetId, Ship.SolarSatellite, 2_000);
        vm.prank(defender);
        vm.expectPartialRevert(S.QueueNotReady.selector);
        game.finishShipProduction(planetId);
    }

    function _missileSilo(address who, uint256 planetId) internal {
        _building(planetId, Building.MissileSilo, 4);
        _defenses(planetId, Defense.InterplanetaryMissile, 5);
        _tech(who, Technology.ImpulseDrive, 4);
    }

    function testMissileLaunchDoesNotCreditOriginSatelliteOutputRetroactively() public {
        uint256 origin = _starvedPlanetWithReadySatellites(defender, 10);
        _place(origin, 2, 100, 4);
        _missileSilo(defender, origin);
        uint256 target = _start(stranger);
        _place(target, 2, 101, 4);
        S.Resources memory honest = game.previewResources(origin);

        vm.prank(defender);
        game.launchInterplanetaryMissileAttack(origin, target, Defense.RocketLauncher, 1);
        assertEq(game.shipCount(origin, Ship.SolarSatellite), 2_000);
        vm.prank(defender);
        game.collectResources(origin);
        assertEq(game.planet(origin).resources.metal, honest.metal);
    }

    function testMissileImpactDoesNotCreditTargetSatelliteOutputRetroactively() public {
        uint256 target = _starvedPlanetWithReadySatellites(stranger, 10);
        _place(target, 2, 101, 4);
        uint256 origin = _start(attacker);
        _place(origin, 2, 100, 4);
        _missileSilo(attacker, origin);
        vm.prank(attacker);
        uint256 missionId =
            game.launchInterplanetaryMissileAttack(origin, target, Defense.RocketLauncher, 1);
        (,,,,,, uint64 arrivalAt,,,,) = game.fleetMission(missionId);
        vm.warp(arrivalAt);
        S.Resources memory honest = game.previewResources(target);

        game.resolveFleetMission(missionId);
        assertEq(game.shipCount(target, Ship.SolarSatellite), 2_000);
        vm.prank(stranger);
        game.collectResources(target);
        assertEq(game.planet(target).resources.metal, honest.metal);
    }

    // ---- I: a Rift raid is a reclassification and must settle even with a short reserve

    function testRiftRaidSettlesEvenWhenTheReserveIsShort() public {
        uint256 origin = _start(attacker);
        _place(origin, 1, 100, 8);
        _place(_start(defender), 1, 101, 9);
        uint256 target = _riftTarget(defender);
        _ships(origin, Ship.LargeCargo, 40);
        _res(origin, 0, 0, 1e9);
        uint256 id = _attack(attacker, origin, target, _fleet(Ship.LargeCargo, 40));
        // The metal reserve ends one unit short of the ledger (e.g. a misbehaving token).
        uint256 excess = metal.balanceOf(address(game)) - game.resourceReserveRequirement().metal;
        vm.prank(address(game));
        assertTrue(metal.transfer(stranger, excess + 1));
        // Before the fix the lock's `_increaseInternalResources` capacity check reverted the
        // raid stage, leaving the battle (and its body lock) stuck for good.
        _land(id);
        assertEq(_cargoMetal(id), 500_000 + 100);
        assertEq(rift.riftLockedResources(target).metal, 0);
    }

    // ---- L3: an import that reuses an abandoned id must not inherit its Rift state

    function _colonize(address who, uint256 home) internal returns (uint256 colony) {
        _tech(who, Technology.Astrophysics, 1);
        _ships(home, Ship.ColonyShip, 1);
        S.Planet memory h = game.planet(home);
        uint8 pos;
        for (uint8 p = 1; p <= 15; ++p) {
            if (
                p != h.position
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
        (, uint64 arrivalAt,) = _mission(id);
        vm.warp(arrivalAt);
        game.resolveFleetMission(id);
        assertEq(game.planet(colony).owner, who, "colony created");
    }

    function testImportOntoAnAbandonedIdBringsNoStabilizerOrRiftRecord() public {
        uint256 home = _start(defender);
        _res(home, 0, 0, 1e6);
        uint256 colony = _colonize(defender, home);
        _building(colony, Building.InterdimensionalRiftStabilizer, 1);
        _res(colony, 1, 0, 0);
        vm.prank(defender);
        rift.startRiftExtraction(colony, Resource.Metal, 1);
        // Fully raided: the record stays active with a zero amount, so abandon is allowed.
        bytes32 outer = keccak256(abi.encode(colony, RIFT_EXTRACTIONS_SLOT));
        vm.store(address(game), keccak256(abi.encode(uint256(0), outer)), bytes32(uint256(1)));
        vm.store(address(game), keccak256(abi.encode(colony, uint256(56))), 0);
        vm.store(address(game), bytes32(uint256(16)), 0);
        vm.prank(defender);
        game.abandonPlanet(colony);
        assertEq(game.buildingLevel(colony, Building.InterdimensionalRiftStabilizer), 1);

        // Before the fix the importer of the reused id got a Stabilizer it never built and a
        // stale `active` record that blocked its own Metal extraction.
        vm.prank(admin);
        game.setMigrationSettlement(address(this));
        _import(stranger, colony);
        assertEq(game.planet(colony).owner, stranger);
        assertEq(game.buildingLevel(colony, Building.InterdimensionalRiftStabilizer), 0);
        (bool active,,) = _extraction(colony, Resource.Metal);
        assertFalse(active);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(S.RiftStabilizerRequired.selector, colony));
        game.depositMarketResource(colony, Resource.Metal, 1);
    }

    // ------------------- L2: migration discard must not orphan or hand over a live Rift lock

    function _singlePlanetState(address who, uint256 planetId)
        internal
        view
        returns (bytes memory)
    {
        M.MigrationPlanetState[] memory planets = new M.MigrationPlanetState[](1);
        M.MigrationPlanetState memory p;
        p.planetId = planetId;
        p.galaxy = 3;
        p.system = 300;
        p.position = 7;
        p.fields = 160;
        p.temperature = 20;
        p.lastSettledAt = uint64(block.timestamp);
        planets[0] = p;
        M.MigrationPlayerState memory state;
        state.player = who;
        state.homePlanetId = planetId;
        state.planets = planets;
        return abi.encode(state);
    }

    function _import(address who, uint256 planetId) internal {
        uint256 price = game.startPrice();
        vm.deal(address(this), price);
        game.importMigratedState{value: price}(who, _singlePlanetState(who, planetId));
    }

    function testMigrationDiscardRefusesALiveRiftLock() public {
        uint256 planetId = _stabilized(defender);
        vm.prank(defender);
        rift.startRiftExtraction(planetId, Resource.Metal, 400_000);
        vm.prank(admin);
        game.setMigrationSettlement(address(this));

        // Before the fix the started planet was deleted here while its lock stayed behind:
        // `lockedWithdrawalResources` kept the claim forever and an import reusing `planetId`
        // (any player's signed state) inherited `riftExtractions[planetId]` and could finalize it.
        uint256 price = game.startPrice();
        vm.deal(address(this), price);
        bytes memory payload = _singlePlanetState(defender, 9_001);
        vm.expectRevert(S.PlanetHasResources.selector);
        game.importMigratedState{value: price}(defender, payload);

        // After finalizing, the discard (and the import) proceed and leave no claim behind.
        (,, uint64 unlocksAt) = _extraction(planetId, Resource.Metal);
        vm.warp(unlocksAt);
        vm.prank(defender);
        rift.finalizeRiftExtraction(planetId, Resource.Metal);
        assertEq(metal.balanceOf(defender), 400_000);
        _import(defender, 9_001);
        assertEq(game.planet(planetId).owner, address(0));
        assertEq(game.homePlanetOf(defender), 9_001);
        S.Resources memory locked = game.lockedWithdrawalResources();
        assertEq(uint256(locked.metal) + locked.crystal + locked.deuterium, 0);
    }

    function testMigrationDoesNotBoostTheBackdatedWindowWithTheStartedPlanetsInviteBoost() public {
        _start(defender);
        // The discarded start was a referred one: its 7-day 2x boost is 3 days in.
        vm.store(
            address(game),
            keccak256(abi.encode(defender, uint256(57))),
            bytes32(uint256(block.timestamp + 4 days))
        );
        vm.prank(admin);
        game.setMigrationSettlement(address(this));
        // A signed snapshot taken 10 days ago accrues those 10 days at the normal rate.
        M.MigrationPlayerState memory state =
            abi.decode(_singlePlanetState(defender, 9_100), (M.MigrationPlayerState));
        state.planets[0].lastSettledAt = uint64(block.timestamp - 10 days);
        state.planets[0].buildingLevels[uint8(Building.MetalMine)] = 10;
        state.planets[0].buildingLevels[uint8(Building.SolarPlant)] = 10;
        state.planets[0].buildingLevels[uint8(Building.MetalStorage)] = 15;
        uint256 price = game.startPrice();
        vm.deal(address(this), price);
        game.importMigratedState{value: price}(defender, abi.encode(state));

        (uint256 metalPerHour,,) = game.productionPerHour(9_100);
        assertGt(metalPerHour, 0);
        // Before the fix 3 of the 10 backdated days were doubled by the discarded start's boost.
        assertEq(game.previewResources(9_100).metal, (metalPerHour * 10 days) / 1 hours);
    }

    function testMigrationDiscardClearsAFullyRaidedRiftRecord() public {
        uint256 planetId = _stabilized(defender);
        vm.prank(defender);
        rift.startRiftExtraction(planetId, Resource.Crystal, 1);
        // A raid that takes the whole lock leaves an active, zero-amount record (amount and the
        // per-planet total are both zero), exactly as `raidRiftExtraction` does.
        bytes32 outer = keccak256(abi.encode(planetId, RIFT_EXTRACTIONS_SLOT));
        bytes32 slot = keccak256(abi.encode(uint256(uint8(Resource.Crystal)), outer));
        vm.store(address(game), slot, bytes32(uint256(1)));
        vm.store(address(game), keccak256(abi.encode(planetId, uint256(56))), 0);
        vm.store(address(game), bytes32(uint256(16)), 0);
        vm.store(address(game), bytes32(uint256(17)), 0);
        (bool active, uint128 amount,) = _extraction(planetId, Resource.Crystal);
        assertTrue(active);
        assertEq(amount, 0);
        assertEq(rift.riftLockedResources(planetId).crystal, 0);

        vm.prank(admin);
        game.setMigrationSettlement(address(this));
        _import(defender, 9_002);
        // A later import that reuses the discarded id must start without the stale record.
        _import(stranger, planetId);
        (active,,) = _extraction(planetId, Resource.Crystal);
        assertFalse(active);
    }
}
