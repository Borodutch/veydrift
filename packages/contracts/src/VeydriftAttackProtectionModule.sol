// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";

/// @notice Delegatecall target for attack protection previews shared by gameplay and combat.
contract VeydriftAttackProtectionModule is VeydriftResourceReserves {
    constructor() VeydriftResourceReserves(address(0)) {}

    function attackProtectionStatus(address attacker, uint256 targetPlanetId)
        external
        view
        returns (AttackBlockReason blockedReason, uint8 flags, uint16 plunderBps)
    {
        return _attackProtectionStatus(attacker, targetPlanetId);
    }
}
