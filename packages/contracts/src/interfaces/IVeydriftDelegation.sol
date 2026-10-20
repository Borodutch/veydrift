// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Player delegation surface exposed by the VeydriftGame proxy fallback.
/// @dev Two-step consent: the main wallet proposes with `setDelegate`; the binding changes only when
///      the proposed wallet calls `acceptDelegate(main)`.
interface IVeydriftDelegation {
    event DelegateUpdated(
        address indexed main,
        address indexed previousDelegate,
        address indexed delegate,
        address actor
    );
    event DelegateProposed(address indexed main, address indexed delegate);

    function delegateOf(address main) external view returns (address);
    function delegatorOf(address delegate) external view returns (address);
    function effectivePlayer(address actor) external view returns (address);
    function pendingDelegateOf(address main) external view returns (address);
    function setDelegate(address delegate) external;
    function acceptDelegate(address main) external;
    function revokeDelegate() external;
}
