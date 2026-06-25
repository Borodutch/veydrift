import { describe, expect, test } from "bun:test";
import {
  burningChickenConfig,
  defaultPlayableApiUrl,
  gameContractAddress,
  resolvePlayableApiUrl,
  runtimeConfigUrl,
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

  test("normalizes explicit deployment API URLs", () => {
    expect(resolvePlayableApiUrl("https://custom-api.veydrift.test///")).toBe(
      "https://custom-api.veydrift.test",
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

  test("only accepts the planet-id Burning Chicken burn selector", () => {
    const baseConfig: RuntimeConfig = {
      apiUrl: "https://api-test.veydrift.com",
      burningChicken: {
        burnContractAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        burnSelector: "0xe1775196",
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

    expect(burningChickenConfig(baseConfig)?.burnSelector).toBe("0xe1775196");
    expect(
      burningChickenConfig({
        ...baseConfig,
        burningChicken: {
          ...baseConfig.burningChicken!,
          burnSelector: "0x6364233d",
        },
      }),
    ).toBeUndefined();
  });
});
