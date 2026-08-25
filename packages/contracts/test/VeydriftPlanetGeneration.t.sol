// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {VeydriftFormulas} from "../src/libraries/VeydriftFormulas.sol";
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

    function slotTemperature(uint8 position, uint256 lowRoll, uint256 highRoll)
        external
        pure
        returns (int16)
    {
        return VeydriftPlanetGeneration.slotTemperature(position, lowRoll, highRoll);
    }

    function migrateLegacyTemperature(uint8 position, int16 temperature)
        external
        pure
        returns (int16)
    {
        return VeydriftPlanetGeneration.migrateLegacyTemperature(position, temperature);
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

    function testSlotTemperatureProfilesMatchClassicPerSlotRanges() public view {
        int16[15] memory expectedMinimums =
            [int16(220), 170, 120, 70, 60, 50, 40, 30, 20, 10, 0, -10, -50, -90, -130];

        for (uint8 position = 1; position <= 15; ++position) {
            (int16 minValue, int16 maxValue) = harness.slotMaxTemperatureProfile(position);
            int16 expectedMinimum = expectedMinimums[position - 1];
            assertEq(minValue, expectedMinimum);
            assertEq(maxValue, expectedMinimum + 40);
            assertEq(harness.slotTemperature(position, 0, 0), minValue);
            assertEq(harness.slotTemperature(position, 10, 10), minValue + 20);
            assertEq(harness.slotTemperature(position, 20, 20), maxValue);
        }
    }

    function testClassicHotSlotsYieldMoreThanThirtySixSolarSatelliteEnergy() public view {
        assertEq(VeydriftFormulas.solarSatelliteEnergy(harness.slotTemperature(1, 0, 0)), 60);
        assertEq(VeydriftFormulas.solarSatelliteEnergy(harness.slotTemperature(1, 20, 20)), 65);
        assertEq(VeydriftFormulas.solarSatelliteEnergy(harness.slotTemperature(2, 0, 0)), 51);
        assertEq(VeydriftFormulas.solarSatelliteEnergy(harness.slotTemperature(3, 0, 0)), 43);
    }

    function testLegacyMigrationPreservesTheOriginalCenteredRollForEverySlot() public view {
        int16[5] memory legacyMinimums = [int16(40), -10, -40, -80, -120];
        int16[15] memory classicMinimums =
            [int16(220), 170, 120, 70, 60, 50, 40, 30, 20, 10, 0, -10, -50, -90, -130];

        for (uint8 position = 1; position <= 15; ++position) {
            int16 legacyMinimum = legacyMinimums[(position - 1) / 3];
            int16 classicMinimum = classicMinimums[position - 1];
            assertEq(harness.migrateLegacyTemperature(position, legacyMinimum), classicMinimum);
            assertEq(
                harness.migrateLegacyTemperature(position, legacyMinimum + 20), classicMinimum + 20
            );
            assertEq(
                harness.migrateLegacyTemperature(position, legacyMinimum + 40), classicMinimum + 40
            );
        }
    }

    function testLegacyMigrationRejectsAValueThatCannotComeFromV1() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                VeydriftPlanetGeneration.LegacyTemperatureOutOfRange.selector, 1, int16(81)
            )
        );
        harness.migrateLegacyTemperature(1, 81);
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
