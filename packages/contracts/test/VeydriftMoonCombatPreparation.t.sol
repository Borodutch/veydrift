// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {VeydriftMoonSystem} from "../src/VeydriftMoonSystem.sol";
import {VeydriftGameStorage as G} from "../src/VeydriftGameStorage.sol";
import {
    VeydriftMoonDefenseBacklog as Backlog
} from "../src/libraries/VeydriftMoonDefenseBacklog.sol";
import {VeydriftMoonShipBacklog} from "../src/libraries/VeydriftMoonShipBacklog.sol";
import {Defense, MoonBuilding, Ship} from "../src/libraries/VeydriftTypes.sol";
import {ProductionBatchTransactionProbe} from "./ProductionBatchTransactionProbe.sol";

contract MoonPreparationGame {
    address public player;
    bool public pending;
    bool public cleared;
    mapping(uint256 => mapping(Ship => uint32)) public moonShipCount;

    constructor(address player_) {
        player = player_;
    }

    function planet(uint256) external view returns (G.Planet memory p) {
        p.owner = player;
    }

    function effectivePlayer(address actor) external pure returns (address) {
        return actor;
    }

    function gamePaused() external pure returns (bool) {
        return false;
    }

    function setPending(bool value) external {
        pending = value;
    }

    function requireNoPendingMoonAttackResolution(uint256) external view {
        require(!pending, "pending");
    }

    function setMoonShipCount(uint256 id, Ship ship, uint32 total) external {
        moonShipCount[id][ship] = total;
    }

    function clearMoonState(uint256) external {
        cleared = true;
    }

    function prepare(VeydriftMoonSystem moon, uint256 id, uint64 impact, uint256 work)
        external
        returns (bool)
    {
        return moon.prepareMoonCombat(id, impact, work);
    }

    function release(VeydriftMoonSystem moon, uint256 id) external {
        moon.releaseMoonCombat(id);
    }

    function applyChanges(VeydriftMoonSystem moon, uint256 changes, bool repair) external {
        moon.applyMoonCombatDefenseChanges(1, changes, repair);
    }

    function destruction(VeydriftMoonSystem moon) external returns (uint256 id) {
        (id,) = moon.requestMoonDestructionFromBattle(7, 1, player, 100000);
    }
}

contract MoonPreparationRandomness {
    function requestRandomness(bytes32) external pure returns (uint256) {
        return 1;
    }

    function consumeRandomness(uint256, bytes32) external pure returns (uint256) {
        return 0;
    }
}

contract MoonPreparationHarness is VeydriftMoonSystem {
    constructor(address game_, address randomness_) VeydriftMoonSystem(game_, randomness_) {}

    function seedDefenses(uint256 total, uint64 firstReady) external {
        for (uint256 i; i < total; ++i) {
            Backlog.enqueue(
                moonDefenseQueues, 1, Defense(i % 6), 1, 1, firstReady - 1, G.Resources(1, 2, 3)
            );
        }
    }

    function seedBuilding(uint64 ready) external {
        moonBuildingConstructions[1] =
            MoonBuildingConstruction(true, MoonBuilding.LunarBase, 1, ready, G.Resources(1, 2, 3));
    }

    function seedShips() external {
        for (uint8 i; i < 17; ++i) {
            VeydriftMoonShipBacklog.enqueue(
                1, Ship(i % 14), 1, 99, G.Resources(1, 1, 1), G.Resources(1, 1, 1), 7200
            );
        }
    }
}

contract VeydriftMoonCombatPreparationTest is Test {
    MoonPreparationGame game;
    MoonPreparationHarness moon;

    function setUp() public {
        vm.warp(1000);
        game = new MoonPreparationGame(address(this));
        MoonPreparationRandomness randomness = new MoonPreparationRandomness();
        MoonPreparationHarness implementation =
            new MoonPreparationHarness(address(game), address(randomness));
        moon = MoonPreparationHarness(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(
                        VeydriftMoonSystem.initialize,
                        (address(game), address(randomness), address(this))
                    )
                )
            )
        );
        moon.createMoon(1);
    }

    function testByImpactFrozenAcrossWarpsAndRepairThenRelease() public {
        moon.seedDefenses(12, 100);
        moon.seedBuilding(104);
        assertFalse(game.prepare(moon, 1, 105, 1));
        assertEq(moon.moonBuildingLevel(1, MoonBuilding.LunarBase), 1);
        vm.expectRevert(abi.encodeWithSelector(Backlog.MoonCombatNotPrepared.selector, 1));
        moon.moonDefensePacked(1);
        _assertFrozen();
        for (uint256 i; i < 40; ++i) {
            vm.warp(block.timestamp + 100);
            if (game.prepare(moon, 1, 105, 1)) break;
            assertLt(i, 39);
        }
        uint256 expected;
        for (uint256 i; i < 6; ++i) {
            expected |= uint256(1) << (32 * i);
        }
        for (uint256 i; i < 8; ++i) {
            vm.warp(block.timestamp + 1 days);
            assertEq(moon.moonDefensePacked(1), expected);
        }
        assertEq(moon.activeMoonDefenseQueue(1).readyAt, 106);
        Backlog.Entry[] memory remaining = moon.moonDefenseQueueBacklog(1);
        assertEq(remaining.length, 5);
        for (uint256 i; i < remaining.length; ++i) {
            assertEq(remaining[i].readyAt, 107 + i);
        }
        game.applyChanges(moon, 1, false);
        assertEq(moon.moonDefensePacked(1), expected - 1);
        game.applyChanges(moon, 1, true);
        assertEq(moon.moonDefensePacked(1), expected);
        _assertFrozen();
        game.release(moon, 1);
        moon.finishMoonDefenseProduction(1);
        for (uint8 i; i < 6; ++i) {
            assertEq(moon.moonDefenseCount(1, Defense(i)), 2);
        }
        game.release(moon, 1); // idempotent
        assertTrue(game.prepare(moon, 1, uint64(block.timestamp), 4));
        game.release(moon, 1);
    }

    function _assertFrozen() private {
        vm.expectRevert(abi.encodeWithSelector(Backlog.MoonCombatFrozen.selector, 1));
        moon.finishMoonDefenseProduction(1);
        vm.expectRevert(abi.encodeWithSelector(Backlog.MoonCombatFrozen.selector, 1));
        moon.finishMoonBuildingUpgrade(1);
        vm.expectRevert(abi.encodeWithSelector(Backlog.MoonCombatFrozen.selector, 1));
        moon.setMoonDefenseCount(1, Defense.RocketLauncher, 50);
    }

    function testFutureBuildingNotSettledByLossOrRepairAndLegacyStillSettles() public {
        moon.seedBuilding(106);
        moon.seedDefenses(12, 100);
        assertTrue(game.prepare(moon, 1, 105, 64));
        game.applyChanges(moon, 1, false);
        game.applyChanges(moon, 1, true);
        assertEq(moon.moonBuildingLevel(1, MoonBuilding.LunarBase), 0);
        assertEq(moon.moonDefenseCount(1, Defense.RocketLauncher), 1);
        game.release(moon, 1);
        game.applyChanges(moon, 0, false);
        assertEq(moon.moonBuildingLevel(1, MoonBuilding.LunarBase), 1);
        assertEq(moon.moonDefenseCount(1, Defense.RocketLauncher), 2);
    }

    function testPendingDestructionBlockedBeforeAndDuringFreezeThenRelease() public {
        uint256 outcome = game.destruction(moon);
        game.setPending(true);
        vm.expectRevert(bytes("pending"));
        moon.finalizeMoonDestruction(outcome);
        vm.expectRevert(bytes("pending"));
        moon.finishMoonDefenseProduction(1); // no ship queue at all
        assertTrue(game.prepare(moon, 1, 105, 4));
        game.setPending(false); // local namespace alone still protects inventory
        vm.expectRevert(abi.encodeWithSelector(Backlog.MoonCombatFrozen.selector, 1));
        moon.finalizeMoonDestruction(outcome);
        assertTrue(moon.moon(1).exists);
        assertFalse(game.cleared());
        game.release(moon, 1);
        (bool destroyed,) = moon.finalizeMoonDestruction(outcome);
        assertTrue(destroyed);
        assertFalse(moon.moon(1).exists);
        assertTrue(game.cleared());
    }

    function testAuthorizationCutoffAndIncompleteRelease() public {
        vm.expectRevert(abi.encodeWithSelector(VeydriftMoonSystem.NotOwner.selector, address(this)));
        moon.prepareMoonCombat(1, 100, 1);
        vm.expectRevert(abi.encodeWithSelector(VeydriftMoonSystem.NotOwner.selector, address(this)));
        moon.releaseMoonCombat(1);
        vm.expectRevert(Backlog.InvalidWorkBudget.selector);
        game.prepare(moon, 1, 100, 0);
        assertFalse(game.prepare(moon, 1, 100, 1));
        vm.expectRevert(Backlog.MoonCombatImpactChanged.selector);
        game.prepare(moon, 1, 101, 1);
        vm.expectRevert(abi.encodeWithSelector(Backlog.MoonCombatNotPrepared.selector, 1));
        game.release(moon, 1);
        vm.expectRevert(abi.encodeWithSelector(Backlog.MoonCombatNotPrepared.selector, 1));
        game.applyChanges(moon, 1, false);
        assertTrue(game.prepare(moon, 1, 100, 1));
        game.release(moon, 1);
    }

    /// forge-config: default.isolate = true
    function testColdBoundedLongBacklogAndMaximumShipLane() public {
        ProductionBatchTransactionProbe probe = new ProductionBatchTransactionProbe();
        probe.write(1);
        (uint256 storageGas, uint256 transientValue) = probe.write(2);
        assertGe(storageGas, 5000, "isolate required");
        assertEq(transientValue, 0, "real transaction boundary required");
        moon.seedDefenses(1024, 100);
        moon.seedShips();
        uint256 maximum;
        bool complete;
        uint256 calls;
        while (!complete && calls < 50) {
            uint256 beforeGas = gasleft();
            complete = game.prepare(moon, 1, 611, 64);
            uint256 used = beforeGas - gasleft();
            if (used > maximum) maximum = used;
            assertLt(used, 15_000_000);
            ++calls;
            vm.warp(block.timestamp + 1000);
        }
        emit log_named_uint(
            "max cold Moon preparation call gas (64 work + capped17 ships)", maximum
        );
        assertTrue(complete);
        assertGt(calls, 16);
        assertEq(moon.moonDefenseQueueBacklog(1).length, 511);
        assertEq(moon.activeMoonDefenseQueue(1).readyAt, 612);
        assertFalse(moon.activeMoonShipQueue(1).active);
        for (uint8 i; i < 14; ++i) {
            assertEq(game.moonShipCount(1, Ship(i)), i < 3 ? 2 : 1);
        }
        uint256 releaseGasBefore = gasleft();
        game.release(moon, 1);
        assertLt(releaseGasBefore - gasleft(), 100_000);
    }

    function testAllDueAndAllFutureBacklogs() public {
        moon.seedDefenses(90, 100);
        assertTrue(game.prepare(moon, 1, 99, 2));
        assertEq(moon.moonDefensePacked(1), 0);
        assertEq(moon.moonDefenseQueueBacklog(1).length, 89);
        game.release(moon, 1);
        bool complete;
        for (uint256 i; i < 40 && !complete; ++i) {
            complete = game.prepare(moon, 1, 189, 7);
            vm.warp(block.timestamp + 1 days);
        }
        assertTrue(complete);
        assertFalse(moon.activeMoonDefenseQueue(1).active);
        assertEq(moon.moonDefenseQueueBacklog(1).length, 0);
        for (uint8 i; i < 6; ++i) {
            assertEq(moon.moonDefenseCount(1, Defense(i)), 15);
        }
        game.release(moon, 1);
    }
}
