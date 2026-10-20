// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

/// @notice Proves the live VEYDRIFT vesting wallets pay the treasury on schedule and leave nothing
///         stuck: permissionless `release` at the cliff, midway and after the end, on live Base state.
contract VestingReleaseMainnetForkTest is Test {
    IERC20 internal constant VEYDRIFT = IERC20(0x442E9Ba64899d6B0bD25DF2558d3E804427bF448);
    address internal constant TREASURY = 0x2732e87c9b9A9Ce3C1C78968B12F56Ec74D1c9d7;
    VestingWallet internal constant DEVELOPMENT =
        VestingWallet(payable(0xB2554e9e2B201F299d8f0fF8A522FAd3057E87A4));
    VestingWallet internal constant CONTRIBUTOR =
        VestingWallet(payable(0x4A55cff3006e87360285969dD366acBd79445BeD));
    VestingWallet internal constant ECOSYSTEM =
        VestingWallet(payable(0x64C323e8ef7D6df9730E64627d7755c9A1050162));
    uint256 internal constant START = 1_792_699_200; // 2026-10-22 20:00 UTC

    function testEveryWalletReleasesEverythingToTheTreasury() external {
        if (!_onBase()) return;

        assertEq(DEVELOPMENT.owner(), TREASURY);
        assertEq(CONTRIBUTOR.owner(), TREASURY);
        assertEq(ECOSYSTEM.owner(), TREASURY);

        // Nothing before the start, and nothing from the contributor wallet before its 1-year cliff.
        vm.warp(START - 1);
        assertEq(DEVELOPMENT.releasable(address(VEYDRIFT)), 0);
        vm.warp(START + 365 days - 1);
        assertEq(CONTRIBUTOR.releasable(address(VEYDRIFT)), 0);
        assertApproxEqAbs(DEVELOPMENT.releasable(address(VEYDRIFT)), 50_000_000 ether, 2 ether);

        // At the cliff the contributor wallet has vested exactly a quarter.
        vm.warp(START + 365 days);
        assertEq(CONTRIBUTOR.releasable(address(VEYDRIFT)), 50_000_000 ether);
        _release(CONTRIBUTOR, 50_000_000 ether);

        // Midway releases are linear (anyone may call; tokens always go to the owner).
        vm.warp(START + 3 * 365 days);
        _release(ECOSYSTEM, 100_000_000 ether);
        _release(DEVELOPMENT, 150_000_000 ether);

        // After the last end date every wallet is empty and the treasury got all 650M.
        uint256 before = VEYDRIFT.balanceOf(TREASURY);
        vm.warp(START + 6 * 365 days);
        DEVELOPMENT.release(address(VEYDRIFT));
        CONTRIBUTOR.release(address(VEYDRIFT));
        ECOSYSTEM.release(address(VEYDRIFT));
        assertEq(VEYDRIFT.balanceOf(address(DEVELOPMENT)), 0);
        assertEq(VEYDRIFT.balanceOf(address(CONTRIBUTOR)), 0);
        assertEq(VEYDRIFT.balanceOf(address(ECOSYSTEM)), 0);
        assertEq(VEYDRIFT.balanceOf(TREASURY) - before, (100 + 150 + 100) * 1_000_000 ether);
    }

    /// The one way to lock them forever: renouncing a wallet's ownership makes every release revert.
    function testRenouncingOwnershipWouldLockTheRest() external {
        if (!_onBase()) return;
        vm.prank(TREASURY);
        ECOSYSTEM.renounceOwnership();
        vm.warp(START + 6 * 365 days);
        vm.expectRevert();
        ECOSYSTEM.release(address(VEYDRIFT));
    }

    /// `plain test --fork base` starts on Base already; forge forks from the env RPC.
    function _onBase() internal returns (bool) {
        if (block.chainid == 8453) return true;
        string memory rpc = vm.envOr("VEYDRIFT_BASE_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            emit log("VEYDRIFT_BASE_MAINNET_RPC_URL unset - skipping vesting fork");
            return false;
        }
        vm.createSelectFork(rpc);
        return true;
    }

    function _release(VestingWallet wallet, uint256 expected) internal {
        uint256 before = VEYDRIFT.balanceOf(TREASURY);
        vm.prank(address(0xBEEF));
        wallet.release(address(VEYDRIFT));
        assertApproxEqAbs(VEYDRIFT.balanceOf(TREASURY) - before, expected, 2 ether);
    }
}
