import { describe, expect, test } from "bun:test";
import {
  FARCASTER_DESKTOP_ACCOUNT_UNAVAILABLE_MESSAGE,
  indexedSettlementState,
  noWalletDetectedMessage,
  POST_SETTLEMENT_INDEXING_TIMEOUT_MESSAGE,
  settlementLaunchBlocker,
  shouldAttemptFarcasterNetworkSetup,
  shouldAutoConnectFarcasterWallet,
  shouldRetryFarcasterWalletProviderProbe,
  shouldRetryRejectedRequestWithSettlement,
  shouldUsePassiveFarcasterAccountAuthorization,
  waitForIndexedSettledPlanet,
  walletConnectionAccounts,
} from "../src/FirstPlanetSettlementApp";
import { preSettlementMode, type PlanetState, type WalletState } from "../src/settlementScreen";
import type { Eip1193Provider } from "../src/walletFlow";

const connected = {
  account: "0x1111111111111111111111111111111111111111",
  kind: "connected",
} satisfies WalletState;

describe("settlement screen mode", () => {
  test("keeps connected wallets in neutral loading until settlement state is known", () => {
    expect(preSettlementMode(connected, { kind: "idle" })).toBe("resolving");
    expect(preSettlementMode(connected, { kind: "checking" })).toBe("resolving");
  });

  test("shows only the core pre-settlement actions after state is known", () => {
    expect(preSettlementMode({ kind: "disconnected" }, { kind: "idle" })).toBe("connect");
    expect(preSettlementMode(connected, { kind: "not-settled" })).toBe("settle");
  });

  test("keeps no-wallet copy wallet-neutral outside Mini App mode", () => {
    expect(noWalletDetectedMessage(false)).toBe("Open the bridge with an injected EVM wallet or browser wallet.");
    expect(noWalletDetectedMessage(false)).not.toMatch(/metamask/i);
    expect(noWalletDetectedMessage(true)).toContain("Farcaster/Base client");
  });

  test("preserves minimal network, transaction, and error states", () => {
    const pending = { kind: "pending", txHash: "0xabc" } satisfies PlanetState;

    expect(preSettlementMode({ account: connected.account, chainId: "0x1", kind: "wrong-network" }, { kind: "idle" })).toBe("wrong-network");
    expect(preSettlementMode(connected, pending)).toBe("pending");
    expect(preSettlementMode(connected, { kind: "error", message: "RPC unavailable" })).toBe("error");
    expect(preSettlementMode({ kind: "disconnected" }, { kind: "error", message: "Wallet read timed out" })).toBe("error");
  });

  test("maps indexed API settlement state to playable state without wallet eth_call reads", () => {
    expect(indexedSettlementState({
      wallet: connected.account,
      hasFirstPlanet: true,
      homePlanetId: "7",
      planet: {
        planetId: "7",
        owner: connected.account,
        name: "Prime",
        galaxy: 2,
        system: 44,
        position: 9,
        fields: 211,
        temperature: -8,
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
        lastSettledAt: "1770000000",
        resources: {
          metal: "5000",
          crystal: "4900",
          deuterium: "4800",
        },
      },
    })).toEqual({
      kind: "settled",
      planet: {
        label: "Prime",
        coordinates: "2:44:9",
        fields: "211",
        rarity: "Genesis settlement",
        resources: {
          metal: "5000",
          crystal: "4900",
          deuterium: "4800",
        },
        settledAt: "2026-02-02T02:40:00.000Z",
        source: "chain",
        temperature: "-8",
      },
    });

    expect(indexedSettlementState({
      wallet: connected.account,
      hasFirstPlanet: false,
      homePlanetId: null,
      planet: null,
    })).toEqual({ kind: "not-settled" });
  });

  test("keeps post-settlement zero-resource placeholders in indexing state", () => {
    expect(indexedSettlementState({
      wallet: connected.account,
      hasFirstPlanet: true,
      homePlanetId: "7",
      planet: {
        planetId: "7",
        owner: connected.account,
        name: null,
        galaxy: 2,
        system: 44,
        position: 9,
        fields: 211,
        temperature: -8,
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
        lastSettledAt: "0",
        resources: {
          metal: "0",
          crystal: "0",
          deuterium: "0",
        },
      },
    })).toEqual({ kind: "indexing" });
  });

  test("keeps stale zero-resource indexed settlement in indexing state", () => {
    expect(indexedSettlementState({
      wallet: connected.account,
      hasFirstPlanet: true,
      homePlanetId: "7",
      stale: true,
      indexer: {
        safeToServeIndexedState: false,
        staleReason: "planet_resources_pending:7",
      },
      planet: {
        planetId: "7",
        owner: connected.account,
        name: null,
        galaxy: 2,
        system: 44,
        position: 9,
        fields: 211,
        temperature: -8,
        metalMultiplierBps: 10_000,
        crystalMultiplierBps: 10_000,
        deuteriumMultiplierBps: 10_000,
        lastSettledAt: "0",
        resources: {
          metal: "0",
          crystal: "0",
          deuterium: "0",
        },
      },
    })).toEqual({ kind: "indexing" });
  });

  test("waits for indexed settlement resources to hydrate after reconnect", async () => {
    const responses = [
      indexedSettlementResponse({ lastSettledAt: "0", resources: { metal: "0", crystal: "0", deuterium: "0" } }),
      indexedSettlementResponse({ lastSettledAt: "1770000000", resources: { metal: "5000", crystal: "4900", deuterium: "4800" } }),
    ];
    const fetches: string[] = [];
    const delays: number[] = [];

    await expect(waitForIndexedSettledPlanet("https://api.example.test", connected.account, {
      attempts: 2,
      delay: async (ms) => {
        delays.push(ms);
      },
      fetchSettlement: async (apiUrl, account) => {
        fetches.push(`${apiUrl}:${account}`);
        const response = responses.shift();
        if (!response) throw new Error("unexpected extra fetch");
        return response;
      },
      intervalMs: 25,
    })).resolves.toMatchObject({
      kind: "settled",
      planet: {
        coordinates: "2:44:9",
        resources: {
          metal: "5000",
          crystal: "4900",
          deuterium: "4800",
        },
      },
    });

    expect(fetches).toEqual([
      `https://api.example.test:${connected.account}`,
      `https://api.example.test:${connected.account}`,
    ]);
    expect(delays).toEqual([25]);
  });

  test("times out with a retryable message when indexed starter resources stay pending", async () => {
    await expect(waitForIndexedSettledPlanet("https://api.example.test", connected.account, {
      attempts: 2,
      delay: async () => {},
      fetchSettlement: async () => indexedSettlementResponse({
        lastSettledAt: "0",
        resources: { metal: "0", crystal: "0", deuterium: "0" },
      }),
      intervalMs: 1,
    })).rejects.toThrow(POST_SETTLEMENT_INDEXING_TIMEOUT_MESSAGE);
  });

  test("blocks settlement launch until funding info is ready and affordable", () => {
    expect(settlementLaunchBlocker(false, { status: "ready", funding: {
      affordable: true,
      balanceWei: 1n,
      contractKind: "game",
      startPriceWei: 1n,
    } })).toContain("contract address");

    expect(settlementLaunchBlocker(true, { status: "loading" })).toContain("still loading");
    expect(settlementLaunchBlocker(true, {
      status: "error",
      message: "RPC unavailable",
    })).toBe("RPC unavailable");
    expect(settlementLaunchBlocker(true, { status: "ready", funding: {
      affordable: false,
      balanceWei: null,
      contractKind: "game",
      startPriceWei: 1n,
      unavailableReason: "Resource token reserves are not configured.",
    } })).toBe("Resource token reserves are not configured.");
    expect(settlementLaunchBlocker(true, { status: "ready", funding: {
      affordable: false,
      balanceWei: 0n,
      contractKind: "game",
      startPriceWei: 1n,
    } })).toContain("more Base Sepolia ETH");
    expect(settlementLaunchBlocker(true, { status: "ready", funding: {
      affordable: true,
      balanceWei: 1n,
      contractKind: "game",
      startPriceWei: 1n,
    } })).toBeUndefined();
  });

  test("auto-connects only the Farcaster wallet provider in Mini App mode", () => {
    expect(shouldAutoConnectFarcasterWallet({
      alreadyAttempted: false,
      miniAppMode: true,
      miniAppPlatformType: "mobile",
      providerAvailable: true,
      settlementConfigReady: true,
      walletProviderSource: "farcaster",
    })).toBe(true);
    expect(shouldAutoConnectFarcasterWallet({
      alreadyAttempted: false,
      miniAppMode: true,
      miniAppPlatformType: "mobile",
      providerAvailable: true,
      settlementConfigReady: true,
      walletProviderSource: "injected",
    })).toBe(false);
    expect(shouldAutoConnectFarcasterWallet({
      alreadyAttempted: true,
      miniAppMode: true,
      miniAppPlatformType: "mobile",
      providerAvailable: true,
      settlementConfigReady: true,
      walletProviderSource: "farcaster",
    })).toBe(false);
    expect(shouldAutoConnectFarcasterWallet({
      alreadyAttempted: false,
      miniAppMode: true,
      miniAppPlatformType: undefined,
      providerAvailable: true,
      settlementConfigReady: true,
      walletProviderSource: "farcaster",
    })).toBe(false);
  });

  test("attempts Farcaster Base Sepolia setup once per observed wrong chain", () => {
    expect(shouldAttemptFarcasterNetworkSetup({
      chainId: "0x2105",
      lastAttemptedChainId: undefined,
      miniAppMode: true,
      walletProviderSource: "farcaster",
    })).toBe(true);
    expect(shouldAttemptFarcasterNetworkSetup({
      chainId: "0x2105",
      lastAttemptedChainId: "0x2105",
      miniAppMode: true,
      walletProviderSource: "farcaster",
    })).toBe(false);
    expect(shouldAttemptFarcasterNetworkSetup({
      chainId: "0x2105",
      lastAttemptedChainId: undefined,
      miniAppMode: true,
      walletProviderSource: "injected",
    })).toBe(false);
    expect(shouldAttemptFarcasterNetworkSetup({
      chainId: "0x14a34",
      lastAttemptedChainId: undefined,
      miniAppMode: true,
      walletProviderSource: "farcaster",
    })).toBe(false);
  });

  test("retries Farcaster provider discovery only while Mini App wallet support may still be late", () => {
    expect(shouldRetryFarcasterWalletProviderProbe({
      attempt: 1,
      maxAttempts: 3,
      miniAppMode: true,
      providerAvailable: false,
    })).toBe(true);
    expect(shouldRetryFarcasterWalletProviderProbe({
      attempt: 3,
      maxAttempts: 3,
      miniAppMode: true,
      providerAvailable: false,
    })).toBe(false);
    expect(shouldRetryFarcasterWalletProviderProbe({
      attempt: 1,
      maxAttempts: 3,
      miniAppMode: false,
      providerAvailable: false,
    })).toBe(false);
    expect(shouldRetryFarcasterWalletProviderProbe({
      attempt: 1,
      maxAttempts: 3,
      miniAppMode: true,
      providerAvailable: true,
    })).toBe(false);
  });

  test("routes rejected wallet authorization retries back through wallet connect", () => {
    expect(shouldRetryRejectedRequestWithSettlement({ kind: "disconnected" })).toBe(false);
    expect(shouldRetryRejectedRequestWithSettlement({ kind: "connecting" })).toBe(false);
    expect(shouldRetryRejectedRequestWithSettlement(connected)).toBe(true);
  });

  test("uses passive wallet account binding for Farcaster desktop Mini App", async () => {
    const calls: string[] = [];
    const provider = walletProvider(async ({ method }) => {
      calls.push(method);
      if (method === "eth_accounts") return [connected.account];
      if (method === "eth_requestAccounts") throw new Error("desktop should not request accounts");
      throw new Error(`Unexpected method ${method}`);
    });

    expect(shouldUsePassiveFarcasterAccountAuthorization({
      miniAppMode: true,
      miniAppPlatformType: "web",
      walletProviderSource: "farcaster",
    })).toBe(true);
    await expect(walletConnectionAccounts(provider, {
      miniAppMode: true,
      miniAppPlatformType: "web",
      walletProviderSource: "farcaster",
    })).resolves.toEqual([connected.account]);
    expect(calls).toEqual(["eth_accounts"]);
  });

  test("keeps Farcaster mobile wallet binding on active account authorization", async () => {
    const calls: string[] = [];
    const provider = walletProvider(async ({ method }) => {
      calls.push(method);
      if (method === "eth_requestAccounts") return [connected.account];
      throw new Error(`Unexpected method ${method}`);
    });

    expect(shouldUsePassiveFarcasterAccountAuthorization({
      miniAppMode: true,
      miniAppPlatformType: "mobile",
      walletProviderSource: "farcaster",
    })).toBe(false);
    await expect(walletConnectionAccounts(provider, {
      miniAppMode: true,
      miniAppPlatformType: "mobile",
      walletProviderSource: "farcaster",
    })).resolves.toEqual([connected.account]);
    expect(calls).toEqual(["eth_requestAccounts"]);
  });

  test("surfaces a precise Farcaster desktop blocked state when no account is exposed", async () => {
    await expect(walletConnectionAccounts(walletProvider(async ({ method }) => {
      if (method === "eth_accounts") return [];
      throw new Error(`Unexpected method ${method}`);
    }), {
      miniAppMode: true,
      miniAppPlatformType: "web",
      walletProviderSource: "farcaster",
    })).rejects.toThrow(FARCASTER_DESKTOP_ACCOUNT_UNAVAILABLE_MESSAGE);
  });

  test("uses backend settlement state instead of Mini App read-provider fallbacks", async () => {
    const source = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();

    expect(source).toContain("readIndexedSettlementState");
    expect(source).toContain("fetchSettlementFundingState");
    expect(source).toContain("settlementTransactionOptions(funding)");
    expect(source).not.toContain("readSettlementStateWithMiniAppFallback");
    expect(source).not.toContain("readSettlementFundingWithMiniAppFallback");
    expect(source).not.toContain("isUnsupportedProviderMethodError(error)");
    expect(source).not.toContain("waitForReceipt(");
    expect(source).toContain("setMiniAppMode(true)");
  });

  test("auto-binds Farcaster wallet and retries Base Sepolia setup in Mini App mode", async () => {
    const source = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();

    expect(source).toContain("farcasterAutoConnectAttempted");
    expect(source).toContain("input.walletProviderSource === \"farcaster\"");
    expect(source).toContain("void connectWallet()");
    expect(source).toContain("await ensureBaseSepoliaNetwork(injected)");
    expect(source).toContain("Retry Base Sepolia");
    expect(source).toContain("networkSwitchPending");
    expect(source).toContain("disabled={networkSwitchPending}");
    expect(source).not.toContain("Unsupported Mini App network");
  });

  test("rechecks the Farcaster wallet provider when connect is clicked after a cold desktop load", async () => {
    const source = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();

    expect(source).toContain("await loadWalletProviderDetails({ waitForFarcasterProvider: miniAppMode })");
    expect(source).toContain("shouldRetryFarcasterWalletProviderProbe");
    expect(source).toContain("{ preferFarcasterProvider: waitForFarcasterProvider }");
    expect(source).toContain("walletProvider.source !== \"farcaster\"");
    expect(source).toContain("const accounts = await walletConnectionAccounts(activeProvider, providerContext)");
    expect(source).toContain("await refreshWallet(activeProvider, accounts[0], providerContext)");
  });
});

function walletProvider(
  request: Eip1193Provider["request"],
): Eip1193Provider {
  return { request };
}

function indexedSettlementResponse({
  lastSettledAt,
  resources,
}: {
  lastSettledAt: string;
  resources: {
    metal: string;
    crystal: string;
    deuterium: string;
  };
}) {
  return {
    wallet: connected.account,
    hasFirstPlanet: true,
    homePlanetId: "7",
    planet: {
      planetId: "7",
      owner: connected.account,
      name: null,
      galaxy: 2,
      system: 44,
      position: 9,
      fields: 211,
      temperature: -8,
      metalMultiplierBps: 10_000,
      crystalMultiplierBps: 10_000,
      deuteriumMultiplierBps: 10_000,
      lastSettledAt,
      resources,
    },
  };
}
