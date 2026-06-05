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
    expect(isBaseSepoliaChain("84532")).toBe(true);
    expect(isBaseSepoliaChain(84532)).toBe(true);
    expect(isBaseSepoliaChain("0x1")).toBe(false);
  });

  test("detects rejected wallet requests", () => {
    expect(isUserRejected({ code: 4001 })).toBe(true);
    expect(isUserRejected({ message: "User denied transaction signature" })).toBe(true);
    expect(isUserRejected({ code: -32603 })).toBe(false);
  });

  test("selects Rabby from a multi-provider injected wallet", () => {
    const metamaskProvider = mockProvider(async () => []);
    const rabbyProvider = {
      ...mockProvider(async () => []),
      isRabby: true,
    };
    const ethereum = {
      ...metamaskProvider,
      providers: [metamaskProvider, rabbyProvider],
    };

    expect(getInjectedProvider({ ethereum })).toBe(rabbyProvider);
  });

  test("uses OKX Wallet named provider when no ethereum provider is injected", () => {
    const okxwallet = {
      ...mockProvider(async () => []),
      isOkxWallet: true,
    };

    expect(getInjectedProvider({ okxwallet })).toBe(okxwallet);
  });

  test("detects locked wallet before transaction submission", async () => {
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

    await expect(assertWalletUnlocked(provider)).rejects.toThrow("Wallet is locked. Please unlock your wallet and try again.");
    await expect(
      sendStartBuildingUpgradeTransaction(provider, account, contract, "7", 0)
    ).rejects.toThrow("Wallet is locked. Please unlock your wallet and try again.");

    expect(requests).toEqual([]);
  });

  test("detects locked wallet from empty accounts when the unlock probe is unavailable", async () => {
    const requests: unknown[] = [];
    const provider = {
      ...mockProvider(async ({ method, params }) => {
        requests.push({ method, params });
        if (method === "eth_accounts") return [];
        throw new Error("eth_sendTransaction should not be called");
      }),
      _metamask: {},
    } as Eip1193Provider;

    await expect(assertWalletUnlocked(provider)).rejects.toThrow("Wallet is locked. Please unlock your wallet and try again.");
    await expect(
      sendStartBuildingUpgradeTransaction(provider, account, contract, "7", 0)
    ).rejects.toThrow("Wallet is locked. Please unlock your wallet and try again.");

    expect(requests).toEqual([
      { method: "eth_accounts", params: undefined },
      { method: "eth_accounts", params: undefined },
    ]);
  });

  test("checks Rabby-style providers for accounts before transaction submission", async () => {
    const requests: unknown[] = [];
    const provider = {
      ...mockProvider(async ({ method, params }) => {
        requests.push({ method, params });
        if (method === "eth_accounts") return [account];
        if (method === "eth_sendTransaction") return "0xabc";
        throw new Error(`Unexpected method ${method}`);
      }),
      isRabby: true,
    } as Eip1193Provider;

    await expect(sendStartBuildingUpgradeTransaction(provider, account, contract, "7", 0)).resolves.toBe("0xabc");

    expect(requests).toEqual([
      { method: "eth_accounts", params: undefined },
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeGameCall("0x165715e3", [7, 0]),
        }],
      },
    ]);
  });

  test("checks OKX-style providers for accounts before transaction submission", async () => {
    const requests: unknown[] = [];
    const provider = {
      ...mockProvider(async ({ method, params }) => {
        requests.push({ method, params });
        if (method === "eth_accounts") return [account];
        if (method === "eth_sendTransaction") return "0xdef";
        throw new Error(`Unexpected method ${method}`);
      }),
      isOkxWallet: true,
    } as Eip1193Provider;

    await expect(sendStartBuildingUpgradeTransaction(provider, account, contract, "7", 0)).resolves.toBe("0xdef");

    expect(requests).toEqual([
      { method: "eth_accounts", params: undefined },
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeGameCall("0x165715e3", [7, 0]),
        }],
      },
    ]);
  });

  test("requests Rabby accounts before non-preflight transaction submission", async () => {
    const requests: unknown[] = [];
    const provider = {
      ...mockProvider(async ({ method, params }) => {
        requests.push({ method, params });
        if (method === "eth_accounts") return [];
        if (method === "eth_requestAccounts") return [account];
        if (method === "eth_sendTransaction") return "0xship";
        throw new Error(`Unexpected method ${method}`);
      }),
      isRabby: true,
    } as Eip1193Provider;

    await expect(sendStartShipProductionTransaction(provider, account, contract, "7", 0, 3)).resolves.toBe("0xship");

    expect(requests).toEqual([
      { method: "eth_accounts", params: undefined },
      { method: "eth_requestAccounts", params: undefined },
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeGameCall("0x13aed9a2", [7, 0, 3]),
        }],
      },
    ]);
  });

  test("requests Rabby accounts before building start submission when current accounts are empty", async () => {
    const requests: unknown[] = [];
    const provider = {
      ...mockProvider(async ({ method, params }) => {
        requests.push({ method, params });
        if (method === "eth_accounts") return [];
        if (method === "eth_requestAccounts") return [account];
        if (method === "eth_sendTransaction") return "0xbuild";
        throw new Error(`Unexpected method ${method}`);
      }),
      isRabby: true,
    } as Eip1193Provider;

    await expect(sendStartBuildingUpgradeTransaction(provider, account, contract, "7", 0)).resolves.toBe("0xbuild");

    expect(requests).toEqual([
      { method: "eth_accounts", params: undefined },
      { method: "eth_requestAccounts", params: undefined },
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeGameCall("0x165715e3", [7, 0]),
        }],
      },
    ]);
  });

  test("reports rejected Rabby authorization before non-preflight transaction submission", async () => {
    const requests: unknown[] = [];
    const provider = {
      ...mockProvider(async ({ method, params }) => {
        requests.push({ method, params });
        if (method === "eth_accounts") return [];
        if (method === "eth_requestAccounts") throw { code: 4001, message: "Rejected" };
        throw new Error("eth_sendTransaction should not be called");
      }),
      isRabby: true,
    } as Eip1193Provider;

    await expect(
      sendStartShipProductionTransaction(provider, account, contract, "7", 0, 3)
    ).rejects.toThrow("Wallet connection was rejected. Reconnect your wallet, then retry.");

    expect(requests).toEqual([
      { method: "eth_accounts", params: undefined },
      { method: "eth_requestAccounts", params: undefined },
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
    const calls: string[] = [];
    const params: unknown[] = [];
    const provider = mockProvider(async ({ method, params: requestParams }) => {
      calls.push(method);
      if (method === "wallet_switchEthereumChain") {
        if (calls.filter((call) => call === "wallet_switchEthereumChain").length > 1) {
          return null;
        }
        throw { code: 4902 };
      }

      params.push(requestParams?.[0]);
      return null;
    });

    await ensureBaseSepoliaNetwork(provider);

    expect(calls).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ]);
    expect(params).toEqual([BASE_SEPOLIA]);
  });

  test("adds Base Sepolia on wallet unknown-chain messages before retrying switch", async () => {
    const calls: string[] = [];
    const provider = mockProvider(async ({ method }) => {
      calls.push(method);
      if (method === "wallet_switchEthereumChain" && calls.length === 1) {
        throw { code: -32603, message: "Unrecognized chain ID. Try wallet_addEthereumChain first." };
      }
      return null;
    });

    await ensureBaseSepoliaNetwork(provider);

    expect(calls).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ]);
  });

  test("retries Base Sepolia switch when Rabby iOS reports the chain is already added", async () => {
    const calls: string[] = [];
    const provider = mockProvider(async ({ method }) => {
      calls.push(method);
      if (method === "wallet_switchEthereumChain") {
        if (calls.filter((call) => call === "wallet_switchEthereumChain").length > 1) {
          return null;
        }
        throw { code: 4902 };
      }
      if (method === "wallet_addEthereumChain") {
        throw { code: -32603, message: "Base Sepolia has already been added." };
      }
      return null;
    });

    await ensureBaseSepoliaNetwork(provider);

    expect(calls).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ]);
  });

  test("surfaces rejected Base Sepolia add requests when the chain is genuinely missing", async () => {
    const calls: string[] = [];
    const provider = mockProvider(async ({ method }) => {
      calls.push(method);
      if (method === "wallet_switchEthereumChain") {
        throw { code: 4902 };
      }
      if (method === "wallet_addEthereumChain") {
        throw { code: 4001, message: "User rejected the request." };
      }
      return null;
    });

    await expect(ensureBaseSepoliaNetwork(provider)).rejects.toMatchObject({ code: 4001 });
    expect(calls).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
    ]);
  });

  test("surfaces rejected Base Sepolia switch requests without adding the chain", async () => {
    const calls: string[] = [];
    const provider = mockProvider(async ({ method }) => {
      calls.push(method);
      throw { code: 4001, message: "User rejected the request." };
    });

    await expect(ensureBaseSepoliaNetwork(provider)).rejects.toMatchObject({ code: 4001 });
    expect(calls).toEqual(["wallet_switchEthereumChain"]);
  });

  test("explains Farcaster Mini App wrong-chain state after switch/add fallback", () => {
    const message = miniAppUnsupportedChainMessage("0x2105");

    expect(message).toContain("Base mainnet (0x2105)");
    expect(message).toContain("requires Base Sepolia (0x14a34)");
    expect(message).toContain("ask the Farcaster wallet to switch or add Base Sepolia");
    expect(message).toContain("host rejects that request");
    expect(message).toContain("desktop browser wallet flow");
  });

  test("formats raw JSON-RPC provider errors into an actionable wallet message", () => {
    expect(walletRequestErrorMessage({ code: -32603, message: "Internal JSON-RPC error." })).toContain(
      "wallet could not read the current game contract state"
    );
    expect(walletRequestErrorMessage(new Error("execution reverted"))).toContain("game contract rejected");
    expect(walletRequestErrorMessage(new Error("Timed out reading wallet accounts from the wallet after 10 seconds."))).toContain(
      "Unlock or reconnect your wallet"
    );
    expect(walletRequestErrorMessage(new Error("Timed out reading settlement from the game API after 10 seconds."))).toContain(
      "game API may be temporarily unavailable"
    );
    expect(walletRequestErrorMessage(new Error("Timed out reading settlement from the game API after 10 seconds."))).not.toContain(
      "sync resumes"
    );
    expect(walletRequestErrorMessage(new Error("MetaMask is locked"))).toBe(
      "Wallet is locked. Please unlock your wallet and try again."
    );
  });

  test("submits a value-bearing VeydriftGame startPlanet transaction with backend-provided start price", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return "0xabc";
    });

    await expect(
      sendSettlementTransaction(provider, account, { address: contract }, {
        startPriceWei: 50_000_000_000_000_000n,
      })
    ).resolves.toBe("0xabc");

    expect(requests).toEqual([
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

  test("requires backend settlement funding before submitting first planet transactions", async () => {
    const provider = mockProvider(async ({ method }) => {
      throw new Error(`Unexpected ${method}`);
    });

    await expect(
      sendSettlementTransaction(provider, account, {
        address: contract
      })
    ).rejects.toThrow("Settlement funding information is required");
  });

  test("submits legacy settleFirstPlanet when backend reports no game start price", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return "0xabc";
    });

    await expect(
      sendSettlementTransaction(provider, account, { address: contract }, { startPriceWei: null })
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

  test("blocks game settlement while resource token reserves are not configured", async () => {
    const provider = mockProvider(async ({ method }) => {
      throw new Error(`Unexpected ${method}`);
    });

    await expect(
      sendSettlementTransaction(provider, account, {
        address: contract,
        resourceTokensConfigured: false
      }, { startPriceWei: 50_000_000_000_000_000n })
    ).rejects.toThrow("Resource token reserves are not configured");
  });

  test("submits VeydriftGame building and shipyard transactions", async () => {
    const requests: unknown[] = [];
    let sentTransactions = 0;
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_estimateGas") return "0x5208";
      sentTransactions += 1;
      return `0xtx${sentTransactions}`;
    });

    await expect(
      sendStartBuildingUpgradeTransaction(provider, account, contract, "7", 0)
    ).resolves.toBe("0xtx1");
    await expect(
      sendFinishBuildingUpgradeTransaction(provider, account, contract, "7")
    ).resolves.toBe("0xtx2");
    await expect(
      sendStartShipProductionTransaction(provider, account, contract, "7", 0, 3)
    ).resolves.toBe("0xtx3");
    await expect(
      sendFinishShipProductionTransaction(provider, account, contract, "7")
    ).resolves.toBe("0xtx4");
    await expect(
      sendStartDefenseProductionTransaction(provider, account, contract, "7", 0, 2)
    ).resolves.toBe("0xtx5");
    await expect(
      sendFinishDefenseProductionTransaction(provider, account, contract, "7")
    ).resolves.toBe("0xtx6");

    expect(requests).toEqual([
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
        method: "eth_estimateGas",
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

  test("preflights ready finish building upgrade transactions before wallet submission", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_estimateGas") return "0x3658c";
      return "0xfinish";
    });

    await expect(
      sendFinishBuildingUpgradeTransaction(provider, account, contract, "1")
    ).resolves.toBe("0xfinish");

    expect(requests).toEqual([
      {
        method: "eth_estimateGas",
        params: [
          {
            from: account,
            to: contract,
            data: "0x6ab2f9d40000000000000000000000000000000000000000000000000000000000000001"
          }
        ]
      },
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

  test("blocks invalid finish building upgrade transactions before opening the wallet", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_estimateGas") {
        throw new Error("execution reverted: ConstructionInactive");
      }
      throw new Error("eth_sendTransaction should not be called");
    });

    await expect(
      sendFinishBuildingUpgradeTransaction(provider, account, contract, "1")
    ).rejects.toThrow("Building completion cannot be confirmed by the game contract yet");

    expect(requests).toEqual([
      {
        method: "eth_estimateGas",
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

  test("requests Rabby accounts before other production, research, and rift submissions", async () => {
    const walletRequests: Array<{ method: string; params: unknown[] | undefined }> = [];
    let authorized = false;
    let sentTransactions = 0;
    const walletProvider = {
      ...mockProvider(async ({ method, params }) => {
        walletRequests.push({ method, params });
        if (method === "eth_accounts") return authorized ? [account] : [];
        if (method === "eth_requestAccounts") {
          authorized = true;
          return [account];
        }
        if (method === "eth_sendTransaction") {
          sentTransactions += 1;
          return `0xrabby${sentTransactions}`;
        }
        throw new Error(`Unexpected wallet method ${method}`);
      }),
      isRabby: true,
    } as Eip1193Provider;

    const submissions: Array<() => Promise<string>> = [
      () => sendStartShipProductionTransaction(walletProvider, account, contract, "7", 0, 3),
      () => sendFinishShipProductionTransaction(walletProvider, account, contract, "7"),
      () => sendStartDefenseProductionTransaction(walletProvider, account, contract, "7", 0, 2),
      () => sendFinishDefenseProductionTransaction(walletProvider, account, contract, "7"),
      () => sendStartResearchTransaction(walletProvider, account, contract, "7", 12),
      () => sendFinishResearchTransaction(walletProvider, account, contract),
      () => sendApproveResourceTokenTransaction(walletProvider, account, "0x3333333333333333333333333333333333333333", contract, 1_500_000n),
      () => sendDepositResourceTransaction(walletProvider, account, contract, "7", 0, 1_500_000n),
      () => sendRequestResourceWithdrawalTransaction(walletProvider, account, contract, "7", 1, 2_000_000n),
      () => sendFinishResourceWithdrawalTransaction(walletProvider, account, contract, 1),
    ];

    for (let index = 0; index < submissions.length; index += 1) {
      await expect(submissions[index]!()).resolves.toBe(`0xrabby${index + 1}`);
    }

    const methods = walletRequests.map((request) => request.method);
    expect(methods.slice(0, 3)).toEqual(["eth_accounts", "eth_requestAccounts", "eth_sendTransaction"]);
    expect(methods.filter((method) => method === "eth_requestAccounts")).toHaveLength(1);
    expect(methods.filter((method) => method === "eth_accounts")).toHaveLength(submissions.length);
    expect(methods.filter((method) => method === "eth_sendTransaction")).toHaveLength(submissions.length);
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
        "API is temporarily unavailable. The app will retry"
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

function withMetaMaskUnlockProbe(
  provider: Eip1193Provider,
  isUnlocked: () => Promise<boolean>,
): Eip1193Provider {
  return {
    ...provider,
    _metamask: { isUnlocked },
  } as Eip1193Provider;
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}
