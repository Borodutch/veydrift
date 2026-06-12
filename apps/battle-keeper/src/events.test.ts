import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics } from "viem";

import {
  battleEventsAbi,
  decodeBattleLog,
  eventTopics,
  keeperResolvableMissionTypes,
  MissionType
} from "./events";

const owner = "0x1111111111111111111111111111111111111111" as const;

function launchedLog(args: {
  missionId: bigint;
  missionType: number;
  arrivalAt: bigint;
}): { topics: string[]; data: string } {
  const topics = encodeEventTopics({
    abi: battleEventsAbi,
    eventName: "FleetMissionLaunched",
    args: { missionId: args.missionId, owner, missionType: args.missionType }
  });
  const data = encodeAbiParameters(
    [
      { name: "originPlanetId", type: "uint256" },
      { name: "targetPlanetId", type: "uint256" },
      { name: "arrivalAt", type: "uint64" },
      { name: "returnAt", type: "uint64" },
      { name: "randomnessRequestId", type: "uint256" }
    ],
    [100n, 200n, args.arrivalAt, 0n, 5n]
  );
  return { topics: topics as string[], data };
}

function resolvedLog(missionId: bigint): { topics: string[]; data: string } {
  const topics = encodeEventTopics({
    abi: battleEventsAbi,
    eventName: "FleetMissionResolved",
    args: { missionId, resolver: owner, missionType: MissionType.Attack }
  });
  const data = encodeAbiParameters([{ name: "returnAt", type: "uint64" }], [123n]);
  return { topics: topics as string[], data };
}

function attackBattleResolvedLog(missionId: bigint): { topics: string[]; data: string } {
  const topics = encodeEventTopics({
    abi: battleEventsAbi,
    eventName: "AttackBattleResolved",
    args: { missionId, attacker: owner, targetPlanetId: 200n }
  });
  const data = encodeAbiParameters(
    [
      { name: "outcome", type: "uint8" },
      { name: "rounds", type: "uint8" },
      { name: "randomSeed", type: "uint256" },
      { name: "lootMetal", type: "uint128" },
      { name: "lootCrystal", type: "uint128" },
      { name: "lootDeuterium", type: "uint128" }
    ],
    [1, 3, 123456n, 1n, 2n, 3n]
  );
  return { topics: topics as string[], data };
}

describe("event topic selectors", () => {
  test("computes the canonical battle event topics", () => {
    expect(eventTopics.fleetMissionLaunched.startsWith("0x")).toBe(true);
    expect(eventTopics.fleetMissionResolved.startsWith("0x")).toBe(true);
    expect(eventTopics.attackBattleResolved.startsWith("0x")).toBe(true);
    expect(eventTopics.fleetMissionLaunched).not.toBe(eventTopics.fleetMissionResolved);
  });

  test("topic0 matches what encodeEventTopics produces", () => {
    const log = launchedLog({ missionId: 1n, missionType: MissionType.Attack, arrivalAt: 1n });
    expect(log.topics[0]).toBe(eventTopics.fleetMissionLaunched);
  });
});

describe("decodeBattleLog", () => {
  test("decodes a FleetMissionLaunched Attack log with arrivalAt", () => {
    const log = launchedLog({
      missionId: 42n,
      missionType: MissionType.Attack,
      arrivalAt: 1_700_000_000n
    });
    const decoded = decodeBattleLog(log);
    expect(decoded).toEqual({
      kind: "launched",
      missionId: "42",
      missionType: MissionType.Attack,
      arrivalAt: 1_700_000_000
    });
  });

  test("decodes a FleetMissionLaunched Harvest log", () => {
    const log = launchedLog({ missionId: 7n, missionType: MissionType.Harvest, arrivalAt: 1n });
    const decoded = decodeBattleLog(log);
    expect(decoded?.kind).toBe("launched");
    if (decoded?.kind === "launched") {
      expect(decoded.missionId).toBe("7");
      expect(decoded.missionType).toBe(MissionType.Harvest);
    }
  });

  test("decodes FleetMissionResolved as a resolved drop", () => {
    const decoded = decodeBattleLog(resolvedLog(99n));
    expect(decoded).toEqual({ kind: "resolved", missionId: "99" });
  });

  test("decodes AttackBattleResolved as a resolved drop", () => {
    const decoded = decodeBattleLog(attackBattleResolvedLog(55n));
    expect(decoded).toEqual({ kind: "resolved", missionId: "55" });
  });

  test("returns null for unrelated / malformed logs", () => {
    expect(decodeBattleLog({ topics: [], data: "0x" })).toBeNull();
    expect(
      decodeBattleLog({
        topics: ["0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"],
        data: "0x"
      })
    ).toBeNull();
  });
});

describe("keeperResolvableMissionTypes", () => {
  test("contains only Attack and Harvest", () => {
    expect(keeperResolvableMissionTypes.has(MissionType.Attack)).toBe(true);
    expect(keeperResolvableMissionTypes.has(MissionType.Harvest)).toBe(true);
    expect(keeperResolvableMissionTypes.has(MissionType.Transport)).toBe(false);
    expect(keeperResolvableMissionTypes.has(MissionType.Colonize)).toBe(false);
    expect(keeperResolvableMissionTypes.size).toBe(2);
  });
});
