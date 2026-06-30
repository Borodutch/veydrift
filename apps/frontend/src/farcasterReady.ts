import { sdk } from "@farcaster/miniapp-sdk";

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
  | { status: "unsupported"; code: string; capabilities: string[]; chains: string[]; message: string };

type ReadyScheduler = (callback: () => void) => void;
type MiniAppLocation = Pick<Location, "pathname" | "search">;

export const FARCASTER_BASE_SEPOLIA_CHAIN = "eip155:84532";
export const FARCASTER_WALLET_CAPABILITY = "wallet.getEthereumProvider";

let readyPromise: Promise<void> | undefined;

export function hasMiniAppUrlHint(
  location: MiniAppLocation = window.location,
): boolean {
  const params = new URLSearchParams(location.search);
  return location.pathname.startsWith("/miniapp") || params.get("miniApp") === "true";
}

export async function detectFarcasterMiniApp(
  client: FarcasterReadyClient = sdk,
  location: MiniAppLocation = window.location,
): Promise<boolean> {
  if (hasMiniAppUrlHint(location)) {
    return true;
  }

  return client.isInMiniApp?.(500).catch(() => false) ?? false;
}

export async function farcasterMiniAppPlatformType(
  client: FarcasterReadyClient = sdk,
): Promise<FarcasterMiniAppPlatformType> {
  try {
    const context = await withTimeout(client.context ?? Promise.resolve(undefined), 1_200);
    return context?.client?.platformType ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function farcasterMiniAppWalletSupport(
  client: FarcasterReadyClient = sdk,
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
  const capabilities = await readMiniAppStringList(
    () => client.getCapabilities?.(),
    timeoutMs,
    "FARCASTER_CAPABILITIES_UNAVAILABLE",
    "Farcaster Mini App host did not report wallet capabilities.",
  );
  if (capabilities.status === "unsupported") {
    return capabilities;
  }
  if (!capabilities.values.includes(requiredCapability)) {
    return {
      status: "unsupported",
      code: "FARCASTER_WALLET_CAPABILITY_MISSING",
      capabilities: capabilities.values,
      chains: [],
      message: `Farcaster Mini App host does not advertise ${requiredCapability}.`,
    };
  }

  const chains = await readMiniAppStringList(
    () => client.getChains?.(),
    timeoutMs,
    "FARCASTER_CHAINS_UNAVAILABLE",
    "Farcaster Mini App host did not report supported chains.",
  );
  if (chains.status === "unsupported") {
    return {
      ...chains,
      capabilities: capabilities.values,
    };
  }
  if (!chains.values.includes(requiredChain)) {
    return {
      status: "unsupported",
      code: "FARCASTER_BASE_SEPOLIA_UNSUPPORTED",
      capabilities: capabilities.values,
      chains: chains.values,
      message: `Farcaster Mini App host does not advertise ${requiredChain}.`,
    };
  }

  return {
    status: "supported",
    capabilities: capabilities.values,
    chains: chains.values,
  };
}

export function signalFarcasterReadyOnce(
  client: FarcasterReadyClient = sdk,
): Promise<void> {
  if (!readyPromise) {
    readyPromise = Promise.resolve()
      .then(() => withTimeout(Promise.resolve(client.actions.ready({})), 1_200))
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
  | { status: "supported"; values: string[] }
  | { status: "unsupported"; code: string; capabilities: string[]; chains: string[]; message: string }
> {
  try {
    const result = await withTimeout(Promise.resolve(read()), timeoutMs);
    if (!Array.isArray(result)) {
      return {
        status: "unsupported",
        code,
        capabilities: [],
        chains: [],
        message,
      };
    }

    return {
      status: "supported",
      values: result.filter((value): value is string => typeof value === "string"),
    };
  } catch {
    return {
      status: "unsupported",
      code,
      capabilities: [],
      chains: [],
      message,
    };
  }
}
