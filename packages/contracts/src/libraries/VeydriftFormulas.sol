// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Pure gameplay formulas used by the Veydrift MVP contract.
library VeydriftFormulas {
    using SafeCast for int256;
    using SafeCast for uint256;

    error LevelTooHigh();

    uint256 private constant WAD = 1e18;

    function planetMultipliers(int16 temperature, uint16)
        public
        pure
        returns (uint16 metalMultiplier, uint16 crystalMultiplier, uint16 deuteriumMultiplier)
    {
        metalMultiplier =
            10_000;
        crystalMultiplier = 10_000;
        deuteriumMultiplier = (12_800 - int256(temperature) * 20).toUint256().toUint16();
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

        metalPerHour = _scaleByBps(_ogameLevelGrowth(30, metalLevel), metalMultiplierBps, bps);
        crystalPerHour = _scaleByBps(_ogameLevelGrowth(20, crystalLevel), crystalMultiplierBps, bps);
        deuteriumPerHour =
            _scaleByBps(_ogameLevelGrowth(10, deuteriumLevel), deuteriumMultiplierBps, bps);

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
        requiredEnergy = _ogameLevelGrowth(10, metalLevel) + _ogameLevelGrowth(10, crystalLevel)
            + _ogameLevelGrowth(20, deuteriumLevel);
        producedEnergy = _ogameLevelGrowth(20, solarLevel);
        // OGame-style shortage factor: full production when energy is sufficient,
        // otherwise floor(produced / required) in basis points. Settlement uses
        // the building state for each elapsed segment, so later power upgrades do
        // not retroactively improve already-settled shortage periods.
        energyScaleBps = requiredEnergy == 0 || producedEnergy >= requiredEnergy
            ? bps
            : (producedEnergy * bps) / requiredEnergy;
    }

    function storageCaps(uint256 metalStorage, uint256 crystalStorage, uint256 deuteriumTank)
        public
        pure
        returns (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap)
    {
        metalCap = _storageCapacity(metalStorage);
        crystalCap = _storageCapacity(crystalStorage);
        deuteriumCap = _storageCapacity(deuteriumTank);
    }

    function buildingDuration(
        uint256 roboticsLevel,
        uint128 metalCost,
        uint128 crystalCost,
        uint32 minQueueSeconds
    ) public pure returns (uint256) {
        uint256 raw = ((uint256(metalCost) + uint256(crystalCost)) * 1 hours)
            / (2_500 * (roboticsLevel + 1));
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
        uint128,
        uint32 minQueueSeconds
    ) public pure returns (uint256) {
        uint256 raw = ((uint256(metalCost) + uint256(crystalCost)) * 1 hours)
            / (1_000 * (labLevel + 1));
        return raw < minQueueSeconds ? minQueueSeconds : raw;
    }

    function _ogameLevelGrowth(uint256 coefficient, uint256 level) private pure returns (uint256) {
        if (level == 0) return 0;

        uint256 multiplier = WAD;
        for (uint256 i = 0; i < level; i++) {
            multiplier = (multiplier * 110) / 100;
        }

        return (coefficient * level * multiplier) / WAD;
    }

    function _storageCapacity(uint256 level) private pure returns (uint128) {
        if (level == 0) return 10_000;
        if (level == 1) return 20_000;
        if (level == 2) return 40_000;
        if (level == 3) return 75_000;
        if (level == 4) return 140_000;
        if (level == 5) return 255_000;
        if (level == 6) return 470_000;
        if (level == 7) return 865_000;
        if (level == 8) return 1_590_000;
        if (level == 9) return 2_920_000;
        if (level == 10) return 5_355_000;
        if (level == 11) return 9_820_000;
        if (level == 12) return 18_005_000;
        if (level == 13) return 33_005_000;
        if (level == 14) return 60_510_000;
        if (level == 15) return 110_925_000;
        if (level == 16) return 203_350_000;
        if (level == 17) return 372_785_000;
        if (level == 18) return 683_385_000;
        if (level == 19) return 1_252_785_000;
        if (level == 20) return 2_296_600_000;
        if (level == 21) return 4_210_115_000;
        if (level == 22) return 7_717_970_000;
        if (level == 23) return 14_148_545_000;
        if (level == 24) return 25_937_050_000;
        if (level == 25) return 47_547_690_000;
        if (level == 26) return 87_164_210_000;
        if (level == 27) return 159_789_040_000;
        if (level == 28) return 292_924_545_000;
        if (level == 29) return 536_987_950_000;
        if (level == 30) return 984_403_885_000;
        if (level == 31) return 1_804_604_750_000;
        if (level == 32) return 3_308_193_270_000;
        if (level == 33) return 6_064_564_940_000;
        if (level == 34) return 11_117_533_015_000;
        if (level == 35) return 20_380_611_235_000;
        if (level == 36) return 37_361_644_330_000;
        if (level == 37) return 68_491_197_375_000;
        if (level == 38) return 125_557_753_210_000;
        if (level == 39) return 230_171_905_210_000;
        if (level == 40) return 421_950_095_435_000;
        if (level == 41) return 773_517_006_225_000;
        if (level == 42) return 1_418_007_876_745_000;
        if (level == 43) return 2_599_485_625_175_000;
        if (level == 44) return 4_765_365_289_085_000;
        if (level == 45) return 8_735_846_091_420_000;
        if (level == 46) return 16_014_513_537_450_000;
        if (level == 47) return 29_357_733_773_850_000;
        if (level == 48) return 53_818_464_752_040_000;
        if (level == 49) return 98_659_766_131_065_000;
        if (level == 50) return 180_862_636_975_685_000;

        revert LevelTooHigh();
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
