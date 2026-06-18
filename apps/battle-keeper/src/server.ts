import type { BattleKeeper, KeeperSnapshot } from "./keeper";
import type { SweepSnapshot } from "./sweep";
import type { WsBattleListener, WsListenerSnapshot } from "./wsListener";

export type KeeperBuildInfo = {
  gitSha: string | null;
};

export type KeeperHealthOptions = {
  build?: KeeperBuildInfo;
  sweep?: { snapshot: () => SweepSnapshot };
  staleDueSeconds?: number;
};

export type KeeperHealth = {
  ok: boolean;
  status: "healthy" | "degraded";
  pendingCount: number;
  lastResolvedMissionId: string | null;
  lastResolvedAt: string | null;
  lastError: string | null;
  healthWarnings: string[];
  build: KeeperBuildInfo;
  keeper: KeeperSnapshot;
  sweep: SweepSnapshot | null;
  ws: WsListenerSnapshot;
  uptimeSeconds: number;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8" } as const;
const defaultStaleDueSeconds = 120;

export function buildInfoFromEnv(env: NodeJS.ProcessEnv = process.env): KeeperBuildInfo {
  return {
    gitSha:
      env.GIT_SHA?.trim() ||
      env.SOURCE_VERSION?.trim() ||
      env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
      env.EASYPANEL_GIT_SHA?.trim() ||
      null
  };
}

export function buildHealth(
  keeper: BattleKeeper,
  ws: WsBattleListener,
  startedAtMs: number,
  nowMs: number,
  options: KeeperHealthOptions = {}
): KeeperHealth {
  const keeperSnapshot = keeper.snapshot();
  const wsSnapshot = ws.snapshot();
  const sweepSnapshot = options.sweep?.snapshot() ?? null;
  const healthWarnings: string[] = [];
  if (!wsSnapshot.connected) {
    healthWarnings.push("websocket_disconnected");
  }
  if (
    keeperSnapshot.oldestDueAgeSeconds !== null &&
    keeperSnapshot.oldestDueAgeSeconds >= (options.staleDueSeconds ?? defaultStaleDueSeconds) &&
    keeperSnapshot.submitFailureCount > 0
  ) {
    healthWarnings.push("stale_due_retry_backlog");
  }
  if (sweepSnapshot?.lastSweepError) {
    healthWarnings.push("sweep_failed");
  }

  // "ok" is liveness/readiness for the process health check. `status` carries operational
  // degradation, including retry storms, without forcing EasyPanel to restart a live keeper.
  const ok = wsSnapshot.connected;
  return {
    ok,
    status: healthWarnings.length === 0 ? "healthy" : "degraded",
    pendingCount: keeperSnapshot.pendingCount,
    lastResolvedMissionId: keeperSnapshot.lastResolvedMissionId,
    lastResolvedAt: keeperSnapshot.lastResolvedAt,
    lastError: keeperSnapshot.lastError,
    healthWarnings,
    build: options.build ?? buildInfoFromEnv(),
    keeper: keeperSnapshot,
    sweep: sweepSnapshot,
    ws: wsSnapshot,
    uptimeSeconds: Math.floor((nowMs - startedAtMs) / 1_000)
  };
}

/** Pure request handler — testable without binding a socket. GET /health and GET / both return the
 * health snapshot; everything else is 404. */
export function createHandler(
  keeper: BattleKeeper,
  ws: WsBattleListener,
  startedAtMs: number,
  now: () => number = () => Date.now(),
  options: KeeperHealthOptions = {}
): (request: Request) => Response {
  return (request: Request): Response => {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      const health = buildHealth(keeper, ws, startedAtMs, now(), options);
      return new Response(JSON.stringify(health, null, 2), {
        status: health.ok ? 200 : 503,
        headers: jsonHeaders
      });
    }
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: jsonHeaders
    });
  };
}
