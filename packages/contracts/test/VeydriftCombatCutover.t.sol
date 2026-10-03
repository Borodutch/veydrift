// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StagedLifecycleFacade, StagedFixedRandomness} from "./VeydriftStagedCombat.t.sol";
import {VeydriftGameStorage as G} from "../src/VeydriftGameStorage.sol";
import {VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftStagedCombatModule} from "../src/VeydriftStagedCombatModule.sol";
import {VeydriftCombatRaidModule} from "../src/VeydriftCombatRaidModule.sol";
import {
    VeydriftStagedBattleStorage as Store
} from "../src/libraries/VeydriftStagedBattleStorage.sol";
import {VeydriftStagedCohorts as Math} from "../src/libraries/VeydriftStagedCohorts.sol";
import {FrozenStagedCombatModuleV1} from "./support/FrozenStagedCombatModuleV1.sol";
import {FrozenStagedBattleStorageV1 as OldStore} from "./support/FrozenStagedBattleStorageV1.sol";
import {FrozenStagedCohortsV1} from "./support/FrozenStagedCohortsV1.sol";
import {Ship} from "../src/libraries/VeydriftTypes.sol";

contract CutoverFacade is StagedLifecycleFacade {
    constructor(address raid, address randomness)
        StagedLifecycleFacade(address(0), raid, randomness)
    {}

    function stepWith(address module) external returns (bool result) {
        (bool ok, bytes memory data) = module.delegatecall(
            abi.encodeWithSignature("resolveFleetMissionCombatRound(uint256)", 1)
        );
        if (!ok) assembly ("memory-safe") { revert(add(data, 32), mload(data)) }
        result = abi.decode(data, (bool));
    }

    function mathProgress() external view returns (uint8, uint8, uint8, uint256, uint256) {
        Store.Battle storage b = Store.battle(1);
        return (b.phase, b.round, uint8(b.math.phase), b.math.typeIndex, b.math.targetIndex);
    }

    function seedScoreScan() external {
        for (uint256 i; i < 20; ++i) {
            _ownedPlanetIds[address(0xA)].push(1000 + i);
        }
    }

    function oldMathStep() external {
        FrozenStagedCohortsV1.step(OldStore.battle(1).math, 1);
    }

    function version() external view returns (uint8) {
        return Store.battle(1).combatMathVersion;
    }

    function residentReapers(uint32 count) external {
        _setPlanetShipCount(99, Ship.Reaper, count);
    }

    // Compile-time old/new layout accesses to the SAME populated namespace.
    function checkLayout() external view returns (bool) {
        Store.Battle storage n = Store.battle(1);
        OldStore.Battle storage o = OldStore.battle(1);
        return n.phase == o.phase && n.round == o.round && n.workDone == o.workDone
            && n.math.workDone == o.math.workDone && uint8(n.math.phase) == uint8(o.math.phase)
            && n.members.length == o.members.length && n.missions.length == o.missions.length
            && n.returnSettlementAt == o.returnSettlementAt && n.scoreCursor == o.scoreCursor
            && n.scores[0] == o.scores[0] && n.scores[1] == o.scores[1]
            && n.enrolled[1] == o.enrolled[1] && n.capacities[1] == o.capacities[1];
    }
}

contract VeydriftCombatCutoverTest is Test {
    address private oldModule;
    address private newModule;
    address private raid;
    address private randomness;

    function setUp() public {
        vm.warp(10000);
        address rf = address(new VeydriftCombatRapidfire());
        oldModule = address(new FrozenStagedCombatModuleV1(rf));
        newModule = address(new VeydriftStagedCombatModule(rf));
        raid = address(new VeydriftCombatRaidModule());
        randomness = address(new StagedFixedRandomness());
    }

    function fixture(bool mixed) private returns (CutoverFacade h) {
        h = new CutoverFacade(raid, randomness);
        h.planet(99, address(0xD));
        h.tech(address(0xA), 3000);
        h.tech(address(0xD), 3000);
        G.FleetMission memory m;
        m.status = G.FleetMissionStatus.Outbound;
        m.missionType = G.FleetMissionType.Attack;
        m.owner = address(0xA);
        m.originPlanetId = 101;
        m.targetPlanetId = 99;
        m.departureAt = 100;
        m.arrivalAt = 10000;
        m.returnAt = 11000;
        m.randomnessRequestId = 919;
        if (mixed) {
            m.ships = G.MissionShips(
                100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100
            );
            h.resident(99, 99);
        } else {
            m.ships.reaper = 100;
            h.residentReapers(99);
        }
        h.seedMission(1, m);
        h.seedScoreScan();
    }

    function finish(CutoverFacade h, address module) private {
        for (uint256 i; i < 20000; ++i) {
            (uint8 phase,,,,) = h.mathProgress();
            if (phase == 13) return;
            h.stepWith{gas: 15_000_000}(module);
            assertTrue(h.checkLayout(), "old nested offsets changed");
        }
        fail("no terminal progress");
    }

    function same(CutoverFacade a, CutoverFacade b) private view {
        (uint256[24] memory aa, uint256[24] memory ad) = a.sideCounts(1);
        (uint256[24] memory ba, uint256[24] memory bd) = b.sideCounts(1);
        assertEq(abi.encode(aa, ad), abi.encode(ba, bd), "upgrade changed historical survivors");
        (uint8 ap, uint8 ar,,,) = a.mathProgress();
        (uint8 bp, uint8 br,,,) = b.mathProgress();
        assertEq(ap, bp);
        assertEq(ar, br);
        assertEq(a.version(), 0);
        assertEq(b.version(), 0);
    }

    function testOldPreparationAndEnrollmentRetainVersionAcrossUpgrade() public {
        uint8[6] memory phases = [uint8(14), 15, 1, 2, 3, 6];
        for (uint256 c; c < phases.length; ++c) {
            CutoverFacade h = fixture(false);
            for (uint256 i; i < 200; ++i) {
                (uint8 currentPhase,,,,) = h.mathProgress();
                if (currentPhase == phases[c]) break;
                h.stepWith(oldModule);
            }
            (uint8 phase,,,,) = h.mathProgress();
            assertEq(phase, phases[c], "must reach actual old phase");
            uint256 snap = vm.snapshotState();
            finish(h, oldModule);
            (uint256[24] memory a, uint256[24] memory d) = h.sideCounts(1);
            (uint8 p, uint8 r,,,) = h.mathProgress();
            vm.revertToState(snap);
            finish(h, newModule);
            (uint256[24] memory aa, uint256[24] memory dd) = h.sideCounts(1);
            (uint8 pp, uint8 rr,,,) = h.mathProgress();
            assertEq(abi.encode(a, d, p, r), abi.encode(aa, dd, pp, rr));
            assertEq(h.version(), 0);
        }
    }

    function testOldMidRoundAndLaterRoundRetainExactMath() public {
        // Snapshot genuinely old executions at every distinct math phase/round observed.
        CutoverFacade h = fixture(true);
        uint256 checked;
        bool[7][7] memory seen;
        for (uint256 i; i < 10000; ++i) {
            (uint8 phase, uint8 round, uint8 mathPhase,,) = h.mathProgress();
            if (phase == 13) break;
            if (phase == 6 && !seen[round][mathPhase]) {
                seen[round][mathPhase] = true;
                uint256 snap = vm.snapshotState();
                finish(h, oldModule);
                (uint256[24] memory a, uint256[24] memory d) = h.sideCounts(1);
                (, uint8 r,,,) = h.mathProgress();
                vm.revertToState(snap);
                uint256 repeat = vm.snapshotState();
                finish(h, newModule);
                (uint256[24] memory aa, uint256[24] memory dd) = h.sideCounts(1);
                (, uint8 rr,,,) = h.mathProgress();
                assertEq(
                    abi.encode(a, d, r), abi.encode(aa, dd, rr), "mid-round upgrade math drift"
                );
                assertEq(h.version(), 0);
                vm.revertToState(repeat);
                ++checked;
            }
            h.stepWith(oldModule);
        }
        assertGt(checked, 3, "must exercise distinct cursor/round continuations");
        assertTrue(seen[1][uint8(Math.Phase.Rapidfire)], "mid rapidfire absent");
        assertTrue(seen[2][uint8(Math.Phase.Rapidfire)], "later round absent");
    }

    function testActualPartialRapidfireAndTargetCursorsKeepOldModel() public {
        for (uint8 wanted = 4; wanted <= 5; ++wanted) {
            CutoverFacade h = fixture(true);
            for (uint256 i; i < 200; ++i) {
                (uint8 phase,,,,) = h.mathProgress();
                if (phase == 6) break;
                h.stepWith(oldModule);
            }
            bool reached;
            for (uint256 i; i < 4000; ++i) {
                (,, uint8 mathPhase, uint256 typeIndex, uint256 targetIndex) = h.mathProgress();
                if (mathPhase == wanted && (wanted == 4 ? typeIndex > 0 : targetIndex > 0)) {
                    reached = true;
                    break;
                }
                h.oldMathStep();
            }
            assertTrue(reached, "actual partial cursor not reached");
            uint256 snap = vm.snapshotState();
            finish(h, oldModule);
            (uint256[24] memory a, uint256[24] memory d) = h.sideCounts(1);
            (, uint8 r,,,) = h.mathProgress();
            vm.revertToState(snap);
            finish(h, newModule);
            (uint256[24] memory aa, uint256[24] memory dd) = h.sideCounts(1);
            (, uint8 rr,,,) = h.mathProgress();
            assertEq(abi.encode(a, d, r), abi.encode(aa, dd, rr));
            assertEq(h.version(), 0);
        }
    }

    function testUnstartedBattleUsesConservedModelAndNeverSwitchesBack() public {
        CutoverFacade h = fixture(false);
        assertEq(h.version(), 0);
        h.stepWith(newModule);
        assertEq(h.version(), 2);
        finish(h, newModule);
        assertEq(h.version(), 2);
        (uint256[24] memory a, uint256[24] memory d) = h.sideCounts(1);
        // Hand-derived 100->99 Reapers has one two-hit target, not 99.
        assertGt(d[uint8(Ship.Reaper)], 0, "corrected battle retained historical wipeout");
        assertGt(a[uint8(Ship.Reaper)], 0);
        (, uint8 rounds,,,) = h.mathProgress();
        assertEq(rounds, 6, "six-round cap retained");
    }
}

// Explicit layouts for independent forge-inspect recursive slot/offset comparison.
contract CutoverLayoutV1 {
    OldStore.Battle internal battle;
}

contract CutoverLayoutV2 {
    Store.Battle internal battle;
}
