// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Small reusable external decoder for the moon-system's wide `moon`
///         tuple. Keeping this ABI decode out of DefenseHold preserves enough
///         EIP-170 headroom for the production module.
contract VeydriftMoonPresence {
    function existsForOwner(address moonSystem, uint256 planetId, address owner_)
        external
        view
        returns (bool)
    {
        if (moonSystem == address(0)) return false;
        (bool ok, bytes memory data) =
            moonSystem.staticcall(abi.encodeWithSignature("moon(uint256)", planetId));
        if (!ok || data.length < 96) return false;
        (bool exists,, address moonOwner,,,,) =
            abi.decode(data, (bool, uint256, address, uint16, uint16, uint64, uint64));
        return exists && moonOwner == owner_;
    }
}
