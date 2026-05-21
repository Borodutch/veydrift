import { describe, expect, test } from "bun:test";

import type { BackendConfig } from "./config";
import {
  decodeMoonChanceReportLog,
  isMoonChanceReportLog,
  VeydriftGameReader,
  type RpcLog
} from "./evm";

const requestedTopic = "0x8969f3a52192b4b918b49219d60ea0b68d3f5fd8b70c4691b297a538ac333121";
const finalizedTopic = "0xd485b8634099625ba076107f73a9ea0e95b3f6ac18d76e501b618572e6705d04";
const skippedTopic = "0x93793f9a66f3a0a4cea93b7eb92e142d7283b5b33f657e14277879f2f8e7ab4e";

describe("moon chance report event decoding", () => {
  test("decodes pending moon chance request logs", () => {
    const log = makeLog({
      topics: [requestedTopic, topic(4n), topic(77n), topic(12n)],
      data: dataWords([
        addressWord("0x0000000000000000000000000000000000000def"),
        word(1_500_000n),
        word(500_000n),
        word(2_000n),
        word(9n),
        "abc".padStart(64, "0")
      ])
    });

    expect(isMoonChanceReportLog(log)).toBe(true);
    expect(decodeMoonChanceReportLog(log)).toEqual({
      eventName: "MoonChanceRequested",
      transactionHash: "0xtx",
      blockNumber: "16",
      outcomeId: "4",
      battleId: "77",
      targetPlanetId: "12",
      defender: "0x0000000000000000000000000000000000000def",
      metalDebris: "1500000",
      crystalDebris: "500000",
      chanceBps: 2000,
      randomnessRequestId: "9",
      purposeHash: `0x${"abc".padStart(64, "0")}`
    });
  });

  test("decodes finalized and existing-moon skip report logs", () => {
    const finalized = decodeMoonChanceReportLog(makeLog({
      topics: [finalizedTopic, topic(4n), topic(77n), topic(12n)],
      data: dataWords([word(2_000n), word(1n), word(123n), word(2n), word(7_000n)])
    }));
    expect(finalized).toMatchObject({
      eventName: "MoonChanceFinalized",
      outcomeId: "4",
      battleId: "77",
      targetPlanetId: "12",
      chanceBps: 2000,
      moonCreated: true,
      randomWord: "123",
      moonFields: 2,
      moonDiameterKm: 7000
    });

    const skipped = decodeMoonChanceReportLog(makeLog({
      topics: [skippedTopic, topic(78n), topic(12n)],
      data: dataWords([word(300_000n), word(200_000n)])
    }));
    expect(skipped).toMatchObject({
      eventName: "MoonChanceSkippedExistingMoon",
      battleId: "78",
      targetPlanetId: "12",
      metalDebris: "300000",
      crystalDebris: "200000"
    });
  });

  test("lists moon chance report logs from the moon contract", async () => {
    const moonContractAddress = "0x2222222222222222222222222222222222222222";
    const reader = new VeydriftGameReader(
      {
        ...readerConfig,
        moonContractAddress
      },
      {
        async request<T>(method: string, params: unknown[]): Promise<T> {
          expect(method).toBe("eth_getLogs");
          expect(params).toEqual([
            {
              address: moonContractAddress,
              fromBlock: "0x64",
              toBlock: "0xc8",
              topics: [[requestedTopic, finalizedTopic, skippedTopic]]
            }
          ]);
          return [
            makeLog({
              topics: [finalizedTopic, topic(4n), topic(77n), topic(12n)],
              data: dataWords([word(2_000n), word(1n), word(123n), word(2n), word(7_000n)])
            })
          ] as T;
        }
      }
    );

    await expect(reader.listMoonChanceReportEvents(100n, 200n)).resolves.toEqual([
      expect.objectContaining({
        eventName: "MoonChanceFinalized",
        outcomeId: "4",
        battleId: "77",
        targetPlanetId: "12",
        moonCreated: true
      })
    ]);
  });
});

const readerConfig: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  gameContractAddress: "0x1111111111111111111111111111111111111111",
  indexFromBlock: 100n,
  resourceTokenAddresses: {},
  rpcSource: "custom-url",
  rpcUrl: "https://example.invalid/rpc",
  wsRpcSource: "missing"
};

function makeLog(overrides: Pick<RpcLog, "topics" | "data">): RpcLog {
  return {
    blockNumber: "0x10",
    transactionHash: "0xtx",
    ...overrides
  };
}

function dataWords(words: string[]): string {
  return `0x${words.join("")}`;
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function topic(value: bigint): string {
  return `0x${word(value)}`;
}

function addressWord(address: string): string {
  return address.slice(2).padStart(64, "0");
}
