// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Vm} from "forge-std/Vm.sol";
import {VeydriftMoonSystemTestBase} from "./VeydriftMoonSystem.t.sol";
import {ProductionBatchTransactionProbe} from "./ProductionBatchTransactionProbe.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftGameStorage as G} from "../src/VeydriftGameStorage.sol";
import {Ship, Technology} from "../src/libraries/VeydriftTypes.sol";

/// @notice Full production proxy graph; no adapted gameplay facade or omitted mobile types.
contract VeydriftConservedProxyGasTest is VeydriftMoonSystemTestBase {
    uint256 private constant LIMIT = 15_000_000;
    bytes32 private constant MEMBER =
        keccak256("CombatMemberSnapshot(uint256,uint256,address,uint8,uint8,uint32)");

    function _tech(address owner_, uint16 level) private {
        _setTechnologyLevel(owner_, Technology.Weapons, level);
        _setTechnologyLevel(owner_, Technology.Shielding, level);
        _setTechnologyLevel(owner_, Technology.Armor, level);
    }

    function _manifest(uint256 id) private {
        uint256 base = uint256(keccak256(abi.encode(id, uint256(24))));
        uint256 first;
        uint256 second;
        for (uint256 i; i < 8; ++i) {
            first |= uint256(1000) << (32 * i);
        }
        for (uint256 i; i < 6; ++i) {
            second |= uint256(1000) << (32 * i);
        }
        vm.store(address(game), bytes32(base + 7), bytes32(first));
        vm.store(address(game), bytes32(base + 8), bytes32(second));
    }

    function _seed() private returns (uint256 id, uint64 arrival) {
        game = VeydriftGame(
            address(
                new ERC1967Proxy(address(game), abi.encodeCall(VeydriftGame.initialize, (admin)))
            )
        );
        moons = new VeydriftMoonSystem(address(game), address(randomness));
        metalToken.mint(address(game), RESERVE_FUNDING);
        crystalToken.mint(address(game), RESERVE_FUNDING);
        deuteriumToken.mint(address(game), RESERVE_FUNDING);
        vm.startPrank(admin);
        game.setResourceTokens(address(metalToken), address(crystalToken), address(deuteriumToken));
        game.setMoonSystem(address(moons));
        game.setRandomnessEngine(address(randomness));
        randomness.setRequesterAuthorization(address(game), true);
        randomness.setRequesterAuthorization(address(moons), true);
        vm.stopPrank();
        moons.setMoonChanceReporter(reporter);
        (uint256 origin, uint256 target, address defender) = _seedMoonAttackPlanets();
        _tech(player, 8);
        _tech(defender, 8);
        _setTechnologyLevel(player, Technology.IntergalacticResearchNetwork, 3000);
        _setTechnologyLevel(defender, Technology.IntergalacticResearchNetwork, 3000);
        _fundPlanet(origin, 100_000_000, 100_000_000, 100_000_000);
        _setShipCount(origin, Ship.Battleship, 1000);
        G.MissionShips memory ships;
        ships.battleship = 1000;
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
        uint64 back;
        (, arrival, back,) = _fleetMission(id);
        _manifest(id);
        bytes32 links = keccak256(abi.encode(id, uint256(32)));
        bytes32 holds = keccak256(abi.encode(target, uint256(48)));
        for (uint256 i; i < 13; ++i) {
            uint256 member = 100000 + i;
            address owner_ = address(SafeCast.toUint160(0x10000 + i));
            bool attacker = i < 6;
            _storeFleetMission(
                member,
                G.FleetMissionStatus.Outbound,
                attacker ? G.FleetMissionType.AcsAttack : G.FleetMissionType.DefenseHold,
                owner_,
                origin,
                target,
                uint64(block.timestamp),
                arrival,
                back
            );
            _manifest(member);
            _tech(owner_, SafeCast.toUint16(attacker ? 9 + i : 8 + i - 6));
            vm.store(address(game), keccak256(abi.encode(owner_, uint256(25))), bytes32(uint256(1)));
            if (attacker) {
                uint256 base = uint256(keccak256(abi.encode(member, uint256(24))));
                vm.store(address(game), bytes32(base + 9), bytes32(id));
                vm.store(
                    address(game),
                    bytes32(uint256(keccak256(abi.encode(links))) + i),
                    bytes32(member)
                );
            } else {
                uint256 n = i - 6;
                vm.store(
                    address(game),
                    bytes32(uint256(keccak256(abi.encode(holds))) + n),
                    bytes32(member)
                );
                vm.store(
                    address(game),
                    keccak256(abi.encode(member, uint256(50))),
                    bytes32(uint256(arrival + 1 days))
                );
                vm.store(
                    address(game),
                    keccak256(abi.encode(member, keccak256(abi.encode(target, uint256(49))))),
                    bytes32(n + 1)
                );
            }
        }
        vm.store(address(game), links, bytes32(uint256(6)));
        vm.store(address(game), holds, bytes32(uint256(7)));
        for (uint8 unit; unit < 16; ++unit) {
            _setShipCount(target, Ship(unit), 1000);
        }
        for (uint8 unit; unit < 8; ++unit) {
            vm.store(
                address(game),
                keccak256(abi.encode(uint256(unit), keccak256(abi.encode(target, uint256(19))))),
                bytes32(uint256(1000))
            );
        }
        _fulfillAttackBattleRandomness(id, 659);
    }

    /// Aggregate driver budget only; EVERY actual public transaction gets unchanged 15M.
    /// forge-config: default.isolate = true
    function testFullSevenTechAllTypesProductionProxyColdTransactions() public {
        ProductionBatchTransactionProbe probe = new ProductionBatchTransactionProbe();
        probe.write(1);
        (uint256 storageGas, uint256 transientValue) = probe.write(2);
        assertGe(storageGas, 5000, "committed storage transaction boundary required");
        assertEq(transientValue, 0, "transient storage must clear");
        (uint256 id, uint64 arrival) = _seed();
        vm.warp(arrival);
        vm.recordLogs();
        uint256 peak;
        uint256 calls;
        for (; calls < 20000; ++calls) {
            (G.FleetMissionStatus status,,,) = _fleetMission(id);
            if (status != G.FleetMissionStatus.Outbound) break;
            (,, uint256 beforeWork) = game.stagedBattleProgress(id);
            vm.cool(address(game));
            vm.cool(address(moons));
            vm.cool(address(randomness));
            uint256 beforeGas = gasleft();
            game.resolveFleetMission{gas: LIMIT}(id);
            uint256 used = beforeGas - gasleft();
            assertLe(used, LIMIT, "public transaction envelope exceeded");
            if (used > peak) peak = used;
            (uint8 phase,, uint256 afterWork) = game.stagedBattleProgress(id);
            assertTrue(
                afterWork > beforeWork || phase == 13, "successful call without durable progress"
            );
        }
        assertLt(calls, 20000, "full roster did not terminate");
        (uint8 finalPhase, uint8 rounds,) = game.stagedBattleProgress(id);
        assertEq(finalPhase, 13);
        assertGt(rounds, 0);
        assertLe(rounds, 6);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 enrolled;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == MEMBER) ++enrolled;
        }
        // recordLogs also observes reverted child-frame attempts near the gas reserve.
        // The committed snapshot counter, not those attempted logs, is authoritative.
        bytes32 battle = keccak256(abi.encode(id, keccak256("veydrift.storage.staged-battle.v1")));
        uint256 committed = uint256(vm.load(address(game), bytes32(uint256(battle) + 6)));
        assertEq(committed, 14 * 14 + 24, "all original roster dimensions must enroll");
        assertGe(enrolled, committed);
        emit log_named_uint("full production proxy calls", calls);
        emit log_named_uint("full production proxy peak call gas", peak);
    }
}
