// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Coordinate and deterministic first-planet generation helpers.
library VeydriftPlanetGeneration {
    using SafeCast for int256;
    using SafeCast for uint256;

    error InvalidCoordinates();

    uint64 private constant FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325;
    uint64 private constant FNV_PRIME_64 = 0x100000001b3;
    uint16 private constant MIN_POPULATED_SLOTS = 5;
    uint16 private constant MAX_POPULATED_SLOTS = 11;

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

    function isPopulatedPlanetSlot(
        uint256 chainId,
        address universeAddress,
        uint16 galaxy,
        uint16 system,
        uint8 position,
        uint16 maxGalaxy,
        uint16 maxSystem,
        uint8 maxPosition
    ) internal pure returns (bool) {
        validateCoordinates(galaxy, system, position, maxGalaxy, maxSystem, maxPosition);
        uint256 populatedCount;
        int256 targetMargin;

        for (uint8 slot = 1; slot <= maxPosition;) {
            int256 margin = _slotOccupancyMargin(chainId, universeAddress, galaxy, system, slot);
            if (margin > 0) populatedCount += 1;
            if (slot == position) targetMargin = margin;
            unchecked {
                ++slot;
            }
        }

        if (populatedCount > MAX_POPULATED_SLOTS) {
            if (targetMargin <= 0) return false;
            uint256 rank = 1;
            for (uint8 slot = 1; slot <= maxPosition;) {
                int256 margin = _slotOccupancyMargin(chainId, universeAddress, galaxy, system, slot);
                if (margin > targetMargin || (margin == targetMargin && slot < position)) {
                    rank += 1;
                }
                unchecked {
                    ++slot;
                }
            }
            return rank <= MAX_POPULATED_SLOTS;
        }

        if (populatedCount < MIN_POPULATED_SLOTS) {
            if (targetMargin > 0) return true;
            uint256 needed = MIN_POPULATED_SLOTS - populatedCount;
            uint256 rank = 1;
            for (uint8 slot = 1; slot <= maxPosition;) {
                int256 margin = _slotOccupancyMargin(chainId, universeAddress, galaxy, system, slot);
                if (
                    margin <= 0
                        && (margin > targetMargin || (margin == targetMargin && slot < position))
                ) {
                    rank += 1;
                }
                unchecked {
                    ++slot;
                }
            }
            return rank <= needed;
        }

        return targetMargin > 0;
    }

    function intInRange(int16 minValue, int16 maxValue, uint256 roll)
        internal
        pure
        returns (int16)
    {
        uint256 span = (int256(maxValue) - int256(minValue)).toUint256() + 1;
        return (int256(minValue) + (roll % span).toInt256()).toInt16();
    }

    function _slotOccupancyMargin(
        uint256 chainId,
        address universeAddress,
        uint16 galaxy,
        uint16 system,
        uint8 slot
    ) private pure returns (int256) {
        uint16 threshold = _slotOccupancyThresholdBps(slot);
        uint256 roll = uint256(
            _fnv1a64(
                bytes(
                    string(
                        abi.encodePacked(
                            "veydrift:v1:slot-occupancy:",
                            _uintString(chainId),
                            ":",
                            _addressString(universeAddress),
                            ":galaxy:",
                            _uintString(galaxy),
                            ":system:",
                            _uintString(system),
                            ":slot:",
                            _uintString(slot)
                        )
                    )
                )
            )
        ) % 10_000;
        // casting to int256 is safe because `roll` is reduced modulo 10_000 above.
        // forge-lint: disable-next-line(unsafe-typecast)
        return int256(uint256(threshold)) - int256(roll);
    }

    function _slotOccupancyThresholdBps(uint8 slot) private pure returns (uint16) {
        if (slot == 1) return 5_400;
        if (slot == 2) return 5_800;
        if (slot == 3) return 6_500;
        if (slot == 4) return 7_200;
        if (slot == 5) return 7_800;
        if (slot == 6) return 8_200;
        if (slot == 7) return 8_500;
        if (slot == 8) return 8_600;
        if (slot == 9) return 8_500;
        if (slot == 10) return 8_100;
        if (slot == 11) return 7_600;
        if (slot == 12) return 6_900;
        if (slot == 13) return 6_200;
        if (slot == 14) return 5_600;
        if (slot == 15) return 5_000;
        revert InvalidCoordinates();
    }

    function _fnv1a64(bytes memory input) private pure returns (uint64 hash) {
        hash = FNV_OFFSET_BASIS_64;
        for (uint256 index = 0; index < input.length;) {
            unchecked {
                hash = (hash ^ uint64(uint8(input[index]))) * FNV_PRIME_64;
                ++index;
            }
        }
    }

    function _uintString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits += 1;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _addressString(address account) private pure returns (string memory) {
        bytes16 symbols = "0123456789abcdef";
        bytes memory buffer = new bytes(42);
        buffer[0] = "0";
        buffer[1] = "x";
        uint160 value = uint160(account);
        for (uint256 index = 0; index < 20;) {
            // casting to uint8 is safe because only the low byte of the shifted address is needed.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint8 current = uint8(value >> (8 * (19 - index)));
            buffer[2 + index * 2] = symbols[current >> 4];
            buffer[3 + index * 2] = symbols[current & 0x0f];
            unchecked {
                ++index;
            }
        }
        return string(buffer);
    }
}
