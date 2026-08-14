export type WalletRecoveryDevice = "desktop" | "mobile";

export type WalletRecoveryCopy = {
  body: string;
  copyLinkLabel: string | undefined;
  retryLabel: string;
};

type WalletRecoveryNavigator = {
  maxTouchPoints?: number | undefined;
  platform?: string | undefined;
  userAgent?: string | undefined;
};

const MOBILE_BROWSER_PATTERN = /Android|iPad|iPhone|iPod|Mobile|Silk/i;

export function walletRecoveryDeviceForNavigator(
  navigatorValue: WalletRecoveryNavigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
): WalletRecoveryDevice {
  if (!navigatorValue) return "desktop";

  const userAgent = navigatorValue.userAgent ?? "";
  if (MOBILE_BROWSER_PATTERN.test(userAgent)) return "mobile";

  // Modern iPadOS can request desktop sites and identify itself as a Mac. Its
  // touch-point count is the stable distinction from an actual Mac browser.
  if (
    /Mac/i.test(navigatorValue.platform ?? "")
    && (navigatorValue.maxTouchPoints ?? 0) > 1
  ) {
    return "mobile";
  }

  return "desktop";
}

export function walletRecoveryCopy(input: {
  device: WalletRecoveryDevice;
  miniAppMode: boolean;
}): WalletRecoveryCopy {
  if (input.miniAppMode) {
    return {
      body: "Veydrift can’t access the host wallet authorization. Retry the wallet connection in this Mini App.",
      copyLinkLabel: undefined,
      retryLabel: "Retry wallet authorization",
    };
  }

  if (input.device === "mobile") {
    return {
      body: "Open this exact veydrift.com page in a wallet app’s built-in browser, such as MetaMask, Coinbase Wallet, or Trust Wallet. Try again only after that browser provides your wallet.",
      copyLinkLabel: "Copy this page link",
      retryLabel: "Try again after opening in wallet",
    };
  }

  return {
    body: "Install or enable a wallet browser extension, such as MetaMask, Coinbase Wallet, or Rabby, then reload Veydrift. Try again only after the extension provides your wallet.",
    copyLinkLabel: "Copy this page link",
    retryLabel: "Try again after enabling wallet",
  };
}

export function walletRecoveryPageUrl(
  locationValue: Pick<Location, "href"> | undefined = typeof window === "undefined" ? undefined : window.location,
): string | undefined {
  return locationValue?.href;
}
