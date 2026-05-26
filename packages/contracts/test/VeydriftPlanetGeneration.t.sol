// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftPlanetGeneration} from "../src/libraries/VeydriftPlanetGeneration.sol";

contract VeydriftPlanetGenerationHarness {
    function coordinateKey(
        uint256 chainId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        uint16 maxGalaxy,
        uint16 maxSystem,
        uint8 maxPosition
    ) external pure returns (bytes32) {
        return VeydriftPlanetGeneration.coordinateKey(
            chainId, galaxy, system, position, maxGalaxy, maxSystem, maxPosition
        );
    }

    function planetSeed(
        bytes32 domain,
        uint256 chainId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        uint16 maxGalaxy,
        uint16 maxSystem,
        uint8 maxPosition
    ) external pure returns (bytes32) {
        return VeydriftPlanetGeneration.planetSeed(
            domain, chainId, galaxy, system, position, maxGalaxy, maxSystem, maxPosition
        );
    }

    function firstPlanetCandidate(
        bytes32 domain,
        uint256 chainId,
        address player,
        uint256 blockNumber,
        uint256 timestamp,
        uint256 prevrandao,
        uint256 attempt,
        uint16 maxGalaxy,
        uint16 maxSystem,
        uint8 maxPosition
    ) external pure returns (uint16, uint16, uint8, uint16, int16) {
        return VeydriftPlanetGeneration.firstPlanetCandidate(
            domain,
            chainId,
            player,
            blockNumber,
            timestamp,
            prevrandao,
            attempt,
            maxGalaxy,
            maxSystem,
            maxPosition
        );
    }

    function slotMaxTemperatureProfile(uint8 position) external pure returns (int16, int16) {
        return VeydriftPlanetGeneration.slotMaxTemperatureProfile(position);
    }
}

contract VeydriftPlanetGenerationTest is Test {
    bytes32 internal constant FIRST_PLANET_DOMAIN = keccak256("veydrift.first-planet.v1");
    bytes32 internal constant PLANET_SEED_DOMAIN = keccak256("veydrift.planet.v1");
    uint16 internal constant MAX_GALAXY = 9;
    uint16 internal constant MAX_SYSTEM = 499;
    uint8 internal constant MAX_POSITION = 15;

    VeydriftPlanetGenerationHarness internal harness;

    function setUp() public {
        harness = new VeydriftPlanetGenerationHarness();
    }

    function testFirstPlanetCandidateIsDeterministicAndInBounds() public view {
        (uint16 galaxy, uint16 system, uint8 position, uint16 fields, int16 temperature) = harness.firstPlanetCandidate(
            FIRST_PLANET_DOMAIN,
            84_532,
            address(0xB0B),
            12_345,
            1_800_000_000,
            uint256(keccak256("entropy")),
            3,
            MAX_GALAXY,
            MAX_SYSTEM,
            MAX_POSITION
        );

        (
            uint16 sameGalaxy,
            uint16 sameSystem,
            uint8 samePosition,
            uint16 sameFields,
            int16 sameTemperature
        ) = harness.firstPlanetCandidate(
            FIRST_PLANET_DOMAIN,
            84_532,
            address(0xB0B),
            12_345,
            1_800_000_000,
            uint256(keccak256("entropy")),
            3,
            MAX_GALAXY,
            MAX_SYSTEM,
            MAX_POSITION
        );

        assertGe(galaxy, 1);
        assertLe(galaxy, MAX_GALAXY);
        assertGe(system, 1);
        assertLe(system, MAX_SYSTEM);
        assertGe(position, 1);
        assertLe(position, MAX_POSITION);
        assertGe(fields, 160);
        assertLt(fields, 240);
        assertEq(galaxy, sameGalaxy);
        assertEq(system, sameSystem);
        assertEq(position, samePosition);
        assertEq(fields, sameFields);
        assertEq(temperature, sameTemperature);
    }

    function testSlotTemperatureProfilesKeepVeydriftBands() public view {
        (int16 innerMin, int16 innerMax) = harness.slotMaxTemperatureProfile(1);
        (int16 middleMin, int16 middleMax) = harness.slotMaxTemperatureProfile(8);
        (int16 outerMin, int16 outerMax) = harness.slotMaxTemperatureProfile(15);

        assertEq(innerMin, 40);
        assertEq(innerMax, 120);
        assertEq(middleMin, -40);
        assertEq(middleMax, 40);
        assertEq(outerMin, -120);
        assertEq(outerMax, -20);
        assertGt(innerMax, middleMax);
        assertGt(middleMax, outerMax);
    }

    function testCoordinateHelpersValidateBounds() public {
        bytes32 key = harness.coordinateKey(84_532, 1, 1, 1, MAX_GALAXY, MAX_SYSTEM, MAX_POSITION);
        bytes32 seed = harness.planetSeed(
            PLANET_SEED_DOMAIN, 84_532, 1, 1, 1, MAX_GALAXY, MAX_SYSTEM, MAX_POSITION
        );

        assertEq(key, keccak256(abi.encode(uint256(84_532), uint16(1), uint16(1), uint8(1))));
        assertEq(
            seed,
            keccak256(
                abi.encode(PLANET_SEED_DOMAIN, uint256(84_532), uint16(1), uint16(1), uint8(1))
            )
        );

        vm.expectRevert(VeydriftPlanetGeneration.InvalidCoordinates.selector);
        harness.coordinateKey(84_532, 0, 1, 1, MAX_GALAXY, MAX_SYSTEM, MAX_POSITION);
    }
}
