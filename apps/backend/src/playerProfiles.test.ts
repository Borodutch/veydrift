import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { BackendConfig } from "./config";
import type { SettledPlanetEvent } from "./evm";
import { SettlementIndexer } from "./indexer";
import {
  playerDescriptionMaxLength,
  playerDisplayNameMessage,
  playerProfileMessage,
  validatePlayerDescription,
  validatePlayerDisplayName
} from "./playerProfiles";
import { createRequestHandler } from "./server";

const config: BackendConfig = {
  chainId: 84532,
  deploymentMode: "test",
  qaSyntheticStationedDefenders: false,
  indexDbPath: ":memory:",
  randomnessCommitmentStorePath: ".data/test-randomness.json",
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

  test("validates descriptions before persistence", () => {
    expect(validatePlayerDescription("  https://veydrift.com/about\nReady for raids  ")).toEqual({
      ok: true,
      description: "https://veydrift.com/about\nReady for raids"
    });
    expect(validatePlayerDescription("")).toEqual({
      ok: true,
      description: null
    });
    expect(validatePlayerDescription("A".repeat(playerDescriptionMaxLength + 1))).toEqual({
      ok: false,
      error: `Descriptions can be at most ${playerDescriptionMaxLength} characters.`
    });
    expect(validatePlayerDescription("Nova\u0000Prime")).toEqual({
      ok: false,
      error: "Descriptions cannot include control or formatting characters."
    });
  });

  test("saves a wallet-signed profile and exposes only the display name in indexed snippets", async () => {
    const indexer = testIndexer();
    await indexer.rebuild();
    indexer.applyEvent(planet);
    const handler = createRequestHandler({
      config,
      configProblems: [{ field: "rpc", message: "skip live chain services in profile tests" }],
      indexer
    });
    const displayName = "Nova Prime";
    const description = "Open diplomacy: https://veydrift.com/commander/nova";
    const signature = await account.signMessage({
      message: playerProfileMessage(wallet, displayName, description)
    });

    const save = await handler(new Request(`https://api.test/wallet/${wallet}/profile`, {
      body: JSON.stringify({ description, displayName, signature }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }));
    expect(save.status).toBe(200);
    await expect(save.json()).resolves.toMatchObject({
      wallet: wallet.toLowerCase(),
      displayName,
      description,
      fallbackName: `${wallet.slice(0, 6).toLowerCase()}...${wallet.slice(-4).toLowerCase()}`
    });

    const profile = await handler(new Request(`https://api.test/wallet/${wallet}/profile`));
    expect(await profile.json()).toMatchObject({
      description,
      displayName
    });

    const highscores = await handler(new Request("https://api.test/highscores?limit=10"));
    const highscoreBody = await highscores.json() as { rankings: { total: Array<{ displayName: string | null; wallet: string }> } };
    expect(highscoreBody.rankings.total[0]).toMatchObject({
      wallet: wallet.toLowerCase(),
      displayName
    });
    expect(JSON.stringify(highscoreBody)).not.toContain(description);

    const system = await handler(new Request("https://api.test/universe/galaxies/2/systems/44"));
    const systemBody = await system.json() as { planets: Array<{ occupiedBy: { ownerDisplayName: string | null } | null; position: number }> };
    expect(systemBody.planets.find((item) => item.position === 9)?.occupiedBy).toMatchObject({
      ownerDisplayName: displayName
    });
    expect(JSON.stringify(systemBody)).not.toContain(description);
  });

  test("clears a wallet-signed profile description", async () => {
    const indexer = testIndexer();
    const handler = createRequestHandler({
      config,
      configProblems: [{ field: "rpc", message: "skip live chain services in profile tests" }],
      indexer
    });
    const displayName = "Nova Prime";
    indexer.upsertPlayerProfile(wallet, displayName, "First contact: https://veydrift.com");
    const signature = await account.signMessage({
      message: playerProfileMessage(wallet, displayName, null)
    });

    const response = await handler(new Request(`https://api.test/wallet/${wallet}/profile`, {
      body: JSON.stringify({ description: "", displayName, signature }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      description: null,
      displayName
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

  test("rejects invalid signed profile updates", async () => {
    const indexer = testIndexer();
    const handler = createRequestHandler({
      config,
      configProblems: [{ field: "rpc", message: "skip live chain services in profile tests" }],
      indexer
    });
    const displayName = "Nova Prime";
    const longDescription = "A".repeat(playerDescriptionMaxLength + 1);
    const longSignature = await account.signMessage({
      message: playerProfileMessage(wallet, displayName, longDescription)
    });
    const invalidDescription = await handler(new Request(`https://api.test/wallet/${wallet}/profile`, {
      body: JSON.stringify({ description: longDescription, displayName, signature: longSignature }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }));
    expect(invalidDescription.status).toBe(400);
    expect(await invalidDescription.json()).toMatchObject({
      error: "invalid_description"
    });

    const legacySignature = await account.signMessage({
      message: playerDisplayNameMessage(wallet, displayName)
    });
    const wrongMessage = await handler(new Request(`https://api.test/wallet/${wallet}/profile`, {
      body: JSON.stringify({ description: "Hello", displayName, signature: legacySignature }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }));
    expect(wrongMessage.status).toBe(401);
    expect(await wrongMessage.json()).toMatchObject({
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
