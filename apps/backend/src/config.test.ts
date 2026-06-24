import { describe, expect, test } from "bun:test";
import { loadBackendConfig, resolveWsRpcUrl, safeConfigSummary } from "./config";

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

  test("parses static RPC fallbacks and exposes them in the safe summary", () => {
    const result = loadBackendConfig({
      VEYDRIFT_GAME_CONTRACT_ADDRESS: "0x3333333333333333333333333333333333333333",
      VEYDRIFT_RPC_URL: "https://primary.example/rpc",
      VEYDRIFT_RPC_FALLBACK_URLS: "https://primary.example/rpc, https://fallback.example/rpc"
    });

    expect(result.problems).toEqual([]);
    expect(result.config.rpcUrl).toBe("https://primary.example/rpc");
    expect(result.config.rpcFallbackUrls).toEqual(["https://fallback.example/rpc"]);
    expect(safeConfigSummary(result.config)).toMatchObject({
      rpcFallbackConfigured: true,
      rpcFallbackCount: 1
    });
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

  test("accepts a static settlement start price for RPC-free funding reads", () => {
    const result = loadBackendConfig({
      VEYDRIFT_GAME_CONTRACT_ADDRESS: "0x3333333333333333333333333333333333333333",
      VEYDRIFT_RPC_URL: "https://example.invalid/rpc",
      VEYDRIFT_SETTLEMENT_START_PRICE_WEI: "50000000000000000"
    });

    expect(result.problems).toEqual([]);
    expect(result.config.settlementStartPriceWei).toBe("50000000000000000");
    expect(result.config).toMatchObject({
      settlementStartPriceWei: "50000000000000000"
    });
  });

  test("accepts the standalone oracle randomness fulfiller key alias", () => {
    const privateKey = `0x${"12".repeat(32)}` as const;
    const result = loadBackendConfig({
      VEYDRIFT_GAME_CONTRACT_ADDRESS: "0x3333333333333333333333333333333333333333",
      VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS: "0x51a5faba3fa903edcecdebceea3865bd63d359bb",
      VEYDRIFT_RANDOMNESS_FULFILLER_PRIVATE_KEY: privateKey,
      VEYDRIFT_RPC_URL: "https://example.invalid/rpc"
    });

    expect(result.problems).toEqual([]);
    expect(result.config.randomnessFulfillerPrivateKey).toBe(privateKey);
    expect(safeConfigSummary(result.config).randomnessCommitterConfigured).toBe(true);
  });

  test("defaults backend polling cadences and accepts env overrides", () => {
    const defaults = loadBackendConfig({
      VEYDRIFT_GAME_CONTRACT_ADDRESS: "0x3333333333333333333333333333333333333333",
      VEYDRIFT_RPC_URL: "https://example.invalid/rpc"
    });
    expect(defaults.problems).toEqual([]);
    // Fast live-event latency while staying cheap on the single self-hosted node.
    expect(defaults.config.pollIntervalMs).toBe(1_000);
    // Fleet mission canonical sync is a bounded safety net for missed terminal mission events, not
    // the hot event path.
    expect(defaults.config.fleetMissionSyncIntervalMs).toBe(60_000);

    const overridden = loadBackendConfig({
      VEYDRIFT_GAME_CONTRACT_ADDRESS: "0x3333333333333333333333333333333333333333",
      VEYDRIFT_RPC_URL: "https://example.invalid/rpc",
      VEYDRIFT_POLL_INTERVAL_MS: "2000",
      VEYDRIFT_FLEET_MISSION_SYNC_INTERVAL_MS: "30000"
    });
    expect(overridden.problems).toEqual([]);
    expect(overridden.config.pollIntervalMs).toBe(2_000);
    expect(overridden.config.fleetMissionSyncIntervalMs).toBe(30_000);

    const disabledFleetSync = loadBackendConfig({
      VEYDRIFT_GAME_CONTRACT_ADDRESS: "0x3333333333333333333333333333333333333333",
      VEYDRIFT_RPC_URL: "https://example.invalid/rpc",
      VEYDRIFT_FLEET_MISSION_SYNC_INTERVAL_MS: "0"
    });
    expect(disabledFleetSync.problems).toEqual([]);
    expect(disabledFleetSync.config.fleetMissionSyncIntervalMs).toBe(0);

    const invalid = loadBackendConfig({
      VEYDRIFT_GAME_CONTRACT_ADDRESS: "0x3333333333333333333333333333333333333333",
      VEYDRIFT_RPC_URL: "https://example.invalid/rpc",
      VEYDRIFT_POLL_INTERVAL_MS: "-5",
      VEYDRIFT_FLEET_MISSION_SYNC_INTERVAL_MS: "-5"
    });
    expect(invalid.problems.some((problem) => problem.field === "VEYDRIFT_POLL_INTERVAL_MS")).toBe(true);
    expect(invalid.problems.some((problem) => problem.field === "VEYDRIFT_FLEET_MISSION_SYNC_INTERVAL_MS")).toBe(true);
    // Falls back to the default rather than a bad value.
    expect(invalid.config.pollIntervalMs).toBe(1_000);
    expect(invalid.config.fleetMissionSyncIntervalMs).toBe(60_000);
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
