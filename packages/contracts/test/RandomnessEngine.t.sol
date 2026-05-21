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
        consumer.start(purpose);
        uint256 requestId = consumer.requestId();

        RandomnessEngine.Request memory stored = engine.request(requestId);
        assertEq(stored.requester, address(consumer));
        assertEq(stored.purposeHash, purpose);
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
        consumer.start(purpose);
        uint256 requestId = consumer.requestId();
        vm.expectRevert(
            abi.encodeWithSelector(RandomnessEngine.UnauthorizedFulfiller.selector, address(this))
        );
        engine.fulfillRandomness(requestId, 77);
    }

    function testConsumerIsBlockedWhileRequestPending() public {
        consumer.start(purpose);

        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.PendingRandomness.selector, consumer.requestId()
            )
        );
        consumer.resolve(purpose);
    }

    function testDoubleFulfillmentUnknownRequestAndCrossPurposeReplayRevert() public {
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
        consumer.start(purpose);

        vm.startPrank(nextFulfiller);
        engine.fulfillRandomness(consumer.requestId(), 99);
        vm.stopPrank();
        consumer.resolve(purpose);
        assertEq(consumer.resolvedWord(), 99);
    }
}
