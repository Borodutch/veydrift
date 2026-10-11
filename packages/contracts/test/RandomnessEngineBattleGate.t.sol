// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";

contract RandomnessEngineBattleGateTest is Test {
    address private constant OWNER = address(0xA11CE);
    address private constant FULFILLER = address(0xB0B);
    address private constant OTHER = address(0xBAD);
    bytes32 private constant PURPOSE = keccak256("battle:7:3");
    bytes32 private constant SNAPSHOT = keccak256("qualified immutable snapshot");
    RandomnessEngine private engine;

    function setUp() public {
        engine = RandomnessEngine(
            address(
                new ERC1967Proxy(
                    address(new RandomnessEngine(OWNER, FULFILLER)),
                    abi.encodeCall(RandomnessEngine.initialize, (OWNER, FULFILLER))
                )
            )
        );
        vm.prank(OWNER);
        engine.setRequesterAuthorization(address(this), true);
    }

    function testRevealBlockedUntilSealedAndContextBindsRequest() public {
        _commit(11);
        uint256 id = engine.requestBattleRandomness(PURPOSE);
        (bool required, bytes32 snapshot) = engine.battleRequestPolicy(id);
        assertTrue(required);
        assertEq(snapshot, bytes32(0));
        assertEq(engine.battlePurposeContext(id), bytes32(0));
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.BattleSnapshotRequired.selector, id)
        );
        vm.prank(FULFILLER);
        engine.fulfillRandomness(id, 11);
        assertFalse(engine.isFulfilled(id));
        vm.expectRevert(abi.encodeWithSelector(RandomnessEngine.PendingRandomness.selector, id));
        engine.consumeRandomness(id, PURPOSE);
        engine.sealBattleSnapshot(id, SNAPSHOT);
        bytes32 expected = keccak256(
            abi.encode(
                engine.BATTLE_SNAPSHOT_PURPOSE_DOMAIN(),
                block.chainid,
                address(engine),
                id,
                address(this),
                PURPOSE,
                engine.randomnessCommitment(11),
                SNAPSHOT
            )
        );
        assertEq(engine.battlePurposeContext(id), expected);
        assertEq(engine.request(id).purposeHash, PURPOSE);
        bytes32 wrongCommitment = engine.randomnessCommitment(22);
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentMismatch.selector,
                engine.randomnessCommitment(11),
                wrongCommitment
            )
        );
        vm.prank(FULFILLER);
        engine.fulfillRandomness(id, 22);
        vm.prank(FULFILLER);
        engine.fulfillRandomness(id, 11);
        assertEq(engine.consumeRandomness(id, PURPOSE), 11);
        assertEq(engine.battlePurposeContext(id), expected);
        vm.expectRevert(abi.encodeWithSelector(RandomnessEngine.AlreadyFulfilled.selector, id));
        vm.prank(FULFILLER);
        engine.fulfillRandomness(id, 11);
    }

    function testOnlyOriginalRequesterSealsNonzeroImmutableSnapshotWithIdempotentRetries() public {
        _commit(11);
        uint256 id = engine.requestBattleRandomness(PURPOSE);
        vm.startPrank(OWNER);
        engine.setRequesterAuthorization(OTHER, true);
        engine.setRequesterAuthorization(address(this), false);
        vm.stopPrank();
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.UnauthorizedRequester.selector, OTHER)
        );
        vm.prank(OTHER);
        engine.sealBattleSnapshot(id, SNAPSHOT);
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.UnauthorizedRequester.selector, OWNER)
        );
        vm.prank(OWNER);
        engine.sealBattleSnapshot(id, SNAPSHOT);
        vm.expectRevert(RandomnessEngine.ZeroBattleSnapshot.selector);
        engine.sealBattleSnapshot(id, bytes32(0));
        engine.sealBattleSnapshot(id, SNAPSHOT);
        bytes32 context = engine.battlePurposeContext(id);
        vm.recordLogs();
        engine.sealBattleSnapshot(id, SNAPSHOT);
        assertEq(vm.getRecordedLogs().length, 0);
        bytes32 different = keccak256("different");
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.BattleSnapshotMismatch.selector, SNAPSHOT, different
            )
        );
        engine.sealBattleSnapshot(id, different);
        vm.prank(FULFILLER);
        engine.fulfillRandomness(id, 11);
        vm.recordLogs();
        engine.sealBattleSnapshot(id, SNAPSHOT);
        assertEq(vm.getRecordedLogs().length, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.BattleSnapshotMismatch.selector, SNAPSHOT, different
            )
        );
        engine.sealBattleSnapshot(id, different);
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.UnauthorizedRequester.selector, OTHER)
        );
        vm.prank(OTHER);
        engine.sealBattleSnapshot(id, SNAPSHOT);
        assertEq(engine.battlePurposeContext(id), context);
    }

    function testBattleAlwaysRequiresActiveFifoPrecommitEvenWhenGlobalModeDisabled() public {
        vm.prank(OWNER);
        engine.setPrecommitRequired(false);
        vm.expectRevert(RandomnessEngine.NoRandomnessCommitment.selector);
        engine.requestBattleRandomness(PURPOSE);
        assertEq(engine.nextRequestId(), 1);
        bytes32 first = engine.randomnessCommitment(11);
        bytes32 second = engine.randomnessCommitment(22);
        vm.startPrank(FULFILLER);
        engine.commitRandomness(first);
        engine.commitRandomness(second);
        vm.stopPrank();
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentNotActive.selector, first, uint64(block.number)
            )
        );
        engine.requestBattleRandomness(PURPOSE);
        assertEq(engine.commitmentInventoryCount(), 2);
        vm.roll(block.number + 1);
        uint256 legacy = engine.requestRandomness(PURPOSE);
        assertEq(engine.request(legacy).randomnessCommitment, bytes32(0));
        assertEq(engine.pendingCommitment(), first);
        uint256 a = engine.requestBattleRandomness(PURPOSE);
        uint256 b = engine.requestBattleRandomness(PURPOSE);
        assertEq(engine.request(a).randomnessCommitment, first);
        assertEq(engine.request(b).randomnessCommitment, second);
        assertEq(engine.commitmentInventoryCount(), 0);
        engine.sealBattleSnapshot(a, SNAPSHOT);
        engine.sealBattleSnapshot(b, SNAPSHOT);
        assertNotEq(engine.battlePurposeContext(a), engine.battlePurposeContext(b));
        vm.prank(FULFILLER);
        engine.fulfillRandomness(legacy, 99);
        assertEq(engine.consumeRandomness(legacy, PURPOSE), 99);
    }

    function testRecoveryForbiddenBeforeAndAfterSealDespiteTimeoutAndAdminToggles() public {
        _commit(11);
        uint256 id = engine.requestBattleRandomness(PURPOSE);
        bytes32 original = engine.randomnessCommitment(11);
        bytes32 replacement = engine.randomnessCommitment(22);
        _expectRecoveryForbidden(id, original, replacement);
        vm.warp(block.timestamp + engine.STALE_REQUEST_RECOVERY_DELAY() + 1 days);
        vm.startPrank(OWNER);
        engine.setPrecommitRequired(false);
        engine.setFulfiller(OTHER);
        engine.pause();
        vm.stopPrank();
        _expectRecoveryForbidden(id, original, replacement);
        vm.prank(OWNER);
        engine.unpause();
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.BattleSnapshotRequired.selector, id)
        );
        vm.prank(OTHER);
        engine.fulfillRandomness(id, 22);
        engine.sealBattleSnapshot(id, SNAPSHOT);
        _expectRecoveryForbidden(id, original, replacement);
        vm.prank(OWNER);
        engine.setPrecommitRequired(true);
        _expectRecoveryForbidden(id, original, replacement);
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentMismatch.selector, original, replacement
            )
        );
        vm.prank(OTHER);
        engine.fulfillRandomness(id, 22);
        assertEq(engine.request(id).randomnessCommitment, original);
        vm.prank(OTHER);
        engine.fulfillRandomness(id, 11);
        assertEq(engine.consumeRandomness(id, PURPOSE), 11);
    }

    function testLegacyRequestStillFulfillsAndRecoversWithoutSnapshot() public {
        _commit(11);
        uint256 direct = engine.requestRandomness(PURPOSE);
        _commit(22);
        uint256 stale = engine.requestRandomness(PURPOSE);
        (bool required, bytes32 snapshot) = engine.battleRequestPolicy(stale);
        assertFalse(required);
        assertEq(snapshot, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(RandomnessEngine.NotBattleRequest.selector, stale));
        engine.sealBattleSnapshot(stale, SNAPSHOT);
        vm.prank(FULFILLER);
        engine.fulfillRandomness(direct, 11);
        vm.warp(block.timestamp + engine.STALE_REQUEST_RECOVERY_DELAY());
        bytes32 original = engine.randomnessCommitment(22);
        bytes32 replacement = engine.randomnessCommitment(33);
        vm.prank(OWNER);
        engine.recoverStaleRequestCommitment(stale, original, replacement);
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentNotActive.selector,
                replacement,
                uint64(block.number)
            )
        );
        vm.prank(FULFILLER);
        engine.fulfillRandomness(stale, 33);
        vm.roll(block.number + 1);
        vm.prank(FULFILLER);
        engine.fulfillRandomness(stale, 33);
        assertEq(engine.consumeRandomness(direct, PURPOSE), 11);
        assertEq(engine.consumeRandomness(stale, PURPOSE), 33);
        assertEq(engine.battlePurposeContext(stale), bytes32(0));
    }

    function testBattleEntryValidationAndPause() public {
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.UnauthorizedRequester.selector, OTHER)
        );
        vm.prank(OTHER);
        engine.requestBattleRandomness(PURPOSE);
        vm.expectRevert(RandomnessEngine.ZeroPurpose.selector);
        engine.requestBattleRandomness(bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(RandomnessEngine.UnknownRequest.selector, 99));
        engine.sealBattleSnapshot(99, SNAPSHOT);
        _commit(11);
        uint256 id = engine.requestBattleRandomness(PURPOSE);
        vm.prank(OWNER);
        engine.pause();
        vm.expectRevert(bytes4(keccak256("EnforcedPause()")));
        engine.requestBattleRandomness(PURPOSE);
        vm.expectRevert(bytes4(keccak256("EnforcedPause()")));
        engine.sealBattleSnapshot(id, SNAPSHOT);
        vm.prank(OWNER);
        engine.unpause();
        engine.sealBattleSnapshot(id, SNAPSHOT);
    }

    function testUpgradePreservesPendingSealedLegacyRecoveryAndFifoState() public {
        _commit(11);
        uint256 pending = engine.requestBattleRandomness(PURPOSE);
        _commit(22);
        uint256 sealedId = engine.requestBattleRandomness(PURPOSE);
        engine.sealBattleSnapshot(sealedId, SNAPSHOT);
        bytes32 context = engine.battlePurposeContext(sealedId);
        _commit(33);
        uint256 legacy = engine.requestRandomness(PURPOSE);
        vm.warp(block.timestamp + engine.STALE_REQUEST_RECOVERY_DELAY());
        bytes32 original = engine.randomnessCommitment(33);
        bytes32 replacement = engine.randomnessCommitment(44);
        vm.prank(OWNER);
        engine.recoverStaleRequestCommitment(legacy, original, replacement);
        _commit(55);
        _commit(66);
        RandomnessEngine next = new RandomnessEngine(OWNER, FULFILLER);
        vm.prank(OWNER);
        engine.upgradeToAndCall(address(next), "");
        assertEq(engine.owner(), OWNER);
        assertEq(engine.fulfiller(), FULFILLER);
        assertEq(engine.nextRequestId(), 4);
        assertEq(engine.battlePurposeContext(sealedId), context);
        assertEq(engine.commitmentInventoryCount(), 2);
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.BattleSnapshotRequired.selector, pending)
        );
        vm.prank(FULFILLER);
        engine.fulfillRandomness(pending, 11);
        _expectRecoveryForbidden(pending, engine.randomnessCommitment(11), replacement);
        engine.sealBattleSnapshot(pending, SNAPSHOT);
        vm.startPrank(FULFILLER);
        engine.fulfillRandomness(pending, 11);
        engine.fulfillRandomness(sealedId, 22);
        engine.fulfillRandomness(legacy, 44);
        vm.stopPrank();
        uint256 nextId = engine.requestBattleRandomness(PURPOSE);
        assertEq(nextId, 4);
        assertEq(engine.request(nextId).randomnessCommitment, engine.randomnessCommitment(55));
        assertEq(engine.pendingCommitment(), engine.randomnessCommitment(66));
        assertEq(engine.consumeRandomness(legacy, PURPOSE), 44);
    }

    /// @dev Literal pre-gate fixture pinned to dae4976e RandomnessEngine slots 0-10.
    ///      Independent of the current implementation's declarations and Request encoder.
    function testLegacyStorageFixtureContinuesAfterUpgrade() public {
        bytes32 original = engine.randomnessCommitment(11);
        bytes32 replacement = engine.randomnessCommitment(22);
        bytes32 queued = engine.randomnessCommitment(33);
        bytes32 tail = engine.randomnessCommitment(44);
        vm.store(address(engine), bytes32(uint256(0)), bytes32(uint256(2)));
        vm.store(address(engine), bytes32(uint256(2)), queued);
        vm.store(address(engine), bytes32(uint256(3)), bytes32(uint256(10)));
        bytes32 requestBase = keccak256(abi.encode(uint256(1), uint256(5)));
        vm.store(address(engine), requestBase, bytes32(uint256(uint160(address(this)))));
        vm.store(address(engine), bytes32(uint256(requestBase) + 1), PURPOSE);
        vm.store(address(engine), bytes32(uint256(requestBase) + 2), replacement);
        vm.store(address(engine), bytes32(uint256(requestBase) + 3), bytes32(uint256(1)));
        vm.store(address(engine), keccak256(abi.encode(uint256(0), uint256(6))), tail);
        vm.store(
            address(engine), keccak256(abi.encode(uint256(0), uint256(7))), bytes32(uint256(10))
        );
        vm.store(address(engine), bytes32(uint256(9)), bytes32(uint256(1)));
        vm.store(
            address(engine), keccak256(abi.encode(uint256(1), uint256(10))), bytes32(uint256(10))
        );
        RandomnessEngine next = new RandomnessEngine(OWNER, FULFILLER);
        vm.prank(OWNER);
        engine.upgradeToAndCall(address(next), "");
        vm.roll(10);
        (bool required, bytes32 snapshot) = engine.battleRequestPolicy(1);
        assertFalse(required);
        assertEq(snapshot, bytes32(0));
        RandomnessEngine.Request memory stored = engine.request(1);
        assertEq(stored.requester, address(this));
        assertEq(stored.purposeHash, PURPOSE);
        assertEq(stored.randomnessCommitment, replacement);
        assertEq(stored.createdAt, 1);
        assertEq(stored.fulfilledAt, 0);
        assertEq(stored.randomWord, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentNotActive.selector, replacement, uint64(10)
            )
        );
        vm.prank(FULFILLER);
        engine.fulfillRandomness(1, 22);
        vm.roll(11);
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentMismatch.selector, replacement, original
            )
        );
        vm.prank(FULFILLER);
        engine.fulfillRandomness(1, 11);
        vm.prank(FULFILLER);
        engine.fulfillRandomness(1, 22);
        assertEq(engine.consumeRandomness(1, PURPOSE), 22);
        assertEq(
            vm.load(address(engine), keccak256(abi.encode(uint256(1), uint256(10)))), bytes32(0)
        );
        uint256 id = engine.requestBattleRandomness(PURPOSE);
        assertEq(id, 2);
        assertEq(engine.request(id).randomnessCommitment, queued);
        assertEq(engine.pendingCommitment(), tail);
        assertEq(engine.commitmentInventoryCount(), 1);
    }

    function _commit(uint256 word) private {
        bytes32 commitment = engine.randomnessCommitment(word);
        vm.prank(FULFILLER);
        engine.commitRandomness(commitment);
        // Optimized tests may cache block.number across cheatcode calls.
        vm.roll(vm.getBlockNumber() + 1);
    }

    function _expectRecoveryForbidden(uint256 id, bytes32 original, bytes32 replacement) private {
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.BattleRandomnessRecoveryForbidden.selector, id)
        );
        vm.prank(OWNER);
        engine.recoverStaleRequestCommitment(id, original, replacement);
    }
}
