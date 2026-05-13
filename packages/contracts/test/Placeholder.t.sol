// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Test.sol";
import "../src/Placeholder.sol";

contract PlaceholderTest is Test {
    Placeholder public placeholder;

    function setUp() public {
        placeholder = new Placeholder();
    }

    function test_InitialMessage() public view {
        assertEq(placeholder.message(), "Veydrift Season 0");
    }

    function test_SetMessage() public {
        placeholder.setMessage("hello");
        assertEq(placeholder.message(), "hello");
    }
}
