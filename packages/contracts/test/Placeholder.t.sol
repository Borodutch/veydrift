// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "../src/Placeholder.sol";

contract PlaceholderTest {
    Placeholder public placeholder;

    function setUp() public {
        placeholder = new Placeholder();
    }

    function test_InitialMessage() public view {
        assertStringEq(placeholder.message(), "Veydrift Season 0");
    }

    function test_SetMessage() public {
        placeholder.setMessage("hello");
        assertStringEq(placeholder.message(), "hello");
    }

    function assertStringEq(string memory actual, string memory expected) internal pure {
        require(keccak256(bytes(actual)) == keccak256(bytes(expected)), "strings not equal");
    }
}
