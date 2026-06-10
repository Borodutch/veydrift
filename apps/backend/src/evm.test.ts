import { describe, expect, test } from "bun:test";

import type { BackendConfig } from "./config";
import {
  decodeBattleReportLogs,
  decodeFleetMissionLogs,
  decodePlanetRenamedLog,
  decodeMoonChanceReportLog,
  HttpJsonRpcTransport,
  isBattleReportLog,
  isPlanetRenamedLog,
  isMoonChanceReportLog,
  VeydriftGameReader,
  type Address,
  type RpcLog
} from "./evm";

const requestedTopic = "0x8969f3a52192b4b918b49219d60ea0b68d3f5fd8b70c4691b297a538ac333121";
const finalizedTopic = "0xd485b8634099625ba076107f73a9ea0e95b3f6ac18d76e501b618572e6705d04";
const skippedTopic = "0x93793f9a66f3a0a4cea93b7eb92e142d7283b5b33f657e14277879f2f8e7ab4e";
const planetRenamedTopic = "0x2b772c1fa271aad466ce009b6b5824b2ad6ccd942d21efc686513ffa8eb166cd";
const moonDestructionRequestedTopic = "0x719ab77026e22a766a85f5c32e5294b20e76b8a0490812761ab98ab3a1739884";
const moonDestructionFinalizedTopic = "0xdac71b69e1912e36573457fd7e6227e8b5ac86e9e011bd7eddc6c104221ed803";
const fleetMissionLaunchedTopic = "0x95e2cb506aa14052bac412e42f47fb34d9234819a960761a7bc7f1920c0ab456";
const fleetMissionCargoTopic = "0x3daa6311ecdadad6781f70e5d285e7150f9dc165db88d23be8867be4de33ff29";
const fleetMissionShipsTopic = "0xf581cbe97357884794500d80286cfbe823fed3b5d77446e477aa694ce89fc82d";
const fleetMissionReturnExposedTopic = "0x27a083519451f4434cd1f93497fb93689a906d3b982a3f127cb236aa24356afa";
const attackBattleResolvedTopic = "0xc0d98d89682d12d3fe90cd0786b9320015ab3950de5f4ae3f54ca0fe9b660d1b";
const combatRoundResolvedTopic = "0xad3481558e72184b0d73a624579c0f1fc7db867024ac190f038373dbde288ca9";
const combatLossesTopic = "0xe31518e93e94d23864fa76375f560d4ef2b4288dca5a5f1204f71d1d363d3704";
const combatDebrisSignaledTopic = "0xd0fbe8b5c73fec6dcfc5fef85459b695d1c9fedb4f94f9748ecaeff785192f14";
const allianceCreatedTopic = "0x4a2634d9b86143d681c41580ee71aad7571fc28bc42c855fcd354bfee4485372";
const allianceProfileUpdatedTopic = "0x6cd70a2e9b3cebb75f35ae8c618b15036c7b0c425e5b688ec918c2f58df7360e";
const allianceInviteCreatedTopic = "0x2ebeddd3f0119f5464f0f6acb95cbc1477a11e19b059f3234bbb0a671cf2b4bd";
const allianceInviteCancelledTopic = "0x37f5074a814d223ffd29f3e588b4c5c9279cbe4437f691ea0fcf9733d6170255";
const allianceJoinRequestedTopic = "0x57dc0d6d966259dfce732817e0ad98a199174482159ce86fec64334a407ed2b5";
const allianceJoinRequestCancelledTopic = "0x5b419221dee71707c4c46c47fa5abb0ae9022d7d37ddaa155aef0aac6cb8b024";
const allianceJoinRequestDismissedTopic = "0xf1fb2103850257aab7ba733ed187ccfcf7483e838bc9d1b725c584a0eaac8cd3";
const allianceJoinRequestApprovedTopic = "0xca0494582fd691cc814cd70d0af7915183b6b0a5b45ede056afe6d4fb9d85a28";
const allianceJoinedTopic = "0x966912f1fd05e1765f8d822e0db01e534676a830ea4b161fc254f4e63f0324eb";
const allianceLeftTopic = "0x65b0be45688803f341e315da7be3de9dd83ebf51eb3cccb3788080695e19ec54";
const allianceRoleUpdatedTopic = "0xe4ba1cf47cfd4ff05de8585bf5cb06e7b0856932c0d81ef64a3458e26877f30d";
const allianceDiplomacyUpdatedTopic = "0x3df4b2aa5708b43ef1805908826beae5c9a30fb60b1952ad99ce3444b2eec6da";

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

            if (selector === "0xec16d865") {
              return stringResult(batchSelectors.length === 2 ? "New Eos" : "");
            }

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
        name: "New Eos",
        galaxy: 2,
        system: 44,
        position: 9
      })
    ]);
    expect(batchSelectors).toEqual(["0x181c1bc4", "0xec16d865", "0x181c1bc4", "0xec16d865"]);
  });
});

describe("planet rename event decoding", () => {
  test("decodes planet rename logs", () => {
    const log = makeLog({
      topics: [
        planetRenamedTopic,
        addressTopic("0x0000000000000000000000000000000000000def"),
        topic(7n)
      ],
      data: stringResult("New Eos")
    });

    expect(isPlanetRenamedLog(log)).toBe(true);
    expect(decodePlanetRenamedLog(log)).toEqual({
      eventName: "PlanetRenamed",
      transactionHash: "0xtx",
      blockNumber: "16",
      owner: "0x0000000000000000000000000000000000000def",
      planetId: "7",
      name: "New Eos"
    });
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

  test("lists alliance logs from the alliance contract", async () => {
    const allianceContractAddress = "0x2222222222222222222222222222222222222222";
    const reader = new VeydriftGameReader(
      {
        ...readerConfig,
        allianceContractAddress
      },
      {
        async request<T>(method: string, params: unknown[]): Promise<T> {
          expect(method).toBe("eth_getLogs");
          expect(params).toEqual([
            {
              address: allianceContractAddress,
              fromBlock: "0x64",
              toBlock: "0xc8",
              topics: [[
                allianceCreatedTopic,
                allianceProfileUpdatedTopic,
                allianceInviteCreatedTopic,
                allianceInviteCancelledTopic,
                allianceJoinRequestedTopic,
                allianceJoinRequestCancelledTopic,
                allianceJoinRequestDismissedTopic,
                allianceJoinRequestApprovedTopic,
                allianceJoinedTopic,
                allianceLeftTopic,
                allianceRoleUpdatedTopic,
                allianceDiplomacyUpdatedTopic
              ]]
            }
          ]);
          return [
            makeLog({
              topics: [allianceCreatedTopic, topic(1n), addressTopic("0x1111111111111111111111111111111111111111")],
              data: dataWords([])
            })
          ] as T;
        }
      }
    );

    await expect(reader.listAllianceLogs(100n, 200n)).resolves.toHaveLength(1);
  });

  test("chunks log queries when the RPC enforces a small block range", async () => {
    const calls: Array<{ method: string; params: unknown[] }> = [];
    const reader = new VeydriftGameReader(
      { ...readerConfig, logChunkSpan: 9n },
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

  test("uses a wide default chunk span so backfills are a handful of requests, not thousands", async () => {
    const logRanges: Array<{ fromBlock: string; toBlock: string }> = [];
    const reader = new VeydriftGameReader(
      readerConfig,
      {
        async request<T>(method: string, params: unknown[]): Promise<T> {
          if (method === "eth_blockNumber") {
            return "0xafc8" as T; // 45000
          }
          const [filter] = params as [{ fromBlock: string; toBlock: string }];
          if (filter.toBlock === "latest") {
            // Provider rejects the unbounded range, forcing the chunk fallback.
            throw new Error("RPC -32602: query exceeds max block range 2000");
          }
          logRanges.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock });
          return [] as T;
        }
      }
    );

    // ~44900 blocks. With the old 10-block span this is ~4490 eth_getLogs calls;
    // with the 2000 default it must be at most a couple dozen.
    await expect(reader.listSettledPlanetEvents(100n, "latest")).resolves.toEqual([]);

    expect(logRanges.length).toBeLessThanOrEqual(24);
    expect(logRanges[0]).toEqual({ fromBlock: "0x64", toBlock: "0x834" }); // 100 .. 2100
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
      { ...readerConfig, logChunkSpan: 9n },
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
    const requester = "0x3333333333333333333333333333333333333333" as Address;
    const eligibleRequester = "0x4444444444444444444444444444444444444444" as Address;
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
            if (call.data.toLowerCase().includes(requester.slice(2).toLowerCase())) {
              return dataWords([word(2n), word(1n), word(1_779_816_700n)]) as T;
            }
            if (call.data.toLowerCase().includes(eligibleRequester.slice(2).toLowerCase())) {
              return dataWords([word(0n), word(0n), word(0n)]) as T;
            }
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
          if (selector === "0xf4d46b3b") {
            return dataWords([word(0n), word(0n), word(0n), word(0n)]) as T;
          }
          if (selector === "0xdb132ffb") {
            if (call.data.toLowerCase().includes(requester.slice(2).toLowerCase())) {
              return dataWords([word(1n), word(1n), addressWord(requester), word(1_779_816_690n)]) as T;
            }
            if (call.data.toLowerCase().includes(eligibleRequester.slice(2).toLowerCase())) {
              return dataWords([word(1n), word(1n), addressWord(eligibleRequester), word(1_779_816_691n)]) as T;
            }
            return dataWords([word(0n), word(0n), word(0n), word(0n)]) as T;
          }
          if (selector === "0x2a1ef311") {
            return addressArrayResult([wallet]) as T;
          }
          if (selector === "0x2953e5ce") {
            return addressArrayResult([requester, eligibleRequester]) as T;
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
      ],
      allianceJoinRequests: [
        {
          allianceId: "1",
          requester: eligibleRequester,
          requestedAt: "1779816691",
          requesterMembership: {
            allianceId: "0",
            role: "none",
            joinedAt: "0"
          }
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

describe("player queue startedAt", () => {
  const shipQueuedTopic = "0x2751e0f30801101b5ffa9787644ace0da334023e4c4376f1133f5608ec9e1118";

  test("populates an active ship queue startedAt from the ShipQueued log block timestamp", async () => {
    const wallet = "0x0000000000000000000000000000000000000def" as Address;
    const abiWords = (...values: bigint[]) => dataWords(values.map(word));
    const itemId = 0n;
    const quantity = 2n;
    const readyAt = 1_700_000_600n;
    const cost = { metal: 4_000n, crystal: 4_000n, deuterium: 0n };
    const startedAt = 1_700_000_000n;

    const shipQueuedLog = makeLog({
      topics: [shipQueuedTopic, topic(7n), topic(itemId)],
      data: abiWords(quantity, readyAt, cost.metal, cost.crystal, cost.deuterium)
    });

    let getLogsTopics: unknown;
    const reader = new VeydriftGameReader(readerConfig, {
      async request<T>(method: string, params: unknown[]): Promise<T> {
        if (method === "eth_call") {
          const selector = (params[0] as { data: string }).data.slice(0, 10);
          // building / defense / research queues inactive; ship queue active
          if (selector === "0xb8e835ab") return abiWords(0n, 0n, 0n, 0n, 0n, 0n, 0n) as T;
          if (selector === "0x5758361d") return abiWords(0n, 0n, 0n, 0n, 0n, 0n, 0n) as T;
          if (selector === "0x4f5ed437") return abiWords(0n, 0n) as T;
          if (selector === "0xb6f4b7b7") {
            return abiWords(1n, itemId, quantity, readyAt, cost.metal, cost.crystal, cost.deuterium) as T;
          }
          if (selector === "0x52b55205") return abiWords(0n, 0n) as T;
          if (selector === "0x2b98afc7") return abiWords(0n, 0n, 0n, 0n, 0n, 0n, 0n) as T;
          throw new Error(`Unexpected eth_call selector ${selector}`);
        }
        if (method === "eth_getLogs") {
          getLogsTopics = (params[0] as { topics?: unknown }).topics;
          return [shipQueuedLog] as T;
        }
        if (method === "eth_getBlockByNumber") {
          return { timestamp: `0x${startedAt.toString(16)}` } as T;
        }
        throw new Error(`Unexpected method ${method}`);
      }
    });
    // Avoid the on-chain settlement lookup; pin the wallet to a known home planet.
    (reader as unknown as {
      getGameSettlement: (wallet: Address) => Promise<unknown>;
    }).getGameSettlement = async () => ({
      wallet,
      hasFirstPlanet: true,
      homePlanetId: "7",
      planet: null,
      contractKind: "game"
    });

    const queues = await reader.getPlayerQueues(wallet);

    expect(queues.ship).toMatchObject({
      active: true,
      kind: "ship",
      itemId: 0,
      quantity: 2,
      readyAt: readyAt.toString(),
      startedAt: startedAt.toString()
    });
    expect((getLogsTopics as string[])?.[0]).toBe(shipQueuedTopic);
  });
});

describe("fleet mission visibility", () => {
  test("reconstructs attacker and defender mission views plus battle reports from logs", async () => {
    const defender = "0x0000000000000000000000000000000000000def" as Address;
    const attacker = "0x0000000000000000000000000000000000000abc" as Address;
    const missionLogs = [
      ...fleetMissionLogs({ missionId: 10n, owner: attacker, missionType: 3n, originPlanetId: 99n, targetPlanetId: 1n }),
      ...fleetMissionLogs({ missionId: 11n, owner: attacker, missionType: 3n, originPlanetId: 99n, targetPlanetId: 2n }),
      ...fleetMissionLogs({ missionId: 12n, owner: defender, missionType: 0n, originPlanetId: 1n, targetPlanetId: 2n }),
      ...fleetMissionLogs({ missionId: 13n, owner: attacker, missionType: 3n, originPlanetId: 99n, targetPlanetId: 1n }),
      makeLog({
        topics: [fleetMissionReturnExposedTopic, topic(13n), addressTopic(attacker), topic(2n)],
        data: dataWords([word(99n), word(1n), word(1_800_000_300n), word(100n), word(25n), word(0n)])
      })
    ];
    const battleLogs = [
      makeLog({
        topics: [attackBattleResolvedTopic, topic(10n), addressTopic(attacker), topic(1n)],
        data: dataWords([word(1n), word(3n), word(12345n), word(100n), word(50n), word(10n)])
      }),
      makeLog({
        topics: [combatLossesTopic, topic(10n)],
        data: dataWords([word(200n), word(50n), word(0n), word(400n), word(100n), word(0n)])
      }),
      makeLog({
        topics: [combatDebrisSignaledTopic, topic(10n), topic(1n)],
        data: dataWords([word(180n), word(45n)])
      })
    ];
    const reader = new class extends VeydriftGameReader {
      override async getWalletPlanets(account: Address) {
        if (account === attacker) {
          return {
            wallet: account,
            homePlanetId: "99",
            planets: [
              { planetId: "99" }
            ]
          } as Awaited<ReturnType<VeydriftGameReader["getWalletPlanets"]>>;
        }

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
        async request<T>(method: string, params: unknown[]): Promise<T> {
          expect(method).toBe("eth_getLogs");
          const [filter] = params as [{ topics?: unknown[] }];
          const topics = filter.topics?.[0] as string[] | undefined;
          return (topics?.includes(attackBattleResolvedTopic) ? battleLogs : missionLogs) as T;
        }
      }
    );

    const defenderVisibility = await reader.getFleetMissionVisibility(defender);
    const attackerVisibility = await reader.getFleetMissionVisibility(attacker);

    expect(defenderVisibility.homePlanetId).toBe("1");
    expect(defenderVisibility.incoming.map((mission) => mission.missionId)).toEqual(["10", "11"]);
    expect(defenderVisibility.outgoing.map((mission) => mission.missionId)).toEqual(["12"]);
    expect(defenderVisibility.returning).toEqual([]);
    expect(defenderVisibility.battleReports.map((report) => report.missionId)).toEqual(["10"]);

    expect(attackerVisibility.homePlanetId).toBe("99");
    expect(attackerVisibility.outgoing.map((mission) => mission.missionId)).toEqual(["10", "11"]);
    expect(attackerVisibility.returning.map((mission) => mission.missionId)).toEqual(["13"]);
    expect(attackerVisibility.incoming).toEqual([]);
    expect(attackerVisibility.battleReports.map((report) => report.missionId)).toEqual(["10"]);
  });

  // VEY-KANEO-415: reproduce/confirm "active Colonize missions not visible in Mission Control".
  // Colonize is launched with the same FleetMissionLaunched/Cargo/Ships events as every other
  // mission (VeydriftColonizationModule._launchColonyMission), with missionType=Colonize (2),
  // status Outbound, owner=launcher, and a target id encoded from the unsettled coordinates with
  // the colonization flag bit (1 << 255) set. The visibility `outgoing` feed — which powers the
  // Mission Control "My missions" tab — keys only on owner + Outbound status and is mission-type
  // agnostic, so the active colonize mission MUST surface. This guards against a regression where
  // a type filter (as exists for incoming/joinable Attack rows) silently drops colonize fleets.
  test("surfaces an active colonize mission in the owner's outgoing visibility feed", async () => {
    const colonizer = "0x0000000000000000000000000000000000000abc" as Address;
    // _encodeColonyTarget(galaxy=2, system=44, position=10): flag | (g << 24) | (s << 8) | p.
    const colonizeTargetId = (1n << 255n) | (2n << 24n) | (44n << 8n) | 10n;
    const missionLogs = fleetMissionLogs({
      missionId: 42n,
      owner: colonizer,
      missionType: 2n, // Colonize
      originPlanetId: 7n,
      targetPlanetId: colonizeTargetId
    });
    const reader = new class extends VeydriftGameReader {
      override async getWalletPlanets(account: Address) {
        return {
          wallet: account,
          homePlanetId: "7",
          planets: [{ planetId: "7" }]
        } as Awaited<ReturnType<VeydriftGameReader["getWalletPlanets"]>>;
      }
    }(
      readerConfig,
      {
        async request<T>(method: string): Promise<T> {
          expect(method).toBe("eth_getLogs");
          return missionLogs as T;
        }
      }
    );

    const visibility = await reader.getFleetMissionVisibility(colonizer);

    const outgoing = visibility.outgoing.find((mission) => mission.missionId === "42");
    expect(outgoing).toBeDefined();
    expect(outgoing?.missionType).toBe("Colonize");
    expect(outgoing?.status).toBe("Outbound");
    expect(outgoing?.targetPlanetId).toBe(colonizeTargetId.toString());
    // The colonize fleet is one colony ship; it is not an attack, so it never appears as incoming
    // or as a joinable alliance attack — only as the owner's own outgoing mission.
    expect(visibility.incoming).toEqual([]);
    expect(visibility.joinableAttacks).toEqual([]);
  });
});

describe("fleet mission resolution scheduling", () => {
  const owner = "0x0000000000000000000000000000000000000abc" as Address;
  const pastSeconds = 1_700_000_000n;
  const futureSeconds = 1_900_000_000n;

  function outboundMissionLogs({
    missionId,
    missionType,
    arrivalAt
  }: {
    missionId: bigint;
    missionType: bigint;
    arrivalAt: bigint;
  }): RpcLog[] {
    return [
      makeLog({
        topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(owner), topic(missionType)],
        data: dataWords([word(99n), word(1n), word(arrivalAt), word(arrivalAt + 300n)])
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

  function returningMissionLog({
    missionId,
    missionType,
    returnAt
  }: {
    missionId: bigint;
    missionType: bigint;
    returnAt: bigint;
  }): RpcLog {
    return makeLog({
      topics: [fleetMissionReturnExposedTopic, topic(missionId), addressTopic(owner), topic(2n)],
      data: dataWords([word(99n), word(1n), word(returnAt), word(100n), word(25n), word(0n)])
    });
  }

  function readerFor(logs: RpcLog[]): VeydriftGameReader {
    return new VeydriftGameReader(readerConfig, {
      async request<T>(method: string): Promise<T> {
        expect(method).toBe("eth_getLogs");
        return logs as T;
      }
    });
  }

  test("includes transport and deploy arrivals while excluding unsupported and not-yet-due missions", async () => {
    const reader = readerFor([
      ...outboundMissionLogs({ missionId: 1n, missionType: 0n, arrivalAt: pastSeconds }), // Transport
      ...outboundMissionLogs({ missionId: 2n, missionType: 1n, arrivalAt: pastSeconds }), // Deploy
      ...outboundMissionLogs({ missionId: 3n, missionType: 3n, arrivalAt: pastSeconds }), // Attack
      ...outboundMissionLogs({ missionId: 4n, missionType: 6n, arrivalAt: pastSeconds }), // Intercept (unsupported)
      ...outboundMissionLogs({ missionId: 5n, missionType: 0n, arrivalAt: futureSeconds }) // Transport, not yet arrived
    ]);

    const resolvable = await reader.listResolvableFleetMissions();

    expect(resolvable.map((mission) => mission.missionId)).toEqual(["1", "2", "3"]);
    expect(resolvable.map((mission) => mission.missionType)).toEqual(["Transport", "Deploy", "Attack"]);
  });

  test("surfaces returning missions whose return leg is due across all mission types", async () => {
    const reader = readerFor([
      ...outboundMissionLogs({ missionId: 10n, missionType: 3n, arrivalAt: pastSeconds }),
      returningMissionLog({ missionId: 10n, missionType: 3n, returnAt: pastSeconds }),
      ...outboundMissionLogs({ missionId: 11n, missionType: 0n, arrivalAt: pastSeconds }),
      returningMissionLog({ missionId: 11n, missionType: 0n, returnAt: pastSeconds }),
      // Returning but not yet due — must not be surfaced.
      ...outboundMissionLogs({ missionId: 12n, missionType: 3n, arrivalAt: pastSeconds }),
      returningMissionLog({ missionId: 12n, missionType: 3n, returnAt: futureSeconds })
    ]);

    const returnable = await reader.listReturnableFleetMissions();

    expect(returnable.map((mission) => mission.missionId)).toEqual(["10", "11"]);
    expect(returnable.every((mission) => Number(mission.returnAt) <= Math.floor(Date.now() / 1_000))).toBe(true);
    // Resolved/Returning missions are not arrival-resolvable any more.
    expect(await reader.listResolvableFleetMissions()).toEqual([]);
  });
});

describe("fleet mission cargo vs loot", () => {
  // VEY-404: a pure attack that loaded no outbound cargo but looted 50 metal must report Cargo 0
  // (outbound launch cargo) and Loot 50 (battle report) — not 50/50. On-chain the contract folds
  // loot into mission.cargo before emitting FleetMissionReturnExposed, so the indexer must keep the
  // authoritative outbound value from FleetMissionCargo and never overwrite it from the return leg.
  test("keeps outbound launch cargo and does not absorb loot from the return-exposed event", () => {
    const owner = "0x0000000000000000000000000000000000000abc" as Address;
    const missionId = 1n;
    const logs: RpcLog[] = [
      makeLog({
        topics: [fleetMissionLaunchedTopic, topic(missionId), addressTopic(owner), topic(3n)],
        data: dataWords([word(99n), word(1n), word(1_700_000_000n), word(1_700_000_600n)])
      }),
      // Outbound launch cargo: nothing loaded.
      makeLog({
        topics: [fleetMissionCargoTopic, topic(missionId)],
        data: dataWords([word(0n), word(0n), word(0n), word(1n)])
      }),
      makeLog({
        topics: [fleetMissionShipsTopic, topic(missionId)],
        data: dataWords(Array.from({ length: 14 }, (_, index) => word(index === 1 ? 1n : 0n)))
      }),
      // Return leg: the contract has already credited the 50 metal loot into cargo, so the event
      // carries 50 metal. The indexer must ignore this for `cargo`.
      makeLog({
        topics: [fleetMissionReturnExposedTopic, topic(missionId), addressTopic(owner), topic(2n)],
        data: dataWords([word(99n), word(1n), word(1_700_000_600n), word(50n), word(0n), word(0n)])
      })
    ];

    const mission = decodeFleetMissionLogs(logs).get("1");
    expect(mission?.status).toBe("Returning");
    // Cargo stays at the outbound launch value (0), not the 50 metal return-leg/loot amount.
    expect(mission?.cargo).toEqual({ metal: "0", crystal: "0", deuterium: "0" });

    // Loot is sourced independently from the battle report.
    const report = decodeBattleReportLogs([
      makeLog({
        topics: [attackBattleResolvedTopic, topic(missionId), addressTopic(owner), topic(1n)],
        data: dataWords([word(1n), word(1n), word(12345n), word(50n), word(0n), word(0n)])
      })
    ]);
    expect(report?.loot).toEqual({ metal: "50", crystal: "0", deuterium: "0" });
  });
});

describe("battle reports", () => {
  test("decodes shareable combat report logs", () => {
    const attacker = "0x0000000000000000000000000000000000000abc" as Address;
    const logs: RpcLog[] = [
      makeLog({
        topics: [attackBattleResolvedTopic, topic(77n), addressTopic(attacker), topic(9n)],
        data: dataWords([word(1n), word(3n), word(12345n), word(100n), word(50n), word(10n)])
      }),
      makeLog({
        topics: [combatRoundResolvedTopic, topic(77n), topic(1n)],
        data: dataWords([word(12n), word(8n), word(20n), word(5n), word(40n), word(10n)])
      }),
      makeLog({
        topics: [combatLossesTopic, topic(77n)],
        data: dataWords([word(200n), word(50n), word(0n), word(400n), word(100n), word(0n)])
      }),
      makeLog({
        topics: [combatDebrisSignaledTopic, topic(77n), topic(9n)],
        data: dataWords([word(180n), word(45n)])
      })
    ];

    expect(logs.every(isBattleReportLog)).toBe(true);
    expect(decodeBattleReportLogs(logs, "77")).toMatchObject({
      missionId: "77",
      attacker,
      targetPlanetId: "9",
      outcome: "AttackerWin",
      rounds: 3,
      randomSeed: "12345",
      loot: {
        metal: "100",
        crystal: "50",
        deuterium: "10"
      },
      attackerLosses: {
        metal: "200",
        crystal: "50",
        deuterium: "0"
      },
      defenderLosses: {
        metal: "400",
        crystal: "100",
        deuterium: "0"
      },
      debris: {
        metal: "180",
        crystal: "45"
      },
      roundReports: [
        {
          round: 1,
          attackerUnits: "12",
          defenderUnits: "8",
          attackerLosses: {
            metal: "20",
            crystal: "5",
            deuterium: "0"
          },
          defenderLosses: {
            metal: "40",
            crystal: "10",
            deuterium: "0"
          }
        }
      ]
    });
  });
});

const readerConfig: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  gameContractAddress: "0x1111111111111111111111111111111111111111",
  indexDbPath: ":memory:",
  randomnessCommitmentStorePath: ".data/test-randomness.json",
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

function stringResult(value: string): string {
  return dataWords([word(32n), stringTail(value)]);
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
