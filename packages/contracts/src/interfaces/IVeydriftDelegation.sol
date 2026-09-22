// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Player delegation surface exposed by the VeydriftGame proxy fallback.
interface IVeydriftDelegation {
    event DelegateUpdated(
        address indexed main,
        address indexed previousDelegate,
        address indexed delegate,
        address actor
    );

    function delegateOf(address main) external view returns (address);
    function delegatorOf(address delegate) external view returns (address);
    function effectivePlayer(address actor) external view returns (address);
    function setDelegate(address delegate) external;
    function revokeDelegate() external;
}
