// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Building, Defense, Ship, Technology} from "./VeydriftTypes.sol";

/// @notice Pure unlock/dependency rules for MVP buildings, units, and research.
library VeydriftDependencies {
    error MissingDependency(bytes32 dependency);

    function requireBuilding(
        Building building,
        uint16 roboticsFactoryLevel,
        uint16 researchLabLevel,
        uint16 energyLevel,
        uint16 hyperspaceLevel
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
        uint16 laserLevel,
        uint16 ionLevel,
        uint16 shieldingLevel,
        uint16 plasmaLevel
    ) public pure {
        if (shipyardLevel == 0) {
            revert MissingDependency("SHIPYARD");
        }
        if (defense == Defense.LightLaser && laserLevel < 1) {
            revert MissingDependency("LASER_1");
        }
        if (defense == Defense.HeavyLaser && laserLevel < 3) {
            revert MissingDependency("LASER_3");
        }
        if (defense == Defense.SmallShieldDome && shieldingLevel < 2) {
            revert MissingDependency("SHIELDING_2");
        }
        if (defense == Defense.GaussCannon && (laserLevel < 6 || shieldingLevel < 1)) {
            revert MissingDependency("LASER_6_SHIELDING_1");
        }
        if (defense == Defense.IonCannon && ionLevel < 4) {
            revert MissingDependency("ION_4");
        }
        if (defense == Defense.PlasmaTurret && plasmaLevel < 7) {
            revert MissingDependency("PLASMA_7");
        }
        if (defense == Defense.LargeShieldDome && shieldingLevel < 6) {
            revert MissingDependency("SHIELDING_6");
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
        uint16 gravitonLevel
    ) public pure {
        if (shipyardLevel == 0) {
            revert MissingDependency("SHIPYARD");
        }
        if ((ship == Ship.SmallCargo || ship == Ship.LightFighter) && combustionDriveLevel < 1) {
            revert MissingDependency("COMBUSTION_1");
        }
        if (ship == Ship.Recycler && combustionDriveLevel < 2) {
            revert MissingDependency("COMBUSTION_2");
        }
        if (ship == Ship.ColonyShip && combustionDriveLevel < 3) {
            revert MissingDependency("COMBUSTION_3");
        }
        if (ship == Ship.LargeCargo && combustionDriveLevel < 6) {
            revert MissingDependency("COMBUSTION_6");
        }
        if (ship == Ship.HeavyFighter && impulseDriveLevel < 2) {
            revert MissingDependency("IMPULSE_2");
        }
        if (ship == Ship.Cruiser && impulseDriveLevel < 4) {
            revert MissingDependency("IMPULSE_4");
        }
        if (ship == Ship.Battleship && hyperspaceDriveLevel < 4) {
            revert MissingDependency("HYPERSPACE_DRIVE_4");
        }
        if (ship == Ship.EspionageProbe && espionageLevel < 2) {
            revert MissingDependency("ESPIONAGE_2");
        }
        if (ship == Ship.Bomber && impulseDriveLevel < 6) {
            revert MissingDependency("IMPULSE_6");
        }
        if (ship == Ship.Destroyer && hyperspaceDriveLevel < 6) {
            revert MissingDependency("HYPERSPACE_DRIVE_6");
        }
        if (ship == Ship.Deathstar && gravitonLevel < 1) {
            revert MissingDependency("GRAVITON_1");
        }
        if (ship == Ship.Battlecruiser && hyperspaceDriveLevel < 5) {
            revert MissingDependency("HYPERSPACE_DRIVE_5");
        }
        if (ship == Ship.Reaper && (hyperspaceDriveLevel < 7 || hyperspaceLevel < 6)) {
            revert MissingDependency("HYPERSPACE_DRIVE_7_HYPERSPACE_6");
        }
        if (ship == Ship.Pathfinder && hyperspaceDriveLevel < 2) {
            revert MissingDependency("HYPERSPACE_DRIVE_2");
        }
    }

    function requireResearch(
        Technology technology,
        uint16 energyLevel,
        uint16 laserLevel,
        uint16 ionLevel,
        uint16 hyperspaceLevel,
        uint16 espionageLevel,
        uint16 impulseDriveLevel,
        uint16 computerLevel
    ) public pure {
        if (technology == Technology.Laser && energyLevel < 1) {
            revert MissingDependency("ENERGY_1");
        }
        if (technology == Technology.Ion && laserLevel < 2) {
            revert MissingDependency("LASER_2");
        }
        if (technology == Technology.Shielding && energyLevel < 1) {
            revert MissingDependency("ENERGY_1");
        }
        if (technology == Technology.Hyperspace && energyLevel < 5) {
            revert MissingDependency("ENERGY_5");
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
        if (technology == Technology.Graviton && energyLevel < 12) {
            revert MissingDependency("ENERGY_12");
        }
    }
}
