// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Rift audit (2026-10-20) live-state proofs: each test first replays a finding against the
// implementation deployed on Base, then upgrades the fork to this branch's module graph (exactly
// as UpgradeGameFork does) and replays it again. Keyless: owners are impersonated on the fork.
//   VEYDRIFT_BASE_MAINNET_RPC_URL=https://mainnet.base.org \
//     forge test --match-path test/audit/RiftAuditMainnetFork.t.sol -vv

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {VeydriftCombatRaidModule} from "../../src/VeydriftCombatRaidModule.sol";
import {VeydriftStagedCombatModule} from "../../src/VeydriftStagedCombatModule.sol";
import {
    VeydriftLegacyCombatModule,
    VeydriftLegacyCombatRapidfire
} from "../../src/VeydriftLegacyCombatModule.sol";
import {VeydriftAttackProtectionModule} from "../../src/VeydriftAttackProtectionModule.sol";
import {VeydriftAcsAttackModule} from "../../src/VeydriftAcsAttackModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../../src/VeydriftCombatModule.sol";
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
import {Building, Resource, Ship, Technology} from "../../src/libraries/VeydriftTypes.sol";
import {
    ImportMissingMigrationReservations
} from "../../script/ImportMissingMigrationReservations.s.sol";

interface IRiftFork {
    function startRiftExtraction(uint256 planetId, Resource resource, uint128 amount) external;
    function finalizeRiftExtraction(uint256 planetId, Resource resource) external;
    function riftLockedResources(uint256 planetId) external view returns (S.Resources memory);
    function setDelegate(address delegate) external;
    function revokeDelegate() external;
    function delegatorOf(address delegate) external view returns (address);
}

interface IOwnedFork {
    function owner() external view returns (address);
    function setStateSigner(address nextSigner) external;
}

interface IAllianceFork {
    function createAlliance(string calldata tag, string calldata name, string calldata description)
        external
        returns (uint256);
    function inviteMember(uint256 allianceId, address player) external;
    function acceptInvite(uint256 allianceId) external;
}

contract RiftAuditMainnetForkTest is Test {
    bytes32 internal constant IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    address internal constant PROXY = 0xf397910F005151b09644228573a4353818D3755d;
    address internal constant PROXY_ADMIN = 0xc81609E77b5ea79d0CdA9794b75B65D567535cb9;
    address internal constant TREASURY = 0x2732e87c9b9A9Ce3C1C78968B12F56Ec74D1c9d7;
    address internal constant MIGRATION_SETTLEMENT = 0x33A56B6f6354D32Edeef43baECC3C94a316bf7d3;
    address internal constant SNAPSHOT_SIGNER = 0x496494cB54153e97e4D28454092e0cf293A97088;
    VeydriftGame internal constant GAME = VeydriftGame(payable(PROXY));
    IRiftFork internal constant RIFT = IRiftFork(PROXY);

    /// Last block before the 2026-10-20 Game upgrade that shipped #1958 (two-step delegation).
    uint256 internal constant PRE_CONSENT_BLOCK = 52_871_779;
    /// Last blocks before the Game upgrades that shipped #1961 (this audit's fixes) and #1962
    /// (fusion upkeep): the live replays of those findings run on the code they were found on.
    uint256 internal constant PRE_AUDIT_FIX_BLOCK = 52_873_718;
    uint256 internal constant PRE_FUSION_FIX_BLOCK = 52_878_339;

    /// The vMETAL the Game used at the forked block, so pinned and live forks both inject the right token.
    function _metal() internal view returns (IERC20) {
        return IERC20(GAME.resourceToken(Resource.Metal));
    }

    function _fork() internal returns (bool) {
        return _forkAt(0);
    }

    function _forkAt(uint256 blockNumber) internal returns (bool) {
        string memory rpc = vm.envOr("VEYDRIFT_BASE_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            emit log("VEYDRIFT_BASE_MAINNET_RPC_URL unset - skipping Rift audit fork");
            return false;
        }
        if (blockNumber == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, blockNumber);
        return true;
    }

    /// Deploys this branch's module graph and switches the fork proxy to it (UpgradeGameFork).
    function _upgradeToBranch() internal {
        VeydriftCombatRapidfire rapidfire = new VeydriftCombatRapidfire();
        VeydriftCombatModule combat = new VeydriftCombatModule(
            address(rapidfire),
            address(new VeydriftStagedCombatModule(address(rapidfire))),
            address(new VeydriftLegacyCombatModule(address(new VeydriftLegacyCombatRapidfire())))
        );
        VeydriftColonizationModule colonization =
            new VeydriftColonizationModule(address(new VeydriftShipProductionModule()));
        address referral = address(0xBEEF);
        VeydriftGame impl = new VeydriftGame(
            address(this),
            address(new VeydriftFirstPlanetSettlementModule(referral, address(colonization))),
            address(new VeydriftGameplayModule(address(combat))),
            address(new VeydriftPlanetManagementModule()),
            address(new VeydriftAttackProtectionModule()),
            address(colonization),
            address(new VeydriftDefenseHoldModule()),
            address(new M(referral, address(new VeydriftCombatRaidModule()))),
            address(new VeydriftAcsAttackModule())
        );
        vm.prank(ProxyAdmin(PROXY_ADMIN).owner());
        ProxyAdmin(PROXY_ADMIN)
            .upgradeAndCall(ITransparentUpgradeableProxy(PROXY), address(impl), "");
        assertEq(address(uint160(uint256(vm.load(PROXY, IMPL_SLOT)))), address(impl));
    }

    // ---------------------------------------------------------------- storage pokes (fork)

    function _building(uint256 planetId, Building b, uint16 level) internal {
        bytes32 outer = keccak256(abi.encode(planetId, uint256(6)));
        vm.store(PROXY, keccak256(abi.encode(uint256(uint8(b)), outer)), bytes32(uint256(level)));
    }

    function _newPlayer(string memory label) internal returns (address who, uint256 planetId) {
        who = makeAddr(label);
        uint256 price = GAME.startPrice();
        vm.deal(who, 1 ether);
        vm.prank(who);
        planetId = GAME.startPlanet{value: price}();
    }

    function _migrationPayload(address who, uint256 planetId) internal view returns (bytes memory) {
        M.MigrationPlanetState[] memory planets = new M.MigrationPlanetState[](1);
        planets[0].planetId = planetId;
        planets[0].galaxy = 9;
        planets[0].system = 499;
        planets[0].position = 15;
        planets[0].fields = 160;
        planets[0].temperature = 20;
        planets[0].lastSettledAt = uint64(block.timestamp);
        M.MigrationPlayerState memory state;
        state.player = who;
        state.homePlanetId = planetId;
        state.planets = planets;
        return abi.encode(state);
    }

    function _claimMigration(address who, uint256 planetId) internal {
        address settlement = address(uint160(uint256(vm.load(PROXY, bytes32(uint256(51))))));
        uint256 price = GAME.startPrice();
        vm.deal(settlement, price);
        vm.prank(settlement);
        GAME.importMigratedState{value: price}(who, _migrationPayload(who, planetId));
    }

    /// A fresh single-planet player with a Stabilizer and 10,000,000 metal injected through the Rift.
    function _lockedSinglePlanet(string memory label)
        internal
        returns (address who, uint256 planetId, uint128 amount)
    {
        (who, planetId) = _newPlayer(label);
        _building(planetId, Building.InterdimensionalRiftStabilizer, 1);
        amount = 10_000_000;
        IERC20 metal = _metal();
        vm.prank(TREASURY);
        assertTrue(metal.transfer(who, amount));
        vm.startPrank(who);
        metal.approve(PROXY, amount);
        GAME.depositMarketResource(planetId, Resource.Metal, amount);
        RIFT.startRiftExtraction(planetId, Resource.Metal, amount);
        vm.stopPrank();
    }

    // ------------------------------------------- L2: migration discard and another importer

    function testLiveDiscardHandsALiveRiftLockToTheNextImporterOfTheId() external {
        if (!_forkAt(PRE_AUDIT_FIX_BLOCK)) return;
        (address victim, uint256 planetId, uint128 amount) = _lockedSinglePlanet("rift-victim");
        uint256 lockedBefore = GAME.lockedWithdrawalResources().metal;

        // Live: the victim's migration claim deletes the planet but leaves the lock behind.
        _claimMigration(victim, 900_001);
        assertEq(GAME.planet(planetId).owner, address(0), "planet discarded");
        assertEq(RIFT.riftLockedResources(planetId).metal, amount, "lock orphaned");
        assertEq(GAME.lockedWithdrawalResources().metal, lockedBefore, "claim still reserved");

        // Any later signed state that reuses the id inherits the claim and is paid the tokens.
        address heir = makeAddr("rift-heir");
        _claimMigration(heir, planetId);
        vm.warp(block.timestamp + 28 days);
        vm.prank(heir);
        RIFT.finalizeRiftExtraction(planetId, Resource.Metal);
        assertEq(_metal().balanceOf(heir), amount, "heir paid the victim's tokens");
        assertEq(_metal().balanceOf(victim), 0);
    }

    function testUpgradedDiscardRefusesALiveRiftLock() external {
        if (!_fork()) return;
        _upgradeToBranch();
        (address victim, uint256 planetId, uint128 amount) = _lockedSinglePlanet("rift-victim");
        address settlement = address(uint160(uint256(vm.load(PROXY, bytes32(uint256(51))))));
        uint256 price = GAME.startPrice();
        vm.deal(settlement, price);
        bytes memory payload = _migrationPayload(victim, 900_001);
        vm.prank(settlement);
        vm.expectRevert(S.PlanetHasResources.selector);
        GAME.importMigratedState{value: price}(victim, payload);
        assertEq(GAME.planet(planetId).owner, victim);
        assertEq(RIFT.riftLockedResources(planetId).metal, amount);
    }

    // ------------------- M1/M2: Rift-admitted attackers must not loot ordinary resources

    bytes32 internal constant STAGED_BATTLE_SLOT = keccak256("veydrift.storage.staged-battle.v1");

    function _verdict(uint256 missionId) internal view returns (uint8) {
        bytes32 slot = keccak256(abi.encode(missionId, uint256(STAGED_BATTLE_SLOT) + 2));
        return uint8(uint256(vm.load(PROXY, slot)));
    }

    function _place(uint256 id, uint16 g, uint16 s, uint8 p) internal {
        S.Planet memory pl = GAME.planet(id);
        uint256 base = uint256(keccak256(abi.encode(id, uint256(4))));
        vm.store(
            PROXY,
            bytes32(base),
            bytes32(
                uint256(uint160(pl.owner)) | (uint256(g) << 160) | (uint256(s) << 176)
                    | (uint256(p) << 192) | (uint256(pl.fields) << 200)
                    | (uint256(uint16(pl.temperature)) << 216)
                    | (uint256(pl.metalMultiplierBps) << 232)
            )
        );
    }

    function _ships(uint256 planetId, Ship ship, uint32 n) internal {
        bytes32 outer = keccak256(abi.encode(planetId, uint256(22)));
        vm.store(PROXY, keccak256(abi.encode(uint256(uint8(ship)), outer)), bytes32(uint256(n)));
    }

    /// Fresh fork player with a Stabilizer and `deuterium` of injected fuel.
    function _fueled(string memory label, uint128 deuterium)
        internal
        returns (address who, uint256 planetId)
    {
        (who, planetId) = _newPlayer(label);
        _building(planetId, Building.InterdimensionalRiftStabilizer, 1);
        IERC20 deut = IERC20(GAME.resourceToken(Resource.Deuterium));
        vm.prank(TREASURY);
        assertTrue(deut.transfer(who, deuterium));
        vm.startPrank(who);
        deut.approve(PROXY, deuterium);
        GAME.depositMarketResource(planetId, Resource.Deuterium, deuterium);
        vm.stopPrank();
    }

    function _attack(address who, uint256 from, uint256 to, uint32 largeCargo)
        internal
        returns (uint256)
    {
        S.MissionShips memory ships;
        ships.largeCargo = largeCargo;
        S.Resources memory none;
        vm.prank(who);
        return GAME.launchFleetMission(from, to, S.FleetMissionType.Attack, ships, none, 0);
    }

    function _pastBashingLimitVerdict(bool upgraded) internal returns (uint8) {
        if (upgraded) _upgradeToBranch();
        (address raider, uint256 origin) = _fueled("raider", 1_000_000);
        (address owner, uint256 target,) = _lockedSinglePlanet("rift-owner");
        _ships(origin, Ship.LargeCargo, 1);
        bytes32 key = keccak256(abi.encode(raider, owner, target));
        vm.store(
            PROXY,
            keccak256(abi.encode(key, uint256(29))),
            bytes32(uint256(block.timestamp) | (uint256(6) << 64))
        );
        return _verdict(_attack(raider, origin, target, 1));
    }

    function testLivePastTheBashingLimitRiftAttackIsRecordedAsAnOpenRaid() external {
        if (!_forkAt(PRE_AUDIT_FIX_BLOCK)) return;
        assertEq(_pastBashingLimitVerdict(false), 1, "live: loots 50% of ordinary resources");
    }

    function testUpgradedPastTheBashingLimitRiftAttackRaidsOnlyTheLock() external {
        if (!_fork()) return;
        assertEq(_pastBashingLimitVerdict(true), 2);
    }

    /// Newbie target and newbie leader in one 1.5x band; a strong joiner in the leader's alliance.
    function _protectedJoin(bool upgraded) internal returns (bool joined) {
        if (upgraded) _upgradeToBranch();
        (, uint256 target,) = _lockedSinglePlanet("newbie");
        (address leader, uint256 leaderOrigin) = _fueled("leader", 1_000_000);
        (address joiner, uint256 joinerOrigin) = _fueled("joiner", 1_000_000);
        _place(target, 7, 300, 9);
        _place(leaderOrigin, 7, 301, 9);
        _place(joinerOrigin, 7, 300, 4);
        bytes32 outer = keccak256(abi.encode(joiner, uint256(20)));
        vm.store(
            PROXY,
            keccak256(abi.encode(uint256(uint8(Technology.IntergalacticResearchNetwork)), outer)),
            bytes32(uint256(3_000))
        );
        IAllianceFork alliance =
            IAllianceFork(address(uint160(uint256(vm.load(PROXY, bytes32(uint256(31)))))));
        vm.prank(leader);
        uint256 allianceId = alliance.createAlliance("RFTA", "Rift audit", "");
        vm.prank(leader);
        alliance.inviteMember(allianceId, joiner);
        vm.prank(joiner);
        alliance.acceptInvite(allianceId);
        _ships(leaderOrigin, Ship.LargeCargo, 1);
        uint256 attackId = _attack(leader, leaderOrigin, target, 1);
        assertEq(_verdict(attackId), 1, "the newbie leader's raid is open");
        _ships(joinerOrigin, Ship.LargeCargo, 40);
        S.MissionShips memory ships;
        ships.largeCargo = 40;
        S.Resources memory none;
        vm.prank(joiner);
        (joined,) = PROXY.call(
            abi.encodeCall(GAME.joinAttackMission, (joinerOrigin, attackId, target, ships, none))
        );
    }

    function testLiveProtectedJoinerRidesANewbieLeadersOpenRaid() external {
        if (!_forkAt(PRE_AUDIT_FIX_BLOCK)) return;
        assertTrue(_protectedJoin(false), "live: the strong joiner shares the open raid");
    }

    function testUpgradedProtectedJoinerCannotRideAnOpenRaid() external {
        if (!_fork()) return;
        assertFalse(_protectedJoin(true));
    }

    // ---- H1 (fixed by #1958, live on Base until block 52,871,779): binding without consent

    function testPreConsentGameLetAnyoneBindARiftOwnerAndBlockTheFinalize() external {
        if (!_forkAt(PRE_CONSENT_BLOCK)) return;
        (address victim, uint256 planetId,) = _lockedSinglePlanet("rift-victim");
        address griefer = makeAddr("griefer");
        // Live one-step delegation: the griefer appoints the victim as its delegate.
        vm.prank(griefer);
        RIFT.setDelegate(victim);
        assertEq(RIFT.delegatorOf(victim), griefer, "victim now acts for the griefer");
        vm.warp(block.timestamp + 28 days);
        vm.prank(victim);
        vm.expectRevert(S.NotPlanetOwner.selector);
        RIFT.finalizeRiftExtraction(planetId, Resource.Metal);
        // Revoking does not help: the griefer re-binds before the victim's next transaction,
        // while the matured lock stays 100% raidable.
        vm.prank(victim);
        RIFT.revokeDelegate();
        vm.prank(griefer);
        RIFT.setDelegate(victim);
        vm.prank(victim);
        vm.expectRevert(S.NotPlanetOwner.selector);
        RIFT.finalizeRiftExtraction(planetId, Resource.Metal);
    }

    function testLiveBindingNowNeedsConsent() external {
        if (!_fork()) return;
        (address victim,,) = _lockedSinglePlanet("rift-victim");
        address griefer = makeAddr("griefer");
        vm.prank(griefer);
        RIFT.setDelegate(victim); // only a proposal on the current implementation
        assertEq(RIFT.delegatorOf(victim), address(0));
    }

    function testUpgradedBindingNeedsConsentAndAnOldBindingIsRevokedForGood() external {
        if (!_forkAt(PRE_CONSENT_BLOCK)) return;
        (address victim, uint256 planetId, uint128 amount) = _lockedSinglePlanet("rift-victim");
        address griefer = makeAddr("griefer");
        // A binding made before the upgrade survives it; the victim revokes it once.
        vm.prank(griefer);
        RIFT.setDelegate(victim);
        _upgradeToBranch();
        assertEq(RIFT.delegatorOf(victim), griefer);
        vm.prank(victim);
        RIFT.revokeDelegate();
        vm.prank(griefer);
        RIFT.setDelegate(victim); // only a proposal now
        assertEq(RIFT.delegatorOf(victim), address(0));
        vm.warp(block.timestamp + 28 days);
        vm.prank(victim);
        RIFT.finalizeRiftExtraction(planetId, Resource.Metal);
        assertEq(_metal().balanceOf(victim), amount);
    }

    // ---------------------------------- L1: satellites landing without a production settle

    function _starvedWithReadySatellites(string memory label)
        internal
        returns (address who, uint256 planetId)
    {
        (who, planetId) = _newPlayer(label);
        _building(planetId, Building.MetalMine, 20);
        _building(planetId, Building.CrystalMine, 18);
        _building(planetId, Building.DeuteriumSynthesizer, 15);
        _building(planetId, Building.MetalStorage, 20);
        _building(planetId, Building.CrystalStorage, 20);
        _building(planetId, Building.DeuteriumTank, 20);
        _building(planetId, Building.Shipyard, 12);
        _building(planetId, Building.NaniteFactory, 10);
        // 4M crystal + 1M deuterium for 2,000 satellites, injected through the Rift itself.
        _building(planetId, Building.InterdimensionalRiftStabilizer, 1);
        IERC20 crystal = IERC20(GAME.resourceToken(Resource.Crystal));
        IERC20 deuterium = IERC20(GAME.resourceToken(Resource.Deuterium));
        vm.startPrank(TREASURY);
        assertTrue(crystal.transfer(who, 4_000_000));
        assertTrue(deuterium.transfer(who, 1_000_000));
        vm.stopPrank();
        vm.startPrank(who);
        crystal.approve(PROXY, 4_000_000);
        deuterium.approve(PROXY, 1_000_000);
        GAME.depositMarketResource(planetId, Resource.Crystal, 4_000_000);
        GAME.depositMarketResource(planetId, Resource.Deuterium, 1_000_000);
        GAME.startShipProduction(planetId, Ship.SolarSatellite, 2_000);
        vm.stopPrank();
        vm.warp(GAME.shipQueue(planetId).readyAt + 10 days);
    }

    function _retroactiveMetal(bool upgraded) internal returns (uint256 credited, uint256 honest) {
        if (upgraded) _upgradeToBranch();
        (address who, uint256 planetId) = _starvedWithReadySatellites("starved");
        honest = GAME.previewResources(planetId).metal;
        vm.startPrank(who);
        GAME.finishShipProduction(planetId);
        GAME.collectResources(planetId);
        vm.stopPrank();
        credited = GAME.planet(planetId).resources.metal;
    }

    function testLiveFinishShipProductionCreditsSatelliteOutputRetroactively() external {
        if (!_forkAt(PRE_AUDIT_FIX_BLOCK)) return;
        (uint256 credited, uint256 honest) = _retroactiveMetal(false);
        emit log_named_uint("live: metal credited for 10 starved days", credited);
        emit log_named_uint("live: metal actually produced", honest);
        assertGt(credited, honest + 900_000, "retroactive satellite output on live code");
    }

    function testUpgradedFinishShipProductionCreditsOnlyTheElapsedOutput() external {
        if (!_fork()) return;
        (uint256 credited, uint256 honest) = _retroactiveMetal(true);
        assertEq(credited, honest);
    }

    // ----------- Low: Fusion upkeep capped at the synthesizer (demolish it for free fusion)

    /// Fusion 15 at Energy 8 alone powers Metal 20 and Crystal 18 on a planet with no
    /// synthesizer, holding 100,000 deuterium injected through the Rift. Returns the balance
    /// after ten hours.
    function _fusionWithoutSynthesizer(bool upgraded) internal returns (S.Resources memory) {
        if (upgraded) _upgradeToBranch();
        (address who, uint256 planetId) = _newPlayer("fusion");
        bytes32 technologies = keccak256(abi.encode(who, uint256(20)));
        vm.store(
            PROXY,
            keccak256(abi.encode(uint256(uint8(Technology.Energy)), technologies)),
            bytes32(uint256(8))
        );
        _building(planetId, Building.MetalMine, 20);
        _building(planetId, Building.CrystalMine, 18);
        _building(planetId, Building.FusionReactor, 15);
        _building(planetId, Building.MetalStorage, 10);
        _building(planetId, Building.CrystalStorage, 10);
        _building(planetId, Building.DeuteriumTank, 10);
        _building(planetId, Building.InterdimensionalRiftStabilizer, 1);
        IERC20 deuterium = IERC20(GAME.resourceToken(Resource.Deuterium));
        vm.prank(TREASURY);
        assertTrue(deuterium.transfer(who, 100_000));
        vm.startPrank(who);
        deuterium.approve(PROXY, 100_000);
        GAME.depositMarketResource(planetId, Resource.Deuterium, 100_000);
        vm.warp(block.timestamp + 10 hours);
        GAME.collectResources(planetId);
        vm.stopPrank();
        return GAME.planet(planetId).resources;
    }

    function testLiveFusionWithoutASynthesizerRunsForFree() external {
        if (!_forkAt(PRE_FUSION_FIX_BLOCK)) return;
        S.Resources memory balance = _fusionWithoutSynthesizer(false);
        emit log_named_uint("live: metal from ten hours of Fusion 15", balance.metal);
        assertEq(balance.metal, 500 + 40_360, "full fusion power");
        assertEq(balance.deuterium, 100_000, "the 627/h upkeep cost nothing");
    }

    function testUpgradedFusionWithoutASynthesizerBurnsItsUpkeep() external {
        if (!_fork()) return;
        S.Resources memory balance = _fusionWithoutSynthesizer(true);
        assertEq(balance.metal, 500 + 40_360);
        assertEq(balance.deuterium, 100_000 - 6_270);
    }

    // ------------- #155: live signed claims whose planet ids mainnet planets took since

    /// The six pending claims the live snapshot serves that could not settle: id 84 has its
    /// reservation, 579 and 581-584 never got one, and every id but 581 is owned by someone else.
    function _liveClaims()
        internal
        view
        returns (address[] memory players, bytes[] memory payloads, bytes[] memory signatures)
    {
        string memory
            json = vm.readFile(
            string.concat(vm.projectRoot(), "/test/audit/migration-id-collision-claims.json")
        );
        players = new address[](6);
        payloads = new bytes[](6);
        signatures = new bytes[](6);
        for (uint256 i = 0; i < 6; i++) {
            string memory row = string.concat(".claims[", vm.toString(i), "]");
            players[i] = vm.parseJsonAddress(json, string.concat(row, ".player"));
            payloads[i] = vm.parseJsonBytes(json, string.concat(row, ".statePayload"));
            signatures[i] = vm.parseJsonBytes(json, string.concat(row, ".signature"));
        }
    }

    /// The snapshot was signed by the pre-launch owner key; the 2026-10-20 owner rotation moved the
    /// state signer to the new owner without re-signing it, so on Base every one of these (and every
    /// other pending claim) now stops at `BadMigrationSignature` first. Tracked apart from #155:
    /// these replays put the snapshot's signer back on the fork to reach the id and reservation.
    function _acceptSnapshotSigner() internal {
        vm.prank(IOwnedFork(MIGRATION_SETTLEMENT).owner());
        IOwnedFork(MIGRATION_SETTLEMENT).setStateSigner(SNAPSHOT_SIGNER);
    }

    function _claimLive(address player, bytes memory payload, bytes memory signature)
        internal
        returns (bool ok, bytes memory result)
    {
        uint256 price = GAME.startPrice();
        vm.deal(player, price);
        vm.prank(player);
        (ok, result) = MIGRATION_SETTLEMENT.call{value: price}(
            abi.encodeWithSignature("claim(bytes,bytes)", payload, signature)
        );
    }

    function testLiveClaimsWhoseIdsWereTakenCannotSettle() external {
        if (!_fork()) return;
        (address[] memory players, bytes[] memory payloads, bytes[] memory signatures) =
            _liveClaims();
        (bool signedOk, bytes memory signedResult) =
            _claimLive(players[0], payloads[0], signatures[0]);
        assertFalse(signedOk);
        assertEq(bytes4(signedResult), bytes4(keccak256("BadMigrationSignature()")));
        _acceptSnapshotSigner();
        for (uint256 i = 0; i < players.length; i++) {
            (bool ok, bytes memory result) = _claimLive(players[i], payloads[i], signatures[i]);
            assertFalse(ok);
            bytes4 expected = i == 0
                ? S.InvalidId.selector
                : bytes4(keccak256("MigrationReservationMissing(address)"));
            assertEq(bytes4(result), expected);
        }
    }

    function testUpgradedClaimsWhoseIdsWereTakenSettleUnderFreshIds() external {
        if (!_fork()) return;
        (address[] memory players, bytes[] memory payloads, bytes[] memory signatures) =
            _liveClaims();
        _upgradeToBranch();
        _acceptSnapshotSigner();

        // The owner transaction that registers the five missing reservations, keyless.
        address owner = IOwnedFork(MIGRATION_SETTLEMENT).owner();
        vm.setEnv("UPGRADE_DRY_RUN_OWNER", vm.toString(owner));
        vm.setEnv("GAME_PROXY_ADDRESS", vm.toString(PROXY));
        new ImportMissingMigrationReservations().run();

        uint256 freshId = GAME.nextPlanetId();
        for (uint256 i = 0; i < players.length; i++) {
            M.MigrationPlayerState memory state = abi.decode(payloads[i], (M.MigrationPlayerState));
            assertEq(state.planets.length, 1);
            M.MigrationPlanetState memory signed = state.planets[0];
            address idOwner = GAME.planet(signed.planetId).owner;

            (bool ok,) = _claimLive(players[i], payloads[i], signatures[i]);
            assertTrue(ok, "claim settles");

            uint256 home = GAME.homePlanetOf(players[i]);
            if (idOwner == address(0)) {
                assertEq(home, signed.planetId, "a free id is kept");
            } else {
                assertEq(home, freshId++, "a taken id moves to the next fresh id");
                assertEq(GAME.planet(signed.planetId).owner, idOwner, "the id's owner keeps it");
            }
            S.Planet memory planet = GAME.planet(home);
            assertEq(planet.owner, players[i]);
            assertEq(planet.galaxy, signed.galaxy);
            assertEq(planet.system, signed.system);
            assertEq(planet.position, signed.position);
            assertEq(planet.fields, signed.fields);
            assertEq(GAME.planetCountOf(players[i]), 1);
            assertEq(GAME.buildingLevel(home, Building(0)), signed.buildingLevels[0]);
        }
        assertEq(freshId, GAME.nextPlanetId());
    }
}
