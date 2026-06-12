import { decodeEventLog, toEventSelector, type Abi } from "viem";

/**
 * Fleet-mission slice of the VeydriftGame event surface (mirrors
 * packages/contracts/src/VeydriftGameStorage.sol). The keeper drives a two-leg state machine off
 * these three events: a mission is launched (arrival pending), its arrival is resolved (which either
 * makes it terminal or transitions it to a pending return leg), and finally its return is resolved
 * (terminal). Solidity encodes the `FleetMissionType` enum as `uint8`, so the indexed `missionType`
 * topic is a uint8.
 */
export const battleEventsAbi = [
  {
    type: "event",
    name: "FleetMissionLaunched",
    inputs: [
      { name: "missionId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "missionType", type: "uint8", indexed: true },
      { name: "originPlanetId", type: "uint256", indexed: false },
      { name: "targetPlanetId", type: "uint256", indexed: false },
      { name: "arrivalAt", type: "uint64", indexed: false },
      { name: "returnAt", type: "uint64", indexed: false },
      { name: "randomnessRequestId", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "FleetMissionResolved",
    inputs: [
      { name: "missionId", type: "uint256", indexed: true },
      { name: "resolver", type: "address", indexed: true },
      { name: "missionType", type: "uint8", indexed: true },
      { name: "returnAt", type: "uint64", indexed: false }
    ]
  },
  {
    type: "event",
    name: "FleetMissionReturned",
    inputs: [
      { name: "missionId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "planetId", type: "uint256", indexed: true }
    ]
  }
] as const satisfies Abi;

/**
 * `FleetMissionType` enum ordinals from VeydriftGameStorage.sol. Every outbound mission type has an
 * arrival leg the keeper resolves promptly; round-trip types (Transport/Attack/Harvest/…) also have
 * a return leg. (Lazy on-chain reconcile remains the correctness floor; the keeper is the promptness
 * optimization.)
 */
export const MissionType = {
  Transport: 0,
  Deploy: 1,
  Colonize: 2,
  Attack: 3,
  Harvest: 4,
  AcsDefend: 5,
  Intercept: 6,
  MissileAttack: 7,
  AcsAttack: 8,
  DefenseHold: 9
} as const;

export const missionTypeNames: Record<number, string> = Object.fromEntries(
  Object.entries(MissionType).map(([name, value]) => [value, name])
);

/**
 * Mission types whose ARRIVAL leg the keeper resolves promptly. This is now every outbound mission
 * type — `resolveFleetMission` is permissionless for all of them, and the resolver's simulate-first
 * guard harmlessly skips/retries anything not yet (or never) resolvable.
 */
export const keeperResolvableMissionTypes = new Set<number>(Object.values(MissionType));

export const eventTopics = {
  fleetMissionLaunched: toEventSelector(
    "FleetMissionLaunched(uint256,address,uint8,uint256,uint256,uint64,uint64,uint256)"
  ),
  fleetMissionResolved: toEventSelector("FleetMissionResolved(uint256,address,uint8,uint64)"),
  fleetMissionReturned: toEventSelector("FleetMissionReturned(uint256,address,uint256)")
} as const;

/** topic[0] values the keeper subscribes to (OR-filtered server-side over the game contract). */
export const subscribedTopic0 = [
  eventTopics.fleetMissionLaunched,
  eventTopics.fleetMissionResolved,
  eventTopics.fleetMissionReturned
] as const;

export type RawLog = {
  topics: string[];
  data: string;
};

export type DecodedLaunched = {
  kind: "launched";
  missionId: string;
  missionType: number;
  /** Unix seconds when the mission arrives and its arrival leg becomes resolvable. */
  arrivalAt: number;
  /** Unix seconds the return leg becomes resolvable; 0 means the mission has no return leg. */
  returnAt: number;
};

export type DecodedResolved = {
  kind: "resolved";
  missionId: string;
  missionType: number;
  /** (Possibly updated) return time; 0 (or terminal status) means no return leg. */
  returnAt: number;
};

export type DecodedReturned = {
  kind: "returned";
  missionId: string;
};

export type DecodedBattleEvent = DecodedLaunched | DecodedResolved | DecodedReturned;

/**
 * Decode a raw JSON-RPC log into the keeper's internal event shape. Returns `null` for logs that are
 * not one of the three fleet-mission events (or that fail to decode) so callers can simply skip them.
 */
export function decodeBattleLog(log: RawLog): DecodedBattleEvent | null {
  const topic0 = log.topics[0];
  if (!topic0) {
    return null;
  }

  try {
    if (topic0 === eventTopics.fleetMissionLaunched) {
      const decoded = decodeEventLog({
        abi: battleEventsAbi,
        eventName: "FleetMissionLaunched",
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
        data: log.data as `0x${string}`
      });
      const args = decoded.args as {
        missionId: bigint;
        missionType: number;
        arrivalAt: bigint;
        returnAt: bigint;
      };
      return {
        kind: "launched",
        missionId: args.missionId.toString(),
        missionType: Number(args.missionType),
        arrivalAt: Number(args.arrivalAt),
        returnAt: Number(args.returnAt)
      };
    }

    if (topic0 === eventTopics.fleetMissionResolved) {
      const decoded = decodeEventLog({
        abi: battleEventsAbi,
        eventName: "FleetMissionResolved",
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
        data: log.data as `0x${string}`
      });
      const args = decoded.args as {
        missionId: bigint;
        missionType: number;
        returnAt: bigint;
      };
      return {
        kind: "resolved",
        missionId: args.missionId.toString(),
        missionType: Number(args.missionType),
        returnAt: Number(args.returnAt)
      };
    }

    if (topic0 === eventTopics.fleetMissionReturned) {
      // missionId is the first indexed arg (topic[1]); decode just that cheaply.
      const missionTopic = log.topics[1];
      if (!missionTopic) {
        return null;
      }
      return { kind: "returned", missionId: BigInt(missionTopic).toString() };
    }
  } catch {
    return null;
  }

  return null;
}
