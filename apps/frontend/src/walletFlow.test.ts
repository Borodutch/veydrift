import { describe, expect, test } from "bun:test";
import {
  BASE_SEPOLIA,
  assertWalletUnlocked,
  decodeBoolResult,
  decodeUintResult,
  encodeQuantity,
  encodeAddressUintCall,
  encodeAddressCall,
  encodeColonizationTargetId,
  encodeGameCall,
  encodeJoinAttackMissionCall,
  encodeLaunchInterplanetaryMissileAttackCall,
  encodeLaunchFleetMissionCall,
  encodeUintCall,
  ensureBaseSepoliaNetwork,
  fetchAllianceState,
  fetchDefenseState,
  fetchFleetMissionVisibility,
  fetchHighscores,
  fetchInfrastructureState,
  fetchMoonState,
  fetchPlayerProfile,
  fetchResearchState,
  fetchShipyardState,
  fetchWalletPlanets,
  fetchWalletSettlement,
  fetchWalletQueues,
  getAvailableWalletProvider,
  getAvailableWalletProviderDetails,
  getInjectedProvider,
  isBaseSepoliaChain,
  isUserRejected,
  miniAppUnsupportedChainMessage,
  mergePlayerProfile,
  parseRiftTokenAmount,
  readSettlementFundingState,
  readSettlementState,
  sendCollectResourcesTransaction,
  sendCompleteFleetMissionReturnTransaction,
  sendApproveResourceTokenTransaction,
  sendDepositResourceTransaction,
  sendFinishDefenseProductionTransaction,
  sendFinishBuildingUpgradeTransaction,
  sendFinishResourceWithdrawalTransaction,
  sendFinishShipProductionTransaction,
  sendFinishResearchTransaction,
  sendCreateColonyTransaction,
  sendJoinAttackMissionTransaction,
  sendLaunchInterplanetaryMissileAttackTransaction,
  sendLaunchFleetMissionTransaction,
  sendFinishMoonBuildingUpgradeTransaction,
  sendJumpGateJumpTransaction,
  sendRecallFleetMissionTransaction,
  sendResolveFleetMissionTransaction,
  sendAcceptAllianceInviteTransaction,
  sendAllianceJoinRequestTransaction,
  sendAllianceKickTransaction,
  sendAllianceInviteTransaction,
  sendAllianceProfileTransaction,
  sendAllianceRoleTransaction,
  sendApproveAllianceJoinRequestTransaction,
  sendCancelAllianceJoinRequestTransaction,
  sendCreateAllianceTransaction,
  sendDismissAllianceJoinRequestTransaction,
  sendRequestResourceWithdrawalTransaction,
  sendSettlementTransaction,
  sendStartBuildingUpgradeTransaction,
  sendStartMoonBuildingUpgradeTransaction,
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

  test("detects locked MetaMask before transaction submission", async () => {
    const requests: unknown[] = [];
    const provider = {
      ...mockProvider(async ({ method, params }) => {
        requests.push({ method, params });
        throw new Error("eth_sendTransaction should not be called");
      }),
      _metamask: {
        isUnlocked: async () => false,
      },
    } as Eip1193Provider;

    await expect(assertWalletUnlocked(provider)).rejects.toThrow("Wallet is locked. Please unlock MetaMask and try again.");
    await expect(
      sendStartBuildingUpgradeTransaction(provider, account, contract, "7", 0)
    ).rejects.toThrow("Wallet is locked. Please unlock MetaMask and try again.");

    expect(requests).toEqual([]);
  });

  test("detects locked MetaMask from empty accounts when the unlock probe is unavailable", async () => {
    const requests: unknown[] = [];
    const provider = {
      ...mockProvider(async ({ method, params }) => {
        requests.push({ method, params });
        if (method === "eth_accounts") return [];
        throw new Error("eth_sendTransaction should not be called");
      }),
      _metamask: {},
    } as Eip1193Provider;

    await expect(assertWalletUnlocked(provider)).rejects.toThrow("Wallet is locked. Please unlock MetaMask and try again.");
    await expect(
      sendStartBuildingUpgradeTransaction(provider, account, contract, "7", 0)
    ).rejects.toThrow("Wallet is locked. Please unlock MetaMask and try again.");

    expect(requests).toEqual([
      { method: "eth_accounts", params: undefined },
      { method: "eth_accounts", params: undefined },
    ]);
  });

  test("detects injected wallet availability before Mini App fallback", async () => {
    const provider = mockProvider(async () => null);
    const miniAppProvider = mockProvider(async () => null);

    expect(getInjectedProvider({ ethereum: provider })).toBe(provider);
    await expect(getAvailableWalletProvider({ ethereum: provider }, {
      wallet: {
        getEthereumProvider: () => miniAppProvider,
      },
    })).resolves.toBe(provider);
    await expect(getAvailableWalletProvider({}, {
      wallet: {
        getEthereumProvider: () => miniAppProvider,
      },
    })).resolves.toBe(miniAppProvider);
    await expect(getAvailableWalletProvider({}, {
      wallet: {
        getEthereumProvider: () => ({ notAProvider: true }) as unknown as Eip1193Provider,
      },
    })).resolves.toBeUndefined();
    expect(getInjectedProvider({})).toBeUndefined();
  });

  test("reports whether the selected wallet provider came from Farcaster", async () => {
    const provider = mockProvider(async () => null);
    const miniAppProvider = mockProvider(async () => null);

    await expect(getAvailableWalletProviderDetails({ ethereum: provider }, {
      wallet: {
        getEthereumProvider: () => miniAppProvider,
      },
    })).resolves.toEqual({
      provider,
      source: "injected",
    });
    await expect(getAvailableWalletProviderDetails({}, {
      wallet: {
        getEthereumProvider: () => miniAppProvider,
      },
    })).resolves.toEqual({
      provider: miniAppProvider,
      source: "farcaster",
    });
    await expect(getAvailableWalletProviderDetails({}, {
      wallet: {
        getEthereumProvider: () => ({ notAProvider: true }) as unknown as Eip1193Provider,
      },
    })).resolves.toBeUndefined();
  });

  test("ignores unavailable Mini App wallet provider outside host sessions", async () => {
    await expect(getAvailableWalletProvider({}, {
      wallet: {
        getEthereumProvider: () => {
          throw new Error("not in a Mini App host");
        },
      },
    })).resolves.toBeUndefined();
  });

  test("keeps a known commander name over fallback-only profile refreshes for the same wallet", () => {
    expect(mergePlayerProfile({
      wallet: account,
      displayName: "Nova Prime",
      fallbackName: "0x1111...1111",
      updatedAt: "2026-06-02T00:00:00.000Z"
    }, {
      wallet: account.toUpperCase(),
      displayName: null,
      fallbackName: "0x1111...1111",
      updatedAt: null
    })).toEqual({
      wallet: account.toUpperCase(),
      displayName: "Nova Prime",
      fallbackName: "0x1111...1111",
      updatedAt: "2026-06-02T00:00:00.000Z"
    });
  });

  test("allows unnamed commander fallback when no display name is known", () => {
    expect(mergePlayerProfile(undefined, {
      wallet: account,
      displayName: null,
      fallbackName: "0x1111...1111",
      updatedAt: null
    })).toEqual({
      wallet: account,
      displayName: null,
      fallbackName: "0x1111...1111",
      updatedAt: null
    });
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
    const joinData = encodeJoinAttackMissionCall({
      originPlanetId: 7,
      attackMissionId: 12,
      targetPlanetId: 9,
      ships,
    });
    const colonyData = encodeLaunchFleetMissionCall({
      originPlanetId: 7,
      targetPlanetId: encodeColonizationTargetId(2, 44, 10),
      missionType: 2,
      ships: {
        smallCargo: 0,
        lightFighter: 0,
        recycler: 0,
        colonyShip: 1,
        largeCargo: 0,
        heavyFighter: 0,
        cruiser: 0,
        battleship: 0,
        bomber: 0,
        destroyer: 0,
        deathstar: 0,
        battlecruiser: 0,
        reaper: 0,
        pathfinder: 0,
      },
      speedPercent: 40,
    });
    const requests: unknown[] = [];
    let transactionCount = 0;
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_sendTransaction") {
        transactionCount += 1;
        return `0xgalaxy${transactionCount}`;
      }
      return "0x";
    });

    await expect(sendLaunchFleetMissionTransaction(provider, account, contract, {
      originPlanetId: 7,
      targetPlanetId: 9,
      missionType: 3,
      ships,
    })).resolves.toBe("0xgalaxy1");
    await expect(sendCreateColonyTransaction(provider, account, contract, "7", 2, 44, 10, 40)).resolves.toBe("0xgalaxy2");
    await expect(sendJoinAttackMissionTransaction(provider, account, contract, {
      originPlanetId: 7,
      attackMissionId: 12,
      targetPlanetId: 9,
      ships,
    })).resolves.toBe("0xgalaxy3");
    await expect(sendLaunchInterplanetaryMissileAttackTransaction(provider, account, contract, {
      originPlanetId: 7,
      targetPlanetId: 9,
      primaryTargetId: 0,
      quantity: 1,
    })).resolves.toBe("0xgalaxy4");

    expect(missionData.startsWith("0x60eac16f")).toBe(true);
    expect(joinData.startsWith("0x28260eb6")).toBe(true);
    expect(encodeLaunchInterplanetaryMissileAttackCall({
      originPlanetId: 7,
      targetPlanetId: 9,
      primaryTargetId: 0,
      quantity: 1,
    })).toBe(
      "0xa72cd29a"
      + "0000000000000000000000000000000000000000000000000000000000000007"
      + "0000000000000000000000000000000000000000000000000000000000000009"
      + "0000000000000000000000000000000000000000000000000000000000000000"
      + "0000000000000000000000000000000000000000000000000000000000000001"
    );
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
          data: colonyData,
        }],
      },
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: joinData,
        }],
      },
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeGameCall("0xa72cd29a", [7, 9, 0, 1]),
        }],
      },
    ]);
  });

  test("submits fleet launches without browser-side contract preflight reads", async () => {
    const ships = {
      smallCargo: 1,
      lightFighter: 0,
      recycler: 0,
      colonyShip: 0,
      largeCargo: 0,
      heavyFighter: 0,
      cruiser: 0,
      battleship: 0,
      bomber: 0,
      destroyer: 0,
      deathstar: 0,
      battlecruiser: 0,
      reaper: 0,
      pathfinder: 0,
    };
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_call") {
        throw { code: 3, message: "execution reverted", data: "0x705f508b" };
      }
      return "0xfleet";
    });

    await expect(sendLaunchFleetMissionTransaction(provider, account, contract, {
      originPlanetId: 7,
      targetPlanetId: 9,
      missionType: 3,
      ships,
    })).resolves.toBe("0xfleet");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeLaunchFleetMissionCall({
            originPlanetId: 7,
            targetPlanetId: 9,
            missionType: 3,
            ships,
          }),
        }],
      },
    ]);
  });

  test("encodes mission ships, cargo, and randomness in contract ABI order", () => {
    const ships = {
      smallCargo: 1,
      lightFighter: 2,
      recycler: 3,
      colonyShip: 4,
      largeCargo: 5,
      heavyFighter: 6,
      cruiser: 7,
      battleship: 8,
      bomber: 9,
      destroyer: 10,
      deathstar: 11,
      battlecruiser: 12,
      reaper: 13,
      pathfinder: 14,
    };

    expect(encodeLaunchFleetMissionCall({
      originPlanetId: 7,
      targetPlanetId: 9,
      missionType: 3,
      ships,
      cargo: {
        metal: "101",
        crystal: "202",
        deuterium: "303",
      },
      speedPercent: 50,
      randomnessRequestId: 404,
    })).toBe(
      "0x60eac16f"
        + [
          7, 9, 3,
          1, 2, 3, 4, 5, 6, 7,
          8, 9, 10, 11, 12, 13, 14,
          101, 202, 303, 50, 404,
        ].map((value) => BigInt(value).toString(16).padStart(64, "0")).join("")
    );
  });

  test("encodes fleet lifecycle resolver transactions", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return `0xfleet${requests.length}`;
    });

    await expect(sendRecallFleetMissionTransaction(provider, account, contract, "11")).resolves.toBe("0xfleet1");
    await expect(sendResolveFleetMissionTransaction(provider, account, contract, "12")).resolves.toBe("0xfleet2");
    await expect(sendCompleteFleetMissionReturnTransaction(provider, account, contract, "13")).resolves.toBe("0xfleet3");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeGameCall("0x1cbc460c", ["11"]),
        }],
      },
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeGameCall("0xde09e7cf", ["12"]),
        }],
      },
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeGameCall("0xc2472852", ["13"]),
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

  test("explains Quorum/Farcaster Mini App wrong-chain state without network switching", () => {
    const message = miniAppUnsupportedChainMessage("0x2105");

    expect(message).toContain("Base mainnet (0x2105)");
    expect(message).toContain("requires Base Sepolia (0x14a34)");
    expect(message).toContain("does not expose a safe network switch");
    expect(message).toContain("desktop browser wallet flow");
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
    expect(walletRequestErrorMessage(new Error("Timed out reading wallet accounts from the wallet after 10 seconds."))).toContain(
      "Unlock or reconnect MetaMask"
    );
    expect(walletRequestErrorMessage(new Error("Timed out reading settlement from the game API after 10 seconds."))).toContain(
      "game API may be temporarily unavailable"
    );
    expect(walletRequestErrorMessage(new Error("MetaMask is locked"))).toBe(
      "Wallet is locked. Please unlock MetaMask and try again."
    );
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

  test("allows Mini App settlement funding when the host provider cannot read wallet balance", async () => {
    const provider = mockProvider(async ({ method }) => {
      if (method === "eth_call") return word(50_000_000_000_000_000n);
      if (method === "eth_getBalance") {
        throw { code: 4200, message: "The provider does not support the requested method." };
      }
      throw new Error(`Unexpected ${method}`);
    });

    await expect(readSettlementFundingState(provider, account, { address: contract }, {
      balanceRead: "optional",
    })).resolves.toEqual({
      affordable: true,
      balanceWei: null,
      contractKind: "game",
      startPriceWei: 50_000_000_000_000_000n
    });
  });

  test("submits Mini App settlement when only the balance read is unsupported", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_call") return word(50_000_000_000_000_000n);
      if (method === "eth_getBalance") {
        throw { code: 4200, message: "The provider does not support the requested method." };
      }
      return "0xabc";
    });

    await expect(
      sendSettlementTransaction(provider, account, { address: contract }, {
        balanceRead: "optional",
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

  test("reads Mini App settlement funding through a readonly provider", async () => {
    const walletRequests: unknown[] = [];
    const readRequests: unknown[] = [];
    const walletProvider = mockProvider(async ({ method, params }) => {
      walletRequests.push({ method, params });
      throw { code: 4200, message: "The provider does not support the requested method." };
    });
    const readProvider = mockProvider(async ({ method, params }) => {
      readRequests.push({ method, params });
      if (method === "eth_call") return word(50_000_000_000_000_000n);
      if (method === "eth_getBalance") return word(60_000_000_000_000_000n);
      throw new Error(`Unexpected readonly ${method}`);
    });

    await expect(readSettlementFundingState(walletProvider, account, { address: contract }, {
      balanceRead: "optional",
      readProvider,
    })).resolves.toEqual({
      affordable: true,
      balanceWei: 60_000_000_000_000_000n,
      contractKind: "game",
      startPriceWei: 50_000_000_000_000_000n
    });

    expect(walletRequests).toEqual([]);
    expect(readRequests).toEqual([
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
      }
    ]);
  });

  test("submits Mini App settlement without wallet-backed read preflights", async () => {
    const walletRequests: unknown[] = [];
    const readRequests: unknown[] = [];
    const walletProvider = mockProvider(async ({ method, params }) => {
      walletRequests.push({ method, params });
      if (method === "eth_sendTransaction") return "0xabc";
      throw { code: 4200, message: "The provider does not support the requested method." };
    });
    const readProvider = mockProvider(async ({ method, params }) => {
      readRequests.push({ method, params });
      if (method === "eth_call") return word(50_000_000_000_000_000n);
      if (method === "eth_getBalance") return word(60_000_000_000_000_000n);
      throw new Error(`Unexpected readonly ${method}`);
    });

    await expect(
      sendSettlementTransaction(walletProvider, account, { address: contract }, {
        balanceRead: "optional",
        readProvider,
      })
    ).resolves.toBe("0xabc");

    expect(readRequests).toEqual([
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
      }
    ]);
    expect(walletRequests).toEqual([
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
    let sentTransactions = 0;
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_call") return "0x";
      sentTransactions += 1;
      return `0xtx${sentTransactions}`;
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

  test("submits building upgrade transactions without browser-side contract preflight reads", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_call") {
        throw { code: 3, message: "execution reverted", data: "0xcec62bc2" };
      }
      return "0xbuild";
    });

    await expect(
      sendStartBuildingUpgradeTransaction(provider, account, contract, "1", 3)
    ).resolves.toBe("0xbuild");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: encodeGameCall("0x165715e3", [1, 3])
          }
        ]
      }
    ]);
  });

  test("submits ready finish building upgrade transactions without a wallet-backed preflight call", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_call") {
        throw new Error("eth_call should not block a ready finish click");
      }
      return "0xfinish";
    });

    await expect(
      sendFinishBuildingUpgradeTransaction(provider, account, contract, "1")
    ).resolves.toBe("0xfinish");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: "0x6ab2f9d40000000000000000000000000000000000000000000000000000000000000001"
          }
        ]
      }
    ]);
  });

  test("ignores readonly providers for finish building upgrade transaction submissions", async () => {
    const walletRequests: unknown[] = [];
    const readonlyRequests: unknown[] = [];
    const walletProvider = mockProvider(async ({ method, params }) => {
      walletRequests.push({ method, params });
      if (method === "eth_sendTransaction") return "0xfinish";
      throw new Error("wallet reads should not be used for finish submission");
    });
    const readProvider = mockProvider(async ({ method, params }) => {
      readonlyRequests.push({ method, params });
      throw new Error("readonly provider should not be used for finish submission");
    });

    await expect(
      sendFinishBuildingUpgradeTransaction(walletProvider, account, contract, "7", { readProvider })
    ).resolves.toBe("0xfinish");

    expect(readonlyRequests).toEqual([]);
    expect(walletRequests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: "0x6ab2f9d40000000000000000000000000000000000000000000000000000000000000007"
          }
        ]
      }
    ]);
  });

  test("ignores readonly providers for resource collection transaction submissions", async () => {
    const walletRequests: unknown[] = [];
    const readonlyRequests: unknown[] = [];
    const walletProvider = mockProvider(async ({ method, params }) => {
      walletRequests.push({ method, params });
      if (method === "eth_sendTransaction") return "0xcollect";
      throw new Error("wallet reads should not be used for resource collection submission");
    });
    const readProvider = mockProvider(async ({ method, params }) => {
      readonlyRequests.push({ method, params });
      throw new Error("readonly provider should not be used for resource collection submission");
    });

    await expect(
      sendCollectResourcesTransaction(walletProvider, account, contract, "7", { readProvider })
    ).resolves.toBe("0xcollect");

    expect(readonlyRequests).toEqual([]);
    expect(walletRequests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: "0xdb43284d0000000000000000000000000000000000000000000000000000000000000007"
          }
        ]
      }
    ]);
  });

  test("submits moon building and Jump Gate transactions", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return `0xmoon${requests.length}`;
    });
    const ships = {
      smallCargo: 2,
      lightFighter: 0,
      recycler: 0,
      colonyShip: 0,
      largeCargo: 1,
      heavyFighter: 0,
      cruiser: 0,
      battleship: 0,
      bomber: 0,
      destroyer: 0,
      deathstar: 0,
      battlecruiser: 0,
      reaper: 0,
      pathfinder: 0,
    };

    await expect(sendStartMoonBuildingUpgradeTransaction(provider, account, contract, "7", 2)).resolves.toBe("0xmoon1");
    await expect(sendFinishMoonBuildingUpgradeTransaction(provider, account, contract, "7")).resolves.toBe("0xmoon2");
    await expect(sendJumpGateJumpTransaction(provider, account, contract, "7", "9")).resolves.toBe("0xmoon3");
    await expect(sendJumpGateJumpTransaction(provider, account, contract, "7", "9", ships)).resolves.toBe("0xmoon4");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: encodeGameCall("0x715e1b1a", [7, 2])
          }
        ]
      },
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: encodeGameCall("0x713b9e66", [7])
          }
        ]
      },
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: encodeGameCall("0x36aaf8f8", [7, 9])
          }
        ]
      },
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: encodeGameCall("0x3095d992", [
              7,
              9,
              ships.smallCargo,
              ships.lightFighter,
              ships.recycler,
              ships.colonyShip,
              ships.largeCargo,
              ships.heavyFighter,
              ships.cruiser,
              ships.battleship,
              ships.bomber,
              ships.destroyer,
              ships.deathstar,
              ships.battlecruiser,
              ships.reaper,
              ships.pathfinder,
            ])
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

  test("submits VeydriftGame mission resolution transactions", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return "0xresolve";
    });

    await expect(
      sendResolveFleetMissionTransaction(provider, account, contract, "42")
    ).resolves.toBe("0xresolve");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: encodeGameCall("0xde09e7cf", [42])
          }
        ]
      }
    ]);
  });

  test("submits alliance roster transactions", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return `0xalliance${requests.length}`;
    });

    await expect(
      sendCreateAllianceTransaction(provider, account, contract, "VDFT", "Veydrift Union", "Discord: https://discord.gg/vdft")
    ).resolves.toBe("0xalliance1");
    await expect(
      sendAllianceInviteTransaction(provider, account, contract, "1", "0x3333333333333333333333333333333333333333")
    ).resolves.toBe("0xalliance2");
    await expect(
      sendAcceptAllianceInviteTransaction(provider, account, contract, "1")
    ).resolves.toBe("0xalliance3");
    await expect(
      sendAllianceKickTransaction(provider, account, contract, "1", "0x3333333333333333333333333333333333333333")
    ).resolves.toBe("0xalliance4");
    await expect(
      sendAllianceRoleTransaction(provider, account, contract, "1", "0x3333333333333333333333333333333333333333", "officer")
    ).resolves.toBe("0xalliance5");
    await expect(
      sendAllianceProfileTransaction(provider, account, contract, "1", "VDF", "Veydrift Directorate", "Line 1\nLine 2")
    ).resolves.toBe("0xalliance6");
    await expect(
      sendAllianceJoinRequestTransaction(provider, account, contract, "1")
    ).resolves.toBe("0xalliance7");
    await expect(
      sendCancelAllianceJoinRequestTransaction(provider, account, contract, "1")
    ).resolves.toBe("0xalliance8");
    await expect(
      sendApproveAllianceJoinRequestTransaction(provider, account, contract, "1", "0x3333333333333333333333333333333333333333")
    ).resolves.toBe("0xalliance9");
    await expect(
      sendDismissAllianceJoinRequestTransaction(provider, account, contract, "1", "0x3333333333333333333333333333333333333333")
    ).resolves.toBe("0xalliance10");

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
          data: encodeUintCall("0xbf8e9176", 1)
        }
      ]
    });
    expect(requests[3]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: `0xbd0e667c${"1".padStart(64, "0")}${"3333333333333333333333333333333333333333".padStart(64, "0")}`
        }
      ]
    });
    expect(requests[4]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: `0xbfbb73f1${"1".padStart(64, "0")}${"3333333333333333333333333333333333333333".padStart(64, "0")}${"2".padStart(64, "0")}`
        }
      ]
    });
    expect((requests[5] as { params: Array<{ data: string }> }).params[0]?.data.startsWith(
      `0x3fd0e7a5${"1".padStart(64, "0")}`
    )).toBe(true);
    expect(requests[6]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: encodeUintCall("0xbc46277a", 1)
        }
      ]
    });
    expect(requests[7]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: encodeUintCall("0xc5c4bdcc", 1)
        }
      ]
    });
    expect(requests[8]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: `0x8ff388c7${"1".padStart(64, "0")}${"3333333333333333333333333333333333333333".padStart(64, "0")}`
        }
      ]
    });
    expect(requests[9]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: `0xcd844a18${"1".padStart(64, "0")}${"3333333333333333333333333333333333333333".padStart(64, "0")}`
        }
      ]
    });
  });

  test("fetches dynamic wallet state without browser cache", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init: { cache: RequestCache | undefined; headers: HeadersInit | undefined; signal: boolean } }> = [];

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      calls.push({
        url: String(input),
        init: {
          cache: init?.cache,
          headers: init?.headers,
          signal: init?.signal instanceof AbortSignal,
        },
      });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      await fetchWalletSettlement("https://api.example.test", account);
      await fetchWalletSettlement("https://api.example.test", account);
      await fetchWalletPlanets("https://api.example.test///", account);
      await fetchWalletQueues("https://api.example.test///", account);
      await fetchWalletQueues("https://api.example.test///", account, "7");
      await fetchInfrastructureState("https://api.example.test", account);
      await fetchInfrastructureState("https://api.example.test", account, undefined);
      await fetchMoonState("https://api.example.test", account, "7");
      await fetchMoonState("https://api.example.test", account, "7");
      await fetchMoonState("https://api.example.test", account, "8:37:9");
      await fetchResearchState("https://api.example.test", account, "7");
      await fetchResearchState("https://api.example.test", account, "7");
      await fetchFleetMissionVisibility("https://api.example.test", account);
      await fetchShipyardState("https://api.example.test", account, "4");
      await fetchShipyardState("https://api.example.test", account, "4");
      await fetchShipyardState("https://api.example.test", account, "8:37:9");
      await fetchDefenseState("https://api.example.test", account, "4");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toEqual([
      {
        url: `https://api.example.test/wallet/${account}/settlement`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/settlement`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/planets`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/queues`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/queues?planetId=7`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/infrastructure`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/infrastructure`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/moon?planetId=7`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/moon?planetId=7`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/moon`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/research?planetId=7`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/research?planetId=7`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/fleet-visibility`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/shipyard?planetId=4`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/shipyard?planetId=4`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/shipyard`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/defenses?planetId=4`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
    ]);
  });

  test("ignores readonly providers for Mini App building transaction submissions", async () => {
    const walletRequests: unknown[] = [];
    const readonlyRequests: unknown[] = [];
    const walletProvider = mockProvider(async ({ method, params }) => {
      walletRequests.push({ method, params });
      if (method === "eth_sendTransaction") return "0xtx1";
      throw { code: 4200, message: "The provider does not support the requested method." };
    });
    const readProvider = mockProvider(async ({ method, params }) => {
      readonlyRequests.push({ method, params });
      return "0x";
    });

    await expect(
      sendStartBuildingUpgradeTransaction(walletProvider, account, contract, "7", 0, { readProvider })
    ).resolves.toBe("0xtx1");

    expect(readonlyRequests).toEqual([]);
    expect(walletRequests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: encodeGameCall("0x165715e3", [7, 0])
          }
        ]
      }
    ]);
  });

  test("includes backend wallet API validation messages in shipyard errors", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: "planetId must be a positive integer." }),
      {
        headers: { "content-type": "application/json" },
        status: 400,
      }
    )) as unknown as typeof fetch;

    try {
      await expect(fetchShipyardState("https://api.example.test", account, "4")).rejects.toThrow(
        "Shipyard API failed: 400: planetId must be a positive integer."
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("explains transient wallet API transport and backend readiness failures", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    try {
      await expect(fetchInfrastructureState("https://api.example.test", account, "7")).rejects.toThrow(
        "Keeping the last known game state"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: "backend_not_configured" }),
      {
        headers: { "content-type": "application/json" },
        status: 503,
      }
    )) as unknown as typeof fetch;
    try {
      await expect(fetchInfrastructureState("https://api.example.test", account, "7")).rejects.toThrow(
        "backend readiness is restored"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetches the canonical player profile for a wallet", async () => {
    const originalFetch = globalThis.fetch;
    const profile = {
      wallet: account.toLowerCase(),
      displayName: "borodutch",
      fallbackName: "0x1111...1111",
      updatedAt: "2026-06-02T13:00:00.000Z",
    };

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      expect(String(input)).toBe(`https://api.example.test/wallet/${account}/profile`);
      expect(init).toEqual({
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: expect.any(AbortSignal),
      });
      return new Response(JSON.stringify(profile), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      await expect(fetchPlayerProfile("https://api.example.test///", account)).resolves.toEqual(profile);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetches empty highscores as a valid rankings payload", async () => {
    const originalFetch = globalThis.fetch;
    const rankings = {
      generatedAt: "2026-05-22T00:00:00.000Z",
      formula: {
        pointsDivisor: "1000",
        summary: "Veydrift score"
      },
      rankings: {
        total: [],
        economy: [],
        research: [],
        researchLevels: [],
        military: [],
        fleet: [],
        fleetCount: [],
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

  test("surfaces wallet API error messages from backend responses", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      expect(String(input)).toBe(`https://api.example.test/wallet/${account}/alliance`);
      expect(init).toEqual({
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: expect.any(AbortSignal),
      });
      return new Response(
        JSON.stringify({ error: "Alliance profile could not be decoded." }),
        {
          headers: { "content-type": "application/json" },
          status: 400,
        }
      );
    }) as unknown as typeof fetch;

    try {
      await expect(fetchAllianceState("https://api.example.test", account)).rejects.toThrow(
        "Alliance API failed: 400: Alliance profile could not be decoded."
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("explains temporary highscore chain read failures", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: "highscores_unavailable", detail: "RPC HTTP 429" }),
      {
        headers: { "content-type": "application/json" },
        status: 503,
      }
    )) as unknown as typeof fetch;

    try {
      await expect(fetchHighscores("https://api.example.test")).rejects.toThrow(
        "Rankings are temporarily unavailable because the game API could not read current chain data. Retry in a moment."
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("explains indexed highscore warmup without leaving rankings on loading copy", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => new Response(
      JSON.stringify({
        error: "highscores_index_not_ready",
        detail: "Rankings are warming from indexed game state.",
        retryable: true,
        source: "contract-state-indexer"
      }),
      {
        headers: { "content-type": "application/json" },
        status: 503,
      }
    )) as unknown as typeof fetch;

    try {
      await expect(fetchHighscores("https://api.example.test")).rejects.toThrow(
        "Rankings are warming from indexed game state. Retry in a moment."
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
