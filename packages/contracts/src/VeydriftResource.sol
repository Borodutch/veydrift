// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply game resource token (vMETAL, vCRYSTAL, vDEUT). 0 decimals: 1 token = 1 in-game unit.
/// @dev Replaces the upgradeable VeydriftResourceToken for new deployments: the whole 50B supply is
///      minted once to `holder`, and there is no owner, minter, proxy or upgrade path.
contract VeydriftResource is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 50_000_000_000;

    error InvalidInitialHolder();

    constructor(string memory name_, string memory symbol_, address holder) ERC20(name_, symbol_) {
        if (holder == address(0)) revert InvalidInitialHolder();
        _mint(holder, INITIAL_SUPPLY);
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }
}
