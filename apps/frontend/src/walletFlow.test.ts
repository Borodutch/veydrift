import { describe, expect, test } from "bun:test";
import {
  BASE_SEPOLIA,
  decodeBoolResult,
  decodeUintResult,
  encodeAddressUintCall,
  encodeAddressCall,
  encodeGameCall,
  encodeUintCall,
  ensureBaseSepoliaNetwork,
  fetchInfrastructureState,
  fetchWalletQueues,
  getInjectedProvider,
  isBaseSepoliaChain,
  isUserRejected,
  parseRiftTokenAmount,
  readSettlementState,
  sendCollectResourcesTransaction,
  sendCollectShipsTransaction,
  sendFinishDefenseProductionTransaction,
  sendFinishBuildingUpgradeTransaction,
  sendFinishShipProductionTransaction,
  sendFinishResearchTransaction,
  sendSettlementTransaction,
  sendStartBuildingUpgradeTransaction,
  sendStartDefenseProductionTransaction,
  sendStartResearchTransaction,
  sendStartShipProductionTransaction,
  settlementTransactionData,
  type Eip1193Provider
} from "./walletFlow";

const account = "0x1111111111111111111111111111111111111111";
const contract = "0x2222222222222222222222222222222222222222";

describe("walletFlow", () => {
  test("classifies Base Sepolia chain ids", () => {
    expect(isBaseSepoliaChain("0x14a34")).toBe(true);
    expect(isBaseSepoliaChain(84532)).toBe(true);
    expect(isBaseSepoliaChain("0x1")).toBe(false);
  });

  test("detects rejected wallet requests", () => {
    expect(isUserRejected({ code: 4001 })).toBe(true);
    expect(isUserRejected({ message: "User denied transaction signature" })).toBe(true);
    expect(isUserRejected({ code: -32603 })).toBe(false);
  });

  test("detects injected wallet availability", () => {
    const provider = mockProvider(async () => null);

    expect(getInjectedProvider({ ethereum: provider })).toBe(provider);
    expect(getInjectedProvider({})).toBeUndefined();
  });

  test("encodes address calls and settle transaction data", () => {
    expect(encodeAddressCall("0x1abc50ce", account)).toBe(
      "0x1abc50ce0000000000000000000000001111111111111111111111111111111111111111"
    );
    expect(encodeUintCall("0xd2f16c7d", 7n)).toBe(
      "0xd2f16c7d0000000000000000000000000000000000000000000000000000000000000007"
    );
    expect(encodeAddressUintCall("0x095ea7b3", contract, 1_500_000n)).toBe(
      "0x095ea7b30000000000000000000000002222222222222222222222222222222222222222"
        + "000000000000000000000000000000000000000000000000000000000016e360"
    );
    expect(encodeGameCall("0x13aed9a2", [7n, 0, 3])).toBe(
      "0x13aed9a2"
        + "0000000000000000000000000000000000000000000000000000000000000007"
        + "0000000000000000000000000000000000000000000000000000000000000000"
        + "0000000000000000000000000000000000000000000000000000000000000003"
    );
    expect(settlementTransactionData()).toBe("0x59268393");
  });

  test("parses Rift token input as 6-decimal base units", () => {
    expect(parseRiftTokenAmount("1")).toBe(1_000_000n);
    expect(parseRiftTokenAmount("1.25")).toBe(1_250_000n);
    expect(parseRiftTokenAmount("0.000001")).toBe(1n);
    expect(() => parseRiftTokenAmount("0.0000001")).toThrow("Use at most 6 decimal places.");
    expect(() => parseRiftTokenAmount("abc")).toThrow("Enter a valid token amount.");
  });

  test("decodes bool results", () => {
    expect(decodeBoolResult(`0x${"0".repeat(63)}1`)).toBe(true);
    expect(decodeBoolResult(`0x${"0".repeat(64)}`)).toBe(false);
    expect(decodeBoolResult("0x")).toBe(false);
    expect(decodeUintResult(`0x${"0".repeat(63)}7`)).toBe(7n);
  });

  test("switches to Base Sepolia when the wallet already knows the chain", async () => {
    const calls: string[] = [];
    const provider = mockProvider(async ({ method }) => {
      calls.push(method);
      return null;
    });

    await ensureBaseSepoliaNetwork(provider);

    expect(calls).toEqual(["wallet_switchEthereumChain"]);
  });

  test("adds Base Sepolia when the wallet does not know the chain", async () => {
    const params: unknown[] = [];
    const provider = mockProvider(async ({ method, params: requestParams }) => {
      if (method === "wallet_switchEthereumChain") {
        throw { code: 4902 };
      }

      params.push(requestParams?.[0]);
      return null;
    });

    await ensureBaseSepoliaNetwork(provider);

    expect(params).toEqual([BASE_SEPOLIA]);
  });

  test("reports no settlement when hasFirstPlanet returns false", async () => {
    const provider = mockProvider(async () => `0x${"0".repeat(64)}`);

    await expect(readSettlementState(provider, account, { address: contract })).resolves.toEqual({
      kind: "not-settled"
    });
  });

  test("reports already-settled from VeydriftSettlement reads", async () => {
    const provider = mockProvider(async ({ method, params }) => {
      if (method !== "eth_call") {
        throw new Error(`Unexpected ${method}`);
      }

      const call = params?.[0] as { data: string };

      if (call.data.startsWith("0x1d750846")) {
        return word(1n);
      }

      if (call.data.startsWith("0x29147f24")) {
        return [
          word(1n),
          word(42n),
          word(7n),
          word(0xabc123n),
          word(0xdef456n),
          word(1_800_000_000n),
          word(123_456n)
        ].join("");
      }

      throw new Error(`Unexpected call ${call.data}`);
    });

    const settlement = await readSettlementState(provider, account, { address: contract });

    expect(settlement).toMatchObject({
      kind: "settled",
      planet: {
        coordinates: "1:42:7",
        label: "Planet 1:42:7",
        rarity: "Genesis settlement",
        settledBlock: "123456",
        source: "chain",
        settledAt: "2027-01-15T08:00:00.000Z"
      }
    });
    expect(settlement.kind === "settled" ? settlement.planet.fields : undefined).toBeUndefined();
    expect(settlement.kind === "settled" ? settlement.planet.temperature : undefined).toBeUndefined();
  });

  test("decodes VeydriftGame first planet fields and signed temperature", async () => {
    const provider = mockProvider(async ({ method, params }) => {
      if (method !== "eth_call") {
        throw new Error(`Unexpected ${method}`);
      }

      const call = params?.[0] as { data: string };

      if (call.data.startsWith("0x1d750846")) {
        return word(1n);
      }

      if (call.data.startsWith("0x29147f24")) {
        return [
          word(2n),
          word(88n),
          word(14n),
          word(206n),
          word(BigInt.asUintN(256, -18n)),
          word(1_800_000_000n),
          word(123_456n)
        ].join("");
      }

      throw new Error(`Unexpected call ${call.data}`);
    });

    const settlement = await readSettlementState(provider, account, { address: contract });

    expect(settlement).toMatchObject({
      kind: "settled",
      planet: {
        coordinates: "2:88:14",
        fields: "206",
        temperature: "-18",
      }
    });
  });

  test("reports unconfigured settlement when no address is present", async () => {
    const provider = mockProvider(async () => {
      throw new Error("No chain calls expected");
    });

    await expect(readSettlementState(provider, account, {})).resolves.toEqual({
      kind: "unconfigured"
    });
  });

  test("submits a VeydriftSettlement settleFirstPlanet transaction", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return "0xabc";
    });

    await expect(
      sendSettlementTransaction(provider, account, {
        address: contract
      })
    ).resolves.toBe("0xabc");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: "0x59268393"
          }
        ]
      }
    ]);
  });

  test("submits VeydriftGame building and shipyard transactions", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return `0xtx${requests.length}`;
    });

    await expect(
      sendCollectResourcesTransaction(provider, account, contract, "7")
    ).resolves.toBe("0xtx1");
    await expect(
      sendStartBuildingUpgradeTransaction(provider, account, contract, "7", 0)
    ).resolves.toBe("0xtx2");
    await expect(
      sendFinishBuildingUpgradeTransaction(provider, account, contract, "7")
    ).resolves.toBe("0xtx3");
    await expect(
      sendStartShipProductionTransaction(provider, account, contract, "7", 0, 3)
    ).resolves.toBe("0xtx4");
    await expect(
      sendFinishShipProductionTransaction(provider, account, contract, "7")
    ).resolves.toBe("0xtx5");
    await expect(
      sendCollectShipsTransaction(provider, account, contract, "7")
    ).resolves.toBe("0xtx6");
    await expect(
      sendStartDefenseProductionTransaction(provider, account, contract, "7", 0, 2)
    ).resolves.toBe("0xtx7");
    await expect(
      sendFinishDefenseProductionTransaction(provider, account, contract, "7")
    ).resolves.toBe("0xtx8");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: "0xdb43284d0000000000000000000000000000000000000000000000000000000000000007"
          }
        ]
      },
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: encodeGameCall("0x165715e3", [7, 0])
          }
        ]
      },
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: "0x6ab2f9d40000000000000000000000000000000000000000000000000000000000000007"
          }
        ]
      },
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: encodeGameCall("0x13aed9a2", [7, 0, 3])
          }
        ]
      },
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: "0x7bd931540000000000000000000000000000000000000000000000000000000000000007"
          }
        ]
      },
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: "0xb30a921c0000000000000000000000000000000000000000000000000000000000000007"
          }
        ]
      },
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: encodeGameCall("0xfec06283", [7, 0, 2])
          }
        ]
      },
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: "0xa5a0d5970000000000000000000000000000000000000000000000000000000000000007"
          }
        ]
      }
    ]);
  });

  test("submits VeydriftGame research transactions", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return `0xresearch${requests.length}`;
    });

    await expect(
      sendStartResearchTransaction(provider, account, contract, "7", 12)
    ).resolves.toBe("0xresearch1");
    await expect(
      sendFinishResearchTransaction(provider, account, contract)
    ).resolves.toBe("0xresearch2");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: encodeGameCall("0x7f314b93", [7, 12])
          }
        ]
      },
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: "0xba2fbdc8"
          }
        ]
      }
    ]);
  });

  test("fetches dynamic wallet state without browser cache", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init: unknown }> = [];

    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as typeof fetch;

    try {
      await fetchWalletQueues("https://api.example.test///", account);
      await fetchInfrastructureState("https://api.example.test", account);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toEqual([
      {
        url: `https://api.example.test/wallet/${account}/queues`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/infrastructure`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
        },
      },
    ]);
  });
});

function mockProvider(handler: (args: { method: string; params?: unknown[] }) => Promise<unknown>): Eip1193Provider {
  return {
    request: async <T,>(args: { method: string; params?: unknown[] }) => handler(args) as T
  };
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}
