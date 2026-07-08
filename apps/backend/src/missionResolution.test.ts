import { describe, expect, test } from "bun:test";
import type { BackendConfig } from "./config";
import {
  MissionResolutionService,
  type MissionResolutionChainClient,
  type MissionResolutionLogger
} from "./missionResolution";

const config: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  gameContractAddress: "0x3333333333333333333333333333333333333333",
  indexDbPath: ":memory:",
  indexFromBlock: 100n,
  missionResolutionEnabled: true,
  missionResolverAddress: "0x4444444444444444444444444444444444444444",
  qaSyntheticStationedDefenders: false,
  randomnessCommitmentStorePath: ".data/test-randomness.json",
  referralStorePath: ".data/test-referrals.json",
  resourceTokenAddresses: {},
  rpcSource: "custom-url",
  rpcUrl: "https://example.invalid/rpc",
  wsRpcSource: "missing"
};

describe("MissionResolutionService", () => {
  test("settles resolvable arrival legs and due return legs in one tick", async () => {
    const calls: string[] = [];
    const service = new MissionResolutionService(config, {
      chainClient: fakeClient({
        calls,
        resolvable: ["4347", "4348"],
        returnable: ["4777"]
      }),
      logger: silentLogger()
    });

    await service.tick();

    expect(calls).toEqual([
      "resolve:4347",
      "resolve:4348",
      "return:4777"
    ]);
    expect(service.snapshot()).toMatchObject({
      enabled: true,
      lastError: null,
      lastResolvedMissionId: "4348",
      lastReturnedMissionId: "4777",
      resolvedCount: 2,
      returnedCount: 1
    });
  });

  test("stays disabled when mission resolution config is off", async () => {
    const calls: string[] = [];
    const service = new MissionResolutionService(
      { ...config, missionResolutionEnabled: false },
      {
        chainClient: fakeClient({ calls, resolvable: ["4347"], returnable: ["4777"] }),
        logger: silentLogger()
      }
    );

    await service.tick();

    expect(calls).toEqual([]);
    expect(service.snapshot().enabled).toBe(false);
  });
});

function fakeClient(input: {
  calls: string[];
  resolvable: string[];
  returnable: string[];
}): MissionResolutionChainClient {
  return {
    async listResolvableFleetMissions() {
      return input.resolvable.map((missionId) => ({
        arrivalAt: "1",
        missionId,
        missionType: "Attack",
        originPlanetId: "85",
        targetPlanetId: "86"
      }));
    },
    async listReturnableFleetMissions() {
      return input.returnable.map((missionId) => ({
        missionId,
        missionType: "Attack",
        originPlanetId: "85",
        returnAt: "2",
        targetPlanetId: "86"
      }));
    },
    async resolveFleetMission(missionId: string) {
      input.calls.push(`resolve:${missionId}`);
      return `0xresolve${missionId}`;
    },
    async completeFleetMissionReturn(missionId: string) {
      input.calls.push(`return:${missionId}`);
      return `0xreturn${missionId}`;
    }
  };
}

function silentLogger(): MissionResolutionLogger {
  return {
    warn() {},
    error() {}
  };
}
