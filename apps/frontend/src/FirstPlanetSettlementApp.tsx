import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import heroUrl from "./assets/veydrift-hero.webp";
import { TelegramIcon } from "./components/TelegramIcon";
import { PlayableMvpApp } from "./PlayableMvpApp";
import { gameContractAddress, playableApiUrl, runtimeConfigUrl, type RuntimeConfig } from "./runtimeConfig";
import { preSettlementMode, type PlanetState, type WalletState } from "./settlementScreen";
import { TELEGRAM_SUPPORT_URL } from "./supportLinks";
import {
  detectFarcasterMiniApp,
  farcasterMiniAppPlatformType,
  hasMiniAppUrlHint,
  signalFarcasterReadyOnce,
  type FarcasterMiniAppPlatformType,
} from "./farcasterReady";
import {
  createTransactionActionGate,
  transactionAwaitingWalletLabel,
  transactionConfirmingLabel,
  transactionSyncingLabel,
} from "./transactionActionGate";
import {
  ensureBaseSepoliaNetwork,
  fetchSettlementFundingState,
  fetchWalletSettlement,
  getChainId,
  getCurrentAccounts,
  isBaseSepoliaChain,
  isGameBackendUnavailableMessage,
  isTransientWalletBootstrapError,
  isUserRejected,
  miniAppUnsupportedChainMessage,
  WALLET_BOOTSTRAP_READ_TIMEOUT_MS,
  requestAccounts,
  getAvailableWalletProviderDetails,
  sendSettlementTransaction,
  settlementContractConfigured,
  waitForBaseSepoliaNetwork,
  walletRequestErrorMessage,
  type Eip1193Provider,
  type PlanetSummary,
  type SettlementTransactionOptions,
  type SettlementFundingState,
  type SettlementConfig,
  type WalletSettlementResponse
} from "./walletFlow";

const FIRST_PLANET_URL = "/assets/game/planets/temperate-ocean.webp";
const POST_SETTLEMENT_READ_ATTEMPTS = 8;
const POST_SETTLEMENT_READ_INTERVAL_MS = 2_000;
const RUNTIME_CONFIG_RETRY_MS = 5_000;
export const POST_SETTLEMENT_INDEXING_LABEL = "Settlement confirmed. Indexing starting resources before opening planetary overview.";
export const POST_SETTLEMENT_INDEXING_TIMEOUT_MESSAGE = "Settlement is confirmed, but the game API is still indexing starter resources. Retry once backend sync catches up.";
const GAME_BACKEND_UNAVAILABLE_BODY =
  "The Veydrift backend is likely restarting or temporarily unreachable. It should be back in a few minutes.";
const FARCASTER_WALLET_PROVIDER_PROBE_ATTEMPTS = 8;
const FARCASTER_WALLET_PROVIDER_PROBE_INTERVAL_MS = 250;

type SettlementConfigState =
  | { status: "loading"; apiUrl?: string; config: SettlementConfig }
  | { status: "ready"; apiUrl?: string; config: SettlementConfig };

export function shouldAutoConnectFarcasterWallet(input: {
  miniAppMode: boolean;
  miniAppPlatformType: FarcasterMiniAppPlatformType | undefined;
  providerAvailable: boolean;
  settlementConfigReady: boolean;
  walletProviderSource: "injected" | "farcaster" | undefined;
  alreadyAttempted: boolean;
}): boolean {
  return input.providerAvailable
    && input.miniAppMode
    && input.miniAppPlatformType !== undefined
    && input.walletProviderSource === "farcaster"
    && input.settlementConfigReady
    && !input.alreadyAttempted;
}

export function shouldAttemptFarcasterNetworkSetup(input: {
  miniAppMode: boolean;
  walletProviderSource: "injected" | "farcaster" | undefined;
  chainId: string;
  lastAttemptedChainId: string | undefined;
}): boolean {
  return input.miniAppMode
    && input.walletProviderSource === "farcaster"
    && !isBaseSepoliaChain(input.chainId)
    && input.lastAttemptedChainId !== input.chainId;
}

export function shouldRetryFarcasterWalletProviderProbe(input: {
  attempt: number;
  maxAttempts?: number;
  miniAppMode: boolean;
  providerAvailable: boolean;
}): boolean {
  return input.miniAppMode
    && !input.providerAvailable
    && input.attempt < (input.maxAttempts ?? FARCASTER_WALLET_PROVIDER_PROBE_ATTEMPTS);
}

export function shouldRetryRejectedRequestWithSettlement(wallet: WalletState): boolean {
  return wallet.kind === "connected";
}

export function shouldShowPublicPlayableApp(wallet: WalletState, planet: PlanetState): boolean {
  if (planet.kind === "success" || planet.kind === "already-settled") return false;
  return wallet.kind === "disconnected" || wallet.kind === "no-wallet";
}

export function settlementErrorStateMessage(planet: Extract<PlanetState, { kind: "error" | "rejected" }>): {
  body: string;
  title: string;
} {
  if (planet.kind === "rejected") {
    return {
      body: planet.message,
      title: "Request rejected",
    };
  }

  if (isGameBackendUnavailableMessage(planet.message)) {
    return {
      body: GAME_BACKEND_UNAVAILABLE_BODY,
      title: "Game server unavailable",
    };
  }

  return {
    body: planet.message,
    title: "Wallet error",
  };
}

export async function walletConnectionAccounts(
  provider: Eip1193Provider,
  _context: WalletProviderContext,
): Promise<string[]> {
  return requestAccounts(provider);
}

type SettlementFunding =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; funding: SettlementFundingState }
  | { status: "error"; message: string };

type WalletProviderDetails = Awaited<ReturnType<typeof getAvailableWalletProviderDetails>>;
type WalletProviderContext = {
  miniAppMode: boolean;
  miniAppPlatformType: FarcasterMiniAppPlatformType | undefined;
  walletProviderSource: "injected" | "farcaster" | undefined;
};

// Some mobile wallet providers (notably Trust Wallet on Android) intermittently
// stall the first eth_accounts/eth_chainId read after a cold page load, leaving
// the player stuck on "Reading wallet link" until they manually refresh. Retry
// the bootstrap automatically on transient failures instead.
const WALLET_BOOTSTRAP_MAX_RETRIES = 4;
const WALLET_BOOTSTRAP_RETRY_MS = 1_200;

export function FirstPlanetSettlementApp() {
  const [provider, setProvider] = useState<Eip1193Provider>();
  const [settlementConfigState, setSettlementConfigState] = useState<SettlementConfigState>(() => ({
    status: "loading",
    config: buildSettlementConfig()
  }));
  const [wallet, setWallet] = useState<WalletState>({
    kind: "loading"
  });
  const [networkSwitchPending, setNetworkSwitchPending] = useState(false);
  const [walletProviderSource, setWalletProviderSource] = useState<"injected" | "farcaster" | undefined>();
  const [planet, setPlanet] = useState<PlanetState>({
    kind: "idle"
  });
  const [miniAppMode, setMiniAppMode] = useState(() => (
    typeof window !== "undefined" ? hasMiniAppUrlHint(window.location) : false
  ));
  const [miniAppPlatformType, setMiniAppPlatformType] = useState<FarcasterMiniAppPlatformType | undefined>();
  const [settlementFunding, setSettlementFunding] = useState<SettlementFunding>({ status: "idle" });
  const transactionActionGate = useRef(createTransactionActionGate()).current;
  const farcasterAutoConnectAttempted = useRef(false);
  const farcasterNetworkSetupAttempted = useRef<string>();
  const walletProviderCleanup = useRef<(() => void) | undefined>();
  const walletBootstrapAttempts = useRef(0);
  const walletBootstrapRetryTimer = useRef<ReturnType<typeof setTimeout> | undefined>();

  const account = "account" in wallet ? wallet.account : undefined;
  const hasOverview = planet.kind === "success" || planet.kind === "already-settled";
  const settlementConfig = settlementConfigState.config;

  useEffect(() => {
    let disposed = false;

    void detectFarcasterMiniApp().then((detected) => {
      if (!disposed && detected) {
        setMiniAppMode(true);
      }
    });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!miniAppMode) {
      setMiniAppPlatformType(undefined);
      return;
    }

    let disposed = false;

    void farcasterMiniAppPlatformType().then((platformType) => {
      if (!disposed) {
        setMiniAppPlatformType(platformType);
      }
    });

    return () => {
      disposed = true;
    };
  }, [miniAppMode]);

  useEffect(() => {
    const abortController = new AbortController();
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;

    const loadRuntimeConfig = () => {
      fetch(runtimeConfigUrl(), {
        headers: { accept: "application/json" },
        signal: abortController.signal
      })
        .then((response) => {
          if (!response.ok) throw new Error(`Runtime config failed with ${response.status}`);
          return response.json() as Promise<RuntimeConfig>;
        })
        .then((runtimeConfig) => {
          if (abortController.signal.aborted) return;
          applyRuntimeConfig(runtimeConfig, settlementConfig);
        })
        .catch((error) => {
          if (abortController.signal.aborted) return;
          console.error(error);
          setSettlementConfigState({
            status: "ready",
            apiUrl: playableApiUrl,
            config: settlementConfig,
          });
          retryTimeout = setTimeout(loadRuntimeConfig, RUNTIME_CONFIG_RETRY_MS);
        });
    };

    loadRuntimeConfig();

    return () => {
      abortController.abort();
      if (retryTimeout !== undefined) clearTimeout(retryTimeout);
    };

    function applyRuntimeConfig(runtimeConfig: RuntimeConfig, fallbackConfig: SettlementConfig) {
        if (abortController.signal.aborted) return;
        const address = gameContractAddress(runtimeConfig) ?? fallbackConfig.address;
        const legacyAddress = runtimeConfig.contractAddress && runtimeConfig.contractAddress !== address
          ? runtimeConfig.contractAddress
          : undefined;
        setSettlementConfigState({
          status: "ready",
          apiUrl: runtimeConfig.apiUrl,
          config: address ? {
            address,
            ...(legacyAddress ? { legacyAddress } : {}),
            resourceTokensConfigured: Boolean(
              runtimeConfig.resourceTokenAddresses.metal
                && runtimeConfig.resourceTokenAddresses.crystal
                && runtimeConfig.resourceTokenAddresses.deuterium
            )
          } : fallbackConfig
        });
    }
  }, []);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      const walletProvider = await loadWalletProviderDetails({ waitForFarcasterProvider: miniAppMode });
      if (disposed) return;
      bindWalletProviderDetails(walletProvider);

      if (!walletProvider?.provider) {
        setWallet({
          kind: "no-wallet"
        });
      }
    })();

    return () => {
      disposed = true;
      walletProviderCleanup.current?.();
      walletProviderCleanup.current = undefined;
      if (walletBootstrapRetryTimer.current !== undefined) {
        clearTimeout(walletBootstrapRetryTimer.current);
        walletBootstrapRetryTimer.current = undefined;
      }
    };
  }, []);

  useEffect(() => {
    if (!miniAppMode || walletProviderSource === "farcaster") {
      return;
    }

    let disposed = false;

    void (async () => {
      const walletProvider = await loadWalletProviderDetails({ waitForFarcasterProvider: true });
      if (disposed || !walletProvider?.provider || walletProvider.source !== "farcaster") return;

      bindWalletProviderDetails(walletProvider);
      setWallet({ kind: "disconnected" });
    })();

    return () => {
      disposed = true;
    };
  }, [miniAppMode, provider, wallet.kind]);

  useEffect(() => {
    if (!provider || settlementConfigState.status !== "ready") {
      return;
    }

    void refreshWallet(provider, account);
  }, [provider, settlementConfig.address, settlementConfigState.apiUrl, settlementConfigState.status]);

  useEffect(() => {
    if (!shouldAutoConnectFarcasterWallet({
      alreadyAttempted: farcasterAutoConnectAttempted.current,
      miniAppMode,
      miniAppPlatformType,
      providerAvailable: Boolean(provider),
      settlementConfigReady: settlementConfigState.status === "ready",
      walletProviderSource,
    })) {
      return;
    }

    farcasterAutoConnectAttempted.current = true;
    void connectWallet();
  }, [miniAppMode, miniAppPlatformType, provider, settlementConfigState.status, walletProviderSource]);

  async function loadWalletProviderDetails({
    waitForFarcasterProvider = false,
  }: { waitForFarcasterProvider?: boolean } = {}): Promise<WalletProviderDetails> {
    if (waitForFarcasterProvider) {
      await signalFarcasterReadyOnce();
    }

    const providerOptions = { preferFarcasterProvider: waitForFarcasterProvider };
    let walletProvider = await getAvailableWalletProviderDetails(
      window as typeof window & { ethereum?: Eip1193Provider },
      undefined,
      providerOptions,
    );

    for (
      let attempt = 1;
      shouldRetryFarcasterWalletProviderProbe({
        attempt,
        miniAppMode: waitForFarcasterProvider,
        providerAvailable: Boolean(walletProvider?.provider),
      });
      attempt += 1
    ) {
      await delay(FARCASTER_WALLET_PROVIDER_PROBE_INTERVAL_MS);
      walletProvider = await getAvailableWalletProviderDetails(
        window as typeof window & { ethereum?: Eip1193Provider },
        undefined,
        providerOptions,
      );
    }

    return walletProvider;
  }

  function bindWalletProviderDetails(
    walletProvider: WalletProviderDetails,
  ) {
    const injected = walletProvider?.provider;
    const providerContext = walletProviderContext(walletProvider?.source);
    setProvider(injected);
    setWalletProviderSource(walletProvider?.source);
    if (walletProvider?.source === "farcaster") {
      setMiniAppMode(true);
    }

    walletProviderCleanup.current?.();
    walletProviderCleanup.current = undefined;

    if (!injected) {
      return undefined;
    }

    const handleAccountsChanged = (...args: unknown[]) => {
      const nextAccounts = Array.isArray(args[0]) ? args[0] as string[] : [];

      if (nextAccounts[0]) {
        void refreshWallet(injected, nextAccounts[0], providerContext);
      } else {
        setWallet({
          kind: "disconnected"
        });
        setPlanet({
          kind: "idle"
        });
        setSettlementFunding({ status: "idle" });
      }
    };

    const handleChainChanged = () => {
      void refreshWallet(injected, undefined, providerContext);
    };

    injected.on?.("accountsChanged", handleAccountsChanged);
    injected.on?.("chainChanged", handleChainChanged);

    walletProviderCleanup.current = () => {
      injected.removeListener?.("accountsChanged", handleAccountsChanged);
      injected.removeListener?.("chainChanged", handleChainChanged);
    };

    return injected;
  }

  function walletProviderContext(source = walletProviderSource): WalletProviderContext {
    return {
      miniAppMode: miniAppMode || source === "farcaster",
      miniAppPlatformType,
      walletProviderSource: source,
    };
  }

  async function refreshWallet(injected = provider, preferredAccount?: string, context = walletProviderContext()) {
    if (!injected) {
      walletBootstrapAttempts.current = 0;
      setWallet({
        kind: "no-wallet"
      });
      setSettlementFunding({ status: "idle" });
      return;
    }

    try {
      const accounts = preferredAccount
        ? [preferredAccount]
        : await getCurrentAccounts(injected, WALLET_BOOTSTRAP_READ_TIMEOUT_MS);

      if (!accounts[0]) {
        walletBootstrapAttempts.current = 0;
        setWallet({
          kind: "disconnected"
        });
        setPlanet({
          kind: "idle"
        });
        setSettlementFunding({ status: "idle" });
        return;
      }

      if (settlementConfigState.status === "loading") {
        setWallet({
          kind: "connected",
          account: accounts[0]
        });
        setPlanet({
          kind: "checking"
        });
        return;
      }

      const chainId = await getChainId(injected, WALLET_BOOTSTRAP_READ_TIMEOUT_MS);
      // The flaky wallet reads (accounts + chain) both succeeded; stop counting
      // bootstrap retries.
      walletBootstrapAttempts.current = 0;

      if (!isBaseSepoliaChain(chainId)) {
        if (shouldAttemptFarcasterNetworkSetup({
          chainId,
          lastAttemptedChainId: farcasterNetworkSetupAttempted.current,
          miniAppMode: context.miniAppMode,
          walletProviderSource: context.walletProviderSource,
        })) {
          farcasterNetworkSetupAttempted.current = chainId;
          setWallet({
            kind: "wrong-network",
            account: accounts[0],
            chainId
          });
          setPlanet({
            kind: "checking"
          });

          try {
            await ensureBaseSepoliaNetwork(injected);
            await waitForBaseSepoliaNetwork(injected, {
              readTimeoutMs: WALLET_BOOTSTRAP_READ_TIMEOUT_MS
            });
            await refreshWallet(injected, accounts[0], context);
          } catch (error) {
            console.error("Mini App Base Sepolia setup failed", error);
            setWallet({
              kind: "wrong-network",
              account: accounts[0],
              chainId
            });
            setPlanet({
              kind: "idle"
            });
            setSettlementFunding({ status: "idle" });
          }
          return;
        }

        setWallet({
          kind: "wrong-network",
          account: accounts[0],
          chainId
        });
        setPlanet({
          kind: "idle"
        });
        setSettlementFunding({ status: "idle" });
        return;
      }

      setPlanet({
        kind: "checking"
      });
      setWallet({
        kind: "connected",
        account: accounts[0]
      });
      await refreshPlanet(injected, accounts[0]);
    } catch (error) {
      console.error("Wallet bootstrap failed", error);

      if (
        isTransientWalletBootstrapError(error)
        && walletBootstrapAttempts.current < WALLET_BOOTSTRAP_MAX_RETRIES
      ) {
        // A mobile wallet provider stalled an initial read. Keep the player on
        // the "Reading wallet link" state and retry shortly instead of forcing
        // a manual page refresh.
        walletBootstrapAttempts.current += 1;
        setWallet({ kind: "loading" });
        if (walletBootstrapRetryTimer.current !== undefined) {
          clearTimeout(walletBootstrapRetryTimer.current);
        }
        walletBootstrapRetryTimer.current = setTimeout(() => {
          void refreshWallet(injected, preferredAccount, context);
        }, WALLET_BOOTSTRAP_RETRY_MS);
        return;
      }

      walletBootstrapAttempts.current = 0;
      setWallet({
        kind: "disconnected"
      });
      setPlanet({
        kind: "error",
        message: walletRequestErrorMessage(error)
      });
      setSettlementFunding({ status: "idle" });
    }
  }

  async function refreshPlanet(_injected: Eip1193Provider, connectedAccount: string) {
    setPlanet({
      kind: "checking"
    });

    try {
      const indexedSettlement = await readIndexedSettlementState(settlementConfigState.apiUrl, connectedAccount);
      if (!indexedSettlement) {
        throw new Error("Settlement state is unavailable because the game API is not configured.");
      }
      if (indexedSettlement.kind === "settled") {
        setSettlementFunding({ status: "idle" });
        setPlanet({
          kind: "already-settled",
          planet: indexedSettlement.planet
        });
      } else if (indexedSettlement.kind === "indexing") {
        setSettlementFunding({ status: "idle" });
        setPlanet({
          kind: "pending",
          label: POST_SETTLEMENT_INDEXING_LABEL
        });
        try {
          const settled = await waitForIndexedSettledPlanet(settlementConfigState.apiUrl, connectedAccount);
          setPlanet({
            kind: "already-settled",
            planet: settled.planet
          });
        } catch (error) {
          setPlanet({
            kind: "error",
            message: walletRequestErrorMessage(error)
          });
        }
      } else {
        setPlanet({
          kind: "not-settled"
        });
        await refreshSettlementFunding(connectedAccount);
      }
    } catch (error) {
      console.error("Indexed settlement state read failed", error);
      setPlanet({
        kind: "error",
        message: walletRequestErrorMessage(error)
      });
      setSettlementFunding({ status: "idle" });
    }
  }

  async function refreshSettlementFunding(connectedAccount: string) {
    setSettlementFunding({ status: "loading" });
    try {
      if (!settlementConfigState.apiUrl) {
        throw new Error("Settlement funding is unavailable because the game API is not configured.");
      }
      setSettlementFunding({
        status: "ready",
        funding: await fetchSettlementFundingState(settlementConfigState.apiUrl, connectedAccount)
      });
    } catch (error) {
      setSettlementFunding({
        status: "error",
        message: walletRequestErrorMessage(error)
      });
    }
  }

  async function connectWallet() {
    setWallet({
      kind: "connecting"
    });

    const walletProvider = provider
      ? undefined
      : await loadWalletProviderDetails({ waitForFarcasterProvider: miniAppMode });
    const activeProvider = provider ?? bindWalletProviderDetails(walletProvider);
    const providerContext = provider ? walletProviderContext() : walletProviderContext(walletProvider?.source);

    if (!activeProvider) {
      setWallet({
        kind: "no-wallet"
      });
      return;
    }

    try {
      const accounts = await walletConnectionAccounts(activeProvider, providerContext);
      await refreshWallet(activeProvider, accounts[0], providerContext);
    } catch (error) {
      setWallet({
        kind: "disconnected"
      });
      setPlanet({
        kind: isUserRejected(error) ? "rejected" : "error",
        message: isUserRejected(error) ? "Wallet connection was rejected." : walletRequestErrorMessage(error)
      });
    }
  }

  async function switchNetwork() {
    if (!provider || networkSwitchPending) {
      return;
    }

    setNetworkSwitchPending(true);
    setPlanet({
      kind: "checking"
    });

    try {
      await ensureBaseSepoliaNetwork(provider);
      await waitForBaseSepoliaNetwork(provider, {
        readTimeoutMs: WALLET_BOOTSTRAP_READ_TIMEOUT_MS
      });
      await refreshWallet(provider, account);
    } catch (error) {
      if (miniAppMode && wallet.kind === "wrong-network") {
        farcasterNetworkSetupAttempted.current = undefined;
        setWallet(wallet);
        setPlanet({
          kind: "idle"
        });
        return;
      }

      setPlanet({
        kind: isUserRejected(error) ? "rejected" : "error",
        message: isUserRejected(error) ? "Network switch was rejected." : walletRequestErrorMessage(error)
      });
    } finally {
      setNetworkSwitchPending(false);
    }
  }

  async function settlePlanet() {
    await transactionActionGate.run("settlement:first-planet", async () => {
      if (!provider || wallet.kind !== "connected") {
        return;
      }

      const label = "First planet settlement";

      const funding = await refreshSettlementLaunchInfo(wallet.account, planet);
      if (!funding) {
        return;
      }

      setPlanet({
        kind: "pending",
        label: transactionAwaitingWalletLabel(label)
      });

      try {
        const txHash = await sendSettlementTransaction(
          provider,
          wallet.account,
          settlementConfig,
          settlementTransactionOptions(funding)
        );
        setPlanet({
          kind: "pending",
          label: transactionConfirmingLabel(label, txHash),
          txHash
        });
        setPlanet({
          kind: "pending",
          label: transactionSyncingLabel(label),
          txHash
        });

        const settlement = await waitForIndexedSettledPlanet(settlementConfigState.apiUrl, wallet.account);

        setPlanet({
          kind: "success",
          planet: settlement.planet
        });
      } catch (error) {
        setPlanet({
          kind: isUserRejected(error) ? "rejected" : "error",
          message: isUserRejected(error) ? "Settlement transaction was rejected." : walletRequestErrorMessage(error)
        });
      }
    });
  }

  async function refreshSettlementLaunchInfo(
    connectedAccount: string,
    currentPlanet: PlanetState,
  ): Promise<SettlementFundingState | undefined> {
    setSettlementFunding({ status: "loading" });

    try {
      const settlement = await readIndexedSettlementState(settlementConfigState.apiUrl, connectedAccount);
      if (!settlement) {
        throw new Error("Settlement state is unavailable because the game API is not configured.");
      }

      if (settlement.kind === "settled") {
        setSettlementFunding({ status: "idle" });
        setPlanet({
          kind: "already-settled",
          planet: settlement.planet,
        });
        return undefined;
      }

      if (settlement.kind === "indexing") {
        setSettlementFunding({ status: "idle" });
        setPlanet({
          kind: "pending",
          label: "Settlement confirmed. Indexing starting resources before opening planetary overview.",
        });
        return undefined;
      }

      setPlanet({ kind: "not-settled" });
      if (!settlementConfigState.apiUrl) {
        throw new Error("Settlement funding is unavailable because the game API is not configured.");
      }
      const nextFunding: SettlementFunding = {
        status: "ready",
        funding: await fetchSettlementFundingState(settlementConfigState.apiUrl, connectedAccount),
      };
      setSettlementFunding(nextFunding);

      return settlementLaunchBlocker(settlementContractConfigured(settlementConfig), nextFunding) === undefined
        ? nextFunding.funding
        : undefined;
    } catch (error) {
      setPlanet(currentPlanet.kind === "legacy-settled" ? currentPlanet : { kind: "not-settled" });
      setSettlementFunding({
        status: "error",
        message: walletRequestErrorMessage(error),
      });
      return undefined;
    }
  }

  if (hasOverview) {
    return (
      <PlayableMvpApp
        provider={provider}
        account={account}
        miniAppMode={miniAppMode}
        planet={planet.kind === "success" || planet.kind === "already-settled" ? planet.planet : undefined}
      />
    );
  }

  if (shouldShowPublicPlayableApp(wallet, planet)) {
    return (
      <PlayableMvpApp
        miniAppMode={miniAppMode}
        onConnectWallet={connectWallet}
      />
    );
  }

  const mode = preSettlementMode(wallet, planet);

  return (
    <main className="settlement-stage">
      <div className="settlement-backdrop" aria-hidden="true">
        <img alt="" src={heroUrl} />
        <div className="settlement-starfield settlement-starfield-one" />
        <div className="settlement-starfield settlement-starfield-two" />
        <div className="settlement-nebula" />
        <div className="settlement-scanlines" />
      </div>

      <SettlementSupportLink />

      <section className="settlement-shell" aria-label="First planet settlement">
        <div className="settlement-command">
          <FlowBody
            mode={mode}
            onConnect={connectWallet}
            onSettle={settlePlanet}
            onSwitchNetwork={switchNetwork}
            planet={planet}
            settlementFunding={settlementFunding}
            settlementReady={settlementContractConfigured(settlementConfig)}
            wallet={wallet}
            networkSwitchPending={networkSwitchPending}
            miniAppMode={miniAppMode}
          />
        </div>

        <SettlementScanner mode={mode} />
      </section>
    </main>
  );
}

export function SettlementSupportLink() {
  return (
    <a
      aria-label="Telegram support"
      className="settlement-support-link"
      href={TELEGRAM_SUPPORT_URL}
      rel="noopener noreferrer"
      target="_blank"
      title="Telegram support"
    >
      <TelegramIcon className="settlement-support-icon" />
      <span>Telegram</span>
    </a>
  );
}

function FlowBody({
  mode,
  onConnect,
  onSettle,
  onSwitchNetwork,
  planet,
  settlementFunding,
  settlementReady,
  wallet,
  networkSwitchPending,
  miniAppMode
}: {
  mode: ReturnType<typeof preSettlementMode>;
  onConnect: () => void;
  onSettle: () => void;
  onSwitchNetwork: () => void;
  planet: PlanetState;
  settlementFunding: SettlementFunding;
  settlementReady: boolean;
  wallet: WalletState;
  networkSwitchPending: boolean;
  miniAppMode: boolean;
}) {
  if (mode === "resolving") {
    return <StateMessage tone="scanning" title="Reading wallet link" body="Checking wallet signal and first-planet settlement state." />;
  }

  if (mode === "no-wallet") {
    return (
      <StateMessage
        title="No pilot wallet detected"
        body={noWalletDetectedMessage(miniAppMode)}
        action={<PrimaryButton onClick={onConnect}>Check again</PrimaryButton>}
        tone="warning"
      />
    );
  }

  if (mode === "connect") {
    return (
      <StateMessage
        title={wallet.kind === "connecting" ? "Waiting for pilot authorization" : miniAppMode ? "Link Farcaster Wallet" : "Link pilot wallet"}
        body={miniAppMode ? "Connect Farcaster Wallet to claim your first home world." : "Connect a wallet to claim your first home world."}
        action={<PrimaryButton disabled={wallet.kind === "connecting"} onClick={onConnect}>{miniAppMode ? "Connect Farcaster Wallet" : "Link wallet"}</PrimaryButton>}
        tone={wallet.kind === "connecting" ? "scanning" : "ready"}
      />
    );
  }

  if (mode === "wrong-network" && wallet.kind === "wrong-network") {
    if (miniAppMode) {
      return (
        <StateMessage
          title="Base Sepolia required"
          body={miniAppUnsupportedChainMessage(wallet.chainId)}
          action={
            <PrimaryButton disabled={networkSwitchPending} onClick={onSwitchNetwork}>
              {networkSwitchPending ? "Requesting Base Sepolia" : "Retry Base Sepolia"}
            </PrimaryButton>
          }
          tone="warning"
        />
      );
    }

    return (
      <StateMessage
        title="Wrong network"
        body={`Current chain ${wallet.chainId}. Switch to Base Sepolia to enter the settlement sector.`}
        action={
          <PrimaryButton disabled={networkSwitchPending} onClick={onSwitchNetwork}>
            {networkSwitchPending ? "Switching network" : "Switch network"}
          </PrimaryButton>
        }
        tone="warning"
      />
    );
  }

  if (mode === "contract-unconfigured") {
    return (
      <StateMessage
        title="Settlement beacon offline"
        body="Set VITE_VEYDRIFT_SETTLEMENT_ADDRESS to the Base Sepolia settlement contract."
        tone="warning"
      />
    );
  }

  if (mode === "pending" && planet.kind === "pending") {
    return (
      <StateMessage
        title="Colony drop in progress"
        body={planet.label ?? (planet.txHash ? `Transaction beacon: ${planet.txHash}` : "Confirm the settlement launch in your wallet.")}
        tone="scanning"
      />
    );
  }

  if (mode === "settled") {
    return (
      <StateMessage
        title="Planetfall confirmed"
        body="First-planet settlement is confirmed. Opening planetary overview."
        tone="ready"
      />
    );
  }

  if (mode === "error" && (planet.kind === "rejected" || planet.kind === "error")) {
    const errorState = settlementErrorStateMessage(planet);
    return (
      <StateMessage
        title={errorState.title}
        body={errorState.body}
        action={<PrimaryButton onClick={planet.kind === "rejected" && shouldRetryRejectedRequestWithSettlement(wallet) ? onSettle : onConnect}>Retry</PrimaryButton>}
        tone="warning"
      />
    );
  }

  const actionBlocked = settlementLaunchBlocker(settlementReady, settlementFunding) !== undefined;
  const actionLabel = settlementFunding.status === "idle" || settlementFunding.status === "loading"
    ? "Checking balance"
    : "Launch settlement";
  const title = settlementFunding.status === "error"
    ? "Settlement info unavailable"
    : settlementFunding.status === "ready" && settlementFunding.funding.unavailableReason
    ? "Settlement setup incomplete"
    : settlementFunding.status === "ready" && !settlementFunding.funding.affordable
    ? "More Base Sepolia ETH required"
    : planet.kind === "legacy-settled"
      ? "Legacy planet detected"
      : "Found your first world";

  return (
    <StateMessage
      title={title}
      body={settlementBody(planet, settlementFunding)}
      action={<PrimaryButton disabled={actionBlocked} onClick={onSettle}>{actionLabel}</PrimaryButton>}
      tone={actionBlocked ? "warning" : "ready"}
    />
  );
}

export function noWalletDetectedMessage(miniAppMode: boolean): string {
  return miniAppMode
    ? "This Farcaster client does not expose a Base wallet. Open Veydrift in a Farcaster/Base client with wallet support, or use a browser wallet."
    : "Open the bridge with an injected EVM wallet or browser wallet.";
}

export function settlementLaunchBlocker(
  settlementReady: boolean,
  settlementFunding: SettlementFunding,
): string | undefined {
  if (!settlementReady) return "Settlement contract address is not configured.";
  if (settlementFunding.status === "idle" || settlementFunding.status === "loading") {
    return "Settlement funding information is still loading.";
  }
  if (settlementFunding.status === "error") {
    return settlementFunding.message;
  }
  if (settlementFunding.funding.unavailableReason) {
    return settlementFunding.funding.unavailableReason;
  }
  if (!settlementFunding.funding.affordable) {
    return "This wallet needs more Base Sepolia ETH before launching settlement.";
  }

  return undefined;
}

function settlementTransactionOptions(funding: SettlementFundingState): SettlementTransactionOptions {
  return {
    startPriceWei: funding.startPriceWei,
  };
}

function settlementBody(planet: PlanetState, settlementFunding: SettlementFunding): string {
  const prefix = planet.kind === "legacy-settled"
    ? "This wallet has a legacy first planet but no game home planet yet. Launch a new game settlement to continue."
    : "Launch settlement and mint this wallet's home planet.";

  if (settlementFunding.status === "idle" || settlementFunding.status === "loading") {
    return `${prefix} Checking the game start price and wallet balance.`;
  }

  if (settlementFunding.status === "error") {
    return `Could not verify settlement launch info before asking your wallet to send a transaction: ${settlementFunding.message}`;
  }

  if (settlementFunding.status === "ready" && settlementFunding.funding.contractKind === "game") {
    const startPrice = formatEth(settlementFunding.funding.startPriceWei ?? 0n);
    if (settlementFunding.funding.unavailableReason) {
      return `${prefix} ${settlementFunding.funding.unavailableReason}`;
    }

    if (settlementFunding.funding.balanceWei === null) {
      return `${prefix} Settlement costs ${startPrice} ETH; Farcaster Wallet will verify this wallet's Base Sepolia balance before submission.`;
    }

    const balance = formatEth(settlementFunding.funding.balanceWei);
    return `${prefix} Settlement costs ${startPrice} ETH; this wallet has ${balance} ETH on Base Sepolia.`;
  }

  return prefix;
}

function formatEth(wei: bigint): string {
  const ether = 10n ** 18n;
  const whole = wei / ether;
  const fraction = wei % ether;
  if (fraction === 0n) return whole.toString();

  return `${whole.toString()}.${fraction.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

type IndexedSettlementState =
  | { kind: "settled"; planet: PlanetSummary }
  | { kind: "indexing" }
  | { kind: "not-settled" };

async function readIndexedSettlementState(
  apiUrl: string | undefined,
  account: string,
): Promise<IndexedSettlementState | undefined> {
  if (!apiUrl) return undefined;

  return indexedSettlementState(await fetchWalletSettlement(apiUrl, account));
}

export function indexedSettlementState(settlement: WalletSettlementResponse): IndexedSettlementState {
  if (settlement.homePlanetId || settlement.hasFirstPlanet) {
    if (!hasHydratedIndexedSettlementResources(settlement)) {
      return { kind: "indexing" };
    }

    return {
      kind: "settled",
      planet: planetSummaryFromIndexedSettlement(settlement),
    };
  }

  return { kind: "not-settled" };
}

function planetSummaryFromIndexedSettlement(settlement: WalletSettlementResponse): PlanetSummary {
  const planet = settlement.planet;
  if (!planet) {
    return {
      label: settlement.homePlanetId ? `Planet #${settlement.homePlanetId}` : "First planet settled",
      source: "chain",
    };
  }

  const summary: PlanetSummary = {
    label: planet.name ?? `Planet ${planet.galaxy}:${planet.system}:${planet.position}`,
    coordinates: `${planet.galaxy}:${planet.system}:${planet.position}`,
    fields: planet.fields.toString(),
    rarity: "Genesis settlement",
    resources: planet.resources,
    source: "chain",
    temperature: planet.temperature.toString(),
  };
  const settledAt = Number(planet.lastSettledAt);
  if (Number.isFinite(settledAt) && settledAt > 0) {
    summary.settledAt = new Date(settledAt * 1_000).toISOString();
  }

  return summary;
}

function hasHydratedIndexedSettlementResources(settlement: WalletSettlementResponse): boolean {
  const planet = settlement.planet;
  if (!planet) return false;

  const lastSettledAt = Number(planet.lastSettledAt);
  return Number.isFinite(lastSettledAt)
    && lastSettledAt > 0
    && hasHydratedSettlementResources(planet);
}

function hasHydratedSettlementResources(planet: Pick<PlanetSummary, "resources">): boolean {
  const resources = planet.resources;
  return Boolean(resources)
    && !(resources?.metal === "0" && resources.crystal === "0" && resources.deuterium === "0");
}

function StateMessage({
  action,
  body,
  title,
  tone = "ready"
}: {
  action?: ComponentChildren;
  body: string;
  title: string;
  tone?: "ready" | "scanning" | "warning";
}) {
  return (
    <div className={`settlement-state settlement-state-${tone}`}>
      <div className="settlement-state-copy">
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
      {action ? <div className="settlement-action">{action}</div> : null}
    </div>
  );
}

function SettlementScanner({ mode }: { mode: ReturnType<typeof preSettlementMode> }) {
  const status = mode === "pending"
    ? "Drop vector locked"
    : mode === "wrong-network"
      ? "Network mismatch"
      : mode === "settle"
        ? "Settlement site ready"
        : "Awaiting wallet";

  return (
    <aside className="settlement-scanner" aria-label="Orbital settlement scanner">
      <div className="scanner-frame">
        <div className="scanner-hud scanner-hud-top">
          <span>Orbital scan</span>
          <strong>{status}</strong>
        </div>
        <div className="planet-orbit planet-orbit-a" />
        <div className="planet-orbit planet-orbit-b" />
        <img alt="" className="scanner-planet" src={FIRST_PLANET_URL} />
        <div className="scanner-site scanner-site-a" />
        <div className="scanner-site scanner-site-b" />
        <div className="scanner-site scanner-site-c" />
        <div className="scanner-reticle" />
        <div className="scanner-hud scanner-hud-bottom">
          <span>Atmosphere</span>
          <strong>Habitable</strong>
        </div>
      </div>
    </aside>
  );
}

function PrimaryButton({
  children,
  disabled,
  onClick
}: {
  children: ComponentChildren;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="settlement-primary"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function buildSettlementConfig(): SettlementConfig {
  const address = import.meta.env.VITE_VEYDRIFT_SETTLEMENT_ADDRESS;

  return address ? { address } : {};
}

type WaitForIndexedSettledPlanetOptions = {
  attempts?: number;
  delay?: (ms: number) => Promise<void>;
  fetchSettlement?: typeof fetchWalletSettlement;
  intervalMs?: number;
};

export async function waitForIndexedSettledPlanet(
  apiUrl: string | undefined,
  account: string,
  options: WaitForIndexedSettledPlanetOptions = {},
) {
  if (!apiUrl) {
    throw new Error("Settlement is confirmed, but the game API is unavailable. Retry once backend indexing is reachable.");
  }

  const attempts = options.attempts ?? POST_SETTLEMENT_READ_ATTEMPTS;
  const intervalMs = options.intervalMs ?? POST_SETTLEMENT_READ_INTERVAL_MS;
  const fetchSettlement = options.fetchSettlement ?? fetchWalletSettlement;
  const wait = options.delay ?? delay;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const settlement = await fetchSettlement(apiUrl, account);
    const indexed = indexedSettlementState(settlement);
    if (indexed.kind === "settled" && indexed.planet.coordinates) {
      return indexed;
    }

    if (attempt < attempts - 1) {
      await wait(intervalMs);
    }
  }

  throw new Error(POST_SETTLEMENT_INDEXING_TIMEOUT_MESSAGE);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
