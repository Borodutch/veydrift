import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Copy, Link, TicketCheck } from "lucide-preact";
import { RetroCdBoxHero } from "./components/RetroCdBoxHero";
import { TelegramIcon } from "./components/TelegramIcon";
import { PlayableMvpApp } from "./PlayableMvpApp";
import { gameContractAddress, playableApiUrl, runtimeConfigUrl, type RuntimeConfig } from "./runtimeConfig";
import {
  readReferralStorage,
  referralCodeForLanding,
  REFERRAL_CLAIM_CODE_STORAGE_KEY,
  REFERRAL_CODE_STORAGE_KEY,
  writeReferralStorage
} from "./referralStorage";
import { preSettlementMode, type PlanetState, type WalletState } from "./settlementScreen";
import { TELEGRAM_SUPPORT_URL } from "./supportLinks";
import {
  detectFarcasterMiniApp,
  farcasterMiniAppWalletSupport,
  farcasterMiniAppPlatformType,
  hasMiniAppUrlHint,
  signalFarcasterReadyOnce,
  FARCASTER_WALLET_CAPABILITY,
  type FarcasterMiniAppPlatformType,
  type FarcasterMiniAppWalletSupport,
} from "./farcasterReady";
import {
  createTransactionActionGate,
  transactionAwaitingWalletLabel,
  transactionConfirmingLabel,
  transactionSyncingLabel,
} from "./transactionActionGate";
import {
  defaultVeydriftChainForLocation,
  ensureVeydriftNetwork,
  fetchReferralDashboard,
  fetchSettlementFundingState,
  fetchWalletSettlement,
  farcasterChainFor,
  generateReferralClaimCode,
  getChainId,
  getCurrentAccounts,
  isVeydriftChain,
  isGameBackendUnavailableMessage,
  isTransientWalletBootstrapError,
  isUserRejected,
  inspectReferralCode,
  normalizeReferralClaimCode,
  persistReferralClaimIntent,
  readMigrationReservation,
  miniAppUnsupportedChainMessage,
  WALLET_BOOTSTRAP_READ_TIMEOUT_MS,
  requestAccounts,
  getAvailableWalletProviderDetails,
  referralCommitment,
  requestReferralWalletSignature,
  recordReferralClaimTransaction,
  recordReferralRedemptionTransaction,
  redeemReferralCode,
  sendReferralClaimTransaction,
  sendSettlementTransaction,
  settlementContractConfigured,
  switchVeydriftNetwork,
  validateReferralCode,
  waitForVeydriftNetwork,
  walletRequestErrorMessage,
  type Eip1193Provider,
  type MigrationReservation,
  type PlanetSummary,
  type ReferralDashboard,
  type ReferralRedemption,
  type ReferralResolution,
  type SettlementTransactionOptions,
  type SettlementFundingState,
  type SettlementConfig,
  type VeydriftWalletChain,
  type WalletSettlementResponse
} from "./walletFlow";

const POST_SETTLEMENT_READ_ATTEMPTS = 8;
const POST_SETTLEMENT_READ_INTERVAL_MS = 2_000;
const RUNTIME_CONFIG_RETRY_MS = 5_000;
export const POST_SETTLEMENT_INDEXING_LABEL = "Settlement confirmed. Indexing starting resources before opening planetary overview.";
export const POST_SETTLEMENT_INDEXING_TIMEOUT_MESSAGE = "Settlement is confirmed, but the game API is still indexing starter resources. Retry once backend sync catches up.";
const GAME_BACKEND_UNAVAILABLE_BODY =
  "The Veydrift backend is likely restarting or temporarily unreachable. It should be back in a few minutes.";
const FARCASTER_WALLET_PROVIDER_PROBE_ATTEMPTS = 8;
const FARCASTER_WALLET_PROVIDER_PROBE_INTERVAL_MS = 250;
const FARCASTER_MINIAPP_REPORT_SUFFIX = "Please send this exact message to Veydrift support.";

type SettlementConfigState =
  | { status: "loading"; apiUrl?: string; config: SettlementConfig }
  | { status: "ready"; apiUrl?: string; config: SettlementConfig };

export function shouldAutoConnectFarcasterWallet(input: {
  miniAppMode: boolean;
  providerAvailable: boolean;
  settlementConfigReady: boolean;
  walletProviderSource: "injected" | "farcaster" | undefined;
  alreadyAttempted: boolean;
}): boolean {
  return input.providerAvailable
    && input.miniAppMode
    && input.walletProviderSource === "farcaster"
    && input.settlementConfigReady
    && !input.alreadyAttempted;
}

export function shouldAttemptFarcasterNetworkSetup(input: {
  miniAppMode: boolean;
  walletProviderSource: "injected" | "farcaster" | undefined;
  chainId: string;
  lastAttemptedChainId: string | undefined;
  requiredChain?: VeydriftWalletChain;
}): boolean {
  return input.miniAppMode
    && input.walletProviderSource === "farcaster"
    && !isVeydriftChain(input.chainId, input.requiredChain ?? defaultVeydriftChainForLocation())
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

export function shouldShowMiniAppWalletError(miniAppMode: boolean, planet: PlanetState): boolean {
  return miniAppMode && (planet.kind === "error" || planet.kind === "rejected");
}

export function shouldShowPublicPlayableApp(wallet: WalletState, planet: PlanetState): boolean {
  void wallet;
  void planet;
  return false;
}

export function shouldRefreshWalletOnProviderReady(input: {
  account: string | undefined;
  miniAppMode: boolean;
  walletProviderSource: "injected" | "farcaster" | undefined;
}): boolean {
  return !(input.miniAppMode && input.walletProviderSource === "farcaster" && !input.account);
}

export function shouldUseWalletProviderForSettlement(input: {
  miniAppMode: boolean;
  walletProviderSource: "injected" | "farcaster" | undefined;
}): boolean {
  return !input.miniAppMode || input.walletProviderSource === "farcaster";
}

export function farcasterMiniAppReportableWalletError(
  code: string,
  message: string,
  details?: {
    chainId?: string | undefined;
    source?: string | undefined;
    requestedChainId?: string | undefined;
    support?: FarcasterMiniAppWalletSupport | undefined;
    error?: unknown;
  },
): string {
  const detailRows = [
    details?.chainId ? `chain=${details.chainId}` : undefined,
    details?.requestedChainId ? `requestedChain=${details.requestedChainId}` : undefined,
    details?.source ? `source=${details.source}` : undefined,
    details?.support ? farcasterMiniAppSupportDetail(details.support) : undefined,
    ...walletErrorDetails(details?.error),
  ].filter((value): value is string => Boolean(value)).join("; ");
  const detailsCopy = detailRows ? ` Details: ${detailRows}.` : "";
  return `Wallet setup failed (${code}). ${message}${detailsCopy} ${FARCASTER_MINIAPP_REPORT_SUFFIX}`;
}

export function farcasterMiniAppSupportErrorMessage(
  support: Exclude<FarcasterMiniAppWalletSupport, { status: "supported" }>,
): string {
  const capabilities = support.capabilities.length > 0 ? support.capabilities.join(",") : "none";
  const chains = support.chains.length > 0 ? support.chains.join(",") : "none";
  const requiredChain = farcasterChainFor(defaultVeydriftChainForLocation());
  return farcasterMiniAppReportableWalletError(
    support.code,
    `${support.message} Required capability: ${FARCASTER_WALLET_CAPABILITY}. Required chain: ${requiredChain}. Reported capabilities: ${capabilities}. Reported chains: ${chains}.`,
  );
}

function farcasterMiniAppSupportDetail(support: FarcasterMiniAppWalletSupport): string {
  const capabilities = support.capabilities.length > 0 ? support.capabilities.join(",") : "none";
  const chains = support.chains.length > 0 ? support.chains.join(",") : "none";
  return `support=${support.status}/${support.status === "supported" ? "ok" : support.code}; capabilities=${capabilities}; chains=${chains}`;
}

function walletErrorDetails(error: unknown): string[] {
  if (!error || typeof error !== "object") {
    return [];
  }

  const candidate = error as { code?: unknown; message?: unknown };
  return [
    candidate.code !== undefined ? `errorCode=${String(candidate.code)}` : undefined,
    typeof candidate.message === "string" && candidate.message
      ? `errorMessage=${candidate.message.replace(/\s+/g, " ").slice(0, 240)}`
      : undefined,
  ].filter((value): value is string => Boolean(value));
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
  context: WalletProviderContext,
): Promise<string[]> {
  if (context.miniAppMode && context.walletProviderSource === "farcaster") {
    if (context.miniAppPlatformType === "web") {
      try {
        const accounts = await getCurrentAccounts(provider, WALLET_BOOTSTRAP_READ_TIMEOUT_MS);
        if (accounts[0]) {
          return accounts;
        }
      } catch {
        // Some Mini App hosts expose accounts only through the request path.
      }
    }
  }

  return requestAccounts(provider);
}

type SettlementFunding =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; funding: SettlementFundingState }
  | { status: "error"; message: string };

type ReferralProgramState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; dashboard: ReferralDashboard }
  | { status: "claiming"; dashboard: ReferralDashboard }
  | { status: "error"; message: string; dashboard?: ReferralDashboard };

export const REFERRAL_SIGNATURE_REJECTION_MESSAGE = "Wallet signature rejected — no transaction was sent";

export function referralRejectedRequestMessage(stage: "signature" | "claim-transaction"): string {
  return stage === "signature"
    ? REFERRAL_SIGNATURE_REJECTION_MESSAGE
    : "Referral claim transaction was rejected.";
}

export function referralClaimCodeAfterDashboard(
  currentCode: string,
  dashboard: ReferralDashboard,
): string {
  const invite = dashboard.invite ?? dashboard.invites[0];
  return invite?.status === "active" ? invite.code : currentCode;
}

export function referralInviteActionAvailability(input: {
  busy: boolean;
  claimCode: string;
  dashboard: ReferralDashboard | undefined;
  selectedCodeClaimable: boolean;
}): {
  canClaim: boolean;
  inviteActive: boolean;
} {
  const invite = input.dashboard?.invite ?? input.dashboard?.invites[0];
  const inviteActive = invite?.status === "active";
  return {
    canClaim: Boolean(
      input.dashboard?.configured
        && !input.busy
        && !inviteActive
        && /^[A-Za-z0-9_-]{1,24}$/.test(input.claimCode.trim())
        && input.selectedCodeClaimable
    ),
    inviteActive
  };
}

type ReferralValidationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "resolved"; resolution: ReferralResolution }
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
  const [referralProgram, setReferralProgram] = useState<ReferralProgramState>({ status: "idle" });
  const [referralCodeInput, setReferralCodeInput] = useState(() => referralCodeFromCurrentUrl());
  const [referralClaimCodeInput, setReferralClaimCodeInput] = useState(() => (
    readReferralStorage(REFERRAL_CLAIM_CODE_STORAGE_KEY) || generateReferralClaimCode()
  ));
  const [referralClaimInspection, setReferralClaimInspection] = useState<ReferralValidationState>({ status: "idle" });
  const [referralValidation, setReferralValidation] = useState<ReferralValidationState>({ status: "idle" });
  const transactionActionGate = useRef(createTransactionActionGate()).current;
  const farcasterAutoConnectAttempted = useRef(false);
  const farcasterNetworkSetupAttempted = useRef<string>();
  const walletProviderCleanup = useRef<(() => void) | undefined>();
  const walletBootstrapAttempts = useRef(0);
  const walletBootstrapRetryTimer = useRef<ReturnType<typeof setTimeout> | undefined>();

  const account = "account" in wallet ? wallet.account : undefined;
  const hasOverview = planet.kind === "success" || planet.kind === "already-settled";
  const settlementConfig = settlementConfigState.config;
  const requiredChain = defaultVeydriftChainForLocation();

  useEffect(() => {
    writeReferralStorage(REFERRAL_CODE_STORAGE_KEY, referralCodeInput.trim());
  }, [referralCodeInput]);

  useEffect(() => {
    writeReferralStorage(REFERRAL_CLAIM_CODE_STORAGE_KEY, referralClaimCodeInput.trim());
  }, [referralClaimCodeInput]);

  useEffect(() => {
    const dashboard = referralProgram.status === "ready"
        || referralProgram.status === "claiming"
        || referralProgram.status === "error"
      ? referralProgram.dashboard
      : undefined;
    if (!dashboard) return;
    const invite = dashboard?.invite ?? dashboard?.invites[0];
    if (invite?.status === "active") {
      setReferralClaimCodeInput((current) => referralClaimCodeAfterDashboard(current, dashboard));
    } else if (referralProgram.status === "ready") {
      setReferralClaimCodeInput((current) => current.trim() ? current : generateReferralClaimCode());
    }
  }, [referralProgram]);

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
            ...(runtimeConfig.migrationContractAddress ? {
              migrationAddress: runtimeConfig.migrationContractAddress,
            } : {}),
            ...(runtimeConfig.referralSystemAddress ? {
              referralSystemAddress: runtimeConfig.referralSystemAddress
            } : {}),
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
    if (!hasOverview || !account || !settlementConfigState.apiUrl) {
      setReferralProgram({ status: "idle" });
      return;
    }

    let disposed = false;
    setReferralProgram({ status: "loading" });
    void fetchReferralDashboard(settlementConfigState.apiUrl, account)
      .then((dashboard) => {
        if (!disposed) setReferralProgram({ status: "ready", dashboard });
      })
      .catch((error) => {
        if (!disposed) {
          setReferralProgram({
            status: "error",
            message: walletRequestErrorMessage(error)
          });
        }
      });

    return () => {
      disposed = true;
    };
  }, [account, hasOverview, settlementConfigState.apiUrl]);

  useEffect(() => {
    const code = referralClaimCodeInput.trim();
    const apiUrl = settlementConfigState.apiUrl;
    if (!hasOverview || !account || !apiUrl || !code) {
      setReferralClaimInspection({ status: "idle" });
      return;
    }

    let disposed = false;
    setReferralClaimInspection({ status: "loading" });
    const timeout = setTimeout(() => {
      void inspectReferralCode(apiUrl, code, account)
        .then((resolution) => {
          if (!disposed) setReferralClaimInspection({ status: "resolved", resolution });
        })
        .catch((error) => {
          if (!disposed) setReferralClaimInspection({ status: "error", message: walletRequestErrorMessage(error) });
        });
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(timeout);
    };
  }, [account, hasOverview, referralClaimCodeInput, settlementConfigState.apiUrl]);

  useEffect(() => {
    const code = referralCodeInput.trim();
    const apiUrl = settlementConfigState.apiUrl;
    if (!code || !apiUrl) {
      setReferralValidation({ status: "idle" });
      return;
    }

    let disposed = false;
    setReferralValidation({ status: "loading" });
    const timeout = setTimeout(() => {
      void validateReferralCode(apiUrl, code, account)
        .then((resolution) => {
          if (!disposed) setReferralValidation({ status: "resolved", resolution });
        })
        .catch((error) => {
          if (!disposed) setReferralValidation({ status: "error", message: walletRequestErrorMessage(error) });
        });
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(timeout);
    };
  }, [account, referralCodeInput, settlementConfigState.apiUrl]);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      let walletProvider = await loadWalletProviderDetails({ waitForFarcasterProvider: miniAppMode });
      if (!walletProvider?.provider && !miniAppMode) {
        walletProvider = await loadWalletProviderDetails({ waitForFarcasterProvider: true });
      }
      if (disposed) return;
      if (!shouldUseWalletProviderForSettlement({
        miniAppMode,
        walletProviderSource: walletProvider?.source,
      })) {
        const support = await readFarcasterMiniAppWalletSupport(undefined);
        if (disposed || blockUnsupportedFarcasterMiniAppWalletSupport(support)) {
          return;
        }
        showFarcasterWalletProviderUnavailable(support);
        return;
      }

      bindWalletProviderDetails(walletProvider);

      if (!walletProvider?.provider) {
        if (miniAppMode) {
          const support = await readFarcasterMiniAppWalletSupport(walletProvider?.source);
          if (disposed || blockUnsupportedFarcasterMiniAppWalletSupport(support)) {
            return;
          }
          setWallet({ kind: "disconnected" });
          setPlanet({
            kind: "error",
            message: farcasterMiniAppReportableWalletError(
              "FARCASTER_WALLET_PROVIDER_UNAVAILABLE",
              "The Farcaster Mini App SDK did not provide an Ethereum wallet provider after the app became ready.",
              { support },
            ),
          });
          return;
        }

        setWallet({ kind: "no-wallet" });
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
      if (disposed) return;
      if (!walletProvider?.provider || walletProvider.source !== "farcaster") {
        const support = await readFarcasterMiniAppWalletSupport(undefined);
        if (disposed || blockUnsupportedFarcasterMiniAppWalletSupport(support)) {
          return;
        }
        showFarcasterWalletProviderUnavailable(support);
        return;
      }

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
    if (!shouldRefreshWalletOnProviderReady({ account, miniAppMode, walletProviderSource })) {
      return;
    }

    void refreshWallet(provider, account);
  }, [account, miniAppMode, provider, settlementConfig.address, settlementConfigState.apiUrl, settlementConfigState.status, walletProviderSource]);

  useEffect(() => {
    if (!shouldAutoConnectFarcasterWallet({
      alreadyAttempted: farcasterAutoConnectAttempted.current,
      miniAppMode,
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

  async function readFarcasterMiniAppWalletSupport(source = walletProviderSource): Promise<FarcasterMiniAppWalletSupport | undefined> {
    if (!miniAppMode || source === "injected") {
      return undefined;
    }

    await signalFarcasterReadyOnce();
    return farcasterMiniAppWalletSupport(undefined, {
      requiredChain: farcasterChainFor(requiredChain),
    });
  }

  function blockUnsupportedFarcasterMiniAppWalletSupport(
    support: FarcasterMiniAppWalletSupport | undefined,
  ): boolean {
    if (!support || support.status !== "unsupported") {
      return false;
    }

    setWallet({ kind: "disconnected" });
    setPlanet({
      kind: "error",
      message: farcasterMiniAppSupportErrorMessage(support),
    });
    setSettlementFunding({ status: "idle" });
    return true;
  }

  function showFarcasterWalletProviderUnavailable(
    support: FarcasterMiniAppWalletSupport | undefined,
  ): void {
    walletProviderCleanup.current?.();
    walletProviderCleanup.current = undefined;
    setProvider(undefined);
    setWalletProviderSource(undefined);
    setWallet({ kind: "disconnected" });
    setPlanet({
      kind: "error",
      message: farcasterMiniAppReportableWalletError(
        "FARCASTER_WALLET_PROVIDER_UNAVAILABLE",
        "The Farcaster Mini App SDK did not provide an Ethereum wallet provider after the app became ready.",
        { support },
      ),
    });
    setSettlementFunding({ status: "idle" });
  }

  async function setupVeydriftNetworkForWallet(
    walletProvider: Eip1193Provider,
    context: WalletProviderContext,
  ): Promise<void> {
    if (context.miniAppMode && context.walletProviderSource === "farcaster") {
      await switchVeydriftNetwork(walletProvider, requiredChain);
      return;
    }

    await ensureVeydriftNetwork(walletProvider, requiredChain);
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

      if (!isVeydriftChain(chainId, requiredChain)) {
        if (shouldAttemptFarcasterNetworkSetup({
          chainId,
          lastAttemptedChainId: farcasterNetworkSetupAttempted.current,
          miniAppMode: context.miniAppMode,
          requiredChain,
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

          let support: FarcasterMiniAppWalletSupport | undefined;
          try {
            support = await readFarcasterMiniAppWalletSupport(context.walletProviderSource);
            if (blockUnsupportedFarcasterMiniAppWalletSupport(support)) {
              return;
            }
            await setupVeydriftNetworkForWallet(injected, context);
            await waitForVeydriftNetwork(injected, requiredChain, {
              readTimeoutMs: WALLET_BOOTSTRAP_READ_TIMEOUT_MS
            });
            await refreshWallet(injected, accounts[0], context);
          } catch (error) {
            console.error("Mini App Veydrift network setup failed", error);
            setWallet({
              kind: "wrong-network",
              account: accounts[0],
              chainId
            });
            setPlanet({
              kind: "error",
              message: farcasterMiniAppReportableWalletError(
                "FARCASTER_VEYDRIFT_CHAIN_SWITCH_FAILED",
                walletRequestErrorMessage(error),
                {
                  chainId,
                  requestedChainId: requiredChain.chainIdHex,
                  source: context.walletProviderSource,
                  support,
                  error,
                },
              ),
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
        message: context.miniAppMode && context.walletProviderSource === "farcaster"
          ? farcasterMiniAppReportableWalletError(
            "FARCASTER_WALLET_BOOTSTRAP_FAILED",
            walletRequestErrorMessage(error),
            {
              source: context.walletProviderSource,
              error,
            },
          )
          : walletRequestErrorMessage(error)
      });
      setSettlementFunding({ status: "idle" });
    }
  }

  async function refreshPlanet(injected: Eip1193Provider, connectedAccount: string) {
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
        await refreshSettlementFunding(injected, connectedAccount);
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

  async function refreshSettlementFunding(
    walletProvider: Eip1193Provider | undefined,
    connectedAccount: string,
  ) {
    setSettlementFunding({ status: "loading" });
    try {
      if (!settlementConfigState.apiUrl) {
        throw new Error("Settlement funding is unavailable because the game API is not configured.");
      }
      setSettlementFunding({
        status: "ready",
        funding: await fetchSettlementFundingWithMigration(walletProvider, connectedAccount)
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

    const supportPromise = miniAppMode
      ? readFarcasterMiniAppWalletSupport(undefined)
      : Promise.resolve(undefined);

    const walletProvider = provider
      ? undefined
      : await loadWalletProviderDetails({ waitForFarcasterProvider: miniAppMode || !provider });
    const activeProvider = provider ?? (
      shouldUseWalletProviderForSettlement({
        miniAppMode,
        walletProviderSource: walletProvider?.source,
      })
        ? bindWalletProviderDetails(walletProvider)
        : undefined
    );
    const providerContext = provider ? walletProviderContext() : walletProviderContext(walletProvider?.source);
    const support = await supportPromise;

    if (providerContext.walletProviderSource === "farcaster" && blockUnsupportedFarcasterMiniAppWalletSupport(support)) {
      return;
    }
    if (!shouldUseWalletProviderForSettlement({
      miniAppMode,
      walletProviderSource: providerContext.walletProviderSource,
    })) {
      if (blockUnsupportedFarcasterMiniAppWalletSupport(support)) {
        return;
      }
      showFarcasterWalletProviderUnavailable(support);
      return;
    }

    if (!activeProvider) {
      if (miniAppMode) {
        showFarcasterWalletProviderUnavailable(support);
      } else {
        setWallet({
          kind: "no-wallet"
        });
      }
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
        message: miniAppMode
          ? farcasterMiniAppReportableWalletError(
            isUserRejected(error) ? "FARCASTER_WALLET_REJECTED" : "FARCASTER_WALLET_ACCOUNT_FAILED",
            isUserRejected(error) ? "Wallet connection was rejected." : walletRequestErrorMessage(error),
            {
              source: providerContext.walletProviderSource,
              support,
              error,
            },
          )
          : isUserRejected(error) ? "Wallet connection was rejected." : walletRequestErrorMessage(error)
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

    let support: FarcasterMiniAppWalletSupport | undefined;
    try {
      support = await readFarcasterMiniAppWalletSupport(walletProviderSource);
      if (blockUnsupportedFarcasterMiniAppWalletSupport(support)) {
        return;
      }
      const context = walletProviderContext();
      await setupVeydriftNetworkForWallet(provider, context);
      await waitForVeydriftNetwork(provider, requiredChain, {
        readTimeoutMs: WALLET_BOOTSTRAP_READ_TIMEOUT_MS
      });
      await refreshWallet(provider, account);
    } catch (error) {
      if (miniAppMode && wallet.kind === "wrong-network") {
        farcasterNetworkSetupAttempted.current = undefined;
        setWallet(wallet);
        setPlanet({
          kind: "error",
          message: farcasterMiniAppReportableWalletError(
            "FARCASTER_VEYDRIFT_CHAIN_RETRY_FAILED",
            walletRequestErrorMessage(error),
            {
              chainId: wallet.chainId,
              requestedChainId: requiredChain.chainIdHex,
              source: walletProviderSource,
              support,
              error,
            },
          ),
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
        const referral = funding.migrationContractAddress
          ? undefined
          : await referralRedemptionForSettlement(wallet.account);
        const txHash = await sendSettlementTransaction(
          provider,
          wallet.account,
          settlementConfig,
          settlementTransactionOptions(funding, referral)
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

        const apiUrl = settlementConfigState.apiUrl;
        if (!apiUrl) {
          throw new Error("Settlement indexing is unavailable because the game API is not configured.");
        }
        const settlement = await waitForIndexedSettledPlanet(apiUrl, wallet.account);
        if (referral) {
          try {
            await recordReferralRedemptionTransaction(
              apiUrl,
              referral.code,
              wallet.account,
              txHash
            );
          } catch (error) {
            console.error("Failed to record confirmed referral redemption", error);
          }
        }

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

  async function referralRedemptionForSettlement(invitee: string): Promise<ReferralRedemption | undefined> {
    const code = referralCodeInput.trim();
    if (!code) return undefined;
    if (!settlementConfigState.apiUrl) {
      throw new Error("Referral codes are unavailable because the game API is not configured.");
    }
    const resolution = await validateReferralCode(settlementConfigState.apiUrl, code, invitee);
    setReferralValidation({ status: "resolved", resolution });
    if (!resolution.valid) {
      throw new Error(resolution.message);
    }
    return redeemReferralCode(settlementConfigState.apiUrl, code, invitee);
  }

  async function refreshReferralProgram(connectedAccount = account) {
    if (!connectedAccount || !settlementConfigState.apiUrl) return;
    setReferralProgram({ status: "loading" });
    try {
      setReferralProgram({
        status: "ready",
        dashboard: await fetchReferralDashboard(settlementConfigState.apiUrl, connectedAccount)
      });
    } catch (error) {
      setReferralProgram({
        status: "error",
        message: walletRequestErrorMessage(error)
      });
    }
  }

  async function claimReferralInvite() {
    await transactionActionGate.run("referral:claim", async () => {
      if (!provider || wallet.kind !== "connected" || !settlementConfigState.apiUrl) return;
      const currentDashboard = referralProgram.status === "ready"
          || referralProgram.status === "claiming"
          || referralProgram.status === "error"
        ? referralProgram.dashboard
        : undefined;
      if (currentDashboard) {
        setReferralProgram({ status: "claiming", dashboard: currentDashboard });
      } else {
        setReferralProgram({ status: "loading" });
      }

      let waitingForSignature = true;
      try {
        const inviteCode = normalizeReferralClaimCode(referralClaimCodeInput);
        setReferralClaimCodeInput(inviteCode);
        const commitment = referralCommitment(inviteCode, wallet.account);
        const signature = await requestReferralWalletSignature(
          provider,
          wallet.account,
          "claim-transaction",
          commitment
        );
        waitingForSignature = false;
        await persistReferralClaimIntent(
          settlementConfigState.apiUrl,
          wallet.account,
          inviteCode,
          commitment,
          signature
        );
        const txHash = await sendReferralClaimTransaction(
          provider,
          wallet.account,
          settlementConfig,
          inviteCode
        );
        await recordReferralClaimTransactionAfterIndexing(
          settlementConfigState.apiUrl,
          wallet.account,
          inviteCode,
          commitment,
          txHash,
          signature
        );
        await refreshReferralProgram(wallet.account);
      } catch (error) {
        setReferralProgram({
          status: "error",
          message: isUserRejected(error)
            ? referralRejectedRequestMessage(waitingForSignature ? "signature" : "claim-transaction")
            : walletRequestErrorMessage(error),
          ...(currentDashboard ? { dashboard: currentDashboard } : {})
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
        funding: await fetchSettlementFundingWithMigration(provider, connectedAccount),
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

  async function fetchSettlementFundingWithMigration(
    walletProvider: Eip1193Provider | undefined,
    connectedAccount: string,
  ): Promise<SettlementFundingState> {
    const funding = await fetchSettlementFundingState(settlementConfigState.apiUrl!, connectedAccount);
    const chainMigrationReservation = walletProvider
      ? await readMigrationReservation(walletProvider, settlementConfig.migrationAddress, connectedAccount)
      : null;
    const migrationReservation = migrationReservationForSettlementFunding(
      chainMigrationReservation,
      funding.migrationReservation
    );
    const activeMigration = Boolean(
      migrationReservation?.exists && !migrationReservation.claimed && settlementConfig.migrationAddress
    );
    const migrationClaim = activeMigration ? funding.migrationClaim ?? null : null;
    const unavailableReason = funding.unavailableReason
      ?? (activeMigration && !migrationClaim
        ? "Migration state snapshot is not ready for this wallet yet."
        : undefined);
    return {
      ...funding,
      ...(activeMigration
        ? { migrationClaim, migrationContractAddress: settlementConfig.migrationAddress }
        : {}),
      migrationReservation,
      ...(unavailableReason ? { unavailableReason } : {}),
    };
  }

  if (hasOverview) {
    return (
      <PlayableMvpApp
        provider={provider}
        account={account}
        miniAppMode={miniAppMode}
        planet={planet.kind === "success" || planet.kind === "already-settled" ? planet.planet : undefined}
        referralProgramPanel={(
          <ReferralProgramPanel
            claimCode={referralClaimCodeInput}
            inspection={referralClaimInspection}
            onClaimCodeChange={setReferralClaimCodeInput}
            onClaim={claimReferralInvite}
            state={referralProgram}
            startPriceWei={referralBenefitStartPriceWei(settlementFunding)}
          />
        )}
      />
    );
  }

  const mode = preSettlementMode(wallet, planet);

  return (
    <RetroCdBoxHero ariaLabel="First planet settlement" support={<SettlementSupportLink />}>
      <ReferralCodeField
        disabled={planet.kind === "pending"}
        onChange={setReferralCodeInput}
        validation={referralValidation}
        value={referralCodeInput}
      />
      <FlowBody
        mode={mode}
        referralCodeInput={referralCodeInput}
        referralValidation={referralValidation}
        onConnect={connectWallet}
        onSettle={settlePlanet}
        onSwitchNetwork={switchNetwork}
        planet={planet}
        settlementFunding={settlementFunding}
        settlementReady={settlementContractConfigured(settlementConfig)}
        wallet={wallet}
        networkSwitchPending={networkSwitchPending}
        miniAppMode={miniAppMode}
        requiredChain={requiredChain}
      />
    </RetroCdBoxHero>
  );
}

function ReferralProgramPanel({
  claimCode,
  inspection,
  onClaim,
  onClaimCodeChange,
  startPriceWei,
  state,
}: {
  claimCode: string;
  inspection: ReferralValidationState;
  onClaim: () => void;
  onClaimCodeChange: (value: string) => void;
  startPriceWei: bigint | null;
  state: ReferralProgramState;
}) {
  const dashboard = state.status === "ready"
      || state.status === "claiming"
      || state.status === "error"
    ? state.dashboard
    : undefined;
  const invite = dashboard?.invite ?? dashboard?.invites[0];
  const claiming = state.status === "claiming";
  const busy = claiming;
  const claimCodeValid = /^[A-Za-z0-9_-]{1,24}$/.test(claimCode.trim());
  const inspected = inspection.status === "resolved" ? inspection.resolution : undefined;
  const selectedCodeClaimable = inspected?.ownership === "available"
    || (inspected?.ownership === "owned_by_you" && inspected.renewable);
  const { canClaim, inviteActive } = referralInviteActionAvailability({
    busy,
    claimCode,
    dashboard,
    selectedCodeClaimable: Boolean(selectedCodeClaimable)
  });
  const actionLabel = claiming
    ? "Claiming code"
    : inspected?.ownership === "owned_by_you" && inspected.renewable
      ? "Reactivate code"
      : inviteActive
        ? "Invite active"
        : "Claim code";
  const rewardLabel = dashboard?.rewardPerUseWei
    ? `${formatEth(BigInt(dashboard.rewardPerUseWei))} ETH`
    : referralInviterRewardLabel(startPriceWei);

  return (
    <section className="referral-program" aria-label="Referral invites">
      <div className="referral-program-inner">
        <div className="referral-program-header">
          <div>
            <span className="referral-kicker">Referral invites</span>
            <h2>Invite commanders</h2>
            <span className="referral-benefit-copy">
              Earn {rewardLabel}. Invitees start with 1,000 M / 1,000 C / 0 D after validation.
            </span>
          </div>
          <button
            className="referral-claim-button"
            disabled={!canClaim}
            onClick={onClaim}
            type="button"
          >
            <TicketCheck aria-hidden="true" size={15} />
            {actionLabel}
          </button>
        </div>

        <div className="referral-benefits" aria-label="Referral benefits">
          <div>
            <strong>Inviter</strong>
            <span>50% current starting fee: {rewardLabel}</span>
          </div>
          <div>
            <strong>Invitee</strong>
            <span>2x starting resources: 1,000 M / 1,000 C / 0 D</span>
          </div>
        </div>

        <label className="referral-claim-code-field">
          <span>Invite code</span>
          <input
            autoComplete="off"
            disabled={busy || inviteActive}
            inputMode="text"
            maxLength={24}
            onInput={(event) => onClaimCodeChange((event.currentTarget as HTMLInputElement).value)}
            placeholder="borodutch"
            value={claimCode}
          />
        </label>
        {inviteActive && invite ? (
          <p className="referral-muted">
            Current code {invite.code} is active until {formatDateTime(invite.expiresAt)}. A new available code or any permanently owned valid code can be selected after expiry.
          </p>
        ) : invite?.status === "renewable" ? (
          <p className="referral-muted">
            The previous invite window expired {formatDateTime(invite.expiresAt)}. Enter a new available code or a permanently owned valid code to activate the next window.
          </p>
        ) : null}
        {!claimCodeValid && !inviteActive ? (
          <p className="referral-muted">Use 1–24 letters, numbers, underscores, or hyphens.</p>
        ) : null}

        {!inviteActive && claimCodeValid ? <ReferralClaimInspectionMessage state={inspection} /> : null}

        {state.status === "loading" ? (
          <p className="referral-muted">Loading invite code.</p>
        ) : state.status === "error" ? (
          <p className="referral-error">{state.message}</p>
        ) : null}

        {dashboard && !dashboard.configured ? (
          <p className="referral-muted">Referral invites are not configured on this deployment.</p>
        ) : null}

        {dashboard?.nextRedemptionAt ? (
          <p className="referral-muted">Next invite use opens {formatDateTime(dashboard.nextRedemptionAt)}.</p>
        ) : null}

        {dashboard ? (
          <p className="referral-muted">
            Rewards: {formatEth(BigInt(dashboard.totalAccruedRewardsWei))} ETH accrued · {formatEth(BigInt(dashboard.totalPaidRewardsWei))} ETH paid · {formatEth(BigInt(dashboard.claimableRewardsWei))} ETH claimable.
          </p>
        ) : null}

        {invite ? (
          <div className="referral-link-row">
            <div>
              <strong>{invite.link}</strong>
              <span>
                {invite.status === "active"
                  ? `Owned by you · active · ${invite.remainingRedemptions}/3 uses left today`
                  : invite.status === "renewable"
                    ? "Owned by you · renewable"
                    : "Owned by you · another code is active"}
              </span>
              {invite.expiresAt ? <span>Expires {formatDateTime(invite.expiresAt)}</span> : null}
              <span>{invite.redemptionCount} total invite use{invite.redemptionCount === 1 ? "" : "s"}</span>
            </div>
            {inviteActive ? (
              <div className="referral-copy-actions">
                <button
                  className="referral-copy-button"
                  onClick={() => void navigator.clipboard?.writeText(invite.code)}
                  type="button"
                >
                  <Copy aria-hidden="true" size={14} />
                  Copy code
                </button>
                <button
                  className="referral-copy-button"
                  onClick={() => void navigator.clipboard?.writeText(invite.link)}
                  type="button"
                >
                  <Link aria-hidden="true" size={14} />
                  Copy link
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          state.status !== "loading" ? <p className="referral-muted">No invite link claimed yet.</p> : null
        )}

        {dashboard?.redemptions.length ? (
          <div className="referral-link-row" aria-label="Referral redemption history">
            <div>
              <strong>On-chain redemption history</strong>
              {dashboard.redemptions.map((redemption) => (
                <span key={`${redemption.txHash}:${redemption.invitee}`}>
                  {redemption.invitee.slice(0, 6)}…{redemption.invitee.slice(-4)} · {redemption.rewardAmountWei === null ? "legacy reward amount unavailable" : `${formatEth(BigInt(redemption.rewardAmountWei))} ETH`} · {redemption.paymentStatus.replace("legacy_unknown", "legacy payment state unavailable")} · {formatDateTime(redemption.redeemedAt)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ReferralCodeField({
  disabled,
  onChange,
  validation,
  value,
}: {
  disabled?: boolean;
  onChange: (value: string) => void;
  validation: ReferralValidationState;
  value: string;
}) {
  return (
    <label className="referral-code-field">
      <span>Got invite code?</span>
      <input
        autoComplete="off"
        disabled={disabled}
        inputMode="text"
        onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
        placeholder="Paste invite code"
        value={value}
      />
      {value.trim() ? <ReferralValidationMessage state={validation} /> : null}
    </label>
  );
}

function ReferralClaimInspectionMessage({ state }: { state: ReferralValidationState }) {
  if (state.status === "loading" || state.status === "idle") {
    return <p className="referral-muted">Checking permanent ownership on-chain.</p>;
  }
  if (state.status === "error") {
    return <p className="referral-error">{state.message}</p>;
  }
  const { resolution } = state;
  if (resolution.status === "invalid") {
    return <p className="referral-error">Invalid · use 1–24 URL-safe characters.</p>;
  }
  if (resolution.ownership === "available") {
    return (
      <p className="referral-muted">
        Available · this normalized code can be permanently claimed.
        {resolution.remainingRedemptions === 0 && resolution.nextRedemptionAt
          ? ` Invite quota exhausted until ${formatDateTime(resolution.nextRedemptionAt)}.`
          : ""}
      </p>
    );
  }
  if (resolution.ownership === "owned_by_you") {
    return (
      <p className="referral-muted">
        {resolution.renewable
          ? "Owned by you · invite window is renewable."
          : "Owned by you · another invite code is currently active."}
        {resolution.remainingRedemptions === 0 && resolution.nextRedemptionAt
          ? ` Quota exhausted until ${formatDateTime(resolution.nextRedemptionAt)}.`
          : ` ${resolution.remainingRedemptions}/3 inviter uses remain.`}
      </p>
    );
  }
  return (
    <p className="referral-error">
      Reserved by another wallet · {resolution.status === "inactive"
        ? "the owner may renew it."
        : `active until ${resolution.expiresAt ? formatDateTime(resolution.expiresAt) : "the indexed expiry"}.`}
    </p>
  );
}

function ReferralValidationMessage({ state }: { state: ReferralValidationState }) {
  if (state.status === "loading" || state.status === "idle") {
    return <span className="referral-muted">Checking invite against on-chain referral state.</span>;
  }
  if (state.status === "error") {
    return <span className="referral-error">{state.message}</span>;
  }
  const { resolution } = state;
  const detail = resolution.status === "active"
    ? `Active · ${resolution.remainingRedemptions}/3 inviter uses remain in the rolling window.`
    : resolution.status === "inactive"
      ? "Inactive · this permanently owned code must be renewed by its owner."
      : resolution.status === "exhausted"
        ? `Exhausted · next use opens ${resolution.nextRedemptionAt ? formatDateTime(resolution.nextRedemptionAt) : "after the on-chain reset"}.`
        : resolution.status === "self_invite"
          ? "Self-invite blocked on-chain."
          : resolution.status === "already_redeemed"
            ? "This wallet already used a referral invite."
            : resolution.status === "available"
              ? "Available but not active · no referral benefit will be claimed."
              : resolution.status === "unavailable"
                ? "Current on-chain price is unavailable; referral settlement is paused."
                : "Invalid invite code · no referral benefit will be claimed.";
  return (
    <span className={resolution.valid ? "referral-muted" : "referral-error"}>{detail}</span>
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

function referralCodeFromCurrentUrl(): string {
  if (typeof window === "undefined") return "";
  const persisted = readReferralStorage(REFERRAL_CODE_STORAGE_KEY);
  const linked = referralCodeForLanding(window.location.search, persisted);
  if (linked === persisted) return persisted;
  if (linked) {
    writeReferralStorage(REFERRAL_CODE_STORAGE_KEY, linked);
    return linked;
  }
  return persisted;
}

function referralBenefitStartPriceWei(settlementFunding: SettlementFunding): bigint | null {
  return settlementFunding.status === "ready"
    ? settlementFunding.funding.startPriceWei
    : null;
}

function referralInviterRewardLabel(startPriceWei: bigint | null): string {
  if (startPriceWei === null) return "current on-chain reward unavailable";
  const rewardWei = startPriceWei / 2n;
  return `${formatEth(rewardWei)} ETH`;
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function FlowBody({
  mode,
  onConnect,
  onSettle,
  onSwitchNetwork,
  planet,
  referralCodeInput,
  referralValidation,
  settlementFunding,
  settlementReady,
  wallet,
  networkSwitchPending,
  miniAppMode,
  requiredChain
}: {
  mode: ReturnType<typeof preSettlementMode>;
  onConnect: () => void;
  onSettle: () => void;
  onSwitchNetwork: () => void;
  planet: PlanetState;
  referralCodeInput: string;
  referralValidation: ReferralValidationState;
  settlementFunding: SettlementFunding;
  settlementReady: boolean;
  wallet: WalletState;
  networkSwitchPending: boolean;
  miniAppMode: boolean;
  requiredChain: VeydriftWalletChain;
}) {
  const networkName = requiredChain.chainName;
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
        title={wallet.kind === "connecting" ? "Waiting for wallet authorization" : "Link wallet"}
        body="Connect a wallet to claim your first home world."
        action={<PrimaryButton disabled={wallet.kind === "connecting"} onClick={onConnect}>Link wallet</PrimaryButton>}
        tone={wallet.kind === "connecting" ? "scanning" : "ready"}
      />
    );
  }

  if (mode === "wrong-network" && wallet.kind === "wrong-network") {
    if (miniAppMode) {
      return (
        <StateMessage
          title={`${networkName} required`}
          body={miniAppUnsupportedChainMessage(wallet.chainId, requiredChain)}
          action={
            <PrimaryButton disabled={networkSwitchPending} onClick={onSwitchNetwork}>
              {networkSwitchPending ? `Requesting ${networkName}` : `Retry ${networkName}`}
            </PrimaryButton>
          }
          tone="warning"
        />
      );
    }

    return (
      <StateMessage
        title="Wrong network"
        body={`Current chain ${wallet.chainId}. Switch to ${networkName} to enter the settlement sector.`}
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
        body={`Set VITE_VEYDRIFT_SETTLEMENT_ADDRESS to the ${networkName} settlement contract.`}
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

  const actionBlocked = settlementLaunchBlocker(settlementReady, settlementFunding) !== undefined
    || referralSettlementBlocker(referralCodeInput, referralValidation) !== undefined;
  const migrationReservation = activeMigrationReservation(settlementFunding);
  const actionLabel = settlementFunding.status === "idle" || settlementFunding.status === "loading"
    ? "Checking balance"
    : migrationReservation
      ? "Migrate planet"
      : "Launch settlement";
  const title = settlementFunding.status === "error"
    ? "Settlement info unavailable"
    : settlementFunding.status === "ready" && settlementFunding.funding.unavailableReason
    ? "Settlement setup incomplete"
    : settlementFunding.status === "ready" && !settlementFunding.funding.affordable
    ? `More ${networkName} ETH required`
    : migrationReservation
      ? "Reserved planet found"
    : planet.kind === "legacy-settled"
      ? "Legacy planet detected"
      : "Found your first world";

  return (
    <StateMessage
      title={title}
      body={settlementBody(planet, settlementFunding, networkName, referralCodeInput, referralValidation)}
      action={<PrimaryButton disabled={actionBlocked} onClick={onSettle}>{actionLabel}</PrimaryButton>}
      tone={actionBlocked ? "warning" : "ready"}
    />
  );
}

export function noWalletDetectedMessage(miniAppMode: boolean): string {
  return miniAppMode
    ? "This client does not expose a Base wallet. Open Veydrift with wallet support, or use a browser wallet."
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
    return "This wallet needs more ETH before launching settlement.";
  }

  return undefined;
}

export function referralSettlementBlocker(
  code: string,
  validation: ReferralValidationState
): string | undefined {
  if (!code.trim()) return undefined;
  if (validation.status === "idle" || validation.status === "loading") {
    return "Referral validation is still loading.";
  }
  if (validation.status === "error") return validation.message;
  return validation.resolution.valid ? undefined : validation.resolution.message;
}

function settlementTransactionOptions(
  funding: SettlementFundingState,
  referral?: ReferralRedemption
): SettlementTransactionOptions {
  return {
    ...(funding.migrationClaim ? { migrationClaim: funding.migrationClaim } : {}),
    ...(funding.migrationContractAddress
      ? { migrationContractAddress: funding.migrationContractAddress }
      : {}),
    ...(referral ? { referral } : {}),
    startPriceWei: funding.startPriceWei,
  };
}

function activeMigrationReservation(settlementFunding: SettlementFunding): MigrationReservation | null {
  if (settlementFunding.status !== "ready") return null;
  const reservation = settlementFunding.funding.migrationReservation;
  return reservation?.exists && !reservation.claimed ? reservation : null;
}

export function migrationReservationForSettlementFunding(
  chainReservation: MigrationReservation | null,
  backendReservation: MigrationReservation | null | undefined,
): MigrationReservation | null {
  const reservation = chainReservation ?? backendReservation ?? null;
  return reservation?.claimed ? null : reservation;
}

function settlementBody(
  planet: PlanetState,
  settlementFunding: SettlementFunding,
  networkName: string,
  referralCode = "",
  referralValidation: ReferralValidationState = { status: "idle" },
): string {
  const migrationReservation = activeMigrationReservation(settlementFunding);
  const prefix = planet.kind === "legacy-settled"
    ? "This wallet has a legacy first planet but no game home planet yet. Launch a new game settlement to continue."
    : migrationReservation
      ? `Claim the reserved testnet planet at ${migrationReservation.galaxy}:${migrationReservation.system}:${migrationReservation.position}.`
      : "Launch settlement and mint this wallet's home planet.";
  const referralPreview = referralCode.trim() && !migrationReservation
    ? referralValidation.status === "resolved" && referralValidation.resolution.valid
      ? " Invite code verified: referral settlement starts this planet with 1,000 metal / 1,000 crystal / 0 deuterium."
      : referralValidation.status === "resolved"
        ? ` Invite not usable: ${referralValidation.resolution.message}`
        : referralValidation.status === "error"
          ? ` Invite validation unavailable: ${referralValidation.message}`
          : " Checking the invite on-chain before wallet submission."
    : "";

  if (settlementFunding.status === "idle" || settlementFunding.status === "loading") {
    return `${prefix} Checking the game start price and wallet balance.${referralPreview}`;
  }

  if (settlementFunding.status === "error") {
    return `Could not verify settlement launch info before asking your wallet to send a transaction: ${settlementFunding.message}${referralPreview}`;
  }

  if (settlementFunding.status === "ready" && settlementFunding.funding.contractKind === "game") {
    const startPrice = formatEth(settlementFunding.funding.startPriceWei ?? 0n);
    if (settlementFunding.funding.unavailableReason) {
      return `${prefix} ${settlementFunding.funding.unavailableReason}${referralPreview}`;
    }

    if (settlementFunding.funding.balanceWei === null) {
      return `${prefix} Settlement costs ${startPrice} ETH; your wallet will verify the ${networkName} balance before submission.${referralPreview}`;
    }

    const balance = formatEth(settlementFunding.funding.balanceWei);
    return `${prefix} Settlement costs ${startPrice} ETH; this wallet has ${balance} ETH on ${networkName}.${referralPreview}`;
  }

  return `${prefix}${referralPreview}`;
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
  const migrationAddress = import.meta.env.VITE_VEYDRIFT_MIGRATION_CONTRACT_ADDRESS;
  const referralSystemAddress = import.meta.env.VITE_VEYDRIFT_REFERRAL_SYSTEM_ADDRESS;

  return address ? {
    address,
    ...(migrationAddress ? { migrationAddress } : {}),
    ...(referralSystemAddress ? { referralSystemAddress } : {}),
  } : {};
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

async function recordReferralClaimTransactionAfterIndexing(
  apiUrl: string,
  wallet: string,
  code: string,
  commitment: string,
  txHash: string,
  signature: string
): Promise<void> {
  const attempts = 12;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await recordReferralClaimTransaction(apiUrl, wallet, code, commitment, txHash, signature);
      return;
    } catch (error) {
      if (!isReferralClaimIndexingLag(error) || attempt === attempts - 1) {
        throw error;
      }
      await delay(2_500);
    }
  }
}

function isReferralClaimIndexingLag(error: unknown): boolean {
  return /referral claim transaction is not indexed|referral_claim_unconfirmed/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
