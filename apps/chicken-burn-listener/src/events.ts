import {
  decodeEventLog,
  decodeFunctionData,
  keccak256,
  parseAbiItem,
  toBytes,
  toEventSelector,
  type Abi,
  type AbiEvent
} from "viem";

export const zeroAddress = "0x0000000000000000000000000000000000000000";

export type RawLog = {
  address: `0x${string}`;
  blockNumber: `0x${string}` | bigint;
  transactionHash: `0x${string}`;
  logIndex: `0x${string}` | bigint;
  topics: `0x${string}`[];
  data: `0x${string}`;
  removed?: boolean;
};

export type ChickenBurnEvent = {
  burnId: `0x${string}`;
  burner: `0x${string}`;
  tokenId: string;
  planetId: string;
  sourceTxHash: `0x${string}`;
  sourceLogIndex: number;
  sourceBlockNumber: bigint;
};

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)"
) as AbiEvent;

const burnWithMoonFunctions = [
  {
    type: "function",
    name: "burnForMoon",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "planetId", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "burnChickenForMoon",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "planetId", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "planetId", type: "uint256" }
    ],
    outputs: []
  }
] as const satisfies Abi;

export function burnEventAbiItem(signature: string): AbiEvent {
  const item = parseAbiItem(signature);
  if (item.type !== "event") {
    throw new Error("CHICKEN_BURN_EVENT_SIGNATURE must be an event signature.");
  }
  return item;
}

export function burnEventTopic(signature: string | AbiEvent): `0x${string}` {
  return toEventSelector(signature);
}

export function transferBurnTopic(): `0x${string}` {
  return toEventSelector(transferEvent);
}

export function decodeChickenBurnLog(
  log: RawLog,
  burnEvent: AbiEvent,
  transactionInput?: `0x${string}`
): ChickenBurnEvent | null {
  const topic0 = log.topics[0];
  if (!topic0) return null;
  if (topic0 === toEventSelector(burnEvent)) {
    return decodeConfiguredBurnLog(log, burnEvent);
  }
  if (topic0 === transferBurnTopic()) {
    return decodeTransferBurnLog(log, transactionInput);
  }
  return null;
}

function decodeConfiguredBurnLog(log: RawLog, burnEvent: AbiEvent): ChickenBurnEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: [burnEvent],
      topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      data: log.data
    });
    const args = decoded.args as Record<string, unknown>;
    const burner = asAddress(args.burner ?? args.from ?? args.player ?? args.owner);
    const tokenId = asBigInt(args.tokenId ?? args.chickenId);
    const planetId = asBigInt(args.planetId ?? args.targetPlanetId);
    if (!burner || tokenId === null || planetId === null) {
      return null;
    }
    return buildBurnEvent(log, burner, tokenId, planetId);
  } catch {
    return null;
  }
}

function decodeTransferBurnLog(
  log: RawLog,
  transactionInput?: `0x${string}`
): ChickenBurnEvent | null {
  if (!transactionInput) return null;
  try {
    const decoded = decodeEventLog({
      abi: [transferEvent],
      eventName: "Transfer",
      topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      data: log.data
    });
    const args = decoded.args as { from?: `0x${string}`; to?: `0x${string}`; tokenId?: bigint };
    if (!args.from || args.to?.toLowerCase() !== zeroAddress || args.tokenId === undefined) {
      return null;
    }
    const moonTarget = decodeMoonTargetFromBurnInput(transactionInput);
    if (!moonTarget || moonTarget.tokenId !== args.tokenId) {
      return null;
    }
    return buildBurnEvent(
      log,
      args.from,
      args.tokenId,
      moonTarget.planetId
    );
  } catch {
    return null;
  }
}

export function decodeMoonTargetFromBurnInput(data: `0x${string}`):
  | {
      tokenId: bigint;
      planetId: bigint;
    }
  | null {
  try {
    const decoded = decodeFunctionData({ abi: burnWithMoonFunctions, data });
    const args = decoded.args as readonly [bigint, bigint];
    if (!args || args.length !== 2) return null;
    return {
      tokenId: args[0],
      planetId: args[1]
    };
  } catch {
    return null;
  }
}

function buildBurnEvent(
  log: RawLog,
  burner: `0x${string}`,
  tokenId: bigint,
  planetId: bigint
): ChickenBurnEvent {
  const sourceLogIndex = toNumber(log.logIndex);
  return {
    burnId: burnIdFromLog(log, tokenId),
    burner,
    tokenId: tokenId.toString(),
    planetId: planetId.toString(),
    sourceTxHash: log.transactionHash,
    sourceLogIndex,
    sourceBlockNumber: toBigInt(log.blockNumber)
  };
}

export function burnIdFromLog(log: Pick<RawLog, "address">, tokenId: bigint): `0x${string}` {
  return keccak256(toBytes(`${log.address.toLowerCase()}:${tokenId.toString()}`));
}

function asAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return null;
  }
  return value as `0x${string}`;
}

function asBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function toBigInt(value: `0x${string}` | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function toNumber(value: `0x${string}` | bigint): number {
  return Number(toBigInt(value));
}
