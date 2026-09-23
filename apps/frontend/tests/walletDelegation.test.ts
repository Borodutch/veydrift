import { describe, expect, test } from "bun:test";

describe("wallet delegation", () => {
  test("keeps the connected wallet as signer while scoping game state to the effective main", async () => {
    const landingSource = await Bun.file(new URL("../src/FirstPlanetSettlementApp.tsx", import.meta.url)).text();
    const playableSource = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(landingSource).toContain("referralData.queries.delegation(account)");
    expect(landingSource).toContain("const playerAccount = delegation?.main");
    expect(playableSource).toContain("const signerAccount = providedAccount ?? miniAppAccount");
    expect(playableSource).toContain('const account = delegationQuery.snapshot?.freshness === "failed"');
    expect(playableSource).toContain('    ? undefined : delegation?.main ?? providedPlayerAccount ?? signerAccount;');
    expect(playableSource).toContain("backendData.startSignerDelegationSync(signerAccount)");
    expect(playableSource).toContain("Boolean(provider && signerAccount && account && gameContract)");
  });

  test("exposes set, replace, revoke, and acting-for context without allowing a delegate to delegate again", async () => {
    const navSource = await Bun.file(new URL("../src/components/NavBar.tsx", import.meta.url)).text();
    const playableSource = await Bun.file(new URL("../src/PlayableMvpApp.tsx", import.meta.url)).text();

    expect(navSource).toContain('aria-label="Wallet delegation"');
    expect(navSource).toContain("delegation?.actingAsDelegate");
    expect(navSource).toContain('delegation?.delegate ? "Replace delegate" : "Set delegate"');
    expect(navSource).toContain("!delegation?.actingAsDelegate");
    expect(playableSource).toContain("sendSetDelegateTransaction(walletProvider, signerAccount, gameContract, delegate)");
    expect(playableSource).toContain("sendRevokeDelegateTransaction(walletProvider, signerAccount, gameContract)");
  });
});
