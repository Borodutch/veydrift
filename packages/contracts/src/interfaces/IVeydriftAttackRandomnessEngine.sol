// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IVeydriftAttackRandomnessEngine {
    function requestRandomness(bytes32 purposeHash) external returns (uint256 requestId);

    function consumeRandomness(uint256 requestId, bytes32 purposeHash)
        external
        view
        returns (uint256 randomWord);
}
