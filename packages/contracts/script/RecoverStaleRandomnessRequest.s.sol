// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {RandomnessEngine} from "../src/RandomnessEngine.sol";

/// @notice Owner-gated recovery for a stale request whose original reveal secret was lost.
contract RecoverStaleRandomnessRequest is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address payable proxy = payable(vm.envAddress("RANDOMNESS_PROXY_ADDRESS"));
        uint256 requestId = vm.envUint("RANDOMNESS_REQUEST_ID");
        bytes32 expectedCommitment = vm.envBytes32("EXPECTED_RANDOMNESS_COMMITMENT");
        bytes32 replacementCommitment = vm.envBytes32("REPLACEMENT_RANDOMNESS_COMMITMENT");
        address broadcaster = vm.addr(privateKey);

        RandomnessEngine proxied = RandomnessEngine(proxy);
        require(broadcaster == proxied.owner(), "BROADCASTER_MUST_BE_PROXY_OWNER");

        RandomnessEngine.Request memory beforeRecovery = proxied.request(requestId);
        require(beforeRecovery.requester != address(0), "UNKNOWN_RANDOMNESS_REQUEST");
        require(beforeRecovery.fulfilledAt == 0, "RANDOMNESS_REQUEST_ALREADY_FULFILLED");
        require(
            beforeRecovery.randomnessCommitment == expectedCommitment,
            "RANDOMNESS_COMMITMENT_CHANGED"
        );

        vm.startBroadcast(privateKey);
        proxied.recoverStaleRequestCommitment(requestId, expectedCommitment, replacementCommitment);
        vm.stopBroadcast();

        RandomnessEngine.Request memory afterRecovery = proxied.request(requestId);
        require(
            afterRecovery.randomnessCommitment == replacementCommitment,
            "RECOVERY_COMMITMENT_NOT_SET"
        );

        console2.log("RandomnessEngine proxy:", proxy);
        console2.log("Recovered request:", requestId);
        console2.logBytes32(expectedCommitment);
        console2.logBytes32(replacementCommitment);
    }
}
