import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { privateKeyToAccount } from "viem/accounts";
import type { BackendConfig } from "./config";
import {
  entityMediaMessage,
  validateYouTubeMediaUrl,
  type EntityMediaKind,
  type YouTubeMedia,
} from "./entityMedia";
import type { SettledPlanetEvent } from "./evm";
import { SettlementIndexer } from "./indexer";
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
  gameContractAddress: "0x3333333333333333333333333333333333333333",
};

const owner = privateKeyToAccount("0x1111111111111111111111111111111111111111111111111111111111111111");
const officer = privateKeyToAccount("0x2222222222222222222222222222222222222222222222222222222222222222");
const outsider = privateKeyToAccount("0x3333333333333333333333333333333333333333333333333333333333333333");
const planet: SettledPlanetEvent = {
  eventName: "PlanetStarted",
  transactionHash: "0xabc",
  blockNumber: "123",
  planetId: "7",
  owner: owner.address,
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
  resources: { metal: "5000", crystal: "4900", deuterium: "4800" },
};

describe("entity media", () => {
  test("normalizes supported YouTube forms and rejects malformed or third-party URLs", () => {
    expect(validateYouTubeMediaUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share")).toEqual({
      ok: true,
      media: {
        type: "video",
        id: "dQw4w9WgXcQ",
        canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
    });
    expect(validateYouTubeMediaUrl("https://www.youtube.com/embed/videoseries?list=PL1234567890abcdef")).toEqual({
      ok: true,
      media: {
        type: "playlist",
        id: "PL1234567890abcdef",
        canonicalUrl: "https://www.youtube.com/playlist?list=PL1234567890abcdef",
      },
    });
    expect(validateYouTubeMediaUrl("https://www.youtube.com/watch?list=PL1234567890abcdef")).toMatchObject({
      ok: true,
      media: { type: "playlist", id: "PL1234567890abcdef" },
    });
    expect(validateYouTubeMediaUrl("https://example.com/embed/dQw4w9WgXcQ")).toEqual({
      ok: false,
      error: "Only YouTube video and playlist URLs are supported.",
    });
    expect(validateYouTubeMediaUrl("https://youtube.com/watch?v=bad")).toEqual({
      ok: false,
      error: "This YouTube video URL has an invalid video id.",
    });
  });

  test("authorizes owner-managed planet, moon, player, and alliance media and returns only structured data", async () => {
    const { handler } = testServer();
    const video = validatedMedia("https://youtu.be/dQw4w9WgXcQ");
    const playlistUrl = "https://www.youtube.com/playlist?list=PL1234567890abcdef";
    const playlist = validatedMedia(playlistUrl);
    const targets: Array<{ kind: EntityMediaKind; id: string }> = [
      { kind: "planet", id: "7" },
      { kind: "moon", id: "7" },
      { kind: "player", id: owner.address.toLowerCase() },
      { kind: "alliance", id: "9" },
    ];

    for (const target of targets) {
      const response = await saveMedia(handler, owner, target.kind, target.id, video, "https://youtu.be/dQw4w9WgXcQ");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        entityKind: target.kind,
        entityId: target.id,
        media: {
          entityKind: target.kind,
          entityId: target.id,
          media: {
            type: "video",
            id: "dQw4w9WgXcQ",
            canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          },
        },
      });

      const read = await handler(new Request(`https://api.test/entity-media/${target.kind}/${target.id}`));
      expect(read.status).toBe(200);
      const body = await read.json();
      expect(body).toMatchObject({ entityKind: target.kind, entityId: target.id });
      expect(JSON.stringify(body)).not.toContain("<iframe");
      expect(JSON.stringify(body)).not.toContain("youtu.be");

      const replacement = await saveMedia(
        handler,
        owner,
        target.kind,
        target.id,
        playlist,
        playlistUrl
      );
      expect(replacement.status).toBe(200);
      expect(await replacement.json()).toMatchObject({
        media: { media: { id: "PL1234567890abcdef", type: "playlist" } },
      });

      const removal = await saveMedia(handler, owner, target.kind, target.id, null, "");
      expect(removal.status).toBe(200);
      expect(await removal.json()).toMatchObject({ media: null });
    }
  });

  test("allows an alliance officer but rejects visitors mutating entities they do not own", async () => {
    const { handler } = testServer();
    const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const video = validatedMedia(videoUrl);

    const officerSave = await saveMedia(handler, officer, "alliance", "9", video, videoUrl);
    expect(officerSave.status).toBe(200);

    for (const target of [
      { kind: "planet" as const, id: "7" },
      { kind: "moon" as const, id: "7" },
      { kind: "player" as const, id: owner.address.toLowerCase() },
      { kind: "alliance" as const, id: "9" },
    ]) {
      const response = await saveMedia(handler, outsider, target.kind, target.id, video, videoUrl);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "entity_media_forbidden" });
    }
  });

  test("does not persist malformed media and supports signed removal", async () => {
    const { handler } = testServer();
    const malformed = await handler(new Request("https://api.test/entity-media/planet/7", {
      body: JSON.stringify({
        mediaUrl: "https://example.com/video",
        signature: "0x1234",
        wallet: owner.address,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: "invalid_youtube_url" });

    const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    await saveMedia(handler, owner, "planet", "7", validatedMedia(videoUrl), videoUrl);
    const removal = await saveMedia(handler, owner, "planet", "7", null, "");
    expect(removal.status).toBe(200);
    expect(await removal.json()).toMatchObject({ media: null });

    const read = await handler(new Request("https://api.test/entity-media/planet/7"));
    expect(await read.json()).toMatchObject({ media: null });
  });

  test("rejects replaying the exact same signed mutation", async () => {
    const { handler } = testServer();
    const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const video = validatedMedia(videoUrl);
    const version = await currentMediaVersion(handler, owner.address, "planet", "7");
    const mutation = await signedMediaMutation(owner, "planet", "7", video, videoUrl, version);

    expect((await postMediaMutation(handler, "planet", "7", mutation)).status).toBe(200);
    const replay = await postMediaMutation(handler, "planet", "7", mutation);
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ error: "entity_media_stale_authorization" });
  });

  test("rejects stale signed content after a later replacement or removal", async () => {
    const { handler } = testServer();
    const firstUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const replacementUrl = "https://www.youtube.com/watch?v=9bZkp7q19f0";
    const first = validatedMedia(firstUrl);
    const replacement = validatedMedia(replacementUrl);
    const initialVersion = await currentMediaVersion(handler, owner.address, "planet", "7");
    const staleInitial = await signedMediaMutation(
      owner,
      "planet",
      "7",
      first,
      firstUrl,
      initialVersion
    );

    expect((await saveMedia(handler, owner, "planet", "7", replacement, replacementUrl)).status).toBe(200);
    expect((await postMediaMutation(handler, "planet", "7", staleInitial)).status).toBe(409);
    let read = await handler(new Request("https://api.test/entity-media/planet/7"));
    expect(await read.json()).toMatchObject({ media: { media: { id: "9bZkp7q19f0" } } });

    const beforeRemoval = await currentMediaVersion(handler, owner.address, "planet", "7");
    const staleReplacement = await signedMediaMutation(
      owner,
      "planet",
      "7",
      first,
      firstUrl,
      beforeRemoval
    );
    expect((await saveMedia(handler, owner, "planet", "7", null, "")).status).toBe(200);
    expect((await postMediaMutation(handler, "planet", "7", staleReplacement)).status).toBe(409);
    read = await handler(new Request("https://api.test/entity-media/planet/7"));
    expect(await read.json()).toMatchObject({ media: null });
  });

  test("binds each authorization to its entity and wallet", async () => {
    const { handler } = testServer();
    const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const video = validatedMedia(videoUrl);
    const version = await currentMediaVersion(handler, owner.address, "planet", "7");
    const planetMutation = await signedMediaMutation(owner, "planet", "7", video, videoUrl, version);

    const entityMismatch = await postMediaMutation(handler, "moon", "7", planetMutation);
    expect(entityMismatch.status).toBe(401);
    expect(await entityMismatch.json()).toMatchObject({ error: "invalid_signature" });

    const walletMismatch = await postMediaMutation(handler, "planet", "7", {
      ...planetMutation,
      wallet: outsider.address,
    });
    expect(walletMismatch.status).toBe(401);
    expect(await walletMismatch.json()).toMatchObject({ error: "invalid_signature" });
  });
});

function testServer() {
  const database = new Database(":memory:");
  const indexer = new SettlementIndexer({
    async listDebrisFieldEvents() { return []; },
    async listMoonChanceReportEvents() { return []; },
    async listSettledPlanetEvents() { return []; },
  }, 100n, { database });
  indexer.applyEvent(planet);
  database.query(`
    INSERT INTO indexed_moons (planet_id, owner, fields, diameter_km, event_json)
    VALUES (?, lower(?), ?, ?, ?)
  `).run("7", owner.address, 10, 8_000, JSON.stringify({
    eventName: "MoonCreated",
    planetId: "7",
    owner: owner.address,
  }));
  database.query(`
    INSERT INTO contract_alliances
      (alliance_id, active, tag, name, description, owner, created_at, member_count, event_json)
    VALUES (?, 1, ?, ?, '', lower(?), ?, 2, NULL)
  `).run("9", "VEY", "Veydrift", owner.address, "1770000000");
  database.query(`
    INSERT INTO contract_alliance_members (alliance_id, wallet, role_id, joined_at)
    VALUES (?, lower(?), 3, ?), (?, lower(?), 2, ?)
  `).run("9", owner.address, "1770000000", "9", officer.address, "1770000001");
  return {
    handler: createRequestHandler({
      config,
      configProblems: [{ field: "rpc", message: "skip live chain services in entity media tests" }],
      indexer,
    }),
  };
}

function validatedMedia(url: string): YouTubeMedia {
  const validation = validateYouTubeMediaUrl(url);
  if (!validation.ok || !validation.media) throw new Error("Expected valid media");
  return validation.media;
}

async function saveMedia(
  handler: (request: Request) => Promise<Response>,
  signer: typeof owner,
  entityKind: EntityMediaKind,
  entityId: string,
  media: YouTubeMedia | null,
  mediaUrl: string
): Promise<Response> {
  const version = await currentMediaVersion(handler, signer.address, entityKind, entityId);
  const mutation = await signedMediaMutation(
    signer,
    entityKind,
    entityId,
    media,
    mediaUrl,
    version
  );
  return postMediaMutation(handler, entityKind, entityId, mutation);
}

async function currentMediaVersion(
  handler: (request: Request) => Promise<Response>,
  wallet: string,
  entityKind: EntityMediaKind,
  entityId: string
): Promise<number> {
  const response = await handler(new Request(
    `https://api.test/entity-media/${entityKind}/${encodeURIComponent(entityId)}/challenge?wallet=${encodeURIComponent(wallet)}`
  ));
  expect(response.status).toBe(200);
  const body = await response.json() as { version: number };
  return body.version;
}

async function signedMediaMutation(
  signer: typeof owner,
  entityKind: EntityMediaKind,
  entityId: string,
  media: YouTubeMedia | null,
  mediaUrl: string,
  version: number
): Promise<{ mediaUrl: string; signature: string; version: number; wallet: string }> {
  const signature = await signer.signMessage({
    message: entityMediaMessage({
      entityId,
      entityKind,
      media,
      version,
      wallet: signer.address,
    }),
  });
  return { mediaUrl, signature, version, wallet: signer.address };
}

function postMediaMutation(
  handler: (request: Request) => Promise<Response>,
  entityKind: EntityMediaKind,
  entityId: string,
  mutation: { mediaUrl: string; signature: string; version: number; wallet: string }
): Promise<Response> {
  return handler(new Request(`https://api.test/entity-media/${entityKind}/${encodeURIComponent(entityId)}`, {
    body: JSON.stringify(mutation),
    headers: { "content-type": "application/json" },
    method: "POST",
  }));
}
