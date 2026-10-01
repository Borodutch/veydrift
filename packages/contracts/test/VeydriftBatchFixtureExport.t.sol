// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    TransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {VeydriftCombatReferenceParityTest} from "./VeydriftCombatReferenceParity.t.sol";
import {VeydriftCombatReferenceSimulator} from "./support/VeydriftCombatReferenceSimulator.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {
    Ship,
    Technology,
    MissionResolutionItem,
    MissionResolutionOutcome
} from "../src/libraries/VeydriftTypes.sol";

import {VeydriftAntiRaidPrimitives} from "../src/libraries/VeydriftAntiRaidPrimitives.sol";
import {VeydriftBodyAttackWindow} from "../src/libraries/VeydriftBodyAttackWindow.sol";
import {VeydriftCatalog} from "../src/libraries/VeydriftCatalog.sol";
import {VeydriftDefenseHoldStorage} from "../src/libraries/VeydriftDefenseHoldStorage.sol";
import {VeydriftDependencies} from "../src/libraries/VeydriftDependencies.sol";
import {VeydriftFleetFuel} from "../src/libraries/VeydriftFleetFuel.sol";
import {VeydriftFormulas} from "../src/libraries/VeydriftFormulas.sol";
import {VeydriftMoonDefenseBacklog} from "../src/libraries/VeydriftMoonDefenseBacklog.sol";
import {VeydriftMoonDefenseProduction} from "../src/libraries/VeydriftMoonDefenseProduction.sol";
import {VeydriftMoonGateShips} from "../src/libraries/VeydriftMoonGateShips.sol";
import {VeydriftMoonIncarnation} from "../src/libraries/VeydriftMoonIncarnation.sol";
import {VeydriftMoonMath} from "../src/libraries/VeydriftMoonMath.sol";
import {VeydriftMoonProductionBatch} from "../src/libraries/VeydriftMoonProductionBatch.sol";
import {VeydriftMoonShipBacklog} from "../src/libraries/VeydriftMoonShipBacklog.sol";
import {VeydriftMoonShipDependencies} from "../src/libraries/VeydriftMoonShipDependencies.sol";
import {VeydriftMoonShipProduction} from "../src/libraries/VeydriftMoonShipProduction.sol";
import {VeydriftRaidStorage} from "../src/libraries/VeydriftRaidStorage.sol";
import {VeydriftReserveRelease} from "../src/libraries/VeydriftReserveRelease.sol";

/// Synthetic genesis only: no fork, broadcast, credentials, or production state.
/// Existing reference fixture cheatcodes seed resources/ships/technology/coordinates/randomness.
/// All Game/modules/proxy constructors and mission launch/recall/resolution are real.
contract VeydriftBatchFixtureExportTest is VeydriftCombatReferenceParityTest {
    address private implementation;

    function _newGame(address owner) internal override returns (VeydriftGame) {
        implementation = address(super._newGame(owner));
        return VeydriftGame(
            payable(address(
                    new TransparentUpgradeableProxy(
                        implementation, owner, abi.encodeCall(VeydriftGame.initialize, (owner))
                    )
                ))
        );
    }

    function _touchCreatedChildren(address creator) private {
        uint64 nonce = vm.getNonce(creator);
        for (uint256 n = 1; n < nonce; ++n) {
            address child = vm.computeCreateAddress(creator, n);
            if (child.code.length == 0) continue;
            vm.etch(child, child.code);
            _touchCreatedChildren(child);
        }
    }

    function testExportMixedProxyFixture() external {
        // Opt-in avoids writing fixture artifacts during ordinary test runs.
        if (!vm.envOr("VEY918_EXPORT_FIXTURE", false)) return;
        vm.chainId(8453);
        VeydriftCombatReferenceSimulator.BattleInput memory fixture;
        fixture.attackerShips[uint8(Ship.Battlecruiser)] = 10;
        fixture.defenderShips[uint8(Ship.HeavyFighter)] = 100;
        fixture.counterplayShips[uint8(Ship.Battleship)] = 1;
        LaunchedBattle memory battle = _launchFixtureAttack(fixture);
        (, uint64 arrivalAt,,) = _fleetMission(battle.missionId);

        // Two disjoint cheap recalled transports: no battle-body chronology dependencies.
        uint256[] memory returnIds = new uint256[](2);
        uint256[] memory homeIds = new uint256[](2);
        for (uint256 i; i < 2; ++i) {
            address owner = address(uint160(0x91800 + i));
            vm.deal(owner, 1 ether);
            vm.prank(owner);
            uint256 home = game.startPlanet{value: 0.05 ether}();
            homeIds[i] = home;
            _setPlanetCoordinates(home, 2, uint16(100 + i), 8);
            address awayOwner = address(uint160(0x91900 + i));
            vm.deal(awayOwner, 1 ether);
            vm.prank(awayOwner);
            uint256 away = game.startPlanet{value: 0.05 ether}();
            _setPlanetCoordinates(away, 2, uint16(100 + i), 9);
            // Test-only ownership seed for a same-owner transport destination.
            bytes32 slot = keccak256(abi.encode(away, uint256(4)));
            vm.store(
                address(game),
                slot,
                bytes32(
                    (uint256(vm.load(address(game), slot)) & ~uint256(type(uint160).max))
                        | uint256(uint160(owner))
                )
            );
            _setResources(home, 100_000_000, 100_000_000, 100_000_000);
            _setShipCount(home, Ship.SmallCargo, 1);
            _setTechnologyLevel(owner, Technology.Computer, 10);
            VeydriftGameStorage.MissionShips memory ships;
            ships.smallCargo = 1;
            vm.prank(owner);
            returnIds[i] = game.launchFleetMission(
                home,
                away,
                VeydriftGameStorage.FleetMissionType.Transport,
                ships,
                VeydriftGameStorage.Resources(1, 2, 3),
                0
            );
            vm.prank(owner);
            game.recallFleetMission(returnIds[i]);
            (VeydriftGameStorage.FleetMissionStatus status,, uint64 returnAt,) =
                _fleetMission(returnIds[i]);
            assertEq(uint8(status), uint8(VeydriftGameStorage.FleetMissionStatus.Recalled));
            assertLe(returnAt, arrivalAt);
        }
        vm.warp(arrivalAt);
        _fulfillAttackBattleRandomness(battle.missionId, 32);
        assertEq(
            address(
                uint160(
                    uint256(
                        vm.load(
                            address(game),
                            bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
                        )
                    )
                )
            ),
            implementation
        );

        string memory key = "fixture";
        vm.serializeAddress(key, "game", address(game));
        vm.serializeAddress(key, "implementation", implementation);
        vm.serializeUint(key, "timestamp", block.timestamp);
        vm.serializeUint(key, "battleId", battle.missionId);
        vm.serializeUint(key, "counterplayId", battle.counterplayMissionId);
        vm.serializeUint(key, "origin", battle.originPlanetId);
        vm.serializeUint(key, "target", battle.targetPlanetId);
        vm.serializeUint(key, "counterplayOrigin", battle.counterplayOriginPlanetId);
        vm.serializeUint(key, "returnIds", returnIds);
        vm.serializeUint(key, "homeIds", homeIds);
        // Forge predeploys linked libraries before the test state journal. Touch their exact
        // existing runtime so dumpState includes them (no relocation or invented pointers).
        vm.etch(address(VeydriftAntiRaidPrimitives), address(VeydriftAntiRaidPrimitives).code);
        vm.etch(address(VeydriftBodyAttackWindow), address(VeydriftBodyAttackWindow).code);
        vm.etch(address(VeydriftCatalog), address(VeydriftCatalog).code);
        vm.etch(address(VeydriftDefenseHoldStorage), address(VeydriftDefenseHoldStorage).code);
        vm.etch(address(VeydriftDependencies), address(VeydriftDependencies).code);
        vm.etch(address(VeydriftFleetFuel), address(VeydriftFleetFuel).code);
        vm.etch(address(VeydriftFormulas), address(VeydriftFormulas).code);
        vm.etch(address(VeydriftMoonDefenseBacklog), address(VeydriftMoonDefenseBacklog).code);
        vm.etch(address(VeydriftMoonDefenseProduction), address(VeydriftMoonDefenseProduction).code);
        vm.etch(address(VeydriftMoonGateShips), address(VeydriftMoonGateShips).code);
        vm.etch(address(VeydriftMoonIncarnation), address(VeydriftMoonIncarnation).code);
        vm.etch(address(VeydriftMoonMath), address(VeydriftMoonMath).code);
        vm.etch(address(VeydriftMoonProductionBatch), address(VeydriftMoonProductionBatch).code);
        vm.etch(address(VeydriftMoonShipBacklog), address(VeydriftMoonShipBacklog).code);
        vm.etch(address(VeydriftMoonShipDependencies), address(VeydriftMoonShipDependencies).code);
        vm.etch(address(VeydriftMoonShipProduction), address(VeydriftMoonShipProduction).code);
        vm.etch(address(VeydriftRaidStorage), address(VeydriftRaidStorage).code);
        vm.etch(address(VeydriftReserveRelease), address(VeydriftReserveRelease).code);
        // dumpState exports journal-touched accounts, not every setup-created account.
        // Enumerate actual CREATE addresses/nonces recursively; copy code to itself so unused
        // modules (combat, return, rapidfire, etc.) are included before their first invocation.
        _touchCreatedChildren(address(this));
        vm.dumpState("manifests/vey918-mixed-alloc.json");

        // Resolve a snapshot continuation and compare the real battle to the independent reference.
        // The exported allocation above remains PRE-batch; these checks supply expected outputs.
        vm.recordLogs();
        MissionResolutionItem[] memory items = new MissionResolutionItem[](3);
        items[0] = MissionResolutionItem(returnIds[0], 1);
        items[1] = MissionResolutionItem(returnIds[1], 1);
        items[2] = MissionResolutionItem(battle.missionId, 0);
        (MissionResolutionOutcome[] memory outcomes,) =
            game.resolveFleetMissionBatch{gas: 16_500_000}(items);
        assertEq(uint8(outcomes[0]), uint8(MissionResolutionOutcome.Settled));
        assertEq(uint8(outcomes[1]), uint8(MissionResolutionOutcome.Settled));
        for (uint256 n; n < 10; ++n) {
            (VeydriftGameStorage.FleetMissionStatus status,,,) = _fleetMission(battle.missionId);
            if (status != VeydriftGameStorage.FleetMissionStatus.Outbound) break;
            game.resolveFleetMission(battle.missionId);
        }
        ActualBattle memory actual = _actualBattleFromLogs(vm.getRecordedLogs(), battle.missionId);
        assertTrue(actual.battleFound && actual.lossesFound && actual.debrisFound);
        fixture.seed = actual.seed;
        VeydriftCombatReferenceSimulator.BattleResult memory expected =
            VeydriftCombatReferenceSimulator.run(fixture);
        assertEq(uint8(actual.outcome), uint8(expected.outcome));
        assertEq(actual.rounds, expected.rounds);
        assertEq(
            abi.encode(actual.attackerLosses, actual.defenderLosses, actual.debris),
            abi.encode(expected.attackerLosses, expected.defenderLosses, expected.debris)
        );
        vm.serializeBytes(key, "expectedBattle", abi.encode(expected));
        vm.serializeUint(key, "seed", actual.seed);
        vm.serializeUint(key, "outcome", uint256(uint8(expected.outcome)));
        vm.serializeUint(key, "rounds", uint256(expected.rounds));
        _finishMissionReturnIfNeeded(battle.missionId);
        _finishMissionReturnIfNeeded(battle.counterplayMissionId);
        for (uint8 i; i < 16; ++i) {
            assertEq(game.shipCount(battle.originPlanetId, Ship(i)), expected.attackerShips[i]);
            assertEq(game.shipCount(battle.targetPlanetId, Ship(i)), expected.defenderShips[i]);
            assertEq(
                game.shipCount(battle.counterplayOriginPlanetId, Ship(i)),
                expected.counterplayShips[i]
            );
        }
        for (uint256 i; i < 2; ++i) {
            assertEq(game.shipCount(homeIds[i], Ship.SmallCargo), 1);
        }
        string memory json = vm.serializeString(
            key,
            "scope",
            "synthetic full Game/Transparent proxy counterplay + two cheap returns; fixture tokens, seeded setup; no Base fee claim"
        );
        vm.writeJson(json, "manifests/vey918-mixed-meta.json");
    }
}
