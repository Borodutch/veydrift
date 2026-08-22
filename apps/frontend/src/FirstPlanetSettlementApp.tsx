import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ChevronDown, Coins, Copy, FileText, Gift, Link, RefreshCw, Share2, TicketCheck, UserRound } from "lucide-preact";
import { ComingSoonApp } from "./ComingSoonApp";
import { TelegramIcon } from "./components/TelegramIcon";
import { PlayableMvpApp } from "./PlayableMvpApp";
import { RankingCommanderLink, RankingsPagination, RankingsTable } from "./components/RankingsPage";
import { Skeleton, SkeletonRegion } from "./components/Skeleton";
import { buildInspectPath } from "./inspectRoutes";
import { apiBaseUrlForRuntimeConfig, gameContractAddress, playableApiUrl, runtimeConfigUrl, type RuntimeConfig } from "./runtimeConfig";
import { readReferralStorage, referralCodeFromText, referralCodeForLanding, REFERRAL_CLAIM_CODE_STORAGE_KEY, REFERRAL_CODE_STORAGE_KEY, writeReferralStorage } from "./referralStorage";
import { copyReferralText, type ReferralCopyOutcome } from "./referralClipboard";
import { preSettlementMode, type PlanetState, type WalletState } from "./settlementScreen";
import { TELEGRAM_SUPPORT_URL, WHITEPAPER_URL } from "./supportLinks";
import { fetchReferralShareImage, shareReferralOnX } from "./referralShare";
import { haptic } from "./haptics";
import { playSfx } from "./sfx";
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
  confirmTransactionReceiptForProviderSource,
  defaultVeydriftChainForLocation,
  ensureVeydriftNetwork,
  farcasterChainFor,
  generateReferralClaimCode,
  getChainId,
  getCurrentAccounts,
  isVeydriftChain,
  isGameBackendUnavailableMessage,
  isTransientWalletBootstrapError,
  isUserRejected,
  normalizeReferralClaimCode,
  readMigrationReservation,
  readWalletNativeBalance,
  miniAppUnsupportedChainMessage,
  WALLET_BOOTSTRAP_READ_TIMEOUT_MS,
  requestAccounts,
  getAvailableWalletProviderDetails,
  referralCommitment,
  referralClaimErrorMessage,
  requestReferralWalletSignature,
  redeemReferralCode,
  redeemPaidAllianceInvite,
  paidAllianceInviteLocationState,
  sendReferralClaimTransaction,
  sendSettlementTransaction,
  settlementFundingShortfallWei,
  settlementFundingWithWalletBalance,
  settlementContractConfigured,
  switchVeydriftNetwork,
  waitForVeydriftNetwork,
  walletRequestErrorMessage,
  type Eip1193Provider,
  type MigrationReservation,
  type PlanetSummary,
  type ReferralDashboard,
  type ReferralRedemption,
  type PaidAllianceInviteRedemption,
  type PaidAllianceInviteResolution,
  type ReferralResolution,
  type SettlementTransactionOptions,
  type SettlementFundingState,
  type SettlementConfig,
  type VeydriftWalletChain,
  type WalletProviderSource,
  type WalletSettlementResponse,
} from "./walletFlow";
import { backendDataStoreFor } from "./backendDataStore";
import { useBackendDataQuery } from "./useBackendDataQuery";
import { walletRecoveryCopy, walletRecoveryDeviceForNavigator, walletRecoveryPageUrl, type WalletRecoveryDevice } from "./walletRecovery";
import { connectWalletConnect, walletConnectEnabled } from "./reownWallet";

type FetchWalletSettlement = typeof import("./walletFlow").fetchWalletSettlement;

const POST_SETTLEMENT_READ_ATTEMPTS = 8;
const POST_SETTLEMENT_READ_INTERVAL_MS = 2_000;
const RUNTIME_CONFIG_RETRY_MS = 5_000;
export const POST_SETTLEMENT_INDEXING_LABEL = "Settlement confirmed. Indexing starting resources before opening planetary overview.";
export const POST_SETTLEMENT_INDEXING_TIMEOUT_MESSAGE = "Settlement is confirmed, but the game API is still indexing starter resources. Retry once backend sync catches up.";
const GAME_BACKEND_UNAVAILABLE_BODY = "The Veydrift backend is likely restarting or temporarily unreachable. It should be back in a few minutes.";
const FARCASTER_WALLET_PROVIDER_PROBE_ATTEMPTS = 8;
const FARCASTER_WALLET_PROVIDER_PROBE_INTERVAL_MS = 250;
const FARCASTER_MINIAPP_REPORT_SUFFIX = "Please send this exact message to Veydrift support.";

type SettlementConfigState = { status: "loading"; apiUrl?: string; config: SettlementConfig } | { status: "ready"; apiUrl?: string; config: SettlementConfig };

export function shouldAutoConnectFarcasterWallet(input: {
  miniAppMode: boolean;
  providerAvailable: boolean;
  settlementConfigReady: boolean;
  walletProviderSource: WalletProviderSource | undefined;
  alreadyAttempted: boolean;
}): boolean {
  return input.providerAvailable && input.miniAppMode && input.walletProviderSource === "farcaster" && input.settlementConfigReady && !input.alreadyAttempted;
}

export function shouldAttemptFarcasterNetworkSetup(input: {
  miniAppMode: boolean;
  walletProviderSource: WalletProviderSource | undefined;
  chainId: string;
  lastAttemptedChainId: string | undefined;
  requiredChain?: VeydriftWalletChain;
}): boolean {
  return (
    input.miniAppMode &&
    input.walletProviderSource === "farcaster" &&
    !isVeydriftChain(input.chainId, input.requiredChain ?? defaultVeydriftChainForLocation()) &&
    input.lastAttemptedChainId !== input.chainId
  );
}

export function shouldRetryFarcasterWalletProviderProbe(input: { attempt: number; maxAttempts?: number; miniAppMode: boolean; providerAvailable: boolean }): boolean {
  return input.miniAppMode && !input.providerAvailable && input.attempt < (input.maxAttempts ?? FARCASTER_WALLET_PROVIDER_PROBE_ATTEMPTS);
}

export function shouldRetryRejectedRequestWithSettlement(wallet: WalletState): boolean {
  return wallet.kind === "connected";
}

export function isSameWalletChainId(currentChainId: string | undefined, nextChainId: string | undefined): boolean {
  if (!currentChainId || !nextChainId) return false;

  try {
    return BigInt(currentChainId) === BigInt(nextChainId);
  } catch {
    return currentChainId.trim().toLowerCase() === nextChainId.trim().toLowerCase();
  }
}

export function shouldShowMiniAppWalletError(miniAppMode: boolean, planet: PlanetState): boolean {
  return miniAppMode && (planet.kind === "error" || planet.kind === "rejected");
}

export function shouldShowPublicPlayableApp(wallet: WalletState, planet: PlanetState): boolean {
  void wallet;
  void planet;
  return false;
}

export function shouldRefreshWalletOnProviderReady(input: { account: string | undefined; miniAppMode: boolean; walletProviderSource: WalletProviderSource | undefined }): boolean {
  return !(input.miniAppMode && input.walletProviderSource === "farcaster" && !input.account);
}

export function shouldUseWalletProviderForSettlement(input: { miniAppMode: boolean; walletProviderSource: WalletProviderSource | undefined }): boolean {
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
  ]
    .filter((value): value is string => Boolean(value))
    .join("; ");
  const detailsCopy = detailRows ? ` Details: ${detailRows}.` : "";
  return `Wallet setup failed (${code}). ${message}${detailsCopy} ${FARCASTER_MINIAPP_REPORT_SUFFIX}`;
}

export function farcasterMiniAppSupportErrorMessage(support: Exclude<FarcasterMiniAppWalletSupport, { status: "supported" }>): string {
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
    typeof candidate.message === "string" && candidate.message ? `errorMessage=${candidate.message.replace(/\s+/g, " ").slice(0, 240)}` : undefined,
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

export async function walletConnectionAccounts(provider: Eip1193Provider, context: WalletProviderContext): Promise<string[]> {
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

type SettlementFunding = { status: "idle" } | { status: "loading" } | { status: "ready"; funding: SettlementFundingState } | { status: "error"; message: string };

type ReferralProgramState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; dashboard: ReferralDashboard }
  | { status: "claiming"; dashboard: ReferralDashboard }
  | { status: "error"; message: string; dashboard?: ReferralDashboard };

type ReferralProgramPhase = { status: "idle" } | { status: "claiming" } | { status: "error"; message: string };

type PaidAllianceInviteValidationState = { status: "idle" } | { status: "loading" } | { status: "resolved"; resolution: PaidAllianceInviteResolution } | { status: "error"; message: string };

export const REFERRAL_SIGNATURE_REJECTION_MESSAGE = "Wallet signature rejected — no transaction was sent";
const REFERRAL_INVITE_TOP_UP_REFRESH_MIN_DELAY_MS = 1_000;

export function referralRejectedRequestMessage(stage: "signature" | "claim-transaction"): string {
  return stage === "signature" ? REFERRAL_SIGNATURE_REJECTION_MESSAGE : "Referral claim transaction was rejected.";
}

export function referralClaimCodeAfterDashboard(currentCode: string, dashboard: ReferralDashboard): string {
  const invite = dashboard.invite ?? dashboard.invites[0];
  return invite?.status === "active" || invite?.status === "renewable" ? invite.code : currentCode;
}

export function referralInviteRefreshDelay(dashboard: ReferralDashboard | undefined, now = Date.now()): number | undefined {
  const invite = dashboard?.invite ?? dashboard?.invites[0];
  if (invite?.status !== "active" || invite.topUpAvailable || !invite.nextTopUpAt) return undefined;
  const nextTopUpAt = Date.parse(invite.nextTopUpAt);
  if (!Number.isFinite(nextTopUpAt)) return undefined;
  return Math.max(REFERRAL_INVITE_TOP_UP_REFRESH_MIN_DELAY_MS, nextTopUpAt - now);
}

export function referralInviteActionAvailability(input: { busy: boolean; claimCode: string; dashboard: ReferralDashboard | undefined; selectedCodeClaimable: boolean }): {
  canClaim: boolean;
  inviteActive: boolean;
} {
  const invite = input.dashboard?.invite ?? input.dashboard?.invites[0];
  const inviteActive = invite?.status === "active";
  const topUpAvailable = Boolean(inviteActive && invite?.topUpAvailable);
  const selectedCurrentCode = Boolean(inviteActive && invite?.code.toLowerCase() === input.claimCode.trim().toLowerCase());
  return {
    canClaim: Boolean(
      input.dashboard?.configured && !input.busy && (!inviteActive || (topUpAvailable && selectedCurrentCode)) && /^[A-Za-z0-9_-]{1,24}$/.test(input.claimCode.trim()) && input.selectedCodeClaimable,
    ),
    inviteActive,
  };
}

export type ReferralValidationState = { status: "idle" } | { status: "loading" } | { status: "resolved"; resolution: ReferralResolution } | { status: "error"; message: string };

type WalletProviderDetails = Awaited<ReturnType<typeof getAvailableWalletProviderDetails>>;
type WalletProviderContext = {
  miniAppMode: boolean;
  miniAppPlatformType: FarcasterMiniAppPlatformType | undefined;
  walletProviderSource: WalletProviderSource | undefined;
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
    config: buildSettlementConfig(),
  }));
  const [wallet, setWallet] = useState<WalletState>({
    kind: "loading",
  });
  const [networkSwitchPending, setNetworkSwitchPending] = useState(false);
  const [walletProviderSource, setWalletProviderSource] = useState<WalletProviderSource | undefined>();
  const [planet, setPlanet] = useState<PlanetState>({
    kind: "idle",
  });
  const [miniAppMode, setMiniAppMode] = useState(() => (typeof window !== "undefined" ? hasMiniAppUrlHint(window.location) : false));
  const [miniAppPlatformType, setMiniAppPlatformType] = useState<FarcasterMiniAppPlatformType | undefined>();
  const [settlementFunding, setSettlementFunding] = useState<SettlementFunding>({ status: "idle" });
  const [referralProgramPhase, setReferralProgramPhase] = useState<ReferralProgramPhase>({ status: "idle" });
  const [referralCodeInput, setReferralCodeInput] = useState(() => referralCodeFromCurrentUrl());
  const [paidAllianceInviteLocation] = useState(() => {
    if (typeof window === "undefined") return { kind: "none" } as const;
    const state = paidAllianceInviteLocationState(window.location);
    if (state.kind === "valid" && !state.canonical) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    return state;
  });
  const paidAllianceInviteSecret = paidAllianceInviteLocation.kind === "valid" ? paidAllianceInviteLocation.secret : "";
  const invalidPaidAllianceInvite = paidAllianceInviteLocation.kind === "invalid";
  const [referralClaimCodeInput, setReferralClaimCodeInput] = useState(() => readReferralStorage(REFERRAL_CLAIM_CODE_STORAGE_KEY) || generateReferralClaimCode());
  const farcasterAutoConnectAttempted = useRef(false);
  const farcasterNetworkSetupAttempted = useRef<string>();
  const walletProviderCleanup = useRef<(() => void) | undefined>();
  const walletBootstrapAttempts = useRef(0);
  const walletBootstrapRetryTimer = useRef<ReturnType<typeof setTimeout> | undefined>();
  const currentChainId = useRef<string>();

  const account = "account" in wallet ? wallet.account : undefined;
  const hasOverview = planet.kind === "success" || planet.kind === "already-settled";
  const settlementConfig = settlementConfigState.config;
  const requiredChain = defaultVeydriftChainForLocation();
  const currentAccount = useRef(account);
  // Provider listeners are installed by the one-time bootstrap effect. Route
  // later account changes through the current render instead of its mount-time
  // wallet/config closure.
  const refreshWalletHandler = useRef(refreshWallet);
  currentAccount.current = account;
  refreshWalletHandler.current = refreshWallet;
  const [successHoldElapsed, setSuccessHoldElapsed] = useState(false);
  const previousPlanetKind = useRef<PlanetState["kind"]>();
  const previousWalletKind = useRef<WalletState["kind"]>();
  const referralData = useMemo(() => (settlementConfigState.apiUrl ? backendDataStoreFor(settlementConfigState.apiUrl) : undefined), [settlementConfigState.apiUrl]);
  const referralDashboardKey = referralData && hasOverview && account ? referralData.key("referral-dashboard", account) : undefined;
  const referralDashboardQuery = useBackendDataQuery(
    referralData,
    referralDashboardKey,
    referralData && account ? () => referralData.referralDashboard(account) : undefined,
    Boolean(referralData && hasOverview && account),
  );
  const referralDashboard = referralDashboardQuery.snapshot?.data;
  const referralProgram: ReferralProgramState =
    !hasOverview || !account
      ? { status: "idle" }
      : referralProgramPhase.status === "claiming" && referralDashboard
        ? { status: "claiming", dashboard: referralDashboard }
        : referralProgramPhase.status === "error"
          ? {
              status: "error",
              message: referralProgramPhase.message,
              ...(referralDashboard ? { dashboard: referralDashboard } : {}),
            }
          : referralDashboardQuery.snapshot?.freshness === "failed"
            ? {
                status: "error",
                message: referralDashboardQuery.snapshot.error ?? "Referral invites could not be loaded.",
                ...(referralDashboard ? { dashboard: referralDashboard } : {}),
              }
            : referralDashboard
              ? { status: "ready", dashboard: referralDashboard }
              : { status: "loading" };
  const referralClaimCode = referralClaimCodeInput.trim();
  const referralClaimInspectionQuery = useBackendDataQuery(
    referralData,
    referralData && hasOverview && account && referralClaimCode ? referralData.key("referral-code-inspection", account, referralClaimCode) : undefined,
    referralData && account && referralClaimCode ? () => referralData.referralCodeInspection(account, referralClaimCode) : undefined,
    Boolean(referralData && hasOverview && account && referralClaimCode),
  );
  const referralClaimInspection: ReferralValidationState = !referralClaimCode
    ? { status: "idle" }
    : referralClaimInspectionQuery.snapshot?.freshness === "failed"
      ? {
          status: "error",
          message: referralClaimInspectionQuery.snapshot.error ?? "Referral code availability could not be loaded.",
        }
      : referralClaimInspectionQuery.snapshot?.data
        ? {
            status: "resolved",
            resolution: referralClaimInspectionQuery.snapshot.data,
          }
        : { status: "loading" };
  const referralCode = referralCodeInput.trim();
  const referralValidationQuery = useBackendDataQuery(
    referralData,
    referralData && referralCode ? referralData.key("referral-code-validation", referralCode, account) : undefined,
    referralData && referralCode ? () => referralData.referralCodeValidation(referralCode, account) : undefined,
    Boolean(referralData && referralCode),
  );
  const referralValidation: ReferralValidationState = !referralCode
    ? { status: "idle" }
    : referralValidationQuery.snapshot?.freshness === "failed"
      ? {
          status: "error",
          message: referralValidationQuery.snapshot.error ?? "Referral validation could not be loaded.",
        }
      : referralValidationQuery.snapshot?.data
        ? {
            status: "resolved",
            resolution: referralValidationQuery.snapshot.data,
          }
        : { status: "loading" };
  const paidAllianceInviteQuery = useBackendDataQuery(
    referralData,
    referralData && paidAllianceInviteSecret ? referralData.key("paid-alliance-invite-resolution", paidAllianceInviteSecret) : undefined,
    referralData && paidAllianceInviteSecret ? () => referralData.paidAllianceInviteResolution(paidAllianceInviteSecret) : undefined,
    Boolean(referralData && paidAllianceInviteSecret),
  );
  const paidAllianceInviteValidation: PaidAllianceInviteValidationState = !paidAllianceInviteSecret
    ? { status: "idle" }
    : paidAllianceInviteQuery.snapshot?.freshness === "failed"
      ? {
          status: "error",
          message: paidAllianceInviteQuery.snapshot.error ?? "Alliance invitation could not be verified.",
        }
      : paidAllianceInviteQuery.snapshot?.data
        ? {
            status: "resolved",
            resolution: paidAllianceInviteQuery.snapshot.data,
          }
        : { status: "loading" };
  const runtimeData = useMemo(() => backendDataStoreFor(""), []);
  const runtimeConfigKey = runtimeData.key("runtime-config", runtimeConfigUrl());
  const runtimeConfigQuery = useBackendDataQuery<RuntimeConfig>(runtimeData, runtimeConfigKey, () => runtimeData.runtimeConfig<RuntimeConfig>(runtimeConfigUrl()));

  useEffect(() => {
    const previous = previousPlanetKind.current;
    previousPlanetKind.current = planet.kind;
    if (previous === undefined || previous === planet.kind) return;
    if (planet.kind === "success") {
      playSfx("settle-success");
      haptic("success");
    } else if (planet.kind === "error" || planet.kind === "rejected") {
      playSfx("error");
      haptic("error");
    }
  }, [planet.kind]);

  useEffect(() => {
    const previous = previousWalletKind.current;
    previousWalletKind.current = wallet.kind;
    if (previous !== undefined && previous !== wallet.kind && wallet.kind === "connected") {
      playSfx("connect");
      haptic("select");
    }
  }, [wallet.kind]);

  useEffect(() => {
    if (planet.kind !== "success") {
      setSuccessHoldElapsed(false);
      return;
    }
    const timer = setTimeout(() => setSuccessHoldElapsed(true), 2_600);
    return () => clearTimeout(timer);
  }, [planet.kind]);

  useEffect(() => {
    writeReferralStorage(REFERRAL_CODE_STORAGE_KEY, referralCodeInput.trim());
  }, [referralCodeInput]);

  useEffect(() => {
    writeReferralStorage(REFERRAL_CLAIM_CODE_STORAGE_KEY, referralClaimCodeInput.trim());
  }, [referralClaimCodeInput]);

  useEffect(() => {
    const dashboard = referralProgram.status === "ready" || referralProgram.status === "claiming" || referralProgram.status === "error" ? referralProgram.dashboard : undefined;
    if (!dashboard) return;
    const invite = dashboard?.invite ?? dashboard?.invites[0];
    if (invite?.status === "active" || invite?.status === "renewable") {
      setReferralClaimCodeInput((current) => referralClaimCodeAfterDashboard(current, dashboard));
    } else if (referralProgram.status === "ready") {
      setReferralClaimCodeInput((current) => (current.trim() ? current : generateReferralClaimCode()));
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
    const runtimeConfig = runtimeConfigQuery.snapshot?.data;
    if (!runtimeConfig) {
      if (runtimeConfigQuery.snapshot?.freshness === "failed") {
        setSettlementConfigState((current) => ({
          status: "ready",
          apiUrl: playableApiUrl,
          config: current.config,
        }));
      }
      return;
    }
    setSettlementConfigState((current) => {
      const address = gameContractAddress(runtimeConfig) ?? current.config.address;
      const legacyAddress = runtimeConfig.contractAddress && runtimeConfig.contractAddress !== address ? runtimeConfig.contractAddress : undefined;
      return {
        status: "ready",
        apiUrl: apiBaseUrlForRuntimeConfig(runtimeConfig),
        config: address
          ? {
              address,
              ...(legacyAddress ? { legacyAddress } : {}),
              ...(runtimeConfig.migrationContractAddress ? { migrationAddress: runtimeConfig.migrationContractAddress } : {}),
              ...(runtimeConfig.referralSystemAddress ? { referralSystemAddress: runtimeConfig.referralSystemAddress } : {}),
              ...(runtimeConfig.paidAllianceInviteAddress
                ? {
                    paidAllianceInviteAddress: runtimeConfig.paidAllianceInviteAddress,
                  }
                : {}),
              resourceTokensConfigured: Boolean(runtimeConfig.resourceTokenAddresses.metal && runtimeConfig.resourceTokenAddresses.crystal && runtimeConfig.resourceTokenAddresses.deuterium),
            }
          : current.config,
      };
    });
  }, [runtimeConfigQuery.snapshot?.data, runtimeConfigQuery.snapshot?.freshness]);

  useEffect(() => {
    if (runtimeConfigQuery.snapshot?.freshness !== "failed") return;
    return runtimeData.startPolling("settlement-runtime-config", ["kind:runtime-config"], RUNTIME_CONFIG_RETRY_MS, "background");
  }, [runtimeConfigQuery.snapshot?.freshness, runtimeData]);

  useEffect(() => {
    const delay = referralInviteRefreshDelay(referralDashboard);
    if (!referralData || !account || !hasOverview || delay === undefined) {
      return;
    }
    return referralData.scheduleRefresh(`referral-dashboard:${account.toLowerCase()}`, [`wallet:${account.toLowerCase()}`, "kind:referral-dashboard"], delay, "background");
  }, [account, hasOverview, referralDashboard, referralData]);

  const refreshPaidAllianceInviteValidation = useCallback(() => paidAllianceInviteQuery.refetch(), [paidAllianceInviteQuery]);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      let walletProvider = await loadWalletProviderDetails({
        waitForFarcasterProvider: miniAppMode,
      });
      if (!walletProvider?.provider && !miniAppMode) {
        walletProvider = await loadWalletProviderDetails({
          waitForFarcasterProvider: true,
        });
      }
      if (disposed) return;
      if (
        !shouldUseWalletProviderForSettlement({
          miniAppMode,
          walletProviderSource: walletProvider?.source,
        })
      ) {
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

        setWallet(walletConnectEnabled(false) ? { kind: "disconnected" } : { kind: "no-wallet" });
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
      const walletProvider = await loadWalletProviderDetails({
        waitForFarcasterProvider: true,
      });
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
    if (
      !shouldRefreshWalletOnProviderReady({
        account,
        miniAppMode,
        walletProviderSource,
      })
    ) {
      return;
    }

    void refreshWallet(provider, account);
  }, [account, miniAppMode, provider, settlementConfig.address, settlementConfigState.apiUrl, settlementConfigState.status, walletProviderSource]);

  useEffect(() => {
    if (
      !shouldAutoConnectFarcasterWallet({
        alreadyAttempted: farcasterAutoConnectAttempted.current,
        miniAppMode,
        providerAvailable: Boolean(provider),
        settlementConfigReady: settlementConfigState.status === "ready",
        walletProviderSource,
      })
    ) {
      return;
    }

    farcasterAutoConnectAttempted.current = true;
    void connectWallet();
  }, [miniAppMode, miniAppPlatformType, provider, settlementConfigState.status, walletProviderSource]);

  async function loadWalletProviderDetails({
    waitForFarcasterProvider = false,
  }: {
    waitForFarcasterProvider?: boolean;
  } = {}): Promise<WalletProviderDetails> {
    if (waitForFarcasterProvider) {
      await signalFarcasterReadyOnce();
    }

    const providerOptions = {
      preferFarcasterProvider: waitForFarcasterProvider,
    };
    let walletProvider = await getAvailableWalletProviderDetails(window as typeof window & { ethereum?: Eip1193Provider }, undefined, providerOptions);

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
      walletProvider = await getAvailableWalletProviderDetails(window as typeof window & { ethereum?: Eip1193Provider }, undefined, providerOptions);
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

  function blockUnsupportedFarcasterMiniAppWalletSupport(support: FarcasterMiniAppWalletSupport | undefined): boolean {
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

  function showFarcasterWalletProviderUnavailable(support: FarcasterMiniAppWalletSupport | undefined): void {
    walletProviderCleanup.current?.();
    walletProviderCleanup.current = undefined;
    setProvider(undefined);
    setWalletProviderSource(undefined);
    setWallet({ kind: "disconnected" });
    setPlanet({
      kind: "error",
      message: farcasterMiniAppReportableWalletError("FARCASTER_WALLET_PROVIDER_UNAVAILABLE", "The Farcaster Mini App SDK did not provide an Ethereum wallet provider after the app became ready.", {
        support,
      }),
    });
    setSettlementFunding({ status: "idle" });
  }

  async function setupVeydriftNetworkForWallet(walletProvider: Eip1193Provider, context: WalletProviderContext): Promise<void> {
    if (context.miniAppMode && context.walletProviderSource === "farcaster") {
      await switchVeydriftNetwork(walletProvider, requiredChain);
      return;
    }

    await ensureVeydriftNetwork(walletProvider, requiredChain);
  }

  function bindWalletProviderDetails(walletProvider: WalletProviderDetails) {
    const injected = walletProvider?.provider;
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
      const nextAccounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      const nextAccount = nextAccounts[0];

      if (nextAccount) {
        // A provider can repeat its exposed account while the user is starting
        // a wallet action. That is not a connection change and must not remount
        // the game between pointerdown and click.
        if (currentAccount.current?.toLowerCase() === nextAccount.toLowerCase()) {
          return;
        }
        void refreshWalletHandler.current(injected, nextAccount);
      } else {
        setWallet({
          kind: "disconnected",
        });
        setPlanet({
          kind: "idle",
        });
        setSettlementFunding({ status: "idle" });
      }
    };

    const handleChainChanged = (...args: unknown[]) => {
      const nextChainId = typeof args[0] === "string" ? args[0] : undefined;
      // MetaMask can repeat the already-active chain while a wallet action is
      // starting. Remounting the hydrated game between pointerdown and click
      // destroys the Build handler before it can submit the transaction.
      if (isSameWalletChainId(currentChainId.current, nextChainId)) {
        return;
      }
      void refreshWalletHandler.current(injected);
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
        kind: "no-wallet",
      });
      setSettlementFunding({ status: "idle" });
      return;
    }

    try {
      const accounts = preferredAccount ? [preferredAccount] : await getCurrentAccounts(injected, WALLET_BOOTSTRAP_READ_TIMEOUT_MS);

      if (!accounts[0]) {
        walletBootstrapAttempts.current = 0;
        setWallet({
          kind: "disconnected",
        });
        setPlanet({
          kind: "idle",
        });
        setSettlementFunding({ status: "idle" });
        return;
      }

      if (settlementConfigState.status === "loading") {
        setWallet({
          kind: "connected",
          account: accounts[0],
        });
        setPlanet({
          kind: "checking",
        });
        return;
      }

      const chainId = await getChainId(injected, WALLET_BOOTSTRAP_READ_TIMEOUT_MS);
      currentChainId.current = chainId;
      // The flaky wallet reads (accounts + chain) both succeeded; stop counting
      // bootstrap retries.
      walletBootstrapAttempts.current = 0;

      if (!isVeydriftChain(chainId, requiredChain)) {
        if (
          shouldAttemptFarcasterNetworkSetup({
            chainId,
            lastAttemptedChainId: farcasterNetworkSetupAttempted.current,
            miniAppMode: context.miniAppMode,
            requiredChain,
            walletProviderSource: context.walletProviderSource,
          })
        ) {
          farcasterNetworkSetupAttempted.current = chainId;
          setWallet({
            kind: "wrong-network",
            account: accounts[0],
            chainId,
          });
          setPlanet({
            kind: "checking",
          });

          let support: FarcasterMiniAppWalletSupport | undefined;
          try {
            support = await readFarcasterMiniAppWalletSupport(context.walletProviderSource);
            if (blockUnsupportedFarcasterMiniAppWalletSupport(support)) {
              return;
            }
            await setupVeydriftNetworkForWallet(injected, context);
            await waitForVeydriftNetwork(injected, requiredChain, {
              readTimeoutMs: WALLET_BOOTSTRAP_READ_TIMEOUT_MS,
            });
            await refreshWallet(injected, accounts[0], context);
          } catch (error) {
            console.error("Mini App Veydrift network setup failed", error);
            setWallet({
              kind: "wrong-network",
              account: accounts[0],
              chainId,
            });
            setPlanet({
              kind: "error",
              message: farcasterMiniAppReportableWalletError("FARCASTER_VEYDRIFT_CHAIN_SWITCH_FAILED", walletRequestErrorMessage(error), {
                chainId,
                requestedChainId: requiredChain.chainIdHex,
                source: context.walletProviderSource,
                support,
                error,
              }),
            });
            setSettlementFunding({ status: "idle" });
          }
          return;
        }

        setWallet({
          kind: "wrong-network",
          account: accounts[0],
          chainId,
        });
        setPlanet({
          kind: "idle",
        });
        setSettlementFunding({ status: "idle" });
        return;
      }

      setPlanet({
        kind: "checking",
      });
      setWallet({
        kind: "connected",
        account: accounts[0],
      });
      await refreshPlanet(injected, accounts[0]);
    } catch (error) {
      console.error("Wallet bootstrap failed", error);

      if (isTransientWalletBootstrapError(error) && walletBootstrapAttempts.current < WALLET_BOOTSTRAP_MAX_RETRIES) {
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
        kind: "disconnected",
      });
      setPlanet({
        kind: "error",
        message:
          context.miniAppMode && context.walletProviderSource === "farcaster"
            ? farcasterMiniAppReportableWalletError("FARCASTER_WALLET_BOOTSTRAP_FAILED", walletRequestErrorMessage(error), {
                source: context.walletProviderSource,
                error,
              })
            : walletRequestErrorMessage(error),
      });
      setSettlementFunding({ status: "idle" });
    }
  }

  async function refreshPlanet(injected: Eip1193Provider, connectedAccount: string) {
    setPlanet({
      kind: "checking",
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
          planet: indexedSettlement.planet,
        });
      } else if (indexedSettlement.kind === "indexing") {
        setSettlementFunding({ status: "idle" });
        setPlanet({
          kind: "pending",
          label: POST_SETTLEMENT_INDEXING_LABEL,
        });
        try {
          const settled = await waitForIndexedSettledPlanet(settlementConfigState.apiUrl, connectedAccount);
          setPlanet({
            kind: "already-settled",
            planet: settled.planet,
          });
        } catch (error) {
          setPlanet({
            kind: "error",
            message: walletRequestErrorMessage(error),
          });
        }
      } else {
        setPlanet({
          kind: "not-settled",
        });
        await refreshSettlementFunding(injected, connectedAccount);
      }
    } catch (error) {
      console.error("Indexed settlement state read failed", error);
      setPlanet({
        kind: "error",
        message: walletRequestErrorMessage(error),
      });
      setSettlementFunding({ status: "idle" });
    }
  }

  async function refreshSettlementFunding(walletProvider: Eip1193Provider | undefined, connectedAccount: string) {
    setSettlementFunding({ status: "loading" });
    try {
      if (!settlementConfigState.apiUrl) {
        throw new Error("Settlement funding is unavailable because the game API is not configured.");
      }
      setSettlementFunding({
        status: "ready",
        funding: await fetchSettlementFundingWithMigration(walletProvider, connectedAccount),
      });
    } catch (error) {
      setSettlementFunding({
        status: "error",
        message: walletRequestErrorMessage(error),
      });
    }
  }

  async function connectWallet() {
    setWallet({
      kind: "connecting",
    });

    const supportPromise = miniAppMode ? readFarcasterMiniAppWalletSupport(undefined) : Promise.resolve(undefined);

    let walletProvider = provider
      ? undefined
      : await loadWalletProviderDetails({
          waitForFarcasterProvider: miniAppMode || !provider,
        });
    if (!walletProvider?.provider && !miniAppMode && walletConnectEnabled(false)) {
      walletProvider = await connectWalletConnect();
    }
    const activeProvider =
      provider ??
      (shouldUseWalletProviderForSettlement({
        miniAppMode,
        walletProviderSource: walletProvider?.source,
      })
        ? bindWalletProviderDetails(walletProvider)
        : undefined);
    const providerContext = provider ? walletProviderContext() : walletProviderContext(walletProvider?.source);
    const support = await supportPromise;

    if (providerContext.walletProviderSource === "farcaster" && blockUnsupportedFarcasterMiniAppWalletSupport(support)) {
      return;
    }
    if (
      !shouldUseWalletProviderForSettlement({
        miniAppMode,
        walletProviderSource: providerContext.walletProviderSource,
      })
    ) {
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
        setWallet(walletConnectEnabled(false) ? { kind: "disconnected" } : { kind: "no-wallet" });
      }
      return;
    }

    try {
      const accounts = await walletConnectionAccounts(activeProvider, providerContext);
      await refreshWallet(activeProvider, accounts[0], providerContext);
    } catch (error) {
      setWallet({
        kind: "disconnected",
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
          : isUserRejected(error)
            ? "Wallet connection was rejected."
            : walletRequestErrorMessage(error),
      });
    }
  }

  async function switchNetwork() {
    if (!provider || networkSwitchPending) {
      return;
    }

    setNetworkSwitchPending(true);
    setPlanet({
      kind: "checking",
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
        readTimeoutMs: WALLET_BOOTSTRAP_READ_TIMEOUT_MS,
      });
      await refreshWallet(provider, account);
    } catch (error) {
      if (miniAppMode && wallet.kind === "wrong-network") {
        farcasterNetworkSetupAttempted.current = undefined;
        setWallet(wallet);
        setPlanet({
          kind: "error",
          message: farcasterMiniAppReportableWalletError("FARCASTER_VEYDRIFT_CHAIN_RETRY_FAILED", walletRequestErrorMessage(error), {
            chainId: wallet.chainId,
            requestedChainId: requiredChain.chainIdHex,
            source: walletProviderSource,
            support,
            error,
          }),
        });
        return;
      }

      setPlanet({
        kind: isUserRejected(error) ? "rejected" : "error",
        message: isUserRejected(error) ? "Network switch was rejected." : walletRequestErrorMessage(error),
      });
    } finally {
      setNetworkSwitchPending(false);
    }
  }

  async function settlePlanet() {
    if (!provider || wallet.kind !== "connected") return;
    const apiUrl = settlementConfigState.apiUrl;
    if (!apiUrl) {
      setPlanet({
        kind: "error",
        message: "Settlement indexing is unavailable because the game API is not configured.",
      });
      return;
    }
    const label = "First planet settlement";

    if (paidAllianceInviteSecret) {
      const resolution = await refreshPaidAllianceInviteValidation();
      if (!resolution?.valid) return;
    }

    const funding = await refreshSettlementLaunchInfo(wallet.account, planet);
    if (!funding) return;

    let allianceInvite: PaidAllianceInviteRedemption | undefined;
    try {
      allianceInvite = paidAllianceInviteSecret ? await paidAllianceInviteRedemptionForSettlement(wallet.account) : undefined;
      const referral = await referralRedemptionForSettlement(wallet.account);
      const transactionOptions = allianceInvite ? settlementTransactionOptions(funding, referral, allianceInvite) : settlementTransactionOptions(funding, referral);
      const data = backendDataStoreFor(apiUrl);
      let submittedTxHash: string | undefined;
      playSfx("settle-launch");
      haptic("select");
      const completed = await data.runWriteTransaction({
        key: "settlement:first-planet",
        label,
        send: async () => {
          submittedTxHash = await sendSettlementTransaction(provider, wallet.account, settlementConfig, transactionOptions);
          return submittedTxHash;
        },
        confirm: (txHash) => confirmTransactionReceiptForProviderSource(provider, walletProviderSource, requiredChain.rpcUrls[0], txHash),
        indexing: data.indexing.settledPlanet(wallet.account),
        invalidateTags: [`wallet:${wallet.account.toLowerCase()}`, "kind:settlement", "kind:planets", "kind:queues"],
        errorLabel: (error) => (isUserRejected(error) ? "Settlement transaction was rejected." : walletRequestErrorMessage(error)),
        onStateChange: (state) => {
          if (state.phase === "confirmed") playSfx("tx-confirm");
          if (state.phase === "error") {
            setPlanet({
              kind: isUserRejected(state.error) ? "rejected" : "error",
              message: state.label ?? "First planet settlement transaction failed.",
            });
            return;
          }
          if (state.phase !== "success") {
            setPlanet({
              kind: "pending",
              label: state.label ?? label,
              ...(state.txHash ? { txHash: state.txHash } : {}),
            });
          }
        },
      });
      if (!completed) return;

      const settlement = data.value<WalletSettlementResponse>("settlement", wallet.account);
      if (!settlement) {
        throw new Error(POST_SETTLEMENT_INDEXING_TIMEOUT_MESSAGE);
      }
      const indexedSettlement = indexedSettlementState(settlement);
      if (indexedSettlement.kind !== "settled") {
        throw new Error(POST_SETTLEMENT_INDEXING_TIMEOUT_MESSAGE);
      }
      if (referral && submittedTxHash) {
        try {
          await data.recordReferralRedemption(referral.code, wallet.account, submittedTxHash);
        } catch (error) {
          console.error("Failed to record confirmed referral redemption", error);
        }
      }
      setPlanet({ kind: "success", planet: indexedSettlement.planet });
    } catch (error) {
      setPlanet({
        kind: isUserRejected(error) ? "rejected" : "error",
        message: isUserRejected(error) ? "Settlement transaction was rejected." : walletRequestErrorMessage(error),
      });
    }
  }

  async function referralRedemptionForSettlement(invitee: string): Promise<ReferralRedemption | undefined> {
    if (paidAllianceInviteSecret) return undefined;
    const code = referralCodeInput.trim();
    if (!code) return undefined;
    if (!settlementConfigState.apiUrl) {
      throw new Error("Referral codes are unavailable because the game API is not configured.");
    }
    const resolution = await backendDataStoreFor(settlementConfigState.apiUrl).referralCodeValidation(code, invitee);
    if (!resolution.valid) {
      throw new Error(resolution.message);
    }
    return redeemReferralCode(settlementConfigState.apiUrl, code, invitee);
  }

  async function paidAllianceInviteRedemptionForSettlement(invitee: string): Promise<PaidAllianceInviteRedemption | undefined> {
    if (!paidAllianceInviteSecret) return undefined;
    if (!settlementConfigState.apiUrl) {
      throw new Error("Alliance invites are unavailable because the game API is not configured.");
    }
    return redeemPaidAllianceInvite(settlementConfigState.apiUrl, paidAllianceInviteSecret, invitee);
  }

  async function claimReferralInvite() {
    if (!provider || wallet.kind !== "connected" || !settlementConfigState.apiUrl) return;
    const apiUrl = settlementConfigState.apiUrl;
    const inviteCode = normalizeReferralClaimCode(referralClaimCodeInput);
    const commitment = referralCommitment(inviteCode, wallet.account);
    let signature: string | undefined;
    let waitingForSignature = true;
    let terminalError = false;
    setReferralClaimCodeInput(inviteCode);
    setReferralProgramPhase({ status: "claiming" });
    const data = backendDataStoreFor(apiUrl);
    const completed = await data.runWriteTransaction({
      key: "referral:claim",
      label: "Referral reward claim",
      prepare: async () => {
        signature = await requestReferralWalletSignature(provider, wallet.account, "claim-transaction", commitment);
        waitingForSignature = false;
        await data.persistReferralClaimIntent(wallet.account, inviteCode, commitment, signature);
      },
      send: () => sendReferralClaimTransaction(provider, wallet.account, settlementConfig, inviteCode),
      confirm: (txHash) => confirmTransactionReceiptForProviderSource(provider, walletProviderSource, requiredChain.rpcUrls[0], txHash),
      indexing: data.indexing.referralClaim(wallet.account, inviteCode, commitment, () => signature ?? ""),
      invalidateTags: [`wallet:${wallet.account.toLowerCase()}`, "kind:referral-dashboard", "kind:referral-history"],
      errorLabel: (error) => (isUserRejected(error) ? referralRejectedRequestMessage(waitingForSignature ? "signature" : "claim-transaction") : referralClaimErrorMessage(error)),
      onStateChange: (state) => {
        if (state.phase === "success") {
          setReferralProgramPhase({ status: "idle" });
          return;
        }
        if (state.phase === "error") {
          terminalError = true;
          setReferralProgramPhase({
            status: "error",
            message: state.label ?? "Referral reward claim failed.",
          });
        }
      },
    });
    if (!completed && !terminalError) setReferralProgramPhase({ status: "idle" });
  }

  async function refreshSettlementLaunchInfo(connectedAccount: string, currentPlanet: PlanetState): Promise<SettlementFundingState | undefined> {
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

      return settlementLaunchBlocker(settlementContractConfigured(settlementConfig), nextFunding, Boolean(paidAllianceInviteSecret)) === undefined ? nextFunding.funding : undefined;
    } catch (error) {
      setPlanet(currentPlanet.kind === "legacy-settled" ? currentPlanet : { kind: "not-settled" });
      setSettlementFunding({
        status: "error",
        message: walletRequestErrorMessage(error),
      });
      return undefined;
    }
  }

  async function fetchSettlementFundingWithMigration(walletProvider: Eip1193Provider | undefined, connectedAccount: string): Promise<SettlementFundingState> {
    if (!walletProvider) {
      throw new Error("Wallet provider is unavailable. Reconnect your wallet, then retry.");
    }

    const [backendFunding, walletBalanceWei, chainMigrationReservation] = await Promise.all([
      backendDataStoreFor(settlementConfigState.apiUrl!).settlementFunding(connectedAccount),
      readWalletNativeBalance(walletProvider, connectedAccount),
      readMigrationReservation(walletProvider, settlementConfig.migrationAddress, connectedAccount),
    ]);
    const funding = settlementFundingWithWalletBalance(backendFunding, walletBalanceWei);
    const migrationReservation = migrationReservationForSettlementFunding(chainMigrationReservation, funding.migrationReservation);
    const activeMigration = Boolean(migrationReservation?.exists && !migrationReservation.claimed && settlementConfig.migrationAddress);
    const migrationClaim = activeMigration ? (funding.migrationClaim ?? null) : null;
    const unavailableReason = funding.unavailableReason ?? (activeMigration && !migrationClaim ? "Migration state snapshot is not ready for this wallet yet." : undefined);
    return {
      ...funding,
      ...(activeMigration
        ? {
            migrationClaim,
            migrationContractAddress: settlementConfig.migrationAddress,
          }
        : {}),
      migrationReservation,
      ...(unavailableReason ? { unavailableReason } : {}),
    };
  }

  const holdSuccessReveal = planet.kind === "success" && !successHoldElapsed;

  if (hasOverview && !holdSuccessReveal) {
    return (
      <PlayableMvpApp
        provider={provider}
        walletProviderSource={walletProviderSource}
        account={account}
        miniAppMode={miniAppMode}
        planet={planet.kind === "success" || planet.kind === "already-settled" ? planet.planet : undefined}
        referralProgramPanel={
          <ReferralProgramPanel
            apiBaseUrl={settlementConfigState.apiUrl ?? playableApiUrl}
            claimCode={referralClaimCodeInput}
            inspection={referralClaimInspection}
            onClaimCodeChange={setReferralClaimCodeInput}
            onClaim={claimReferralInvite}
            state={referralProgram}
            startPriceWei={referralBenefitStartPriceWei(settlementFunding)}
            wallet={account}
          />
        }
      />
    );
  }

  const mode = preSettlementMode(wallet, planet);

  return (
    <ComingSoonApp
      heroViewSignal={planet.kind === "success" ? "open" : undefined}
      hero={
        invalidPaidAllianceInvite ? (
          <StateMessage title="Invalid alliance invite" body="This link is incomplete or does not match its private invite key. Ask the alliance member for a fresh invite link." tone="warning" />
        ) : (
          <>
            {paidAllianceInviteSecret ? (
              paidAllianceInviteValidation.status === "resolved" && !paidAllianceInviteValidation.resolution.valid ? (
                <PaidAllianceInviteUnavailable resolution={paidAllianceInviteValidation.resolution} />
              ) : paidAllianceInviteValidation.status === "error" ? (
                <StateMessage
                  title="Invitation unavailable"
                  body={`Could not verify this alliance invitation: ${paidAllianceInviteValidation.message}`}
                  tone="warning"
                  action={
                    <PrimaryButton
                      onClick={() => {
                        void refreshPaidAllianceInviteValidation();
                      }}
                    >
                      Retry invitation
                    </PrimaryButton>
                  }
                />
              ) : paidAllianceInviteValidation.status === "idle" || paidAllianceInviteValidation.status === "loading" ? (
                <StateMessage title="Checking invitation" body="Verifying this private alliance invitation before connecting your wallet." tone="scanning" />
              ) : (
                <>
                  <AllianceInviteWelcome />
                  <FlowBody
                    mode={mode}
                    referralCodeInput={referralCodeInput}
                    referralValidation={referralValidation}
                    prepaidAllianceInvite
                    onConnect={connectWallet}
                    onSettle={settlePlanet}
                    onSwitchNetwork={switchNetwork}
                    planet={planet}
                    settlementFunding={settlementFunding}
                    settlementReady={settlementContractConfigured(settlementConfig)}
                    wallet={wallet}
                    networkSwitchPending={networkSwitchPending}
                    miniAppMode={miniAppMode}
                    walletRecoveryDevice={walletRecoveryDeviceForNavigator()}
                    requiredChain={requiredChain}
                  />
                </>
              )
            ) : (
              <ReferralCodeField disabled={planet.kind === "pending"} onChange={setReferralCodeInput} validation={referralValidation} value={referralCodeInput} />
            )}
            {!paidAllianceInviteSecret ? (
              <FlowBody
                mode={mode}
                referralCodeInput={referralCodeInput}
                referralValidation={referralValidation}
                prepaidAllianceInvite={false}
                onConnect={connectWallet}
                onSettle={settlePlanet}
                onSwitchNetwork={switchNetwork}
                planet={planet}
                settlementFunding={settlementFunding}
                settlementReady={settlementContractConfigured(settlementConfig)}
                wallet={wallet}
                networkSwitchPending={networkSwitchPending}
                miniAppMode={miniAppMode}
                walletRecoveryDevice={walletRecoveryDeviceForNavigator()}
                requiredChain={requiredChain}
              />
            ) : null}
          </>
        )
      }
      heroSupport={<SettlementSupportLinks />}
    />
  );
}

function ReferralProgramPanel({
  apiBaseUrl,
  claimCode,
  inspection,
  onClaim,
  onClaimCodeChange,
  startPriceWei,
  state,
  wallet,
}: {
  apiBaseUrl: string | undefined;
  claimCode: string;
  inspection: ReferralValidationState;
  onClaim: () => void;
  onClaimCodeChange: (value: string) => void;
  startPriceWei: bigint | null;
  state: ReferralProgramState;
  wallet: string | undefined;
}) {
  const dashboard = state.status === "ready" || state.status === "claiming" || state.status === "error" ? state.dashboard : undefined;
  const invite = dashboard?.invite ?? dashboard?.invites[0];
  const claiming = state.status === "claiming";
  const busy = claiming;
  const [xShareImage, setXShareImage] = useState<File | null>(null);
  const [xShareState, setXShareState] = useState<"idle" | "sharing">("idle");
  const [copyState, setCopyState] = useState<"idle" | "code-copied" | "link-copied" | "unavailable">("idle");
  const [historyPage, setHistoryPage] = useState(1);
  const [expandedHistoryWallets, setExpandedHistoryWallets] = useState<Set<string>>(() => new Set());
  const claimCodeValid = /^[A-Za-z0-9_-]{1,24}$/.test(claimCode.trim());
  const inspected = inspection.status === "resolved" ? inspection.resolution : undefined;
  const selectedCodeClaimable = inspected?.ownership === "available" || (inspected?.ownership === "owned_by_you" && inspected.renewable);
  const { canClaim, inviteActive } = referralInviteActionAvailability({
    busy,
    claimCode,
    dashboard,
    selectedCodeClaimable: Boolean(selectedCodeClaimable),
  });
  const actionLabel = claiming ? "Updating invites" : inspected?.ownership === "owned_by_you" && inspected.renewable ? "Top up to 3 uses" : "Activate 3 uses";
  const rewardLabel = dashboard?.rewardPerUseWei ? `${formatEth(BigInt(dashboard.rewardPerUseWei))} ETH` : referralInviterRewardLabel(startPriceWei);
  const accruedRewards = dashboard ? BigInt(dashboard.totalAccruedRewardsWei) : 0n;
  const claimableRewards = dashboard ? BigInt(dashboard.claimableRewardsWei) : 0n;
  const historyData = useMemo(() => (apiBaseUrl ? backendDataStoreFor(apiBaseUrl) : undefined), [apiBaseUrl]);
  const referralHistoryQuery = useBackendDataQuery(
    historyData,
    historyData && wallet && dashboard ? historyData.key("referral-history", wallet, historyPage, 25) : undefined,
    historyData && wallet && dashboard ? () => historyData.referralHistory(wallet, historyPage, 25) : undefined,
    Boolean(historyData && wallet && dashboard),
  );
  const history = referralHistoryQuery.snapshot?.data ?? null;
  const historyLoading = Boolean(historyData && wallet && dashboard && !history && referralHistoryQuery.snapshot?.freshness !== "failed");
  const historyError = referralHistoryQuery.snapshot?.freshness === "failed";
  const rankedHistoryEntries = useMemo(() => history?.entries.flatMap((entry) => (entry.ranking ? [entry.ranking] : [])) ?? [], [history]);
  const unrankedHistoryEntries = useMemo(() => history?.entries.filter((entry) => !entry.ranking) ?? [], [history]);
  const referralHistoryByWallet = useMemo(() => new Map(history?.entries.map((entry) => [entry.commander.wallet.toLowerCase(), entry]) ?? []), [history]);

  useEffect(() => {
    if (history && history.pagination.page !== historyPage) {
      setHistoryPage(history.pagination.page);
    }
  }, [history, historyPage]);

  useEffect(() => {
    let cancelled = false;
    setXShareImage(null);
    if (!inviteActive || !invite) {
      setXShareState("idle");
      return () => {
        cancelled = true;
      };
    }

    void fetchReferralShareImage(invite.link, invite.code)
      .then((image) => {
        if (cancelled) return;
        setXShareImage(image);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [inviteActive, invite?.code, invite?.link]);

  useEffect(() => {
    if (copyState === "idle" || typeof window === "undefined") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 3_500);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function shareInviteOnX() {
    if (!invite) return;
    setXShareState("sharing");
    try {
      await shareReferralOnX(invite.code, invite.link, xShareImage);
    } catch {
      // Closing or rejecting the native share sheet leaves the URL share action available.
    } finally {
      setXShareState("idle");
    }
  }

  async function copyInviteValue(value: string, kind: "code" | "link") {
    const outcome: ReferralCopyOutcome = await copyReferralText(value);
    setCopyState(outcome === "copied" ? `${kind}-copied` : "unavailable");
  }

  return (
    <section className="referral-program" aria-label="Referral invites">
      <div className="referral-program-inner">
        <div className="referral-program-header">
          <h2>Invite commanders</h2>
          {canClaim || claiming ? (
            <button className="referral-claim-button" disabled={claiming} onClick={onClaim} type="button">
              <TicketCheck aria-hidden="true" size={15} />
              {actionLabel}
            </button>
          ) : null}
        </div>

        <div className="referral-benefits" aria-label="Referral benefits">
          <div>
            <Coins aria-hidden="true" size={18} />
            <span>
              You get <strong>{rewardLabel}</strong> for inviting a friend
            </span>
          </div>
          <div>
            <Gift aria-hidden="true" size={18} />
            <span>
              Your friend gets <strong>1,000 M · 1,000 C + 2× production for 7 days</strong>
            </span>
          </div>
        </div>

        <p className="referral-daily-note">Your invite code never expires. Once every 24 hours, top it up to 3 available uses.</p>

        {!inviteActive && state.status !== "loading" ? (
          <>
            {invite?.status === "renewable" ? (
              <div className="referral-renewal-note">
                <RefreshCw aria-hidden="true" size={18} />
                <div>
                  <strong>Top up your invite code</strong>
                  <span>
                    Reset <b>{invite.code}</b> to 3 available uses.
                  </span>
                </div>
              </div>
            ) : null}

            <label className="referral-claim-code-field">
              <span>{invite?.status === "renewable" ? "Your invite code" : "Choose your invite code"}</span>
              <input
                autoComplete="off"
                disabled={busy}
                inputMode="text"
                maxLength={24}
                onInput={(event) => onClaimCodeChange((event.currentTarget as HTMLInputElement).value)}
                placeholder="borodutch"
                value={claimCode}
              />
            </label>
            {!claimCodeValid ? <p className="referral-muted">Use 1–24 letters, numbers, underscores, or hyphens.</p> : <ReferralClaimInspectionMessage state={inspection} />}
          </>
        ) : null}

        {state.status === "loading" ? (
          <SkeletonRegion className="referral-loading" label="Loading invites">
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-3 w-2/3" />
          </SkeletonRegion>
        ) : state.status === "error" ? (
          <p className="referral-error">{state.message}</p>
        ) : null}

        {dashboard && !dashboard.configured ? <p className="referral-muted">Referral invites are not configured on this deployment.</p> : null}

        {dashboard && (accruedRewards > 0n || claimableRewards > 0n) ? (
          <div className="referral-reward-summary" aria-label="Referral rewards">
            {accruedRewards > 0n ? (
              <span>
                <small>Lifetime earned</small>
                <strong>{formatEth(accruedRewards)} ETH</strong>
              </span>
            ) : null}
            {claimableRewards > 0n ? (
              <span>
                <small>Available</small>
                <strong>{formatEth(claimableRewards)} ETH</strong>
              </span>
            ) : null}
          </div>
        ) : null}

        {inviteActive && invite ? (
          <div className="referral-link-row referral-active-invite">
            <div className="referral-invite-primary">
              <label className="referral-shared-code">
                <span>Active invite code</span>
                <input aria-label="Active referral invite code" onClick={(event) => event.currentTarget.select()} onFocus={(event) => event.currentTarget.select()} readOnly value={invite.code} />
              </label>
              <a href={invite.link}>Open invite link</a>
              <div className="referral-invite-meta">
                <span>
                  <strong>{invite.remainingRedemptions}/3</strong> uses left
                </span>
                <span>Never expires</span>
                <span>{invite.topUpAvailable ? "Top up available now" : invite.nextTopUpAt ? `Next top up ${formatDateTime(invite.nextTopUpAt)}` : "Top up timing unavailable"}</span>
              </div>
            </div>
            <div className="referral-copy-actions">
              <button
                className="referral-copy-button"
                onClick={() => {
                  playSfx("copy");
                  haptic("tick");
                  void copyInviteValue(invite.code, "code");
                }}
                type="button"
              >
                <Copy aria-hidden="true" size={14} />
                {copyState === "code-copied" ? "Code copied" : "Copy code"}
              </button>
              <button
                className="referral-copy-button"
                onClick={() => {
                  playSfx("copy");
                  haptic("tick");
                  void copyInviteValue(invite.link, "link");
                }}
                type="button"
              >
                <Link aria-hidden="true" size={14} />
                {copyState === "link-copied" ? "Link copied" : "Copy link"}
              </button>
              <button className="referral-copy-button" disabled={xShareState === "sharing"} onClick={() => void shareInviteOnX()} type="button">
                <Share2 aria-hidden="true" size={14} />
                {xShareState === "sharing" ? "Opening X" : "Share on X"}
              </button>
              {copyState === "unavailable" ? <span className="referral-copy-error">Clipboard blocked — select the code above, or open the invite link.</span> : null}
            </div>
          </div>
        ) : null}

        {historyLoading && !history && dashboard?.redemptions.length ? (
          <div className="referral-history" aria-label="Loading invited commanders">
            <Skeleton className="h-4 w-28" />
            <RankingsTable entries={[]} hasLoadedData={false} loading />
          </div>
        ) : null}

        {history?.entries.length ? (
          <div className="referral-history" aria-label="Commanders you've invited">
            <h3>Commanders you've invited</h3>
            {rankedHistoryEntries.length ? (
              <RankingsTable
                active="total"
                commanderDetailForEntry={(entry) => {
                  const redemption = referralHistoryByWallet.get(entry.wallet.toLowerCase());
                  if (!redemption) return null;
                  return (
                    <>
                      <time dateTime={redemption.redeemedAt}>{formatDateTime(redemption.redeemedAt)}</time>
                      {redemption.rewardAmountWei === null ? null : ` · +${formatEth(BigInt(redemption.rewardAmountWei))} ETH`}
                    </>
                  );
                }}
                currentWallet={wallet}
                entries={rankedHistoryEntries}
                expandedWallets={expandedHistoryWallets}
                hasLoadedData
                loading={historyLoading}
                onSelectAlliance={(allianceId) => window.location.assign(buildInspectPath({ kind: "alliance", allianceId }))}
                onSelectMoon={(coords) => window.location.assign(buildInspectPath({ kind: "moon", coords }))}
                onSelectPlanet={(coords) => window.location.assign(buildInspectPath({ kind: "planet", coords }))}
                onSelectPlayer={(selectedWallet) =>
                  window.location.assign(
                    buildInspectPath({
                      kind: "player",
                      wallet: selectedWallet,
                    }),
                  )
                }
                onTogglePlayerBodies={(selectedWallet) => {
                  setExpandedHistoryWallets((current) => {
                    const next = new Set(current);
                    if (next.has(selectedWallet)) {
                      next.delete(selectedWallet);
                    } else {
                      next.add(selectedWallet);
                    }
                    return next;
                  });
                }}
              />
            ) : null}
            {unrankedHistoryEntries.length ? (
              <div className="referral-history-list">
                <div className="referral-history-header" aria-hidden="true">
                  <span>Commander</span>
                  <span>Reward</span>
                  <span>Joined</span>
                </div>
                {unrankedHistoryEntries.map((redemption) => {
                  const commanderName = redemption.commander.displayName?.trim();
                  return (
                    <div className="referral-history-row" key={`${redemption.txHash}:${redemption.invitee}`}>
                      <span className="referral-history-commander">
                        <span className="referral-history-commander-icon" aria-hidden="true">
                          <UserRound size={17} />
                        </span>
                        <span className="referral-history-commander-identity">
                          <RankingCommanderLink
                            displayName={commanderName || redemption.commander.fallbackName}
                            href={buildInspectPath({
                              kind: "player",
                              wallet: redemption.commander.wallet,
                            })}
                            wallet={redemption.commander.wallet}
                          />
                          {commanderName ? <span className="referral-history-wallet">{redemption.commander.fallbackName}</span> : null}
                        </span>
                      </span>
                      <span className="referral-history-reward">{redemption.rewardAmountWei === null ? "—" : `+${formatEth(BigInt(redemption.rewardAmountWei))} ETH`}</span>
                      <span className="referral-history-joined">
                        <span className="referral-history-joined-label">Joined </span>
                        <time dateTime={redemption.redeemedAt}>{formatDateTime(redemption.redeemedAt)}</time>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {history.pagination.totalPages > 1 ? (
              <RankingsPagination
                loading={historyLoading}
                onNext={() => setHistoryPage((page) => page + 1)}
                onPrevious={() => setHistoryPage((page) => Math.max(1, page - 1))}
                pagination={history.pagination}
              />
            ) : null}
          </div>
        ) : null}

        {historyError && !history ? <p className="referral-muted">Invite history is temporarily unavailable.</p> : null}
      </div>
    </section>
  );
}

export function ReferralCodeField({ disabled, onChange, validation, value }: { disabled?: boolean; onChange: (value: string) => void; validation: ReferralValidationState; value: string }) {
  const presentation = referralCodeDisclosurePresentation(value, validation);
  return (
    <details className="referral-code-disclosure">
      <summary className="referral-code-summary">
        <span className="referral-code-summary-chevron" aria-hidden="true">
          <ChevronDown size={16} />
        </span>
        <span className="referral-code-summary-label">Got an invite code?</span>
        <span className="referral-code-summary-value" title={presentation.code}>
          {presentation.appliedLabel}
        </span>
        {presentation.status ? (
          <span aria-live="polite" className={`referral-code-summary-status referral-code-status-${presentation.tone}`}>
            {presentation.status}
          </span>
        ) : null}
      </summary>
      <div className="referral-code-editor">
        <div className="referral-code-field">
          <label className="referral-code-input-label" htmlFor="landing-referral-code">
            Invite code
          </label>
          <span className="referral-code-input-row">
            <input
              autoComplete="off"
              disabled={disabled}
              id="landing-referral-code"
              inputMode="text"
              onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
              onPaste={(event) => {
                const code = referralCodeFromText(event.clipboardData?.getData("text") ?? "");
                if (!code) return;
                event.preventDefault();
                onChange(code);
              }}
              placeholder="Paste invite code"
              value={value}
            />
            {presentation.code ? (
              <button className="referral-code-clear" disabled={disabled} onClick={() => onChange("")} type="button">
                Clear
              </button>
            ) : null}
          </span>
        </div>
        {presentation.code ? <ReferralValidationMessage state={validation} /> : <p className="referral-code-help">Optional. Add a valid invite code before connecting your wallet.</p>}
      </div>
    </details>
  );
}

export type ReferralCodeStatusTone = "error" | "pending" | "success" | "warning";

export function referralCodeDisclosurePresentation(
  value: string,
  validation: ReferralValidationState,
): {
  appliedLabel: string;
  code: string;
  status: string | undefined;
  tone: ReferralCodeStatusTone;
} {
  const code = value.trim();
  if (!code) {
    return {
      appliedLabel: "Optional",
      code: "",
      status: undefined,
      tone: "pending",
    };
  }

  const validationPresentation = referralValidationPresentation(validation);
  return {
    appliedLabel: `Invite code: ${code}`,
    code,
    status: validationPresentation.message,
    tone: validationPresentation.tone,
  };
}

function ReferralClaimInspectionMessage({ state }: { state: ReferralValidationState }) {
  if (state.status === "loading" || state.status === "idle") {
    return <p className="referral-muted">Checking code…</p>;
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
        Available
        {resolution.topUpAvailable ? " · top up available now" : ""}
      </p>
    );
  }
  if (resolution.ownership === "owned_by_you") {
    if (resolution.renewable) {
      return null;
    }
    return (
      <p className="referral-muted">
        {resolution.status === "active" || resolution.status === "exhausted"
          ? `Next top up ${resolution.nextTopUpAt ? formatDateTime(resolution.nextTopUpAt) : "unavailable"}`
          : "Another invite code is active"}
      </p>
    );
  }
  return <p className="referral-error">Permanently owned by another wallet</p>;
}

function ReferralValidationMessage({ state }: { state: ReferralValidationState }) {
  const presentation = referralValidationPresentation(state);
  return (
    <span aria-live="polite" className={`referral-code-status referral-code-status-${presentation.tone}`}>
      {presentation.message}
    </span>
  );
}

export function referralValidationPresentation(state: ReferralValidationState): {
  message: string;
  tone: ReferralCodeStatusTone;
} {
  if (state.status === "loading" || state.status === "idle") {
    return { message: "Checking invite code…", tone: "pending" };
  }
  if (state.status === "error") {
    return {
      message: "Couldn’t check this invite code. Try again shortly.",
      tone: "error",
    };
  }

  return {
    message: referralValidationMessage(state.resolution),
    tone: referralValidationTone(state.resolution),
  };
}

export function referralValidationTone(resolution: ReferralResolution): ReferralCodeStatusTone {
  return resolution.status === "active"
    ? "success"
    : resolution.status === "inactive" || resolution.status === "exhausted" || resolution.status === "already_redeemed" || resolution.status === "available"
      ? "warning"
      : resolution.status === "unavailable" || resolution.status === "self_invite" || resolution.status === "invalid"
        ? "error"
        : "pending";
}

export function referralValidationMessage(resolution: ReferralResolution): string {
  return resolution.status === "active"
    ? `Active · ${resolution.remainingRedemptions}/3 uses left.`
    : resolution.status === "inactive"
      ? "Inactive · this wallet uses a different invite code."
      : resolution.status === "exhausted"
        ? "No uses left · ask the code owner to top it up."
        : resolution.status === "self_invite"
          ? "This wallet can’t use its own invite code."
          : resolution.status === "already_redeemed"
            ? "This wallet already used an invite code."
            : resolution.status === "available"
              ? "Available to claim."
              : resolution.status === "unavailable"
                ? "Invite pricing is unavailable. Try again later."
                : "Invalid invite code · use 1–24 letters, numbers, underscores, or hyphens.";
}

export function SettlementSupportLinks() {
  return (
    <div className="settlement-support-actions">
      <a aria-label="Telegram support" className="settlement-support-link" href={TELEGRAM_SUPPORT_URL} rel="noopener noreferrer" target="_blank" title="Telegram support">
        <TelegramIcon className="settlement-support-icon" />
        <span>Telegram</span>
      </a>
      <a aria-label="Veydrift whitepaper" className="settlement-support-link settlement-whitepaper-link" href={WHITEPAPER_URL} rel="noopener noreferrer" target="_blank" title="Veydrift whitepaper">
        <FileText className="settlement-support-icon" />
        <span>Whitepaper</span>
      </a>
    </div>
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
  return settlementFunding.status === "ready" ? settlementFunding.funding.startPriceWei : null;
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
    timeStyle: "short",
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
  prepaidAllianceInvite,
  settlementFunding,
  settlementReady,
  wallet,
  networkSwitchPending,
  miniAppMode,
  walletRecoveryDevice,
  requiredChain,
}: {
  mode: ReturnType<typeof preSettlementMode>;
  onConnect: () => void;
  onSettle: () => void;
  onSwitchNetwork: () => void;
  planet: PlanetState;
  referralCodeInput: string;
  referralValidation: ReferralValidationState;
  prepaidAllianceInvite: boolean;
  settlementFunding: SettlementFunding;
  settlementReady: boolean;
  wallet: WalletState;
  networkSwitchPending: boolean;
  miniAppMode: boolean;
  walletRecoveryDevice: WalletRecoveryDevice;
  requiredChain: VeydriftWalletChain;
}) {
  const networkName = requiredChain.chainName;
  if (mode === "resolving") {
    return (
      <StateMessage
        tone="scanning"
        title={prepaidAllianceInvite ? "Preparing your invitation" : "Getting things ready"}
        body={prepaidAllianceInvite ? "One moment while we prepare your alliance welcome." : "One moment while we check for your wallet."}
      />
    );
  }

  if (mode === "no-wallet") {
    const recoveryCopy = walletRecoveryCopy({
      device: walletRecoveryDevice,
      miniAppMode,
    });
    return (
      <StateMessage
        title="Wallet not found"
        body={recoveryCopy.body}
        action={<WalletRecoveryActions copyLinkLabel={recoveryCopy.copyLinkLabel} onRetry={onConnect} retryLabel={recoveryCopy.retryLabel} />}
        tone="warning"
      />
    );
  }

  if (mode === "connect") {
    const waitingForWallet = wallet.kind === "connecting";
    return (
      <StateMessage
        title={waitingForWallet ? "Approve in your wallet" : prepaidAllianceInvite ? "Accept your invitation" : "Claim your home world"}
        body={
          waitingForWallet
            ? "Confirm the connection request to continue."
            : prepaidAllianceInvite
              ? "Connect your wallet to join the alliance and claim your free first planet."
              : "Connect your wallet to begin your first settlement."
        }
        action={
          <PrimaryButton disabled={waitingForWallet} onClick={onConnect}>
            Connect wallet
          </PrimaryButton>
        }
        tone={waitingForWallet ? "scanning" : "ready"}
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
        body={`Veydrift runs on ${networkName}. Switch networks to continue.`}
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
    return <StateMessage title="Settlement beacon offline" body={`Set VITE_VEYDRIFT_SETTLEMENT_ADDRESS to the ${networkName} settlement contract.`} tone="warning" />;
  }

  if (mode === "pending" && planet.kind === "pending") {
    return <StateMessage title="Creating your first world" body={planet.label ?? "Confirm the launch in your wallet. We’ll open the game as soon as your world is ready."} tone="scanning" />;
  }

  if (mode === "settled") {
    return <StateMessage title="Planetfall confirmed" body="First-planet settlement is confirmed. Opening planetary overview." tone="ready" action={<SettlementBurst />} />;
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

  const balanceRecheckAvailable = settlementBalanceRecheckAvailable(settlementReady, settlementFunding, prepaidAllianceInvite);
  const actionBlocked =
    (settlementLaunchBlocker(settlementReady, settlementFunding, prepaidAllianceInvite) !== undefined && !balanceRecheckAvailable) ||
    (!prepaidAllianceInvite && referralSettlementBlocker(referralCodeInput, referralValidation) !== undefined);
  const migrationReservation = activeMigrationReservation(settlementFunding);
  const actionLabel = balanceRecheckAvailable
    ? "Recheck balance & launch"
    : settlementFunding.status === "idle" || settlementFunding.status === "loading"
      ? "Checking balance"
      : migrationReservation
        ? "Migrate planet"
        : prepaidAllianceInvite
          ? "Accept invite & launch"
          : "Launch settlement";
  const title =
    settlementFunding.status === "error"
      ? "Settlement info unavailable"
      : settlementFunding.status === "ready" && settlementFunding.funding.unavailableReason
        ? "Settlement setup incomplete"
        : settlementFunding.status === "ready" && !prepaidAllianceInvite && !settlementFunding.funding.affordable
          ? `More ${networkName} ETH required`
          : migrationReservation
            ? "Reserved planet found"
            : prepaidAllianceInvite
              ? "Your first world is waiting"
              : planet.kind === "legacy-settled"
                ? "Legacy planet detected"
                : "Found your first world";

  return (
    <StateMessage
      title={title}
      body={settlementBody(planet, settlementFunding, networkName, referralCodeInput, referralValidation, prepaidAllianceInvite)}
      action={
        <PrimaryButton disabled={actionBlocked} onClick={onSettle}>
          {actionLabel}
        </PrimaryButton>
      }
      tone={actionBlocked ? "warning" : "ready"}
    />
  );
}

export function noWalletDetectedMessage(miniAppMode: boolean, device: WalletRecoveryDevice = walletRecoveryDeviceForNavigator()): string {
  return walletRecoveryCopy({ device, miniAppMode }).body;
}

function WalletRecoveryActions({ copyLinkLabel, onRetry, retryLabel }: { copyLinkLabel: string | undefined; onRetry: () => void; retryLabel: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");

  const copyCurrentPage = async () => {
    const currentUrl = walletRecoveryPageUrl();
    if (!currentUrl) {
      setCopyState("unavailable");
      return;
    }

    const outcome = await copyReferralText(currentUrl);
    setCopyState(outcome === "copied" ? "copied" : "unavailable");
  };

  return (
    <div className="wallet-recovery-actions">
      <PrimaryButton onClick={onRetry}>{retryLabel}</PrimaryButton>
      {copyLinkLabel ? (
        <button
          aria-live="polite"
          className="wallet-recovery-copy-link"
          onClick={() => {
            void copyCurrentPage();
          }}
          type="button"
        >
          <Copy aria-hidden="true" size={16} />
          {copyState === "copied" ? "Page link copied" : copyState === "unavailable" ? "Copy unavailable — use address bar" : copyLinkLabel}
        </button>
      ) : null}
    </div>
  );
}

function AllianceInviteWelcome() {
  return (
    <div className="landing-invite-welcome" role="status">
      <span className="landing-invite-icon" aria-hidden="true">
        <Gift />
      </span>
      <div className="landing-invite-copy">
        <strong>You&apos;re invited</strong>
        <span>Join the alliance and start with a little extra momentum.</span>
      </div>
      <div className="landing-invite-benefits" aria-label="Alliance invite benefits">
        <span>Free first planet</span>
        <span>2× starter resources</span>
        <span>2× production · 7 days</span>
        <span>Gas only</span>
      </div>
    </div>
  );
}

function PaidAllianceInviteUnavailable({ resolution }: { resolution: PaidAllianceInviteResolution }) {
  const used = resolution.status === "redeemed";
  return (
    <StateMessage
      title={used ? "Invitation already used" : "Invitation unavailable"}
      body={
        used
          ? "This private alliance invitation has already been accepted. Ask the alliance member for a fresh invite link."
          : "This private alliance invitation is no longer valid. Ask the alliance member for a fresh invite link."
      }
      tone="warning"
    />
  );
}

export function settlementLaunchBlocker(settlementReady: boolean, settlementFunding: SettlementFunding, prepaidAllianceInvite = false): string | undefined {
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
  if (!prepaidAllianceInvite && !settlementFunding.funding.affordable) {
    const shortfallWei = settlementFundingShortfallWei(settlementFunding.funding);
    return shortfallWei !== null && shortfallWei > 0n
      ? `This wallet needs at least ${formatEth(shortfallWei)} more ETH on Base, plus gas, before launching settlement.`
      : "This wallet needs more ETH before launching settlement.";
  }

  return undefined;
}

export function settlementBalanceRecheckAvailable(settlementReady: boolean, settlementFunding: SettlementFunding, prepaidAllianceInvite = false): boolean {
  if (prepaidAllianceInvite) return false;
  if (!settlementReady || settlementFunding.status !== "ready") return false;
  if (settlementFunding.funding.unavailableReason || settlementFunding.funding.affordable) return false;
  const shortfallWei = settlementFundingShortfallWei(settlementFunding.funding);
  return shortfallWei !== null && shortfallWei > 0n;
}

export function referralSettlementBlocker(code: string, validation: ReferralValidationState): string | undefined {
  if (!code.trim()) return undefined;
  if (validation.status === "idle" || validation.status === "loading") {
    return "Referral validation is still loading.";
  }
  if (validation.status === "error") return validation.message;
  return validation.resolution.valid ? undefined : validation.resolution.message;
}

function settlementTransactionOptions(funding: SettlementFundingState, referral?: ReferralRedemption, allianceInvite?: PaidAllianceInviteRedemption): SettlementTransactionOptions {
  return {
    ...(funding.migrationClaim ? { migrationClaim: funding.migrationClaim } : {}),
    ...(funding.migrationContractAddress ? { migrationContractAddress: funding.migrationContractAddress } : {}),
    ...(referral ? { referral } : {}),
    ...(allianceInvite ? { allianceInvite } : {}),
    startPriceWei: funding.startPriceWei,
  };
}

function activeMigrationReservation(settlementFunding: SettlementFunding): MigrationReservation | null {
  if (settlementFunding.status !== "ready") return null;
  const reservation = settlementFunding.funding.migrationReservation;
  return reservation?.exists && !reservation.claimed ? reservation : null;
}

export function migrationReservationForSettlementFunding(chainReservation: MigrationReservation | null, backendReservation: MigrationReservation | null | undefined): MigrationReservation | null {
  const reservation = chainReservation ?? backendReservation ?? null;
  return reservation?.claimed ? null : reservation;
}

function settlementBody(
  planet: PlanetState,
  settlementFunding: SettlementFunding,
  networkName: string,
  referralCode = "",
  referralValidation: ReferralValidationState = { status: "idle" },
  prepaidAllianceInvite = false,
): string {
  const migrationReservation = activeMigrationReservation(settlementFunding);
  const prefix =
    planet.kind === "legacy-settled"
      ? "This wallet has a legacy first planet but no game home planet yet. Launch a new game settlement to continue."
      : migrationReservation
        ? `Claim the reserved testnet planet at ${migrationReservation.galaxy}:${migrationReservation.system}:${migrationReservation.position}.`
        : "Launch settlement and mint this wallet's home planet.";
  const referralPreview =
    referralCode.trim() && !migrationReservation
      ? referralValidation.status === "resolved" && referralValidation.resolution.valid
        ? " Invite code verified: referral settlement starts this planet with 1,000 metal / 1,000 crystal / 0 deuterium and 2× production for 7 days."
        : referralValidation.status === "resolved"
          ? ` Invite not usable: ${referralValidation.resolution.message}`
          : referralValidation.status === "error"
            ? ` Invite validation unavailable: ${referralValidation.message}`
            : " Checking the invite on-chain before wallet submission."
      : "";

  if (prepaidAllianceInvite) {
    return "Everything is ready. Launch your first planet to accept the invitation and join your alliance.";
  }

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
    const shortfallWei = settlementFundingShortfallWei(settlementFunding.funding);
    const shortfall =
      shortfallWei !== null && shortfallWei > 0n ? ` It needs at least ${formatEth(shortfallWei)} more ETH, plus gas, before settlement can launch.` : " Keep a little extra ETH available for gas.";
    return `${prefix} Settlement costs ${startPrice} ETH; this wallet has ${balance} ETH on ${networkName}.${shortfall}${referralPreview}`;
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

type IndexedSettlementState = { kind: "settled"; planet: PlanetSummary } | { kind: "indexing" } | { kind: "not-settled" };

async function readIndexedSettlementState(apiUrl: string | undefined, account: string): Promise<IndexedSettlementState | undefined> {
  if (!apiUrl) return undefined;

  return indexedSettlementState(await backendDataStoreFor(apiUrl).settlement(account));
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
  return Number.isFinite(lastSettledAt) && lastSettledAt > 0 && hasHydratedSettlementResources(planet);
}

function hasHydratedSettlementResources(planet: Pick<PlanetSummary, "resources">): boolean {
  const resources = planet.resources;
  return Boolean(resources) && !(resources?.metal === "0" && resources.crystal === "0" && resources.deuterium === "0");
}

function StateMessage({
  action,
  body,
  title,
  tone = "ready",
  visual,
}: {
  action?: ComponentChildren;
  body: string;
  title: string;
  tone?: "ready" | "scanning" | "warning";
  visual?: ComponentChildren;
}) {
  return (
    <div className={`settlement-state settlement-state-${tone} ${tone === "warning" ? "state-shake" : "state-enter"}`}>
      <div className="settlement-state-copy">
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
      {visual}
      {action ? <div className="settlement-action">{action}</div> : null}
    </div>
  );
}

const SETTLE_BURST_COLORS = ["#80f1ff", "#f6b35c", "#8cffc8", "#c4b5fd"] as const;

function SettlementBurst() {
  const particles = useMemo(
    () =>
      Array.from({ length: 16 }, (_, index) => ({
        angle: (index / 16) * 360 + (index % 3) * 7,
        color: SETTLE_BURST_COLORS[index % SETTLE_BURST_COLORS.length],
        delay: (index % 4) * 45,
        distance: 96 + (index % 5) * 28,
        duration: 760 + (index % 4) * 140,
        size: 5 + (index % 3) * 3,
      })),
    [],
  );

  return (
    <div className="settle-burst" aria-hidden="true">
      {particles.map((particle) => (
        <span
          key={particle.angle}
          style={{
            "--burst-angle": `${particle.angle}deg`,
            "--burst-color": particle.color,
            "--burst-delay": `${particle.delay}ms`,
            "--burst-distance": `${particle.distance}px`,
            "--burst-duration": `${particle.duration}ms`,
            "--burst-size": `${particle.size}px`,
          }}
        />
      ))}
    </div>
  );
}

function PrimaryButton({ children, disabled, onClick }: { children: ComponentChildren; disabled?: boolean; onClick: () => void }) {
  return (
    <button className="settlement-primary" disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function buildSettlementConfig(): SettlementConfig {
  const address = import.meta.env.VITE_VEYDRIFT_SETTLEMENT_ADDRESS;
  const migrationAddress = import.meta.env.VITE_VEYDRIFT_MIGRATION_CONTRACT_ADDRESS;
  const referralSystemAddress = import.meta.env.VITE_VEYDRIFT_REFERRAL_SYSTEM_ADDRESS;
  const paidAllianceInviteAddress = import.meta.env.VITE_VEYDRIFT_PAID_ALLIANCE_INVITE_ADDRESS;

  return address
    ? {
        address,
        ...(migrationAddress ? { migrationAddress } : {}),
        ...(referralSystemAddress ? { referralSystemAddress } : {}),
        ...(paidAllianceInviteAddress ? { paidAllianceInviteAddress } : {}),
      }
    : {};
}

type WaitForIndexedSettledPlanetOptions = {
  attempts?: number;
  delay?: (ms: number) => Promise<void>;
  fetchSettlement?: FetchWalletSettlement;
  intervalMs?: number;
};

export async function waitForIndexedSettledPlanet(apiUrl: string | undefined, account: string, options: WaitForIndexedSettledPlanetOptions = {}) {
  if (!apiUrl) {
    throw new Error("Settlement is confirmed, but the game API is unavailable. Retry once backend indexing is reachable.");
  }

  const attempts = options.attempts ?? POST_SETTLEMENT_READ_ATTEMPTS;
  const intervalMs = options.intervalMs ?? POST_SETTLEMENT_READ_INTERVAL_MS;
  const fetchSettlement: FetchWalletSettlement = options.fetchSettlement ?? ((baseUrl, wallet, readOptions) => backendDataStoreFor(baseUrl).settlement(wallet, readOptions));
  const settlement = await backendDataStoreFor(apiUrl).waitForIndexed(
    () => fetchSettlement(apiUrl, account),
    (value) => {
      const indexed = indexedSettlementState(value);
      return indexed.kind === "settled" && Boolean(indexed.planet.coordinates);
    },
    {
      attempts,
      intervalMs,
      ...(options.delay ? { delay: options.delay } : {}),
      timeoutError: POST_SETTLEMENT_INDEXING_TIMEOUT_MESSAGE,
    },
  );
  const indexed = indexedSettlementState(settlement);
  if (indexed.kind === "settled" && indexed.planet.coordinates) return indexed;
  throw new Error(POST_SETTLEMENT_INDEXING_TIMEOUT_MESSAGE);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
