// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "../src/Placeholder.sol";

contract Deploy {
    function deploy() external returns (Placeholder) {
        return new Placeholder();
    }
}
