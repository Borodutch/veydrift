import { decodeEventLog, toEventSelector, type Abi } from "viem";

/**
 * Fleet-mission slice of the VeydriftGame event surface (mirrors
 * packages/contracts/src/VeydriftGameStorage.sol). The keeper drives a two-leg state machine off
 * these events: a mission is launched (arrival pending), its arrival is resolved, a return leg may
 * be explicitly exposed for missions that actually became Returning/Recalled, and finally its return
 * is resolved (terminal). Solidity encodes enum topics as `uint8`.
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
  },
  {
    type: "event",
    name: "FleetMissionReturnExposed",
    inputs: [
      { name: "missionId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "status", type: "uint8", indexed: true },
      { name: "originPlanetId", type: "uint256", indexed: false },
      { name: "targetPlanetId", type: "uint256", indexed: false },
      { name: "returnAt", type: "uint64", indexed: false },
      { name: "metal", type: "uint128", indexed: false },
      { name: "crystal", type: "uint128", indexed: false },
      { name: "deuterium", type: "uint128", indexed: false }
    ]
  },
  {
    type: "event",
    name: "DefenseHoldStationed",
    inputs: [
      { name: "missionId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "defenderPlanetId", type: "uint256", indexed: true },
      { name: "originPlanetId", type: "uint256", indexed: false },
      { name: "arrivalAt", type: "uint64", indexed: false },
      { name: "holdUntil", type: "uint64", indexed: false },
      { name: "returnAt", type: "uint64", indexed: false }
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

export const FleetMissionStatus = {
  None: 0,
  Outbound: 1,
  Returning: 2,
  Resolved: 3,
  Returned: 4,
  Recalled: 5
} as const;

/**
 * Mission types whose ARRIVAL leg the keeper resolves promptly. This is now every outbound mission
 * type — `resolveFleetMission` is permissionless for all of them, and the resolver's simulate-first
 * guard harmlessly skips/retries anything not yet (or never) resolvable.
 */
export const keeperResolvableMissionTypes = new Set<number>(Object.values(MissionType));

/**
 * Mission types that can legitimately infer a return leg from `FleetMissionResolved.returnAt`.
 * Deploy and successful Colonize are terminal at arrival even though their resolution events can
 * carry a nonzero stored timestamp. Blocked Colonize returns are queued by the authoritative
 * `FleetMissionReturnExposed` event or by status reconciliation, not by `returnAt` alone.
 */
export const returnLegMissionTypes = new Set<number>(
  Object.values(MissionType).filter(
    (missionType) => missionType !== MissionType.Deploy && missionType !== MissionType.Colonize
  )
);

export function hasReturnLegAfterArrival(missionType: number, returnAt: number): boolean {
  return returnAt > 0 && returnLegMissionTypes.has(missionType);
}

export const eventTopics = {
  fleetMissionLaunched: toEventSelector(
    "FleetMissionLaunched(uint256,address,uint8,uint256,uint256,uint64,uint64,uint256)"
  ),
  fleetMissionResolved: toEventSelector("FleetMissionResolved(uint256,address,uint8,uint64)"),
  fleetMissionReturned: toEventSelector("FleetMissionReturned(uint256,address,uint256)"),
  fleetMissionReturnExposed: toEventSelector(
    "FleetMissionReturnExposed(uint256,address,uint8,uint256,uint256,uint64,uint128,uint128,uint128)"
  ),
  defenseHoldStationed: toEventSelector(
    "DefenseHoldStationed(uint256,address,uint256,uint256,uint64,uint64,uint64)"
  )
} as const;

/** topic[0] values the keeper subscribes to (OR-filtered server-side over the game contract). */
export const subscribedTopic0 = [
  eventTopics.fleetMissionLaunched,
  eventTopics.fleetMissionResolved,
  eventTopics.fleetMissionReturned,
  eventTopics.fleetMissionReturnExposed,
  eventTopics.defenseHoldStationed
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
  /** Stored return timestamp from launch; only return-leg mission types use it for a return leg. */
  returnAt: number;
  /** Randomness request id for normal attacks; ACS attack joiners store the main attack mission id. */
  randomnessRequestId: string;
};

export type DecodedResolved = {
  kind: "resolved";
  missionId: string;
  missionType: number;
  /** Possibly updated return time; mission type determines whether this represents a return leg. */
  returnAt: number;
};

export type DecodedReturned = {
  kind: "returned";
  missionId: string;
};

export type DecodedReturnExposed = {
  kind: "returnExposed";
  missionId: string;
  status: number;
  /** Authoritative Unix seconds when the return leg becomes resolvable. */
  returnAt: number;
};

export type DecodedDefenseHoldStationed = {
  kind: "defenseHoldStationed";
  missionId: string;
  /** DefenseHold can be sent home after this hold-window end, not at arrivalAt. */
  holdUntil: number;
  /** Final return timestamp after the holding fleet is sent home. */
  returnAt: number;
};

export type DecodedBattleEvent =
  | DecodedLaunched
  | DecodedResolved
  | DecodedReturned
  | DecodedReturnExposed
  | DecodedDefenseHoldStationed;

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
        randomnessRequestId: bigint;
      };
      return {
        kind: "launched",
        missionId: args.missionId.toString(),
        missionType: Number(args.missionType),
        arrivalAt: Number(args.arrivalAt),
        returnAt: Number(args.returnAt),
        randomnessRequestId: args.randomnessRequestId.toString()
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

    if (topic0 === eventTopics.fleetMissionReturnExposed) {
      const decoded = decodeEventLog({
        abi: battleEventsAbi,
        eventName: "FleetMissionReturnExposed",
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
        data: log.data as `0x${string}`
      });
      const args = decoded.args as {
        missionId: bigint;
        status: number;
        returnAt: bigint;
      };
      return {
        kind: "returnExposed",
        missionId: args.missionId.toString(),
        status: Number(args.status),
        returnAt: Number(args.returnAt)
      };
    }

    if (topic0 === eventTopics.defenseHoldStationed) {
      const decoded = decodeEventLog({
        abi: battleEventsAbi,
        eventName: "DefenseHoldStationed",
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
        data: log.data as `0x${string}`
      });
      const args = decoded.args as {
        missionId: bigint;
        holdUntil: bigint;
        returnAt: bigint;
      };
      return {
        kind: "defenseHoldStationed",
        missionId: args.missionId.toString(),
        holdUntil: Number(args.holdUntil),
        returnAt: Number(args.returnAt)
      };
    }
  } catch {
    return null;
  }

  return null;
}
