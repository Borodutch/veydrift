// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20ReserveToken, VeydriftGameStorage} from "../VeydriftGameStorage.sol";
import {Resource} from "./VeydriftTypes.sol";

/// @notice Deployed reserve-release logic for the size-constrained game module set.
/// @dev The public library call is a nested delegatecall, so it reads and writes the game proxy's
///      storage when invoked by a game module. It has no standalone authority or persistent state.
library VeydriftReserveRelease {
    function release(
        mapping(Resource resource => IERC20ReserveToken token) storage resourceTokens,
        VeydriftGameStorage.Resources storage totalInternalResources,
        VeydriftGameStorage.Resources storage lockedWithdrawalResources,
        address treasury,
        VeydriftGameStorage.Resources calldata amount,
        VeydriftGameStorage.Resources calldata safetyMargin
    ) public {
        if (treasury == address(0) || treasury == address(this)) {
            revert VeydriftGameStorage.InvalidResourceTreasury();
        }

        _release(
            resourceTokens,
            Resource.Metal,
            treasury,
            amount.metal,
            uint256(totalInternalResources.metal) + lockedWithdrawalResources.metal,
            safetyMargin.metal
        );
        _release(
            resourceTokens,
            Resource.Crystal,
            treasury,
            amount.crystal,
            uint256(totalInternalResources.crystal) + lockedWithdrawalResources.crystal,
            safetyMargin.crystal
        );
        _release(
            resourceTokens,
            Resource.Deuterium,
            treasury,
            amount.deuterium,
            uint256(totalInternalResources.deuterium) + lockedWithdrawalResources.deuterium,
            safetyMargin.deuterium
        );
    }

    function _release(
        mapping(Resource resource => IERC20ReserveToken token) storage resourceTokens,
        Resource resource,
        address treasury,
        uint128 amount,
        uint256 liabilityRequirement,
        uint128 safetyMargin
    ) private {
        IERC20ReserveToken token = resourceTokens[resource];
        if (address(token) == address(0)) {
            revert VeydriftGameStorage.ResourceTokenUnset(resource);
        }

        uint256 beforeBalance = token.balanceOf(address(this));
        uint256 minimumRemaining = liabilityRequirement + uint256(safetyMargin);
        if (beforeBalance < amount || beforeBalance - amount < minimumRemaining) {
            revert VeydriftGameStorage.InsufficientExcessResourceReserve(
                resource, amount, liabilityRequirement, safetyMargin, beforeBalance
            );
        }
        if (amount == 0) return;

        uint256 recipientBefore = token.balanceOf(treasury);
        if (!token.transfer(treasury, amount)) {
            revert VeydriftGameStorage.ResourceTransferFailed(resource, address(token), amount);
        }
        uint256 afterBalance = token.balanceOf(address(this));
        uint256 recipientAfter = token.balanceOf(treasury);
        if (
            afterBalance > beforeBalance || beforeBalance - afterBalance != amount
                || recipientAfter < recipientBefore || recipientAfter - recipientBefore != amount
        ) {
            revert VeydriftGameStorage.ResourceTransferFailed(resource, address(token), amount);
        }

        emit VeydriftGameStorage.ExcessResourceReserveReleased(
            resource, treasury, amount, liabilityRequirement, safetyMargin, afterBalance
        );
    }
}
