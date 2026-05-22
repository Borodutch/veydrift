import { describe, expect, test } from "bun:test";
import {
  BASE_SEPOLIA,
  decodeBoolResult,
  decodeUintResult,
  encodeQuantity,
  encodeAddressUintCall,
  encodeAddressCall,
  encodeGameCall,
  encodeLaunchFleetMissionCall,
  encodeUintCall,
  ensureBaseSepoliaNetwork,
  fetchHighscores,
  fetchInfrastructureState,
  fetchWalletQueues,
  getInjectedProvider,
  isBaseSepoliaChain,
  isUserRejected,
  parseRiftTokenAmount,
  readSettlementFundingState,
  readSettlementState,
  sendCollectResourcesTransaction,
  sendApproveResourceTokenTransaction,
  sendDepositResourceTransaction,
  sendFinishDefenseProductionTransaction,
  sendFinishBuildingUpgradeTransaction,
  sendFinishResourceWithdrawalTransaction,
  sendFinishShipProductionTransaction,
  sendFinishResearchTransaction,
  sendCreateColonyTransaction,
  sendLaunchFleetMissionTransaction,
  sendAllianceInviteTransaction,
  sendCreateAllianceTransaction,
  sendOpenDefenseIntentTransaction,
  sendRequestResourceWithdrawalTransaction,
  sendSettlementTransaction,
  sendStartBuildingUpgradeTransaction,
  sendStartDefenseProductionTransaction,
  sendStartResearchTransaction,
  sendStartShipProductionTransaction,
  settlementTransactionData,
  walletRequestErrorMessage,
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
    expect(encodeQuantity(50_000_000_000_000_000n)).toBe("0xb1a2bc2ec50000");
    expect(settlementTransactionData()).toBe("0x59268393");
  });

  test("encodes public Galaxy mission and colony contract calls without probe payloads", async () => {
    const ships = {
      smallCargo: 1,
      lightFighter: 0,
      recycler: 0,
      colonyShip: 0,
      largeCargo: 0,
      heavyFighter: 0,
      cruiser: 0,
      battleship: 0,
      espionageProbe: 99,
      bomber: 0,
      destroyer: 0,
      deathstar: 0,
      battlecruiser: 0,
      reaper: 0,
      pathfinder: 0,
    };
    const missionData = encodeLaunchFleetMissionCall({
      originPlanetId: 7,
      targetPlanetId: 9,
      missionType: 3,
      ships,
    });
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return `0xgalaxy${requests.length}`;
    });

    await expect(sendLaunchFleetMissionTransaction(provider, account, contract, {
      originPlanetId: 7,
      targetPlanetId: 9,
      missionType: 3,
      ships,
    })).resolves.toBe("0xgalaxy1");
    await expect(sendCreateColonyTransaction(provider, account, contract, "7", 2, 44, 10)).resolves.toBe("0xgalaxy2");

    expect(missionData.startsWith("0x0c9d601c")).toBe(true);
    expect(missionData).toContain("0000000000000000000000000000000000000000000000000000000000000007");
    expect(missionData).toContain("0000000000000000000000000000000000000000000000000000000000000009");
    expect(missionData).not.toContain("0000000000000000000000000000000000000000000000000000000000000063");
    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: missionData,
        }],
      },
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeGameCall("0x71358ab8", [7, 2, 44, 10]),
        }],
      },
    ]);
  });

  test("parses Rift token input as 6-decimal base units", () => {
    expect(parseRiftTokenAmount("1")).toBe(1_000_000n);
    expect(parseRiftTokenAmount("1.25")).toBe(1_250_000n);
    expect(parseRiftTokenAmount("0.000001")).toBe(1n);
    expect(() => parseRiftTokenAmount("0.0000001")).toThrow("Use at most 6 decimal places.");
    expect(() => parseRiftTokenAmount("abc")).toThrow("Enter a valid token amount.");
  });

  test("submits Rift approval, deposit, withdrawal request, and finish calls against the contract ABI", async () => {
    const token = "0x3333333333333333333333333333333333333333";
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return `0xrift${requests.length}`;
    });

    await expect(sendApproveResourceTokenTransaction(provider, account, token, contract, 1_500_000n)).resolves.toBe("0xrift1");
    await expect(sendDepositResourceTransaction(provider, account, contract, "7", 0, 1_500_000n)).resolves.toBe("0xrift2");
    await expect(sendRequestResourceWithdrawalTransaction(provider, account, contract, "7", 1, 2_000_000n)).resolves.toBe("0xrift3");
    await expect(sendFinishResourceWithdrawalTransaction(provider, account, contract, 1)).resolves.toBe("0xrift4");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: token,
          data: encodeAddressUintCall("0x095ea7b3", contract, 1_500_000n),
        }],
      },
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeGameCall("0x25819e15", [7, 0, 1_500_000n]),
        }],
      },
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeGameCall("0x62a10a46", [7, 1, 2_000_000n]),
        }],
      },
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeGameCall("0xde0f208c", [1]),
        }],
      },
    ]);
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

  test("falls back to VeydriftGame homePlanetOf when first-planet compatibility reads revert", async () => {
    const provider = mockProvider(async ({ method, params }) => {
      if (method !== "eth_call") {
        throw new Error(`Unexpected ${method}`);
      }

      const call = params?.[0] as { data: string };

      if (call.data.startsWith("0x1d750846")) {
        throw { code: -32603, message: "Internal JSON-RPC error." };
      }

      if (call.data.startsWith("0x0ff79fa5")) {
        return word(9n);
      }

      if (call.data.startsWith("0x181c1bc4")) {
        return [
          word(BigInt(account)),
          word(3n),
          word(44n),
          word(12n),
          word(219n),
          word(BigInt.asUintN(256, -42n)),
          word(10_500n),
          word(9_900n),
          word(11_100n),
          word(1_800_000_000n),
          word(5_000n),
          word(2_500n),
          word(750n)
        ].join("");
      }

      throw new Error(`Unexpected call ${call.data}`);
    });

    const settlement = await readSettlementState(provider, account, { address: contract });

    expect(settlement).toEqual({
      kind: "settled",
      planet: {
        coordinates: "3:44:12",
        fields: "219",
        label: "Planet 3:44:12",
        rarity: "Genesis settlement",
        resources: {
          crystal: "2500",
          deuterium: "750",
          metal: "5000",
        },
        settledAt: "2027-01-15T08:00:00.000Z",
        source: "chain",
        temperature: "-42",
      }
    });
  });

  test("falls back to not-settled when game homePlanetOf returns zero", async () => {
    const provider = mockProvider(async ({ method, params }) => {
      if (method !== "eth_call") {
        throw new Error(`Unexpected ${method}`);
      }

      const call = params?.[0] as { data: string };

      if (call.data.startsWith("0x1d750846")) {
        throw { code: -32603, message: "Internal JSON-RPC error." };
      }

      if (call.data.startsWith("0x0ff79fa5")) {
        return word(0n);
      }

      throw new Error(`Unexpected call ${call.data}`);
    });

    await expect(readSettlementState(provider, account, { address: contract })).resolves.toEqual({
      kind: "not-settled"
    });
  });

  test("surfaces legacy settlement when game homePlanetOf is empty", async () => {
    const legacy = "0x3333333333333333333333333333333333333333";
    const provider = mockProvider(async ({ method, params }) => {
      if (method !== "eth_call") {
        throw new Error(`Unexpected ${method}`);
      }

      const call = params?.[0] as { data: string; to: string };

      if (call.to === contract && call.data.startsWith("0x1d750846")) {
        throw { code: -32603, message: "Internal JSON-RPC error." };
      }

      if (call.to === contract && call.data.startsWith("0x0ff79fa5")) {
        return word(0n);
      }

      if (call.to === legacy && call.data.startsWith("0x1d750846")) {
        return word(1n);
      }

      if (call.to === legacy && call.data.startsWith("0x29147f24")) {
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

      throw new Error(`Unexpected call ${call.to} ${call.data}`);
    });

    await expect(readSettlementState(provider, account, { address: contract, legacyAddress: legacy })).resolves.toEqual({
      kind: "legacy-settled",
      planet: {
        coordinates: "2:88:14",
        fields: "206",
        label: "Planet 2:88:14",
        rarity: "Genesis settlement",
        settledBlock: "123456",
        settledAt: "2027-01-15T08:00:00.000Z",
        source: "chain",
        temperature: "-18",
      }
    });
  });

  test("formats raw JSON-RPC provider errors into an actionable wallet message", () => {
    expect(walletRequestErrorMessage({ code: -32603, message: "Internal JSON-RPC error." })).toContain(
      "wallet could not read the current game contract state"
    );
    expect(walletRequestErrorMessage(new Error("execution reverted"))).toContain("game contract rejected");
  });

  test("reports unconfigured settlement when no address is present", async () => {
    const provider = mockProvider(async () => {
      throw new Error("No chain calls expected");
    });

    await expect(readSettlementState(provider, account, {})).resolves.toEqual({
      kind: "unconfigured"
    });
  });

  test("submits a value-bearing VeydriftGame startPlanet transaction when startPrice is available", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_call") return word(50_000_000_000_000_000n);
      if (method === "eth_getBalance") return word(60_000_000_000_000_000n);
      return "0xabc";
    });

    await expect(
      sendSettlementTransaction(provider, account, {
        address: contract
      })
    ).resolves.toBe("0xabc");

    expect(requests).toEqual([
      {
        method: "eth_call",
        params: [
          {
            to: contract,
            data: "0xf1a9af89"
          },
          "latest"
        ]
      },
      {
        method: "eth_getBalance",
        params: [
          account,
          "latest"
        ]
      },
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: "0xf45f1f18",
            value: "0xb1a2bc2ec50000"
          }
        ]
      }
    ]);
  });

  test("blocks first planet transactions when the game start price exceeds wallet balance", async () => {
    const provider = mockProvider(async ({ method }) => {
      if (method === "eth_call") return word(50_000_000_000_000_000n);
      if (method === "eth_getBalance") return word(31_000_000_000_000_000n);
      throw new Error(`Unexpected ${method}`);
    });

    await expect(
      sendSettlementTransaction(provider, account, {
        address: contract
      })
    ).rejects.toThrow("costs 0.05 ETH");
  });

  test("reports settlement funding from game startPrice and native balance", async () => {
    const provider = mockProvider(async ({ method }) => {
      if (method === "eth_call") return word(50_000_000_000_000_000n);
      if (method === "eth_getBalance") return word(31_000_000_000_000_000n);
      throw new Error(`Unexpected ${method}`);
    });

    await expect(readSettlementFundingState(provider, account, { address: contract })).resolves.toEqual({
      affordable: false,
      balanceWei: 31_000_000_000_000_000n,
      contractKind: "game",
      startPriceWei: 50_000_000_000_000_000n
    });
  });

  test("blocks game settlement while resource token reserves are not configured", async () => {
    const provider = mockProvider(async ({ method }) => {
      if (method === "eth_call") return word(50_000_000_000_000_000n);
      throw new Error(`Unexpected ${method}`);
    });

    await expect(
      readSettlementFundingState(provider, account, {
        address: contract,
        resourceTokensConfigured: false
      })
    ).resolves.toEqual({
      affordable: false,
      balanceWei: null,
      contractKind: "game",
      startPriceWei: 50_000_000_000_000_000n,
      unavailableReason: "Resource token reserves are not configured for this game deployment yet."
    });

    await expect(
      sendSettlementTransaction(provider, account, {
        address: contract,
        resourceTokensConfigured: false
      })
    ).rejects.toThrow("Resource token reserves are not configured");
  });

  test("falls back to legacy settleFirstPlanet when startPrice is unavailable", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_call") throw { code: -32603, message: "execution reverted" };
      return "0xabc";
    });

    await expect(sendSettlementTransaction(provider, account, { address: contract })).resolves.toBe("0xabc");

    expect(requests.at(-1)).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: "0x59268393"
        }
      ]
    });
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
      sendStartDefenseProductionTransaction(provider, account, contract, "7", 0, 2)
    ).resolves.toBe("0xtx6");
    await expect(
      sendFinishDefenseProductionTransaction(provider, account, contract, "7")
    ).resolves.toBe("0xtx7");

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

  test("submits alliance foundation transactions", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return `0xalliance${requests.length}`;
    });

    await expect(
      sendCreateAllianceTransaction(provider, account, contract, "VDFT", "Veydrift Union", "ipfs://union")
    ).resolves.toBe("0xalliance1");
    await expect(
      sendAllianceInviteTransaction(provider, account, contract, "1", "0x3333333333333333333333333333333333333333")
    ).resolves.toBe("0xalliance2");
    await expect(
      sendOpenDefenseIntentTransaction(provider, account, contract, "7", "42")
    ).resolves.toBe("0xalliance3");

    expect(requests[0]).toMatchObject({
      method: "eth_sendTransaction",
      params: [{ from: account, to: contract }]
    });
    expect((requests[0] as { params: Array<{ data: string }> }).params[0]?.data.startsWith("0x944cde0e")).toBe(true);
    expect(requests[1]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: `0x9e6d6830${"1".padStart(64, "0")}${"3333333333333333333333333333333333333333".padStart(64, "0")}`
        }
      ]
    });
    expect(requests[2]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: encodeGameCall("0x56f919e7", [7, 42])
        }
      ]
    });
  });

  test("fetches dynamic wallet state without browser cache", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init: unknown }> = [];

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

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

  test("fetches empty highscores as a valid rankings payload", async () => {
    const originalFetch = globalThis.fetch;
    const rankings = {
      generatedAt: "2026-05-22T00:00:00.000Z",
      formula: {
        pointsDivisor: "1000",
        summary: "Classic score"
      },
      rankings: {
        total: [],
        economy: [],
        research: [],
        fleet: [],
        defense: []
      }
    };

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      expect(String(input)).toBe("https://api.example.test/highscores?limit=100");
      expect(init).toEqual({
        headers: { accept: "application/json" },
      });
      return new Response(JSON.stringify(rankings), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      await expect(fetchHighscores("https://api.example.test///")).resolves.toEqual(rankings);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("explains highscore API unavailability instead of exposing generic HTTP errors", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: "highscores_not_supported" }),
      {
        headers: { "content-type": "application/json" },
        status: 503,
      }
    )) as unknown as typeof fetch;

    try {
      await expect(fetchHighscores("https://api.example.test")).rejects.toThrow(
        "Rankings are temporarily unavailable because the deployed game API does not support highscores yet. Retry after the backend redeploys."
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("explains highscore network and CORS failures instead of exposing Failed to fetch", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    try {
      await expect(fetchHighscores("https://api.example.test")).rejects.toThrow(
        "Rankings are temporarily unavailable because the game API could not be reached from this browser. Check the API deployment or CORS settings, then retry."
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
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
