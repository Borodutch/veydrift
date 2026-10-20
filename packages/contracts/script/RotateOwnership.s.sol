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

/// @notice Owner rotation (2026-10), run once per old owner key. Each env var names one contract
///         (unset = skip), applied in this order:
///         - VEYDRIFT_STATE_SIGNER_OF: MigrationSettlement whose state signer moves to the new owner;
///         - VEYDRIFT_GRANTER_OF: MoonSystem whose chicken-burn granter becomes the broadcaster (the
///           listener's hot key keeps granting burn moons, nothing else);
///         - VEYDRIFT_TRANSFER_1 / VEYDRIFT_TRANSFER_2: moved to VEYDRIFT_NEW_OWNER;
///         - VEYDRIFT_RENOUNCE: a legacy mintable resource token, renounced so nobody can mint it;
///         - then the broadcaster's ETH minus a gas buffer goes to VEYDRIFT_SWEEP_TO (default: the
///           new owner) unless VEYDRIFT_SWEEP=false.
///         Reverts unless the broadcaster owns every named contract, so nothing is silently skipped.
/// @dev The legacy referral system 0x9B9A… has an immutable owner and cannot be rotated; its
///      upgradeable replacement can (VEYDRIFT_TRANSFER_*).
contract RotateOwnership is Script {
    uint256 internal constant GAS_BUFFER = 0.0001 ether;

    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address broadcaster = vm.addr(privateKey);
        address nextOwner = vm.envAddress("VEYDRIFT_NEW_OWNER");
        address sweepTo = vm.envOr("VEYDRIFT_SWEEP_TO", nextOwner);
        address signerOf = vm.envOr("VEYDRIFT_STATE_SIGNER_OF", address(0));
        address granterOf = vm.envOr("VEYDRIFT_GRANTER_OF", address(0));
        address[2] memory transfers = [
            vm.envOr("VEYDRIFT_TRANSFER_1", address(0)), vm.envOr("VEYDRIFT_TRANSFER_2", address(0))
        ];
        address renounce = vm.envOr("VEYDRIFT_RENOUNCE", address(0));
        require(nextOwner != address(0) && nextOwner != broadcaster, "BAD_NEW_OWNER");
        require(sweepTo != address(0) && sweepTo != broadcaster, "BAD_SWEEP_TO");

        vm.startBroadcast(privateKey);
        if (signerOf != address(0)) {
            _requireOwned(signerOf, broadcaster).setStateSigner(nextOwner);
            console2.log("state signer -> new owner", signerOf);
        }
        if (granterOf != address(0)) {
            _requireOwned(granterOf, broadcaster).setChickenBurnGranter(broadcaster);
            console2.log("chicken-burn granter -> broadcaster", granterOf);
        }
        for (uint256 i; i < 2; ++i) {
            if (transfers[i] == address(0)) continue;
            IVeydriftOwnable target = _requireOwned(transfers[i], broadcaster);
            target.transferOwnership(nextOwner);
            require(target.owner() == nextOwner, "TRANSFER_FAILED");
            console2.log("transferred", address(target));
        }
        if (renounce != address(0)) {
            _requireOwned(renounce, broadcaster).renounceOwnership();
            require(IVeydriftOwnable(renounce).owner() == address(0), "RENOUNCE_FAILED");
            console2.log("renounced", renounce);
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
