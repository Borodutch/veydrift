// Canonical contract-state ownership lives here: tables mirror Solidity IDs,
// ordinals, and storage concepts first; UI/read-model derivatives must be built
// from these tables instead of becoming the source of truth.
export type ContractEnumDefinition = {
  readonly contract: string;
  readonly name: string;
  readonly values: readonly string[];
};

export const contractEnumDefinitions = [
  {
    contract: "VeydriftTypes.sol",
    name: "Building",
    values: [
      "MetalMine",
      "CrystalMine",
      "DeuteriumSynthesizer",
      "SolarPlant",
      "RoboticsFactory",
      "Shipyard",
      "ResearchLab",
      "MetalStorage",
      "CrystalStorage",
      "DeuteriumTank",
      "FusionReactor",
      "NaniteFactory",
      "Terraformer",
      "AllianceDepot",
      "MissileSilo",
      "InterdimensionalRiftStabilizer"
    ]
  },
  {
    contract: "VeydriftTypes.sol",
    name: "MoonBuilding",
    values: [
      "LunarBase",
      "ReservedMoonBuilding1",
      "JumpGate"
    ]
  },
  {
    contract: "VeydriftTypes.sol",
    name: "Defense",
    values: [
      "RocketLauncher",
      "LightLaser",
      "HeavyLaser",
      "SmallShieldDome",
      "GaussCannon",
      "IonCannon",
      "PlasmaTurret",
      "LargeShieldDome",
      "AntiBallisticMissile",
      "InterplanetaryMissile"
    ]
  },
  {
    contract: "VeydriftTypes.sol",
    name: "Ship",
    values: [
      "SmallCargo",
      "LightFighter",
      "Recycler",
      "ColonyShip",
      "LargeCargo",
      "HeavyFighter",
      "Cruiser",
      "Battleship",
      "Bomber",
      "SolarSatellite",
      "Destroyer",
      "Deathstar",
      "Battlecruiser",
      "Reaper",
      "Pathfinder",
      "Crawler"
    ]
  },
  {
    contract: "VeydriftTypes.sol",
    name: "Technology",
    values: [
      "Energy",
      "Laser",
      "Ion",
      "CombustionDrive",
      "Computer",
      "Weapons",
      "Shielding",
      "Armor",
      "Hyperspace",
      "ImpulseDrive",
      "HyperspaceDrive",
      "Plasma",
      "Astrophysics",
      "IntergalacticResearchNetwork",
      "Graviton"
    ]
  },
  {
    contract: "VeydriftTypes.sol",
    name: "Resource",
    values: [
      "Metal",
      "Crystal",
      "Deuterium",
      "Energy"
    ]
  },
  {
    contract: "VeydriftGameStorage.sol",
    name: "FleetMissionType",
    values: [
      "Transport",
      "Deploy",
      "Colonize",
      "Attack",
      "Harvest",
      "AcsDefend",
      "Intercept",
      "MissileAttack",
      "AcsAttack"
    ]
  },
  {
    contract: "VeydriftGameStorage.sol",
    name: "FleetMissionStatus",
    values: [
      "None",
      "Outbound",
      "Returning",
      "Resolved",
      "Returned",
      "Recalled"
    ]
  },
  {
    contract: "VeydriftAllianceSystem.sol",
    name: "AllianceRole",
    values: [
      "None",
      "Member",
      "Officer",
      "Owner"
    ]
  },
  {
    contract: "VeydriftAllianceSystem.sol",
    name: "DiplomacyStatus",
    values: [
      "None",
      "Ally",
      "NonAggressionPact",
      "War"
    ]
  }
] as const satisfies readonly ContractEnumDefinition[];

export const buildingIds = enumIds("Building");
export const moonBuildingIds = enumIds("MoonBuilding");
export const defenseIds = enumIds("Defense");
export const shipIds = enumIds("Ship");
export const technologyIds = enumIds("Technology");
export const resourceIds = enumIds("Resource");
export const fleetMissionTypeIds = enumIds("FleetMissionType");
export const fleetMissionStatusIds = enumIds("FleetMissionStatus");
export const allianceRoleIds = enumIds("AllianceRole");
export const diplomacyStatusIds = enumIds("DiplomacyStatus");

export const canonicalContractTables = [
  "contract_players",
  "contract_planets",
  "contract_planet_resources",
  "contract_building_levels",
  "contract_production_queues",
  "contract_technology_levels",
  "contract_research_queues",
  "contract_ship_counts",
  "contract_shipyard_queues",
  "contract_defense_counts",
  "contract_defense_queues",
  "contract_moons",
  "contract_moon_building_levels",
  "contract_moon_building_queues",
  "contract_moon_chance_reports",
  "contract_debris_fields",
  "contract_fleet_missions",
  "contract_rift_withdrawals",
  "contract_alliances",
  "contract_alliance_members",
  "contract_alliance_diplomacy",
  "contract_highscore_inputs",
  "indexed_event_logs"
] as const;

function enumIds(name: ContractEnumDefinition["name"]): readonly number[] {
  const definition = contractEnumDefinitions.find((candidate) => candidate.name === name);
  if (!definition) return [];
  return definition.values.map((_, index) => index);
}
