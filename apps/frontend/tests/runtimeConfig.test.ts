import { describe, expect, test } from "bun:test";
import {
  burningChickenConfig,
  defaultPlayableApiUrl,
  gameContractAddress,
  productionPlayableApiUrl,
  resolvePlayableApiUrl,
  runtimeConfigUrl,
  testPlayableApiUrl,
  type RuntimeConfig,
} from "../src/runtimeConfig";

describe("runtime config URL", () => {
  test("targets the API runtime-config endpoint", () => {
    expect(runtimeConfigUrl("https://api-test.veydrift.com/")).toBe(
      "https://api-test.veydrift.com/runtime-config",
    );
  });

  test("falls back to the test API when deployment env is missing or blank", () => {
    expect(resolvePlayableApiUrl(undefined)).toBe(defaultPlayableApiUrl);
    expect(resolvePlayableApiUrl("")).toBe(defaultPlayableApiUrl);
    expect(resolvePlayableApiUrl("   ")).toBe(defaultPlayableApiUrl);
  });

  test("defaults veydrift.com to the production API", () => {
    expect(resolvePlayableApiUrl(undefined, { hostname: "veydrift.com" })).toBe(productionPlayableApiUrl);
    expect(resolvePlayableApiUrl(undefined, { hostname: "www.veydrift.com" })).toBe(productionPlayableApiUrl);
  });

  test("keeps non-production hosts on the test API by default", () => {
    expect(resolvePlayableApiUrl(undefined, { hostname: "test.veydrift.com" })).toBe(testPlayableApiUrl);
    expect(resolvePlayableApiUrl(undefined, { hostname: "localhost" })).toBe(testPlayableApiUrl);
  });

  test("normalizes explicit deployment API URLs", () => {
    expect(resolvePlayableApiUrl("https://custom-api.veydrift.test///")).toBe(
      "https://custom-api.veydrift.test",
    );
    expect(resolvePlayableApiUrl("https://api.example.com///", { hostname: "veydrift.com" })).toBe(
      "https://api.example.com",
    );
  });

  test("prefers the game contract for playable transactions", () => {
    const config: RuntimeConfig = {
      apiUrl: "https://api-test.veydrift.com",
      chainId: 84532,
      contractAddress: "0x1111111111111111111111111111111111111111",
      gameContractAddress: "0x2222222222222222222222222222222222222222",
      graphqlUrl: "https://api-test.veydrift.com/graphql",
      network: "Base Sepolia",
      resourceTokenAddresses: {
        crystal: null,
        deuterium: null,
        metal: null,
      },
      rpcProvider: "alchemy",
    };

    expect(gameContractAddress(config)).toBe("0x2222222222222222222222222222222222222222");
  });

  test("falls back to the settlement contract before game contract split deploys", () => {
    const config: RuntimeConfig = {
      apiUrl: "https://api-test.veydrift.com",
      chainId: 84532,
      contractAddress: "0x1111111111111111111111111111111111111111",
      gameContractAddress: null,
      graphqlUrl: "https://api-test.veydrift.com/graphql",
      network: "Base Sepolia",
      resourceTokenAddresses: {
        crystal: null,
        deuterium: null,
        metal: null,
      },
      rpcProvider: "alchemy",
    };

    expect(gameContractAddress(config)).toBe("0x1111111111111111111111111111111111111111");
  });

  test("only accepts the coordinate Burning Chicken burn selector", () => {
    const baseConfig: RuntimeConfig = {
      apiUrl: "https://api-test.veydrift.com",
      burningChicken: {
        burnContractAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        burnSelector: "0x6364233d",
        nftContractAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        rpcUrl: "https://mainnet.base.org",
      },
      chainId: 84532,
      contractAddress: null,
      gameContractAddress: null,
      graphqlUrl: "https://api-test.veydrift.com/graphql",
      network: "Base Sepolia",
      resourceTokenAddresses: {
        crystal: null,
        deuterium: null,
        metal: null,
      },
      rpcProvider: "alchemy",
    };

    expect(burningChickenConfig(baseConfig)?.burnSelector).toBe("0x6364233d");
    expect(
      burningChickenConfig({
        ...baseConfig,
        burningChicken: {
          ...baseConfig.burningChicken!,
          burnSelector: "0xe1775196",
        },
      }),
    ).toBeUndefined();
  });
});
