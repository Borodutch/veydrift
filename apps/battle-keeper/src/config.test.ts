import { describe, expect, test } from "bun:test";

import { loadKeeperConfig, safeConfigSummary } from "./config";

const validEnv = {
  RPC_URL: "http://localhost:8545",
  WS_RPC_URL: "ws://localhost:8546",
  GAME_CONTRACT_ADDRESS: "0xf12f31734868F1089d9d6514D7F19a31Ec5e00e2",
  KEEPER_PRIVATE_KEY: "0x" + "a".repeat(64)
} as NodeJS.ProcessEnv;

describe("loadKeeperConfig", () => {
  test("loads a valid config with defaults", () => {
    const { config, problems } = loadKeeperConfig(validEnv);
    expect(problems).toEqual([]);
    expect(config).not.toBeNull();
    expect(config?.rpcFallbackUrls).toEqual([]);
    expect(config?.chainId).toBe(84532);
    expect(config?.sweepIntervalMs).toBe(10_000);
    expect(config?.resolveIntervalMs).toBe(2_000);
    expect(config?.port).toBe(8080);
    expect(config?.maxConcurrency).toBe(1);
  });

  test("reports missing required vars", () => {
    const { config, problems } = loadKeeperConfig({} as NodeJS.ProcessEnv);
    expect(config).toBeNull();
    const fields = problems.map((p) => p.field).sort();
    expect(fields).toEqual([
      "GAME_CONTRACT_ADDRESS",
      "KEEPER_PRIVATE_KEY",
      "RPC_URL",
      "WS_RPC_URL"
    ]);
  });

  test("rejects a malformed contract address", () => {
    const { config, problems } = loadKeeperConfig({ ...validEnv, GAME_CONTRACT_ADDRESS: "0x123" });
    expect(config).toBeNull();
    expect(problems.some((p) => p.field === "GAME_CONTRACT_ADDRESS")).toBe(true);
  });

  test("rejects a malformed private key", () => {
    const { config, problems } = loadKeeperConfig({ ...validEnv, KEEPER_PRIVATE_KEY: "0xabc" });
    expect(config).toBeNull();
    expect(problems.some((p) => p.field === "KEEPER_PRIVATE_KEY")).toBe(true);
  });

  test("rejects a non-positive interval", () => {
    const { config, problems } = loadKeeperConfig({ ...validEnv, SWEEP_INTERVAL_MS: "-5" });
    expect(config).toBeNull();
    expect(problems.some((p) => p.field === "SWEEP_INTERVAL_MS")).toBe(true);
  });

  test("honors overrides", () => {
    const { config } = loadKeeperConfig({
      ...validEnv,
      CHAIN_ID: "8453",
      PORT: "9000",
      SWEEP_INTERVAL_MS: "30000",
      MAX_CONCURRENCY: "5"
    });
    expect(config?.chainId).toBe(8453);
    expect(config?.port).toBe(9000);
    expect(config?.sweepIntervalMs).toBe(30_000);
    expect(config?.maxConcurrency).toBe(1);
  });

  test("loads static HTTP RPC fallback URLs", () => {
    const { config, problems } = loadKeeperConfig({
      ...validEnv,
      RPC_FALLBACK_URLS: "http://localhost:8545, https://fallback.example/rpc"
    });
    expect(problems).toEqual([]);
    expect(config?.rpcFallbackUrls).toEqual(["https://fallback.example/rpc"]);
    expect(safeConfigSummary(config!)).toMatchObject({
      rpcFallbackConfigured: true,
      rpcFallbackCount: 1
    });
  });

  test("safeConfigSummary redacts the private key", () => {
    const { config } = loadKeeperConfig(validEnv);
    const summary = safeConfigSummary(config!);
    expect(summary.keeperPrivateKey).toBe("[redacted]");
    expect(summary.rpcUrl).toBe("http://localhost:8545");
  });
});
