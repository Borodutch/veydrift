// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Resource} from "../src/libraries/VeydriftTypes.sol";

interface IRiftGame {
    struct Resources {
        uint128 metal;
        uint128 crystal;
        uint128 deuterium;
    }

    function resourceToken(Resource resource) external view returns (address);
    function homePlanetOf(address player) external view returns (uint256);
    function depositMarketResource(uint256 planetId, Resource resource, uint128 amount) external;
    function startRiftExtraction(uint256 planetId, Resource resource, uint128 amount) external;
    function finalizeRiftExtraction(uint256 planetId, Resource resource) external;
    function riftLockedResources(uint256 planetId) external view returns (Resources memory);
    function totalInternalResources() external view returns (Resources memory);
}

/// @notice Rift round trip on live Base state with the fixed-supply resource tokens: inject vMETAL
///         into a planet with a Rift Stabilizer, extract it, and get the tokens back after 28 days.
contract RiftNewTokensMainnetForkTest is Test {
    IRiftGame internal constant GAME = IRiftGame(0xf397910F005151b09644228573a4353818D3755d);
    IERC20 internal constant METAL = IERC20(0xbD87aa148f2586D1f1499C5370f8bd05ee147209);
    address internal constant TREASURY = 0x2732e87c9b9A9Ce3C1C78968B12F56Ec74D1c9d7;
    address internal constant PLAYER = 0xbf74483DB914192bb0a9577f3d8Fb29a6d4c08eE; // planet 1 has a stabilizer
    uint128 internal constant AMOUNT = 10 * 10 ** 6; // 10 vMETAL = 10,000,000 metal

    function testInjectExtractAndFinalizeWithNewTokens() external {
        if (block.chainid != 8453) {
            string memory rpc = vm.envOr("VEYDRIFT_BASE_MAINNET_RPC_URL", string(""));
            if (bytes(rpc).length == 0) {
                emit log("VEYDRIFT_BASE_MAINNET_RPC_URL unset - skipping Rift fork");
                return;
            }
            vm.createSelectFork(rpc);
        }
        assertEq(GAME.resourceToken(Resource.Metal), address(METAL), "Game uses the new vMETAL");
        uint256 planetId = GAME.homePlanetOf(PLAYER);
        vm.prank(TREASURY);
        assertTrue(METAL.transfer(PLAYER, AMOUNT));

        // Inject: the tokens move into the Game and become in-game metal on the planet.
        uint256 gameBefore = METAL.balanceOf(address(GAME));
        uint256 playerBefore = METAL.balanceOf(PLAYER);
        uint128 ledgerBefore = GAME.totalInternalResources().metal;
        vm.startPrank(PLAYER);
        METAL.approve(address(GAME), AMOUNT);
        GAME.depositMarketResource(planetId, Resource.Metal, AMOUNT);
        assertEq(METAL.balanceOf(address(GAME)), gameBefore + AMOUNT);
        assertEq(METAL.balanceOf(PLAYER), playerBefore - AMOUNT);
        assertGe(GAME.totalInternalResources().metal, ledgerBefore + AMOUNT);

        // Extract: locked on the planet for 28 days, then paid out in the new token.
        GAME.startRiftExtraction(planetId, Resource.Metal, AMOUNT);
        assertEq(GAME.riftLockedResources(planetId).metal, AMOUNT);
        vm.expectRevert();
        GAME.finalizeRiftExtraction(planetId, Resource.Metal);
        vm.warp(block.timestamp + 28 days);
        GAME.finalizeRiftExtraction(planetId, Resource.Metal);
        vm.stopPrank();
        assertEq(METAL.balanceOf(PLAYER), playerBefore);
        assertEq(GAME.riftLockedResources(planetId).metal, 0);
    }
}
