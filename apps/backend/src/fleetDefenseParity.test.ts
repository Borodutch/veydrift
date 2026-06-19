import { describe, expect, test } from "bun:test";
import type { Address } from "./evm";
import { compareFleetDefenseParity, type FleetDefenseUnitCount } from "./fleetDefenseParity";

const owner = "0x2222222222222222222222222222222222222222" as Address;

describe("fleet/defense parity comparator", () => {
  test("flags raw DB defense mismatches separately from served API drift", () => {
    const chain = [
      count("defense", 21, 1, 4),
      count("ship", 13, 0, 0),
      count("defense", 14, 2, 6)
    ];
    const raw = [
      count("defense", 21, 1, 5),
      count("ship", 13, 0, 0),
      count("defense", 14, 2, 6)
    ];
    const api = [
      count("defense", 21, 1, 4),
      count("ship", 13, 0, 5)
    ];

    const report = compareFleetDefenseParity(chain, raw, api, new Date("2026-06-18T23:56:54Z"));

    expect(report.ok).toBe(false);
    expect(report.summary).toEqual({
      api_over_report: 1,
      api_under_report: 1,
      raw_db_mismatch: 1,
      stale_cache_result: 2
    });
    expect(report.discrepancies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "raw_db_mismatch",
        planetId: "21",
        unitKind: "defense",
        unitId: 1,
        chain: 4,
        raw: 5
      }),
      expect.objectContaining({
        kind: "api_over_report",
        planetId: "13",
        unitKind: "ship",
        unitId: 0,
        chain: 0,
        raw: 0,
        api: 5
      }),
      expect.objectContaining({
        kind: "stale_cache_result",
        planetId: "13",
        unitKind: "ship",
        unitId: 0,
        chain: 0,
        raw: 0,
        api: 5
      }),
      expect.objectContaining({
        kind: "api_under_report",
        planetId: "14",
        unitKind: "defense",
        unitId: 2,
        chain: 6,
        raw: 6,
        api: null
      })
    ]));
  });
});

function count(
  unitKind: FleetDefenseUnitCount["unitKind"],
  planetId: number,
  unitId: number,
  value: number
): FleetDefenseUnitCount {
  return {
    count: value,
    owner,
    planetId: planetId.toString(),
    unitId,
    unitKind
  };
}
