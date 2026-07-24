// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";

contract RandomnessConsumer {
    RandomnessEngine public immutable randomness;
    uint256 public requestId;
    bytes32 public purposeHash;
    uint256 public resolvedWord;

    constructor(RandomnessEngine randomness_) {
        randomness = randomness_;
    }

    function start(bytes32 purposeHash_) external {
        purposeHash = purposeHash_;
        requestId = randomness.requestRandomness(purposeHash_);
    }

    function resolve(bytes32 purposeHash_) external {
        resolvedWord = randomness.consumeRandomness(requestId, purposeHash_);
    }
}

contract RandomnessEngineTest is Test {
    address private owner = address(0xA11CE);
    address private fulfiller = address(0xB0B);
    address private attacker = address(0xBAD);
    RandomnessEngine private engine;
    RandomnessConsumer private consumer;
    bytes32 private purpose = keccak256("battle:planet:7:mission:3");

    function setUp() public {
        engine = new RandomnessEngine(owner, fulfiller);
        consumer = new RandomnessConsumer(engine);
        vm.prank(owner);
        engine.setRequesterAuthorization(address(consumer), true);
    }

    function testAuthorizedConsumerRequestsAndConsumesFulfilledRandomness() public {
        _commitNextWord(123456789);
        consumer.start(purpose);
        uint256 requestId = consumer.requestId();

        RandomnessEngine.Request memory stored = engine.request(requestId);
        assertEq(stored.requester, address(consumer));
        assertEq(stored.purposeHash, purpose);
        assertEq(stored.randomnessCommitment, engine.randomnessCommitment(123456789));
        assertEq(stored.createdAt, block.timestamp);
        assertEq(stored.fulfilledAt, 0);
        assertEq(stored.randomWord, 0);

        vm.prank(fulfiller);
        engine.fulfillRandomness(requestId, 123456789);

        consumer.resolve(purpose);
        assertEq(consumer.resolvedWord(), 123456789);
    }

    function testUnauthorizedRequesterCannotRequest() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.UnauthorizedRequester.selector, attacker)
        );
        engine.requestRandomness(purpose);
    }

    function testUnauthorizedFulfillerCannotFulfill() public {
        _commitNextWord(77);
        consumer.start(purpose);
        uint256 requestId = consumer.requestId();
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.UnauthorizedFulfiller.selector, address(this))
        );
        engine.fulfillRandomness(requestId, 77);
    }

    function testConsumerIsBlockedWhileRequestPending() public {
        _commitNextWord(77);
        consumer.start(purpose);

        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.PendingRandomness.selector, consumer.requestId()
            )
        );
        consumer.resolve(purpose);
    }

    function testDoubleFulfillmentUnknownRequestAndCrossPurposeReplayRevert() public {
        _commitNextWord(1);
        consumer.start(purpose);
        uint256 requestId = consumer.requestId();

        vm.prank(fulfiller);
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.UnknownRequest.selector, requestId + 1)
        );
        engine.fulfillRandomness(requestId + 1, 1);

        vm.prank(fulfiller);
        engine.fulfillRandomness(requestId, 1);

        vm.prank(fulfiller);
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.AlreadyFulfilled.selector, requestId)
        );
        engine.fulfillRandomness(requestId, 2);

        bytes32 wrongPurpose = keccak256("battle:planet:7:mission:4");
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.PurposeMismatch.selector, purpose, wrongPurpose)
        );
        consumer.resolve(wrongPurpose);
    }

    function testOwnerCanRotateFulfillerAndPauseRequests() public {
        address nextFulfiller = address(0xCAFE);

        vm.prank(owner);
        engine.setFulfiller(nextFulfiller);
        assertEq(engine.fulfiller(), nextFulfiller);

        vm.prank(owner);
        engine.pause();

        vm.expectRevert();
        consumer.start(purpose);

        vm.prank(owner);
        engine.unpause();
        bytes32 commitment = engine.randomnessCommitment(99);
        vm.prank(nextFulfiller);
        engine.commitRandomness(commitment);
        vm.roll(block.number + 1);
        consumer.start(purpose);

        vm.startPrank(nextFulfiller);
        engine.fulfillRandomness(consumer.requestId(), 99);
        vm.stopPrank();
        consumer.resolve(purpose);
        assertEq(consumer.resolvedWord(), 99);
    }

    function testStrictPrecommitPreventsPostRequestWordSelection() public {
        bytes32 commitment = _commitNextWord(111);
        consumer.start(purpose);

        RandomnessEngine.Request memory stored = engine.request(consumer.requestId());
        assertEq(stored.randomnessCommitment, commitment);

        bytes32 wrongCommitment = engine.randomnessCommitment(222);
        assertNotEq(wrongCommitment, commitment);
        vm.startPrank(fulfiller);
        uint256 requestId = consumer.requestId();
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentMismatch.selector, commitment, wrongCommitment
            )
        );
        engine.fulfillRandomness(requestId, 222);

        engine.fulfillRandomness(requestId, 111);
        vm.stopPrank();
        consumer.resolve(purpose);
        assertEq(consumer.resolvedWord(), 111);
    }

    function testRequestRequiresPriorActiveCommitmentAndConsumesIt() public {
        vm.expectRevert(RandomnessEngine.NoRandomnessCommitment.selector);
        consumer.start(purpose);

        bytes32 commitment = engine.randomnessCommitment(123);
        vm.prank(fulfiller);
        engine.commitRandomness(commitment);

        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentNotActive.selector,
                commitment,
                uint64(block.number)
            )
        );
        consumer.start(purpose);

        vm.roll(block.number + 1);
        consumer.start(purpose);

        bytes32 nextPurpose = keccak256("battle:planet:7:mission:4");
        vm.expectRevert(RandomnessEngine.NoRandomnessCommitment.selector);
        consumer.start(nextPurpose);
    }

    function testOnlyFulfillerCanCommitAndDuplicateCommitmentCannotBeQueued() public {
        bytes32 firstCommitment = engine.randomnessCommitment(1);
        bytes32 secondCommitment = engine.randomnessCommitment(2);

        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.UnauthorizedFulfiller.selector, attacker)
        );
        engine.commitRandomness(firstCommitment);

        vm.prank(fulfiller);
        engine.commitRandomness(firstCommitment);

        vm.prank(fulfiller);
        engine.commitRandomness(secondCommitment);

        vm.prank(fulfiller);
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentAlreadyPending.selector, firstCommitment
            )
        );
        engine.commitRandomness(firstCommitment);
    }

    function testBatchCommitmentsStayReadyAndAreConsumedInOrder() public {
        bytes32[] memory commitments = new bytes32[](3);
        commitments[0] = engine.randomnessCommitment(11);
        commitments[1] = engine.randomnessCommitment(22);
        commitments[2] = engine.randomnessCommitment(33);

        vm.prank(fulfiller);
        engine.commitRandomnessBatch(commitments);

        assertEq(engine.commitmentInventoryCount(), 3);
        assertEq(engine.readyCommitmentCount(), 0);
        (bytes32[] memory inventory, uint64[] memory blocks, uint256 ready) =
            engine.randomnessCommitmentInventory();
        assertEq(inventory.length, 3);
        assertEq(blocks.length, 3);
        assertEq(inventory[0], commitments[0]);
        assertEq(inventory[1], commitments[1]);
        assertEq(inventory[2], commitments[2]);
        assertEq(ready, 0);

        vm.roll(block.number + 1);
        assertEq(engine.readyCommitmentCount(), 3);

        consumer.start(purpose);
        assertEq(engine.request(consumer.requestId()).randomnessCommitment, commitments[0]);
        assertEq(engine.pendingCommitment(), commitments[1]);
        assertEq(engine.commitmentInventoryCount(), 2);

        consumer.start(keccak256("battle:planet:7:mission:4"));
        assertEq(engine.request(consumer.requestId()).randomnessCommitment, commitments[1]);
        assertEq(engine.pendingCommitment(), commitments[2]);
        assertEq(engine.commitmentInventoryCount(), 1);
    }

    function testCommitmentInventoryIsBounded() public {
        bytes32[] memory commitments = new bytes32[](engine.MAX_COMMITMENT_INVENTORY());
        for (uint256 i; i < commitments.length; ++i) {
            commitments[i] = engine.randomnessCommitment(i + 1);
        }
        vm.prank(fulfiller);
        engine.commitRandomnessBatch(commitments);

        bytes32 overflowCommitment = engine.randomnessCommitment(100);
        uint256 maximum = engine.MAX_COMMITMENT_INVENTORY();
        vm.prank(fulfiller);
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentInventoryFull.selector, maximum
            )
        );
        engine.commitRandomness(overflowCommitment);
    }

    function testOwnerCanExplicitlyAcceptCentralizedFulfillmentMode() public {
        vm.prank(owner);
        engine.setPrecommitRequired(false);

        consumer.start(purpose);
        uint256 requestId = consumer.requestId();
        RandomnessEngine.Request memory stored = engine.request(requestId);
        assertEq(stored.randomnessCommitment, bytes32(0));

        vm.prank(fulfiller);
        engine.fulfillRandomness(requestId, 987);

        consumer.resolve(purpose);
        assertEq(consumer.resolvedWord(), 987);
    }

    function testOwnerCanReprecommitAndRecoverAnIrrecoverablyStaleRequest() public {
        bytes32 originalCommitment = _commitNextWord(111);
        consumer.start(purpose);
        uint256 requestId = consumer.requestId();
        bytes32 replacementCommitment = engine.randomnessCommitment(222);

        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessRequestNotStale.selector,
                requestId,
                block.timestamp + engine.STALE_REQUEST_RECOVERY_DELAY()
            )
        );
        vm.prank(owner);
        engine.recoverStaleRequestCommitment(requestId, originalCommitment, replacementCommitment);

        vm.warp(block.timestamp + engine.STALE_REQUEST_RECOVERY_DELAY());

        vm.expectRevert();
        vm.prank(attacker);
        engine.recoverStaleRequestCommitment(requestId, originalCommitment, replacementCommitment);

        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.UnexpectedRandomnessCommitment.selector,
                bytes32(uint256(123)),
                originalCommitment
            )
        );
        vm.prank(owner);
        engine.recoverStaleRequestCommitment(
            requestId, bytes32(uint256(123)), replacementCommitment
        );

        vm.prank(owner);
        engine.recoverStaleRequestCommitment(requestId, originalCommitment, replacementCommitment);
        assertEq(engine.request(requestId).randomnessCommitment, replacementCommitment);

        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessRecoveryAlreadyScheduled.selector, requestId
            )
        );
        vm.prank(owner);
        engine.recoverStaleRequestCommitment(
            requestId, replacementCommitment, engine.randomnessCommitment(333)
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentNotActive.selector,
                replacementCommitment,
                uint64(block.number)
            )
        );
        vm.prank(fulfiller);
        engine.fulfillRandomness(requestId, 222);

        vm.roll(block.number + 1);
        vm.prank(fulfiller);
        engine.fulfillRandomness(requestId, 222);
        consumer.resolve(purpose);
        assertEq(consumer.resolvedWord(), 222);
    }

    function testProxyInitializationAndOwnerUpgradeGate() public {
        RandomnessEngine proxied = RandomnessEngine(
            address(
                new ERC1967Proxy(
                    address(new RandomnessEngine(owner, fulfiller)),
                    abi.encodeCall(RandomnessEngine.initialize, (owner, fulfiller))
                )
            )
        );

        assertEq(proxied.owner(), owner);
        assertEq(proxied.fulfiller(), fulfiller);
        assertEq(proxied.nextRequestId(), 1);
        assertTrue(proxied.precommitRequired());

        RandomnessEngine nextImplementation = new RandomnessEngine(owner, fulfiller);
        vm.prank(attacker);
        vm.expectRevert();
        proxied.upgradeToAndCall(address(nextImplementation), "");

        vm.prank(owner);
        proxied.upgradeToAndCall(address(nextImplementation), "");
        assertEq(proxied.owner(), owner);
        assertEq(proxied.fulfiller(), fulfiller);
    }

    function _commitNextWord(uint256 randomWord) internal returns (bytes32 commitment) {
        commitment = engine.randomnessCommitment(randomWord);
        vm.prank(fulfiller);
        engine.commitRandomness(commitment);
        vm.roll(block.number + 1);
    }
}
