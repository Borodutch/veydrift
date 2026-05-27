import { describe, expect, test } from "bun:test";
import type { BackendConfig } from "./config";
import { encodeResolveFleetMissionCall, MissionResolutionService } from "./missionResolution";
import type { ResolvableFleetMission } from "./evm";

const config: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  gameContractAddress: "0x3333333333333333333333333333333333333333",
  indexDbPath: ":memory:",
  indexFromBlock: 100n,
  missionResolutionEnabled: true,
  missionResolverAddress: "0x4444444444444444444444444444444444444444",
  resourceTokenAddresses: {},
  rpcSource: "custom-url",
  rpcUrl: "https://example.invalid/rpc",
  wsRpcSource: "missing"
};

describe("MissionResolutionService", () => {
  test("encodes public mission resolution transactions for configured test deployments", async () => {
    const requests: Array<{ method: string; params: unknown[] }> = [];
    const missions: ResolvableFleetMission[] = [
      mission("42", "Attack"),
      mission("43", "Harvest"),
      mission("44", "Colonize")
    ];
    const service = new MissionResolutionService(
      {
        ...config
      },
      {
        async listResolvableFleetMissions() {
          return missions;
        }
      },
      {
        transport: {
          async request<T>(method: string, params: unknown[]): Promise<T> {
            requests.push({ method, params });
            return "0xtransaction" as T;
          }
        }
      }
    );

    await service.resolveDueMissions();
    await service.resolveDueMissions();

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [{
          from: config.missionResolverAddress,
          to: config.gameContractAddress,
          data: encodeResolveFleetMissionCall(42n)
        }]
      },
      {
        method: "eth_sendTransaction",
        params: [{
          from: config.missionResolverAddress,
          to: config.gameContractAddress,
          data: encodeResolveFleetMissionCall(43n)
        }]
      },
      {
        method: "eth_sendTransaction",
        params: [{
          from: config.missionResolverAddress,
          to: config.gameContractAddress,
          data: encodeResolveFleetMissionCall(44n)
        }]
      }
    ]);
    expect(service.snapshot()).toMatchObject({
      enabled: true,
      lastError: null,
      lastSubmittedMissionId: "44",
      submittedCount: 3
    });
  });

  test("stays disabled when mission resolution is not enabled in config", async () => {
    const service = new MissionResolutionService(
      {
        ...config,
        missionResolutionEnabled: false
      },
      {
        async listResolvableFleetMissions() {
          throw new Error("should not be called");
        }
      },
      {
        transport: {
          async request() {
            throw new Error("should not be called");
          }
        }
      }
    );

    await service.resolveDueMissions();

    expect(service.snapshot()).toMatchObject({
      enabled: false,
      submittedCount: 0
    });
  });
});

function mission(
  missionId: string,
  missionType: "Attack" | "Harvest" | "Colonize"
): ResolvableFleetMission {
  return {
    arrivalAt: "1770000000",
    missionId,
    missionType,
    originPlanetId: "1",
    targetPlanetId: "2"
  };
}
