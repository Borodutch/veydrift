import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HEALTH_SNAPSHOT_MAX_AGE_MS, healthSnapshotResponse, startHealthSnapshotPublisher } from "./healthSnapshot";

test("readers serve the writer's fresh /health snapshot and defer to the writer once it is stale", async () => {
  const dir = mkdtempSync(join(tmpdir(), "veydrift-health-"));
  try {
    const path = join(dir, "health-snapshot.json");
    expect(healthSnapshotResponse(path, new Request("http://localhost/health"))).toBeUndefined();
    const stop = startHealthSnapshotPublisher(path, async () => Response.json({ ok: false }, { status: 503 }), 60_000);
    await Bun.sleep(20);
    stop();
    const fresh = healthSnapshotResponse(path, new Request("http://localhost/health"))!;
    expect(fresh.status).toBe(503);
    expect(await fresh.json()).toEqual({ ok: false });
    expect(fresh.headers.get("content-type")).toContain("application/json");
    expect(healthSnapshotResponse(path, new Request("http://localhost/health", { method: "POST" }))).toBeUndefined();
    expect(healthSnapshotResponse(path, new Request("http://localhost/runtime-config"))).toBeUndefined();
    expect(healthSnapshotResponse(path, new Request("http://localhost/health"), Date.now() + HEALTH_SNAPSHOT_MAX_AGE_MS + 1)).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
