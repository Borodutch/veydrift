import { describe, expect, test } from "bun:test";
import type { BackendConfig } from "./config";
import {
  encodeCompleteFleetMissionReturnCall,
  encodeResolveFleetMissionCall,
  MissionResolutionService
} from "./missionResolution";
import type { ResolvableFleetMission, ReturnableFleetMission } from "./evm";

const config: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  gameContractAddress: "0x3333333333333333333333333333333333333333",
  indexDbPath: ":memory:",
  randomnessCommitmentStorePath: ".data/test-randomness.json",
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

  test("resolves transport and deploy arrivals alongside combat missions", async () => {
    const requests: Array<{ method: string; params: unknown[] }> = [];
    const missions: ResolvableFleetMission[] = [
      mission("50", "Transport"),
      mission("51", "Deploy")
    ];
    const service = new MissionResolutionService(
      { ...config },
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

    expect(requests.map(({ params }) => (params[0] as { data: string }).data)).toEqual([
      encodeResolveFleetMissionCall(50n),
      encodeResolveFleetMissionCall(51n)
    ]);
  });

  test("completes returning missions whose return leg is due without double submitting", async () => {
    const requests: Array<{ method: string; params: unknown[] }> = [];
    const returnable: ReturnableFleetMission[] = [
      returningMission("60", "Attack"),
      returningMission("61", "Transport")
    ];
    const service = new MissionResolutionService(
      { ...config },
      {
        async listResolvableFleetMissions() {
          return [];
        },
        async listReturnableFleetMissions() {
          return returnable;
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
          data: encodeCompleteFleetMissionReturnCall(60n)
        }]
      },
      {
        method: "eth_sendTransaction",
        params: [{
          from: config.missionResolverAddress,
          to: config.gameContractAddress,
          data: encodeCompleteFleetMissionReturnCall(61n)
        }]
      }
    ]);
    expect(service.snapshot()).toMatchObject({
      enabled: true,
      lastError: null,
      lastSubmittedMissionId: "61",
      submittedCount: 2
    });
  });

  test("resolves arrivals before completing the same mission's return leg", async () => {
    const requests: string[] = [];
    const service = new MissionResolutionService(
      { ...config },
      {
        async listResolvableFleetMissions() {
          return [mission("70", "Attack")];
        },
        async listReturnableFleetMissions() {
          return [returningMission("70", "Attack")];
        }
      },
      {
        transport: {
          async request<T>(_method: string, params: unknown[]): Promise<T> {
            requests.push((params[0] as { data: string }).data);
            return "0xtransaction" as T;
          }
        }
      }
    );

    await service.resolveDueMissions();
    await service.resolveDueMissions();

    // The same mission id is resolved on arrival and completed on return exactly once each.
    expect(requests).toEqual([
      encodeResolveFleetMissionCall(70n),
      encodeCompleteFleetMissionReturnCall(70n)
    ]);
    expect(service.snapshot()).toMatchObject({ submittedCount: 2 });
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
  missionType: "Attack" | "Harvest" | "Colonize" | "Transport" | "Deploy"
): ResolvableFleetMission {
  return {
    arrivalAt: "1770000000",
    missionId,
    missionType,
    originPlanetId: "1",
    targetPlanetId: "2"
  };
}

function returningMission(
  missionId: string,
  missionType: "Attack" | "Harvest" | "Colonize" | "Transport" | "Deploy"
): ReturnableFleetMission {
  return {
    missionId,
    missionType,
    originPlanetId: "1",
    returnAt: "1770000000",
    targetPlanetId: "2"
  };
}
