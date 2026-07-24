// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";

interface ILiveVeydriftGame {
    struct Resources {
        uint128 metal;
        uint128 crystal;
        uint128 deuterium;
    }

    function fleetMission(uint256 missionId)
        external
        view
        returns (
            uint8 status,
            uint8 missionType,
            address owner,
            uint256 originPlanetId,
            uint256 targetPlanetId,
            uint64 departureAt,
            uint64 arrivalAt,
            uint64 returnAt,
            uint128 fuelCost,
            Resources memory cargo,
            uint256 randomnessRequestId
        );

    function resolveFleetMission(uint256 missionId) external;
    function requireNoPendingMoonAttackResolution(uint256 planetId) external view;
}

/// @notice No-broadcast proof against the exact stuck Base-mainnet request and mission.
contract RandomnessRecoveryMainnetForkTest is Test {
    address private constant RANDOMNESS_PROXY = 0xdc7d3388bfb07E2cC8DD3Be265d7C1182D34d069;
    address private constant GAME_PROXY = 0xf397910F005151b09644228573a4353818D3755d;
    uint256 private constant REQUEST_ID = 2348;
    uint256 private constant MISSION_ID = 5458;
    uint256 private constant ORIGIN_PLANET_ID = 162;
    uint256 private constant TARGET_PLANET_ID = 212;
    bytes32 private constant LOST_COMMITMENT =
        0x8903d6bb79d1ad4b5a21e856b562425eaa73d456a24f603c7b9870b571a24f3c;

    bool private forkEnabled;

    function setUp() public {
        string memory rpc = vm.envOr("VEYDRIFT_BASE_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) rpc = vm.envOr("BASE_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forkEnabled = true;
    }

    function testUpgradeRecoveryAndMissionResolutionOnLiveState() public {
        if (!forkEnabled) return;

        RandomnessEngine engine = RandomnessEngine(RANDOMNESS_PROXY);
        ILiveVeydriftGame game = ILiveVeydriftGame(GAME_PROXY);
        address owner = engine.owner();
        address fulfiller = engine.fulfiller();
        uint256 nextRequestId = engine.nextRequestId();
        RandomnessEngine.Request memory requestBefore = engine.request(REQUEST_ID);
        (bytes32[] memory inventoryBefore,, uint256 readyBefore) =
            engine.randomnessCommitmentInventory();

        assertEq(requestBefore.randomnessCommitment, LOST_COMMITMENT);
        assertEq(requestBefore.fulfilledAt, 0);
        assertEq(requestBefore.randomWord, 0);
        assertEq(inventoryBefore.length, 8);
        assertEq(readyBefore, 8);

        RandomnessEngine implementation = new RandomnessEngine(owner, fulfiller);
        vm.prank(owner);
        engine.upgradeToAndCall(address(implementation), "");

        assertEq(engine.owner(), owner);
        assertEq(engine.fulfiller(), fulfiller);
        assertEq(engine.nextRequestId(), nextRequestId);
        assertEq(
            keccak256(abi.encode(engine.request(REQUEST_ID))), keccak256(abi.encode(requestBefore))
        );
        (bytes32[] memory inventoryAfter,, uint256 readyAfter) =
            engine.randomnessCommitmentInventory();
        assertEq(keccak256(abi.encode(inventoryAfter)), keccak256(abi.encode(inventoryBefore)));
        assertEq(readyAfter, readyBefore);

        vm.expectRevert();
        game.requireNoPendingMoonAttackResolution(ORIGIN_PLANET_ID);
        vm.expectRevert();
        game.requireNoPendingMoonAttackResolution(TARGET_PLANET_ID);

        uint256 replacementWord = uint256(keccak256("veydrift-request-2348-fork-recovery"));
        bytes32 replacementCommitment = engine.randomnessCommitment(replacementWord);
        vm.prank(owner);
        engine.recoverStaleRequestCommitment(REQUEST_ID, LOST_COMMITMENT, replacementCommitment);

        vm.expectRevert(
            abi.encodeWithSelector(
                RandomnessEngine.RandomnessCommitmentNotActive.selector,
                replacementCommitment,
                uint64(block.number)
            )
        );
        vm.prank(fulfiller);
        engine.fulfillRandomness(REQUEST_ID, replacementWord);

        vm.roll(block.number + 1);
        vm.prank(fulfiller);
        engine.fulfillRandomness(REQUEST_ID, replacementWord);
        assertTrue(engine.isFulfilled(REQUEST_ID));

        game.resolveFleetMission(MISSION_ID);
        (uint8 status,,,,,,,,,, uint256 randomnessRequestId) = game.fleetMission(MISSION_ID);
        assertEq(status, 2);
        assertEq(randomnessRequestId, REQUEST_ID);

        game.requireNoPendingMoonAttackResolution(ORIGIN_PLANET_ID);
        game.requireNoPendingMoonAttackResolution(TARGET_PLANET_ID);
    }
}
