// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

enum Building {
    MetalMine,
    CrystalMine,
    DeuteriumSynthesizer,
    SolarPlant,
    RoboticsFactory,
    Shipyard,
    ResearchLab,
    MetalStorage,
    CrystalStorage,
    DeuteriumTank,
    FusionReactor,
    NaniteFactory,
    Terraformer,
    AllianceDepot,
    MissileSilo,
    InterdimensionalRiftStabilizer
}

enum MoonBuilding {
    LunarBase,
    RoboticsFactory,
    JumpGate,
    Shipyard
}

enum Defense {
    RocketLauncher,
    LightLaser,
    HeavyLaser,
    SmallShieldDome,
    GaussCannon,
    IonCannon,
    PlasmaTurret,
    LargeShieldDome,
    AntiBallisticMissile,
    InterplanetaryMissile
}

enum Ship {
    SmallCargo,
    LightFighter,
    Recycler,
    ColonyShip,
    LargeCargo,
    HeavyFighter,
    Cruiser,
    Battleship,
    Bomber,
    SolarSatellite,
    Destroyer,
    Deathstar,
    Battlecruiser,
    Reaper,
    Pathfinder,
    Crawler
}

/// @dev kind 0 = ship, 1 = defense; IDs retain the existing enum ordinals.
struct ProductionOrder {
    uint8 kind;
    uint8 itemId;
    uint32 quantity;
}

/// @dev Typed resolution only: leg 0 = arrival/hold expiry, leg 1 = return.
struct MissionResolutionItem {
    uint256 missionId;
    uint8 leg;
}

/// @dev Pending means no observed canonical progress; Progress means preparation/rounds advanced
/// without settling this leg. Canonical status remains authoritative for both.
enum MissionResolutionOutcome {
    Settled,
    Pending,
    AlreadySettled,
    Invalid,
    NotDue,
    Failed,
    GasLimited,
    Progress
}

enum Technology {
    Energy,
    Laser,
    Ion,
    CombustionDrive,
    Computer,
    Weapons,
    Shielding,
    Armor,
    Hyperspace,
    ImpulseDrive,
    HyperspaceDrive,
    Plasma,
    Astrophysics,
    IntergalacticResearchNetwork,
    Graviton
}

enum Resource {
    Metal,
    Crystal,
    Deuterium,
    Energy
}
