// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";

interface IVeydriftOwnable {
    function owner() external view returns (address);
    function transferOwnership(address nextOwner) external;
    function renounceOwnership() external;
    function setStateSigner(address nextSigner) external;
    function setChickenBurnGranter(address granter) external;
}

/// @notice Owner rotation (2026-10), run once per old owner key, in this order per contract:
///         - VEYDRIFT_STATE_SIGNER_OF: MigrationSettlement whose state signer moves to the new owner;
///         - VEYDRIFT_GRANTER_OF: MoonSystem whose chicken-burn granter becomes the broadcaster (the
///           listener's hot key keeps granting burn moons, nothing else);
///         - VEYDRIFT_TRANSFER: contracts moved to VEYDRIFT_NEW_OWNER;
///         - VEYDRIFT_RENOUNCE: legacy mintable resource tokens, renounced so nobody can mint them;
///         - then the broadcaster's ETH minus a gas buffer goes to VEYDRIFT_SWEEP_TO (default: the
///           new owner) unless VEYDRIFT_SWEEP=false.
///         Reverts unless the broadcaster owns every listed contract, so nothing is silently skipped.
/// @dev The referral systems have an immutable owner and cannot be rotated.
contract RotateOwnership is Script {
    uint256 internal constant GAS_BUFFER = 0.0001 ether;

    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(privateKey);
        address nextOwner = vm.envAddress("VEYDRIFT_NEW_OWNER");
        address sweepTo = vm.envOr("VEYDRIFT_SWEEP_TO", nextOwner);
        address[] memory none = new address[](0);
        address[] memory signers = vm.envOr("VEYDRIFT_STATE_SIGNER_OF", ",", none);
        address[] memory granters = vm.envOr("VEYDRIFT_GRANTER_OF", ",", none);
        address[] memory transfers = vm.envOr("VEYDRIFT_TRANSFER", ",", none);
        address[] memory renounces = vm.envOr("VEYDRIFT_RENOUNCE", ",", none);
        require(nextOwner != address(0) && nextOwner != broadcaster, "BAD_NEW_OWNER");
        require(sweepTo != address(0) && sweepTo != broadcaster, "BAD_SWEEP_TO");

        vm.startBroadcast(privateKey);
        for (uint256 i; i < signers.length; ++i) {
            _requireOwned(signers[i], broadcaster).setStateSigner(nextOwner);
            console2.log("state signer -> new owner", signers[i]);
        }
        for (uint256 i; i < granters.length; ++i) {
            _requireOwned(granters[i], broadcaster).setChickenBurnGranter(broadcaster);
            console2.log("chicken-burn granter -> broadcaster", granters[i]);
        }
        for (uint256 i; i < transfers.length; ++i) {
            IVeydriftOwnable target = _requireOwned(transfers[i], broadcaster);
            target.transferOwnership(nextOwner);
            require(target.owner() == nextOwner, "TRANSFER_FAILED");
            console2.log("transferred", address(target));
        }
        for (uint256 i; i < renounces.length; ++i) {
            IVeydriftOwnable target = _requireOwned(renounces[i], broadcaster);
            target.renounceOwnership();
            require(target.owner() == address(0), "RENOUNCE_FAILED");
            console2.log("renounced", address(target));
        }
        uint256 balance = broadcaster.balance;
        if (vm.envOr("VEYDRIFT_SWEEP", true) && balance > GAS_BUFFER) {
            (bool ok,) = payable(sweepTo).call{value: balance - GAS_BUFFER}("");
            require(ok, "SWEEP_FAILED");
            console2.log("swept wei", balance - GAS_BUFFER);
        }
        vm.stopBroadcast();
    }

    function _requireOwned(address target, address broadcaster)
        internal
        view
        returns (IVeydriftOwnable)
    {
        require(IVeydriftOwnable(target).owner() == broadcaster, "NOT_OWNER");
        return IVeydriftOwnable(target);
    }
}
