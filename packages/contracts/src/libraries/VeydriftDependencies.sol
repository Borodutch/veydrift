// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftCatalog} from "./VeydriftCatalog.sol";
import {Building, Defense, Ship, Technology} from "./VeydriftTypes.sol";

/// @notice Pure unlock/dependency rules for MVP buildings, units, and research.
library VeydriftDependencies {
    error MissingDependency(bytes32 dependency);

    function requireBuilding(
        Building building,
        uint16 roboticsFactoryLevel,
        uint16 researchLabLevel,
        uint16 energyLevel,
        uint16
    ) public pure {
        if (building == Building.Shipyard && roboticsFactoryLevel < 2) {
            revert MissingDependency("ROBOTICS_FACTORY_2");
        }
        if (building == Building.ResearchLab && roboticsFactoryLevel < 1) {
            revert MissingDependency("ROBOTICS_FACTORY_1");
        }
        if (building == Building.NaniteFactory && roboticsFactoryLevel < 10) {
            revert MissingDependency("ROBOTICS_FACTORY_10");
        }
        if (building == Building.InterdimensionalRiftStabilizer && roboticsFactoryLevel < 2) {
            revert MissingDependency("ROBOTICS_FACTORY_2");
        }
        if (building == Building.InterdimensionalRiftStabilizer && researchLabLevel < 1) {
            revert MissingDependency("RESEARCH_LAB_1");
        }
        if (building == Building.InterdimensionalRiftStabilizer && energyLevel < 2) {
            revert MissingDependency("ENERGY_2");
        }
    }

    function requireBuilding(
        Building building,
        uint16 deuteriumSynthesizerLevel,
        uint16 roboticsFactoryLevel,
        uint16 shipyardLevel,
        uint16 researchLabLevel,
        uint16 naniteFactoryLevel,
        uint16 energyLevel,
        uint16 computerLevel,
        uint16 hyperspaceLevel
    ) public pure {
        if (building == Building.FusionReactor && deuteriumSynthesizerLevel < 5) {
            revert MissingDependency("DEUTERIUM_SYNTHESIZER_5");
        }
        if (building == Building.FusionReactor && energyLevel < 3) {
            revert MissingDependency("ENERGY_3");
        }
        if (building == Building.Shipyard && roboticsFactoryLevel < 2) {
            revert MissingDependency("ROBOTICS_FACTORY_2");
        }
        if (building == Building.ResearchLab && roboticsFactoryLevel < 1) {
            revert MissingDependency("ROBOTICS_FACTORY_1");
        }
        if (building == Building.NaniteFactory && roboticsFactoryLevel < 10) {
            revert MissingDependency("ROBOTICS_FACTORY_10");
        }
        if (building == Building.NaniteFactory && computerLevel < 10) {
            revert MissingDependency("COMPUTER_10");
        }
        if (building == Building.Terraformer && naniteFactoryLevel < 1) {
            revert MissingDependency("NANITE_FACTORY_1");
        }
        if (building == Building.Terraformer && energyLevel < 12) {
            revert MissingDependency("ENERGY_12");
        }
        if (building == Building.MissileSilo && shipyardLevel < 1) {
            revert MissingDependency("SHIPYARD_1");
        }
        if (building == Building.InterdimensionalRiftStabilizer && roboticsFactoryLevel < 4) {
            revert MissingDependency("ROBOTICS_FACTORY_4");
        }
        if (building == Building.InterdimensionalRiftStabilizer && researchLabLevel < 2) {
            revert MissingDependency("RESEARCH_LAB_2");
        }
        if (building == Building.InterdimensionalRiftStabilizer && energyLevel < 5) {
            revert MissingDependency("ENERGY_5");
        }
        if (building == Building.InterdimensionalRiftStabilizer && hyperspaceLevel < 1) {
            revert MissingDependency("HYPERSPACE_1");
        }
    }

    function requireDefense(
        Defense defense,
        uint16 shipyardLevel,
        uint16 missileSiloLevel,
        uint16 energyLevel,
        uint16 laserLevel,
        uint16 ionLevel,
        uint16 weaponsLevel,
        uint16 shieldingLevel,
        uint16 impulseDriveLevel,
        uint16 plasmaLevel
    ) public pure {
        if (shipyardLevel == 0) {
            revert MissingDependency("SHIPYARD");
        }
        if (defense == Defense.LightLaser && shipyardLevel < 2) {
            revert MissingDependency("SHIPYARD_2");
        }
        if (defense == Defense.LightLaser && energyLevel < 1) {
            revert MissingDependency("ENERGY_1");
        }
        if (defense == Defense.LightLaser && laserLevel < 3) {
            revert MissingDependency("LASER_3");
        }
        if (defense == Defense.HeavyLaser && shipyardLevel < 4) {
            revert MissingDependency("SHIPYARD_4");
        }
        if (defense == Defense.HeavyLaser && energyLevel < 3) {
            revert MissingDependency("ENERGY_3");
        }
        if (defense == Defense.HeavyLaser && laserLevel < 6) {
            revert MissingDependency("LASER_6");
        }
        if (defense == Defense.SmallShieldDome && shieldingLevel < 2) {
            revert MissingDependency("SHIELDING_2");
        }
        if (defense == Defense.GaussCannon && shipyardLevel < 6) {
            revert MissingDependency("SHIPYARD_6");
        }
        if (defense == Defense.GaussCannon && energyLevel < 6) {
            revert MissingDependency("ENERGY_6");
        }
        if (defense == Defense.GaussCannon && weaponsLevel < 3) {
            revert MissingDependency("WEAPONS_3");
        }
        if (defense == Defense.GaussCannon && shieldingLevel < 1) {
            revert MissingDependency("SHIELDING_1");
        }
        if (defense == Defense.IonCannon && shipyardLevel < 4) {
            revert MissingDependency("SHIPYARD_4");
        }
        if (defense == Defense.IonCannon && ionLevel < 4) {
            revert MissingDependency("ION_4");
        }
        if (defense == Defense.PlasmaTurret && shipyardLevel < 8) {
            revert MissingDependency("SHIPYARD_8");
        }
        if (defense == Defense.PlasmaTurret && plasmaLevel < 7) {
            revert MissingDependency("PLASMA_7");
        }
        if (defense == Defense.LargeShieldDome && shipyardLevel < 6) {
            revert MissingDependency("SHIPYARD_6");
        }
        if (defense == Defense.LargeShieldDome && shieldingLevel < 6) {
            revert MissingDependency("SHIELDING_6");
        }
        if (defense == Defense.AntiBallisticMissile && missileSiloLevel < 2) {
            revert MissingDependency("MISSILE_SILO_2");
        }
        if (defense == Defense.InterplanetaryMissile && missileSiloLevel < 4) {
            revert MissingDependency("MISSILE_SILO_4");
        }
        if (defense == Defense.InterplanetaryMissile && impulseDriveLevel < 1) {
            revert MissingDependency("IMPULSE_1");
        }
    }

    function requireShip(
        Ship ship,
        uint16 shipyardLevel,
        uint16 espionageLevel,
        uint16 combustionDriveLevel,
        uint16 impulseDriveLevel,
        uint16 hyperspaceDriveLevel,
        uint16 hyperspaceLevel,
        uint16 gravitonLevel,
        uint16 energyLevel,
        uint16 laserLevel,
        uint16 ionLevel,
        uint16 shieldingLevel,
        uint16 armorLevel,
        uint16 plasmaLevel
    ) public pure {
        if (ship == Ship.SmallCargo && shipyardLevel < 2) {
            revert MissingDependency("SHIPYARD_2");
        }
        if (ship == Ship.SmallCargo && combustionDriveLevel < 2) {
            revert MissingDependency("COMBUSTION_2");
        }
        if (ship == Ship.LightFighter && shipyardLevel < 1) {
            revert MissingDependency("SHIPYARD_1");
        }
        if (ship == Ship.LightFighter && combustionDriveLevel < 1) {
            revert MissingDependency("COMBUSTION_1");
        }
        if (ship == Ship.Recycler && shipyardLevel < 4) {
            revert MissingDependency("SHIPYARD_4");
        }
        if (ship == Ship.Recycler && combustionDriveLevel < 6) {
            revert MissingDependency("COMBUSTION_6");
        }
        if (ship == Ship.Recycler && shieldingLevel < 2) {
            revert MissingDependency("SHIELDING_2");
        }
        if (ship == Ship.ColonyShip && shipyardLevel < 4) {
            revert MissingDependency("SHIPYARD_4");
        }
        if (ship == Ship.ColonyShip && impulseDriveLevel < 3) {
            revert MissingDependency("IMPULSE_3");
        }
        if (ship == Ship.LargeCargo && shipyardLevel < 4) {
            revert MissingDependency("SHIPYARD_4");
        }
        if (ship == Ship.LargeCargo && combustionDriveLevel < 6) {
            revert MissingDependency("COMBUSTION_6");
        }
        if (ship == Ship.HeavyFighter && shipyardLevel < 3) {
            revert MissingDependency("SHIPYARD_3");
        }
        if (ship == Ship.HeavyFighter && impulseDriveLevel < 2) {
            revert MissingDependency("IMPULSE_2");
        }
        if (ship == Ship.HeavyFighter && armorLevel < 2) {
            revert MissingDependency("ARMOR_2");
        }
        if (ship == Ship.Cruiser && shipyardLevel < 5) {
            revert MissingDependency("SHIPYARD_5");
        }
        if (ship == Ship.Cruiser && impulseDriveLevel < 4) {
            revert MissingDependency("IMPULSE_4");
        }
        if (ship == Ship.Cruiser && ionLevel < 2) {
            revert MissingDependency("ION_2");
        }
        if (ship == Ship.Battleship && shipyardLevel < 7) {
            revert MissingDependency("SHIPYARD_7");
        }
        if (ship == Ship.Battleship && hyperspaceDriveLevel < 4) {
            revert MissingDependency("HYPERSPACE_DRIVE_4");
        }
        if (ship == Ship.EspionageProbe && shipyardLevel < 3) {
            revert MissingDependency("SHIPYARD_3");
        }
        if (ship == Ship.EspionageProbe && combustionDriveLevel < 3) {
            revert MissingDependency("COMBUSTION_3");
        }
        if (ship == Ship.EspionageProbe && espionageLevel < 2) {
            revert MissingDependency("ESPIONAGE_2");
        }
        if (ship == Ship.Bomber && shipyardLevel < 8) {
            revert MissingDependency("SHIPYARD_8");
        }
        if (ship == Ship.Bomber && impulseDriveLevel < 6) {
            revert MissingDependency("IMPULSE_6");
        }
        if (ship == Ship.Bomber && plasmaLevel < 5) {
            revert MissingDependency("PLASMA_5");
        }
        if (ship == Ship.SolarSatellite && shipyardLevel < 1) {
            revert MissingDependency("SHIPYARD_1");
        }
        if (ship == Ship.Destroyer && shipyardLevel < 9) {
            revert MissingDependency("SHIPYARD_9");
        }
        if (ship == Ship.Destroyer && hyperspaceDriveLevel < 6) {
            revert MissingDependency("HYPERSPACE_DRIVE_6");
        }
        if (ship == Ship.Destroyer && hyperspaceLevel < 5) {
            revert MissingDependency("HYPERSPACE_5");
        }
        if (ship == Ship.Deathstar && shipyardLevel < 12) {
            revert MissingDependency("SHIPYARD_12");
        }
        if (ship == Ship.Deathstar && hyperspaceDriveLevel < 7) {
            revert MissingDependency("HYPERSPACE_DRIVE_7");
        }
        if (ship == Ship.Deathstar && hyperspaceLevel < 6) {
            revert MissingDependency("HYPERSPACE_6");
        }
        if (ship == Ship.Deathstar && gravitonLevel < 1) {
            revert MissingDependency("GRAVITON_1");
        }
        if (ship == Ship.Battlecruiser && shipyardLevel < 8) {
            revert MissingDependency("SHIPYARD_8");
        }
        if (ship == Ship.Battlecruiser && hyperspaceDriveLevel < 5) {
            revert MissingDependency("HYPERSPACE_DRIVE_5");
        }
        if (ship == Ship.Battlecruiser && hyperspaceLevel < 5) {
            revert MissingDependency("HYPERSPACE_5");
        }
        if (ship == Ship.Battlecruiser && laserLevel < 12) {
            revert MissingDependency("LASER_12");
        }
        if (ship == Ship.Reaper && shipyardLevel < 10) {
            revert MissingDependency("SHIPYARD_10");
        }
        if (ship == Ship.Reaper && (hyperspaceDriveLevel < 7 || hyperspaceLevel < 6)) {
            revert MissingDependency("HYPERSPACE_DRIVE_7_HYPERSPACE_6");
        }
        if (ship == Ship.Reaper && shieldingLevel < 6) {
            revert MissingDependency("SHIELDING_6");
        }
        if (ship == Ship.Reaper && energyLevel < 5) {
            revert MissingDependency("ENERGY_5");
        }
        if (ship == Ship.Pathfinder && shipyardLevel < 5) {
            revert MissingDependency("SHIPYARD_5");
        }
        if (ship == Ship.Pathfinder && hyperspaceDriveLevel < 2) {
            revert MissingDependency("HYPERSPACE_DRIVE_2");
        }
        if (ship == Ship.Pathfinder && shieldingLevel < 4) {
            revert MissingDependency("SHIELDING_4");
        }
        if (ship == Ship.Crawler && shipyardLevel < 5) {
            revert MissingDependency("SHIPYARD_5");
        }
        if (ship == Ship.Crawler && (combustionDriveLevel < 4 || armorLevel < 4 || laserLevel < 4))
        {
            revert MissingDependency("COMBUSTION_4_ARMOR_4_LASER_4");
        }
    }

    function requireResearch(
        Technology technology,
        uint16 researchLabLevel,
        uint16 energyLevel,
        uint16 laserLevel,
        uint16 ionLevel,
        uint16 hyperspaceLevel,
        uint16 espionageLevel,
        uint16 impulseDriveLevel,
        uint16 computerLevel,
        uint16 shieldingLevel
    ) public pure {
        uint16 requiredLabLevel = VeydriftCatalog.researchLabRequirement(technology);
        if (researchLabLevel < requiredLabLevel) {
            if (requiredLabLevel == 1) revert MissingDependency("RESEARCH_LAB_1");
            if (requiredLabLevel == 2) revert MissingDependency("RESEARCH_LAB_2");
            if (requiredLabLevel == 3) revert MissingDependency("RESEARCH_LAB_3");
            if (requiredLabLevel == 4) revert MissingDependency("RESEARCH_LAB_4");
            if (requiredLabLevel == 6) revert MissingDependency("RESEARCH_LAB_6");
            if (requiredLabLevel == 7) revert MissingDependency("RESEARCH_LAB_7");
            if (requiredLabLevel == 10) revert MissingDependency("RESEARCH_LAB_10");
            revert MissingDependency("RESEARCH_LAB_12");
        }
        if (technology == Technology.Laser && energyLevel < 2) {
            revert MissingDependency("ENERGY_2");
        }
        if (technology == Technology.Ion && (energyLevel < 4 || laserLevel < 5)) {
            revert MissingDependency("ENERGY_4_LASER_5");
        }
        if (technology == Technology.CombustionDrive && energyLevel < 1) {
            revert MissingDependency("ENERGY_1");
        }
        if (technology == Technology.Shielding && energyLevel < 3) {
            revert MissingDependency("ENERGY_3");
        }
        if (technology == Technology.Hyperspace && (energyLevel < 5 || shieldingLevel < 5)) {
            revert MissingDependency("ENERGY_5_SHIELDING_5");
        }
        if (technology == Technology.ImpulseDrive && energyLevel < 1) {
            revert MissingDependency("ENERGY_1");
        }
        if (technology == Technology.HyperspaceDrive && hyperspaceLevel < 3) {
            revert MissingDependency("HYPERSPACE_3");
        }
        if (technology == Technology.Plasma && (energyLevel < 8 || laserLevel < 10 || ionLevel < 5))
        {
            revert MissingDependency("ENERGY_8_LASER_10_ION_5");
        }
        if (technology == Technology.Astrophysics && (espionageLevel < 4 || impulseDriveLevel < 3))
        {
            revert MissingDependency("ESPIONAGE_4_IMPULSE_3");
        }
        if (
            technology == Technology.IntergalacticResearchNetwork
                && (computerLevel < 8 || hyperspaceLevel < 8)
        ) {
            revert MissingDependency("COMPUTER_8_HYPERSPACE_8");
        }
    }
}
