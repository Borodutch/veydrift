// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {
    IVeydriftMoonGame,
    IVeydriftRandomnessEngine,
    VeydriftMoonSystem
} from "../src/VeydriftMoonSystem.sol";

/// @notice Exact Base-mainnet storage/wiring proof for the Moon defense FIFO upgrade.
/// @dev Inert unless VEYDRIFT_BASE_MAINNET_RPC_URL is set.
contract VeydriftMoonDefenseQueueMainnetForkTest is Test {
    bytes32 private constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    address payable private constant MOON_PROXY =
        payable(0x4935f1E0024F1Ea07877a583F89A51BF3d91Cf5C);

    function testLiveMoonUpgradePreservesExistingStateAndAddsEmptyBacklogs() public {
        string memory rpc = vm.envOr("VEYDRIFT_BASE_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        VeydriftMoonSystem proxied = VeydriftMoonSystem(MOON_PROXY);
        address ownerBefore = proxied.owner();
        IVeydriftMoonGame gameBefore = proxied.game();
        IVeydriftRandomnessEngine randomnessBefore = proxied.randomness();
        address implementationBefore = _implementation();
        bytes32 moon41Before = keccak256(abi.encode(proxied.moon(41)));
        bytes32 moon301Before = keccak256(abi.encode(proxied.moon(301)));
        bytes32 queue41Before = keccak256(abi.encode(proxied.activeMoonDefenseQueue(41)));
        bytes32 queue301Before = keccak256(abi.encode(proxied.activeMoonDefenseQueue(301)));

        VeydriftMoonSystem next =
            new VeydriftMoonSystem(address(gameBefore), address(randomnessBefore));
        vm.prank(ownerBefore);
        proxied.upgradeToAndCall(address(next), "");

        assertEq(_implementation(), address(next));
        assertNotEq(_implementation(), implementationBefore);
        assertEq(proxied.owner(), ownerBefore);
        assertEq(address(proxied.game()), address(gameBefore));
        assertEq(address(proxied.randomness()), address(randomnessBefore));
        assertEq(keccak256(abi.encode(proxied.moon(41))), moon41Before);
        assertEq(keccak256(abi.encode(proxied.moon(301))), moon301Before);
        assertEq(keccak256(abi.encode(proxied.activeMoonDefenseQueue(41))), queue41Before);
        assertEq(keccak256(abi.encode(proxied.activeMoonDefenseQueue(301))), queue301Before);
        assertEq(proxied.moonDefenseQueueBacklog(41).length, 0);
        assertEq(proxied.moonDefenseQueueBacklog(301).length, 0);
    }

    function _implementation() private view returns (address) {
        return address(uint160(uint256(vm.load(MOON_PROXY, IMPLEMENTATION_SLOT))));
    }
}
