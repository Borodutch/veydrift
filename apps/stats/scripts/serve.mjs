import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = new URL("../dist/", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 3000);
const snapshotRefreshMs = Number(process.env.VEYDRIFT_STATS_REFRESH_MS ?? 60_000);
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

async function refreshSnapshot() {
  if (upstreamStatsUrl) return;
  if (refreshing) return;
  refreshing = true;
  try {
    // Statistics aggregation performs broad SQLite scans. Run it in an isolated Bun process so
    // this public API keeps serving the last completed snapshot while the next one is calculated.
    // UTC is canonical; the UI renders dates locally, so viewers do not create duplicate work.
    const worker = Bun.spawn({
      cmd: [process.execPath, new URL("./snapshot-worker.mjs", import.meta.url).pathname],
      env: process.env,
      stderr: "pipe",
      stdout: "pipe"
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      worker.exited,
      new Response(worker.stdout).text(),
      new Response(worker.stderr).text()
    ]);
    if (exitCode !== 0) throw new Error(stderr.trim() || `Stats snapshot worker exited with ${exitCode}`);
    snapshot = JSON.parse(stdout);
    snapshotError = null;
  } catch (error) {
    snapshotError = error instanceof Error ? error.message : "Unknown stats refresh error";
  } finally {
    refreshing = false;
  }
}

if (!upstreamStatsUrl) {
  void refreshSnapshot();
  setInterval(() => void refreshSnapshot(), snapshotRefreshMs).unref();
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
