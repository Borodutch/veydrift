// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftSettlement} from "../src/VeydriftSettlement.sol";

contract VeydriftSettlementTest is Test {
    VeydriftSettlement internal settlement;
    address internal player = address(0xB0B);

    event FirstPlanetSettled(
        address indexed player,
        uint16 indexed galaxy,
        uint16 indexed system,
        uint8 position,
        bytes32 coordinateKey,
        bytes32 planetSeed
    );

    function setUp() public {
        settlement = new VeydriftSettlement(keccak256("test-universe"));
    }

    function testFirstMintStoresOwnerCoordinateAndEmitsEvent() public {
        vm.roll(12_345);
        vm.warp(1_800_000_000);
        vm.prevrandao(keccak256("first settlement entropy"));

        VeydriftSettlement.FirstPlanet memory preview = settlement.previewFirstPlanet(player);

        vm.expectEmit(true, true, true, true, address(settlement));
        emit FirstPlanetSettled(
            player,
            preview.galaxy,
            preview.system,
            preview.position,
            preview.coordinateKey,
            preview.planetSeed
        );

        vm.prank(player);
        VeydriftSettlement.FirstPlanet memory planet = settlement.settleFirstPlanet();

        assertTrue(settlement.hasFirstPlanet(player));
        assertEq(
            settlement.ownerOfCoordinate(planet.galaxy, planet.system, planet.position), player
        );
        assertEq(planet.galaxy, preview.galaxy);
        assertEq(planet.system, preview.system);
        assertEq(planet.position, preview.position);
        assertEq(planet.coordinateKey, preview.coordinateKey);
        assertEq(planet.planetSeed, preview.planetSeed);
        assertEq(planet.settledAt, block.timestamp);
        assertEq(planet.settledBlock, block.number);
    }

    function testDuplicateFirstMintIsRejected() public {
        vm.prank(player);
        settlement.settleFirstPlanet();

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(VeydriftSettlement.AlreadySettled.selector, player));
        settlement.settleFirstPlanet();
    }

    function testGeneratedCoordinateBoundsAndDeterministicMapping() public {
        for (uint160 i = 1; i <= 32; i++) {
            address account = address(i);
            vm.roll(20_000 + i);
            vm.warp(1_800_001_000 + i);
            vm.prevrandao(bytes32(uint256(i)));

            VeydriftSettlement.FirstPlanet memory preview = settlement.previewFirstPlanet(account);

            assertGe(preview.galaxy, 1);
            assertLe(preview.galaxy, settlement.GALAXY_COUNT());
            assertGe(preview.system, 1);
            assertLe(preview.system, settlement.SYSTEM_COUNT());
            assertGe(preview.position, 1);
            assertLe(preview.position, settlement.PLANET_SLOTS());
            assertEq(
                preview.coordinateKey,
                settlement.coordinateKey(preview.galaxy, preview.system, preview.position)
            );
            assertEq(
                preview.planetSeed,
                settlement.planetSeed(preview.galaxy, preview.system, preview.position)
            );
        }
    }

    function testInvalidCoordinateIsRejected() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftSettlement.InvalidCoordinate.selector, uint16(0), uint16(1), uint8(1)
            )
        );
        settlement.coordinateKey(0, 1, 1);
    }
}
