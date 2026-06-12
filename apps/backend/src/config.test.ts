import { describe, expect, test } from "bun:test";
import { loadBackendConfig, resolveWsRpcUrl } from "./config";

describe("backend config", () => {
  test("derives Base Sepolia Alchemy websocket URL from the API key", () => {
    expect(resolveWsRpcUrl({ ALCHEMY_BASE_SEPOLIA_API_KEY: "secret-key" })).toEqual({
      wsRpcSource: "alchemy-key",
      wsRpcUrl: "wss://base-sepolia.g.alchemy.com/v2/secret-key"
    });
  });

  test("prefers explicit websocket RPC URLs over derived Alchemy URLs", () => {
    expect(resolveWsRpcUrl({
      ALCHEMY_BASE_SEPOLIA_API_KEY: "secret-key",
      ALCHEMY_BASE_SEPOLIA_WS_URL: "wss://alchemy.example/ws",
      VEYDRIFT_WS_RPC_URL: "wss://custom.example/ws"
    })).toEqual({
      wsRpcSource: "custom-url",
      wsRpcUrl: "wss://custom.example/ws"
    });
  });

  test("accepts Base Sepolia websocket RPC aliases", () => {
    expect(resolveWsRpcUrl({
      BASE_SEPOLIA_WS_RPC_URL: "wss://base.example/ws"
    })).toEqual({
      wsRpcSource: "custom-url",
      wsRpcUrl: "wss://base.example/ws"
    });
    expect(resolveWsRpcUrl({
      ALCHEMY_BASE_SEPOLIA_WS_RPC_URL: "wss://alchemy-rpc.example/ws"
    })).toEqual({
      wsRpcSource: "alchemy-url",
      wsRpcUrl: "wss://alchemy-rpc.example/ws"
    });
  });

  test("derives Base Sepolia websocket URL from an Alchemy HTTPS RPC URL", () => {
    expect(resolveWsRpcUrl({
      VEYDRIFT_RPC_URL: "https://base-sepolia.g.alchemy.com/v2/secret-key"
    })).toEqual({
      wsRpcSource: "alchemy-url",
      wsRpcUrl: "wss://base-sepolia.g.alchemy.com/v2/secret-key"
    });
  });

  test("keeps HTTP RPC required while websocket RPC remains optional fallback config", () => {
    const result = loadBackendConfig({
      ALCHEMY_BASE_SEPOLIA_API_KEY: "secret-key",
      VEYDRIFT_GAME_CONTRACT_ADDRESS: "0x3333333333333333333333333333333333333333"
    });

    expect(result.problems).toEqual([]);
    expect(result.config).toMatchObject({
      rpcSource: "alchemy-key",
      rpcUrl: "https://base-sepolia.g.alchemy.com/v2/secret-key",
      wsRpcSource: "alchemy-key",
      wsRpcUrl: "wss://base-sepolia.g.alchemy.com/v2/secret-key"
    });
    expect(result.config.indexDbPath).toBe(".data/contract-state.sqlite");
  });

  test("accepts an explicit contract state index database path", () => {
    const result = loadBackendConfig({
      VEYDRIFT_GAME_CONTRACT_ADDRESS: "0x3333333333333333333333333333333333333333",
      VEYDRIFT_INDEX_DB_PATH: "/tmp/veydrift-contract-state.sqlite",
      VEYDRIFT_RPC_URL: "https://example.invalid/rpc"
    });

    expect(result.problems).toEqual([]);
    expect(result.config.indexDbPath).toBe("/tmp/veydrift-contract-state.sqlite");
  });

  test("enables the public mission resolver only for test deployments with a resolver address", () => {
    const result = loadBackendConfig({
      VEYDRIFT_DEPLOYMENT_MODE: "test",
      VEYDRIFT_GAME_CONTRACT_ADDRESS: "0x3333333333333333333333333333333333333333",
      VEYDRIFT_MISSION_RESOLVER_ADDRESS: "0x4444444444444444444444444444444444444444",
      VEYDRIFT_RPC_URL: "https://example.invalid/rpc"
    });

    expect(result.problems).toEqual([]);
    expect(result.config).toMatchObject({
      missionResolutionEnabled: true,
      missionResolverAddress: "0x4444444444444444444444444444444444444444"
    });

    expect(loadBackendConfig({
      VEYDRIFT_DEPLOYMENT_MODE: "production",
      VEYDRIFT_GAME_CONTRACT_ADDRESS: "0x3333333333333333333333333333333333333333",
      VEYDRIFT_MISSION_RESOLVER_ADDRESS: "0x4444444444444444444444444444444444444444",
      VEYDRIFT_RPC_URL: "https://example.invalid/rpc"
    }).config.missionResolutionEnabled).toBe(false);
  });

  // VEY-KANEO-471: the synthetic stationed-defense QA payload must require an explicit opt-in AND a
  // non-production deployment, and must never be reachable in production even if the env is set.
  test("gates the synthetic stationed-defense QA flag on opt-in and non-production", () => {
    const baseEnv = {
      VEYDRIFT_GAME_CONTRACT_ADDRESS: "0x3333333333333333333333333333333333333333",
      VEYDRIFT_RPC_URL: "https://example.invalid/rpc"
    };

    // Unset → off by default.
    expect(loadBackendConfig({ ...baseEnv, VEYDRIFT_DEPLOYMENT_MODE: "test" }).config.qaSyntheticStationedDefenders).toBe(false);

    // Opt-in on a non-production deployment → on.
    for (const mode of ["local", "test", "staging"]) {
      const result = loadBackendConfig({
        ...baseEnv,
        VEYDRIFT_DEPLOYMENT_MODE: mode,
        VEYDRIFT_QA_SYNTHETIC_STATIONED_DEFENDERS: "true"
      });
      expect(result.config.qaSyntheticStationedDefenders).toBe(true);
    }

    // Accepts the common truthy spellings.
    for (const value of ["1", "TRUE", "yes", "on"]) {
      expect(loadBackendConfig({
        ...baseEnv,
        VEYDRIFT_DEPLOYMENT_MODE: "test",
        VEYDRIFT_QA_SYNTHETIC_STATIONED_DEFENDERS: value
      }).config.qaSyntheticStationedDefenders).toBe(true);
    }

    // Hard production guard: even an explicit opt-in stays off in production.
    expect(loadBackendConfig({
      ...baseEnv,
      VEYDRIFT_DEPLOYMENT_MODE: "production",
      VEYDRIFT_QA_SYNTHETIC_STATIONED_DEFENDERS: "true"
    }).config.qaSyntheticStationedDefenders).toBe(false);
  });
});
