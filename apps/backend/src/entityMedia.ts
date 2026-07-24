import { getAddress, verifyMessage, type Address as ViemAddress } from "viem";
import type { Address } from "./evm";

export const entityMediaKinds = ["planet", "moon", "player", "alliance"] as const;

export type EntityMediaKind = (typeof entityMediaKinds)[number];
export type YouTubeMedia = {
  type: "video" | "playlist";
  id: string;
  canonicalUrl: string;
};

export type EntityMedia = {
  entityKind: EntityMediaKind;
  entityId: string;
  media: YouTubeMedia;
  updatedAt: string;
};

export type EntityMediaChallenge = {
  entityKind: EntityMediaKind;
  entityId: string;
  version: number;
  wallet: Address;
};

export type YouTubeMediaValidation =
  | { ok: true; media: YouTubeMedia | null }
  | { ok: false; error: string };

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const playlistIdPattern = /^[A-Za-z0-9_-]{10,64}$/;
const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

export function isEntityMediaKind(value: string): value is EntityMediaKind {
  return entityMediaKinds.includes(value as EntityMediaKind);
}

export function normalizeEntityMediaId(kind: EntityMediaKind, value: string): string {
  const decoded = decodeURIComponent(value).trim();
  if (kind === "player") {
    return getAddress(decoded).toLowerCase();
  }
  if (!/^[1-9][0-9]*$/.test(decoded)) {
    throw new Error(`${kind[0]?.toUpperCase()}${kind.slice(1)} id must be a positive integer.`);
  }
  return BigInt(decoded).toString();
}

export function validateYouTubeMediaUrl(value: unknown): YouTubeMediaValidation {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: true, media: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "Enter a YouTube video or playlist URL." };
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, error: "Enter a valid YouTube video or playlist URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Enter a valid YouTube video or playlist URL." };
  }

  const host = url.hostname.toLowerCase();
  let videoId: string | null = null;
  let playlistId: string | null = null;

  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (youtubeHosts.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
      if (!videoId) playlistId = url.searchParams.get("list");
    } else if (url.pathname === "/playlist") {
      playlistId = url.searchParams.get("list");
    } else if (parts[0] === "shorts" || parts[0] === "live") {
      videoId = parts[1] ?? null;
    } else if (parts[0] === "embed" && parts[1] === "videoseries") {
      playlistId = url.searchParams.get("list");
    } else if (parts[0] === "embed") {
      videoId = parts[1] ?? null;
    }
  } else {
    return { ok: false, error: "Only YouTube video and playlist URLs are supported." };
  }

  if (playlistId !== null) {
    if (!playlistIdPattern.test(playlistId)) {
      return { ok: false, error: "This YouTube playlist URL has an invalid playlist id." };
    }
    return {
      ok: true,
      media: {
        type: "playlist",
        id: playlistId,
        canonicalUrl: `https://www.youtube.com/playlist?list=${playlistId}`
      }
    };
  }

  if (videoId !== null) {
    if (!videoIdPattern.test(videoId)) {
      return { ok: false, error: "This YouTube video URL has an invalid video id." };
    }
    return {
      ok: true,
      media: {
        type: "video",
        id: videoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`
      }
    };
  }

  return { ok: false, error: "Enter a supported YouTube video or playlist URL." };
}

export function entityMediaMessage({
  entityId,
  entityKind,
  media,
  version,
  wallet
}: {
  entityId: string;
  entityKind: EntityMediaKind;
  media: YouTubeMedia | null;
  version: number;
  wallet: Address;
}): string {
  return [
    "Veydrift entity media",
    `Wallet: ${wallet.toLowerCase()}`,
    `Entity: ${entityKind}:${entityId}`,
    `Version: ${version}`,
    `YouTube media: ${media ? `${media.type}:${media.id}` : "none"}`,
    "Only sign this message if you want to update this public media in Veydrift."
  ].join("\n");
}

export async function verifyEntityMediaSignature({
  entityId,
  entityKind,
  media,
  signature,
  version,
  wallet
}: {
  entityId: string;
  entityKind: EntityMediaKind;
  media: YouTubeMedia | null;
  signature: unknown;
  version: number;
  wallet: Address;
}): Promise<boolean> {
  if (typeof signature !== "string" || !/^0x[a-fA-F0-9]+$/.test(signature)) return false;

  try {
    return await verifyMessage({
      address: getAddress(wallet) as ViemAddress,
      message: entityMediaMessage({ entityId, entityKind, media, version, wallet }),
      signature: signature as `0x${string}`
    });
  } catch {
    return false;
  }
}
