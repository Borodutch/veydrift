// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {VeydriftReferralSystem} from "../src/VeydriftReferralSystem.sol";
import {ReferralProxy} from "./support/ReferralProxy.sol";

contract VeydriftReferralSystemUpgradeTest is Test {
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    address private constant OWNER = address(0xA11CE);
    VeydriftReferralSystem private referral;

    function setUp() public {
        referral = ReferralProxy.deploy(OWNER);
    }

    function testProxyInitializesOnceAndImplementationIsLocked() public {
        assertEq(referral.owner(), OWNER);
        assertEq(referral.game(), address(0));
        assertEq(referral.referralSigner(), address(0));
        assertFalse(referral.referralMigrationFinalized());
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        referral.initialize(address(0xBAD));

        VeydriftReferralSystem implementation = VeydriftReferralSystem(_implementation());
        assertEq(implementation.owner(), address(0));
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        implementation.initialize(address(0xBAD));

        address fresh = address(new VeydriftReferralSystem());
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftReferralSystem.Unauthorized.selector, address(0))
        );
        new ERC1967Proxy(fresh, abi.encodeCall(VeydriftReferralSystem.initialize, (address(0))));
    }

    function testOwnerTransfersOwnershipAndOldOwnerLosesControl() public {
        address nextOwner = address(0xB0B);
        vm.prank(address(0xBAD));
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftReferralSystem.Unauthorized.selector, address(0xBAD))
        );
        referral.transferOwnership(nextOwner);
        vm.prank(OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftReferralSystem.Unauthorized.selector, address(0))
        );
        referral.transferOwnership(address(0));

        vm.expectEmit(address(referral));
        emit OwnershipTransferred(OWNER, nextOwner);
        vm.prank(OWNER);
        referral.transferOwnership(nextOwner);
        assertEq(referral.owner(), nextOwner);

        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(VeydriftReferralSystem.Unauthorized.selector, OWNER));
        referral.setReferralSigner(address(0xCAFE));
        vm.prank(nextOwner);
        referral.setReferralSigner(address(0xCAFE));
        assertEq(referral.referralSigner(), address(0xCAFE));
    }

    function testOnlyOwnerUpgradesThroughProxyAndStatePersists() public {
        vm.startPrank(OWNER);
        referral.setReferralSigner(address(0xCAFE));
        referral.setGame(address(0x6A3E));
        vm.stopPrank();
        address nextImplementation = address(new VeydriftReferralSystem());

        vm.prank(address(0xBAD));
        vm.expectRevert(
            abi.encodeWithSelector(VeydriftReferralSystem.Unauthorized.selector, address(0xBAD))
        );
        referral.upgradeToAndCall(nextImplementation, "");
        vm.expectRevert(UUPSUpgradeable.UUPSUnauthorizedCallContext.selector);
        VeydriftReferralSystem(_implementation()).upgradeToAndCall(nextImplementation, "");
        vm.prank(OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(
                ERC1967Utils.ERC1967InvalidImplementation.selector, address(this)
            )
        );
        referral.upgradeToAndCall(address(this), "");

        vm.prank(OWNER);
        referral.upgradeToAndCall(nextImplementation, "");
        assertEq(_implementation(), nextImplementation);
        assertEq(referral.owner(), OWNER);
        assertEq(referral.referralSigner(), address(0xCAFE));
        assertEq(referral.game(), address(0x6A3E));
    }

    function _implementation() private view returns (address) {
        return
            address(uint160(uint256(vm.load(address(referral), ERC1967Utils.IMPLEMENTATION_SLOT))));
    }
}
