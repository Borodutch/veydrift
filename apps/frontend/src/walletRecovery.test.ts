import { describe, expect, test } from "bun:test";

import { preSettlementMode } from "./settlementScreen";
import {
  walletRecoveryCopy,
  walletRecoveryDeviceForNavigator,
  walletRecoveryPageUrl,
} from "./walletRecovery";

describe("wallet not found recovery", () => {
  test("guides an ordinary mobile browser into a wallet app browser", () => {
    const device = walletRecoveryDeviceForNavigator({
      maxTouchPoints: 5,
      platform: "Linux armv8l",
      userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/139 Mobile",
    });

    expect(preSettlementMode({ kind: "no-wallet" }, { kind: "idle" })).toBe("no-wallet");
    expect(device).toBe("mobile");
    expect(walletRecoveryCopy({ device, miniAppMode: false })).toEqual({
      body: "Open this exact veydrift.com page in a wallet app’s built-in browser, such as MetaMask, Coinbase Wallet, or Trust Wallet. Try again only after that browser provides your wallet.",
      copyLinkLabel: "Copy this page link",
      retryLabel: "Try again after opening in wallet",
    });
  });

  test("guides a desktop browser to install or enable an extension", () => {
    const device = walletRecoveryDeviceForNavigator({
      maxTouchPoints: 0,
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/139",
    });
    const copy = walletRecoveryCopy({ device, miniAppMode: false });

    expect(device).toBe("desktop");
    expect(copy.body).toContain("Install or enable a wallet browser extension");
    expect(copy.body).toContain("then reload Veydrift");
    expect(copy.body).toContain("only after the extension provides your wallet");
    expect(copy.copyLinkLabel).toBe("Copy this page link");
  });

  test("treats an iPad requesting a desktop site as mobile", () => {
    expect(walletRecoveryDeviceForNavigator({
      maxTouchPoints: 5,
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
    })).toBe("mobile");
  });

  test("copies the exact page URL so referral and private invite state survive", () => {
    const url = "https://veydrift.com/?ref=borodutch&campaign=launch#alliance-invite=secret-value";

    expect(walletRecoveryPageUrl({ href: url })).toBe(url);
  });

  test("does not show recovery guidance when an extension or wallet-app provider exists", () => {
    // A provider with no authorized account uses the normal Connect wallet state;
    // an authorized provider continues into settlement. Neither is no-wallet.
    expect(preSettlementMode({ kind: "disconnected" }, { kind: "idle" })).toBe("connect");
    expect(preSettlementMode({
      kind: "connected",
      account: "0x1111111111111111111111111111111111111111",
    }, { kind: "not-settled" })).toBe("settle");
  });

  test("keeps Farcaster and Mini App recovery host-specific", () => {
    const copy = walletRecoveryCopy({ device: "mobile", miniAppMode: true });

    expect(copy.body).toContain("host wallet authorization");
    expect(copy.body).toContain("this Mini App");
    expect(copy.body).not.toMatch(/built-in browser|browser extension|MetaMask|Trust Wallet/i);
    expect(copy.copyLinkLabel).toBeUndefined();
    expect(copy.retryLabel).toBe("Retry wallet authorization");
  });

  test("renders the centralized copy through accessible, small-screen-safe actions", async () => {
    const appSource = await Bun.file(new URL("./FirstPlanetSettlementApp.tsx", import.meta.url)).text();
    const stylesSource = await Bun.file(new URL("./styles.css", import.meta.url)).text();

    expect(appSource).toContain("const recoveryCopy = walletRecoveryCopy");
    expect(appSource).toContain('aria-live="polite"');
    expect(appSource).toContain('className="wallet-recovery-actions"');
    expect(stylesSource).toContain(".wallet-recovery-actions");
    expect(stylesSource).toContain("flex-wrap: wrap");
    expect(stylesSource).toContain("min-height: 48px");
  });
});
