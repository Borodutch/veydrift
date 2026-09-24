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

test("confirmed delegate read crosses an older in-flight read and updates the canonical signer query", async () => {
  const { BackendDataStore } = await import("../src/backendDataStore");
  const originalFetch = globalThis.fetch;
  const signer = "0x1111111111111111111111111111111111111111";
  const delegate = "0x3333333333333333333333333333333333333333";
  const store = new BackendDataStore("https://api.test");
  let release!: () => void;
  let reads = 0;
  globalThis.fetch = (async () => {
    const read = ++reads;
    if (read === 1) await new Promise<void>(resolve => { release = resolve; });
    return Response.json({ wallet: signer, main: signer, delegate: read === 1 ? null : delegate, actingAsDelegate: false });
  }) as typeof fetch;
  try {
    const query = store.queries.delegation(signer);
    const stale = query.read();
    await new Promise(resolve => setTimeout(resolve, 0));
    const confirmed = store.queries.delegation(signer, { fresh: true }).read();
    expect(reads).toBe(1);
    release();
    expect((await stale).delegate).toBeNull();
    expect((await confirmed).delegate).toBe(delegate);
    expect(store.snapshot<{ delegate: string }>(query.key)?.data?.delegate).toBe(delegate);
    expect(reads).toBe(2);
  } finally { release?.(); store.dispose(); globalThis.fetch = originalFetch; }
});
