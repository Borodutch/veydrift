import { decodeEventLog, toEventSelector, type Abi } from "viem";

/**
 * Battle-relevant slice of the VeydriftGame event surface. We only decode the three events the
 * keeper acts on (mirrors packages/contracts/src/VeydriftGameStorage.sol). Solidity encodes the
 * `FleetMissionType` enum as `uint8` in the ABI, so the indexed `missionType` topic is a uint8.
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
    name: "AttackBattleResolved",
    inputs: [
      { name: "missionId", type: "uint256", indexed: true },
      { name: "attacker", type: "address", indexed: true },
      { name: "targetPlanetId", type: "uint256", indexed: true },
      { name: "outcome", type: "uint8", indexed: false },
      { name: "rounds", type: "uint8", indexed: false },
      { name: "randomSeed", type: "uint256", indexed: false },
      { name: "lootMetal", type: "uint128", indexed: false },
      { name: "lootCrystal", type: "uint128", indexed: false },
      { name: "lootDeuterium", type: "uint128", indexed: false }
    ]
  }
] as const satisfies Abi;

/**
 * `FleetMissionType` enum ordinals from VeydriftGameStorage.sol. The keeper only resolves combat
 * legs (Attack/Harvest) promptly — every other mission type lazy-settles, so it is out of scope.
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

/** Mission types this keeper resolves promptly. Everything else is left to lazy settlement. */
export const keeperResolvableMissionTypes = new Set<number>([MissionType.Attack, MissionType.Harvest]);

export const eventTopics = {
  fleetMissionLaunched: toEventSelector(
    "FleetMissionLaunched(uint256,address,uint8,uint256,uint256,uint64,uint64,uint256)"
  ),
  fleetMissionResolved: toEventSelector("FleetMissionResolved(uint256,address,uint8,uint64)"),
  attackBattleResolved: toEventSelector(
    "AttackBattleResolved(uint256,address,uint256,uint8,uint8,uint256,uint128,uint128,uint128)"
  )
} as const;

/** topic[0] values the keeper subscribes to (OR-filtered server-side over the game contract). */
export const subscribedTopic0 = [
  eventTopics.fleetMissionLaunched,
  eventTopics.fleetMissionResolved,
  eventTopics.attackBattleResolved
] as const;

export type RawLog = {
  topics: string[];
  data: string;
};

export type DecodedLaunched = {
  kind: "launched";
  missionId: string;
  missionType: number;
  arrivalAt: number;
};

export type DecodedResolved = {
  kind: "resolved";
  missionId: string;
};

export type DecodedBattleEvent = DecodedLaunched | DecodedResolved;

/**
 * Decode a raw JSON-RPC log into the keeper's internal event shape. Returns `null` for logs that are
 * not one of the three battle events (or that fail to decode) so callers can simply skip them.
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
      };
      return {
        kind: "launched",
        missionId: args.missionId.toString(),
        missionType: Number(args.missionType),
        arrivalAt: Number(args.arrivalAt)
      };
    }

    if (topic0 === eventTopics.fleetMissionResolved || topic0 === eventTopics.attackBattleResolved) {
      // Both carry missionId as the first indexed arg (topic[1]); decode just that cheaply.
      const missionTopic = log.topics[1];
      if (!missionTopic) {
        return null;
      }
      return { kind: "resolved", missionId: BigInt(missionTopic).toString() };
    }
  } catch {
    return null;
  }

  return null;
}
