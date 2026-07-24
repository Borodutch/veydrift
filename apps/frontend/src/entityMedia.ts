import type { Eip1193Provider } from "./walletFlow";

export type EntityMediaKind = "planet" | "moon" | "player" | "alliance";
export type YouTubeMedia = {
  type: "video" | "playlist";
  id: string;
  canonicalUrl: string;
};
export type EntityMediaRecord = {
  entityKind: EntityMediaKind;
  entityId: string;
  media: YouTubeMedia;
  updatedAt: string;
};
export type EntityMediaResponse = {
  entityKind: EntityMediaKind;
  entityId: string;
  media: EntityMediaRecord | null;
  version?: number;
};
export type EntityMediaChallenge = {
  entityKind: EntityMediaKind;
  entityId: string;
  version: number;
  wallet: string;
};

export type EntityMediaPlaybackState = {
  enabled: boolean;
  entityKey: string;
};

export function canEditEntityMedia({
  allianceRole,
  entityKind,
  isCurrentAlliance = false,
  ownerWallet,
  viewerWallet,
}: {
  allianceRole?: "none" | "member" | "officer" | "owner" | undefined;
  entityKind: EntityMediaKind;
  isCurrentAlliance?: boolean | undefined;
  ownerWallet?: string | null | undefined;
  viewerWallet?: string | null | undefined;
}): boolean {
  if (entityKind === "alliance") {
    return isCurrentAlliance && (allianceRole === "owner" || allianceRole === "officer");
  }
  return Boolean(
    ownerWallet
    && viewerWallet
    && ownerWallet.toLowerCase() === viewerWallet.toLowerCase()
  );
}

export function normalizeEntityMediaId(kind: EntityMediaKind, entityId: string): string {
  return kind === "player" ? entityId.toLowerCase() : BigInt(entityId).toString();
}

export function entityMediaMessage({
  entityId,
  entityKind,
  media,
  version,
  wallet,
}: {
  entityId: string;
  entityKind: EntityMediaKind;
  media: Pick<YouTubeMedia, "type" | "id"> | null;
  version: number;
  wallet: string;
}): string {
  return [
    "Veydrift entity media",
    `Wallet: ${wallet.toLowerCase()}`,
    `Entity: ${entityKind}:${normalizeEntityMediaId(entityKind, entityId)}`,
    `Version: ${version}`,
    `YouTube media: ${media ? `${media.type}:${media.id}` : "none"}`,
    "Only sign this message if you want to update this public media in Veydrift."
  ].join("\n");
}

export function entityMediaEmbedUrl(media: Pick<YouTubeMedia, "type" | "id">): string {
  const path = media.type === "video" ? media.id : "videoseries";
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    playsinline: "1",
    rel: "0",
  });
  if (media.type === "playlist") params.set("list", media.id);
  return `https://www.youtube-nocookie.com/embed/${path}?${params.toString()}`;
}

export function nextEntityMediaPlaybackState(
  current: EntityMediaPlaybackState,
  entityKey: string,
  action: "sync-entity" | "turn-off" | "turn-on"
): EntityMediaPlaybackState {
  if (action === "sync-entity" && current.entityKey !== entityKey) {
    return { enabled: true, entityKey };
  }
  if (action === "turn-off") return { ...current, enabled: false };
  if (action === "turn-on") return { ...current, enabled: true };
  return current;
}

export async function fetchEntityMedia(
  apiUrl: string,
  entityKind: EntityMediaKind,
  entityId: string,
  signal?: AbortSignal
): Promise<EntityMediaResponse> {
  const response = await fetch(entityMediaEndpoint(apiUrl, entityKind, entityId), {
    headers: { accept: "application/json" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(await entityMediaApiError(response, "Media could not be loaded."));
  return response.json() as Promise<EntityMediaResponse>;
}

export async function updateEntityMedia(
  apiUrl: string,
  provider: Eip1193Provider,
  wallet: string,
  entityKind: EntityMediaKind,
  entityId: string,
  mediaUrl: string
): Promise<EntityMediaResponse> {
  const normalizedEntityId = normalizeEntityMediaId(entityKind, entityId);
  const preview = parseYouTubeMediaUrl(mediaUrl);
  if (!preview.ok) throw new Error(preview.error);
  const challenge = await fetchEntityMediaChallenge(
    apiUrl,
    wallet,
    entityKind,
    normalizedEntityId
  );
  const signature = await provider.request<string>({
    method: "personal_sign",
    params: [
      entityMediaMessage({
        entityId: normalizedEntityId,
        entityKind,
        media: preview.media,
        version: challenge.version,
        wallet,
      }),
      wallet,
    ],
  });
  const response = await fetch(entityMediaEndpoint(apiUrl, entityKind, normalizedEntityId), {
    body: JSON.stringify({ mediaUrl, signature, version: challenge.version, wallet }),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) throw new Error(await entityMediaApiError(response, "Media could not be saved."));
  return response.json() as Promise<EntityMediaResponse>;
}

export async function fetchEntityMediaChallenge(
  apiUrl: string,
  wallet: string,
  entityKind: EntityMediaKind,
  entityId: string
): Promise<EntityMediaChallenge> {
  const endpoint = `${entityMediaEndpoint(apiUrl, entityKind, entityId)}/challenge`;
  const response = await fetch(`${endpoint}?wallet=${encodeURIComponent(wallet)}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(await entityMediaApiError(response, "Media authorization could not be prepared."));
  }
  return response.json() as Promise<EntityMediaChallenge>;
}

export type ParsedYouTubeMedia =
  | { ok: true; media: Pick<YouTubeMedia, "type" | "id"> | null }
  | { ok: false; error: string };

export function parseYouTubeMediaUrl(value: string): ParsedYouTubeMedia {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, media: null };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "Enter a valid YouTube video or playlist URL." };
  }
  const host = url.hostname.toLowerCase();
  const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
  let type: YouTubeMedia["type"] | null = null;
  let id: string | null = null;
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    type = "video";
    id = parts[0] ?? null;
  } else if (youtubeHosts.has(host)) {
    if (url.pathname === "/watch") {
      const videoId = url.searchParams.get("v");
      type = videoId ? "video" : "playlist";
      id = videoId ?? url.searchParams.get("list");
    } else if (url.pathname === "/playlist" || (parts[0] === "embed" && parts[1] === "videoseries")) {
      type = "playlist";
      id = url.searchParams.get("list");
    } else if (parts[0] === "shorts" || parts[0] === "live" || parts[0] === "embed") {
      type = "video";
      id = parts[1] ?? null;
    }
  } else {
    return { ok: false, error: "Only YouTube video and playlist URLs are supported." };
  }

  if (type === "video" && id && /^[A-Za-z0-9_-]{11}$/.test(id)) return { ok: true, media: { type, id } };
  if (type === "playlist" && id && /^[A-Za-z0-9_-]{10,64}$/.test(id)) return { ok: true, media: { type, id } };
  return { ok: false, error: "Enter a supported YouTube video or playlist URL." };
}

function entityMediaEndpoint(apiUrl: string, entityKind: EntityMediaKind, entityId: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/entity-media/${entityKind}/${encodeURIComponent(normalizeEntityMediaId(entityKind, entityId))}`;
}

async function entityMediaApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { message?: unknown };
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  } catch {
    // Fall through to a stable surface-specific message.
  }
  return `${fallback} (${response.status})`;
}
