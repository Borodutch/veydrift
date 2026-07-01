import { describe, expect, test } from "bun:test";

describe("playable Mini App wallet binding", () => {
  test("binds Farcaster Mini App wallets inside the playable app shell", async () => {
    const source = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(source).toContain("detectFarcasterMiniApp");
    expect(source).toContain("signalFarcasterReadyOnce");
    expect(source).toContain("farcasterMiniAppWalletSupport");
    expect(source).toContain("{ preferFarcasterProvider: true }");
    expect(source).toContain("walletProvider.source !== \"farcaster\"");
    expect(source).not.toContain("getCurrentAccounts(walletProvider.provider, WALLET_BOOTSTRAP_READ_TIMEOUT_MS)");
    expect(source).toContain("accounts = await requestAccounts(walletProvider.provider)");
    expect(source).toContain("await switchBaseSepoliaNetwork(walletProvider.provider)");
    expect(source).toContain("FARCASTER_WALLET_PROVIDER_UNAVAILABLE");
    expect(source).toContain("MiniAppWalletErrorState");
    expect(source).toContain("const effectiveConnectWallet = onConnectWallet ?? (miniAppMode ? connectMiniAppWallet : undefined)");
    expect(source).toContain("onConnectWallet={effectiveConnectWallet}");
  });
});
