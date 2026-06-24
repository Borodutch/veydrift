import { describe, expect, test } from "bun:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbiItem,
  type AbiEvent
} from "viem";

import { defaultChickenBurnEventSignature } from "./config";
import {
  burnEventAbiItem,
  burnIdFromLog,
  decodeChickenBurnLog,
  decodeMoonTargetFromBurnInput,
  type RawLog
} from "./events";

const burnEvent = burnEventAbiItem(defaultChickenBurnEventSignature);
const txHash = `0x${"1".repeat(64)}` as const;
const chickenAddress = "0xf12f31734868F1089d9d6514D7F19a31Ec5e00e2" as const;

describe("decodeChickenBurnLog", () => {
  test("decodes configured ChickenBurned event with coordinates", () => {
    const topics = encodeEventTopics({
      abi: [burnEvent],
      eventName: "ChickenBurned",
      args: {
        burner: "0x2222222222222222222222222222222222222222",
        tokenId: 42n
      }
    }) as `0x${string}`[];
    const data = encodeAbiParameters(
      [
        { name: "planetId", type: "uint256" },
        { name: "galaxy", type: "uint16" },
        { name: "system", type: "uint16" },
        { name: "position", type: "uint8" }
      ],
      [7n, 1, 99, 8]
    );
    const log: RawLog = {
      address: chickenAddress,
      blockNumber: "0x64",
      transactionHash: txHash,
      logIndex: "0x2",
      topics,
      data
    };

    const decoded = decodeChickenBurnLog(log, burnEvent);
    expect(decoded).toMatchObject({
      burnId: burnIdFromLog(log),
      burner: "0x2222222222222222222222222222222222222222",
      tokenId: "42",
      planetId: "7",
      galaxy: 1,
      system: 99,
      position: 8,
      sourceBlockNumber: 100n,
      sourceLogIndex: 2
    });
  });

  test("decodes ERC721 Transfer burn when tx input carries moon target", () => {
    const transferEvent = parseAbiItem(
      "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)"
    ) as AbiEvent;
    const topics = encodeEventTopics({
      abi: [transferEvent],
      eventName: "Transfer",
      args: {
        from: "0x3333333333333333333333333333333333333333",
        to: "0x0000000000000000000000000000000000000000",
        tokenId: 101n
      }
    }) as `0x${string}`[];
    const data = encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "burnForMoon",
          stateMutability: "nonpayable",
          inputs: [
            { name: "tokenId", type: "uint256" },
            { name: "planetId", type: "uint256" },
            { name: "galaxy", type: "uint16" },
            { name: "system", type: "uint16" },
            { name: "position", type: "uint8" }
          ],
          outputs: []
        }
      ],
      functionName: "burnForMoon",
      args: [101n, 8n, 2, 44, 12]
    });
    const log: RawLog = {
      address: chickenAddress,
      blockNumber: 100n,
      transactionHash: txHash,
      logIndex: 3n,
      topics,
      data: "0x"
    };

    expect(decodeMoonTargetFromBurnInput(data)).toMatchObject({
      tokenId: 101n,
      planetId: 8n,
      galaxy: 2,
      system: 44,
      position: 12
    });
    expect(decodeChickenBurnLog(log, burnEvent, data)).toMatchObject({
      burner: "0x3333333333333333333333333333333333333333",
      tokenId: "101",
      planetId: "8",
      galaxy: 2,
      system: 44,
      position: 12
    });
  });
});
