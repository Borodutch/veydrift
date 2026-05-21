// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Building, Defense, Ship, Technology} from "./VeydriftTypes.sol";

/// @notice Static MVP catalog data for buildables and research.
library VeydriftCatalog {
    using SafeCast for uint256;

    error InvalidId();
    error LevelTooHigh();

    function buildingBaseCost(Building building) public pure returns (uint128, uint128, uint128) {
        if (building == Building.MetalMine) return (60, 15, 0);
        if (building == Building.CrystalMine) return (48, 24, 0);
        if (building == Building.DeuteriumSynthesizer) return (225, 75, 0);
        if (building == Building.SolarPlant) return (75, 30, 0);
        if (building == Building.RoboticsFactory) return (400, 120, 0);
        if (building == Building.Shipyard) return (400, 200, 100);
        if (building == Building.ResearchLab) return (200, 400, 200);
        if (building == Building.MetalStorage) return (1_000, 0, 0);
        if (building == Building.CrystalStorage) return (1_000, 500, 0);
        if (building == Building.DeuteriumTank) return (1_000, 1_000, 0);
        if (building == Building.FusionReactor) return (900, 360, 180);
        if (building == Building.NaniteFactory) return (1_000_000, 500_000, 100_000);
        if (building == Building.Terraformer) return (0, 50_000, 100_000);
        if (building == Building.AllianceDepot) return (20_000, 40_000, 0);
        if (building == Building.MissileSilo) return (20_000, 20_000, 1_000);
        if (building == Building.InterdimensionalRiftStabilizer) return (8_000, 8_000, 4_000);
        revert InvalidId();
    }

    function defenseCost(Defense defense) public pure returns (uint128, uint128, uint128) {
        if (defense == Defense.RocketLauncher) return (200, 0, 0);
        if (defense == Defense.LightLaser) return (1_500, 500, 0);
        if (defense == Defense.HeavyLaser) return (6_000, 2_000, 0);
        if (defense == Defense.SmallShieldDome) return (10_000, 10_000, 0);
        if (defense == Defense.GaussCannon) return (20_000, 15_000, 2_000);
        if (defense == Defense.IonCannon) return (2_000, 6_000, 0);
        if (defense == Defense.PlasmaTurret) return (50_000, 50_000, 30_000);
        if (defense == Defense.LargeShieldDome) return (50_000, 50_000, 0);
        if (defense == Defense.AntiBallisticMissile) return (8_000, 0, 2_000);
        if (defense == Defense.InterplanetaryMissile) return (12_500, 2_500, 10_000);
        revert InvalidId();
    }

    function shipCost(Ship ship) public pure returns (uint128, uint128, uint128) {
        if (ship == Ship.SmallCargo) return (2_000, 2_000, 0);
        if (ship == Ship.LightFighter) return (3_000, 1_000, 0);
        if (ship == Ship.Recycler) return (10_000, 6_000, 2_000);
        if (ship == Ship.ColonyShip) return (10_000, 20_000, 10_000);
        if (ship == Ship.LargeCargo) return (6_000, 6_000, 0);
        if (ship == Ship.HeavyFighter) return (6_000, 4_000, 0);
        if (ship == Ship.Cruiser) return (20_000, 7_000, 2_000);
        if (ship == Ship.Battleship) return (45_000, 15_000, 0);
        if (ship == Ship.EspionageProbe) return (0, 1_000, 0);
        if (ship == Ship.Bomber) return (50_000, 25_000, 15_000);
        if (ship == Ship.SolarSatellite) return (0, 2_000, 500);
        if (ship == Ship.Destroyer) return (60_000, 50_000, 15_000);
        if (ship == Ship.Deathstar) return (5_000_000, 4_000_000, 1_000_000);
        if (ship == Ship.Battlecruiser) return (30_000, 40_000, 15_000);
        if (ship == Ship.Reaper) return (85_000, 55_000, 20_000);
        if (ship == Ship.Pathfinder) return (8_000, 15_000, 8_000);
        revert InvalidId();
    }

    function shipCargoCapacity(Ship ship) public pure returns (uint256) {
        if (ship == Ship.SmallCargo) return 5_000;
        if (ship == Ship.LightFighter) return 50;
        if (ship == Ship.Recycler) return 20_000;
        if (ship == Ship.ColonyShip) return 7_500;
        if (ship == Ship.LargeCargo) return 25_000;
        if (ship == Ship.HeavyFighter) return 100;
        if (ship == Ship.Cruiser) return 800;
        if (ship == Ship.Battleship) return 1_500;
        if (ship == Ship.EspionageProbe) return 5;
        if (ship == Ship.Bomber) return 500;
        if (ship == Ship.SolarSatellite) return 0;
        if (ship == Ship.Destroyer) return 2_000;
        if (ship == Ship.Deathstar) return 1_000_000;
        if (ship == Ship.Battlecruiser) return 750;
        if (ship == Ship.Reaper) return 10_000;
        if (ship == Ship.Pathfinder) return 10_000;
        revert InvalidId();
    }

    function researchBaseCost(Technology technology)
        public
        pure
        returns (uint128, uint128, uint128)
    {
        if (technology == Technology.Energy) {
            return (0, 800, 400);
        }
        if (technology == Technology.Laser) return (200, 100, 0);
        if (technology == Technology.Ion) return (1_000, 300, 100);
        if (technology == Technology.CombustionDrive) return (400, 0, 600);
        if (technology == Technology.Espionage) return (200, 1_000, 200);
        if (technology == Technology.Computer) return (0, 400, 600);
        if (technology == Technology.Weapons) return (800, 200, 0);
        if (technology == Technology.Shielding) return (200, 600, 0);
        if (technology == Technology.Armor) return (1_000, 0, 0);
        if (technology == Technology.Hyperspace) return (0, 4_000, 2_000);
        if (technology == Technology.ImpulseDrive) return (2_000, 4_000, 600);
        if (technology == Technology.HyperspaceDrive) return (10_000, 20_000, 6_000);
        if (technology == Technology.Plasma) return (2_000, 4_000, 1_000);
        if (technology == Technology.Astrophysics) return (4_000, 8_000, 4_000);
        if (technology == Technology.IntergalacticResearchNetwork) {
            return (240_000, 400_000, 160_000);
        }
        if (technology == Technology.Graviton) return (0, 0, 0);
        revert InvalidId();
    }

    function researchCost(Technology technology, uint16 currentLevel)
        public
        pure
        returns (uint128, uint128, uint128)
    {
        (uint128 metal, uint128 crystal, uint128 deuterium) = researchBaseCost(technology);
        if (technology == Technology.Graviton) return (0, 0, 0);
        if (technology == Technology.Astrophysics) {
            return (
                _scaleAstrophysicsCost(metal, currentLevel),
                _scaleAstrophysicsCost(crystal, currentLevel),
                _scaleAstrophysicsCost(deuterium, currentLevel)
            );
        }
        return (
            _scaleDoubleCost(metal, currentLevel),
            _scaleDoubleCost(crystal, currentLevel),
            _scaleDoubleCost(deuterium, currentLevel)
        );
    }

    function researchEnergyRequirement(Technology technology, uint16 currentLevel)
        public
        pure
        returns (uint256)
    {
        if (technology != Technology.Graviton) return 0;
        uint256 required = 300_000;
        for (uint16 i = 0; i < currentLevel; i++) {
            required *= 3;
        }
        return required;
    }

    function researchLabRequirement(Technology technology) public pure returns (uint16) {
        if (technology == Technology.Energy) return 1;
        if (technology == Technology.Laser) return 1;
        if (technology == Technology.Ion) return 4;
        if (technology == Technology.CombustionDrive) return 1;
        if (technology == Technology.Espionage) return 3;
        if (technology == Technology.Computer) return 1;
        if (technology == Technology.Weapons) return 4;
        if (technology == Technology.Shielding) return 6;
        if (technology == Technology.Armor) return 2;
        if (technology == Technology.Hyperspace) return 7;
        if (technology == Technology.ImpulseDrive) return 2;
        if (technology == Technology.HyperspaceDrive) return 7;
        if (technology == Technology.Plasma) return 4;
        if (technology == Technology.Astrophysics) return 3;
        if (technology == Technology.IntergalacticResearchNetwork) return 10;
        if (technology == Technology.Graviton) return 12;
        revert InvalidId();
    }

    function _scaleDoubleCost(uint128 baseCost, uint16 currentLevel)
        private
        pure
        returns (uint128)
    {
        if (currentLevel >= 128) revert LevelTooHigh();
        return _toUint128(uint256(baseCost) << currentLevel);
    }

    function _scaleAstrophysicsCost(uint128 baseCost, uint16 currentLevel)
        private
        pure
        returns (uint128)
    {
        uint256 numerator = 1;
        uint256 denominator = 1;
        for (uint16 i = 0; i < currentLevel; i++) {
            numerator *= 175;
            denominator *= 100;
        }

        uint256 raw = (uint256(baseCost) * numerator + (denominator / 2)) / denominator;
        uint256 roundedHundreds = (raw + 50) / 100;
        return _toUint128(roundedHundreds * 100);
    }

    function _toUint128(uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) revert LevelTooHigh();
        return value.toUint128();
    }
}
