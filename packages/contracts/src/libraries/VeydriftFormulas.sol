// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @notice Pure gameplay formulas used by the Veydrift MVP contract.
library VeydriftFormulas {
    using SafeCast for int256;
    using SafeCast for uint256;

    error LevelTooHigh();
    error InvalidUniverseSpeed();
    uint16 private constant BPS = 10_000;

    function planetMultipliers(int16 temperature, uint16 fields)
        public
        pure
        returns (uint16 metalMultiplier, uint16 crystalMultiplier, uint16 deuteriumMultiplier)
    {
        fields;
        int256 deuteriumBps = int256(12_800) - int256(temperature) * 20;
        metalMultiplier = 10_000;
        crystalMultiplier = 10_000;
        deuteriumMultiplier = deuteriumBps <= 0 ? 0 : deuteriumBps.toUint256().toUint16();
    }

    function productionPerHour(
        uint256 metalLevel,
        uint256 crystalLevel,
        uint256 deuteriumLevel,
        uint256 solarLevel,
        uint256 fusionLevel,
        uint256 solarSatelliteCount,
        int16 maxTemperature,
        uint256 energyTechnologyLevel,
        uint16 metalMultiplierBps,
        uint16 crystalMultiplierBps,
        uint16 deuteriumMultiplierBps
    ) public pure returns (uint256 metalPerHour, uint256 crystalPerHour, uint256 deuteriumPerHour) {
        (, uint256 requiredEnergy, uint256 energyScale) = energyBalance(
            metalLevel,
            crystalLevel,
            deuteriumLevel,
            solarLevel,
            fusionLevel,
            solarSatelliteCount,
            maxTemperature,
            energyTechnologyLevel
        );

        metalPerHour = _scaleByBps(_scaledLevelValue(30, metalLevel), metalMultiplierBps, BPS);
        crystalPerHour = _scaleByBps(_scaledLevelValue(20, crystalLevel), crystalMultiplierBps, BPS);
        deuteriumPerHour =
            _scaleByBps(_scaledLevelValue(10, deuteriumLevel), deuteriumMultiplierBps, BPS);
        uint256 fusionDeuteriumPerHour = fusionReactorDeuteriumConsumption(fusionLevel);
        deuteriumPerHour = deuteriumPerHour > fusionDeuteriumPerHour
            ? deuteriumPerHour - fusionDeuteriumPerHour
            : 0;

        if (requiredEnergy != 0) {
            metalPerHour = _scaleByBps(metalPerHour, energyScale, BPS);
            crystalPerHour = _scaleByBps(crystalPerHour, energyScale, BPS);
            deuteriumPerHour = _scaleByBps(deuteriumPerHour, energyScale, BPS);
        }
    }

    function energyBalance(
        uint256 metalLevel,
        uint256 crystalLevel,
        uint256 deuteriumLevel,
        uint256 solarLevel,
        uint256 fusionLevel,
        uint256 solarSatelliteCount,
        int16 maxTemperature,
        uint256 energyTechnologyLevel
    ) public pure returns (uint256 producedEnergy, uint256 requiredEnergy, uint256 energyScaleBps) {
        requiredEnergy = _scaledLevelValue(10, metalLevel) + _scaledLevelValue(10, crystalLevel)
            + _scaledLevelValue(20, deuteriumLevel);
        producedEnergy = _scaledLevelValue(20, solarLevel)
            + fusionReactorEnergyProduction(fusionLevel, energyTechnologyLevel)
            + solarSatelliteEnergy(maxTemperature) * solarSatelliteCount;
        // Veydrift shortage factor: full production when energy is sufficient,
        // otherwise floor(produced / required) in basis points. Settlement uses
        // the building state for each elapsed segment, so later power upgrades do
        // not retroactively improve already-settled shortage periods.
        energyScaleBps = requiredEnergy == 0 || producedEnergy >= requiredEnergy
            ? BPS
            : (producedEnergy * BPS) / requiredEnergy;
    }

    function fusionReactorEnergyProduction(uint256 fusionLevel, uint256 energyTechnologyLevel)
        public
        pure
        returns (uint256)
    {
        return _scaledLevelValueWithFactor(30, fusionLevel, 105 + energyTechnologyLevel, 100);
    }

    function fusionReactorDeuteriumConsumption(uint256 fusionLevel) public pure returns (uint256) {
        return _scaledLevelValueCeil(10, fusionLevel);
    }

    function solarSatelliteEnergy(int16 maxTemperature) public pure returns (uint256) {
        int256 raw = (int256(maxTemperature) + 140) / 6;
        if (raw < 1) return 1;
        if (raw > 65) return 65;
        return raw.toUint256();
    }

    function storageCaps(uint256 metalStorage, uint256 crystalStorage, uint256 deuteriumTank)
        public
        pure
        returns (uint128 metalCap, uint128 crystalCap, uint128 deuteriumCap)
    {
        metalCap = _storageCap(metalStorage);
        crystalCap = _storageCap(crystalStorage);
        deuteriumCap = _storageCap(deuteriumTank);
    }

    function buildingDuration(
        uint256 roboticsLevel,
        uint256 naniteLevel,
        uint128 metalCost,
        uint128 crystalCost,
        uint16 universeSpeed,
        uint32 minQueueSeconds
    ) public pure returns (uint256) {
        if (universeSpeed == 0) revert InvalidUniverseSpeed();
        uint256 raw = ((uint256(metalCost) + uint256(crystalCost)) * 1 hours)
            / (2500 * (roboticsLevel + 1) * (2 ** naniteLevel) * universeSpeed);
        return raw < minQueueSeconds ? minQueueSeconds : raw;
    }

    function scaleByFactor(uint256 value, uint256 exponent, uint256 numerator, uint256 denominator)
        public
        pure
        returns (uint256)
    {
        return (value * (numerator ** exponent)) / (denominator ** exponent);
    }

    function unitDuration(
        uint256 shipyardLevel,
        uint256 naniteLevel,
        uint128 metalCost,
        uint128 crystalCost,
        uint128,
        uint32 quantity,
        uint16 universeSpeed,
        uint32 minQueueSeconds
    ) public pure returns (uint256) {
        if (universeSpeed == 0) revert InvalidUniverseSpeed();
        uint256 denominator = 2500 * (shipyardLevel + 1) * (2 ** naniteLevel) * universeSpeed;
        uint256 numerator = (uint256(metalCost) + uint256(crystalCost)) * quantity * 1 hours;
        uint256 raw = (numerator + denominator - 1) / denominator;
        return raw < minQueueSeconds ? minQueueSeconds : raw;
    }

    function researchDuration(
        uint256 labLevel,
        uint128 metalCost,
        uint128 crystalCost,
        uint128,
        uint16 universeSpeed,
        uint32 minQueueSeconds
    ) public pure returns (uint256) {
        if (universeSpeed == 0) revert InvalidUniverseSpeed();
        uint256 raw = ((uint256(metalCost) + uint256(crystalCost)) * 1 hours)
            / (1000 * (labLevel + 1) * universeSpeed);
        return raw < minQueueSeconds ? minQueueSeconds : raw;
    }

    function _scaleByBps(uint256 value, uint256 multiplierBps, uint16 bps)
        private
        pure
        returns (uint256)
    {
        return (value * multiplierBps) / bps;
    }

    function _scaledLevelValue(uint256 base, uint256 level) private pure returns (uint256) {
        return _scaledLevelValueWithFactor(base, level, 11, 10);
    }

    function _scaledLevelValueCeil(uint256 base, uint256 level) private pure returns (uint256) {
        if (level == 0) return 0;
        uint256 denominator = 10 ** level;
        return ((base * level * (11 ** level)) + denominator - 1) / denominator;
    }

    function _scaledLevelValueWithFactor(
        uint256 base,
        uint256 level,
        uint256 numerator,
        uint256 denominator
    ) private pure returns (uint256) {
        if (level == 0) return 0;
        return scaleByFactor(base * level, level, numerator, denominator);
    }

    function _storageCap(uint256 level) private pure returns (uint128) {
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

    function _toUint128(uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) {
            revert LevelTooHigh();
        }
        return value.toUint128();
    }
}
