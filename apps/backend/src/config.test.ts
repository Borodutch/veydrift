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
});
