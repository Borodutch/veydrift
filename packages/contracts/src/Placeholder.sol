// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

contract Placeholder {
    string public message = "Veydrift Season 0";

    function setMessage(string calldata _message) external {
        message = _message;
    }
}
