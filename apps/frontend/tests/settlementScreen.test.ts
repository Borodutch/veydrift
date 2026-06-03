import { describe, expect, test } from "bun:test";
import {
  indexedSettlementState,
  settlementLaunchBlocker,
  shouldAttemptFarcasterNetworkSetup,
  shouldAutoConnectFarcasterWallet,
} from "../src/FirstPlanetSettlementApp";
import { preSettlementMode, type PlanetState, type WalletState } from "../src/settlementScreen";

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
      providerAvailable: true,
      settlementConfigReady: true,
      walletProviderSource: "farcaster",
    })).toBe(true);
    expect(shouldAutoConnectFarcasterWallet({
      alreadyAttempted: false,
      miniAppMode: true,
      providerAvailable: true,
      settlementConfigReady: true,
      walletProviderSource: "injected",
    })).toBe(false);
    expect(shouldAutoConnectFarcasterWallet({
      alreadyAttempted: true,
      miniAppMode: true,
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

  test("keeps a Mini App settlement read-provider fallback for unsupported wallet reads", async () => {
    const source = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();

    expect(source).toContain("readSettlementStateWithMiniAppFallback");
    expect(source).toContain("readSettlementFundingWithMiniAppFallback");
    expect(source).toContain("isUnsupportedProviderMethodError(error)");
    expect(source).toContain("setMiniAppMode(true)");
    expect(source).toContain("settlementTransactionOptions(launchMode === \"mini-app\")");
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
});
