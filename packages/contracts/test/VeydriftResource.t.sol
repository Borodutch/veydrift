// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftResource} from "../src/VeydriftResource.sol";

contract VeydriftResourceTest is Test {
    function testWholeFixedSupplyGoesToHolder() public {
        address holder = makeAddr("treasury");
        VeydriftResource token = new VeydriftResource("Veydrift Metal", "vMETAL", holder);

        assertEq(token.decimals(), 6);
        assertEq(token.totalSupply(), 10_000_000_000 * 10 ** 6);
        assertEq(token.balanceOf(holder), token.totalSupply());
        assertEq(token.symbol(), "vMETAL");
    }

    function testRejectsZeroHolder() public {
        vm.expectRevert(VeydriftResource.InvalidInitialHolder.selector);
        new VeydriftResource("Veydrift Metal", "vMETAL", address(0));
    }

    function testHasNoMintOrOwnerSurface() public {
        VeydriftResource token = new VeydriftResource("Veydrift Metal", "vMETAL", address(this));
        (bool minted,) =
            address(token).call(abi.encodeWithSignature("mint(address,uint256)", address(this), 1));
        (bool owned,) = address(token).call(abi.encodeWithSignature("owner()"));
        assertFalse(minted);
        assertFalse(owned);
        assertEq(token.totalSupply(), token.INITIAL_SUPPLY());
    }
}
