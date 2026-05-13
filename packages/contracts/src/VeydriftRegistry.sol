// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal Base-oriented placeholder registry for future Veydrift commitments.
/// @dev This contract intentionally avoids gameplay specifics until the onchain model is designed.
contract VeydriftRegistry {
    address public immutable owner;
    bytes32 public publicCommitment;

    event PublicCommitmentUpdated(bytes32 indexed commitment);

    error Unauthorized();

    constructor(bytes32 initialCommitment) {
        owner = msg.sender;
        publicCommitment = initialCommitment;
    }

    function setPublicCommitment(bytes32 nextCommitment) external {
        if (msg.sender != owner) {
            revert Unauthorized();
        }

        publicCommitment = nextCommitment;
        emit PublicCommitmentUpdated(nextCommitment);
    }
}
