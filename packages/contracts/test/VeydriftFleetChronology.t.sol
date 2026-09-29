// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftBatchTransportModule} from "../src/VeydriftBatchTransportModule.sol";
import {VeydriftGameStorage} from "../src/VeydriftGameStorage.sol";

/// Minimal harness for prospective chronology plus unregistered pre-upgrade state.
/// Integration through the actual proxy/modules lives in VeydriftScheduledReturns.t.sol.
contract FleetChronologyHarness is VeydriftBatchTransportModule {
    constructor() {
        nextFleetId = 1;
    }

    function seed(
        uint256 id,
        FleetMissionType kind,
        FleetMissionStatus initialStatus,
        uint256 origin,
        uint256 target,
        uint64 arrival,
        uint64 back
    ) external {
        FleetMission storage m = _fleetMissions[id];
        m.status = initialStatus;
        m.missionType = kind;
        m.owner = address(1);
        m.originPlanetId = origin;
        m.targetPlanetId = target;
        m.arrivalAt = arrival;
        m.returnAt = back;
        if (id >= nextFleetId) nextFleetId = id + 1;
        _registerChronologyMission(id);
    }

    function legacy(uint256 id) external {
        _chronologyRegistered[id] = false;
        delete _chronologyMissionsByBody[
            uint256(keccak256(abi.encode(_fleetMissions[id].originPlanetId, false)))
        ];
        delete _chronologyMissionsByBody[
            uint256(keccak256(abi.encode(_fleetMissions[id].targetPlanetId, false)))
        ];
    }

    function registered(uint256 id) external view returns (bool) {
        return _chronologyRegistered[id];
    }

    function link(uint256 id, uint256 lead) external {
        _fleetMissions[id].randomnessRequestId = lead;
    }

    function hold(uint256 id, uint64 end) external {
        _defenseHoldUntil[id] = end;
    }

    function terminal(uint256 id) external {
        _fleetMissions[id].status = FleetMissionStatus.Resolved;
    }

    function recallAt(uint256 id, uint64 at) external {
        _invalidateChronologyReturnBody(_fleetMissions[id]);
        _fleetMissions[id].status = FleetMissionStatus.Recalled;
        _fleetMissions[id].returnAt = at;
    }

    function resolveFleetMission(uint256 id) external {
        if (this.prepareFleetChronology(id, false)) {
            _fleetMissions[id].status = FleetMissionStatus.Resolved;
        }
    }

    function completeFleetMissionReturn(uint256 id) external {
        if (this.prepareFleetChronology(id, true)) {
            _fleetMissions[id].status = FleetMissionStatus.Returned;
        }
    }

    // Production is exercised by the integration stack, not this storage-ordering harness.
    function settleProductionUntil(uint256, uint64) external {}
    function completeAttackTargetSnapshotQueues(uint256, uint64) external {}

    function targetMoon(uint256 id) external {
        _fleetMissions[id].targetIsMoon = true;
        _chronologyMissionsByBody[uint256(
                keccak256(abi.encode(_fleetMissions[id].targetPlanetId, true))
            )].push(id);
    }

    function setPlayerCursor(address player, uint256 next) external {
        _chronologyPlayerCursor[player] = next;
    }

    function cursor(uint256 id) external view returns (uint256) {
        return _chronologyScans[id].cursor;
    }

    function entries(uint256 planet) external view returns (uint256) {
        return _chronologyMissionsByBody[uint256(keccak256(abi.encode(planet, false)))].length;
    }

    function status(uint256 id) external view returns (FleetMissionStatus) {
        return _fleetMissions[id].status;
    }
}

contract VeydriftFleetChronologyTest is Test {
    FleetChronologyHarness h;

    function setUp() public {
        h = new FleetChronologyHarness();
        vm.warp(1000);
    }

    function _seed(
        uint256 id,
        VeydriftGameStorage.FleetMissionType kind,
        VeydriftGameStorage.FleetMissionStatus status,
        uint256 origin,
        uint256 target,
        uint64 arrival,
        uint64 back
    ) private {
        h.seed(id, kind, status, origin, target, arrival, back);
    }

    function testLegacyHistoryNeverNeedsBackfillAndNewLaunchIsImmediatelyRegistered() public {
        _seed(
            1,
            VeydriftGameStorage.FleetMissionType.Transport,
            VeydriftGameStorage.FleetMissionStatus.Returning,
            1,
            3,
            700,
            800
        );
        h.legacy(1);
        _seed(
            94148,
            VeydriftGameStorage.FleetMissionType.Attack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            2,
            1,
            900,
            1200
        );
        (bool eligible,, bool ready) = h.fleetMissionEligibility(94148);
        assertTrue(eligible, "legacy return is the accepted mixed-generation limitation");
        assertTrue(ready);
        assertTrue(h.registered(94148));
        assertFalse(h.registered(1));
        uint256 gasBefore = gasleft();
        assertTrue(h.prepareFleetChronology(94148, false));
        assertLt(gasBefore - gasleft(), 2_000_000, "no historical scan");
        h.completeFleetMissionReturn(1);
        assertEq(uint8(h.status(1)), uint8(VeydriftGameStorage.FleetMissionStatus.Returned));
        assertFalse(h.registered(1), "legacy completion never migrates");
        assertTrue(h.registered(94148), "old/new interaction never downgrades new mission");
    }

    function testEmptyProspectiveImplementationNeedsNoInitialization() public {
        (bool oldSelectorExists,) =
            address(h).call(abi.encodeWithSignature("syncFleetChronology(uint256)", 256));
        assertFalse(oldSelectorExists, "historical backfill selector must not exist");
        (bool eligible,, bool ready) = h.fleetMissionEligibility(1);
        assertFalse(eligible);
        assertTrue(ready);
        _seed(
            1,
            VeydriftGameStorage.FleetMissionType.Transport,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            1,
            2,
            900,
            1200
        );
        (eligible,, ready) = h.fleetMissionEligibility(1);
        assertTrue(eligible);
        assertTrue(ready);
        h.recallAt(1, 950);
        assertTrue(h.registered(1));
        h.completeFleetMissionReturn(1);
        assertTrue(h.registered(1));
    }

    function testExternalRegistrationCannotRelabelLegacyOrDuplicateNewMission() public {
        _seed(
            1,
            VeydriftGameStorage.FleetMissionType.Transport,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            1,
            2,
            900,
            1200
        );
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.Unauthorized.selector, address(this))
        );
        h.registerFleetChronology(1);
        h.legacy(1);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftGameStorage.Unauthorized.selector, address(this))
        );
        h.registerFleetChronology(1);
        assertFalse(h.registered(1));
    }

    function testLegacyLinkedMissionDoesNotAdvertiseReadinessBeforeLeadSettles() public {
        _seed(
            1,
            VeydriftGameStorage.FleetMissionType.Attack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            2,
            1,
            900,
            1200
        );
        _seed(
            2,
            VeydriftGameStorage.FleetMissionType.AcsAttack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            3,
            1,
            900,
            1300
        );
        h.link(2, 1);
        h.legacy(2);
        (bool eligible, uint256 blocker, bool ready) = h.fleetMissionEligibility(2);
        assertFalse(eligible);
        assertEq(blocker, 1);
        assertTrue(ready, "funded exact preflight remains supported");
        h.terminal(1);
        (eligible,,) = h.fleetMissionEligibility(2);
        assertTrue(eligible);
        assertFalse(h.registered(2));
    }

    function testLegacyReturnRecallAndHoldRemainLiveWithoutIndexing() public {
        for (uint8 kind; kind <= uint8(VeydriftGameStorage.FleetMissionType.DefenseHold); ++kind) {
            if (kind == uint8(VeydriftGameStorage.FleetMissionType.MissileAttack)) continue;
            h = new FleetChronologyHarness();
            _seed(
                1,
                VeydriftGameStorage.FleetMissionType(kind),
                VeydriftGameStorage.FleetMissionStatus.Returning,
                1,
                2,
                700,
                800
            );
            h.legacy(1);
            h.completeFleetMissionReturn(1);
            assertEq(uint8(h.status(1)), uint8(VeydriftGameStorage.FleetMissionStatus.Returned));
            assertFalse(h.registered(1));
        }
        h = new FleetChronologyHarness();
        _seed(
            1,
            VeydriftGameStorage.FleetMissionType.DefenseHold,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            2,
            1,
            700,
            1100
        );
        h.hold(1, 800);
        h.legacy(1);
        h.resolveFleetMission(1);
        assertEq(uint8(h.status(1)), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertFalse(h.registered(1));
        _seed(
            2,
            VeydriftGameStorage.FleetMissionType.Attack,
            VeydriftGameStorage.FleetMissionStatus.Recalled,
            3,
            1,
            700,
            900
        );
        h.legacy(2);
        h.completeFleetMissionReturn(2);
        assertEq(uint8(h.status(2)), uint8(VeydriftGameStorage.FleetMissionStatus.Returned));
        assertFalse(h.registered(2));
    }

    function testAllProspectiveReturnTypesBlockLaterEvents() public {
        for (uint8 kind; kind <= uint8(VeydriftGameStorage.FleetMissionType.DefenseHold); ++kind) {
            if (kind == uint8(VeydriftGameStorage.FleetMissionType.MissileAttack)) continue;
            h = new FleetChronologyHarness();
            _seed(
                1,
                VeydriftGameStorage.FleetMissionType(kind),
                VeydriftGameStorage.FleetMissionStatus.Returning,
                1,
                3,
                700,
                800
            );
            _seed(
                2,
                VeydriftGameStorage.FleetMissionType.Transport,
                VeydriftGameStorage.FleetMissionStatus.Outbound,
                2,
                1,
                900,
                1200
            );
            (bool eligible, uint256 blocker,) = h.fleetMissionEligibility(2);
            assertFalse(eligible);
            assertEq(blocker, 1);
            assertFalse(h.prepareFleetChronology(2, false));
            assertTrue(h.prepareFleetChronology(2, false));
        }
    }

    function testHoldEndWaitsForBattleAtInclusiveTieAndNotLaterBattle() public {
        _seed(
            1,
            VeydriftGameStorage.FleetMissionType.DefenseHold,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            3,
            1,
            700,
            1100
        );
        h.hold(1, 900);
        _seed(
            2,
            VeydriftGameStorage.FleetMissionType.Attack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            2,
            1,
            900,
            1200
        );
        (bool eligible, uint256 blocker,) = h.fleetMissionEligibility(1);
        assertFalse(eligible);
        assertEq(blocker, 2);
        (eligible,,) = h.fleetMissionEligibility(2);
        assertTrue(eligible);
        h.terminal(2);
        assertTrue(h.prepareFleetChronology(1, false));
    }

    function testLinkedParticipantsDoNotCreateBattleCycleButReserveReturnOrigin() public {
        _seed(
            1,
            VeydriftGameStorage.FleetMissionType.Attack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            2,
            1,
            800,
            1200
        );
        _seed(
            2,
            VeydriftGameStorage.FleetMissionType.AcsAttack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            3,
            1,
            700,
            900
        );
        h.link(2, 1);
        _seed(
            3,
            VeydriftGameStorage.FleetMissionType.Attack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            4,
            3,
            950,
            1300
        );
        (bool eligible,,) = h.fleetMissionEligibility(1);
        assertTrue(eligible);
        uint256 blocker;
        (eligible, blocker,) = h.fleetMissionEligibility(2);
        assertFalse(eligible);
        assertEq(blocker, 1);
        (eligible, blocker,) = h.fleetMissionEligibility(3);
        assertFalse(eligible);
        assertEq(blocker, 2);
    }

    function testEventTimeNotMissionIdAndReturnTiePolicy() public {
        _seed(
            1,
            VeydriftGameStorage.FleetMissionType.Attack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            2,
            1,
            900,
            1200
        );
        _seed(
            2,
            VeydriftGameStorage.FleetMissionType.Deploy,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            3,
            1,
            800,
            1000
        );
        _seed(
            3,
            VeydriftGameStorage.FleetMissionType.Transport,
            VeydriftGameStorage.FleetMissionStatus.Returning,
            1,
            4,
            700,
            900
        );
        (bool eligible, uint256 blocker,) = h.fleetMissionEligibility(1);
        assertFalse(eligible);
        assertEq(blocker, 2);
        h.terminal(2);
        (eligible,,) = h.fleetMissionEligibility(1);
        assertTrue(eligible);
        (eligible, blocker,) = h.fleetMissionEligibility(3);
        assertFalse(eligible);
        assertEq(blocker, 1);
    }

    function testLargeBodyScanHasBoundedGasAndDoesNotClaimProgressIsEligible() public {
        for (uint256 id = 1; id <= 300; ++id) {
            _seed(
                id,
                VeydriftGameStorage.FleetMissionType.Deploy,
                VeydriftGameStorage.FleetMissionStatus.Outbound,
                2,
                1,
                // id is bounded to 1..300, so this fixture timestamp is at most 2300.
                // forge-lint: disable-next-line(unsafe-typecast)
                uint64(2000 + id),
                4000
            );
        }
        _seed(
            301,
            VeydriftGameStorage.FleetMissionType.Attack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            3,
            1,
            900,
            1200
        );

        (bool eligible,,) = h.fleetMissionEligibility(301);
        assertFalse(eligible);
        bool done;
        for (uint256 i; i < 32; ++i) {
            uint256 gasBefore = gasleft();
            done = h.prepareFleetChronology(301, false);
            assertLt(gasBefore - gasleft(), 2_000_000);
            if (done) break;
        }
        assertTrue(done);
    }

    function testEarlierRandomnessBoundBattleDoesNotBlockUnrelatedBody() public {
        _seed(
            1,
            VeydriftGameStorage.FleetMissionType.Attack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            2,
            1,
            800,
            1200
        );
        _seed(
            2,
            VeydriftGameStorage.FleetMissionType.Transport,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            4,
            3,
            900,
            1200
        );
        assertTrue(h.prepareFleetChronology(2, false));
    }

    function testUnrelatedResolutionDoesNotRestartLargeBodyProof() public {
        for (uint256 id = 1; id <= 30; ++id) {
            _seed(
                id,
                VeydriftGameStorage.FleetMissionType.Deploy,
                VeydriftGameStorage.FleetMissionStatus.Outbound,
                2,
                1,
                2000,
                4000
            );
        }
        _seed(
            31,
            VeydriftGameStorage.FleetMissionType.Attack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            3,
            1,
            900,
            1200
        );
        _seed(
            32,
            VeydriftGameStorage.FleetMissionType.Deploy,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            4,
            5,
            800,
            1200
        );
        assertFalse(h.prepareFleetChronology(31, false));
        assertEq(h.cursor(31), 12);
        assertTrue(h.prepareFleetChronology(32, false));
        h.terminal(32);
        assertFalse(h.prepareFleetChronology(31, false));
        assertEq(h.cursor(31), 24);
        assertTrue(h.prepareFleetChronology(31, false));
    }

    function testTerminalInventoryIsPrunedInBoundedChunks() public {
        for (uint256 id = 1; id <= 30; ++id) {
            _seed(
                id,
                VeydriftGameStorage.FleetMissionType.Deploy,
                VeydriftGameStorage.FleetMissionStatus.Outbound,
                2,
                1,
                500,
                700
            );
        }
        _seed(
            31,
            VeydriftGameStorage.FleetMissionType.Attack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            3,
            1,
            900,
            1200
        );
        for (uint256 id = 1; id <= 30; ++id) {
            h.terminal(id);
        }
        assertFalse(h.prepareFleetChronology(31, false));
        assertGe(h.entries(1), 19);
        for (uint256 i; i < 4; ++i) {
            if (h.prepareFleetChronology(31, false)) break;
        }
        assertEq(h.entries(1), 1);
    }

    function testMoonCombatAndHarvestShareDebrisButNotPlanetReturnBody() public {
        _seed(
            1,
            VeydriftGameStorage.FleetMissionType.Attack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            2,
            1,
            800,
            1200
        );
        h.targetMoon(1);
        _seed(
            2,
            VeydriftGameStorage.FleetMissionType.Harvest,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            3,
            1,
            900,
            1200
        );
        _seed(
            3,
            VeydriftGameStorage.FleetMissionType.Transport,
            VeydriftGameStorage.FleetMissionStatus.Returning,
            1,
            4,
            700,
            850
        );
        (bool eligible, uint256 blocker,) = h.fleetMissionEligibility(2);
        assertFalse(eligible);
        assertEq(blocker, 1);
        (eligible,,) = h.fleetMissionEligibility(3);
        assertTrue(eligible);
    }

    function testLazySettlementFindsProspectiveHoldAndRecalledReturnWithoutOldIndexes() public {
        _seed(
            1,
            VeydriftGameStorage.FleetMissionType.DefenseHold,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            2,
            1,
            700,
            1100
        );
        h.hold(1, 800);
        _seed(
            2,
            VeydriftGameStorage.FleetMissionType.AcsDefend,
            VeydriftGameStorage.FleetMissionStatus.Recalled,
            3,
            1,
            700,
            900
        );
        h.settleDuePlayerCombatArrivals(address(1));
        assertEq(uint8(h.status(1)), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertEq(uint8(h.status(2)), uint8(VeydriftGameStorage.FleetMissionStatus.Returned));
    }

    function testLazyWrappedCursorPruningDoesNotSkipPendingLeg() public {
        for (uint256 id = 1; id <= 3; ++id) {
            _seed(
                id,
                VeydriftGameStorage.FleetMissionType.Deploy,
                VeydriftGameStorage.FleetMissionStatus.Outbound,
                2,
                1,
                // id is bounded to 1..3, so this fixture timestamp is at most 703.
                // forge-lint: disable-next-line(unsafe-typecast)
                uint64(700 + id),
                1000
            );
        }
        h.terminal(1);
        h.setPlayerCursor(address(1), 2);
        h.settleDuePlayerCombatArrivals(address(1));
        assertEq(uint8(h.status(2)), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
        assertEq(uint8(h.status(3)), uint8(VeydriftGameStorage.FleetMissionStatus.Resolved));
    }

    function testSameTimestampRecallInvalidatesAlreadyScannedOriginPrefix() public {
        _seed(
            1,
            VeydriftGameStorage.FleetMissionType.Attack,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            1,
            3,
            2000,
            3000
        );
        for (uint256 id = 2; id <= 13; ++id) {
            _seed(
                id,
                VeydriftGameStorage.FleetMissionType.Deploy,
                VeydriftGameStorage.FleetMissionStatus.Outbound,
                2,
                1,
                2000,
                3000
            );
        }
        _seed(
            14,
            VeydriftGameStorage.FleetMissionType.DefenseHold,
            VeydriftGameStorage.FleetMissionStatus.Outbound,
            4,
            1,
            700,
            1200
        );
        h.hold(14, 1000);
        assertFalse(h.prepareFleetChronology(14, false));
        assertEq(h.cursor(14), 12);
        h.recallAt(1, 1000);
        (bool eligible, uint256 blocker,) = h.fleetMissionEligibility(14);
        assertFalse(eligible);
        assertEq(blocker, 1);
        h.completeFleetMissionReturn(1);
        // The return scan is independently bounded; drain it before the later hold event.
        for (
            uint256 i;
            i < 3 && h.status(1) != VeydriftGameStorage.FleetMissionStatus.Returned;
            ++i
        ) {
            h.completeFleetMissionReturn(1);
        }
        (eligible,,) = h.fleetMissionEligibility(14);
        assertTrue(eligible);
    }
}
