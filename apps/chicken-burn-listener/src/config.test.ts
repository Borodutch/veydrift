import { describe, expect, test } from "bun:test";

import { loadConfig, safeConfigSummary } from "./config";

const validEnv = {
  BASE_MAINNET_HTTP_RPC_URL: "https://base-mainnet.g.alchemy.com/v2/secret",
  BASE_MAINNET_WS_RPC_URL: "wss://base-mainnet.g.alchemy.com/v2/secret",
  CHICKEN_CONTRACT_ADDRESS: "0xf12f31734868F1089d9d6514D7F19a31Ec5e00e2",
  VEYDRIFT_RPC_URL: "https://base-sepolia.example/rpc",
  VEYDRIFT_MOON_SYSTEM_ADDRESS: "0x1111111111111111111111111111111111111111",
  VEYDRIFT_GRANT_PRIVATE_KEY: "0x" + "a".repeat(64)
} as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  test("loads valid env with defaults and redacts secret URLs", () => {
    const { config, problems } = loadConfig(validEnv);
    expect(problems).toEqual([]);
    expect(config?.veydriftChainId).toBe(84532);
    expect(config?.backfillBlocks).toBe(2_000n);
    expect(config?.enableTransferBurnFallback).toBe(false);

    const summary = safeConfigSummary(config!);
    expect(summary.veydriftGrantPrivateKey).toBe("[redacted]");
    expect(String(summary.baseMainnetHttpRpcUrl)).not.toContain("secret");
    expect(String(summary.baseMainnetWsRpcUrl)).not.toContain("secret");
    expect(summary.enableTransferBurnFallback).toBe(false);
  });

  test("reports missing required variables", () => {
    const { config, problems } = loadConfig({} as NodeJS.ProcessEnv);
    expect(config).toBeNull();
    expect(problems.map((problem) => problem.field).sort()).toEqual([
      "BASE_MAINNET_HTTP_RPC_URL",
      "BASE_MAINNET_WS_RPC_URL",
      "CHICKEN_CONTRACT_ADDRESS",
      "VEYDRIFT_GRANT_PRIVATE_KEY",
      "VEYDRIFT_MOON_SYSTEM_ADDRESS",
      "VEYDRIFT_RPC_URL"
    ]);
  });

  test("rejects malformed address and block values", () => {
    const { config, problems } = loadConfig({
      ...validEnv,
      CHICKEN_CONTRACT_ADDRESS: "0x123",
      CHICKEN_BURN_START_BLOCK: "-1"
    });
    expect(config).toBeNull();
    expect(problems.some((problem) => problem.field === "CHICKEN_CONTRACT_ADDRESS")).toBe(true);
    expect(problems.some((problem) => problem.field === "CHICKEN_BURN_START_BLOCK")).toBe(true);
  });

  test("allows explicit Transfer-burn fallback opt-in", () => {
    const { config, problems } = loadConfig({
      ...validEnv,
      ENABLE_TRANSFER_BURN_FALLBACK: "true"
    });
    expect(problems).toEqual([]);
    expect(config?.enableTransferBurnFallback).toBe(true);
  });

  test("rejects malformed Transfer-burn fallback flag", () => {
    const { config, problems } = loadConfig({
      ...validEnv,
      ENABLE_TRANSFER_BURN_FALLBACK: "maybe"
    });
    expect(config).toBeNull();
    expect(problems.some((problem) => problem.field === "ENABLE_TRANSFER_BURN_FALLBACK")).toBe(
      true
    );
  });
});
