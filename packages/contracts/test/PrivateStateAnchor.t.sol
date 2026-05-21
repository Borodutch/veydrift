// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PrivateStateAnchor} from "../src/PrivateStateAnchor.sol";

contract PrivateStateAnchorTest is Test {
    address private owner = address(0xA11CE);
    address private oracle = address(0xBEEF);
    address private player = address(0xB0B);
    address private attacker = address(0xBAD);
    PrivateStateAnchor private anchor;

    bytes32 private initialRoot = keccak256("planet-state-root-1");
    bytes32 private nextRoot = keccak256("planet-state-root-2");
    bytes32 private transition1 = keccak256("transition-1");
    bytes32 private transition2 = keccak256("transition-2");

    function setUp() public {
        anchor = new PrivateStateAnchor(owner, oracle);
    }

    function testOracleInitializesAndUpdatesPlanetStateRoot() public {
        vm.prank(oracle);
        anchor.initializePlanetState(7, player, 2, 44, 9, initialRoot, transition1);

        PrivateStateAnchor.PlanetAnchor memory stored = anchor.planetAnchor(7);
        assertEq(stored.owner, player);
        assertEq(stored.galaxy, 2);
        assertEq(stored.system, 44);
        assertEq(stored.position, 9);
        assertEq(stored.stateRoot, initialRoot);
        assertEq(stored.epoch, 1);

        vm.prank(oracle);
        anchor.updatePlanetState(7, player, initialRoot, nextRoot, 2, transition2, 0, false);

        stored = anchor.planetAnchor(7);
        assertEq(stored.stateRoot, nextRoot);
        assertEq(stored.epoch, 2);
        assertEq(stored.lastTransitionHash, transition2);
    }

    function testUnauthorizedReplayAndEpochChecksRevert() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(PrivateStateAnchor.UnauthorizedOracle.selector, attacker)
        );
        anchor.initializePlanetState(7, player, 2, 44, 9, initialRoot, transition1);

        vm.prank(oracle);
        anchor.initializePlanetState(7, player, 2, 44, 9, initialRoot, transition1);

        vm.prank(oracle);
        vm.expectRevert(
            abi.encodeWithSelector(PrivateStateAnchor.TransitionAlreadyUsed.selector, transition1)
        );
        anchor.updatePlanetState(7, player, initialRoot, nextRoot, 2, transition1, 0, false);

        vm.prank(oracle);
        vm.expectRevert(
            abi.encodeWithSelector(PrivateStateAnchor.EpochNotIncreasing.selector, 1, 1)
        );
        anchor.updatePlanetState(7, player, initialRoot, nextRoot, 1, transition2, 0, false);
    }

    function testPreviousRootOwnerAndRandomnessBlocking() public {
        vm.prank(oracle);
        anchor.initializePlanetState(7, player, 2, 44, 9, initialRoot, transition1);

        vm.prank(oracle);
        vm.expectRevert(
            abi.encodeWithSelector(
                PrivateStateAnchor.PreviousRootMismatch.selector, initialRoot, keccak256("wrong")
            )
        );
        anchor.updatePlanetState(7, player, keccak256("wrong"), nextRoot, 2, transition2, 0, false);

        vm.prank(oracle);
        vm.expectRevert(
            abi.encodeWithSelector(PrivateStateAnchor.OwnerMismatch.selector, player, attacker)
        );
        anchor.updatePlanetState(7, attacker, initialRoot, nextRoot, 2, transition2, 0, false);

        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSelector(PrivateStateAnchor.RandomnessPending.selector, 99));
        anchor.updatePlanetState(7, player, initialRoot, nextRoot, 2, transition2, 99, false);
    }
}
