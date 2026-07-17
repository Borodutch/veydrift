import { afterEach, describe, expect, test } from "bun:test";
import {
  BASE_MAINNET,
  BASE_SEPOLIA,
  __clearGameApiReadPoolForTests,
  assertWalletUnlocked,
  decodeBoolResult,
  decodeColonizationTargetId,
  decodeUintResult,
  encodeBytes4Call,
  encodeQuantity,
  encodeAddressUintCall,
  encodeAddressCall,
  encodeBurningChickenMoonCall,
  encodeColonizationTargetId,
  encodeGameCall,
  encodeJoinAttackMissionCall,
  encodeLaunchAttackMissionCall,
  encodeLaunchBodyFleetMissionCall,
  encodeLaunchDefenseHoldCall,
  encodeLaunchInterplanetaryMissileAttackCall,
  encodeLaunchFleetMissionCall,
  encodeMigrationClaimWithReferralCall,
  encodeUintCall,
  ensureBaseSepoliaNetwork,
  ensureBaseMainnetNetwork,
  fetchBurningChickenForOwner,
  fetchAllianceState,
  fetchDefenseState,
  fetchFleetMissionArchive,
  fetchFleetMissionVisibility,
  fetchHighscores,
  fetchInfrastructureState,
  fetchMoonState,
  fetchPlayerProfile,
  fetchReferralDashboard,
  fetchResearchState,
  fetchShipyardState,
  fetchWalletPlanets,
  fetchWalletSettlement,
  fetchWalletQueues,
  fetchWatchedPlanets,
  getAvailableWalletProvider,
  getAvailableWalletProviderDetails,
  getChainId,
  getCurrentAccounts,
  getInjectedProvider,
  confirmTransactionReceipt,
  defaultVeydriftChainForLocation,
  ensureVeydriftNetwork,
  farcasterChainFor,
  generateReferralClaimCode,
  isBaseSepoliaChain,
  isTransientWalletBootstrapError,
  isUserRejected,
  isVeydriftChain,
  miniAppUnsupportedChainMessage,
  mergePlayerProfile,
  normalizeReferralClaimCode,
  parseRiftTokenAmount,
  sendApproveResourceTokenTransaction,
  sendDepositResourceTransaction,
  sendFinishResourceWithdrawalTransaction,
  sendCreateColonyTransaction,
  sendJoinAttackMissionTransaction,
  sendLaunchAttackMissionTransaction,
  sendLaunchInterplanetaryMissileAttackTransaction,
  sendLaunchFleetMissionTransaction,
  sendJumpGateJumpTransaction,
  sendRecallFleetMissionTransaction,
  sendAcceptAllianceInviteTransaction,
  sendAllianceBatchKickTransaction,
  sendAllianceBatchRoleTransaction,
  sendAllianceJoinRequestTransaction,
  sendAllianceKickTransaction,
  sendAllianceLeaveTransaction,
  sendAllianceInviteTransaction,
  sendAllianceProfileTransaction,
  sendAllianceRoleTransaction,
  sendAllianceDiplomacyTransaction,
  sendAllianceTransferOwnershipTransaction,
  sendApproveAllianceJoinRequestTransaction,
  sendCancelAllianceJoinRequestTransaction,
  sendCreateAllianceTransaction,
  sendBurningChickenMoonTransaction,
  sendDismissAllianceJoinRequestTransaction,
  sendRequestResourceWithdrawalTransaction,
  sendReferralClaimTransaction,
  requestAccounts,
  referralCodeHash,
  referralCommitment,
  persistReferralClaimIntent,
  recordReferralClaimTransaction,
  requestWatchedPlanetSignature,
  readMigrationReservation,
  sendSettlementTransaction,
  sendStartBuildingUpgradeTransaction,
  sendStartMoonBuildingUpgradeTransaction,
  sendStartDefenseProductionTransaction,
  sendStartResearchTransaction,
  sendStartShipProductionTransaction,
  settlementTransactionData,
  switchBaseSepoliaNetwork,
  veydriftChainForChainId,
  isOnChainRevertError,
  playerProfileMessage,
  updatePlayerProfile,
  unwatchPlanet,
  watchedPlanetMessage,
  watchPlanet,
  WATCHED_PLANETS_API_READ_TIMEOUT_MS,
  waitForBaseSepoliaNetwork,
  waitForVeydriftNetwork,
  walletRecoveryActionMessage,
  walletRequestErrorMessage,
  type Eip1193Provider
} from "./walletFlow";
import { GAME_UNAVAILABLE_MESSAGE } from "./gameUnavailable";

afterEach(() => {
  __clearGameApiReadPoolForTests();
});

const account = "0x1111111111111111111111111111111111111111";
const contract = "0x2222222222222222222222222222222222222222";
const referralRedemption = {
  code: "abcDEF_123-abcDEF_123-abcDEF_123-abcDEF_123",
  commitment: `0x${"aa".repeat(32)}`,
  r: `0x${"bb".repeat(32)}`,
  s: `0x${"cc".repeat(32)}`,
  signature: `0x${"bb".repeat(32)}${"cc".repeat(32)}1b`,
  v: 27,
};

function encodedReferralCall(selector: string): string {
  return selector
    + referralRedemption.commitment.slice(2)
    + referralRedemption.v.toString(16).padStart(64, "0")
    + referralRedemption.r.slice(2)
    + referralRedemption.s.slice(2);
}

function customErrorData(selector: string, args: Array<number | bigint> = []): string {
  return selector + args.map((value) => BigInt(value).toString(16).padStart(64, "0")).join("");
}

function bytes32StringErrorData(selector: string, value: string): string {
  const encoded = [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0");
  return selector + encoded;
}

describe("walletFlow", () => {
  test("classifies Base Sepolia chain ids", () => {
    expect(isBaseSepoliaChain("0x14a34")).toBe(true);
    expect(isBaseSepoliaChain("84532")).toBe(true);
    expect(isBaseSepoliaChain(84532)).toBe(true);
    expect(isBaseSepoliaChain("0x1")).toBe(false);
  });

  test("selects Veydrift wallet chain from host and runtime chain id", () => {
    expect(defaultVeydriftChainForLocation({ hostname: "veydrift.com" })).toBe(BASE_MAINNET);
    expect(defaultVeydriftChainForLocation({ hostname: "www.veydrift.com" })).toBe(BASE_MAINNET);
    expect(defaultVeydriftChainForLocation({ hostname: "test.veydrift.com" })).toBe(BASE_SEPOLIA);
    expect(defaultVeydriftChainForLocation({ hostname: "localhost" })).toBe(BASE_SEPOLIA);
    expect(veydriftChainForChainId(BASE_MAINNET.chainId)).toBe(BASE_MAINNET);
    expect(veydriftChainForChainId(BASE_SEPOLIA.chainId)).toBe(BASE_SEPOLIA);
    expect(farcasterChainFor(BASE_MAINNET)).toBe("eip155:8453");
    expect(farcasterChainFor(BASE_SEPOLIA)).toBe("eip155:84532");
    expect(isVeydriftChain(BASE_MAINNET.chainIdHex, BASE_MAINNET)).toBe(true);
    expect(isVeydriftChain(BASE_SEPOLIA.chainIdHex, BASE_MAINNET)).toBe(false);
  });

  test("encodes Burning Chicken moon burns with token id and planet id", () => {
    expect(encodeBurningChickenMoonCall("0xe1775196", "42", "7")).toBe(
      "0xe1775196"
        + "2a".padStart(64, "0")
        + "7".padStart(64, "0")
    );
  });

  test("encodes ERC-165 bytes4 interface checks", () => {
    expect(encodeBytes4Call("0x01ffc9a7", "0x780e9d63")).toBe(
      "0x01ffc9a7" + "780e9d63".padEnd(64, "0")
    );
  });

  test("verifies a typed Burning Chicken token is owned by the connected wallet", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { params?: Array<{ data?: string }> };
      const data = body.params?.[0]?.data ?? "";
      calls.push(data);
      if (data.startsWith("0x6352211e")) {
        return new Response(JSON.stringify({ result: "0x" + account.toLowerCase().replace(/^0x/, "").padStart(64, "0") }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      if (data.startsWith("0x05c58df2")) {
        return new Response(JSON.stringify({ result: "0x" + "2".padStart(64, "0") }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      return new Response(JSON.stringify({ error: { message: "unexpected call" } }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      await expect(fetchBurningChickenForOwner(account, "91528", {
        burnContractAddress: contract,
        burnSelector: "0xe1775196",
        nftContractAddress: contract,
        rpcUrl: "https://base.example.test",
      })).resolves.toEqual({ tokenId: "91528" });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls.some((data) => data.startsWith("0x6352211e"))).toBe(true);
    expect(calls.some((data) => data.startsWith("0x05c58df2"))).toBe(false);
    expect(calls.some((data) => data.startsWith("0x2f745c59"))).toBe(false);
    expect(calls.some((data) => data.startsWith("https://base.blockscout.com/"))).toBe(false);
  });

  test("rejects a typed Burning Chicken token owned by another wallet", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { params?: Array<{ data?: string }> };
      const data = body.params?.[0]?.data ?? "";
      if (data.startsWith("0x6352211e")) {
        return new Response(JSON.stringify({ result: "0x" + "9999999999999999999999999999999999999999".padStart(64, "0") }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      return new Response(JSON.stringify({ error: { message: "unexpected call" } }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      await expect(fetchBurningChickenForOwner(account, "91528", {
        burnContractAddress: contract,
        burnSelector: "0xe1775196",
        nftContractAddress: contract,
        rpcUrl: "https://base.example.test",
      })).rejects.toThrow("Chicken #91528 is not owned by the connected wallet.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("switches to Base mainnet and sends Burning Chicken moon burn transactions", async () => {
    const requests: Array<{ method: string; params?: unknown[] }> = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push(params === undefined ? { method } : { method, params });
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "eth_sendTransaction") return "0xchicken";
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(sendBurningChickenMoonTransaction(provider, account, {
      burnContractAddress: "0x3333333333333333333333333333333333333333",
      burnSelector: "0xe1775196",
      nftContractAddress: "0x4444444444444444444444444444444444444444",
    }, "42", "7")).resolves.toBe("0xchicken");

    expect(requests).toEqual([
      { method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] },
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: "0x3333333333333333333333333333333333333333",
          data: encodeBurningChickenMoonCall("0xe1775196", "42", "7"),
        }],
      },
    ]);
  });

  test("adds Base mainnet when the wallet does not recognize it", async () => {
    const requests: Array<{ method: string; params?: unknown[] }> = [];
    let switched = false;
    const provider = mockProvider(async ({ method, params }) => {
      requests.push(params === undefined ? { method } : { method, params });
      if (method === "wallet_switchEthereumChain") {
        if (!switched) {
          switched = true;
          throw { code: 4902, message: "unknown chain" };
        }
        return null;
      }
      if (method === "wallet_addEthereumChain") return null;
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(ensureBaseMainnetNetwork(provider)).resolves.toBeUndefined();
    expect(requests.map((request) => request.method)).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ]);
  });

  test("detects rejected wallet requests", () => {
    expect(isUserRejected({ code: 4001 })).toBe(true);
    expect(isUserRejected({ message: "User denied transaction signature" })).toBe(true);
    expect(isUserRejected({ code: -32603 })).toBe(false);
  });

  test("throws when a submitted transaction receipt is reverted", async () => {
    const provider = mockProvider(async ({ method, params }) => {
      expect(method).toBe("eth_getTransactionReceipt");
      expect(params).toEqual(["0xreverted"]);
      return { status: "0x0", transactionHash: "0xreverted" };
    });

    await expect(confirmTransactionReceipt(provider, "0xreverted")).rejects.toThrow(
      "Transaction reverted on-chain. No game state was changed."
    );
  });

  test("resolves only after a submitted transaction receipt is mined successfully", async () => {
    let polls = 0;
    const provider = mockProvider(async () => {
      polls += 1;
      return polls === 1 ? null : { status: "0x1", transactionHash: "0xok" };
    });

    await expect(confirmTransactionReceipt(provider, "0xok", { pollMs: 1, timeoutMs: 100 })).resolves.toMatchObject({
      status: "0x1",
      transactionHash: "0xok"
    });
    expect(polls).toBe(2);
  });

  test("classifies stalled bootstrap wallet reads as transient and retryable", () => {
    expect(isTransientWalletBootstrapError(
      new Error("Timed out reading wallet accounts from the wallet after 6 seconds.")
    )).toBe(true);
    expect(isTransientWalletBootstrapError(
      new Error("Timed out reading wallet network from the wallet after 6 seconds.")
    )).toBe(true);
    expect(isTransientWalletBootstrapError({ code: -32603, message: "Internal JSON-RPC error." })).toBe(true);
    expect(isTransientWalletBootstrapError(new Error("Failed to fetch"))).toBe(true);
  });

  test("does not retry bootstrap on user rejection or a locked wallet", () => {
    expect(isTransientWalletBootstrapError({ code: 4001, message: "User rejected the request." })).toBe(false);
    expect(isTransientWalletBootstrapError(
      new Error("Wallet is locked. Please unlock your wallet and try again.")
    )).toBe(false);
    expect(isTransientWalletBootstrapError(new Error("Settlement state is unavailable because the game API is not configured."))).toBe(false);
  });

  test("applies a custom shorter timeout to bootstrap account and chain reads", async () => {
    const stalledProvider = mockProvider(async () => {
      await new Promise(() => {}); // never resolves
      return [];
    });
    await expect(getCurrentAccounts(stalledProvider, 30)).rejects.toThrow(/timed out reading wallet accounts/i);
    await expect(getChainId(stalledProvider, 30)).rejects.toThrow(/timed out reading wallet network/i);
  });

  test("keeps polling when a receipt read transiently fails before the transaction is mined", async () => {
    let polls = 0;
    const provider = mockProvider(async () => {
      polls += 1;
      if (polls === 1) throw { code: -32603, message: "Internal JSON-RPC error." };
      if (polls === 2) return null;
      return { status: "0x1", transactionHash: "0xok" };
    });

    await expect(confirmTransactionReceipt(provider, "0xok", { pollMs: 1, timeoutMs: 200 })).resolves.toMatchObject({
      status: "0x1",
      transactionHash: "0xok",
    });
    expect(polls).toBe(3);
  });

  test("reports a benign timeout when receipt reads keep failing after submission", async () => {
    const provider = mockProvider(async () => {
      throw { code: -32603, message: "Internal JSON-RPC error." };
    });

    await expect(confirmTransactionReceipt(provider, "0xok", { pollMs: 1, timeoutMs: 20 })).rejects.toThrow(
      "Transaction submitted, but the chain did not confirm it yet"
    );
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

  test("prefers the Farcaster SDK wallet provider when Mini App mode requests it", async () => {
    const provider = mockProvider(async () => null);
    const miniAppProvider = mockProvider(async () => null);

    await expect(getAvailableWalletProvider({ ethereum: provider }, {
      wallet: {
        getEthereumProvider: () => miniAppProvider,
      },
    }, { preferFarcasterProvider: true })).resolves.toBe(miniAppProvider);
    await expect(getAvailableWalletProviderDetails({ ethereum: provider }, {
      wallet: {
        getEthereumProvider: () => miniAppProvider,
      },
    }, { preferFarcasterProvider: true })).resolves.toEqual({
      provider: miniAppProvider,
      source: "farcaster",
    });
    await expect(getAvailableWalletProviderDetails({ ethereum: provider }, {
      wallet: {
        getEthereumProvider: () => undefined,
      },
    }, { preferFarcasterProvider: true })).resolves.toEqual({
      provider,
      source: "injected",
    });
  });

  test("requires a real Farcaster Mini App host before using the SDK wallet provider", async () => {
    const miniAppProvider = mockProvider(async () => null);

    await expect(getAvailableWalletProvider({}, {
      isInMiniApp: async () => false,
      wallet: {
        getEthereumProvider: () => miniAppProvider,
      },
    }, { preferFarcasterProvider: true })).resolves.toBeUndefined();

    await expect(getAvailableWalletProvider({}, {
      isInMiniApp: async () => true,
      wallet: {
        getEthereumProvider: () => miniAppProvider,
      },
    }, { preferFarcasterProvider: true })).resolves.toBe(miniAppProvider);

    await expect(getAvailableWalletProvider({}, {
      isInMiniApp: async () => {
        throw new Error("host unavailable");
      },
      wallet: {
        getEthereumProvider: () => miniAppProvider,
      },
    }, { preferFarcasterProvider: true })).resolves.toBeUndefined();
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

  test("falls back to the legacy Farcaster ethProvider when getEthereumProvider is unavailable", async () => {
    const miniAppProvider = mockProvider(async () => null);

    await expect(getAvailableWalletProviderDetails({}, {
      wallet: {
        ethProvider: miniAppProvider,
        getEthereumProvider: () => undefined,
      },
    })).resolves.toEqual({
      provider: miniAppProvider,
      source: "farcaster",
    });

    await expect(getAvailableWalletProviderDetails({}, {
      wallet: {
        ethProvider: miniAppProvider,
        getEthereumProvider: () => {
          throw new Error("capability probe failed");
        },
      },
    })).resolves.toEqual({
      provider: miniAppProvider,
      source: "farcaster",
    });

    await expect(getAvailableWalletProviderDetails({}, {
      wallet: {
        ethProvider: { notAProvider: true } as unknown as Eip1193Provider,
        getEthereumProvider: () => undefined,
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

  test("reports an unavailable account when wallet authorization returns no account", async () => {
    await expect(requestAccounts(mockProvider(async ({ method }) => {
      if (method === "eth_requestAccounts") return [];
      throw new Error(`Unexpected wallet method ${method}`);
    }))).rejects.toThrow("Wallet account is unavailable. Reconnect your wallet, then retry.");
  });

  test("bounds Farcaster provider and account authorization requests", async () => {
    const source = await Bun.file(new URL("./walletFlow.ts", import.meta.url)).text();

    expect(source).toContain("FARCASTER_WALLET_PROVIDER_TIMEOUT_MS");
    expect(source).toContain("\"wallet provider\"");
    expect(source).toContain("method: \"eth_requestAccounts\"");
    expect(source).toContain("\"wallet account authorization\"");
    expect(source).not.toContain("const accounts = await provider.request<string[]>({\n    method: \"eth_requestAccounts\"");
  });

  test("keeps a known commander name over fallback-only profile refreshes for the same wallet", () => {
    expect(mergePlayerProfile({
      wallet: account,
      displayName: "Nova Prime",
      description: "Diplomacy open.",
      fallbackName: "0x1111...1111",
      updatedAt: "2026-06-02T00:00:00.000Z"
    }, {
      wallet: account.toUpperCase(),
      displayName: null,
      description: null,
      fallbackName: "0x1111...1111",
      updatedAt: null
    })).toEqual({
      wallet: account.toUpperCase(),
      displayName: "Nova Prime",
      description: "Diplomacy open.",
      fallbackName: "0x1111...1111",
      updatedAt: "2026-06-02T00:00:00.000Z"
    });
  });

  test("allows unnamed commander fallback when no display name is known", () => {
    expect(mergePlayerProfile(undefined, {
      wallet: account,
      displayName: null,
      description: null,
      fallbackName: "0x1111...1111",
      updatedAt: null
    })).toEqual({
      wallet: account,
      displayName: null,
      description: null,
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
    // VEY-KANEO-463: no preflight eth_call — the launch goes straight to eth_sendTransaction.
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

  // VEY-KANEO-463: no preflight eth_call — contract reverts surface from the eth_sendTransaction
  // error path instead (the wallet simulates before signing; the same revert decoding applies).
  test("reports missing colony ships from the colonize send revert", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_sendTransaction") {
        throw {
          code: 3,
          message: "execution reverted",
          data: customErrorData("0x705f508b", [3, 0, 1]),
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(sendCreateColonyTransaction(provider, account, contract, "7", 2, 44, 10, 40))
      .rejects.toThrow("Build or keep a Colony Ship");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeLaunchFleetMissionCall({
            originPlanetId: "7",
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
          }),
        }],
      },
    ]);
  });

  test("reports occupied Galaxy colony slots from the send revert", async () => {
    const provider = mockProvider(async ({ method }) => {
      if (method === "eth_sendTransaction") {
        throw { code: 3, message: "execution reverted", data: "0x13b7fff2" };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(sendCreateColonyTransaction(provider, account, contract, "7", 2, 44, 10, 40))
      .rejects.toThrow("This position is already occupied");
  });

  test("reports stale ship counts from the attack launch send revert", async () => {
    const ships = {
      smallCargo: 4,
      lightFighter: 4,
      recycler: 0,
      colonyShip: 0,
      largeCargo: 0,
      heavyFighter: 1,
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
      if (method === "eth_sendTransaction") {
        throw { code: 3, message: "execution reverted", data: customErrorData("0x705f508b", [0, 3, 4]) };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(sendLaunchAttackMissionTransaction(provider, account, contract, {
      originPlanetId: 7,
      targetPlanetId: 9,
      ships,
      speedPercent: 100,
      lootRatio: { metalBps: 3400, crystalBps: 3300, deuteriumBps: 3300 },
    })).rejects.toThrow("Need 4 Small Cargo, only 3 available on the origin planet");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeLaunchAttackMissionCall({
            originPlanetId: 7,
            targetPlanetId: 9,
            ships,
            speedPercent: 100,
            lootRatio: { metalBps: 3400, crystalBps: 3300, deuteriumBps: 3300 },
          }),
        }],
      },
    ]);
  });

  test("reports cargo capacity failures from the fleet launch send revert", async () => {
    const ships = {
      smallCargo: 0,
      lightFighter: 1,
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
      if (method === "eth_sendTransaction") {
        throw { code: 3, message: "execution reverted", data: "0xd7c35576" };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(sendLaunchFleetMissionTransaction(provider, account, contract, {
      originPlanetId: 1,
      targetPlanetId: 6,
      missionType: 3,
      ships,
    })).rejects.toThrow("selected ships do not have enough cargo capacity");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeLaunchFleetMissionCall({
            originPlanetId: 1,
            targetPlanetId: 6,
            missionType: 3,
            ships,
          }),
        }],
      },
    ]);
  });

  test("submits fleet launches straight to the wallet without a preflight read", async () => {
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
    const data = encodeLaunchFleetMissionCall({
      originPlanetId: 7,
      targetPlanetId: 9,
      missionType: 3,
      ships,
    });
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_sendTransaction") return "0xfleet";
      throw new Error(`Unexpected method ${method}`);
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
        params: [{ from: account, to: contract, data }],
      },
    ]);
  });

  test("decodes nested RPC revert data when fleet launch send returns -32603", async () => {
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
    const data = encodeLaunchFleetMissionCall({
      originPlanetId: 7,
      targetPlanetId: 9,
      missionType: 3,
      ships,
    });
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_sendTransaction") {
        throw {
          code: -32603,
          message: "Internal JSON-RPC error.",
          data: {
            originalError: {
              code: 3,
              message: "execution reverted",
              data: "0x705f508b",
            },
          },
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(sendLaunchFleetMissionTransaction(provider, account, contract, {
      originPlanetId: 7,
      targetPlanetId: 9,
      missionType: 3,
      ships,
    })).rejects.toThrow("Selected origin planet does not have the requested ships");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [{ from: account, to: contract, data }],
      },
    ]);
  });

  test("decodes nested RPC revert data for mission action sends without launch preflight", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_sendTransaction") {
        throw {
          code: -32603,
          message: "Internal JSON-RPC error.",
          data: {
            error: {
              code: 3,
              data: "0xa8d5807a",
              message: "execution reverted",
            },
          },
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(
      sendRecallFleetMissionTransaction(provider, account, contract, "42")
    ).rejects.toThrow("This fleet has not arrived yet");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeGameCall("0x1cbc460c", ["42"]),
        }],
      },
    ]);
  });

  test("still surfaces a generic rejection when the fleet launch send reverts without a known selector", async () => {
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
    const provider = mockProvider(async ({ method }) => {
      if (method === "eth_sendTransaction") {
        throw { code: 3, message: "execution reverted", data: "0xdeadbeef" };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(sendLaunchFleetMissionTransaction(provider, account, contract, {
      originPlanetId: 7,
      targetPlanetId: 9,
      missionType: 3,
      ships,
    })).rejects.toThrow("rejected this transaction");
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

  test("encodes moon body transport missions with body flags in contract ABI order", () => {
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

    expect(encodeLaunchBodyFleetMissionCall({
      originPlanetId: 7,
      targetPlanetId: 9,
      missionType: 0,
      ships,
      cargo: {
        metal: "101",
        crystal: "202",
        deuterium: "303",
      },
      speedPercent: 50,
      originIsMoon: true,
      targetIsMoon: false,
    })).toBe(
      "0x0d0a9b08"
        + [
          7, 9, 0,
          1, 2, 3, 4, 5, 6, 7,
          8, 9, 10, 11, 12, 13, 14,
          101, 202, 303, 50, 1, 0,
        ].map((value) => BigInt(value).toString(16).padStart(64, "0")).join("")
    );
  });

  test("VEY-KANEO-440/441: encodes a DefenseHold launch in contract ABI order (no missionType, holdSeconds last)", () => {
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

    expect(encodeLaunchDefenseHoldCall({
      originPlanetId: 7,
      targetPlanetId: 9,
      ships,
      cargo: { metal: "101", crystal: "202", deuterium: "303" },
      speedPercent: 50,
      holdSeconds: 3600,
    })).toBe(
      "0xd3ad415f"
        + [
          7, 9,
          1, 2, 3, 4, 5, 6, 7,
          8, 9, 10, 11, 12, 13, 14,
          101, 202, 303, 50, 3600,
        ].map((value) => BigInt(value).toString(16).padStart(64, "0")).join("")
    );
  });

  test("encodes a loot-ratio attack mission in contract ABI order", () => {
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

    expect(encodeLaunchAttackMissionCall({
      originPlanetId: 7,
      targetPlanetId: 9,
      ships,
      speedPercent: 50,
      randomnessRequestId: 404,
      lootRatio: { metalBps: 2000, crystalBps: 4000, deuteriumBps: 4000 },
    })).toBe(
      "0x19fec22b"
        + [
          7, 9,
          1, 2, 3, 4, 5, 6, 7,
          8, 9, 10, 11, 12, 13, 14,
          0, 0, 0, 50, 404,
          2000, 4000, 4000,
        ].map((value) => BigInt(value).toString(16).padStart(64, "0")).join("")
    );
  });

  test("rejects an attack loot ratio that does not total 100%", () => {
    const ships = {
      smallCargo: 0,
      lightFighter: 1,
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
    expect(() => encodeLaunchAttackMissionCall({
      originPlanetId: 7,
      targetPlanetId: 9,
      ships,
      lootRatio: { metalBps: 2000, crystalBps: 4000, deuteriumBps: 3000 },
    })).toThrow("Loot ratio must total 100%.");
  });

  test("encodes the fleet recall transaction", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return `0xfleet${requests.length}`;
    });

    await expect(sendRecallFleetMissionTransaction(provider, account, contract, "11")).resolves.toBe("0xfleet1");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: contract,
          data: encodeGameCall("0x1cbc460c", ["11"]),
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

  test("switches Farcaster Mini App wallets without adding Base Sepolia", async () => {
    const calls: string[] = [];
    const provider = mockProvider(async ({ method }) => {
      calls.push(method);
      if (method === "wallet_switchEthereumChain") {
        throw { code: 4902, message: "Unrecognized chain" };
      }
      return null;
    });

    await expect(switchBaseSepoliaNetwork(provider)).rejects.toMatchObject({ code: 4902 });
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

  test("adds Base mainnet when the wallet does not know the production chain", async () => {
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

    await ensureVeydriftNetwork(provider, BASE_MAINNET);

    expect(calls).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ]);
    expect(params).toEqual([BASE_MAINNET]);
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

  test("waits for Rabby mobile to report Base Sepolia after a successful switch", async () => {
    const chainReads = ["0x1", BASE_SEPOLIA.chainIdHex];
    const calls: string[] = [];
    const provider = mockProvider(async ({ method }) => {
      calls.push(method);
      if (method === "eth_chainId") {
        return chainReads.shift() ?? BASE_SEPOLIA.chainIdHex;
      }
      return null;
    });

    await ensureBaseSepoliaNetwork(provider);
    await expect(waitForBaseSepoliaNetwork(provider, { attempts: 2, intervalMs: 0 })).resolves.toBe(BASE_SEPOLIA.chainIdHex);

    expect(calls).toEqual([
      "wallet_switchEthereumChain",
      "eth_chainId",
      "eth_chainId",
    ]);
  });

  test("waits for Base mainnet after a successful production switch", async () => {
    const chainReads = [BASE_SEPOLIA.chainIdHex, BASE_MAINNET.chainIdHex];
    const calls: string[] = [];
    const provider = mockProvider(async ({ method }) => {
      calls.push(method);
      if (method === "eth_chainId") {
        return chainReads.shift() ?? BASE_MAINNET.chainIdHex;
      }
      return null;
    });

    await ensureBaseMainnetNetwork(provider);
    await expect(waitForVeydriftNetwork(provider, BASE_MAINNET, { attempts: 2, intervalMs: 0 })).resolves.toBe(BASE_MAINNET.chainIdHex);

    expect(calls).toEqual([
      "wallet_switchEthereumChain",
      "eth_chainId",
      "eth_chainId",
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
    expect(message).toContain("ask your wallet to switch or add Base Sepolia");
    expect(message).toContain("wallet rejects that request");
    expect(message).toContain("browser wallet flow");
  });

  test("formats raw JSON-RPC provider errors into an actionable wallet message", () => {
    expect(walletRequestErrorMessage({ code: -32603, message: "Internal JSON-RPC error." })).toBe(GAME_UNAVAILABLE_MESSAGE);
    expect(walletRequestErrorMessage({ message: "execution reverted", data: customErrorData("0x2ab0f96f", [0, 0, 0]) }))
      .toContain("indexed spendable balance");
    expect(walletRequestErrorMessage({ message: "execution reverted", data: "0x13b7fff2" }))
      .toContain("position is already occupied");
    expect(walletRequestErrorMessage({ message: "execution reverted", data: "0x791438b6" }))
      .toContain("colony limit");
    expect(walletRequestErrorMessage({ message: "execution reverted", data: "0x57aab7e3" }))
      .toContain("Computer");
    expect(walletRequestErrorMessage({ message: "execution reverted", data: bytes32StringErrorData("0xb8f7e9ba", "RESEARCH_LAB_6") }))
      .toContain("Research Lab 6 is required");
    expect(walletRequestErrorMessage({ message: "execution reverted", data: "0xcc9beebc" }))
      .toContain("Another queue is already active");
    expect(walletRequestErrorMessage(new Error("execution reverted"))).not.toContain("indexed spendable balance");
    expect(walletRequestErrorMessage(new Error("execution reverted"))).not.toContain("reconnect your wallet");
    expect(walletRequestErrorMessage(new Error("Timed out reading wallet accounts from the wallet after 10 seconds."))).toContain(
      "Unlock or reconnect your wallet"
    );
    expect(walletRequestErrorMessage(new Error("Timed out reading settlement from the game API after 10 seconds."))).toContain(
      "Servers are unavailable"
    );
    expect(walletRequestErrorMessage(new Error("Timed out reading settlement from the game API after 10 seconds."))).not.toContain(
      "sync resumes"
    );
    expect(walletRequestErrorMessage(new Error("MetaMask is locked"))).toBe(
      "Wallet is locked. Please unlock your wallet and try again."
    );
    expect(walletRecoveryActionMessage("Timed out reading wallet accounts from the wallet after 10 seconds.")).toBe(
      "Wallet needs attention. Unlock or reconnect your wallet, return to Veydrift, then retry."
    );
    expect(walletRecoveryActionMessage("No VeydriftGame home planet was found for this wallet.")).toBeUndefined();
  });

  test("detects on-chain reverts wrapped in an internal JSON-RPC error", () => {
    // Genuine reverts: nested revert code, nested execution-reverted message,
    // and revert data selectors.
    expect(isOnChainRevertError({
      code: -32603,
      message: "Internal JSON-RPC error.",
      data: { originalError: { code: 3, message: "execution reverted" } },
    })).toBe(true);
    expect(isOnChainRevertError({
      code: -32603,
      message: "Internal JSON-RPC error.",
      data: { originalError: { message: "execution reverted", data: "0x65dba1c3" } },
    })).toBe(true);
    expect(isOnChainRevertError(new Error("execution reverted"))).toBe(true);
    expect(isOnChainRevertError({ code: 3, message: "execution reverted" })).toBe(true);

    // Not reverts: bare internal JSON-RPC error and ordinary transport failures.
    expect(isOnChainRevertError({ code: -32603, message: "Internal JSON-RPC error." })).toBe(false);
    expect(isOnChainRevertError(new Error("Failed to fetch"))).toBe(false);
  });

  test("labels a no-reason -32603-wrapped revert as a contract rejection, not RPC unavailability", () => {
    expect(walletRequestErrorMessage({
      code: -32603,
      message: "Internal JSON-RPC error.",
      data: { originalError: { code: 3, message: "execution reverted" } },
    })).toBe(
      "The game contract rejected this transaction, but the wallet did not provide a specific reason. Refresh game state and retry, or choose a different action if the state changed."
    );

    // A bare -32603 with no revert markers stays in the server-unavailable bucket.
    expect(walletRequestErrorMessage({ code: -32603, message: "Internal JSON-RPC error." })).toBe(GAME_UNAVAILABLE_MESSAGE);
  });

  test("surfaces a contract-rejection message when a mission send reverts without a decodable reason", async () => {
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
      if (method === "eth_sendTransaction") {
        // A genuine on-chain revert with no decodable reason (no selector data),
        // wrapped in an internal JSON-RPC error.
        throw {
          code: -32603,
          message: "Internal JSON-RPC error.",
          data: { originalError: { code: 3, message: "execution reverted" } },
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(sendLaunchFleetMissionTransaction(provider, account, contract, {
      originPlanetId: 7,
      targetPlanetId: 9,
      missionType: 3,
      ships,
    })).rejects.toThrow("the wallet did not provide a specific reason");

    expect(requests.some((request) => (request as { method: string }).method === "eth_sendTransaction")).toBe(true);
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

  test("submits migration claims to the migration contract for the normal start price", async () => {
    const migrationContract = "0x3333333333333333333333333333333333333333";
    const statePayload = "0x1234";
    const signature = "0xabcd";
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return "0xabc";
    });

    await expect(
      sendSettlementTransaction(provider, account, { address: contract }, {
        migrationClaim: { statePayload, signature },
        migrationContractAddress: migrationContract,
        startPriceWei: 50_000_000_000_000_000n,
      })
    ).resolves.toBe("0xabc");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: migrationContract,
            data: "0xbe27b22c"
              + "40".padStart(64, "0")
              + "80".padStart(64, "0")
              + "2".padStart(64, "0")
              + "1234".padEnd(64, "0")
              + "2".padStart(64, "0")
              + "abcd".padEnd(64, "0"),
            value: "0xb1a2bc2ec50000"
          }
        ]
      }
    ]);
  });

  test("submits referral-aware migration claims for authorized first-planet starts", async () => {
    const migrationContract = "0x3333333333333333333333333333333333333333";
    const statePayload = "0x1234";
    const signature = "0xabcd";
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return "0xabc";
    });

    await expect(
      sendSettlementTransaction(provider, account, { address: contract }, {
        migrationClaim: { statePayload, signature },
        migrationContractAddress: migrationContract,
        referral: referralRedemption,
        startPriceWei: 50_000_000_000_000_000n,
      })
    ).resolves.toBe("0xabc");

    expect(requests).toEqual([{
      method: "eth_sendTransaction",
      params: [{
        from: account,
        to: migrationContract,
        data: encodeMigrationClaimWithReferralCall(statePayload, signature, referralRedemption),
        value: "0xb1a2bc2ec50000"
      }]
    }]);
    expect((requests[0] as { params: Array<{ data: string }> }).params[0]?.data.slice(0, 10))
      .toBe("0x98bf164a");
  });

  test("submits a value-bearing VeydriftGame startPlanetWithReferral transaction", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return "0xabc";
    });

    await expect(
      sendSettlementTransaction(provider, account, { address: contract }, {
        referral: referralRedemption,
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
            data: encodedReferralCall("0xdad57ff9"),
            value: "0xb1a2bc2ec50000"
          }
        ]
      }
    ]);
  });

  test("normalizes and ABI-encodes editable referral codes for the canonical string claim", async () => {
    const referralSystem = "0x3333333333333333333333333333333333333333";
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return "0xclaim";
    });

    expect(normalizeReferralClaimCode(" My_Code-1 ")).toBe("my_code-1");
    expect(() => normalizeReferralClaimCode("")).toThrow("1–24");
    expect(() => normalizeReferralClaimCode("abcdefghijklmnopqrstuvwxy")).toThrow("1–24");
    await expect(sendReferralClaimTransaction(provider, account, {
      address: contract,
      referralSystemAddress: referralSystem
    }, "My_Code-1")).resolves.toBe("0xclaim");

    expect(requests).toEqual([{
      method: "eth_sendTransaction",
      params: [{
        from: account,
        to: referralSystem,
        data: "0x03b52c94"
          + "20".padStart(64, "0")
          + "9".padStart(64, "0")
          + "6d795f636f64652d31".padEnd(64, "0")
      }]
    }]);
  });

  test("rejects migration claims before the signed state snapshot is ready", async () => {
    const migrationContract = "0x3333333333333333333333333333333333333333";
    const provider = mockProvider(async () => {
      throw new Error("transaction should not be sent");
    });

    await expect(
      sendSettlementTransaction(provider, account, { address: contract }, {
        migrationContractAddress: migrationContract,
        startPriceWei: 50_000_000_000_000_000n,
      })
    ).rejects.toThrow("Migration state snapshot is not ready for this wallet yet.");
  });

  test("reads an unclaimed migration reservation for the connected wallet", async () => {
    const migrationContract = "0x3333333333333333333333333333333333333333";
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return `0x${[
        1n,
        0n,
        2n,
        99n,
        7n,
        211n,
        BigInt.asUintN(256, -14n),
      ].map(word).join("")}`;
    });

    await expect(readMigrationReservation(provider, migrationContract, account)).resolves.toEqual({
      claimed: false,
      exists: true,
      fields: 211,
      galaxy: 2,
      position: 7,
      system: 99,
      temperature: -14,
    });

    expect(requests).toEqual([
      {
        method: "eth_call",
        params: [
          {
            to: migrationContract,
            data: `0xcd48c907${account.replace(/^0x/, "").padStart(64, "0")}`,
          },
          "latest",
        ],
      },
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

  test("submits legacy settleFirstPlanetWithReferral when backend reports no game start price", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      return "0xabc";
    });

    await expect(
      sendSettlementTransaction(provider, account, { address: contract }, {
        referral: referralRedemption,
        startPriceWei: null
      })
    ).resolves.toBe("0xabc");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: encodedReferralCall("0x2f7a1ec2")
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
      sentTransactions += 1;
      return `0xtx${sentTransactions}`;
    });

    await expect(
      sendStartBuildingUpgradeTransaction(provider, account, contract, "7", 0)
    ).resolves.toBe("0xtx1");
    await expect(
      sendStartShipProductionTransaction(provider, account, contract, "7", 0, 3)
    ).resolves.toBe("0xtx2");
    await expect(
      sendStartDefenseProductionTransaction(provider, account, contract, "7", 0, 2)
    ).resolves.toBe("0xtx3");

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
            data: encodeGameCall("0xfec06283", [7, 0, 2])
          }
        ]
      }
    ]);
  });

  test("submits building start transactions without gas-estimate preflight reads", async () => {
    const requests: unknown[] = [];
    const provider = mockProvider(async ({ method, params }) => {
      requests.push({ method, params });
      if (method === "eth_sendTransaction") return "0xstart";
      throw new Error(`unexpected ${method}`);
    });

    await expect(
      sendStartBuildingUpgradeTransaction(provider, account, contract, "7", 5)
    ).resolves.toBe("0xstart");

    expect(requests).toEqual([
      {
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: contract,
            data: encodeGameCall("0x165715e3", [7, 5])
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
      () => sendStartDefenseProductionTransaction(walletProvider, account, contract, "7", 0, 2),
      () => sendStartResearchTransaction(walletProvider, account, contract, "7", 12),
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
    await expect(sendJumpGateJumpTransaction(provider, account, contract, "7", "9")).resolves.toBe("0xmoon2");
    await expect(sendJumpGateJumpTransaction(provider, account, contract, "7", "9", ships)).resolves.toBe("0xmoon3");

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
      sendAllianceBatchKickTransaction(provider, account, contract, "1", [
        "0x3333333333333333333333333333333333333333",
        "0x4444444444444444444444444444444444444444",
      ])
    ).resolves.toBe("0xalliance5");
    await expect(
      sendAllianceRoleTransaction(provider, account, contract, "1", "0x3333333333333333333333333333333333333333", "officer")
    ).resolves.toBe("0xalliance6");
    await expect(
      sendAllianceBatchRoleTransaction(provider, account, contract, "1", [
        "0x3333333333333333333333333333333333333333",
        "0x4444444444444444444444444444444444444444",
      ], "officer")
    ).resolves.toBe("0xalliance7");
    await expect(
      sendAllianceProfileTransaction(provider, account, contract, "1", "VDF", "Veydrift Directorate", "Line 1\nLine 2")
    ).resolves.toBe("0xalliance8");
    await expect(
      sendAllianceJoinRequestTransaction(provider, account, contract, "1")
    ).resolves.toBe("0xalliance9");
    await expect(
      sendCancelAllianceJoinRequestTransaction(provider, account, contract, "1")
    ).resolves.toBe("0xalliance10");
    await expect(
      sendApproveAllianceJoinRequestTransaction(provider, account, contract, "1", "0x3333333333333333333333333333333333333333")
    ).resolves.toBe("0xalliance11");
    await expect(
      sendDismissAllianceJoinRequestTransaction(provider, account, contract, "1", "0x3333333333333333333333333333333333333333")
    ).resolves.toBe("0xalliance12");
    await expect(
      sendAllianceLeaveTransaction(provider, account, contract)
    ).resolves.toBe("0xalliance13");
    await expect(
      sendAllianceTransferOwnershipTransaction(provider, account, contract, "1", "0x3333333333333333333333333333333333333333")
    ).resolves.toBe("0xalliance14");
    await expect(
      sendAllianceDiplomacyTransaction(provider, account, contract, "1", "2", "war")
    ).resolves.toBe("0xalliance15");

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
          data: `0x7c581707${"1".padStart(64, "0")}${"40".padStart(64, "0")}${"2".padStart(64, "0")}${"3333333333333333333333333333333333333333".padStart(64, "0")}${"4444444444444444444444444444444444444444".padStart(64, "0")}`
        }
      ]
    });
    expect(requests[5]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: `0xbfbb73f1${"1".padStart(64, "0")}${"3333333333333333333333333333333333333333".padStart(64, "0")}${"2".padStart(64, "0")}`
        }
      ]
    });
    expect(requests[6]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: `0xe0c22e19${"1".padStart(64, "0")}${"60".padStart(64, "0")}${"2".padStart(64, "0")}${"2".padStart(64, "0")}${"3333333333333333333333333333333333333333".padStart(64, "0")}${"4444444444444444444444444444444444444444".padStart(64, "0")}`
        }
      ]
    });
    expect((requests[7] as { params: Array<{ data: string }> }).params[0]?.data.startsWith(
      `0x3fd0e7a5${"1".padStart(64, "0")}`
    )).toBe(true);
    expect(requests[8]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: encodeUintCall("0xbc46277a", 1)
        }
      ]
    });
    expect(requests[9]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: encodeUintCall("0xc5c4bdcc", 1)
        }
      ]
    });
    expect(requests[10]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: `0x8ff388c7${"1".padStart(64, "0")}${"3333333333333333333333333333333333333333".padStart(64, "0")}`
        }
      ]
    });
    expect(requests[11]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: `0xcd844a18${"1".padStart(64, "0")}${"3333333333333333333333333333333333333333".padStart(64, "0")}`
        }
      ]
    });
    expect(requests[12]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: "0xdabd761d"
        }
      ]
    });
    expect(requests[13]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: `0xb1d3b1e4${"1".padStart(64, "0")}${"3333333333333333333333333333333333333333".padStart(64, "0")}`
        }
      ]
    });
    expect(requests[14]).toEqual({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: contract,
          data: encodeGameCall("0x63b9e8f8", [1, 2, 3])
        }
      ]
    });
  });

  test("fetches dynamic wallet state without browser cache and pools duplicate burst reads", async () => {
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
      await fetchFleetMissionVisibility("https://api.example.test", account, { includeArchive: false });
      await fetchFleetMissionArchive("https://api.example.test", account, { page: 2, pageSize: 25 });
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
        url: `https://api.example.test/wallet/${account}/fleet-visibility`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/fleet-visibility?archive=none`,
        init: {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: true,
        },
      },
      {
        url: `https://api.example.test/wallet/${account}/missions?status=completed&page=2&pageSize=25`,
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
    expect(calls.map((call) => new URL(call.url).searchParams.has("source"))).not.toContain(true);
  });

  test("limits distinct game API reads while still pooling duplicate URLs", async () => {
    const originalFetch = globalThis.fetch;
    let active = 0;
    let maxActive = 0;
    let calls = 0;

    globalThis.fetch = (async () => {
      active += 1;
      calls += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      await Promise.all([
        fetchWalletSettlement("https://api.example.test", account),
        fetchWalletSettlement("https://api.example.test", account),
        fetchWalletPlanets("https://api.example.test", account),
        fetchWalletQueues("https://api.example.test", account),
        fetchInfrastructureState("https://api.example.test", account, "1"),
        fetchMoonState("https://api.example.test", account, "1"),
        fetchResearchState("https://api.example.test", account, "1"),
        fetchFleetMissionVisibility("https://api.example.test", account),
        fetchFleetMissionVisibility("https://api.example.test", account, { includeArchive: false }),
        fetchShipyardState("https://api.example.test", account, "1"),
        fetchDefenseState("https://api.example.test", account, "1"),
      ]);

      expect(calls).toBe(10);
      expect(maxActive).toBeLessThanOrEqual(3);

      const followUp = fetchResearchState("https://api.example.test", account, "2");
      const followUpCompleted = await Promise.race([
        followUp.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20)),
      ]);
      expect(followUpCompleted).toBe(true);
      if (followUpCompleted) await followUp;
    } finally {
      globalThis.fetch = originalFetch;
    }
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
      let error: unknown;
      try {
        await fetchInfrastructureState("https://api.example.test", account, "7");
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toBe(GAME_UNAVAILABLE_MESSAGE);
      expect(message).not.toMatch(/Wallet|Settlement API|last known game state|CORS|deployment|browser/i);
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
        GAME_UNAVAILABLE_MESSAGE
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
      description: "Commander bio",
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

  test("saves a signed player profile through the backend", async () => {
    const originalFetch = globalThis.fetch;
    const description = "Open diplomacy: https://veydrift.com/nova";
    const provider = mockProvider(async ({ method, params }) => {
      expect(method).toBe("personal_sign");
      expect(params).toEqual([playerProfileMessage(account, "borodutch", description), account]);
      return "0xsignature";
    });

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      expect(String(input)).toBe(`https://api.example.test/wallet/${account}/profile`);
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        accept: "application/json",
        "content-type": "application/json"
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        description,
        displayName: "borodutch",
        signature: "0xsignature"
      });
      return new Response(JSON.stringify({
        wallet: account.toLowerCase(),
        displayName: "borodutch",
        description,
        fallbackName: "0x1111...1111",
        updatedAt: "2026-06-02T13:00:00.000Z",
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      await expect(updatePlayerProfile("https://api.example.test///", provider, account, "borodutch", description)).resolves.toMatchObject({
        description,
        displayName: "borodutch"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetches referral dashboard from the backend without asking for a wallet signature", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input));
      expect(`${url.origin}${url.pathname}`).toBe(`https://api.example.test/wallet/${account}/referrals`);
      expect(url.searchParams.get("signature")).toBeNull();
      expect(init).toEqual({
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: expect.any(AbortSignal),
      });
      return new Response(JSON.stringify({
        configured: true,
        invite: null,
        invites: [],
        nextClaimAt: null,
        nextRedemptionAt: null,
        remainingClaims: 3,
        remainingRedemptions: 3
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      await expect(fetchReferralDashboard("https://api.example.test///", account)).resolves.toMatchObject({
        configured: true,
        remainingRedemptions: 3
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("validates normalized referral claims before recording indexed transactions", async () => {
    const originalFetch = globalThis.fetch;
    const code = "borodutch";
    const commitment = referralCommitment(code, account);
    const signature = "0xwalletsignature";
    const txHash = `0x${"bb".repeat(32)}`;
    const requests: Array<{ body: unknown; url: string }> = [];

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requests.push({
        body: JSON.parse(String(init?.body)),
        url: String(input)
      });
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        accept: "application/json",
        "content-type": "application/json"
      });
      const invite = {
        claimedAt: "2026-07-08T12:00:00.000Z",
        code,
        commitment,
        expiresAt: "2026-07-09T12:00:00.000Z",
        link: `https://veydrift.com?ref=${code}`,
        nextRedemptionAt: null,
        owner: account.toLowerCase(),
        redemptionCount: 0,
        remainingRedemptions: 3,
        status: "active",
        txHash: null
      };
      return new Response(JSON.stringify({
        configured: true,
        invite,
        invites: [invite],
        nextClaimAt: invite.expiresAt,
        nextRedemptionAt: null,
        redemptions: [],
        remainingClaims: 3,
        remainingRedemptions: 3
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      expect(generateReferralClaimCode()).toMatch(/^[A-Za-z0-9]{9}$/);
      expect(referralCodeHash(code)).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(referralCommitment(` ${code} `, account)).toBe(commitment);
      await persistReferralClaimIntent("https://api.example.test///", account, code, commitment, signature);
      await expect(recordReferralClaimTransaction(
        "https://api.example.test///",
        account,
        code,
        commitment,
        txHash,
        signature
      )).resolves.toMatchObject({
        invite: { code, commitment, remainingRedemptions: 3, status: "active" },
        remainingRedemptions: 3,
      });
      expect(requests).toEqual([
        {
          body: { code, commitment, signature },
          url: `https://api.example.test/wallet/${account}/referrals/claim-intent`
        },
        {
          body: { code, commitment, signature, txHash },
          url: `https://api.example.test/wallet/${account}/referrals/claim-transaction`
        }
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("signs watched-planet mutations before sending them to the backend", async () => {
    const originalFetch = globalThis.fetch;
    const provider = mockProvider(async ({ method, params }) => {
      expect(method).toBe("personal_sign");
      expect(params).toEqual([watchedPlanetMessage(account, "watch", "42"), account]);
      return "0xwatchsignature";
    });

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      expect(String(input)).toBe(`https://api.example.test/wallet/${account}/watched-planets`);
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        accept: "application/json",
        "content-type": "application/json"
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        planetId: "42",
        signature: "0xwatchsignature"
      });
      return new Response(JSON.stringify({
        watched: true,
        watchedPlanetIds: ["42"],
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      await expect(watchPlanet("https://api.example.test///", provider, account, "42")).resolves.toEqual({
        watched: true,
        watchedPlanetIds: ["42"],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("times out stuck watched-planet signature requests", async () => {
    const provider = mockProvider(async ({ method, params }) => {
      expect(method).toBe("personal_sign");
      expect(params).toEqual([watchedPlanetMessage(account, "watch", "42"), account]);
      return await new Promise<string>(() => undefined);
    });

    await expect(requestWatchedPlanetSignature(provider, account, "watch", "42", 1)).rejects.toThrow(
      "Timed out reading watched planet signature from the wallet after 0 seconds."
    );
  });

  test("signs watched-planet removals with the unwatch action", async () => {
    const originalFetch = globalThis.fetch;
    const provider = mockProvider(async ({ method, params }) => {
      expect(method).toBe("personal_sign");
      expect(params).toEqual([watchedPlanetMessage(account, "unwatch", "42"), account]);
      return "0xunwatchsignature";
    });

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      expect(String(input)).toBe(`https://api.example.test/wallet/${account}/watched-planets/42`);
      expect(init?.method).toBe("DELETE");
      expect(init?.headers).toEqual({
        accept: "application/json",
        "content-type": "application/json"
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        planetId: "42",
        signature: "0xunwatchsignature"
      });
      return new Response(JSON.stringify({
        watched: false,
        watchedPlanetIds: [],
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      await expect(unwatchPlanet("https://api.example.test///", provider, account, "42")).resolves.toEqual({
        watched: false,
        watchedPlanetIds: [],
      });
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
      currentPlayer: {
        wallet: account.toLowerCase(),
        rankings: {
          total: { rank: 27, page: 2 },
          economy: null,
          research: null,
          researchLevels: null,
          military: null,
          fleet: null,
          fleetCount: null,
          defense: null
        }
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

  test("fetches a specific highscore rankings page", async () => {
    const originalFetch = globalThis.fetch;
    const rankings = {
      generatedAt: "2026-05-26T00:00:00.000Z",
      formula: {
        pointsDivisor: "1000",
        summary: "Veydrift score"
      },
      pagination: {
        page: 2,
        pageSize: 50,
        totalEntries: 125,
        totalPages: 3,
        hasPreviousPage: true,
        hasNextPage: true
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
      expect(String(input)).toBe(`https://api.example.test/highscores?limit=50&category=military&currentWallet=${account}&includeAttackProtection=true&page=2&pageSize=50`);
      expect(init).toEqual({
        headers: { accept: "application/json" },
      });
      return new Response(JSON.stringify(rankings), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      await expect(fetchHighscores("https://api.example.test", { category: "military", currentWallet: account, page: 2, pageSize: 50 })).resolves.toEqual(rankings);
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
        GAME_UNAVAILABLE_MESSAGE
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
        GAME_UNAVAILABLE_MESSAGE
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

  test("allows slow watched-planets reads to outlive the normal wallet API timeout", async () => {
    expect(WATCHED_PLANETS_API_READ_TIMEOUT_MS).toBeGreaterThan(10_000);

    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; aborted: boolean }> = [];

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      calls.push({
        url: String(input),
        aborted: init?.signal instanceof AbortSignal ? init.signal.aborted : false,
      });
      return new Response(JSON.stringify({
        pagination: { page: 2, pageSize: 25, total: 0, totalPages: 1 },
        planets: [],
        watchedPlanetIds: [],
        wallet: account,
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }) as unknown as typeof fetch;

    try {
      await expect(fetchWatchedPlanets("https://api.example.test///", account, { page: 2, pageSize: 25 })).resolves.toMatchObject({
        watchedPlanetIds: [],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toEqual([{
      url: `https://api.example.test/wallet/${account}/watched-planets?page=2&pageSize=25`,
      aborted: false,
    }]);
  });

  test("times out watched-planets reads with watched-planets specific copy", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      await new Promise<Response>((_resolve, reject) => {
        if (init?.signal instanceof AbortSignal) {
          init.signal.addEventListener("abort", () => {
            reject(init.signal instanceof AbortSignal && init.signal.reason instanceof Error
              ? init.signal.reason
              : new Error("aborted"));
          });
        }
      })) as unknown as typeof fetch;

    try {
      await expect(fetchWatchedPlanets("https://api.example.test", account, { timeoutMs: 1 })).rejects.toThrow(
        "Timed out reading watched planets from the game API after 0 seconds."
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("explains highscore network and CORS failures with shared player-facing outage copy", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    try {
      let error: unknown;
      try {
        await fetchHighscores("https://api.example.test");
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toBe(GAME_UNAVAILABLE_MESSAGE);
      expect(message).not.toMatch(/CORS|API deployment|browser|Failed to fetch/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("decodeColonizationTargetId", () => {
  test("round-trips coordinates encoded by encodeColonizationTargetId", () => {
    expect(decodeColonizationTargetId(encodeColonizationTargetId(2, 44, 10))).toEqual({
      galaxy: 2,
      system: 44,
      position: 10,
      coordinates: "2:44:10",
    });
  });

  test("returns null for real planet ids without the colonization flag", () => {
    expect(decodeColonizationTargetId("9")).toBeNull();
    expect(decodeColonizationTargetId("0")).toBeNull();
    expect(decodeColonizationTargetId(7)).toBeNull();
  });

  test("returns null for non-numeric input", () => {
    expect(decodeColonizationTargetId("not-a-number")).toBeNull();
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
