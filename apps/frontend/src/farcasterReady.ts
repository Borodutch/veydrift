export type FarcasterReadyClient = {
  isInMiniApp?: (timeoutMs?: number) => Promise<boolean>;
  context?: Promise<{
    client?: {
      platformType?: FarcasterMiniAppPlatformType;
    };
  }>;
  getCapabilities?: () => Promise<readonly string[]> | readonly string[];
  getChains?: () => Promise<readonly string[]> | readonly string[];
  actions: {
    ready: (options?: Record<string, unknown>) => Promise<void> | void;
  };
};

export type FarcasterMiniAppPlatformType = "web" | "mobile" | "unknown";
export type FarcasterMiniAppWalletSupport =
  | { status: "supported"; capabilities: string[]; chains: string[] }
  | { status: "unknown"; code: string; capabilities: string[]; chains: string[]; message: string }
  | { status: "unsupported"; code: string; capabilities: string[]; chains: string[]; message: string };

type ReadyScheduler = (callback: () => void) => void;

export const FARCASTER_BASE_SEPOLIA_CHAIN = "eip155:84532";
export const FARCASTER_WALLET_CAPABILITY = "wallet.getEthereumProvider";

let readyPromise: Promise<void> | undefined;
let sdkModule: Promise<typeof import("@farcaster/miniapp-sdk")> | undefined;

/** The Mini App SDK, loaded on first use: it's a large chunk of JavaScript a regular browser tab never needs. */
export function loadFarcasterSdk() {
  sdkModule ??= import("@farcaster/miniapp-sdk");
  return sdkModule.then((module) => module.sdk);
}

/** The SDK's own first check: only an iframe or a React Native web view can host a Mini App. */
export function mightBeFarcasterMiniApp(): boolean {
  return typeof window !== "undefined" && (Boolean((window as Window & { ReactNativeWebView?: unknown }).ReactNativeWebView) || window !== window.parent);
}

async function hostClient(client: FarcasterReadyClient | undefined): Promise<FarcasterReadyClient | undefined> {
  if (client) return client;
  return mightBeFarcasterMiniApp() ? (await loadFarcasterSdk()) as unknown as FarcasterReadyClient : undefined;
}

// Only a host that answers the SDK handshake counts: the Base app opens the same
// ?miniApp=true URLs in a plain in-app browser with an injected wallet.
export async function detectFarcasterMiniApp(
  client?: FarcasterReadyClient,
): Promise<boolean> {
  const host = await hostClient(client).catch(() => undefined);
  return host?.isInMiniApp?.(500).catch(() => false) ?? false;
}

export async function farcasterMiniAppPlatformType(
  client?: FarcasterReadyClient,
): Promise<FarcasterMiniAppPlatformType> {
  try {
    const host = await hostClient(client);
    const context = await withTimeout(host?.context ?? Promise.resolve(undefined), 1_200);
    return context?.client?.platformType ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function farcasterMiniAppWalletSupport(
  client?: FarcasterReadyClient,
  {
    requiredCapability = FARCASTER_WALLET_CAPABILITY,
    requiredChain = FARCASTER_BASE_SEPOLIA_CHAIN,
    timeoutMs = 1_200,
  }: {
    requiredCapability?: string;
    requiredChain?: string;
    timeoutMs?: number;
  } = {},
): Promise<FarcasterMiniAppWalletSupport> {
  const host = await hostClient(client).catch(() => undefined);
  const capabilities = await readMiniAppStringList(
    () => host?.getCapabilities?.(),
    timeoutMs,
    "FARCASTER_CAPABILITIES_UNAVAILABLE",
    "Farcaster wallet support could not be checked.",
  );
  if (capabilities.status === "reported" && !capabilities.values.includes(requiredCapability)) {
    return {
      status: "unsupported",
      code: "FARCASTER_WALLET_CAPABILITY_MISSING",
      capabilities: capabilities.values,
      chains: [],
      message: "This Farcaster app does not support wallet connections.",
    };
  }

  const chains = await readMiniAppStringList(
    () => host?.getChains?.(),
    timeoutMs,
    "FARCASTER_CHAINS_UNAVAILABLE",
    "Farcaster network support could not be checked.",
  );
  if (chains.status === "reported" && !chains.values.includes(requiredChain)) {
    return {
      status: "unsupported",
      code: "FARCASTER_BASE_SEPOLIA_UNSUPPORTED",
      capabilities: capabilities.status === "reported" ? capabilities.values : [],
      chains: chains.values,
      message: "This Farcaster app does not support the required game network. Open Veydrift in a supported wallet browser.",
    };
  }

  if (capabilities.status === "unavailable" || chains.status === "unavailable") {
    const unavailable = capabilities.status === "unavailable" ? capabilities : chains.status === "unavailable" ? chains : undefined;
    return {
      status: "unknown",
      code: unavailable?.code ?? "FARCASTER_WALLET_SUPPORT_UNKNOWN",
      capabilities: capabilities.status === "reported" ? capabilities.values : [],
      chains: chains.status === "reported" ? chains.values : [],
      message: [
        capabilities.status === "unavailable" ? capabilities.message : undefined,
        chains.status === "unavailable" ? chains.message : undefined,
      ].filter(Boolean).join(" "),
    };
  }

  return {
    status: "supported",
    capabilities: capabilities.values,
    chains: chains.values,
  };
}

export function signalFarcasterReadyOnce(
  client?: FarcasterReadyClient,
): Promise<void> {
  if (!readyPromise) {
    readyPromise = hostClient(client)
      .then((host) => host && withTimeout(Promise.resolve(host.actions.ready({})), 1_200))
      .then(() => undefined)
      .catch(() => {
        // Keep regular browser loads resilient when no Mini App host responds.
      });
  }

  return readyPromise;
}

export function scheduleFarcasterReady(
  client?: FarcasterReadyClient,
  scheduler: ReadyScheduler = scheduleAfterNextPaint,
): void {
  scheduler(() => {
    void signalFarcasterReadyOnce(client);
  });
}

export function resetFarcasterReadyForTests(): void {
  readyPromise = undefined;
}

function scheduleAfterNextPaint(callback: () => void): void {
  if (typeof window !== "undefined" && window.requestAnimationFrame) {
    window.requestAnimationFrame(() => {
      callback();
    });
    return;
  }

  setTimeout(callback, 0);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), timeoutMs);
    }),
  ]);
}

async function readMiniAppStringList(
  read: () => Promise<readonly string[]> | readonly string[] | undefined,
  timeoutMs: number,
  code: string,
  message: string,
): Promise<
  | { status: "reported"; values: string[] }
  | { status: "unavailable"; code: string; message: string }
> {
  try {
    const result = await withTimeout(Promise.resolve(read()), timeoutMs);
    if (!Array.isArray(result)) {
      return {
        status: "unavailable",
        code,
        message,
      };
    }

    return {
      status: "reported",
      values: result.filter((value): value is string => typeof value === "string"),
    };
  } catch {
    return {
      status: "unavailable",
      code,
      message,
    };
  }
}
