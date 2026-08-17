// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftFirstPlanetSettlementModule} from "../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftShipProductionModule} from "../src/VeydriftShipProductionModule.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {Defense, Ship} from "../src/libraries/VeydriftTypes.sol";

/// @notice Exact Base-mainnet regression for Illusive Man -> Karsa mission 23007.
contract KarsaCombatGasForkTest is Test {
    uint256 private constant INCIDENT_BLOCK = 50_105_577;
    uint256 private constant BASE_TRANSACTION_GAS_CAP = 1 << 24;
    uint256 private constant TRANSACTION_INTRINSIC_AND_CALLDATA_GAS = 25_000;
    uint256 private constant MISSION_ID = 23_007;
    uint256 private constant MAX_RESOLUTION_CALLS = 6;

    address private constant PROXY = 0xf397910F005151b09644228573a4353818D3755d;
    address private constant PROXY_ADMIN = 0xc81609E77b5ea79d0CdA9794b75B65D567535cb9;
    address private constant PROXY_ADMIN_OWNER = 0x4755D28078442cb7E7Ac2409868fb3Ff1B9fA73B;
    address private constant REFERRAL_SYSTEM = 0x3246Df19Fa850E27eAC5292232aC2a51bbB7b835;

    function testForkKarsaBattleResolvesBelowBaseTransactionGasCap() external {
        string memory rpc = vm.envOr("BASE_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc, INCIDENT_BLOCK);

        VeydriftGame game = VeydriftGame(PROXY);
        (VeydriftGameStorage.FleetMissionStatus statusBefore,,,,,,,,,,) =
            game.fleetMission(MISSION_ID);
        assertEq(uint8(statusBefore), uint8(VeydriftGameStorage.FleetMissionStatus.Outbound));
        assertEq(ProxyAdmin(PROXY_ADMIN).owner(), PROXY_ADMIN_OWNER);
        (bool usableBefore, bytes memory blockedReason) =
            PROXY.call(abi.encodeCall(VeydriftGame.requireNoPendingMoonAttackResolution, (41)));
        assertFalse(usableBefore);
        // The low-level revert payload is ABI-encoded with the four-byte selector first.
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(bytes4(blockedReason), VeydriftGameStorage.FleetMissionNotResolved.selector);

        _upgradeGame();

        uint256 executionGasCap = BASE_TRANSACTION_GAS_CAP - TRANSACTION_INTRINSIC_AND_CALLDATA_GAS;
        uint256 maxGasUsed;
        uint256 calls;
        VeydriftGameStorage.FleetMissionStatus statusAfter = statusBefore;
        while (
            statusAfter == VeydriftGameStorage.FleetMissionStatus.Outbound
                && calls < MAX_RESOLUTION_CALLS
        ) {
            uint256 gasBefore = gasleft();
            (bool resolved,) = PROXY.call{gas: executionGasCap}(
                abi.encodeCall(VeydriftGame.resolveFleetMission, (MISSION_ID))
            );
            uint256 gasUsed = gasBefore - gasleft();
            assertTrue(resolved, "bounded battle round exceeds Base transaction gas cap");
            assertLt(gasUsed, executionGasCap, "no transaction gas headroom");
            if (gasUsed > maxGasUsed) maxGasUsed = gasUsed;
            (statusAfter,,,,,,,,,,) = game.fleetMission(MISSION_ID);
            calls += 1;
        }

        assertTrue(statusAfter != VeydriftGameStorage.FleetMissionStatus.Outbound);
        (bool usableAfter,) =
            PROXY.call(abi.encodeCall(VeydriftGame.requireNoPendingMoonAttackResolution, (41)));
        assertTrue(usableAfter, "Karsa remains combat-locked after resolution");
        emit log_named_uint("mission 23007 resolution calls", calls);
        emit log_named_uint("mission 23007 max round gas", maxGasUsed);
    }

    function testForkKarsaBoundedBattleMatchesAtomicFinalStateAndLogs() external {
        string memory rpc = vm.envOr("BASE_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) return;

        vm.createSelectFork(rpc, INCIDENT_BLOCK);
        vm.recordLogs();
        (bool atomicResolved,) = PROXY.call{gas: 30_000_000}(
            abi.encodeCall(VeydriftGame.resolveFleetMission, (MISSION_ID))
        );
        assertTrue(atomicResolved, "atomic reference battle failed on fork");
        bytes32 atomicLogsHash = _logsHash(vm.getRecordedLogs());
        bytes32 atomicStateHash = _incidentStateHash();

        vm.createSelectFork(rpc, INCIDENT_BLOCK);
        _upgradeGame();
        vm.recordLogs();
        VeydriftGameStorage.FleetMissionStatus status =
        VeydriftGameStorage.FleetMissionStatus.Outbound;
        uint256 executionGasCap = BASE_TRANSACTION_GAS_CAP - TRANSACTION_INTRINSIC_AND_CALLDATA_GAS;
        for (uint256 calls = 0; status == VeydriftGameStorage.FleetMissionStatus.Outbound; calls++) {
            assertLt(calls, MAX_RESOLUTION_CALLS, "bounded battle did not terminate");
            (bool roundResolved,) = PROXY.call{gas: executionGasCap}(
                abi.encodeCall(VeydriftGame.resolveFleetMission, (MISSION_ID))
            );
            assertTrue(roundResolved, "bounded round failed");
            (status,,,,,,,,,,) = VeydriftGame(PROXY).fleetMission(MISSION_ID);
        }

        assertEq(_logsHash(vm.getRecordedLogs()), atomicLogsHash, "battle event sequence changed");
        assertEq(_incidentStateHash(), atomicStateHash, "battle final state changed");
    }

    function _upgradeGame() private {
        VeydriftCombatRapidfire rapidfire = new VeydriftCombatRapidfire();
        VeydriftCombatModule combatModule = new VeydriftCombatModule(address(rapidfire));
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftAttackProtectionModule attackProtectionModule = new VeydriftAttackProtectionModule();
        VeydriftColonizationModule colonizationModule =
            new VeydriftColonizationModule(address(new VeydriftShipProductionModule()));
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();
        VeydriftStateMigrationModule stateMigrationModule =
            new VeydriftStateMigrationModule(REFERRAL_SYSTEM);
        VeydriftFirstPlanetSettlementModule firstPlanetSettlementModule =
            new VeydriftFirstPlanetSettlementModule(REFERRAL_SYSTEM);
        VeydriftGame implementation = new VeydriftGame(
            PROXY_ADMIN_OWNER,
            address(firstPlanetSettlementModule),
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule),
            address(defenseHoldModule),
            address(stateMigrationModule)
        );

        vm.prank(PROXY_ADMIN_OWNER);
        ProxyAdmin(PROXY_ADMIN)
            .upgradeAndCall(ITransparentUpgradeableProxy(PROXY), address(implementation), "");
    }

    function _incidentStateHash() private view returns (bytes32 stateHash) {
        VeydriftGame game = VeydriftGame(PROXY);
        (bool missionOk, bytes memory missionData) =
            PROXY.staticcall(abi.encodeCall(VeydriftGame.fleetMission, (MISSION_ID)));
        (bool debrisOk, bytes memory debrisData) =
            PROXY.staticcall(abi.encodeWithSelector(VeydriftGame.debrisField.selector, 41));
        assertTrue(missionOk && debrisOk);
        stateHash = keccak256(abi.encode(missionData, debrisData, game.planet(41)));
        for (uint8 shipId = 0; shipId <= uint8(Ship.Pathfinder); shipId++) {
            stateHash = keccak256(abi.encode(stateHash, game.shipCount(41, Ship(shipId))));
        }
        for (uint8 defenseId = 0; defenseId <= uint8(Defense.LargeShieldDome); defenseId++) {
            stateHash = keccak256(abi.encode(stateHash, game.defenseCount(41, Defense(defenseId))));
        }
    }

    function _logsHash(Vm.Log[] memory logs) private pure returns (bytes32 logsHash) {
        for (uint256 i = 0; i < logs.length; i++) {
            logsHash =
                keccak256(abi.encode(logsHash, logs[i].emitter, logs[i].topics, logs[i].data));
        }
    }
}
