import type { Address } from "./evm";
import { contractEnumDefinitions } from "./contractStateSchema";

export type FleetDefenseUnitKind = "defense" | "ship";

export type FleetDefenseUnitCount = {
  count: number;
  owner: Address;
  planetId: string;
  unitId: number;
  unitKind: FleetDefenseUnitKind;
};

export type FleetDefenseParitySource = "api" | "chain" | "raw";

export type FleetDefenseParityDiscrepancyKind =
  | "api_over_report"
  | "api_under_report"
  | "raw_db_mismatch"
  | "stale_cache_result";

export type FleetDefenseParityDiscrepancy = {
  api: number | null;
  chain: number;
  kind: FleetDefenseParityDiscrepancyKind;
  owner: Address;
  planetId: string;
  raw: number | null;
  unitId: number;
  unitKind: FleetDefenseUnitKind;
  unitName: string;
};

export type FleetDefenseParityReport = {
  checkedAt: string;
  discrepancyCount: number;
  discrepancies: FleetDefenseParityDiscrepancy[];
  ok: boolean;
  summary: Record<FleetDefenseParityDiscrepancyKind, number>;
};

const unitNames = new Map<FleetDefenseUnitKind, readonly string[]>([
  ["defense", contractEnumDefinitions.find((definition) => definition.name === "Defense")?.values ?? []],
  ["ship", contractEnumDefinitions.find((definition) => definition.name === "Ship")?.values ?? []]
]);

export function compareFleetDefenseParity(
  chainCounts: readonly FleetDefenseUnitCount[],
  rawCounts: readonly FleetDefenseUnitCount[],
  apiCounts: readonly FleetDefenseUnitCount[],
  now = new Date()
): FleetDefenseParityReport {
  const rawByKey = countsByKey(rawCounts);
  const apiByKey = countsByKey(apiCounts);
  const discrepancies: FleetDefenseParityDiscrepancy[] = [];

  for (const chain of chainCounts) {
    const key = unitKey(chain);
    const raw = rawByKey.get(key);
    const api = apiByKey.get(key);
    if (raw?.count !== chain.count) {
      discrepancies.push(discrepancy("raw_db_mismatch", chain, raw?.count ?? null, api?.count ?? null));
    }
    const apiCountForComparison = api?.count ?? 0;
    if (apiCountForComparison !== chain.count) {
      discrepancies.push(discrepancy(
        apiCountForComparison > chain.count ? "api_over_report" : "api_under_report",
        chain,
        raw?.count ?? null,
        api?.count ?? null
      ));
      if (raw?.count === chain.count) {
        discrepancies.push(discrepancy("stale_cache_result", chain, raw.count, api?.count ?? null));
      }
    }
  }

  const summary = {
    api_over_report: 0,
    api_under_report: 0,
    raw_db_mismatch: 0,
    stale_cache_result: 0
  } satisfies Record<FleetDefenseParityDiscrepancyKind, number>;
  for (const item of discrepancies) {
    summary[item.kind] += 1;
  }

  return {
    checkedAt: now.toISOString(),
    discrepancyCount: discrepancies.length,
    discrepancies,
    ok: discrepancies.length === 0,
    summary
  };
}

export function fleetDefenseUnitName(unitKind: FleetDefenseUnitKind, unitId: number): string {
  return unitNames.get(unitKind)?.[unitId] ?? `${unitKind}-${unitId}`;
}

export function unitKey(count: Pick<FleetDefenseUnitCount, "planetId" | "unitId" | "unitKind">): string {
  return `${count.planetId}:${count.unitKind}:${count.unitId}`;
}

function countsByKey(counts: readonly FleetDefenseUnitCount[]): Map<string, FleetDefenseUnitCount> {
  return new Map(counts.map((count) => [unitKey(count), count]));
}

function discrepancy(
  kind: FleetDefenseParityDiscrepancyKind,
  chain: FleetDefenseUnitCount,
  raw: number | null,
  api: number | null
): FleetDefenseParityDiscrepancy {
  return {
    api,
    chain: chain.count,
    kind,
    owner: chain.owner,
    planetId: chain.planetId,
    raw,
    unitId: chain.unitId,
    unitKind: chain.unitKind,
    unitName: fleetDefenseUnitName(chain.unitKind, chain.unitId)
  };
}
