import { describe, expect, test } from "bun:test";
import { gameContractAddress, runtimeConfigUrl, type RuntimeConfig } from "../src/runtimeConfig";

describe("runtime config URL", () => {
  test("targets the API runtime-config endpoint", () => {
    expect(runtimeConfigUrl("https://api-test.veydrift.com/")).toBe(
      "https://api-test.veydrift.com/runtime-config",
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
});
