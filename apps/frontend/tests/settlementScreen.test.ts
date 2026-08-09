import { describe, expect, test } from "bun:test";
import {
  farcasterMiniAppReportableWalletError,
  farcasterMiniAppSupportErrorMessage,
  indexedSettlementState,
  isSameWalletChainId,
  migrationReservationForSettlementFunding,
  noWalletDetectedMessage,
  POST_SETTLEMENT_INDEXING_TIMEOUT_MESSAGE,
  settlementErrorStateMessage,
  settlementLaunchBlocker,
  settlementBalanceRecheckAvailable,
  shouldAttemptFarcasterNetworkSetup,
  shouldAutoConnectFarcasterWallet,
  shouldRefreshWalletOnProviderReady,
  shouldShowMiniAppWalletError,
  shouldRetryFarcasterWalletProviderProbe,
  shouldRetryRejectedRequestWithSettlement,
  shouldShowPublicPlayableApp,
  shouldUseWalletProviderForSettlement,
  waitForIndexedSettledPlanet,
  walletConnectionAccounts,
} from "../src/FirstPlanetSettlementApp";
import { preSettlementMode, type PlanetState, type WalletState } from "../src/settlementScreen";
import type { Eip1193Provider, MigrationReservation } from "../src/walletFlow";

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

  test("keeps logged-out and unsettled viewers on the pre-play gate", () => {
    expect(shouldShowPublicPlayableApp({ kind: "disconnected" }, { kind: "idle" })).toBe(false);
    expect(shouldShowPublicPlayableApp({ kind: "no-wallet" }, { kind: "idle" })).toBe(false);
    expect(shouldShowPublicPlayableApp(connected, { kind: "not-settled" })).toBe(false);
    expect(shouldShowPublicPlayableApp(connected, { kind: "checking" })).toBe(false);
    expect(shouldShowPublicPlayableApp(connected, { kind: "already-settled", planet: {
      label: "Prime",
      source: "chain",
    } })).toBe(false);
    expect(shouldShowMiniAppWalletError(true, { kind: "error", message: "Farcaster Mini App wallet setup failed (FARCASTER_BASE_SEPOLIA_UNSUPPORTED)." })).toBe(true);
    expect(shouldShowMiniAppWalletError(false, { kind: "error", message: "Farcaster Mini App wallet setup failed (FARCASTER_BASE_SEPOLIA_UNSUPPORTED)." })).toBe(false);
  });

  test("routes the landing through the retro CD box pre-play gate before playable state", async () => {
    const appSource = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const landingSource = await Bun.file(new URL("../src/ComingSoonApp.tsx", import.meta.url)).text();
    const settlementSource = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();
    const heroSource = await Bun.file(new URL("../src/components/RetroCdBoxHero.tsx", import.meta.url)).text();
    const stylesSource = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(appSource).toContain("<FirstPlanetSettlementApp />");
    expect(appSource).not.toContain("return <PlayableMvpApp />;");
    expect(appSource).not.toContain("return <ComingSoonApp />;");
    expect(settlementSource).toContain("<ComingSoonApp");
    expect(settlementSource).toContain("heroSupport={<SettlementSupportLinks />}");
    expect(settlementSource).not.toContain("<SettlementScanner");
    expect(landingSource).toContain("<RetroCdBoxHero");
    expect(landingSource).toContain("ariaLabel=\"Veydrift landing\"");
    expect(landingSource).toContain("stage=\"section\"");
    expect(landingSource).toContain("id=\"claim\"");
    expect(heroSource).toContain("retro-cd-case");
    expect(heroSource).toContain("retro-cd-front");
    expect(heroSource).toContain("retro-cd-back");
    expect(heroSource).toContain("/assets/landing/qa-screens/overview-desktop.jpg");
    expect(heroSource).toContain("/assets/landing/qa-screens/shipyard-desktop.jpg");
    expect(heroSource).toContain("/assets/landing/qa-screens/missions-desktop.jpg");
    expect(stylesSource).toContain(".retro-cd-case");
    expect(stylesSource).toContain(".retro-cd-front");
    expect(stylesSource).toContain(".retro-cd-back");
  });

  test("fails closed when a canonical alliance invite is incomplete or mismatched", async () => {
    const settlementSource = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();

    expect(settlementSource).toContain('const invalidPaidAllianceInvite = paidAllianceInviteLocation.kind === "invalid";');
    expect(settlementSource).toContain("invalidPaidAllianceInvite ? (");
    expect(settlementSource).toContain('title="Invalid alliance invite"');
    expect(settlementSource).toContain("This link is incomplete or does not match its private invite key.");
    expect(settlementSource.indexOf('title="Invalid alliance invite"')).toBeLessThan(
      settlementSource.indexOf("<FlowBody", settlementSource.indexOf('title="Invalid alliance invite"')),
    );
  });

  test("uses the beta cover badge without the retired CD cover labels", async () => {
    const settlementSource = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();
    const heroSource = await Bun.file(new URL("../src/components/RetroCdBoxHero.tsx", import.meta.url)).text();

    expect(heroSource).not.toContain("PC CD-ROM");
    expect(heroSource).not.toContain(">ALPHA<");
    expect(heroSource).toContain(">BETA<");
    expect(heroSource).not.toContain("Back cover");
    expect(heroSource).not.toContain("Live Veydrift surfaces from the current alpha build.");

    expect(settlementSource).toContain("Link wallet");
    expect(settlementSource).toContain("Paste invite code");
    expect(heroSource).toContain("Build. Raid. Drift.");
    expect(heroSource).toContain("/assets/landing/qa-screens/overview-desktop.jpg");
    expect(heroSource).toContain("/assets/landing/qa-screens/shipyard-desktop.jpg");
    expect(heroSource).toContain("/assets/landing/qa-screens/missions-desktop.jpg");
    expect(heroSource).toContain("Onchain");
    expect(heroSource).toContain("Alliances");
    expect(heroSource).toContain("Fleet ops");
    expect(heroSource).toContain("Rift economy");
  });

  test("keeps no-wallet copy wallet-neutral outside Mini App mode", () => {
    expect(noWalletDetectedMessage(false)).toBe("Open the bridge with an injected EVM wallet or browser wallet.");
    expect(noWalletDetectedMessage(false)).not.toMatch(/metamask/i);
    expect(noWalletDetectedMessage(true)).toContain("does not expose a Base wallet");
  });

  test("preserves minimal network, transaction, and error states", () => {
    const pending = { kind: "pending", txHash: "0xabc" } satisfies PlanetState;

    expect(preSettlementMode({ account: connected.account, chainId: "0x1", kind: "wrong-network" }, { kind: "idle" })).toBe("wrong-network");
    expect(preSettlementMode(connected, pending)).toBe("pending");
    expect(preSettlementMode(connected, { kind: "error", message: "RPC unavailable" })).toBe("error");
    expect(preSettlementMode({ kind: "disconnected" }, { kind: "error", message: "Wallet read timed out" })).toBe("error");
  });

  test("labels backend-unreachable settlement startup failures as server outages", () => {
    const state = settlementErrorStateMessage({
      kind: "error",
      message: "The Veydrift backend is temporarily unreachable from this browser. It is likely restarting and should be back in a few minutes.",
    });

    expect(state.title).toBe("Game server unavailable");
    expect(state.body).toContain("backend is likely restarting");
    expect(state.body).not.toMatch(/wallet/i);
    expect(state.body).not.toContain("Settlement API");
    expect(state.body).not.toContain("last known game state");
  });

  test("keeps true wallet settlement failures wallet-specific", () => {
    expect(settlementErrorStateMessage({
      kind: "error",
      message: "Timed out reading accounts from the wallet. Unlock or reconnect your wallet, then retry.",
    })).toEqual({
      body: "Timed out reading accounts from the wallet. Unlock or reconnect your wallet, then retry.",
      title: "Wallet error",
    });
    expect(settlementErrorStateMessage({
      kind: "rejected",
      message: "Wallet connection was rejected.",
    })).toEqual({
      body: "Wallet connection was rejected.",
      title: "Request rejected",
    });
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
      balanceWei: 6_415_269_622_757_181n,
      contractKind: "game",
      startPriceWei: 12_000_000_000_000_000n,
    } })).toBe("This wallet needs at least 0.005584730377242819 more ETH on Base, plus gas, before launching settlement.");
    expect(settlementLaunchBlocker(true, { status: "ready", funding: {
      affordable: true,
      balanceWei: 1n,
      contractKind: "game",
      startPriceWei: 1n,
    } })).toBeUndefined();
    expect(settlementLaunchBlocker(true, { status: "ready", funding: {
      affordable: false,
      balanceWei: 0n,
      contractKind: "game",
      startPriceWei: 12_000_000_000_000_000n,
    } }, true)).toBeUndefined();
  });

  test("lets an underfunded wallet recheck without bypassing other launch blockers", () => {
    const underfunded = { status: "ready", funding: {
      affordable: false,
      balanceWei: 6_415_269_622_757_181n,
      contractKind: "game" as const,
      startPriceWei: 12_000_000_000_000_000n,
    } };

    expect(settlementBalanceRecheckAvailable(true, underfunded)).toBe(true);
    expect(settlementBalanceRecheckAvailable(true, underfunded, true)).toBe(false);
    expect(settlementBalanceRecheckAvailable(false, underfunded)).toBe(false);
    expect(settlementBalanceRecheckAvailable(true, { status: "ready", funding: {
      ...underfunded.funding,
      unavailableReason: "Resource token reserves are not configured.",
    } })).toBe(false);
    expect(settlementBalanceRecheckAvailable(true, { status: "ready", funding: {
      ...underfunded.funding,
      affordable: true,
      balanceWei: 13_000_000_000_000_000n,
    } })).toBe(false);
  });

  test("keeps backend migration reservation when Mini App contract reads are unavailable", () => {
    const backendReservation = {
      claimed: false,
      exists: true,
      fields: 209,
      galaxy: 5,
      position: 13,
      system: 200,
      temperature: -111,
    } satisfies MigrationReservation;
    const chainReservation = {
      ...backendReservation,
      galaxy: 6,
    } satisfies MigrationReservation;

    expect(migrationReservationForSettlementFunding(null, backendReservation)).toBe(backendReservation);
    expect(migrationReservationForSettlementFunding(chainReservation, backendReservation)).toBe(chainReservation);
    expect(migrationReservationForSettlementFunding({ ...chainReservation, claimed: true }, backendReservation)).toBeNull();
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
    expect(shouldAutoConnectFarcasterWallet({
      alreadyAttempted: false,
      miniAppMode: true,
      providerAvailable: true,
      settlementConfigReady: true,
      walletProviderSource: "farcaster",
    })).toBe(true);
  });

  test("attempts Farcaster Base Sepolia setup once per observed wrong chain", () => {
    // The default required chain is hostname/env derived; a local .env with
    // VITE_VEYDRIFT_CHAIN set must not leak into these Sepolia expectations.
    const forcedChain = process.env.VITE_VEYDRIFT_CHAIN;
    delete process.env.VITE_VEYDRIFT_CHAIN;
    try {
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
    } finally {
      if (forcedChain === undefined) {
        delete process.env.VITE_VEYDRIFT_CHAIN;
      } else {
        process.env.VITE_VEYDRIFT_CHAIN = forcedChain;
      }
    }
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

  test("recognizes repeated wallet chain events across hex and decimal encodings", () => {
    expect(isSameWalletChainId("0x2105", "8453")).toBe(true);
    expect(isSameWalletChainId("0x14a34", "84532")).toBe(true);
    expect(isSameWalletChainId("0x2105", "0x14a34")).toBe(false);
    expect(isSameWalletChainId(undefined, "0x2105")).toBe(false);
  });

  test("actively requests wallet account binding for Farcaster desktop Mini App", async () => {
    const calls: string[] = [];
    const provider = walletProvider(async ({ method }) => {
      calls.push(method);
      if (method === "eth_accounts") return [];
      if (method === "eth_requestAccounts") return [connected.account];
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(walletConnectionAccounts(provider, {
      miniAppMode: true,
      miniAppPlatformType: "web",
      walletProviderSource: "farcaster",
    })).resolves.toEqual([connected.account]);
    expect(calls).toEqual(["eth_accounts", "eth_requestAccounts"]);
  });

  test("uses already exposed Farcaster web Mini App accounts without a manual wallet prompt", async () => {
    const calls: string[] = [];
    const provider = walletProvider(async ({ method }) => {
      calls.push(method);
      if (method === "eth_accounts") return [connected.account];
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(walletConnectionAccounts(provider, {
      miniAppMode: true,
      miniAppPlatformType: "web",
      walletProviderSource: "farcaster",
    })).resolves.toEqual([connected.account]);
    expect(calls).toEqual(["eth_accounts"]);
  });

  test("requests Farcaster mobile wallet accounts without a passive accounts preflight", async () => {
    const calls: string[] = [];
    const provider = walletProvider(async ({ method }) => {
      calls.push(method);
      if (method === "eth_requestAccounts") return [connected.account];
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(walletConnectionAccounts(provider, {
      miniAppMode: true,
      miniAppPlatformType: "mobile",
      walletProviderSource: "farcaster",
    })).resolves.toEqual([connected.account]);
    expect(calls).toEqual(["eth_requestAccounts"]);
  });

  test("requests Farcaster pending-platform wallet accounts without a passive accounts preflight", async () => {
    const calls: string[] = [];
    const provider = walletProvider(async ({ method }) => {
      calls.push(method);
      if (method === "eth_requestAccounts") return [connected.account];
      throw new Error(`Unexpected method ${method}`);
    });

    await expect(walletConnectionAccounts(provider, {
      miniAppMode: true,
      miniAppPlatformType: undefined,
      walletProviderSource: "farcaster",
    })).resolves.toEqual([connected.account]);
    expect(calls).toEqual(["eth_requestAccounts"]);
  });

  test("lets Farcaster Mini App connect own the initial account authorization", () => {
    expect(shouldRefreshWalletOnProviderReady({
      account: undefined,
      miniAppMode: true,
      walletProviderSource: "farcaster",
    })).toBe(false);

    expect(shouldRefreshWalletOnProviderReady({
      account: connected.account,
      miniAppMode: true,
      walletProviderSource: "farcaster",
    })).toBe(true);

    expect(shouldRefreshWalletOnProviderReady({
      account: undefined,
      miniAppMode: true,
      walletProviderSource: "injected",
    })).toBe(true);
  });

  test("blocks Mini App mode from using injected or missing providers", () => {
    expect(shouldUseWalletProviderForSettlement({
      miniAppMode: true,
      walletProviderSource: "farcaster",
    })).toBe(true);

    expect(shouldUseWalletProviderForSettlement({
      miniAppMode: true,
      walletProviderSource: "injected",
    })).toBe(false);

    expect(shouldUseWalletProviderForSettlement({
      miniAppMode: true,
      walletProviderSource: undefined,
    })).toBe(false);

    expect(shouldUseWalletProviderForSettlement({
      miniAppMode: false,
      walletProviderSource: "injected",
    })).toBe(true);
  });

  test("surfaces an unavailable account when Farcaster desktop authorization returns no account", async () => {
    await expect(walletConnectionAccounts(walletProvider(async ({ method }) => {
      if (method === "eth_accounts") return [];
      if (method === "eth_requestAccounts") return [];
      throw new Error(`Unexpected method ${method}`);
    }), {
      miniAppMode: true,
      miniAppPlatformType: "web",
      walletProviderSource: "farcaster",
    })).rejects.toThrow("Wallet account is unavailable. Reconnect your wallet, then retry.");
  });

  test("uses backend settlement state instead of Mini App read-provider fallbacks", async () => {
    const source = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();

    expect(source).toContain("readIndexedSettlementState");
    expect(source).toContain("backendDataStoreFor(settlementConfigState.apiUrl!).settlementFunding(connectedAccount)");
    expect(source).toContain("settlementTransactionOptions(funding, referral)");
    expect(source).not.toContain("readSettlementStateWithMiniAppFallback");
    expect(source).not.toContain("readSettlementFundingWithMiniAppFallback");
    expect(source).not.toContain("isUnsupportedProviderMethodError(error)");
    expect(source).not.toContain("waitForReceipt(");
    expect(source).toContain("setMiniAppMode(true)");
  });

  test("auto-binds Farcaster wallet and retries the required Veydrift chain setup in Mini App mode", async () => {
    const source = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();

    expect(source).toContain("farcasterAutoConnectAttempted");
    expect(source).toContain("input.walletProviderSource === \"farcaster\"");
    expect(source).toContain("void connectWallet()");
    expect(source).toContain("signalFarcasterReadyOnce");
    expect(source).toContain("farcasterMiniAppWalletSupport");
    expect(source).toContain("preferFarcasterProvider: waitForFarcasterProvider");
    expect(source).toContain("await setupVeydriftNetworkForWallet(injected, context)");
    expect(source).toContain("await switchVeydriftNetwork(walletProvider, requiredChain)");
    expect(source).toContain("Retry ${networkName}");
    expect(source).toContain("networkSwitchPending");
    expect(source).toContain("disabled={networkSwitchPending}");
    expect(source).toContain("FARCASTER_VEYDRIFT_CHAIN_SWITCH_FAILED");
    expect(source).toContain("FARCASTER_VEYDRIFT_CHAIN_RETRY_FAILED");
    expect(source).toContain("FARCASTER_WALLET_PROVIDER_UNAVAILABLE");
    expect(source).toContain("showFarcasterWalletProviderUnavailable");
    expect(source).toContain("<ComingSoonApp");
  });

  test("formats reportable Farcaster Mini App wallet errors with host diagnostics", () => {
    expect(farcasterMiniAppReportableWalletError(
      "FARCASTER_BASE_SEPOLIA_SWITCH_FAILED",
      "The host rejected wallet_switchEthereumChain.",
      {
        chainId: "0x2105",
        requestedChainId: "0x14a34",
        source: "farcaster",
        support: {
          status: "unknown",
          code: "FARCASTER_CHAINS_UNAVAILABLE",
          capabilities: ["wallet.getEthereumProvider"],
          chains: [],
          message: "Farcaster Mini App host did not report supported chains.",
        },
        error: { code: 4902, message: "Unrecognized chain" },
      },
    )).toBe(
      "Wallet setup failed (FARCASTER_BASE_SEPOLIA_SWITCH_FAILED). The host rejected wallet_switchEthereumChain. Details: chain=0x2105; requestedChain=0x14a34; source=farcaster; support=unknown/FARCASTER_CHAINS_UNAVAILABLE; capabilities=wallet.getEthereumProvider; chains=none; errorCode=4902; errorMessage=Unrecognized chain. Please send this exact message to Veydrift support.",
    );

    expect(farcasterMiniAppSupportErrorMessage({
      status: "unsupported",
      code: "FARCASTER_BASE_SEPOLIA_UNSUPPORTED",
      capabilities: ["wallet.getEthereumProvider"],
      chains: ["eip155:8453"],
      message: "Farcaster Mini App host does not advertise eip155:84532.",
    })).toContain("Reported chains: eip155:8453.");
  });

  test("rechecks the Farcaster wallet provider when connect is clicked after a cold desktop load", async () => {
    const source = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();

    expect(source).toContain("waitForFarcasterProvider: miniAppMode || !provider");
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
