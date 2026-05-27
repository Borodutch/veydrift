import { describe, expect, test } from "bun:test";

import type { BackendConfig } from "./config";
import {
  decodeMoonChanceReportLog,
  HttpJsonRpcTransport,
  isMoonChanceReportLog,
  VeydriftGameReader,
  type Address,
  type RpcLog
} from "./evm";

const requestedTopic = "0x8969f3a52192b4b918b49219d60ea0b68d3f5fd8b70c4691b297a538ac333121";
const finalizedTopic = "0xd485b8634099625ba076107f73a9ea0e95b3f6ac18d76e501b618572e6705d04";
const skippedTopic = "0x93793f9a66f3a0a4cea93b7eb92e142d7283b5b33f657e14277879f2f8e7ab4e";
const moonDestructionRequestedTopic = "0x719ab77026e22a766a85f5c32e5294b20e76b8a0490812761ab98ab3a1739884";
const moonDestructionFinalizedTopic = "0xdac71b69e1912e36573457fd7e6227e8b5ac86e9e011bd7eddc6c104221ed803";
const fleetMissionLaunchedTopic = "0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456";
const fleetMissionCargoTopic = "0x3daa6311ecdadad6781f70e5d285e7150f9dc165db88d23be8867be4de33ff29";
const fleetMissionShipsTopic = "0xf581cbe97357884794500d80286cfbe823fed3b5d77446e477aa694ce89fc82d";

describe("HTTP JSON-RPC transport", () => {
  test("coalesces concurrent identical cacheable RPC reads", async () => {
    const previousFetch = globalThis.fetch;
    let fetchCalls = 0;
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });

    globalThis.fetch = (async () => {
      fetchCalls += 1;
      await fetchGate;
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: "0x1234"
      });
    }) as unknown as typeof fetch;

    try {
      const transport = new HttpJsonRpcTransport("https://rpc.example", { cacheTtlMs: 1_000 });
      const params = [{ to: "0x0000000000000000000000000000000000000001", data: "0x181c1bc4" }, "latest"];
      const first = transport.request<string>("eth_call", params);
      const second = transport.request<string>("eth_call", params);

      await Promise.resolve();
      releaseFetch();

      await expect(Promise.all([first, second])).resolves.toEqual(["0x1234", "0x1234"]);
      expect(fetchCalls).toBe(1);
      expect(transport.snapshot()).toEqual({
        batchRequests: 0,
        callsByMethod: {
          eth_call: 2
        },
        httpRequests: 1
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("deduplicates identical cacheable RPC reads within a batch", async () => {
    const previousFetch = globalThis.fetch;
    let batchSize = 0;

    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const body = JSON.parse(String(init?.body)) as Array<{ id: number }>;
      batchSize = body.length;
      return Response.json(body.map((request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: "0xabcd"
      })));
    }) as unknown as typeof fetch;

    try {
      const transport = new HttpJsonRpcTransport("https://rpc.example", { cacheTtlMs: 1_000 });
      const request = {
        method: "eth_call",
        params: [{ to: "0x0000000000000000000000000000000000000001", data: "0x181c1bc4" }, "latest"]
      };

      await expect(transport.requestBatch<string>([request, request])).resolves.toEqual(["0xabcd", "0xabcd"]);
      expect(batchSize).toBe(1);
      expect(transport.snapshot()).toEqual({
        batchRequests: 1,
        callsByMethod: {
          eth_call: 2
        },
        httpRequests: 1
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

describe("current planet enumeration", () => {
  test("reads current planet owners without scanning historical logs", async () => {
    const batchSelectors: string[] = [];
    const reader = new VeydriftGameReader(
      readerConfig,
      {
        async request<T>(method: string, params: unknown[]): Promise<T> {
          expect(method).toBe("eth_call");
          const [call] = params as [{ data: string }];
          expect(call.data.slice(0, 10)).toBe("0xc16bedad");
          return dataWords([word(3n)]) as T;
        },
        async requestBatch<T>(requests: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
          return requests.map((request) => {
            const [call] = request.params as [{ data: string }];
            const selector = call.data.slice(0, 10);
            batchSelectors.push(selector);
            expect(selector).toBe("0x181c1bc4");

            if (batchSelectors.length === 1) {
              return dataWords([
                addressWord("0x0000000000000000000000000000000000000def"),
                word(2n),
                word(44n),
                word(9n),
                word(211n),
                word(1n),
                word(9_788n),
                word(10_233n),
                word(10_584n),
                word(1_700_000_000n),
                word(5_000n),
                word(4_900n),
                word(4_800n)
              ]);
            }

            return dataWords([
              addressWord("0x0000000000000000000000000000000000000000"),
              word(0n),
              word(0n),
              word(0n),
              word(0n),
              word(0n),
              word(0n),
              word(0n),
              word(0n),
              word(0n),
              word(0n),
              word(0n),
              word(0n)
            ]);
          }) as T[];
        }
      }
    );

    await expect(reader.listCurrentPlanets()).resolves.toEqual([
      expect.objectContaining({
        eventName: "PlanetStarted",
        owner: "0x0000000000000000000000000000000000000def",
        planetId: "1",
        galaxy: 2,
        system: 44,
        position: 9
      })
    ]);
    expect(batchSelectors).toHaveLength(2);
  });
});

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

  test("decodes moon destruction report logs", () => {
    const requested = decodeMoonChanceReportLog(makeLog({
      topics: [moonDestructionRequestedTopic, topic(5n), topic(88n), topic(13n)],
      data: dataWords([
        addressWord("0x0000000000000000000000000000000000000abc"),
        word(3n),
        word(3_700n),
        word(1_200n),
        word(10n),
        "def".padStart(64, "0")
      ])
    }));
    expect(requested).toMatchObject({
      eventName: "MoonDestructionRequested",
      outcomeId: "5",
      battleId: "88",
      targetPlanetId: "13",
      attacker: "0x0000000000000000000000000000000000000abc",
      deathstars: 3,
      moonDestructionChanceBps: 3700,
      deathstarDestructionChanceBps: 1200,
      randomnessRequestId: "10",
      purposeHash: `0x${"def".padStart(64, "0")}`
    });

    const finalized = decodeMoonChanceReportLog(makeLog({
      topics: [moonDestructionFinalizedTopic, topic(5n), topic(88n), topic(13n)],
      data: dataWords([word(1n), word(0n), word(456n)])
    }));
    expect(finalized).toMatchObject({
      eventName: "MoonDestructionFinalized",
      outcomeId: "5",
      battleId: "88",
      targetPlanetId: "13",
      moonDestroyed: true,
      deathstarsDestroyed: false,
      randomWord: "456"
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
              topics: [[
                requestedTopic,
                finalizedTopic,
                skippedTopic,
                moonDestructionRequestedTopic,
                moonDestructionFinalizedTopic
              ]]
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

  test("chunks log queries when the RPC enforces a small block range", async () => {
    const calls: Array<{ method: string; params: unknown[] }> = [];
    const reader = new VeydriftGameReader(
      readerConfig,
      {
        async request<T>(method: string, params: unknown[]): Promise<T> {
          calls.push({ method, params });
          if (calls.length === 1) {
            throw new Error("RPC -32602: query exceeds max block range 2000");
          }
          if (method === "eth_blockNumber") {
            return "0x70" as T;
          }
          return [] as T;
        }
      }
    );

    await expect(reader.listSettledPlanetEvents(100n, "latest")).resolves.toEqual([]);

    expect(calls.map((call) => call.method)).toEqual([
      "eth_getLogs",
      "eth_blockNumber",
      "eth_getLogs",
      "eth_getLogs"
    ]);
    expect(calls[2]?.params).toEqual([
      {
        address: readerConfig.gameContractAddress,
        fromBlock: "0x64",
        toBlock: "0x6d",
        topics: expect.any(Array)
      }
    ]);
    expect(calls[3]?.params).toEqual([
      {
        address: readerConfig.gameContractAddress,
        fromBlock: "0x6e",
        toBlock: "0x70",
        topics: expect.any(Array)
      }
    ]);
  });

  test("splits log chunks again when an RPC rejects a chunk", async () => {
    const calls: Array<{ method: string; params: unknown[] }> = [];
    const failedRanges = new Set(["0x64:0x6d"]);
    const reader = new VeydriftGameReader(
      readerConfig,
      {
        async request<T>(method: string, params: unknown[]): Promise<T> {
          calls.push({ method, params });
          if (calls.length === 1) {
            throw new Error("RPC HTTP 400");
          }
          if (method === "eth_blockNumber") {
            return "0x6d" as T;
          }
          if (method === "eth_getLogs") {
            const [filter] = params as [{ fromBlock: string; toBlock: string }];
            const range = `${filter.fromBlock}:${filter.toBlock}`;
            if (failedRanges.delete(range)) {
              throw new Error("RPC HTTP 400");
            }
            return [] as T;
          }

          throw new Error(`Unexpected ${method}`);
        }
      }
    );

    await expect(reader.listSettledPlanetEvents(100n, "latest")).resolves.toEqual([]);

    const logRanges = calls
      .filter((call) => call.method === "eth_getLogs")
      .slice(1)
      .map((call) => {
        const [filter] = call.params as [{ fromBlock: string; toBlock: string }];
        return `${filter.fromBlock}:${filter.toBlock}`;
      });
    expect(logRanges).toContain("0x64:0x6d");
    expect(logRanges).toContain("0x64:0x68");
    expect(logRanges).toContain("0x69:0x6d");
  });

  test("shrinks log chunks when the fallback range is still too wide", async () => {
    const calls: Array<{ method: string; params: unknown[] }> = [];
    const reader = new VeydriftGameReader(
      readerConfig,
      {
        async request<T>(method: string, params: unknown[]): Promise<T> {
          calls.push({ method, params });
          if (method === "eth_blockNumber") {
            return "0x70" as T;
          }

          const [filter] = params as [{ fromBlock: string; toBlock: string }];
          if (filter.toBlock === "latest") {
            throw new Error("RPC HTTP 400");
          }

          const fromBlock = BigInt(filter.fromBlock);
          const toBlock = BigInt(filter.toBlock);
          if (toBlock - fromBlock > 4n) {
            throw new Error("RPC HTTP 400");
          }

          return [] as T;
        }
      }
    );

    await expect(reader.listSettledPlanetEvents(100n, "latest")).resolves.toEqual([]);

    const logRanges = calls
      .filter((call) => call.method === "eth_getLogs")
      .slice(1)
      .map((call) => {
        const [filter] = call.params as [{ fromBlock: string; toBlock: string }];
        return `${filter.fromBlock}:${filter.toBlock}`;
      });
    expect(logRanges).toEqual(["0x64:0x6d", "0x64:0x68", "0x69:0x6d", "0x6e:0x70"]);
  });

  test("decodes alliance profiles returned as dynamic ABI tuples", async () => {
    const allianceContractAddress = "0x2222222222222222222222222222222222222222";
    const wallet = "0xbf74483DB914192bb0a9577f3d8Fb29a6d4c08eE" as Address;
    const reader = new VeydriftGameReader(
      {
        ...readerConfig,
        allianceContractAddress
      },
      {
        async request<T>(method: string, params: unknown[]): Promise<T> {
          expect(method).toBe("eth_call");
          const [call] = params as [{ data: string; to: string }];
          expect(call.to).toBe(allianceContractAddress);
          const selector = call.data.slice(0, 10);

          if (selector === "0xad642b52") {
            return dataWords([word(1n), word(3n), word(1_779_816_676n)]) as T;
          }
          if (selector === "0xf0bab901") {
            return uintArrayResult([1n]) as T;
          }
          if (selector === "0x79c76adf") {
            return allianceProfileResult({
              active: true,
              tag: "VDFT",
              name: "Veydrift Union",
              description: "Union!",
              owner: wallet,
              createdAt: 1_779_816_676n,
              memberCount: 1n
            }) as T;
          }
          if (selector === "0xf4d46b3b" || selector === "0xdb132ffb") {
            return dataWords([word(0n), word(0n), word(0n), word(0n)]) as T;
          }
          if (selector === "0x2a1ef311") {
            return addressArrayResult([wallet]) as T;
          }
          if (selector === "0x2953e5ce") {
            return addressArrayResult([]) as T;
          }

          throw new Error(`Unexpected selector ${selector}`);
        }
      }
    );

    await expect(reader.getAllianceState(wallet)).resolves.toMatchObject({
      wallet,
      allianceAvailable: true,
      membership: {
        allianceId: "1",
        role: "owner",
        joinedAt: "1779816676"
      },
      profile: {
        active: true,
        tag: "VDFT",
        name: "Veydrift Union",
        description: "Union!",
        owner: wallet,
        createdAt: "1779816676",
        memberCount: 1
      },
      directory: [
        {
          allianceId: "1",
          active: true,
          tag: "VDFT",
          name: "Veydrift Union",
          description: "Union!"
        }
      ],
      members: [
        {
          address: wallet,
          role: "owner",
          joinedAt: "1779816676"
        }
      ]
    });
  });

  test("does not expand rate-limited batch calls into sequential RPC bursts", async () => {
    const wallet = "0x0000000000000000000000000000000000000def" as Address;
    const individualSelectors: string[] = [];
    let batchCalls = 0;
    const abiWords = (...values: bigint[]) => dataWords(values.map(word));
    const reader = new VeydriftGameReader(
      readerConfig,
      {
        async request<T>(method: string, params: unknown[]): Promise<T> {
          expect(method).toBe("eth_call");
          const [call] = params as [{ data: string }];
          const selector = call.data.slice(0, 10);
          individualSelectors.push(selector);

          if (selector === "0x0ff79fa5") return abiWords(7n) as T;
          if (selector === "0x181c1bc4") {
            return dataWords([
              addressWord(wallet),
              word(2n),
              word(44n),
              word(9n),
              word(211n),
              word(1n),
              word(10_000n),
              word(10_000n),
              word(10_000n),
              word(1_700_000_000n),
              word(5_000n),
              word(4_900n),
              word(4_800n)
            ]) as T;
          }
          if (selector === "0x0adbf924") return abiWords(5_000n, 4_900n, 4_800n) as T;
          if (selector === "0xd9b24865") return abiWords(1n) as T;
          if (selector === "0xb6f4b7b7") return abiWords(0n, 0n, 0n, 0n, 0n, 0n, 0n) as T;
          if (selector === "0x423f9f10") return abiWords(0n) as T;

          throw new Error(`Unexpected individual call ${selector}`);
        },
        async requestBatch<T>(): Promise<T[]> {
          batchCalls += 1;
          throw new Error("RPC HTTP 429");
        }
      }
    );

    await expect(reader.getShipyardState(wallet)).rejects.toThrow("RPC HTTP 429");

    expect(batchCalls).toBeGreaterThan(0);
    expect(individualSelectors).not.toContain("0x57686701");
    expect(individualSelectors).not.toContain("0xc4222030");
    expect(individualSelectors).not.toContain("0xe512884c");
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
  indexDbPath: ":memory:",
  indexFromBlock: 100n,
  missionResolutionEnabled: false,
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

function uintArrayResult(values: bigint[]): string {
  return dataWords([word(32n), word(BigInt(values.length)), ...values.map(word)]);
}

function addressArrayResult(values: Address[]): string {
  return dataWords([word(32n), word(BigInt(values.length)), ...values.map(addressWord)]);
}

function allianceProfileResult({
  active,
  tag,
  name,
  description,
  owner,
  createdAt,
  memberCount
}: {
  active: boolean;
  tag: string;
  name: string;
  description: string;
  owner: Address;
  createdAt: bigint;
  memberCount: bigint;
}): string {
  const tagTail = stringTail(tag);
  const nameTail = stringTail(name);
  const descriptionTail = stringTail(description);
  const tagOffset = 7n * 32n;
  const nameOffset = tagOffset + BigInt(tagTail.length / 2);
  const descriptionOffset = nameOffset + BigInt(nameTail.length / 2);

  return dataWords([
    word(32n),
    word(active ? 1n : 0n),
    word(tagOffset),
    word(nameOffset),
    word(descriptionOffset),
    addressWord(owner),
    word(createdAt),
    word(memberCount),
    tagTail,
    nameTail,
    descriptionTail
  ]);
}

function stringTail(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const data = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${word(BigInt(bytes.length))}${data.padEnd(Math.ceil(data.length / 64) * 64, "0")}`;
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
