// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Pure gameplay formulas used by the Veydrift MVP contract.
library VeydriftFormulas {
    using SafeCast for int256;
    using SafeCast for uint256;

    error LevelTooHigh();

    function planetMultipliers(int16 temperature, uint16 fields)
        public
        pure
        returns (uint16 metalMultiplier, uint16 crystalMultiplier, uint16 deuteriumMultiplier)
    {
        uint256 temperatureIndex = (int256(temperature) + 180).toUint256();
        metalMultiplier = (9_500 + ((temperatureIndex * 4) % 1_000)).toUint16();
        crystalMultiplier = uint16(9_600 + (uint256(fields) * 3) % 800);
        deuteriumMultiplier = (10_800 - temperatureIndex * 3).toUint16();
    }

    function productionPerHour(
        uint256 metalLevel,
        uint256 crystalLevel,
        uint256 deuteriumLevel,
        uint256 solarLevel,
        uint16 metalMultiplierBps,
        uint16 crystalMultiplierBps,
        uint16 deuteriumMultiplierBps,
        uint16 bps
    ) public pure returns (uint256 metalPerHour, uint256 crystalPerHour, uint256 deuteriumPerHour) {
        (, uint256 requiredEnergy, uint256 energyScale) =
            energyBalance(metalLevel, crystalLevel, deuteriumLevel, solarLevel, bps);

        metalPerHour =
            _scaleByBps((metalLevel * 20) + (metalLevel * metalLevel * 5), metalMultiplierBps, bps);
        crystalPerHour = _scaleByBps(
            (crystalLevel * 15) + (crystalLevel * crystalLevel * 4), crystalMultiplierBps, bps
        );
        deuteriumPerHour = _scaleByBps(
            (deuteriumLevel * 10) + (deuteriumLevel * deuteriumLevel * 3),
            deuteriumMultiplierBps,
            bps
        );

        if (requiredEnergy != 0) {
            metalPerHour = _scaleByBps(metalPerHour, energyScale, bps);
            crystalPerHour = _scaleByBps(crystalPerHour, energyScale, bps);
            deuteriumPerHour = _scaleByBps(deuteriumPerHour, energyScale, bps);
        }
    }

    function energyBalance(
        uint256 metalLevel,
        uint256 crystalLevel,
        uint256 deuteriumLevel,
        uint256 solarLevel,
        uint16 bps
    ) public pure returns (uint256 producedEnergy, uint256 requiredEnergy, uint256 energyScaleBps) {
        requiredEnergy = (metalLevel * 10) + (crystalLevel * 12) + (deuteriumLevel * 20);
        producedEnergy = solarLevel * 30;
        energyScaleBps = requiredEnergy == 0 || producedEnergy >= requiredEnergy
            ? bps
            : (producedEnergy * bps) / requiredEnergy;
    }

    function storageCaps(uint256 metalStorage, uint256 crystalStorage, uint256 deuteriumTank)
        public
        pure
        returns (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap)
    {
        metalCap = _toUint128(10_000 + metalStorage * 10_000);
        crystalCap = _toUint128(10_000 + crystalStorage * 10_000);
        deuteriumCap = _toUint128(10_000 + deuteriumTank * 10_000);
    }

    function buildingDuration(
        uint256 roboticsLevel,
        uint128 metalCost,
        uint128 crystalCost,
        uint32 minQueueSeconds
    ) public pure returns (uint256) {
        uint256 raw = (uint256(metalCost) + uint256(crystalCost)) / (100 * (roboticsLevel + 1));
        return raw < minQueueSeconds ? minQueueSeconds : raw;
    }

    function unitDuration(
        uint256 shipyardLevel,
        uint128 metalCost,
        uint128 crystalCost,
        uint128 deuteriumCost,
        uint32 quantity,
        uint32 minQueueSeconds
    ) public pure returns (uint256) {
        uint256 raw =
            (uint256(metalCost) + uint256(crystalCost) + uint256(deuteriumCost))
                / (200 * (shipyardLevel + 1));
        raw += quantity * 10;
        return raw < minQueueSeconds ? minQueueSeconds : raw;
    }

    function researchDuration(
        uint256 labLevel,
        uint128 metalCost,
        uint128 crystalCost,
        uint128 deuteriumCost,
        uint32 minQueueSeconds
    ) public pure returns (uint256) {
        uint256 raw =
            (uint256(metalCost) + uint256(crystalCost) + uint256(deuteriumCost))
                / (120 * (labLevel + 1));
        return raw < minQueueSeconds ? minQueueSeconds : raw;
    }

    function _scaleByBps(uint256 value, uint256 multiplierBps, uint16 bps)
        private
        pure
        returns (uint256)
    {
        return (value * multiplierBps) / bps;
    }

    function _toUint128(uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) {
            revert LevelTooHigh();
        }
        return value.toUint128();
    }
}
