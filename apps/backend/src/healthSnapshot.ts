import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// /health is computed by the writer, whose event loop is busy with chain sync, so forwarding every
// probe to it put p95 near 200 ms. The writer publishes its health response once a second and
// readers answer from that file while it is fresh; a stalled writer stops publishing, the snapshot
// ages out and readers forward to the writer again, so a wedged writer still reads as unhealthy.
export const HEALTH_SNAPSHOT_MAX_AGE_MS = 5_000;

type HealthSnapshot = {
  publishedAt: number;
  status: number;
  headers: Array<[string, string]>;
  body: string;
};

export function healthSnapshotPath(indexDbPath: string): string | null {
  return indexDbPath === ":memory:" ? null : join(dirname(indexDbPath), "health-snapshot.json");
}

export function startHealthSnapshotPublisher(
  path: string,
  handler: (request: Request) => Promise<Response>,
  intervalMs = 1_000
): () => void {
  let publishing = false;
  const publish = async () => {
    if (publishing) return;
    publishing = true;
    try {
      const response = await handler(new Request("http://127.0.0.1/health"));
      const headers: Array<[string, string]> = [];
      response.headers.forEach((value, key) => headers.push([key, value]));
      const snapshot: HealthSnapshot = { publishedAt: Date.now(), status: response.status, headers, body: await response.text() };
      writeFileSync(`${path}.tmp`, JSON.stringify(snapshot));
      renameSync(`${path}.tmp`, path);
    } catch {
      // A missed publish only ages the snapshot; readers then ask the writer directly.
    } finally {
      publishing = false;
    }
  };
  void publish();
  const timer = setInterval(() => void publish(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function healthSnapshotResponse(path: string, request: Request, now = Date.now()): Response | undefined {
  if (request.method !== "GET" || new URL(request.url).pathname !== "/health") return undefined;
  let snapshot: HealthSnapshot;
  try {
    snapshot = JSON.parse(readFileSync(path, "utf8")) as HealthSnapshot;
  } catch {
    return undefined;
  }
  if (!(now - snapshot.publishedAt <= HEALTH_SNAPSHOT_MAX_AGE_MS)) return undefined;
  const headers = new Headers(snapshot.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("cache-control", "no-store");
  return new Response(snapshot.body, { status: snapshot.status, headers });
}
