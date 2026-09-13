import { Database } from "bun:sqlite";
import { readPersistedStatsSnapshot } from "../../backend/src/stats.ts";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = new URL("../dist/", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 3000);
function positiveMs(name, fallback, minimum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
  return value;
}
const snapshotRefreshMs = positiveMs("VEYDRIFT_STATS_REFRESH_MS", 60_000, 1000);
const catchupMs = positiveMs("VEYDRIFT_STATS_CATCHUP_MS", 1000, 250);
const workerTimeoutMs = positiveMs("VEYDRIFT_STATS_WORKER_TIMEOUT_MS", 120_000, 1000);
const storePath = process.env.VEYDRIFT_STATS_DB_PATH ?? ".data/stats.sqlite";
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

let snapshot = null;
let snapshotError = null;
let refreshing = false;
let refreshProgress = null;
let activeWorker = null;
let stopping = false;
let refreshTimer = null;
// Restart immediately serves the durable last-good result, even during bootstrap/reconciliation.
if (!upstreamStatsUrl && existsSync(storePath)) {
  let store;
  try {
    store = new Database(storePath, { readonly: true });
    snapshot = readPersistedStatsSnapshot(store);
  } catch (error) {
    snapshotError = `Persisted stats unavailable: ${error.message}`;
  } finally { store?.close(); }
}

// Optional first-rollout bridge for an older service that had only an in-memory snapshot.
// The parent saves that service's /api/stats JSON on the private stats volume before deployment.
if (!upstreamStatsUrl && !snapshot && process.env.VEYDRIFT_STATS_SEED_SNAPSHOT_PATH) {
  try {
    const seed = JSON.parse(readFileSync(process.env.VEYDRIFT_STATS_SEED_SNAPSHOT_PATH, "utf8"));
    if (!seed.generatedAt || !seed.coverage || !seed.summary || !Array.isArray(seed.daily)) throw new Error("Invalid seed snapshot");
    snapshot = seed;
  } catch (error) { snapshotError = `Stats seed unavailable: ${error.message}`; }
}

async function refreshSnapshot() {
  if (upstreamStatsUrl) return;
  if (refreshing || stopping) return;
  refreshing = true;
  try {
    // One bounded delta + historical-audit batch per isolated process. UTC is canonical;
    // viewers never create more aggregation work, and the server never opens the game DB.
    const worker = Bun.spawn({
      cmd: [process.execPath, new URL("./snapshot-worker.mjs", import.meta.url).pathname],
      env: process.env,
      stderr: "pipe",
      stdout: "pipe"
    });
    activeWorker = worker;
    const timeout = setTimeout(() => worker.kill("SIGKILL"), workerTimeoutMs);
    const [exitCode, stdout, stderr] = await Promise.all([
      worker.exited,
      new Response(worker.stdout).text(),
      new Response(worker.stderr).text()
    ]).finally(() => clearTimeout(timeout));
    if (exitCode !== 0) throw new Error(stderr.trim() || `Stats snapshot worker exited with ${exitCode}`);
    const result = JSON.parse(stdout);
    snapshot = result.snapshot ?? snapshot;
    const { snapshot: _snapshot, ...progress } = result;
    refreshProgress = progress;
    snapshotError = null;
  } catch (error) {
    snapshotError = error instanceof Error ? error.message : "Unknown stats refresh error";
  } finally {
    activeWorker = null;
    refreshing = false;
    if (!stopping) refreshTimer = setTimeout(() => void refreshSnapshot(), !snapshotError && refreshProgress?.pending ? catchupMs : snapshotRefreshMs).unref();
  }
}

if (!upstreamStatsUrl) void refreshSnapshot();
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stopStatsServer();
    process.exit(0);
  });
}

export const server = Bun.serve({
  port,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/stats") {
      if (upstreamStatsUrl) {
        return fetch(`${upstreamStatsUrl}/api/stats`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(10_000)
        }).catch(() => Response.json({ error: "Stats upstream unavailable" }, { status: 503 }));
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
      return Response.json({ ok: Boolean(snapshot), refreshing, generatedAt: snapshot?.generatedAt ?? null, progress: refreshProgress, ...(snapshotError ? { snapshotError } : {}) }, {
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

console.log(`Veydrift stats listening on :${server.port}`);

export function stopStatsServer() {
  stopping = true;
  if (refreshTimer) clearTimeout(refreshTimer);
  activeWorker?.kill("SIGKILL");
  server.stop(true);
}
