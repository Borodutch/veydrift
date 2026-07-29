import { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { buildPublicStatsSnapshot } from "../../backend/src/stats.ts";

const root = new URL("../dist/", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 3000);
const snapshotRefreshMs = Number(process.env.VEYDRIFT_STATS_REFRESH_MS ?? 60_000);
const indexDbPath = process.env.VEYDRIFT_INDEX_DB_PATH ?? "/app/apps/backend/.data/contract-state.sqlite";
const upstreamStatsUrl = process.env.VEYDRIFT_STATS_UPSTREAM_URL?.replace(/\/$/, "");
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const db = upstreamStatsUrl ? null : new Database(indexDbPath, { readonly: true });
let snapshot = null;
let snapshotError = null;
let refreshing = false;

function contractDescriptors() {
  const candidates = [
    [process.env.VEYDRIFT_GAME_CONTRACT_ADDRESS ?? process.env.VEYDRIFT_CONTRACT_ADDRESS, "Game"],
    [process.env.VEYDRIFT_SETTLEMENT_CONTRACT_ADDRESS, "Settlement"],
    [process.env.VEYDRIFT_RANDOMNESS_ENGINE_ADDRESS, "Randomness"],
    [process.env.VEYDRIFT_ALLIANCE_CONTRACT_ADDRESS, "Alliances"],
    [process.env.VEYDRIFT_MOON_CONTRACT_ADDRESS, "Moons"],
    [process.env.VEYDRIFT_MIGRATION_CONTRACT_ADDRESS, "Migration"],
    [process.env.VEYDRIFT_REFERRAL_SYSTEM_ADDRESS, "Referrals"],
    [process.env.VEYDRIFT_METAL_TOKEN_ADDRESS, "vMETAL"],
    [process.env.VEYDRIFT_CRYSTAL_TOKEN_ADDRESS, "vCRYSTAL"],
    [process.env.VEYDRIFT_DEUTERIUM_TOKEN_ADDRESS, "vDEUTERIUM"]
  ];
  const labels = new Map();
  for (const [address, label] of candidates) {
    if (!address) continue;
    const normalized = address.toLowerCase();
    labels.set(normalized, labels.has(normalized) ? `${labels.get(normalized)} / ${label}` : label);
  }
  return [...labels].map(([address, label]) => ({ address, label }));
}

function refreshSnapshot() {
  if (upstreamStatsUrl) return;
  if (refreshing) return;
  refreshing = true;
  try {
    // UTC is canonical. The UI renders dates locally, so viewers do not cause
    // duplicate full-index calculations for their individual time zones.
    snapshot = buildPublicStatsSnapshot(db, contractDescriptors(), undefined, 0);
    snapshotError = null;
  } catch (error) {
    snapshotError = error instanceof Error ? error.message : "Unknown stats refresh error";
  } finally {
    refreshing = false;
  }
}

if (!upstreamStatsUrl) {
  refreshSnapshot();
  setInterval(refreshSnapshot, snapshotRefreshMs).unref();
}

Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/stats") {
      if (upstreamStatsUrl) {
        return fetch(`${upstreamStatsUrl}/api/stats`, {
          headers: { accept: "application/json" }
        });
      }
      if (!snapshot) {
        return Response.json({ error: "Stats snapshot is warming" }, {
          headers: { "cache-control": "no-store" },
          status: 503
        });
      }
      return Response.json(snapshot, {
        headers: {
          "cache-control": "public, max-age=30, stale-while-revalidate=90",
          "content-type": "application/json; charset=utf-8"
        }
      });
    }
    if (url.pathname === "/health") {
      if (upstreamStatsUrl) {
        return Response.json({ ok: true, upstream: upstreamStatsUrl }, {
          headers: { "cache-control": "no-store" }
        });
      }
      return Response.json({ ok: Boolean(snapshot), refreshing, ...(snapshotError ? { snapshotError } : {}) }, {
        headers: { "cache-control": "no-store" },
        status: snapshot ? 200 : 503
      });
    }
    const requested = normalize(url.pathname).replace(/^(\.\.(\/|\\|$))+/, "");
    let path = join(root, requested);
    if (!existsSync(path) || statSync(path).isDirectory()) path = join(root, "index.html");
    return new Response(readFileSync(path), {
      headers: {
        "cache-control": path.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
        "content-type": mime[extname(path)] ?? "application/octet-stream",
        "x-content-type-options": "nosniff"
      }
    });
  }
});

console.log(`Veydrift stats listening on :${port}`);
