// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";

contract Upgrade is Script {
    function run() external pure {
        revert("VeydriftGame is not upgradeable");
    }
}
