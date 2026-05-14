// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Pure unlock/dependency rules for MVP buildings, units, and research.
library VeydriftDependencies {
    error MissingDependency(bytes32 dependency);

    function requireBuilding(uint8 buildingId, uint16 roboticsFactoryLevel) internal pure {
        if (buildingId == 5 && roboticsFactoryLevel < 2) {
            revert MissingDependency("ROBOTICS_FACTORY_2");
        }
        if (buildingId == 6 && roboticsFactoryLevel < 1) {
            revert MissingDependency("ROBOTICS_FACTORY_1");
        }
    }

    function requireDefense(
        uint8 defenseId,
        uint16 shipyardLevel,
        uint16 laserLevel,
        uint16 shieldingLevel
    ) internal pure {
        if (shipyardLevel == 0) {
            revert MissingDependency("SHIPYARD");
        }
        if (defenseId == 1 && laserLevel < 1) {
            revert MissingDependency("LASER_1");
        }
        if (defenseId == 2 && laserLevel < 3) {
            revert MissingDependency("LASER_3");
        }
        if (defenseId == 3 && shieldingLevel < 2) {
            revert MissingDependency("SHIELDING_2");
        }
    }

    function requireShip(uint8 shipId, uint16 shipyardLevel, uint16 combustionDriveLevel)
        internal
        pure
    {
        if (shipyardLevel == 0) {
            revert MissingDependency("SHIPYARD");
        }
        if ((shipId == 0 || shipId == 1) && combustionDriveLevel < 1) {
            revert MissingDependency("COMBUSTION_1");
        }
        if (shipId == 2 && combustionDriveLevel < 2) {
            revert MissingDependency("COMBUSTION_2");
        }
        if (shipId == 3 && combustionDriveLevel < 3) {
            revert MissingDependency("COMBUSTION_3");
        }
    }

    function requireResearch(uint8 technologyId, uint16 energyLevel, uint16 laserLevel)
        internal
        pure
    {
        if (technologyId == 1 && energyLevel < 1) {
            revert MissingDependency("ENERGY_1");
        }
        if (technologyId == 2 && laserLevel < 2) {
            revert MissingDependency("LASER_2");
        }
        if (technologyId == 7 && energyLevel < 1) {
            revert MissingDependency("ENERGY_1");
        }
    }
}
