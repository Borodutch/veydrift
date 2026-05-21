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
  });
});
