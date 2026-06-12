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
  returnAt?: bigint;
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
    [100n, 200n, args.arrivalAt, args.returnAt ?? 0n, 5n]
  );
  return { topics: topics as string[], data };
}

function resolvedLog(args: {
  missionId: bigint;
  missionType?: number;
  returnAt: bigint;
}): { topics: string[]; data: string } {
  const topics = encodeEventTopics({
    abi: battleEventsAbi,
    eventName: "FleetMissionResolved",
    args: { missionId: args.missionId, resolver: owner, missionType: args.missionType ?? MissionType.Attack }
  });
  const data = encodeAbiParameters([{ name: "returnAt", type: "uint64" }], [args.returnAt]);
  return { topics: topics as string[], data };
}

function returnedLog(missionId: bigint): { topics: string[]; data: string } {
  const topics = encodeEventTopics({
    abi: battleEventsAbi,
    eventName: "FleetMissionReturned",
    args: { missionId, owner, planetId: 200n }
  });
  return { topics: topics as string[], data: "0x" };
}

describe("event topic selectors", () => {
  test("computes the canonical fleet-mission event topics", () => {
    expect(eventTopics.fleetMissionLaunched.startsWith("0x")).toBe(true);
    expect(eventTopics.fleetMissionResolved.startsWith("0x")).toBe(true);
    expect(eventTopics.fleetMissionReturned.startsWith("0x")).toBe(true);
    expect(eventTopics.fleetMissionLaunched).not.toBe(eventTopics.fleetMissionResolved);
    expect(eventTopics.fleetMissionResolved).not.toBe(eventTopics.fleetMissionReturned);
  });

  test("topic0 matches what encodeEventTopics produces", () => {
    const log = launchedLog({ missionId: 1n, missionType: MissionType.Attack, arrivalAt: 1n });
    expect(log.topics[0]).toBe(eventTopics.fleetMissionLaunched);
  });
});

describe("decodeBattleLog", () => {
  test("decodes a FleetMissionLaunched Attack log with arrivalAt and returnAt", () => {
    const log = launchedLog({
      missionId: 42n,
      missionType: MissionType.Attack,
      arrivalAt: 1_700_000_000n,
      returnAt: 1_700_000_500n
    });
    const decoded = decodeBattleLog(log);
    expect(decoded).toEqual({
      kind: "launched",
      missionId: "42",
      missionType: MissionType.Attack,
      arrivalAt: 1_700_000_000,
      returnAt: 1_700_000_500
    });
  });

  test("decodes a non-combat FleetMissionLaunched (Transport) with a return leg", () => {
    const log = launchedLog({
      missionId: 7n,
      missionType: MissionType.Transport,
      arrivalAt: 1_000n,
      returnAt: 2_000n
    });
    const decoded = decodeBattleLog(log);
    expect(decoded).toEqual({
      kind: "launched",
      missionId: "7",
      missionType: MissionType.Transport,
      arrivalAt: 1_000,
      returnAt: 2_000
    });
  });

  test("decodes a terminal FleetMissionLaunched (Deploy) with returnAt 0", () => {
    const log = launchedLog({ missionId: 8n, missionType: MissionType.Deploy, arrivalAt: 1n });
    const decoded = decodeBattleLog(log);
    expect(decoded?.kind).toBe("launched");
    if (decoded?.kind === "launched") {
      expect(decoded.missionType).toBe(MissionType.Deploy);
      expect(decoded.returnAt).toBe(0);
    }
  });

  test("decodes FleetMissionResolved carrying missionType and returnAt", () => {
    const decoded = decodeBattleLog(
      resolvedLog({ missionId: 99n, missionType: MissionType.Harvest, returnAt: 123n })
    );
    expect(decoded).toEqual({
      kind: "resolved",
      missionId: "99",
      missionType: MissionType.Harvest,
      returnAt: 123
    });
  });

  test("decodes a terminal FleetMissionResolved (returnAt 0)", () => {
    const decoded = decodeBattleLog(
      resolvedLog({ missionId: 12n, missionType: MissionType.Colonize, returnAt: 0n })
    );
    expect(decoded).toEqual({
      kind: "resolved",
      missionId: "12",
      missionType: MissionType.Colonize,
      returnAt: 0
    });
  });

  test("decodes FleetMissionReturned as a returned drop", () => {
    const decoded = decodeBattleLog(returnedLog(55n));
    expect(decoded).toEqual({ kind: "returned", missionId: "55" });
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
  test("contains every outbound mission type (arrival is resolvable for all)", () => {
    for (const value of Object.values(MissionType)) {
      expect(keeperResolvableMissionTypes.has(value)).toBe(true);
    }
    expect(keeperResolvableMissionTypes.size).toBe(Object.keys(MissionType).length);
  });
});
