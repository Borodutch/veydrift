// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Shared moon math kept outside the EIP-170-limited Moon implementation.
library VeydriftMoonMath {
    using SafeCast for uint256;

    bytes32 private constant MOON_CHANCE_DOMAIN = keccak256("veydrift.moon-chance.v1");
    bytes32 private constant MOON_DESTRUCTION_DOMAIN = keccak256("veydrift.moon-destruction.v1");

    function chanceBps(uint128 metalDebris, uint128 crystalDebris) public pure returns (uint16) {
        uint256 debrisUnits = (uint256(metalDebris) + crystalDebris) / 100_000;
        uint256 chance = debrisUnits * 100;
        return chance > 2_000 ? 2_000 : chance.toUint16();
    }

    function chancePurposeHash(
        uint256 chainId,
        address moonSystem,
        uint256 outcomeId,
        uint256 battleId,
        uint256 targetPlanetId,
        uint128 metalDebris,
        uint128 crystalDebris,
        uint16 chance
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                MOON_CHANCE_DOMAIN,
                chainId,
                moonSystem,
                outcomeId,
                battleId,
                targetPlanetId,
                metalDebris,
                crystalDebris,
                chance
            )
        );
    }

    function destructionPurposeHash(
        uint256 chainId,
        address moonSystem,
        uint256 outcomeId,
        uint256 battleId,
        uint256 targetPlanetId,
        address attacker,
        uint32 deathstars,
        uint16 moonDiameterKm,
        uint16 moonDestructionBps,
        uint16 deathstarDestructionBps
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                MOON_DESTRUCTION_DOMAIN,
                chainId,
                moonSystem,
                outcomeId,
                battleId,
                targetPlanetId,
                attacker,
                deathstars,
                moonDiameterKm,
                moonDestructionBps,
                deathstarDestructionBps
            )
        );
    }

    function destructionChanceBps(uint16 moonDiameterKm, uint32 deathstars)
        public
        pure
        returns (uint16)
    {
        if (deathstars == 0) return 0;
        uint256 moonRoot = sqrt(moonDiameterKm);
        if (moonRoot >= 100) return 0;
        uint256 chance = (100 - moonRoot) * sqrt(deathstars) * 100;
        return chance > 10_000 ? 10_000 : chance.toUint16();
    }

    function deathstarDestructionChanceBps(uint16 moonDiameterKm) public pure returns (uint16) {
        uint256 chance = sqrt(moonDiameterKm) * 50;
        return chance > 10_000 ? 10_000 : chance.toUint16();
    }

    function sqrt(uint256 value) public pure returns (uint256 result) {
        if (value == 0) return 0;
        uint256 candidate = value;
        result = 1;
        if (candidate >= 2 ** 128) {
            candidate >>= 128;
            result <<= 64;
        }
        if (candidate >= 2 ** 64) {
            candidate >>= 64;
            result <<= 32;
        }
        if (candidate >= 2 ** 32) {
            candidate >>= 32;
            result <<= 16;
        }
        if (candidate >= 2 ** 16) {
            candidate >>= 16;
            result <<= 8;
        }
        if (candidate >= 2 ** 8) {
            candidate >>= 8;
            result <<= 4;
        }
        if (candidate >= 2 ** 4) {
            candidate >>= 4;
            result <<= 2;
        }
        if (candidate >= 2 ** 2) result <<= 1;

        for (uint8 i = 0; i < 7;) {
            result = (result + value / result) >> 1;
            unchecked {
                ++i;
            }
        }
        uint256 roundedDown = value / result;
        return result < roundedDown ? result : roundedDown;
    }
}
