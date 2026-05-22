import { describe, expect, test } from "bun:test";

import type { BackendConfig } from "./config";
import {
  decodeMoonChanceReportLog,
  isMoonChanceReportLog,
  VeydriftGameReader,
  type Address,
  type RpcLog
} from "./evm";

const requestedTopic = "0x8969f3a52192b4b918b49219d60ea0b68d3f5fd8b70c4691b297a538ac333121";
const finalizedTopic = "0xd485b8634099625ba076107f73a9ea0e95b3f6ac18d76e501b618572e6705d04";
const skippedTopic = "0x93793f9a66f3a0a4cea93b7eb92e142d7283b5b33f657e14277879f2f8e7ab4e";
const fleetMissionLaunchedTopic = "0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456";
const fleetMissionCargoTopic = "0x3daa6311ecdadad6781f70e5d285e7150f9dc165db88d23be8867be4de33ff29";
const fleetMissionShipsTopic = "0xf581cbe97357884794500d80286cfbe823fed3b5d77446e477aa694ce89fc82d";

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

describe("fleet mission visibility", () => {
  test("includes incoming hostile missions against owned colonies", async () => {
    const wallet = "0x0000000000000000000000000000000000000def" as Address;
    const attacker = "0x0000000000000000000000000000000000000abc" as Address;
    const reader = new class extends VeydriftGameReader {
      override async getWalletPlanets(account: Address) {
        return {
          wallet: account,
          homePlanetId: "1",
          planets: [
            { planetId: "1" },
            { planetId: "2" }
          ]
        } as Awaited<ReturnType<VeydriftGameReader["getWalletPlanets"]>>;
      }
    }(
      readerConfig,
      {
        async request<T>(method: string): Promise<T> {
          expect(method).toBe("eth_getLogs");
          return [
            ...fleetMissionLogs({ missionId: 10n, owner: attacker, missionType: 3n, originPlanetId: 99n, targetPlanetId: 1n }),
            ...fleetMissionLogs({ missionId: 11n, owner: attacker, missionType: 3n, originPlanetId: 99n, targetPlanetId: 2n }),
            ...fleetMissionLogs({ missionId: 12n, owner: wallet, missionType: 0n, originPlanetId: 1n, targetPlanetId: 2n })
          ] as T;
        }
      }
    );

    const visibility = await reader.getFleetMissionVisibility(wallet);

    expect(visibility.homePlanetId).toBe("1");
    expect(visibility.incoming.map((mission) => mission.missionId)).toEqual(["10", "11"]);
    expect(visibility.outgoing.map((mission) => mission.missionId)).toEqual(["12"]);
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

function addressTopic(address: string): string {
  return `0x${addressWord(address)}`;
}

function fleetMissionLogs({
  missionId,
  owner,
  missionType,
  originPlanetId,
  targetPlanetId
}: {
  missionId: bigint;
  owner: Address;
  missionType: bigint;
  originPlanetId: bigint;
  targetPlanetId: bigint;
}): RpcLog[] {
  return [
    makeLog({
      topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(owner), topic(missionType)],
      data: dataWords([word(originPlanetId), word(targetPlanetId), word(1_800_000_000n), word(1_800_000_300n)])
    }),
    makeLog({
      topics: [fleetMissionCargoTopic, topic(missionId)],
      data: dataWords([word(0n), word(0n), word(0n), word(1n)])
    }),
    makeLog({
      topics: [fleetMissionShipsTopic, topic(missionId)],
      data: dataWords(Array.from({ length: 14 }, (_, index) => word(index === 0 ? 1n : 0n)))
    })
  ];
}
