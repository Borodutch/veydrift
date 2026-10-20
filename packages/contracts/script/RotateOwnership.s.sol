// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";

interface IVeydriftOwnable {
    function owner() external view returns (address);
    function transferOwnership(address nextOwner) external;
    function renounceOwnership() external;
}

/// @notice Owner rotation (2026-10), run once per old owner key. Every contract in VEYDRIFT_TRANSFER
///         moves to VEYDRIFT_NEW_OWNER, every contract in VEYDRIFT_RENOUNCE (the legacy mintable
///         resource tokens) is renounced, then the broadcaster's ETH minus a gas buffer goes to
///         VEYDRIFT_SWEEP_TO (default: the new owner). Reverts unless the broadcaster owns each listed
///         contract, so a wrong list or a bad read can't silently skip one.
/// @dev The referral systems have an immutable owner and cannot be rotated.
contract RotateOwnership is Script {
    uint256 internal constant GAS_BUFFER = 0.0001 ether;

    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(privateKey);
        address nextOwner = vm.envAddress("VEYDRIFT_NEW_OWNER");
        address sweepTo = vm.envOr("VEYDRIFT_SWEEP_TO", nextOwner);
        address[] memory transfers = vm.envOr("VEYDRIFT_TRANSFER", ",", new address[](0));
        address[] memory renounces = vm.envOr("VEYDRIFT_RENOUNCE", ",", new address[](0));
        require(nextOwner != address(0) && nextOwner != broadcaster, "BAD_NEW_OWNER");
        require(sweepTo != address(0) && sweepTo != broadcaster, "BAD_SWEEP_TO");

        vm.startBroadcast(privateKey);
        for (uint256 i; i < transfers.length; ++i) {
            IVeydriftOwnable target = IVeydriftOwnable(transfers[i]);
            require(target.owner() == broadcaster, "NOT_OWNER");
            target.transferOwnership(nextOwner);
            require(target.owner() == nextOwner, "TRANSFER_FAILED");
            console2.log("transferred", address(target));
        }
        for (uint256 i; i < renounces.length; ++i) {
            IVeydriftOwnable target = IVeydriftOwnable(renounces[i]);
            require(target.owner() == broadcaster, "NOT_OWNER");
            target.renounceOwnership();
            require(target.owner() == address(0), "RENOUNCE_FAILED");
            console2.log("renounced", address(target));
        }
        uint256 balance = broadcaster.balance;
        if (balance > GAS_BUFFER) {
            (bool ok,) = payable(sweepTo).call{value: balance - GAS_BUFFER}("");
            require(ok, "SWEEP_FAILED");
            console2.log("swept wei", balance - GAS_BUFFER);
        }
        vm.stopBroadcast();
    }
}
