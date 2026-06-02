import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { BackendConfig } from "./config";
import type { SettledPlanetEvent } from "./evm";
import { SettlementIndexer } from "./indexer";
import { playerDisplayNameMessage, validatePlayerDisplayName } from "./playerProfiles";
import { createRequestHandler } from "./server";

const config: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  indexDbPath: ":memory:",
  indexFromBlock: 100n,
  missionResolutionEnabled: false,
  resourceTokenAddresses: {},
  rpcSource: "missing",
  wsRpcSource: "missing",
  gameContractAddress: "0x3333333333333333333333333333333333333333"
};

const account = privateKeyToAccount("0x1111111111111111111111111111111111111111111111111111111111111111");
const wallet = account.address;
const planet: SettledPlanetEvent = {
  eventName: "PlanetStarted",
  transactionHash: "0xabc",
  blockNumber: "123",
  planetId: "7",
  owner: wallet,
  name: "Eos",
  galaxy: 2,
  system: 44,
  position: 9,
  fields: 211,
  temperature: -8,
  metalMultiplierBps: 9788,
  crystalMultiplierBps: 10233,
  deuteriumMultiplierBps: 10584,
  lastSettledAt: "1770000000",
  resources: {
    metal: "5000",
    crystal: "4900",
    deuterium: "4800"
  }
};

describe("player profile display names", () => {
  test("validates display names before persistence", () => {
    expect(validatePlayerDisplayName("  Commander  Nova  ")).toEqual({
      ok: true,
      displayName: "Commander Nova"
    });
    expect(validatePlayerDisplayName("")).toEqual({
      ok: false,
      error: "Enter a display name."
    });
    expect(validatePlayerDisplayName("A".repeat(33))).toEqual({
      ok: false,
      error: "Display names can be at most 32 characters."
    });
    expect(validatePlayerDisplayName("Nova\nPrime")).toEqual({
      ok: false,
      error: "Display names cannot include control or formatting characters."
    });
  });

  test("saves a wallet-signed display name and exposes it in indexed player surfaces", async () => {
    const indexer = testIndexer();
    indexer.applyEvent(planet);
    const handler = createRequestHandler({
      config,
      configProblems: [{ field: "rpc", message: "skip live chain services in profile tests" }],
      indexer
    });
    const displayName = "Nova Prime";
    const signature = await account.signMessage({
      message: playerDisplayNameMessage(wallet, displayName)
    });

    const save = await handler(new Request(`https://api.test/wallet/${wallet}/profile/display-name`, {
      body: JSON.stringify({ displayName, signature }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }));
    expect(save.status).toBe(200);
    await expect(save.json()).resolves.toMatchObject({
      wallet: wallet.toLowerCase(),
      displayName,
      fallbackName: `${wallet.slice(0, 6).toLowerCase()}...${wallet.slice(-4).toLowerCase()}`
    });

    const profile = await handler(new Request(`https://api.test/wallet/${wallet}/profile`));
    expect(await profile.json()).toMatchObject({
      displayName
    });

    const highscores = await handler(new Request("https://api.test/highscores?limit=10"));
    const highscoreBody = await highscores.json() as { rankings: { total: Array<{ displayName: string | null; wallet: string }> } };
    expect(highscoreBody.rankings.total[0]).toMatchObject({
      wallet: wallet.toLowerCase(),
      displayName
    });

    const system = await handler(new Request("https://api.test/universe/galaxies/2/systems/44"));
    const systemBody = await system.json() as { planets: Array<{ occupiedBy: { ownerDisplayName: string | null } | null; position: number }> };
    expect(systemBody.planets.find((item) => item.position === 9)?.occupiedBy).toMatchObject({
      ownerDisplayName: displayName
    });
  });

  test("rejects display-name updates signed by another wallet", async () => {
    const indexer = testIndexer();
    const handler = createRequestHandler({
      config,
      configProblems: [{ field: "rpc", message: "skip live chain services in profile tests" }],
      indexer
    });
    const other = privateKeyToAccount("0x2222222222222222222222222222222222222222222222222222222222222222");
    const displayName = "Imposter";
    const signature = await other.signMessage({
      message: playerDisplayNameMessage(wallet, displayName)
    });

    const response = await handler(new Request(`https://api.test/wallet/${wallet}/profile/display-name`, {
      body: JSON.stringify({ displayName, signature }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: "invalid_signature"
    });

    const malformed = await handler(new Request(`https://api.test/wallet/${wallet}/profile/display-name`, {
      body: JSON.stringify({ displayName, signature: "0xabc" }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }));
    expect(malformed.status).toBe(401);
    expect(await malformed.json()).toMatchObject({
      error: "invalid_signature"
    });
  });
});

function testIndexer(): SettlementIndexer {
  return new SettlementIndexer({
    async listDebrisFieldEvents() { return []; },
    async listMoonChanceReportEvents() { return []; },
    async listSettledPlanetEvents() { return []; }
  }, 100n);
}
