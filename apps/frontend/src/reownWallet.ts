import type { AvailableWalletProvider, Eip1193Provider } from "./walletFlow";
import { defaultPlayableApiUrlForLocation } from "./runtimeConfig";

const REOWN_CONNECT_TIMEOUT_MS = 120_000;
const reownProjectId = import.meta.env.VITE_REOWN_PROJECT_ID?.trim() ?? "";
const baseCaipNetworkId = "eip155:8453";

type ReownModalState = {
  open: boolean;
};

type ReownAppKit = {
  getWalletProvider(): unknown;
  open(options?: { namespace?: "eip155"; view?: "Connect" }): Promise<unknown>;
  subscribeProviders(callback: () => void): () => void;
  subscribeState(callback: (state: ReownModalState) => void): () => void;
};

let appKitPromise: Promise<ReownAppKit> | undefined;

/**
 * Reown AppKit is intentionally disabled in the Farcaster Mini App. Farcaster
 * owns the wallet handshake there and must remain the only provider source.
 */
export function walletConnectEnabled(
  miniAppMode: boolean,
  projectId = reownProjectId,
): boolean {
  return !miniAppMode && Boolean(projectId);
}

export function walletConnectConfigurationMessage(): string {
  return "WalletConnect is not configured yet. Install a browser wallet, or try again once Veydrift enables WalletConnect.";
}

/**
 * AppKit's connection modal needs a Base RPC for balances and gas estimates.
 * Route those reads through Veydrift's narrowly scoped API proxy; the actual
 * node remains reachable only from the backend.
 */
export function walletConnectCustomRpcUrls(
  location: Pick<Location, "hostname"> | undefined = typeof window === "undefined" ? undefined : window.location
): Record<typeof baseCaipNetworkId, Array<{ url: string }>> {
  return {
    [baseCaipNetworkId]: [{ url: `${defaultPlayableApiUrlForLocation(location)}/walletconnect-rpc` }]
  };
}

export async function connectWalletConnect(): Promise<AvailableWalletProvider | undefined> {
  const appKit = await loadReownAppKit();
  const existingProvider = asEip1193Provider(appKit.getWalletProvider());
  if (existingProvider) {
    return { provider: existingProvider, source: "reown" };
  }

  return new Promise<AvailableWalletProvider | undefined>((resolve, reject) => {
    let opened = false;
    let settled = false;
    let unsubscribeProviders = () => {};
    let unsubscribeState = () => {};
    const timeout = window.setTimeout(() => settle(undefined), REOWN_CONNECT_TIMEOUT_MS);

    const settle = (provider: Eip1193Provider | undefined) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribeProviders();
      unsubscribeState();
      resolve(provider ? { provider, source: "reown" } : undefined);
    };

    const readProvider = () => {
      const provider = asEip1193Provider(appKit.getWalletProvider());
      if (provider) settle(provider);
    };

    unsubscribeProviders = appKit.subscribeProviders(readProvider);
    unsubscribeState = appKit.subscribeState((state) => {
      if (opened && !state.open) settle(undefined);
    });

    void appKit.open({ view: "Connect", namespace: "eip155" })
      .then(() => {
        opened = true;
        readProvider();
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        unsubscribeProviders();
        unsubscribeState();
        reject(error);
      });
  });
}

async function loadReownAppKit(): Promise<ReownAppKit> {
  if (!reownProjectId) {
    throw new Error(walletConnectConfigurationMessage());
  }

  appKitPromise ??= (async () => {
    const [appKitModule, ethersModule, networksModule] = await Promise.all([
      import("@reown/appkit"),
      import("@reown/appkit-adapter-ethers"),
      import("@reown/appkit/networks"),
    ]);
    const metadata = {
      name: "Veydrift",
      description: "Onchain space strategy on Base",
      url: window.location.origin,
      icons: [`${window.location.origin}/apple-touch-icon.png`],
    };

    // AppKit's Ethers adapter is runtime-compatible with ChainAdapter. Its
    // published declaration marks `namespace` optional while AppKit's strict
    // `exactOptionalPropertyTypes` declaration requires it, so bridge that
    // package-only type mismatch here instead of weakening Veydrift's TS mode.
    const ethersAdapter = new ethersModule.EthersAdapter();
    return appKitModule.createAppKit({
      adapters: [ethersAdapter as never],
      allowUnsupportedChain: false,
      allWallets: "SHOW",
      customRpcUrls: walletConnectCustomRpcUrls() as never,
      defaultAccountTypes: { eip155: "eoa" },
      defaultNetwork: networksModule.base,
      features: { analytics: false },
      metadata,
      networks: [networksModule.base],
      projectId: reownProjectId,
      themeMode: "dark",
    }) as unknown as ReownAppKit;
  })();

  return appKitPromise;
}

function asEip1193Provider(value: unknown): Eip1193Provider | undefined {
  if (!value || typeof value !== "object" || !("request" in value)) {
    return undefined;
  }

  return typeof (value as { request?: unknown }).request === "function"
    ? value as Eip1193Provider
    : undefined;
}
