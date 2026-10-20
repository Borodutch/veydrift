// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Sends SEND_AMOUNT (raw units) of SEND_TOKEN from the broadcaster to SEND_TO, e.g. the
///         treasury funding the CCA wallet. Checks both balances moved by exactly that amount.
contract SendToken is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address from = vm.addr(privateKey);
        IERC20 token = IERC20(vm.envAddress("SEND_TOKEN"));
        address to = vm.envAddress("SEND_TO");
        uint256 amount = vm.envUint("SEND_AMOUNT");
        require(to != address(0) && to != from && amount > 0, "BAD_SEND");
        uint256 fromBefore = token.balanceOf(from);
        uint256 toBefore = token.balanceOf(to);

        vm.startBroadcast(privateKey);
        require(token.transfer(to, amount), "TRANSFER_FAILED");
        vm.stopBroadcast();

        require(token.balanceOf(from) == fromBefore - amount, "SENDER_DELTA");
        require(token.balanceOf(to) == toBefore + amount, "RECIPIENT_DELTA");
        console2.log("sent", amount, "to", to);
    }
}
