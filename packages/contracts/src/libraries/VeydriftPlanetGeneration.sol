// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Coordinate and deterministic first-planet generation helpers.
library VeydriftPlanetGeneration {
    using SafeCast for int256;
    using SafeCast for uint256;

    error InvalidCoordinates();

    function coordinateKey(
        uint256 chainId,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        uint16 maxGalaxy,
        uint16 maxSystem,
        uint8 maxPosition
    ) internal pure returns (bytes32) {
        validateCoordinates(galaxy, system, position, maxGalaxy, maxSystem, maxPosition);
        return keccak256(abi.encode(chainId, galaxy, system, position));
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
    ) internal pure returns (bytes32) {
        validateCoordinates(galaxy, system, position, maxGalaxy, maxSystem, maxPosition);
        return keccak256(abi.encode(domain, chainId, galaxy, system, position));
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
    )
        internal
        pure
        returns (uint16 galaxy, uint16 system, uint8 position, uint16 fields, int16 temperature)
    {
        bytes32 seed = keccak256(
            abi.encode(domain, chainId, player, blockNumber, timestamp, prevrandao, attempt)
        );
        galaxy = uint16((uint256(seed) % maxGalaxy) + 1);
        system = uint16(((uint256(seed) >> 16) % maxSystem) + 1);
        position = uint8(((uint256(seed) >> 32) % maxPosition) + 1);
        fields = uint16(160 + ((uint256(seed) >> 48) % 80));
        temperature =
            slotTemperature(position, (uint256(seed) >> 64) % 21, (uint256(seed) >> 72) % 21);
    }

    function slotTemperature(uint8 position, uint256 lowRoll, uint256 highRoll)
        internal
        pure
        returns (int16)
    {
        (int16 minValue, int16 maxValue) = slotMaxTemperatureProfile(position);
        return intInRange(minValue, maxValue, lowRoll + highRoll);
    }

    function slotMaxTemperatureProfile(uint8 position)
        internal
        pure
        returns (int16 minValue, int16 maxValue)
    {
        if (position <= 3) return (40, 120);
        if (position <= 6) return (-10, 80);
        if (position <= 9) return (-40, 40);
        if (position <= 12) return (-80, 10);
        return (-120, -20);
    }

    function validateCoordinates(
        uint16 galaxy,
        uint16 system,
        uint8 position,
        uint16 maxGalaxy,
        uint16 maxSystem,
        uint8 maxPosition
    ) internal pure {
        if (
            galaxy == 0 || galaxy > maxGalaxy || system == 0 || system > maxSystem || position == 0
                || position > maxPosition
        ) {
            revert InvalidCoordinates();
        }
    }

    function intInRange(int16 minValue, int16 maxValue, uint256 roll)
        internal
        pure
        returns (int16)
    {
        uint256 span = (int256(maxValue) - int256(minValue)).toUint256() + 1;
        return (int256(minValue) + (roll % span).toInt256()).toInt16();
    }
}
