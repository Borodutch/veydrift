import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  canonicalContractTables,
  contractEnumDefinitions
} from "./contractStateSchema";

const repoRoot = join(import.meta.dir, "../../..");

describe("canonical Veydrift contract-state schema", () => {
  test("tracks every backend canonical table concept explicitly", () => {
    expect(canonicalContractTables).toEqual([
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
      "contract_moon_defense_counts",
      "contract_moon_chance_reports",
      "contract_debris_fields",
      "contract_fleet_missions",
      "contract_rift_withdrawals",
      "contract_alliances",
      "contract_alliance_members",
      "contract_alliance_invites",
      "contract_alliance_join_requests",
      "contract_alliance_diplomacy",
      "contract_highscore_inputs",
      "indexed_event_logs"
    ]);
  });

  test("fails when Solidity enum ordinals drift without backend mapping updates", () => {
    for (const definition of contractEnumDefinitions) {
      const source = readFileSync(
        join(repoRoot, "packages/contracts/src", contractPath(definition.contract)),
        "utf8"
      );

      expect(parseSolidityEnum(source, definition.name)).toEqual([...definition.values]);
    }
  });
});

function contractPath(contract: string): string {
  if (contract === "VeydriftTypes.sol") return "libraries/VeydriftTypes.sol";
  return contract;
}

function parseSolidityEnum(source: string, enumName: string): string[] {
  const match = source.match(new RegExp(`enum\\s+${enumName}\\s*{([\\s\\S]*?)}`));
  if (!match?.[1]) {
    throw new Error(`Unable to find enum ${enumName}`);
  }

  return match[1]
    .replace(/\/\/.*$/gm, "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
