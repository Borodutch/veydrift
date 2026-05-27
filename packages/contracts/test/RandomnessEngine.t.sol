// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
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

    function testOnlyFulfillerCanCommitAndPendingCommitmentCannotBeReplaced() public {
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
        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentAlreadyPending.selector, firstCommitment
            )
        );
        engine.commitRandomness(secondCommitment);
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

    function _commitNextWord(uint256 randomWord) internal returns (bytes32 commitment) {
        commitment = engine.randomnessCommitment(randomWord);
        vm.prank(fulfiller);
        engine.commitRandomness(commitment);
        vm.roll(block.number + 1);
    }
}
